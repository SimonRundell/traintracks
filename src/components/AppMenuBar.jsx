import { useState } from 'react'
import LayoutPanel from './LayoutPanel.jsx'
import ConsistPanel from './ConsistPanel.jsx'

/**
 * Top app bar: brand on the left, a "My Layouts" menu that drops down the save/load panel, a "Train" menu
 * that drops down the consist builder, and the signed-in user + logout on the right. Only rendered once
 * logged in — see App.jsx, which shows LoginScreen instead for a signed-out visitor.
 *
 * @param {Object} props
 * @param {import('../api/auth.js').AuthUser} props.user
 * @param {() => void} props.onLogout
 * @param {() => {pieces: Object[], junctions: Object[], consist: string[]}} props.getSnapshot Forwarded to LayoutPanel and ConsistPanel — reads the current layout (and running consist) off the live scene.
 * @param {(data: Object) => void} props.onLoadLayout Forwarded to LayoutPanel — replaces the current scene with a loaded layout.
 * @param {import('../api/rollingStock.js').RollingStockItem[]} props.catalogue Forwarded to ConsistPanel — every available loco/carriage/wagon.
 * @param {(keys: string[]) => void} props.onApplyConsist Forwarded to ConsistPanel — rebuilds the running train from an ordered key list.
 * @returns {JSX.Element} The top bar.
 */
export default function AppMenuBar({ user, onLogout, getSnapshot, onLoadLayout, catalogue, onApplyConsist }) {
  const [layoutsOpen, setLayoutsOpen] = useState(false)
  const [trainOpen, setTrainOpen] = useState(false)

  return (
    <header className="app-menu-bar">
      <div className="app-menu-bar-brand">
        <img className="app-menu-bar-logo" src="/favicon.png" alt="" />
        <span className="app-menu-bar-title">TrainTracks</span>
      </div>

      <div className="app-menu-bar-item">
        <button type="button" className="app-menu-bar-button" onClick={() => setLayoutsOpen((open) => !open)}>
          My Layouts
        </button>
        {layoutsOpen && (
          <>
            <div className="app-menu-bar-backdrop" onClick={() => setLayoutsOpen(false)} />
            <div className="app-menu-bar-dropdown">
              <LayoutPanel
                getSnapshot={getSnapshot}
                onLoadLayout={(data) => {
                  onLoadLayout(data)
                  setLayoutsOpen(false)
                }}
              />
            </div>
          </>
        )}
      </div>

      <div className="app-menu-bar-item">
        <button type="button" className="app-menu-bar-button" onClick={() => setTrainOpen((open) => !open)}>
          Train
        </button>
        {trainOpen && (
          <>
            <div className="app-menu-bar-backdrop" onClick={() => setTrainOpen(false)} />
            <div className="app-menu-bar-dropdown">
              <ConsistPanel catalogue={catalogue} getSnapshot={getSnapshot} onApply={onApplyConsist} />
            </div>
          </>
        )}
      </div>

      <div className="app-menu-bar-spacer" />

      <div className="app-menu-bar-auth">
        <span className="app-menu-bar-username">{user.username}</span>
        <button type="button" className="app-menu-bar-button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  )
}
