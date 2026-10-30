import {
  STRAIGHT_LENGTHS,
  CURVE_RADII,
  CURVE_ANGLES,
  POINT_DIVERGE_RADIUS,
  POINT_DIVERGE_ANGLE,
  Y_POINT_RADIUS,
  Y_POINT_HALF_ANGLE,
  placeStraight,
  placeArc,
} from './trackCatalogue.js'

/**
 * @typedef {Object} PieceCandidate
 * @property {string} label Identifies which catalogue item this is — for debugging only, not read by any logic.
 * @property {import('./trackCatalogue.js').PlacedRoad} road The placed geometry.
 */

// The standard variant's key/label carry no extra infix (`curve-3-left`, "Curve 3 (left)"), to match the
// keys already saved in people's layouts from before half/double curves existed — only half and double
// get one (`curve-3-half-left`, "Curve 3 Half (left)").
const CURVE_LENGTH_VARIANTS = [
  { keyInfix: '', labelInfix: '', angle: CURVE_ANGLES.standard },
  { keyInfix: '-half', labelInfix: 'Half ', angle: CURVE_ANGLES.half },
  { keyInfix: '-double', labelInfix: 'Double ', angle: CURVE_ANGLES.double },
]

/**
 * Every piece the drag tool can lay as a plain, switch-free continuation from a free end — every
 * straight length, and every curve radius/length-variant bending either way. There's no "point" item
 * involved in a plain continuation; those only exist at a genuine fork (see forkCandidates), since a real
 * point is a physical item with two roads, not just a tighter curve.
 *
 * @param {THREE.Vector3} start World-space start point.
 * @param {THREE.Vector3} tangent Unit heading to build away from.
 * @returns {PieceCandidate[]} Candidates, unordered.
 */
export function freeCandidates(start, tangent) {
  const candidates = []
  for (const [name, length] of Object.entries(STRAIGHT_LENGTHS)) {
    candidates.push({ label: `straight-${name}`, road: placeStraight(start, tangent, length) })
  }
  for (const radiusIndex of Object.keys(CURVE_RADII)) {
    for (const variant of CURVE_LENGTH_VARIANTS) {
      candidates.push({ label: `curve-${radiusIndex}${variant.keyInfix}-left`, road: placeArc(start, tangent, CURVE_RADII[radiusIndex], variant.angle, 1) })
      candidates.push({ label: `curve-${radiusIndex}${variant.keyInfix}-right`, road: placeArc(start, tangent, CURVE_RADII[radiusIndex], variant.angle, -1) })
    }
  }
  return candidates
}

/**
 * Every piece the drag tool can lay as the diverging road of a fork. Real turnouts only come in two
 * fixed geometries — a standard point's 22.5° diverge, or one leg of a symmetric Y-point's 11.25° diverge
 * — never an arbitrary radius, so (unlike freeCandidates) this list is always exactly these four, with no
 * "straight on" option: continuing straight through a fork needs no new piece at all, since the host
 * piece already does that on its own (see trackBuilder.js's isAtFreeEnd / plain links).
 *
 * @param {THREE.Vector3} start World-space toe point.
 * @param {THREE.Vector3} tangent Unit heading at the toe.
 * @returns {PieceCandidate[]} Exactly four candidates: point-left, point-right, y-left, y-right.
 */
export function forkCandidates(start, tangent) {
  return [
    { label: 'point-left', road: placeArc(start, tangent, POINT_DIVERGE_RADIUS, POINT_DIVERGE_ANGLE, 1) },
    { label: 'point-right', road: placeArc(start, tangent, POINT_DIVERGE_RADIUS, POINT_DIVERGE_ANGLE, -1) },
    { label: 'y-left', road: placeArc(start, tangent, Y_POINT_RADIUS, Y_POINT_HALF_ANGLE, 1) },
    { label: 'y-right', road: placeArc(start, tangent, Y_POINT_RADIUS, Y_POINT_HALF_ANGLE, -1) },
  ]
}

/**
 * @typedef {Object} FreeMenuItem
 * @property {string} key Matches a freeCandidates() label exactly — pass straight to trackBuilder.js's
 *   appendPiece.
 * @property {string} label Human-readable name for a drawer button.
 */

/**
 * Lists every catalogue item the drawer can offer for a plain, free-end continuation — the same set
 * freeCandidates() can build, but without needing a start point/tangent, since the drawer only needs to
 * list what's available, not place anything yet.
 *
 * @returns {FreeMenuItem[]}
 */
export function freeCandidateMenu() {
  const items = []
  for (const name of Object.keys(STRAIGHT_LENGTHS)) {
    items.push({ key: `straight-${name}`, label: `Straight (${name})` })
  }
  for (const radiusIndex of Object.keys(CURVE_RADII)) {
    for (const variant of CURVE_LENGTH_VARIANTS) {
      items.push({ key: `curve-${radiusIndex}${variant.keyInfix}-left`, label: `Curve ${radiusIndex} ${variant.labelInfix}(left)` })
      items.push({ key: `curve-${radiusIndex}${variant.keyInfix}-right`, label: `Curve ${radiusIndex} ${variant.labelInfix}(right)` })
    }
  }
  return items
}

/**
 * Lists every catalogue item the drawer can offer for a fork's diverging road — the same four
 * forkCandidates() can build, but without needing a toe point/tangent.
 *
 * @returns {FreeMenuItem[]}
 */
export function forkCandidateMenu() {
  return [
    { key: 'point-left', label: 'Point (left)' },
    { key: 'point-right', label: 'Point (right)' },
    { key: 'y-left', label: 'Y-point (left)' },
    { key: 'y-right', label: 'Y-point (right)' },
  ]
}

/**
 * Picks whichever candidate's endpoint lands closest to a live target point — the core of "drag toward
 * where you want to go and the nearest real piece snaps into place".
 *
 * @param {PieceCandidate[]} candidates Non-empty candidate list.
 * @param {THREE.Vector3} target Live cursor ground position.
 * @returns {PieceCandidate} The closest-matching candidate.
 */
export function closestCandidate(candidates, target) {
  let best = candidates[0]
  let bestDistSq = best.road.endPoint.distanceToSquared(target)
  for (let i = 1; i < candidates.length; i++) {
    const distSq = candidates[i].road.endPoint.distanceToSquared(target)
    if (distSq < bestDistSq) {
      best = candidates[i]
      bestDistSq = distSq
    }
  }
  return best
}
