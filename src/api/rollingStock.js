import { apiClient } from './client.js'

/**
 * @typedef {Object} RollingStockItem
 * @property {string} key Catalogue key, e.g. "loco-034" — what a consist array is made of.
 * @property {'loco' | 'carriage' | 'wagon'} category
 * @property {string} label Display name shown in the Train panel.
 * @property {string} glbUrl Path to the unit's glTF model.
 * @property {number | null} lengthM Real-world length in metres, or null if it should be measured from the model's own bounding box — see rollingStock.js's measureModelLength.
 */

/**
 * Fetches the global rolling-stock catalogue — every loco, carriage, and wagon available to build a
 * consist from in the Train panel. Not user-specific; the same list for everyone.
 *
 * @returns {Promise<RollingStockItem[]>}
 */
export async function fetchRollingStockCatalogue() {
  const { data } = await apiClient.get('/rollingstock/list.php')
  return data.items
}
