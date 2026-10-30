import * as THREE from 'three'
import { STRAIGHT_LENGTHS } from './trackCatalogue.js'

const PLATFORM_HEIGHT = 0.9 // metres above rail — typical UK mainline platform height
const PLATFORM_WIDTH = 4 // metres
const PLATFORM_COLOR = 0x9a948a

// World Y of the platform's walking surface — where anything placed "on" a platform (station buildings,
// see stationBuilder.js) should rest its own base, rather than floating above or clipping into the slab.
export const PLATFORM_TOP_Y = PLATFORM_HEIGHT

// Clear of the 3.8m-wide ballast bed (track.js's BALLAST_TOP_HALF_WIDTH * 2) plus a small walkway gap,
// so the platform edge doesn't visually clip into the ballast. Exported so platformBuilder.js can place a
// section's own centreline this far sideways from whatever track it's snapping to.
export const OFFSET_FROM_TRACK = 1.9 + PLATFORM_WIDTH / 2 + 0.6

// A platform section is one standard-straight-length unit — regardless of which engine/formation is
// configured, so platform length stays a track-catalogue property, not something that silently changes if
// the rolling stock does (as it used to, sized off the HST formation's own length). Build a longer
// platform by placing several sections end to end — see platformBuilder.js, which snaps new sections onto
// an existing one's free end automatically.
export const PLATFORM_SECTION_LENGTH = STRAIGHT_LENGTHS.standard

// A ramp's run — shallow enough to look like a real accessibility slope at this scale (length:height is
// roughly 5:1) without needing to be prototype-accurate, since nothing walks it. Both hands share this.
export const RAMP_LENGTH = 4.5

let material = null

function getMaterial() {
  if (!material) material = new THREE.MeshStandardMaterial({ color: PLATFORM_COLOR, roughness: 0.9, side: THREE.DoubleSide })
  return material
}

/**
 * The world-space length of one platform item, by kind — what chains end-to-end against it need to know to
 * land flush, since a ramp's own run is a different length to a flat section's.
 *
 * @param {'section' | 'ramp-left' | 'ramp-right'} kind
 * @returns {number}
 */
export function platformItemLength(kind) {
  return kind === 'section' ? PLATFORM_SECTION_LENGTH : RAMP_LENGTH
}

/**
 * Builds one platform section: a raised slab of fixed length (PLATFORM_SECTION_LENGTH) running along a
 * given centreline start/tangent. The centreline is assumed already offset sideways from whatever track
 * it sits beside (see OFFSET_FROM_TRACK) — this function just builds the box, placement/snapping is
 * platformBuilder.js's job.
 *
 * @param {THREE.Vector3} start World-space start point of the section's own centreline.
 * @param {THREE.Vector3} tangent Unit heading the section runs along.
 * @returns {THREE.Mesh} The platform section mesh, not yet added to a scene.
 */
export function createPlatformSection(start, tangent) {
  const center = start.clone().addScaledVector(tangent, PLATFORM_SECTION_LENGTH / 2)
  const geometry = new THREE.BoxGeometry(PLATFORM_WIDTH, PLATFORM_HEIGHT, PLATFORM_SECTION_LENGTH)
  const mesh = new THREE.Mesh(geometry, getMaterial())
  mesh.position.set(center.x, PLATFORM_HEIGHT / 2, center.z)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent)
  return mesh
}

/**
 * Builds the six unique corners of a ramp wedge in its own local space — width along X, height along Y,
 * run along Z centred on 0 — then returns them in the fixed order every face below indexes into. "right"
 * puts the tall (platform-height) end at -Z and the low (ground-height) end at +Z; "left" is the mirror
 * image, tall end at +Z — see createPlatformRamp.
 *
 * @param {'left' | 'right'} hand
 * @returns {THREE.Vector3[]} [lowLeft, lowRight, tallBaseRight, tallBaseLeft, tallTopLeft, tallTopRight]
 */
function rampCorners(hand) {
  const halfW = PLATFORM_WIDTH / 2
  const halfL = RAMP_LENGTH / 2
  const tallZ = hand === 'right' ? -halfL : halfL
  const lowZ = hand === 'right' ? halfL : -halfL
  return [
    new THREE.Vector3(-halfW, 0, lowZ),
    new THREE.Vector3(halfW, 0, lowZ),
    new THREE.Vector3(halfW, 0, tallZ),
    new THREE.Vector3(-halfW, 0, tallZ),
    new THREE.Vector3(-halfW, PLATFORM_HEIGHT, tallZ),
    new THREE.Vector3(halfW, PLATFORM_HEIGHT, tallZ),
  ]
}

/**
 * Builds one platform end ramp: a wedge sloping from platform height down to ground level over RAMP_LENGTH,
 * for capping the open end of a platform so passengers (and the eye) aren't left with a sheer drop. "left"
 * and "right" are mirror images — which one looks correct depends on which end of a platform run it's
 * capping, same as the two physical mouldings in a real model-railway ramp set; there's no way to infer that
 * automatically, so the drawer offers both and the user picks (see platformBuilder.js).
 *
 * @param {THREE.Vector3} start World-space start point of the ramp's own centreline (its tall end for
 *   'right', its low end for 'left' — see rampCorners).
 * @param {THREE.Vector3} tangent Unit heading the ramp runs along.
 * @param {'left' | 'right'} hand
 * @returns {THREE.Mesh}
 */
export function createPlatformRamp(start, tangent, hand) {
  const [low0, low1, tallBase1, tallBase0, tallTop0, tallTop1] = rampCorners(hand)
  const positions = new Float32Array(
    [
      [low0, low1, tallBase1], // bottom
      [low0, tallBase1, tallBase0],
      [tallBase0, tallBase1, tallTop1], // riser (tall end face)
      [tallBase0, tallTop1, tallTop0],
      [tallTop0, tallTop1, low1], // sloped top
      [tallTop0, low1, low0],
      [low0, tallBase0, tallTop0], // triangular side at -X
      [low1, tallTop1, tallBase1], // triangular side at +X
    ].flatMap((triangle) => triangle.flatMap((v) => [v.x, v.y, v.z])),
  )
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()

  const center = start.clone().addScaledVector(tangent, RAMP_LENGTH / 2)
  const mesh = new THREE.Mesh(geometry, getMaterial())
  mesh.position.set(center.x, 0, center.z)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent)
  return mesh
}

/**
 * Builds whichever platform item mesh `kind` names — the shared dispatcher platformBuilder.js and
 * layoutSerializer.js both build from, so adding a new platform item kind only means teaching this
 * function about it, not every caller.
 *
 * @param {'section' | 'ramp-left' | 'ramp-right'} kind
 * @param {THREE.Vector3} start
 * @param {THREE.Vector3} tangent
 * @returns {THREE.Mesh}
 */
export function createPlatformMesh(kind, start, tangent) {
  if (kind === 'ramp-left') return createPlatformRamp(start, tangent, 'left')
  if (kind === 'ramp-right') return createPlatformRamp(start, tangent, 'right')
  return createPlatformSection(start, tangent)
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
