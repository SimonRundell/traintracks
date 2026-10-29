import { useCallback, useMemo, useState } from 'react'
import RailwayViewport from './components/RailwayViewport.jsx'
import TrainControlPanel from './components/TrainControlPanel.jsx'
import { createTrainController } from './railway/trainController.js'

/**
 * Root application component: a full-viewport isometric railway scene with
 * a bottom-of-screen train controller.
 *
 * `mode` is lifted up here (rather than left as TrainControlPanel's own local state, as the other
 * controller fields are) because RailwayViewport also needs to know it — to decide whether to show the
 * LAY-mode track drawer — and the two are siblings, not parent/child.
 *
 * @returns {JSX.Element} The app shell.
 */
function App() {
  const controller = useMemo(() => createTrainController(), [])
  const [mode, setMode] = useState(controller.mode)

  const handleModeChange = useCallback(
    (value) => {
      controller.mode = value
      setMode(value)
    },
    [controller],
  )

  return (
    <main className="railway-app">
      <RailwayViewport controller={controller} mode={mode} />
      <TrainControlPanel controller={controller} mode={mode} onModeChange={handleModeChange} />
    </main>
  )
}

export default App
