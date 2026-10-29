import { apiClient } from './client.js'

/**
 * @typedef {Object} AuthUser
 * @property {number} id
 * @property {string} username
 */

/**
 * @param {string} username
 * @param {string} password
 * @param {string} [email]
 * @returns {Promise<AuthUser>} The newly-created, now-logged-in user.
 */
export async function register(username, password, email) {
  const { data } = await apiClient.post('/auth/register.php', { username, password, email })
  return data.user
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<AuthUser>}
 */
export async function login(username, password) {
  const { data } = await apiClient.post('/auth/login.php', { username, password })
  return data.user
}

/**
 * @returns {Promise<void>}
 */
export async function logout() {
  await apiClient.post('/auth/logout.php')
}

/**
 * Checks whether the current session (if any) is still logged in — call on app load, since the PHP
 * session cookie (not any client-side state) is the actual source of truth.
 *
 * @returns {Promise<AuthUser | null>}
 */
export async function fetchCurrentUser() {
  const { data } = await apiClient.get('/auth/me.php')
  return data.user
}
