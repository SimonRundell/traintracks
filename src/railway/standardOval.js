import * as THREE from 'three'
import { buildTrackMeshes } from './track.js'
import { placeStraight, placeCurve, STRAIGHT_LENGTHS } from './trackCatalogue.js'
import { linkPieceEnds } from './trackGraph.js'

const LOOP_RADIUS_INDEX = 3 // 3rd-radius Setrack curve (see trackCatalogue.js) for both end loops
const LOOP_CURVE_COUNT = 8 // eight 22.5 degree curves per end = one 180 degree semicircle
const SIDE_STRAIGHT_COUNT = 1 // long straights making up each side between the two loop ends

/**
 * Builds the starter oval as a chain of real Setrack-catalogue pieces — long straights down each side,
 * and two semicircular ends built from eight 3rd-radius 22.5° curves apiece — instead of one hand-fit
 * ellipse. Both ends turn the same way so the chain closes back into a loop.
 *
 * Every join between consecutive pieces is a plain link (see TrackPiece.links in trackBuilder.js):
 * a run of plain straights and curves is just contiguous track, not a decision, so none of these joins
 * get a switch arrow — the same plain-link mechanism that lets a freehand drag extend an existing piece
 * in LAY mode.
 *
 * @param {THREE.Scene} scene Scene to add every piece's meshes to.
 * @returns {{pieces: import('./trackBuilder.js').TrackPiece[]}} The oval's pieces, in lap order, already linked into a closed loop.
 */
export function buildStandardOval(scene) {
  const pieces = []
  let nextId = 0
  let point = new THREE.Vector3(0, 0, 0)
  let tangent = new THREE.Vector3(1, 0, 0)

  function addPiece(placed) {
    const { group, pickMesh } = buildTrackMeshes(placed.curve, { closed: false })
    scene.add(group)
    const piece = {
      id: nextId++,
      curve: placed.curve,
      closed: false,
      group,
      pickMesh,
      junctions: [],
      links: { start: null, end: null },
    }
    if (pieces.length > 0) linkPieceEnds(pieces[pieces.length - 1], 1, piece, 0)
    pieces.push(piece)
    point = placed.endPoint
    tangent = placed.endTangent
  }

  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < SIDE_STRAIGHT_COUNT; i++) {
      addPiece(placeStraight(point, tangent, STRAIGHT_LENGTHS.long))
    }
    for (let i = 0; i < LOOP_CURVE_COUNT; i++) {
      addPiece(placeCurve(point, tangent, LOOP_RADIUS_INDEX, 1))
    }
  }

  linkPieceEnds(pieces[pieces.length - 1], 1, pieces[0], 0)
  return { pieces }
}
