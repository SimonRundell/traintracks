import { useEffect, useRef } from 'react'
import { createRailwayScene } from '../railway/createRailwayScene.js'

/**
 * Mounts the Three.js railway scene into a full-size canvas and tears it
 * down again on unmount.
 *
 * @param {Object} props
 * @param {import('../railway/trainController.js').TrainController} props.controller Shared throttle/direction state for the running loco.
 * @returns {JSX.Element} The canvas element hosting the WebGL scene.
 */
export default function RailwayViewport({ controller }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const dispose = createRailwayScene(canvasRef.current, controller)
    return dispose
  }, [controller])

  return <canvas ref={canvasRef} className="railway-canvas" />
}
