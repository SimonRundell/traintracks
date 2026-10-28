import * as THREE from 'three'

const PLATFORM_HEIGHT = 0.9 // metres above rail — typical UK mainline platform height
const PLATFORM_WIDTH = 4 // metres
const PLATFORM_COLOR = 0x9a948a
// Clear of the 3.8m-wide ballast bed (track.js's BALLAST_TOP_HALF_WIDTH * 2) plus a small walkway gap,
// so the platform edge doesn't visually clip into the ballast.
const OFFSET_FROM_TRACK = 1.9 + PLATFORM_WIDTH / 2 + 0.6

let material = null

function getMaterial() {
  if (!material) material = new THREE.MeshStandardMaterial({ color: PLATFORM_COLOR, roughness: 0.9 })
  return material
}

/**
 * Builds a simple platform alongside a straight length of track — a raised slab offset sideways from
 * the centreline, spanning the curve's full length. Only valid for a straight curve (uses the midpoint
 * tangent for the whole slab's orientation), which is all a station's platform road ever is.
 *
 * @param {THREE.Curve} curve The platform road's centreline.
 * @param {1 | -1} side Which side of the track to place the platform on.
 * @returns {THREE.Mesh} The platform mesh, not yet added to a scene.
 */
export function createPlatform(curve, side) {
  const length = curve.getLength()
  const mid = curve.getPointAt(0.5)
  const tangent = curve.getTangentAt(0.5)
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(side)
  const center = mid.clone().addScaledVector(normal, OFFSET_FROM_TRACK)

  const geometry = new THREE.BoxGeometry(PLATFORM_WIDTH, PLATFORM_HEIGHT, length)
  const mesh = new THREE.Mesh(geometry, getMaterial())
  mesh.position.set(center.x, PLATFORM_HEIGHT / 2, center.z)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent)
  return mesh
}

/**
 * Frees the shared platform material. Only safe once nothing will create another platform afterwards.
 *
 * @returns {void}
 */
export function disposeSharedPlatformMaterial() {
  material?.dispose()
  material = null
}
