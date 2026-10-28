/**
 * Records a plain, switch-free continuation between two pieces' ends — e.g. one piece laid as a
 * straight extension of another's free end, a drag snapping onto another piece's free end, or two
 * standard catalogue pieces placed end to end while assembling a layout (see defaultLayout.js). Sets the
 * link on both sides, so pathWalker.js's stepPath can cross the join from either direction.
 *
 * Shared between trackBuilder.js (interactive drag-building) and defaultLayout.js (static catalogue
 * assembly) so both wire up TrackPiece.links the same way.
 *
 * @param {import('./trackBuilder.js').TrackPiece} pieceA First piece.
 * @param {number} tA Parameter on pieceA where the join sits — must be (near) 0 or 1.
 * @param {import('./trackBuilder.js').TrackPiece} pieceB Second piece.
 * @param {number} tB Parameter on pieceB where the join sits — must be (near) 0 or 1.
 * @returns {void}
 */
export function linkPieceEnds(pieceA, tA, pieceB, tB) {
  const endA = tA <= 0.5 ? 'start' : 'end'
  const endB = tB <= 0.5 ? 'start' : 'end'
  pieceA.links[endA] = { piece: pieceB, end: endB }
  pieceB.links[endB] = { piece: pieceA, end: endA }
}

import * as THREE from 'three'
import { createJunctionArrow, placeJunctionArrow } from './junctionArrow.js'

// A junction's two routes start out coincident (or nearly so) right at the fork, so an arrow placed
// there sits on top of both tracks at once with no way to tell which one is which. These constants
// control how far out along each route to look instead: far enough that the routes' ballast beds
// (each BALLAST_TOP_HALF_WIDTH * 2 wide in track.js, currently 3.8m) have visibly separated.
const PARTING_SEPARATION = 4.2 // metres between the two routes' centrelines, with a small margin over the 3.8m ballast width so a gap is visible between them
const PARTING_SEARCH_STEP = 0.5 // metres per probe while searching for where the routes part
const PARTING_SEARCH_MAX = 24 // metres — give up and use the furthest point tried if a very shallow fork never reaches full separation this close in

/**
 * Clamps (or wraps, for a closed curve) a curve parameter into [0, 1].
 *
 * @param {number} t Parameter to normalise.
 * @param {boolean} closed True if the curve loops back on itself.
 * @returns {number} Valid parameter for getPointAt/getTangentAt.
 */
export function clampParam(t, closed) {
  return closed ? ((t % 1) + 1) % 1 : Math.min(1, Math.max(0, t))
}

/**
 * Finds the point a given arc-length distance along a curve from a reference parameter (forward for a
 * positive offset, backward for a negative one).
 *
 * @param {THREE.Curve} curve Curve to sample.
 * @param {number} t Reference parameter in [0, 1].
 * @param {number} arcOffset Signed distance in metres to step along the curve.
 * @param {boolean} closed True if the curve loops back on itself.
 * @returns {THREE.Vector3} The sampled point.
 */
export function pointAtArcOffset(curve, t, arcOffset, closed) {
  const length = curve.getLength()
  const deltaT = length > 1e-6 ? arcOffset / length : 0
  return curve.getPointAt(clampParam(t + deltaT, closed))
}

/**
 * Finds the direction from a point on a curve toward another point a fixed arc-length distance further
 * along it. Used so a switch arrow points toward where a route actually goes, not just the instantaneous
 * tangent at the switch itself — two routes that leave a junction tangent to each other still read as
 * distinct directions once sampled far enough out.
 *
 * @param {THREE.Curve} curve Curve to sample.
 * @param {number} t Reference parameter in [0, 1].
 * @param {number} arcOffset Signed distance in metres to step along the curve.
 * @param {boolean} closed True if the curve loops back on itself.
 * @returns {THREE.Vector3} Unit direction from the reference point toward the sampled point.
 */
export function sampleDirectionAlong(curve, t, arcOffset, closed) {
  const p1 = curve.getPointAt(clampParam(t, closed))
  const p2 = pointAtArcOffset(curve, t, arcOffset, closed)
  const direction = new THREE.Vector3().subVectors(p2, p1)
  return direction.lengthSq() < 1e-8 ? curve.getTangentAt(clampParam(t, closed)).clone() : direction.normalize()
}

