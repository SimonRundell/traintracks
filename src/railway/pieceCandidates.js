import {
  STRAIGHT_LENGTHS,
  CURVE_RADII,
  CURVE_ANGLE,
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

/**
 * Every piece the drag tool can lay as a plain, switch-free continuation from a free end — every
 * straight length, and every curve radius bending either way. There's no "point" item involved in a
 * plain continuation; those only exist at a genuine fork (see forkCandidates), since a real point is a
 * physical item with two roads, not just a tighter curve.
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
    candidates.push({ label: `curve-${radiusIndex}-left`, road: placeArc(start, tangent, CURVE_RADII[radiusIndex], CURVE_ANGLE, 1) })
    candidates.push({ label: `curve-${radiusIndex}-right`, road: placeArc(start, tangent, CURVE_RADII[radiusIndex], CURVE_ANGLE, -1) })
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
