/**
 * @typedef {Object} ConsistUnit
 * @property {string} modelUrl Path to the unit's glTF model.
 * @property {number} length Overall length in metres, used for coupling spacing.
 * @property {boolean} reversed True if the unit is turned end-for-end relative
 *   to the consist's fixed forward direction (e.g. a push-pull power car
 *   running cab-leading at the rear).
 */

const COUPLING_GAP = 0.35 // metres of visible gap between adjacent vehicle ends

/**
 * The HST "InterCity 125" formation: a power car leading, two Mk3 carriages,
 * and a second power car running reversed at the rear, as in real push-pull
 * operation — the same two power cars every time, no turning required.
 *
 * @type {ConsistUnit[]}
 */
export const HST_FORMATION = [
  { modelUrl: '/models/loco-020.glb', length: 17.46, reversed: false },
  { modelUrl: '/models/carriage-020.glb', length: 23.0, reversed: false },
  { modelUrl: '/models/carriage-020.glb', length: 23.0, reversed: false },
  { modelUrl: '/models/loco-020.glb', length: 17.46, reversed: true },
]

/**
 * Computes how far behind the lead unit's centre each unit's centre sits,
 * measured along the track. This is a fixed, direction-independent spacing:
 * reversing the whole train doesn't re-couple it, it just changes which way
 * the shared curve parameter advances.
 *
 * @param {ConsistUnit[]} formation Train formation, lead unit first.
 * @returns {number[]} Distance behind the lead unit's centre, in metres, one per unit.
 */
export function computeCouplingOffsets(formation) {
  const offsets = [0]
  for (let i = 1; i < formation.length; i++) {
    const gap = formation[i - 1].length / 2 + COUPLING_GAP + formation[i].length / 2
    offsets.push(offsets[i - 1] + gap)
  }
  return offsets
}
