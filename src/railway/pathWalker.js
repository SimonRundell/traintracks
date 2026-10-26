/**
 * @typedef {Object} PathState
 * @property {import('./trackBuilder.js').TrackPiece} piece Piece currently being traversed.
 * @property {number} t Parameter on that piece's curve, in [0, 1].
 * @property {1 | -1} direction Whether t is increasing (+1) or decreasing (-1) as travel continues.
 */

const MAX_STEP_ITERATIONS = 1000 // safety cap against runaway loops if junction data is ever malformed

/**
 * Advances a position along the track graph by a distance, diverting through
 * any junction on the way whose switch is thrown to its alternate route, and
 * stopping (consuming the rest of the distance as a no-op) at a dead end —
 * an open piece's free end with nothing connected there.
 *
 * Mutates the state object in place, so repeated calls can just reuse it
 * frame to frame without reallocating. Also reports how much of the
 * requested distance was actually covered — less than requested means a
 * dead end was hit — so the caller can avoid treating the rest of that
 * distance as if the train had kept moving.
 *
 * @param {PathState} state Current position; mutated in place.
 * @param {number} distance Distance to advance, in metres (always >= 0 — direction is encoded in state.direction).
 * @param {import('./trackBuilder.js').Junction[]} junctions Every junction currently in the network.
 * @returns {{consumed: number}} How much of `distance` was actually covered before stopping.
 */
export function stepPath(state, distance, junctions) {
  let remaining = distance
  let iterations = 0

  while (remaining > 1e-9 && iterations < MAX_STEP_ITERATIONS) {
    iterations++
    const piece = state.piece
    const length = piece.curve.getLength()
    if (length < 1e-6) break

    // Find the nearest event ahead in the direction of travel: a junction on
    // this piece switched to its diverting route, or — for an open piece —
    // its own free end.
    let eventT = piece.closed ? null : state.direction > 0 ? 1 : 0
    let eventJunction = null
    for (const junction of junctions) {
      if (junction.activeIndex !== 1 || junction.hostPiece !== piece) continue
      if (junction.requiredHostDirection !== state.direction) continue // only a fork from one side — see Junction.requiredHostDirection
      const ahead = state.direction > 0 ? junction.hostT > state.t + 1e-9 : junction.hostT < state.t - 1e-9
      if (!ahead) continue
      const closer = eventT === null || (state.direction > 0 ? junction.hostT < eventT : junction.hostT > eventT)
      if (closer) {
        eventT = junction.hostT
        eventJunction = junction
      }
    }

    if (eventT === null) {
      // Closed loop with nothing ahead to divert onto — the rest of the move wraps around freely.
      const deltaT = (remaining * state.direction) / length
      state.t = ((state.t + deltaT) % 1 + 1) % 1
      remaining = 0
      break
    }

    const distanceToEvent = Math.abs(eventT - state.t) * length
    if (remaining <= distanceToEvent) {
      state.t += (remaining * state.direction) / length
      remaining = 0
    } else {
      state.t = eventT
      remaining -= distanceToEvent
      if (eventJunction) {
        state.piece = eventJunction.divertPiece
        state.t = eventJunction.divertT
        state.direction = eventJunction.divertDirection
      } else {
        // Dead end — the rest of this distance genuinely can't be covered,
        // not just "consumed as a no-op". Report that directly rather than
        // claiming the full distance was travelled, so the caller can keep
        // its own notion of distance-travelled in sync with where the train
        // actually is instead of letting it drift ahead of a train that's
        // stopped.
        return { consumed: distance - remaining }
      }
    }
  }

  return { consumed: distance - Math.max(0, remaining) }
}
