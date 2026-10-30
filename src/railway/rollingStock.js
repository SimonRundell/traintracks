import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

/**
 * Which way "nose first" points along a model's own detected length axis (see measureForwardAxis) after
 * the Blender (Z-up, nose facing -Y) to glTF (Y-up) export conversion. This one sign is still a shared
 * assumption across every vehicle — there's no way to tell a model's nose from its tail by measurement
 * alone, only which axis its length runs along — so a model that ends up running backwards (not sideways;
 * see measureForwardAxis for that) still needs this flipped by hand.
 */
const FORWARD_SIGN = -1

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
 * Measures a freshly-loaded model's own length along its detected forward axis (see measureForwardAxis) —
 * for rolling stock whose real-world length isn't known up front (see api/rollingstock/list.php's
 * lengthM, nullable for exactly this reason), so a new wagon model can be added to the catalogue without
 * having to hand-measure it first; its coupling spacing just comes from its own geometry instead.
 *
 * @param {THREE.Object3D} template Loaded glTF scene root, at its native scale and identity transform.
 * @returns {number} Length in metres.
 */
export function measureModelLength(template) {
  const box = new THREE.Box3().setFromObject(template)
  const size = new THREE.Vector3()
  box.getSize(size)
  return Math.max(size.x, size.z)
}

/**
 * Detects which of a model's own local X or Z axis its length runs along, from its bounding box — rather
 * than assuming every vehicle in the catalogue shares one fixed authoring convention (the old approach,
 * which broke the moment a model from a different export pipeline joined ones that happened to match it:
 * place it nose-to-tail along the track as if its length were the OTHER axis, and it renders broadside
 * across the rails on anything but a dead-straight piece — see placeAtPose). The same technique already
 * proven for station buildings (see stationBuilder.js's measureFit), just without the rescale-to-a-target
 * step, since rolling stock is already modelled at real-world scale.
 *
 * @param {THREE.Object3D} template Loaded glTF scene root, at its native scale and identity transform.
 * @returns {THREE.Vector3} Unit vector along the model's own longer horizontal axis, signed by FORWARD_SIGN.
 */
export function measureForwardAxis(template) {
  const box = new THREE.Box3().setFromObject(template)
  const size = new THREE.Vector3()
  box.getSize(size)
  return size.x >= size.z ? new THREE.Vector3(FORWARD_SIGN, 0, 0) : new THREE.Vector3(0, 0, FORWARD_SIGN)
}

/**
 * Positions and orients a vehicle at an explicit world point/tangent, facing the tangent direction (or the
 * opposite way, for a unit mounted backwards in the consist, such as a push-pull power car running
 * cab-leading at the rear).
 *
 * @param {THREE.Object3D} vehicle The vehicle's root object.
 * @param {THREE.Vector3} point World position to place it at.
 * @param {THREE.Vector3} tangent Unit direction of travel at that point.
 * @param {THREE.Vector3} localForward This vehicle's own forward axis — see measureForwardAxis; every
 *   vehicle in a consist can have a different one, measured once when it was loaded.
 * @param {boolean} [reversed] True to face the opposite way to the tangent.
 * @returns {void}
 */
export function placeAtPose(vehicle, point, tangent, localForward, reversed = false) {
  vehicle.position.copy(point)
  const facing = reversed ? tangent.clone().negate() : tangent
  vehicle.quaternion.setFromUnitVectors(localForward, facing)
}
