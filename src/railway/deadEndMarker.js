import * as THREE from 'three'

const MARKER_HEIGHT = 3.2 // metres above rail — low enough to read as sitting on the track, distinct from the taller junction arrows
const MARKER_RADIUS = 0.6
const MARKER_COLOR = 0xef4444 // warning red — unmistakably different from the amber/grey junction arrow palette

let material = null

/**
 * Lazily creates (and caches) the shared marker material.
 *
 * @returns {THREE.Material} Shared material.
 */
function getMaterial() {
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color: MARKER_COLOR, emissive: MARKER_COLOR, emissiveIntensity: 0.6, roughness: 0.5 })
  }
  return material
}

/**
 * Builds a small floating marker flagging a track end that doesn't connect to anything — either a
 * deliberate dead end (a siding, say) or a rejoin that didn't actually line up. Purely informational, no
 * pick target of its own; trackBuilder.js adds/removes these directly as TrackPiece.links changes, so a
 * piece's connectivity is visible at a glance the moment it's laid, not just discovered later by driving
 * into it.
 *
 * @param {THREE.Vector3} position World point to float above.
 * @returns {THREE.Mesh} The marker mesh, not yet added to a scene.
 */
export function createDeadEndMarker(position) {
  const geometry = new THREE.SphereGeometry(MARKER_RADIUS, 12, 10)
  const mesh = new THREE.Mesh(geometry, getMaterial())
  mesh.position.set(position.x, position.y + MARKER_HEIGHT, position.z)
  return mesh
}

/**
 * Frees the shared marker material. Only safe once nothing will create another marker afterwards (e.g.
 * on full scene teardown).
 *
 * @returns {void}
 */
export function disposeSharedDeadEndMaterial() {
  material?.dispose()
  material = null
}
