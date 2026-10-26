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
 * Positions and orients a vehicle at an explicit world point/tangent, facing
 * the tangent direction (or the opposite way, for a unit mounted backwards
 * in the consist, such as a push-pull power car running cab-leading at the
 * rear).
 *
 * @param {THREE.Object3D} vehicle The vehicle's root object.
 * @param {THREE.Vector3} point World position to place it at.
 * @param {THREE.Vector3} tangent Unit direction of travel at that point.
 * @param {boolean} [reversed] True to face the opposite way to the tangent.
 * @returns {void}
 */
export function placeAtPose(vehicle, point, tangent, reversed = false) {
  vehicle.position.copy(point)
  const facing = reversed ? tangent.clone().negate() : tangent
  vehicle.quaternion.setFromUnitVectors(LOCAL_FORWARD, facing)
}
