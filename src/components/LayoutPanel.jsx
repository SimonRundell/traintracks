import { useCallback, useEffect, useState } from 'react'
import { listLayouts, saveLayout, fetchLayout, deleteLayout } from '../api/layouts.js'

/**
 * Top-left (below AuthPanel) save/load panel for the current user's layouts. Only rendered once logged
 * in — see RailwayViewport.jsx.
 *
 * @param {Object} props
 * @param {() => {pieces: Object[], junctions: Object[]}} props.getSnapshot Reads the current layout off the live scene — see trackBuilder.js's getSnapshot.
 * @param {(data: Object) => void} props.onLoadLayout Replaces the current scene with a loaded layout — see createRailwayScene.js's loadLayout.
 * @returns {JSX.Element} The layout panel.
 */
export default function LayoutPanel({ getSnapshot, onLoadLayout }) {
  const [layouts, setLayouts] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setLayouts(await listLayouts())
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load your layouts')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleSave(event) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    try {
      await saveLayout(trimmed, getSnapshot())
      setName('')
      await refresh()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleLoad(id) {
    setBusy(true)
    setError('')
    try {
      onLoadLayout(await fetchLayout(id))
    } catch (err) {
      setError(err.response?.data?.error ?? 'Load failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id) {
    setBusy(true)
    setError('')
    try {
      await deleteLayout(id)
      await refresh()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="layout-panel">
      <div className="layout-panel-title">My layouts</div>
      <form className="layout-panel-save" onSubmit={handleSave}>
        <input className="layout-panel-input" placeholder="Layout name" value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="layout-panel-button" disabled={busy || !name.trim()}>
          Save current
        </button>
      </form>
      {error && <div className="layout-panel-error">{error}</div>}
      <ul className="layout-panel-list">
        {layouts.map((layout) => (
          <li key={layout.id} className="layout-panel-item">
            <span className="layout-panel-item-name">{layout.name}</span>
            <button type="button" className="layout-panel-item-button" disabled={busy} onClick={() => handleLoad(layout.id)}>
              Load
            </button>
            <button type="button" className="layout-panel-item-button" disabled={busy} onClick={() => handleDelete(layout.id)}>
              Delete
            </button>
          </li>
        ))}
        {layouts.length === 0 && <li className="layout-panel-empty">No saved layouts yet</li>}
      </ul>
    </div>
  )
}
