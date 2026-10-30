import { useCallback, useEffect, useMemo, useState } from 'react'
import RailwayViewport from './components/RailwayViewport.jsx'
import TrainControlPanel from './components/TrainControlPanel.jsx'
import AppMenuBar from './components/AppMenuBar.jsx'
import LoginScreen from './components/LoginScreen.jsx'
import { createTrainController } from './railway/trainController.js'
import { fetchCurrentUser, logout } from './api/auth.js'
import { fetchRollingStockCatalogue } from './api/rollingStock.js'

/**
 * Root application component. Gated by login — see LoginScreen — so the railway app itself (scene,
 * drawer, controls) only ever mounts once signed in; nothing renders here until the initial session
 * check (fetchCurrentUser) resolves, to avoid flashing the login screen for an already-logged-in visitor.
 * Also waits on the rolling-stock catalogue (every available loco/carriage/wagon) before mounting the
 * scene, since createRailwayScene needs it up front to resolve a saved layout's own consist — see its own
 * `catalogue` option.
 *
 * `mode`, `scene`, and `catalogue` are lifted up here (rather than owned by their nearest-rendering
 * component) because sibling components need them too: RailwayViewport needs `mode` to decide whether to
 * show the LAY-mode track drawer and `catalogue` to pass into the scene it creates, and AppMenuBar needs
 * `scene` (reported up via RailwayViewport's onSceneReady) and `catalogue` to drive its My Layouts and
 * Train menus.
 *
 * @returns {JSX.Element} The app shell.
 */
function App() {
  const controller = useMemo(() => createTrainController(), [])
  const [mode, setMode] = useState(controller.mode)
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [scene, setScene] = useState(null)
  const [catalogue, setCatalogue] = useState(null)

  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    if (!user) return
    fetchRollingStockCatalogue()
      .then(setCatalogue)
      .catch(() => setCatalogue([])) // no rolling stock available is still a valid (if empty) state — the Train panel just has nothing to offer
  }, [user])

  const handleModeChange = useCallback((value) => {
    controller.mode = value
    setMode(value)
  }, [controller])

  const handleLogout = useCallback(async () => {
    await logout()
    setUser(null)
  }, [])

  if (!authChecked) return null
  if (!user) return <LoginScreen onAuthChange={setUser} />
  if (!catalogue) return null

  return (
    <main className="railway-app">
      <RailwayViewport controller={controller} mode={mode} catalogue={catalogue} onSceneReady={setScene} />
      <AppMenuBar
        user={user}
        onLogout={handleLogout}
        getSnapshot={() => scene?.getSnapshot()}
        onLoadLayout={(data) => scene?.loadLayout(data)}
        catalogue={catalogue}
        onApplyConsist={(keys) => scene?.loadConsist(keys)}
      />
      <TrainControlPanel controller={controller} mode={mode} onModeChange={handleModeChange} />
    </main>
  )
}

export default App