/**
 * Finds how far out along two routes leaving the same junction they have to run before their
 * centrelines are far enough apart to read as two separate tracks rather than one lying on top of the
 * other (see PARTING_SEPARATION). Used to place a junction's arrow — and sample the directions it points
 * in — beyond the fork, where it's unambiguous which track is which.
 *
 * @param {THREE.Curve} curveA First route's curve.
 * @param {number} tA Parameter on curveA where the junction sits.
 * @param {boolean} closedA True if curveA loops back on itself.
 * @param {1 | -1} signA Direction of travel away from the junction on curveA.
 * @param {THREE.Curve} curveB Second route's curve.
 * @param {number} tB Parameter on curveB where the junction sits.
 * @param {boolean} closedB True if curveB loops back on itself.
 * @param {1 | -1} signB Direction of travel away from the junction on curveB.
 * @returns {number} Arc-length distance in metres along each route to sample from.
 */
export function findPartingOffset(curveA, tA, closedA, signA, curveB, tB, closedB, signB) {
  for (let offset = PARTING_SEARCH_STEP; offset <= PARTING_SEARCH_MAX; offset += PARTING_SEARCH_STEP) {
    const pointA = pointAtArcOffset(curveA, tA, signA * offset, closedA)
    const pointB = pointAtArcOffset(curveB, tB, signB * offset, closedB)
    if (pointA.distanceTo(pointB) >= PARTING_SEPARATION) return offset
  }
  return PARTING_SEARCH_MAX
}

/**
 * Builds a complete Junction — arrow created, placed, and added to the scene — at the point where
 * hostPiece continues on its own (index 0) or diverts onto divertPiece (index 1). Shared between
 * trackBuilder.js (interactive forks) and defaultLayout.js (static passing loops), so a pre-built
 * layout's switches behave and look identical to ones the user lays by hand.
 *
 * @param {number} id Unique junction id (caller owns the counter).
 * @param {THREE.Scene} scene Scene to add the arrow to.
 * @param {import('./trackBuilder.js').TrackPiece} hostPiece Piece a train passes straight through on when this switch is at index 0.
 * @param {number} hostT Parameter on hostPiece where the switch sits.
 * @param {import('./trackBuilder.js').TrackPiece} divertPiece Piece a train is sent onto when this switch is thrown to index 1.
 * @param {number} divertT Parameter on divertPiece to continue from.
 * @param {1 | -1} divertDirection Direction of travel to continue in on divertPiece.
 * @returns {import('./trackBuilder.js').Junction} The new junction.
 */
export function buildJunction(id, scene, hostPiece, hostT, divertPiece, divertT, divertDirection) {
  const { group, pickMesh, routes } = createJunctionArrow()
  scene.add(group)

  const offset = findPartingOffset(hostPiece.curve, hostT, hostPiece.closed, 1, divertPiece.curve, divertT, false, divertDirection)
  const hostPoint = pointAtArcOffset(hostPiece.curve, hostT, offset, hostPiece.closed)
  const divertPoint = pointAtArcOffset(divertPiece.curve, divertT, offset * divertDirection, false)
  const position = hostPoint.clone().lerp(divertPoint, 0.5)
  const directions = [
    sampleDirectionAlong(hostPiece.curve, hostT, offset, hostPiece.closed),
    sampleDirectionAlong(divertPiece.curve, divertT, offset * divertDirection, false),
  ]

  // Velocity continuity at the transition requires hostTangent * hostDirection to equal divertTangent *
  // divertDirection (both are unit vectors, so they must be exactly parallel or exactly opposite — true
  // by construction for both callers). Solving for hostDirection gives the one host travel direction
  // this switch is actually a fork for; from the other direction, "diverting" would require an instant
  // reversal, so it must never be offered as an event at all.
  const hostTangent = hostPiece.curve.getTangentAt(hostT)
  const divertTangentAtEntry = divertPiece.curve.getTangentAt(divertT)
  const alignment = hostTangent.dot(divertTangentAtEntry) >= 0 ? 1 : -1
  const requiredHostDirection = divertDirection * alignment

  const junction = {
    id,
    position,
    directions,
    activeIndex: 0,
    group,
    pickMesh,
    routes,
    hostPiece,
    hostT,
    requiredHostDirection,
    divertPiece,
    divertT,
    divertDirection,
  }
  placeJunctionArrow(junction)
  return junction
}
