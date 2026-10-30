import * as THREE from 'three'
import { buildTrackMeshes } from './track.js'
import { placeStraight, placeArc, placeCurve, STRAIGHT_LENGTHS, POINT_DIVERGE_RADIUS, POINT_DIVERGE_ANGLE } from './trackCatalogue.js'
import { linkPieceEnds, buildJunction } from './trackGraph.js'
import { HST_FORMATION, computeCouplingOffsets } from './consist.js'

const LOOP_RADIUS_INDEX = 3 // 3rd-radius Setrack curve for both end loops
const LOOP_CURVE_COUNT = 8 // eight 22.5 degree curves per end = one 180 degree semicircle
// A real passing-loop plan (the reference this layout is built from) keeps its straight sections roughly
// in proportion with the curved ends either side of it, not many times longer — these are deliberately
// modest, standard-length pieces rather than the oversized ones the first attempt used.
const LEAD_LENGTH = STRAIGHT_LENGTHS.standard // plain track before/after each station's own clear run

// The station's own clear run and the siding both need to hold the whole HST formation with room to
// spare, not just a token catalogue straight — a 25m "double straight" is shorter than even one power car
// plus a coach, so the train would overhang both points no matter where it stopped, and platforms the
// user places later (see platformBuilder.js) wouldn't have anywhere long enough to go. Derived from the
// real formation length (nose to tail) rather than hand-picked, so it stays correct if the formation ever
// changes.
const HST_LENGTH = (() => {
  const offsets = computeCouplingOffsets(HST_FORMATION)
  const last = HST_FORMATION.length - 1
  return offsets[last] + HST_FORMATION[0].length / 2 + HST_FORMATION[last].length / 2
})()
const STATION_SPAN = HST_LENGTH * 1.3 // clear run each station gets — 30% margin over the train
const SIDING_LENGTH = HST_LENGTH * 1.3 // siding stub length — same margin, so the whole train can be stabled clear of the running line

/**
 * Builds the default starter layout: an oval of the same construction as the old plain starter loop
 * (long straights, 180° semicircle ends built from eight 22.5° curves apiece), with a long clear run on
 * each side (matching the reference plan, where the "passing loops" are the oval's own two straights) and,
 * on one side, a facing siding point feeding a dead-end stub off the main line. No platforms or station
 * buildings are placed — those are user-placed assets now (see platformBuilder.js) — so the app opens with
 * a plain oval that already has room for them, not a loop with no clear straight anywhere.
 *
 * @param {THREE.Scene} scene Scene to add every piece's meshes and junction arrows to.
 * @returns {{pieces: import('./trackBuilder.js').TrackPiece[], junctions: import('./trackBuilder.js').Junction[]}} The layout's pieces (in lap order) and junctions, ready for the train and the interactive track builder to share.
 */
