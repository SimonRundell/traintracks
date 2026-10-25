import { useMemo } from 'react'
import RailwayViewport from './components/RailwayViewport.jsx'
import TrainControlPanel from './components/TrainControlPanel.jsx'
import { createTrainController } from './railway/trainController.js'

/**
 * Root application component: a full-viewport isometric railway scene with
 * a bottom-of-screen train controller.
 *
 * @returns {JSX.Element} The app shell.
 */
function App() {
  const controller = useMemo(() => createTrainController(), [])

  return (
    <main className="railway-app">
      <RailwayViewport controller={controller} />
      <TrainControlPanel controller={controller} />
    </main>
  )
}

export default App
