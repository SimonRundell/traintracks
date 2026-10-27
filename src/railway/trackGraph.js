/**
 * Records a plain, switch-free continuation between two pieces' ends — e.g. one piece laid as a
 * straight extension of another's free end, a drag snapping onto another piece's free end, or two
 * standard catalogue pieces placed end to end while assembling a layout (see standardOval.js). Sets the
 * link on both sides, so pathWalker.js's stepPath can cross the join from either direction.
 *
 * Shared between trackBuilder.js (interactive drag-building) and standardOval.js (static catalogue
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