export function buildDefaultLayout(scene) {
  const pieces = []
  const junctions = []
  let nextPieceId = 0
  let nextJunctionId = 1

  /**
   * Builds and adds one piece's meshes, chaining it onto `after` (a plain link) if given, or onto
   * whatever was added most recently if not — unless `standalone` is set, for a point's diverge road,
   * which starts a new branch linked in via a junction instead (wired up separately by the caller).
   *
   * The explicit `after` only matters when the most-recently-pushed piece *isn't* the one this new piece
   * should actually continue from — e.g. the first semicircle curve after a station that ended with a
   * siding: the siding's own stub was pushed last, but the curve needs to continue the station's through
   * road, not the siding.
   */
  function addPiece(placed, { standalone = false, after, type = 'straight' } = {}) {
    const { group, pickMesh } = buildTrackMeshes(placed.curve, { closed: false })
    scene.add(group)
    const piece = {
      id: nextPieceId++,
      curve: placed.curve,
      closed: false,
      group,
      pickMesh,
      links: { start: null, end: null },
      markers: { start: null, end: null },
      type, // catalogue item this piece represents, e.g. "curve-3-left" — see pieceCandidates.js's matching labels; shown in the piece inspector's hover label
    }
    const previous = after ?? pieces[pieces.length - 1]
    if (!standalone && previous) linkPieceEnds(previous, 1, piece, 0)
    pieces.push(piece)
    return piece
  }

  /**
   * One station section — a plain through road with a long clear run down its middle (room for the user
   * to drop platform sections alongside later — see platformBuilder.js), plus, on the side that wants
   * one, a facing siding point feeding a dead-end stub off that same through road.
   *
   * @param {THREE.Vector3} start Where the section's through road begins.
   * @param {THREE.Vector3} tangent Unit heading at `start`.
   * @param {1 | -1} sidingSide Which side the siding (if present) forks off to.
   * @param {boolean} withSiding Whether to also add a siding off this section's through road.
   * @returns {{endPoint: THREE.Vector3, endTangent: THREE.Vector3, throughPiece: import('./trackBuilder.js').TrackPiece}} Where the through road finishes, and the through piece itself — pass both to addSemicircle so it chains onto the through road, not whatever this section added last internally (its siding stub, if it has one).
   */
  function addStation(start, tangent, sidingSide, withSiding) {
    // Both stations' through roads must be the same length regardless of whether one carries a siding —
    // the oval only closes if its two straight sides are equal (a siding is a branch off the side, it
    // doesn't need to lengthen the main line it forks from). See addSemicircle's fix for the matching
    // heading-drift bug; this is the position half of the same "does it actually close" problem.
    const throughLength = LEAD_LENGTH + STATION_SPAN + LEAD_LENGTH
    const through = addPiece(placeStraight(start, tangent, throughLength))

    if (withSiding) {
      const hostT = (LEAD_LENGTH + STATION_SPAN + LEAD_LENGTH / 2) / throughLength
      const p = through.curve.getPointAt(hostT)
      const sidingPoint = placeArc(p, tangent, POINT_DIVERGE_RADIUS, POINT_DIVERGE_ANGLE, -sidingSide)
      const sidingArcPiece = addPiece(sidingPoint, { standalone: true, type: -sidingSide === 1 ? 'point-left' : 'point-right' })
      addPiece(placeStraight(sidingPoint.endPoint, sidingPoint.endTangent, SIDING_LENGTH))
      junctions.push(buildJunction(nextJunctionId++, scene, through, hostT, sidingArcPiece, 0, 1))
    }

    return { endPoint: through.curve.getPointAt(1), endTangent: through.curve.getTangentAt(1), throughPiece: through }
  }

  function addSemicircle(point, tangent, after, radiusIndex = LOOP_RADIUS_INDEX) {
    for (let i = 0; i < LOOP_CURVE_COUNT; i++) {
      const placed = placeCurve(point, tangent, radiusIndex, 1)
      const options = { type: `curve-${radiusIndex}-left`, ...(i === 0 ? { after } : null) }
      addPiece(placed, options)
      // Chain from placeArc's exact analytic endPoint/endTangent, not the rendered piece's spline
      // (CatmullRomCurve3.getPointAt/getTangentAt, which is only an arc-length approximation) — reading
      // the spline back here was accumulating approximation error over all 8 chained curves into a real,
      // visible drift by the end of the semicircle (previously ~15 degrees and an 18m closing gap).
      point = placed.endPoint
      tangent = placed.endTangent
    }
    return { endPoint: point, endTangent: tangent }
  }

  let point = new THREE.Vector3(0, 0, 0)
  let tangent = new THREE.Vector3(1, 0, 0)
  let station = addStation(point, tangent, 1, true) // side 1: station with a siding
  ;({ endPoint: point, endTangent: tangent } = addSemicircle(station.endPoint, station.endTangent, station.throughPiece))
  station = addStation(point, tangent, 1, false) // side 2: station only
  ;({ endPoint: point, endTangent: tangent } = addSemicircle(station.endPoint, station.endTangent, station.throughPiece))

  linkPieceEnds(pieces[pieces.length - 1], 1, pieces[0], 0)

  return { pieces, junctions }
}
