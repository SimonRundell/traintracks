import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createOvalCenterline } from './ovalPath.js'
import { buildTrack } from './track.js'
import { loadModel, placeOnCurve } from './rollingStock.js'
import { HST_FORMATION, computeCouplingOffsets } from './consist.js'

const MAX_LOCO_SPEED = 16 // metres per second at full throttle
const ISO_VIEW_SIZE = 135
const ISO_CAMERA_DISTANCE = 195

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

  const centerline = createOvalCenterline()
  const curveLength = centerline.getLength()
  const couplingOffsets = computeCouplingOffsets(HST_FORMATION)
  scene.add(buildTrack(centerline))

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
  controls.minZoom = 0.3
  controls.maxZoom = 8
  // Keep the camera at or above track level — no viewing the layout from underground.
  controls.maxPolarAngle = Math.PI / 2
  controls.update()

  let units = null
  let leadT = 0
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

    if (units) {
      const speed = controller.speedFraction * MAX_LOCO_SPEED * controller.direction
      leadT = (((leadT + (speed * delta) / curveLength) % 1) + 1) % 1
      units.forEach((model, i) => {
        const t = (((leadT - couplingOffsets[i] / curveLength) % 1) + 1) % 1
        placeOnCurve(model, centerline, t, HST_FORMATION[i].reversed)
      })
    }

    controls.update()
    renderer.render(scene, camera)
    frameId = requestAnimationFrame(animate)
  }

  return function dispose() {
    disposed = true
    cancelAnimationFrame(frameId)
    resizeObserver.disconnect()
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
