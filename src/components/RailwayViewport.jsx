import { useEffect, useRef, useState } from 'react'
import { createRailwayScene } from '../railway/createRailwayScene.js'
import TrackDrawer from './TrackDrawer.jsx'

/**
 * Mounts the Three.js railway scene into a full-size canvas and tears it down again on unmount. While in
 * LAY mode, also renders the track drawer overlay, wired directly to the live trackBuilder instance the
 * scene created.
 *
 * @param {Object} props
 * @param {import('../railway/trainController.js').TrainController} props.controller Shared throttle/direction/mode state for the running loco.
 * @param {'play' | 'lay'} props.mode Current sim mode — mirrors controller.mode, lifted to a prop so this component re-renders when it changes (the controller itself is a plain mutable object, not reactive).
 * @returns {JSX.Element} The canvas element hosting the WebGL scene, plus the LAY-mode drawer when active.
 */
export default function RailwayViewport({ controller, mode }) {
  const canvasRef = useRef(null)
  const trackBuilderRef = useRef(null)
  const [hasSelection, setHasSelection] = useState(false)

  useEffect(() => {
    const { dispose, trackBuilder } = createRailwayScene(canvasRef.current, controller, {
      onSelectionChange: (selection) => setHasSelection(Boolean(selection)),
    })
    trackBuilderRef.current = trackBuilder
    return () => {
      trackBuilderRef.current = null
      dispose()
    }
  }, [controller])

  return (
    <>
      <canvas ref={canvasRef} className="railway-canvas" />
      {mode === 'lay' && (
        <TrackDrawer
          hasSelection={hasSelection}
          onPick={(key) => trackBuilderRef.current?.appendPiece(key)}
          onDragStart={(key, isFork) => trackBuilderRef.current?.beginDrawerDrag(key, isFork)}
          onDragMove={(x, y) => trackBuilderRef.current?.updateDrawerDrag(x, y)}
          onDragEnd={(commit) => trackBuilderRef.current?.endDrawerDrag(commit)}
        />
      )}
    </>
  )
}
