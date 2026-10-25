import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

/**
 * The models' local forward axis after the Blender (Z-up, nose facing -Y)
 * to glTF (Y-up) export conversion. Flip to -1 if a loaded model runs
 * backwards along the track. Shared by every vehicle in TrainAssets, since
 * they're all authored with length along Blender Y.
 */
const FORWARD_SIGN = -1
const LOCAL_FORWARD = new THREE.Vector3(0, 0, FORWARD_SIGN)

/**
 * Loads a rolling stock glTF model (locomotive or carriage).
 *
 * @param {string} url Path to the .glb file, relative to the public root.
 * @returns {Promise<THREE.Object3D>} The loaded scene root, ready to add to a THREE.Scene.
 */
export function loadModel(url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      reject,
    )
  })
}

/**
 * Positions and orients a vehicle so it sits on the track at curve parameter
 * t, facing the direction of travel (or the opposite way, for a unit
 * mounted backwards in the consist, such as a push-pull power car running
 * cab-leading at the rear).
 *
 * @param {THREE.Object3D} vehicle The vehicle's root object.
 * @param {THREE.CatmullRomCurve3} curve Closed centreline curve.
 * @param {number} t Curve parameter in [0, 1).
 * @param {boolean} [reversed] True to face the opposite way to the curve's tangent direction.
 * @returns {void}
 */
export function placeOnCurve(vehicle, curve, t, reversed = false) {
  const point = curve.getPointAt(t)
  const tangent = curve.getTangentAt(t)
  if (reversed) tangent.negate()
  vehicle.position.copy(point)
  vehicle.quaternion.setFromUnitVectors(LOCAL_FORWARD, tangent)
}
