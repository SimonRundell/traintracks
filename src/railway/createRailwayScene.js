import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildStandardOval } from './standardOval.js'
import { loadModel, placeAtPose } from './rollingStock.js'
import { HST_FORMATION, computeCouplingOffsets } from './consist.js'
import { createTrackBuilder } from './trackBuilder.js'
import { stepPath } from './pathWalker.js'

const MAX_LOCO_SPEED = 16 // metres per second at full throttle
const ISO_VIEW_SIZE = 135
const ISO_CAMERA_DISTANCE = 195

/**
 * Finds the recorded pose at a given distance along the lead unit's travel
 * history, interpolating between the two nearest samples. Samples are taken
 * every frame the lead advances into new territory, so consecutive samples
 * are close enough together (well under a metre) that linear interpolation
 * of position and tangent is visually indistinguishable from the true curve.
 *
 * @param {{distance: number, point: THREE.Vector3, tangent: THREE.Vector3}[]} history Samples sorted by ascending distance, starting at 0.
 * @param {number} distance Distance along the path to sample, clamped to the recorded range.
 * @returns {{point: THREE.Vector3, tangent: THREE.Vector3}} Interpolated pose at that distance.
 */
function sampleHistory(history, distance) {
  const last = history[history.length - 1]
  if (distance >= last.distance) return last
  if (distance <= history[0].distance) return history[0]

  let lo = 0
  let hi = history.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (history[mid].distance < distance) lo = mid + 1
    else hi = mid
  }
  const after = history[lo]
  const before = history[lo - 1]
  const span = after.distance - before.distance
  const frac = span > 1e-9 ? (distance - before.distance) / span : 0
  return {
    point: before.point.clone().lerp(after.point, frac),
    tangent: before.tangent.clone().lerp(after.tangent, frac).normalize(),
  }
}

/**
 * Loads one instance of every unit in a formation, caching by model URL so
 * repeated vehicles (e.g. two identical power cars) only fetch and parse
 * their glTF once — later instances are cheap clones that share geometry
 * and materials with the original.
 *
 * @param {import('./consist.js').ConsistUnit[]} formation Train formation to load.
 * @returns {Promise<THREE.Object3D[]>} One object per unit, in formation order.
 */
function loadFormation(formation) {
  const modelCache = new Map()
  function loadCached(url) {
    if (!modelCache.has(url)) modelCache.set(url, loadModel(url))
    return modelCache.get(url)
  }
  return Promise.all(formation.map((unit) => loadCached(unit.modelUrl).then((model) => model.clone(true))))
}

/**
 * Sets up the railway scene inside a canvas: an isometric orthographic
 * camera with orbit/zoom/pan controls, the oval track, and the HST
 * formation driven by a shared controller state. Starts its own render loop
 * immediately.
 *
 * @param {HTMLCanvasElement} canvas Target canvas element, sized by CSS to its container.
 * @param {import('./trainController.js').TrainController} controller Shared throttle/direction state, read every frame.
 * @returns {() => void} Dispose function that stops the loop and frees GPU resources.
 */
