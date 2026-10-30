import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildDefaultLayout } from './defaultLayout.js'
import { loadModel, placeAtPose } from './rollingStock.js'
import { HST_FORMATION, computeCouplingOffsets } from './consist.js'
import { createTrackBuilder } from './trackBuilder.js'
import { createPlatformBuilder } from './platformBuilder.js'
import { createStationBuilder } from './stationBuilder.js'
import { createPieceInspector } from './pieceInspector.js'
import { stepPath } from './pathWalker.js'
import { buildLayoutSnapshot, deserializePlatforms, deserializeStations } from './layoutSerializer.js'

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
 * @param {Object} [options]
 * @param {(selection: {piece: import('./trackBuilder.js').TrackPiece, end: 'start' | 'end'} | null) => void} [options.onSelectionChange] Forwarded to createTrackBuilder — called whenever the LAY-mode drawer's target end changes.
 * @returns {{dispose: () => void, trackBuilder: ReturnType<typeof import('./trackBuilder.js').createTrackBuilder>, platformBuilder: ReturnType<typeof import('./platformBuilder.js').createPlatformBuilder>, loadLayout: (data: Object) => void, getSnapshot: () => Object}} `dispose` stops the loop and frees GPU resources; `trackBuilder`/`platformBuilder` are the live handles a host UI (the track drawer) drives; `getSnapshot`/`loadLayout` save and load the whole layout (track and platforms together).
 */
