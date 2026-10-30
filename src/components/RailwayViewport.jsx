import { useEffect, useRef, useState } from 'react'
import { createRailwayScene } from '../railway/createRailwayScene.js'
import TrackDrawer from './TrackDrawer.jsx'

/**
 * Mounts the Three.js railway scene into a full-size canvas and tears it down again on unmount. While in
 * LAY mode, also renders the track drawer overlay, wired directly to the live scene handle
 * createRailwayScene returned — track/fork items drive trackBuilder, platform items drive
 * platformBuilder, station items drive stationBuilder, routed by the drawer item's `kind` (see
 * TrackDrawer.jsx).
 *
 * The scene handle is also reported up via onSceneReady, since App.jsx's top menu bar (My Layouts) needs
 * it too and is a sibling, not a child, of this component.
 *
 * @param {Object} props
 * @param {import('../railway/trainController.js').TrainController} props.controller Shared throttle/direction/mode state for the running loco.
 * @param {'play' | 'lay'} props.mode Current sim mode — mirrors controller.mode, lifted to a prop so this component re-renders when it changes (the controller itself is a plain mutable object, not reactive).
 * @param {(scene: ReturnType<typeof createRailwayScene> | null) => void} [props.onSceneReady] Called with the live scene handle once created, and with null just before it's disposed.
 * @returns {JSX.Element} The canvas element hosting the WebGL scene, plus the LAY-mode drawer overlay.
 */
export default function RailwayViewport({ controller, mode, onSceneReady }) {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const dragKindRef = useRef(null) // which builder the in-progress drag belongs to, so move/end route to the same one begin did
  const [hasSelection, setHasSelection] = useState(false)

  useEffect(() => {
    const scene = createRailwayScene(canvasRef.current, controller, {
      onSelectionChange: (selection) => setHasSelection(Boolean(selection)),
    })
    sceneRef.current = scene
    onSceneReady?.(scene)
    return () => {
      sceneRef.current = null
      onSceneReady?.(null)
      scene.dispose()
    }
  }, [controller])

  return (
    <>
      <canvas ref={canvasRef} className="railway-canvas" />
      {mode === 'lay' && (
        <TrackDrawer
          hasSelection={hasSelection}
          onPick={(key) => sceneRef.current?.trackBuilder.appendPiece(key)}
          onDragStart={(key, kind) => {
            dragKindRef.current = kind
            if (kind === 'platform') sceneRef.current?.platformBuilder.beginDrag(key)
            else if (kind === 'station') sceneRef.current?.stationBuilder.beginDrag(key)
            else sceneRef.current?.trackBuilder.beginDrawerDrag(key, kind === 'fork')
          }}
          onDragMove={(x, y) => {
            if (dragKindRef.current === 'platform') sceneRef.current?.platformBuilder.updateDrag(x, y)
            else if (dragKindRef.current === 'station') sceneRef.current?.stationBuilder.updateDrag(x, y)
            else sceneRef.current?.trackBuilder.updateDrawerDrag(x, y)
          }}
          onDragEnd={(commit) => {
            if (dragKindRef.current === 'platform') sceneRef.current?.platformBuilder.endDrag(commit)
            else if (dragKindRef.current === 'station') sceneRef.current?.stationBuilder.endDrag(commit)
            else sceneRef.current?.trackBuilder.endDrawerDrag(commit)
            dragKindRef.current = null
          }}
        />
      )}
    </>
  )
}
