import { useRef } from 'react'
import { freeCandidateMenu, forkCandidateMenu } from '../railway/pieceCandidates.js'

const FREE_ITEMS = freeCandidateMenu()
const FORK_ITEMS = forkCandidateMenu()
const DRAG_THRESHOLD_PX = 6 // pointer movement before a press on a drawer item counts as a drag rather than a click

/**
 * LAY-mode side panel listing every catalogue piece. Two ways to place one:
 *
 * - Click a free-end item (a straight or curve) to append it to the currently selected dangling end (the
 *   red marker in the scene — amber once selected); a successful append moves the selection on to the new
 *   piece's own far end, so repeated clicks on the same item keep extending the same chain.
 * - Drag any item (free-end or fork) onto the layout; a live preview tracks the nearest valid landing
 *   spot as the pointer moves, and releasing over one commits it there. Fork items (points/Y-points) can
 *   only be placed this way, since they land on existing track rather than a selected end.
 *
 * Click vs. drag is told apart by how far the pointer moves after going down on an item — see
 * DRAG_THRESHOLD_PX.
 *
 * @param {Object} props
 * @param {boolean} props.hasSelection Whether a dangling end is currently selected — only affects free-end items' *click* behaviour (dimmed, though still draggable, while nothing is selected); dragging never depends on it.
 * @param {(key: string) => void} props.onPick Called with a free-end item's key on a plain click.
 * @param {(key: string, isFork: boolean) => void} props.onDragStart Called once a press on an item crosses the drag threshold.
 * @param {(clientX: number, clientY: number) => void} props.onDragMove Called with the live pointer position while dragging.
 * @param {(commit: boolean) => void} props.onDragEnd Called on release — `commit` is true unless the gesture never became a drag.
 * @returns {JSX.Element} The drawer panel.
 */
export default function TrackDrawer({ hasSelection, onPick, onDragStart, onDragMove, onDragEnd }) {
  const dragState = useRef(null)

  function handlePointerMove(event) {
    const state = dragState.current
    if (!state || event.pointerId !== state.pointerId) return
    if (!state.dragging) {
      const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
      if (moved < DRAG_THRESHOLD_PX) return
      state.dragging = true
      onDragStart(state.key, state.isFork)
    }
    onDragMove(event.clientX, event.clientY)
  }

  function handlePointerUp(event) {
    const state = dragState.current
    if (!state || event.pointerId !== state.pointerId) return
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    dragState.current = null
    if (state.dragging) onDragEnd(true)
    else if (!state.isFork) onPick(state.key) // a fork item clicked without dragging has no click behaviour — it only lands on existing track
  }

  function handlePointerDown(event, key, isFork) {
    event.preventDefault()
    dragState.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, key, isFork, dragging: false }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  return (
    <div className="track-drawer">
      <div className="track-drawer-hint">{hasSelection ? 'Click to extend the selected end, or drag any piece onto the layout' : 'Click a red marker to select an end, or drag a piece onto the layout'}</div>
      <div className="track-drawer-section-label">Plain track</div>
      <div className="track-drawer-items">
        {FREE_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={hasSelection ? 'track-drawer-item' : 'track-drawer-item track-drawer-item-click-disabled'}
            onPointerDown={(event) => handlePointerDown(event, item.key, false)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="track-drawer-section-label">Points</div>
      <div className="track-drawer-items">
        {FORK_ITEMS.map((item) => (
          <button key={item.key} type="button" className="track-drawer-item" onPointerDown={(event) => handlePointerDown(event, item.key, true)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
