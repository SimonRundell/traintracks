import * as THREE from 'three'

// This sim models full prototype size everywhere else (1.435m real gauge, ~4m tall locos), not a
// tabletop model. So rather than invent arbitrary piece sizes, every piece here starts from the real,
// published dimensions of the actual Hornby OO Setrack item it corresponds to (mm, as sold) and scales
// them up by the OO ratio to get the equivalent full-size metres this sim already works in. That keeps
// the catalogue's curve radii and lengths proportioned exactly as a real OO layout's would be, just at
// the scale the rest of the sim already runs at.
export const OO_SCALE = 76.2

const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** Degrees-to-metres helper: a real Hornby mm dimension, scaled to this sim's full-size units. */
function fromHornbyMm(mm) {
  return (mm / 1000) * OO_SCALE
}

// Straights (THREE.LineCurve3 is exact — no spline approximation needed for a straight).
export const STRAIGHT_LENGTHS = {
  standard: fromHornbyMm(168), // R600 standard straight
  double: fromHornbyMm(335), // R601 double straight
  long: fromHornbyMm(970), // R621 flexible track, used here as the "long straight"
}

// Single (22.5°) curve radii. 1st-4th radius are Hornby's actual Setrack range; Hornby doesn't sell a
// plain 5th/6th radius curve, so curve-6 continues their own radius progression (each step adds a
// fixed ~68mm of track-centre spacing: 371, 438, 505, 571.5, +68 -> 639.5, +68 -> 707.5), matching the
// commonly cited unofficial 5th/6th radius values modellers use when extending a Setrack layout with
// flexible track.
export const CURVE_RADII = {
  1: fromHornbyMm(371), // R604, 1st radius
  2: fromHornbyMm(438), // R606, 2nd radius
  3: fromHornbyMm(505), // R608, 3rd radius
  4: fromHornbyMm(571.5), // 4th radius
  6: fromHornbyMm(707.5), // extrapolated 6th radius (see above) — no official Hornby code
}
export const CURVE_ANGLE = THREE.MathUtils.degToRad(22.5) // every Setrack single-curve section turns 22.5°

// Points (turnouts). R8072/R8073 left/right-hand standard points: a straight through road the same
// length as a standard straight, plus a diverging road that's a 2nd-radius, 22.5° curve off the toe.
export const POINT_THROUGH_LENGTH = STRAIGHT_LENGTHS.standard
export const POINT_DIVERGE_RADIUS = CURVE_RADII[2]
export const POINT_DIVERGE_ANGLE = CURVE_ANGLE

// Y-point (R8076): no straight road at all — both roads diverge symmetrically, each a broad curve at
// half the standard turnout angle either side of the centreline.
export const Y_POINT_RADIUS = fromHornbyMm(852)
export const Y_POINT_HALF_ANGLE = THREE.MathUtils.degToRad(11.25)

// Diamond crossing (R614/R615): two straight roads of the point-straight's length, crossing through a
// shared centre at the Setrack turnout angle (22.5° total, so ±11.25° off the anchor direction).
export const CROSSING_ROAD_LENGTH = POINT_THROUGH_LENGTH
export const CROSSING_HALF_ANGLE = Y_POINT_HALF_ANGLE

/**
 * @typedef {Object} PlacedRoad
 * @property {THREE.Curve} curve World-space curve, ready for track.js's buildTrackMeshes.
 * @property {THREE.Vector3} endPoint Exact (non-spline-approximated) point where the road finishes.
 * @property {THREE.Vector3} endTangent Exact unit tangent at endPoint, for chaining the next piece.
 */

/**
 * Places a straight road starting at a given point and heading.
 *
 * @param {THREE.Vector3} start World-space start point.
 * @param {THREE.Vector3} tangent Unit heading to travel in.
 * @param {number} length Length in metres.
 * @returns {PlacedRoad} The placed road.
 */
export function placeStraight(start, tangent, length) {
  const endPoint = start.clone().addScaledVector(tangent, length)
  return { curve: new THREE.LineCurve3(start.clone(), endPoint), endPoint, endTangent: tangent.clone() }
}

/**
 * Places a constant-radius arc starting at a given point and heading, turning left (`side` = 1) or
 * right (`side` = -1) through `angle` radians. The returned curve is a dense CatmullRom spline through
 * exactly-computed points (for smooth rendering), but `endPoint`/`endTangent` are exact analytic values
 * — not read back off the spline — so chaining many arcs end to end (e.g. a whole semicircle of them)
 * doesn't accumulate spline-fitting drift.
 *
 * @param {THREE.Vector3} start World-space start point.
 * @param {THREE.Vector3} tangent Unit heading to travel in at the start.
 * @param {number} radius Arc radius in metres.
 * @param {number} angle Total arc angle in radians (always positive — direction comes from `side`).
 * @param {1 | -1} side Which way the arc bends: 1 = left of travel, -1 = right.
 * @returns {PlacedRoad} The placed road.
 */
