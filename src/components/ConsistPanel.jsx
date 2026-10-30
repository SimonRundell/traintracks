import { useEffect, useRef, useState } from 'react'

/**
 * Train-builder dropdown: pick one locomotive, then add carriages/wagons from the catalogue in whatever
 * order you like, reordering or removing them afterwards. Every change applies immediately (calls
 * onApply with the resulting ordered key list) — there's no separate "build" step, matching how dragging a
 * track piece or platform section onto the layout takes effect the moment you drop it. The apply itself
 * happens in an effect reacting to locoKey/wagonKeys rather than inline in each click handler, so it
 * always sees the latest state even if clicks arrive faster than React re-renders between them — reading
 * state directly in a handler (rather than via the functional setState form, which the handlers below all
 * use) would otherwise risk a stale closure silently dropping an in-flight change.
 *
 * Seeds its draft from whatever consist is already running (via getSnapshot().consist) when it first
 * mounts, so reopening the panel — or loading a saved layout that already has a train — shows the real
 * current state rather than starting blank every time. skipNextApply suppresses the apply effect's own
 * first run right after that seed, so opening the panel doesn't immediately reload the very consist that's
 * already running.
 *
 * @param {Object} props
 * @param {import('../api/rollingStock.js').RollingStockItem[]} props.catalogue Every available loco/carriage/wagon.
 * @param {() => {consist: string[]}} props.getSnapshot Reads the currently running consist off the live scene.
 * @param {(keys: string[]) => void} props.onApply Called with the new ordered key list whenever the draft changes.
 * @returns {JSX.Element} The panel.
 */
export default function ConsistPanel({ catalogue, getSnapshot, onApply }) {
  const [locoKey, setLocoKey] = useState(null)
  const [wagonKeys, setWagonKeys] = useState([])
  const skipNextApply = useRef(true)

  useEffect(() => {
    const current = getSnapshot?.().consist ?? []
    const locoKeys = new Set(catalogue.filter((item) => item.category === 'loco').map((item) => item.key))
    const firstLoco = current.find((key) => locoKeys.has(key)) ?? null
    setLocoKey(firstLoco)
    setWagonKeys(current.filter((key) => key !== firstLoco))
    // Seeded once, from whatever's already running when the panel opens — not kept in sync afterwards,
    // same as LayoutPanel's own one-shot refresh on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (skipNextApply.current) {
      skipNextApply.current = false
      return
    }
    onApply(locoKey ? [locoKey, ...wagonKeys] : wagonKeys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locoKey, wagonKeys])

  function selectLoco(key) {
    setLocoKey((current) => (current === key ? null : key)) // clicking the already-selected loco removes it, same toggle feel as a radio you can clear
  }

  function addWagon(key) {
    setWagonKeys((current) => [...current, key])
  }

  function removeWagon(index) {
    setWagonKeys((current) => current.filter((_, i) => i !== index))
  }

  function moveWagon(index, delta) {
    setWagonKeys((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const locos = catalogue.filter((item) => item.category === 'loco')
  const addable = catalogue.filter((item) => item.category !== 'loco')
  const itemByKey = new Map(catalogue.map((item) => [item.key, item]))
  const isEmpty = !locoKey && wagonKeys.length === 0

  return (
    <div className="consist-panel">
      <div className="consist-panel-title">Train</div>

      <div className="consist-panel-section-label">Locomotive</div>
      <div className="consist-panel-items">
        {locos.map((item) => (
          <button
            key={item.key}
            type="button"
            className={locoKey === item.key ? 'consist-panel-item consist-panel-item-selected' : 'consist-panel-item'}
            onClick={() => selectLoco(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="consist-panel-section-label">Add carriage / wagon</div>
      <div className="consist-panel-items">
        {addable.map((item) => (
          <button key={item.key} type="button" className="consist-panel-item" onClick={() => addWagon(item.key)}>
            + {item.label}
          </button>
        ))}
      </div>

      <div className="consist-panel-section-label">Consist</div>
      <ul className="consist-panel-order">
        {isEmpty && <li className="consist-panel-empty">No train built yet</li>}
        {locoKey && (
          <li className="consist-panel-order-item">
            <span className="consist-panel-order-name">{itemByKey.get(locoKey)?.label}</span>
          </li>
        )}
        {wagonKeys.map((key, index) => (
          <li key={index} className="consist-panel-order-item">
            <span className="consist-panel-order-name">{itemByKey.get(key)?.label}</span>
            <button type="button" className="consist-panel-order-button" disabled={index === 0} onClick={() => moveWagon(index, -1)}>
              ↑
            </button>
            <button
              type="button"
              className="consist-panel-order-button"
              disabled={index === wagonKeys.length - 1}
              onClick={() => moveWagon(index, 1)}
            >
              ↓
            </button>
            <button type="button" className="consist-panel-order-button" onClick={() => removeWagon(index)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
