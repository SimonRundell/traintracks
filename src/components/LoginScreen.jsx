import { useState } from 'react'
import { login, register } from '../api/auth.js'

/**
 * Full-page login/register gate shown before any part of the railway app — the layout is never visible
 * to a signed-out visitor. Calls onAuthChange once login or registration succeeds, at which point App.jsx
 * swaps this out for the real app.
 *
 * @param {Object} props
 * @param {(user: import('../api/auth.js').AuthUser) => void} props.onAuthChange Called with the now-logged-in user.
 * @returns {JSX.Element} The full-page login screen.
 */
export default function LoginScreen({ onAuthChange }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const authedUser = mode === 'login' ? await login(username, password) : await register(username, password)
      onAuthChange(authedUser)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <img className="login-card-logo" src="/favicon.png" alt="" />
        <h1 className="login-card-title">TrainTracks</h1>
        <div className="login-card-tabs">
          <button type="button" className={mode === 'login' ? 'login-card-tab active' : 'login-card-tab'} onClick={() => setMode('login')}>
            Log in
          </button>
          <button type="button" className={mode === 'register' ? 'login-card-tab active' : 'login-card-tab'} onClick={() => setMode('register')}>
            Register
          </button>
        </div>
        <input
          className="login-card-input"
          placeholder="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
        />
        <input
          className="login-card-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        {error && <div className="login-card-error">{error}</div>}
        <button type="submit" className="login-card-button" disabled={busy || !username || !password}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </div>
  )
}