export function placeArc(start, tangent, radius, angle, side) {
  const leftNormal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
  const center = start.clone().addScaledVector(leftNormal, side * radius)
  const startOffset = start.clone().sub(center)

  const sampleCount = Math.max(8, Math.ceil(THREE.MathUtils.radToDeg(angle) / 2))
  const points = []
  for (let i = 0; i <= sampleCount; i++) {
    const theta = -side * angle * (i / sampleCount)
    points.push(center.clone().add(startOffset.clone().applyAxisAngle(Y_AXIS, theta)))
  }

  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
  const endPoint = points[points.length - 1]
  const endTangent = tangent.clone().applyAxisAngle(Y_AXIS, -side * angle).normalize()
  return { curve, endPoint, endTangent }
}

/**
 * Places a single (22.5°) Setrack curve of the given radius index.
 *
 * @param {THREE.Vector3} start World-space start point.
 * @param {THREE.Vector3} tangent Unit heading to travel in.
 * @param {1 | 2 | 3 | 4 | 6} radiusIndex Which catalogue radius to use — see CURVE_RADII.
 * @param {1 | -1} side Which way the curve bends: 1 = left, -1 = right.
 * @returns {PlacedRoad} The placed road.
 */
export function placeCurve(start, tangent, radiusIndex, side) {
  return placeArc(start, tangent, CURVE_RADII[radiusIndex], CURVE_ANGLE, side)
}

/**
 * Places a left- or right-hand point: a straight through road plus a diverging curved road, sharing a
 * toe (start point and tangent). Neither road is built into meshes here — that, and deciding whether
 * the junction between them is a plain link or a switchable fork, is the caller's job (see
 * trackBuilder.js and standardOval.js).
 *
 * @param {THREE.Vector3} start World-space toe point.
 * @param {THREE.Vector3} tangent Unit heading at the toe.
 * @param {'left' | 'right'} hand Which way the diverging road leaves: left-hand points diverge left, right-hand points diverge right.
 * @returns {{through: PlacedRoad, diverge: PlacedRoad}} The point's two roads.
 */
export function placePoint(start, tangent, hand) {
  const side = hand === 'left' ? 1 : -1
  return {
    through: placeStraight(start, tangent, POINT_THROUGH_LENGTH),
    diverge: placeArc(start, tangent, POINT_DIVERGE_RADIUS, POINT_DIVERGE_ANGLE, side),
  }
}

/**
 * Places a Y-point: two roads diverging symmetrically from a shared toe, neither of them a "straight
 * through" continuation of the toe tangent.
 *
 * @param {THREE.Vector3} start World-space toe point.
 * @param {THREE.Vector3} tangent Unit heading at the toe (the bisector of the two roads, not itself a road).
 * @returns {{left: PlacedRoad, right: PlacedRoad}} The point's two roads.
 */
export function placeYPoint(start, tangent) {
  return {
    left: placeArc(start, tangent, Y_POINT_RADIUS, Y_POINT_HALF_ANGLE, 1),
    right: placeArc(start, tangent, Y_POINT_RADIUS, Y_POINT_HALF_ANGLE, -1),
  }
}

/**
 * Places a fixed diamond crossing: two straight roads of equal length crossing through a shared centre
 * point, symmetric about the anchor direction. Crossings have no moving parts — a train always
 * continues straight across on whichever road it entered on.
 *
 * @param {THREE.Vector3} start World-space entry point of the primary road.
 * @param {THREE.Vector3} tangent Unit heading of the primary road at `start`.
 * @param {'left' | 'right'} hand Which way the secondary road angles away from the primary one.
 * @returns {{primary: PlacedRoad, secondary: PlacedRoad}} The crossing's two roads.
 */
export function placeDiamondCrossing(start, tangent, hand) {
  const side = hand === 'left' ? 1 : -1
  const primary = placeStraight(start, tangent, CROSSING_ROAD_LENGTH)
  const centre = start.clone().addScaledVector(tangent, CROSSING_ROAD_LENGTH / 2)
  const secondaryTangent = tangent.clone().applyAxisAngle(Y_AXIS, side * CROSSING_HALF_ANGLE).normalize()
  const secondaryStart = centre.clone().addScaledVector(secondaryTangent, -CROSSING_ROAD_LENGTH / 2)
  const secondary = placeStraight(secondaryStart, secondaryTangent, CROSSING_ROAD_LENGTH)
  return { primary, secondary }
}