export function createRailwayScene(canvas, controller) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x202531)

  const couplingOffsets = computeCouplingOffsets(HST_FORMATION)

  // Shared, mutable list of every track piece (the starting oval plus
  // anything laid in LAY mode). trackBuilder pushes/splices this directly.
  const { pieces: ovalPieces } = buildStandardOval(scene)
  const pieces = [...ovalPieces]
  const ovalPiece = ovalPieces[0] // lap-start reference for the initial train placement/backfill below

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(30, 40, 20)
  scene.add(sun)

  const aspect = canvas.clientWidth / canvas.clientHeight || 1
  const camera = new THREE.OrthographicCamera(
    (-ISO_VIEW_SIZE * aspect) / 2,
    (ISO_VIEW_SIZE * aspect) / 2,
    ISO_VIEW_SIZE / 2,
    -ISO_VIEW_SIZE / 2,
    0.1,
    500,
  )
  const isoDirection = new THREE.Vector3(1, 1, 1).normalize()
  camera.position.copy(isoDirection.multiplyScalar(ISO_CAMERA_DISTANCE))
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  // minZoom sets how far out the view can go: ISO_VIEW_SIZE / minZoom metres across. 0.005 gives
  // ~27km, comfortably covering a 10-real-mile (~16km) layout with room to spare — this sim already
  // runs at full prototype scale everywhere else (1.435m gauge, ~4m tall locos), not tabletop OO size.
  controls.minZoom = 0.005
  controls.maxZoom = 8
  // Keep the camera at or above track level — no viewing the layout from underground.
  controls.maxPolarAngle = Math.PI / 2
  controls.update()

  const trackBuilder = createTrackBuilder({
    scene,
    camera,
    domElement: renderer.domElement,
    controls,
    pieces,
  })
  // The lead unit's position is tracked as a walk through the track graph
  // (piece + parameter + direction), stepped forward by stepPath whenever it
  // advances into new territory — that's the only time junction switch state
  // matters. Every pose visited is recorded into `history`; reversing just
  // re-reads that history backwards rather than re-deriving it, and trailing
  // units are placed by reading the same history at their coupling offset
  // behind the lead, so the whole train follows exactly what the front of it
  // actually did, through however many pieces and junctions that involved.
  const pathState = { piece: ovalPiece, t: 0, direction: 1 }
  const initialPose = { distance: 0, point: ovalPiece.curve.getPointAt(0), tangent: ovalPiece.curve.getTangentAt(0) }
  const history = [initialPose]
  let cursorDistance = 0
  let maxDistance = 0

  // Backfill history behind distance 0 along the oval (no other track exists
  // yet), so trailing units read valid poses from the very first frame
  // instead of starting bunched up at the lead's position and only spreading
  // into formation once the lead has travelled the train's own length.
  const maxCouplingOffset = couplingOffsets[couplingOffsets.length - 1] ?? 0
  if (maxCouplingOffset > 0) {
    const BACKFILL_STEP = 1 // metres between backfilled samples
    const backfillState = { piece: ovalPiece, t: 0, direction: -1 }
    const backfillSamples = []
    let walked = 0
    while (walked < maxCouplingOffset) {
      const step = Math.min(BACKFILL_STEP, maxCouplingOffset - walked)
      stepPath(backfillState, step, [])
      walked += step
      backfillSamples.push({
        distance: -walked,
        point: backfillState.piece.curve.getPointAt(backfillState.t),
        tangent: backfillState.piece.curve.getTangentAt(backfillState.t).multiplyScalar(backfillState.direction),
      })
    }
    backfillSamples.reverse() // ascending order: most negative first, ending just before distance 0
    history.unshift(...backfillSamples)
  }

  let units = null
  let disposed = false
  loadFormation(HST_FORMATION).then((models) => {
    if (disposed) return
    units = models
    units.forEach((model) => scene.add(model))
  })

  function resize() {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    const newAspect = width / height
    camera.left = (-ISO_VIEW_SIZE * newAspect) / 2
    camera.right = (ISO_VIEW_SIZE * newAspect) / 2
    camera.top = ISO_VIEW_SIZE / 2
    camera.bottom = -ISO_VIEW_SIZE / 2
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)

  let lastTime = performance.now()
  let frameId = requestAnimationFrame(animate)

  function animate() {
    const now = performance.now()
    const delta = (now - lastTime) / 1000
    lastTime = now

    const laying = controller.mode === 'lay'
    trackBuilder.setEnabled(laying)

    if (units) {
      units.forEach((model) => {
        model.visible = !laying
      })

      if (laying) {
        // No train operation while building — leave the camera fully free.
        controls.enablePan = true
      } else {
        const speed = controller.speedFraction * MAX_LOCO_SPEED * controller.direction
        cursorDistance = Math.max(0, cursorDistance + speed * delta)

        // Only extend the path (and so only ever consult junction switch
        // state) when moving into territory beyond anywhere already
        // visited. Reversing back over already-recorded ground just rereads
        // that history — it doesn't undo or re-decide anything.
        if (cursorDistance > maxDistance) {
          const { consumed } = stepPath(pathState, cursorDistance - maxDistance, trackBuilder.junctions)
          maxDistance += consumed
          // A dead end (an open piece's free end with nothing connected)
          // covers less than requested — pull cursorDistance back down to
          // match, so it can't drift ahead of where the train actually is.
          // Without this, distance keeps accumulating from the throttle
          // while the train sits still, and every trailing unit eventually
          // reads that same far-future, un-stuck distance and jumps to pile
          // up at the dead end too.
          cursorDistance = maxDistance
          history.push({
            distance: maxDistance,
            point: pathState.piece.curve.getPointAt(pathState.t),
            tangent: pathState.piece.curve.getTangentAt(pathState.t).multiplyScalar(pathState.direction),
          })
        }

        units.forEach((model, i) => {
          const pose = sampleHistory(history, cursorDistance - couplingOffsets[i])
          placeAtPose(model, pose.point, pose.tangent, HST_FORMATION[i].reversed)
        })

        // In follow mode, keep the orbit target on the lead loco. OrbitControls
        // then re-derives the camera position from its own tracked spherical
        // angles/radius, so the user's rotate and zoom still apply around the
        // moving target — only panning away from it is disabled.
        const following = controller.cameraMode === 'follow'
        controls.enablePan = !following
        if (following) controls.target.copy(units[0].position)
      }
    }

    controls.update()
    renderer.render(scene, camera)
    frameId = requestAnimationFrame(animate)
  }

  return function dispose() {
    disposed = true
    cancelAnimationFrame(frameId)
    resizeObserver.disconnect()
    trackBuilder.dispose()
    // Pick meshes live outside the scene graph, so the traversal below won't reach them.
    pieces.forEach((piece) => {
      piece.pickMesh.geometry.dispose()
      piece.pickMesh.material.dispose()
    })
    controls.dispose()
    renderer.dispose()
    scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose()
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      }
    })
  }
}
