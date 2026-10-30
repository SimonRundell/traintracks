/**
 * @typedef {Object} ConsistUnit
 * @property {string} modelUrl Path to the unit's glTF model.
 * @property {number} length Overall length in metres, used for coupling spacing.
 */

const COUPLING_GAP = 0.35 // metres of visible gap between adjacent vehicle ends

/**
 * Computes how far behind the lead unit's centre each unit's centre sits,
 * measured along the track. This is a fixed, direction-independent spacing:
 * reversing the whole train doesn't re-couple it, it just changes which way
 * the shared curve parameter advances.
 *
 * @param {ConsistUnit[]} formation Train formation, lead unit first — built by the user via the Train
 *   panel (see ConsistPanel.jsx) from the rolling-stock catalogue, rather than a fixed formation.
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