export function createRailwayScene(canvas, controller, { onSelectionChange } = {}) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x202531)

  const couplingOffsets = computeCouplingOffsets(HST_FORMATION)

  // Shared, mutable list of every track piece (the starting layout plus
  // anything laid in LAY mode). trackBuilder pushes/splices this directly.
  const { pieces: layoutPieces, junctions: layoutJunctions } = buildDefaultLayout(scene)
  const pieces = [...layoutPieces]
  // Shared, mutable list of every platform section — empty at startup (see defaultLayout.js's doc
  // comment); platformBuilder.js pushes/splices this directly, same as trackBuilder.js does for `pieces`.
  const platforms = []
  // Shared, mutable list of every placed station building — also empty at startup; stationBuilder.js
  // pushes/splices this directly, mirroring platforms.
  const stations = []

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
    pieces,
    onSelectionChange,
  })
  trackBuilder.junctions.push(...layoutJunctions) // seed with the default layout's station points, so they're switchable and the path walker sees them just like a hand-built fork
  trackBuilder.markInitialDanglingEnds() // the layout's own genuinely open ends (the siding's stub) need a marker too, not just ones built interactively afterwards
  const platformBuilder = createPlatformBuilder({ scene, camera, domElement: renderer.domElement, pieces, platforms })
  const stationBuilder = createStationBuilder({ scene, camera, domElement: renderer.domElement, platforms, stations })
  const pieceInspector = createPieceInspector({ camera, domElement: renderer.domElement, pieces })
  // The lead unit's position is tracked as a walk through the track graph
  // (piece + parameter + direction), stepped forward by stepPath whenever it
  // advances into new territory — that's the only time junction switch state
  // matters. Every pose visited is recorded into `history`; reversing just
  // re-reads that history backwards rather than re-deriving it, and trailing
  // units are placed by reading the same history at their coupling offset
  // behind the lead, so the whole train follows exactly what the front of it
  // actually did, through however many pieces and junctions that involved.
  //
  // All of this gets torn down and rebuilt by resetTrainState (below) whenever a new layout loads in —
  // the piece/junction objects the train was walking won't exist any more, so its position has to start
  // fresh rather than try to carry over.
  const pathState = { piece: null, t: 1, direction: 1 }
  const backState = { piece: null, t: 1, direction: -1 }
  const history = []
  let cursorDistance = 0
  let maxDistance = 0
  let minDistance = 0

  /**
   * (Re)sets the train's position to the start of whatever's currently piece #0 (or, failing that, just
   * the first piece) — t=1, facing forward — and rebuilds its backfilled history so trailing units read
   * valid poses from the very first frame instead of starting bunched up at the lead's position. Called
   * once at startup, and again by loadLayout after a saved layout replaces the current one.
   *
   * @returns {void}
   */
  function resetTrainState() {
    const startPiece = pieces.find((piece) => piece.id === 0) ?? pieces[0]
    pathState.piece = startPiece
    pathState.t = 1
    pathState.direction = 1
    backState.piece = startPiece
    backState.t = 1
    backState.direction = -1

    history.length = 0
    history.push({ distance: 0, point: startPiece.curve.getPointAt(1), tangent: startPiece.curve.getTangentAt(1) })
    cursorDistance = 0
    maxDistance = 0
    minDistance = 0

    // Backfill history behind distance 0 (no other track exists yet, from the train's perspective), so
    // trailing units read valid poses from the very first frame instead of starting bunched up at the
    // lead's position and only spreading into formation once the lead has travelled the train's own
    // length.
    const maxCouplingOffset = couplingOffsets[couplingOffsets.length - 1] ?? 0
    if (maxCouplingOffset > 0) {
      const BACKFILL_STEP = 1 // metres between backfilled samples
      const backfillSamples = []
      let walked = 0
      while (walked < maxCouplingOffset) {
        const step = Math.min(BACKFILL_STEP, maxCouplingOffset - walked)
        stepPath(backState, step, [])
        walked += step
        backfillSamples.push({
          distance: -walked,
          point: backState.piece.curve.getPointAt(backState.t),
          tangent: backState.piece.curve.getTangentAt(backState.t).multiplyScalar(backState.direction),
        })
      }
      backfillSamples.reverse() // ascending order: most negative first, ending just before distance 0
      history.unshift(...backfillSamples)
      minDistance = -walked
    }
  }
  resetTrainState()

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
    platformBuilder.setEnabled(laying)
    stationBuilder.setEnabled(laying)

    if (units) {
      units.forEach((model) => {
        model.visible = !laying
      })

      if (laying) {
        // No train operation while building — leave the camera fully free.
        controls.enablePan = true
      } else {
        const speed = controller.speedFraction * MAX_LOCO_SPEED * controller.direction
        cursorDistance = cursorDistance + speed * delta

        // Only extend the path (and so only ever consult junction switch
        // state) when moving into territory beyond anywhere already
        // visited, in *either* direction. Moving back over already-recorded
        // ground just rereads that history — it doesn't undo or re-decide
        // anything.
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
        } else if (cursorDistance < minDistance) {
          const { consumed } = stepPath(backState, minDistance - cursorDistance, trackBuilder.junctions)
          minDistance -= consumed
          cursorDistance = minDistance // same dead-end clamp as the forward case, mirrored
          history.unshift({
            distance: minDistance,
            point: backState.piece.curve.getPointAt(backState.t),
            tangent: backState.piece.curve.getTangentAt(backState.t).multiplyScalar(backState.direction),
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

  function dispose() {
    disposed = true
    cancelAnimationFrame(frameId)
    resizeObserver.disconnect()
    trackBuilder.dispose()
    platformBuilder.dispose()
    stationBuilder.dispose()
    pieceInspector.dispose()
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

  /**
   * Builds a JSON-safe snapshot of the whole current layout — track network, platform sections, and
   * station buildings — ready to send straight to api/layouts/save.php.
   *
   * @returns {{pieces: Object[], junctions: Object[], platforms: Object[], stations: Object[]}}
   */
  function getSnapshot() {
    return buildLayoutSnapshot(pieces, trackBuilder.junctions, platforms, stations)
  }

  /**
   * Replaces the current layout with a saved one and resets the train to its start. Combines
   * trackBuilder.js's own loadLayout (the track/junction half) with the platform and station halves
   * (neither belongs to trackBuilder.js, so both are handled directly here) and resetTrainState above (the
   * train's old pathState/backState/history all refer to piece and junction objects that loadLayout is
   * about to throw away).
   *
   * Station models load asynchronously (see deserializeStations), so unlike the rest of the layout they
   * appear a moment after everything else — the same way the running train's own rolling stock already
   * does at startup (see loadFormation below).
   *
   * @param {Object} data As returned by api/layouts/load.php — `{pieces, junctions, platforms, stations}`.
   * @returns {void}
   */
  function loadLayout(data) {
    trackBuilder.loadLayout(data)
    platforms.forEach((platform) => {
      scene.remove(platform.mesh)
      platform.mesh.geometry.dispose()
    })
    platforms.length = 0
    platforms.push(...deserializePlatforms(data.platforms ?? [], scene))

    stations.forEach((station) => scene.remove(station.group))
    stations.length = 0
    deserializeStations(data.stations ?? [], scene).then((loaded) => {
      if (disposed) return
      stations.push(...loaded)
    })

    resetTrainState()
  }

  return { dispose, trackBuilder, platformBuilder, stationBuilder, loadLayout, getSnapshot }
}
