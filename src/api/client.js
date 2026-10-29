import axios from 'axios'
import config from '../../.config.json'

/**
 * Shared axios instance for the PHP API. `withCredentials` is required so the PHP session cookie
 * (carrying login state) crosses from Vite's dev port to Apache's — see api/cors.php for the matching
 * server-side CORS/cookie setup.
 */
export const apiClient = axios.create({
  baseURL: config.apiBaseUrl,
  withCredentials: true,
})
