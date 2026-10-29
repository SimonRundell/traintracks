import { apiClient } from './client.js'

/**
 * @typedef {Object} LayoutSummary
 * @property {number} id
 * @property {string} name
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @returns {Promise<LayoutSummary[]>} The current user's saved layouts, most recently updated first.
 */
export async function listLayouts() {
  const { data } = await apiClient.get('/layouts/list.php')
  return data.layouts
}

/**
 * Saves (or overwrites, if `name` matches an existing layout) the current layout.
 *
 * @param {string} name
 * @param {{pieces: Object[], junctions: Object[]}} snapshot From trackBuilder.js's getSnapshot().
 * @returns {Promise<{id: number, name: string}>}
 */
export async function saveLayout(name, snapshot) {
  const { data } = await apiClient.post('/layouts/save.php', { name, ...snapshot })
  return data.layout
}

/**
 * @param {number} id
 * @returns {Promise<{pieces: Object[], junctions: Object[]}>} Ready to pass to createRailwayScene's loadLayout.
 */
export async function fetchLayout(id) {
  const { data } = await apiClient.get('/layouts/load.php', { params: { id } })
  return data
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteLayout(id) {
  await apiClient.delete('/layouts/delete.php', { params: { id } })
}
