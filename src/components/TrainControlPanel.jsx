import { useCallback, useEffect, useRef, useState } from 'react'

const DIAL_ANGLE_MIN = -135
const DIAL_ANGLE_MAX = 135
const DRAG_PIXELS_FOR_FULL_RANGE = 180

/**
 * Rotary throttle dial. Drag vertically to change speed: dragging up
 * increases throttle, dragging down decreases it, like a model railway
 * controller knob. Arrow keys nudge it when focused.
 *
 * Tracks the drag on `window` rather than the dial element itself, since the
 * full throttle range spans more pixels than the dial is wide — the pointer
 * routinely leaves the dial's bounds mid-drag.
 *
 * @param {Object} props
 * @param {number} props.value Current throttle value in [0, 1].
 * @param {(value: number) => void} props.onChange Called with the new throttle value while dragging.
 * @returns {JSX.Element} The dial control.
 */
function ThrottleDial({ value, onChange }) {
  const dragState = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    function handlePointerMove(event) {
      if (!dragState.current || event.pointerId !== dragState.current.pointerId) return
      const deltaValue = -(event.clientY - dragState.current.startY) / DRAG_PIXELS_FOR_FULL_RANGE
      onChangeRef.current(Math.min(1, Math.max(0, dragState.current.startValue + deltaValue)))
    }
    function handlePointerUp(event) {
      if (!dragState.current || event.pointerId !== dragState.current.pointerId) return
      dragState.current = null
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  const handlePointerDown = useCallback(
    (event) => {
      dragState.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value }
    },
    [value],
  )

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') onChange(Math.min(1, value + 0.05))
      if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') onChange(Math.max(0, value - 0.05))
    },
    [onChange, value],
  )

  const angle = DIAL_ANGLE_MIN + value * (DIAL_ANGLE_MAX - DIAL_ANGLE_MIN)

  return (
    <div className="throttle">
      <span className="control-label">Throttle</span>
      <div
        className="throttle-dial"
        role="slider"
        aria-label="Train throttle"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        <span className="throttle-dial-pointer" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span className="control-value">{Math.round(value * 100)}%</span>
    </div>
  )
}

/**
 * Forward/reverse direction switch, styled as a two-position toggle with
 * forward at the top and reverse at the bottom.
 *
 * @param {Object} props
 * @param {1 | -1} props.direction Current direction: 1 = forward, -1 = reverse.
 * @param {(direction: 1 | -1) => void} props.onChange Called with the new direction when toggled.
 * @returns {JSX.Element} The direction switch control.
 */
function DirectionSwitch({ direction, onChange }) {
  const isForward = direction === 1

  return (
    <div className="direction-switch">
      <span className="control-label">Direction</span>
      <div className="direction-switch-body">
        <span className="direction-switch-tick">FWD</span>
        <button
          type="button"
          className="direction-switch-track"
          data-direction={isForward ? 'forward' : 'reverse'}
          aria-pressed={isForward}
          aria-label={`Direction: ${isForward ? 'forward' : 'reverse'}. Activate to switch to ${isForward ? 'reverse' : 'forward'}.`}
          onClick={() => onChange(isForward ? -1 : 1)}
        >
          <span className="direction-switch-thumb" />
        </button>
        <span className="direction-switch-tick">REV</span>
      </div>
    </div>
  )
}

/**
 * Bottom-of-screen controller for the running loco: a rotary throttle dial
 * and a forward/reverse switch. Mutates the shared controller state in
 * place so the render loop picks up changes immediately.
 *
 * @param {Object} props
 * @param {import('../railway/trainController.js').TrainController} props.controller Shared throttle/direction state.
 * @returns {JSX.Element} The control panel bar.
 */
export default function TrainControlPanel({ controller }) {
  const [speedFraction, setSpeedFraction] = useState(controller.speedFraction)
  const [direction, setDirection] = useState(controller.direction)

  const handleSpeedChange = useCallback(
    (value) => {
      controller.speedFraction = value
      setSpeedFraction(value)
    },
    [controller],
  )

  const handleDirectionChange = useCallback(
    (value) => {
      controller.direction = value
      setDirection(value)
    },
    [controller],
  )

  return (
    <div className="train-control-panel">
      <ThrottleDial value={speedFraction} onChange={handleSpeedChange} />
      <DirectionSwitch direction={direction} onChange={handleDirectionChange} />
    </div>
  )
}
