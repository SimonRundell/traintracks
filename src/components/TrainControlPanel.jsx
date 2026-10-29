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
 * Generic two-position toggle switch: a labelled control with a track that
 * slides between a top and bottom position. Used for both the direction and
 * camera switches so they share one visual and interaction pattern.
 *
 * @param {Object} props
 * @param {string} props.label Control label shown above the switch.
 * @param {string} props.topText Tick label for the top (pressed) position.
 * @param {string} props.bottomText Tick label for the bottom position.
 * @param {boolean} props.isTop True when the switch is in its top position.
 * @param {string} props.ariaLabel Accessible description of the current state and what activating it does.
 * @param {() => void} props.onToggle Called when the switch is clicked.
 * @returns {JSX.Element} The toggle switch control.
 */
function ToggleSwitch({ label, topText, bottomText, isTop, ariaLabel, onToggle }) {
  return (
    <div className="toggle-switch">
      <span className="control-label">{label}</span>
      <div className="toggle-switch-body">
        <span className="toggle-switch-tick">{topText}</span>
        <button
          type="button"
          className="toggle-switch-track"
          data-position={isTop ? 'top' : 'bottom'}
          aria-pressed={isTop}
          aria-label={ariaLabel}
          onClick={onToggle}
        >
          <span className="toggle-switch-thumb" />
        </button>
        <span className="toggle-switch-tick">{bottomText}</span>
      </div>
    </div>
  )
}

/**
 * Forward/reverse direction switch, with forward at the top and reverse at
 * the bottom.
 *
 * @param {Object} props
 * @param {1 | -1} props.direction Current direction: 1 = forward, -1 = reverse.
 * @param {(direction: 1 | -1) => void} props.onChange Called with the new direction when toggled.
 * @returns {JSX.Element} The direction switch control.
 */
function DirectionSwitch({ direction, onChange }) {
  const isForward = direction === 1
  return (
    <ToggleSwitch
      label="Direction"
      topText="FWD"
      bottomText="REV"
      isTop={isForward}
      ariaLabel={`Direction: ${isForward ? 'forward' : 'reverse'}. Activate to switch to ${isForward ? 'reverse' : 'forward'}.`}
      onToggle={() => onChange(isForward ? -1 : 1)}
    />
  )
}

/**
 * Camera mode switch: STATIC leaves the camera wherever the user left it;
 * FOLLOW keeps the orbit target on the lead loco while still allowing
 * rotate and zoom.
 *
 * @param {Object} props
 * @param {'static' | 'follow'} props.cameraMode Current camera mode.
 * @param {(mode: 'static' | 'follow') => void} props.onChange Called with the new mode when toggled.
 * @returns {JSX.Element} The camera switch control.
 */
function CameraSwitch({ cameraMode, onChange }) {
  const isStatic = cameraMode === 'static'
  return (
    <ToggleSwitch
      label="Camera"
      topText="STATIC"
      bottomText="FOLLOW"
      isTop={isStatic}
      ariaLabel={`Camera: ${isStatic ? 'static' : 'follow'}. Activate to switch to ${isStatic ? 'follow' : 'static'}.`}
      onToggle={() => onChange(isStatic ? 'follow' : 'static')}
    />
  )
}

/**
 * Sim mode switch: PLAY runs the train formation; LAY hides it and arms
 * click-and-drag track building instead.
 *
 * @param {Object} props
 * @param {'play' | 'lay'} props.mode Current sim mode.
 * @param {(mode: 'play' | 'lay') => void} props.onChange Called with the new mode when toggled.
 * @returns {JSX.Element} The mode switch control.
 */
function ModeSwitch({ mode, onChange }) {
  const isPlay = mode === 'play'
  return (
    <ToggleSwitch
      label="Mode"
      topText="PLAY"
      bottomText="LAY"
      isTop={isPlay}
      ariaLabel={`Mode: ${isPlay ? 'play' : 'lay track'}. Activate to switch to ${isPlay ? 'lay track' : 'play'}.`}
      onToggle={() => onChange(isPlay ? 'lay' : 'play')}
    />
  )
}

/**
 * Bottom-of-screen controller: a rotary throttle dial, a forward/reverse
 * switch, a camera mode switch, and a play/lay mode switch. Mutates the
 * shared controller state in place so the render loop picks up changes
 * immediately. The throttle and direction controls dim in LAY mode, since
 * the train is off the track while building.
 *
 * `mode` itself is a prop rather than local state (unlike the other controls here) — RailwayViewport
 * needs it too, to decide whether to show the LAY-mode track drawer, so it's owned by their shared parent.
 *
 * @param {Object} props
 * @param {import('../railway/trainController.js').TrainController} props.controller Shared controller state.
 * @param {'play' | 'lay'} props.mode Current sim mode.
 * @param {(mode: 'play' | 'lay') => void} props.onModeChange Called with the new mode when toggled.
 * @returns {JSX.Element} The control panel bar.
 */
export default function TrainControlPanel({ controller, mode, onModeChange }) {
  const [speedFraction, setSpeedFraction] = useState(controller.speedFraction)
  const [direction, setDirection] = useState(controller.direction)
  const [cameraMode, setCameraMode] = useState(controller.cameraMode)

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

  const handleCameraModeChange = useCallback(
    (value) => {
      controller.cameraMode = value
      setCameraMode(value)
    },
    [controller],
  )

  return (
    <div className="train-control-panel">
      <div className={mode === 'lay' ? 'train-controls-group inactive' : 'train-controls-group'}>
        <ThrottleDial value={speedFraction} onChange={handleSpeedChange} />
        <DirectionSwitch direction={direction} onChange={handleDirectionChange} />
      </div>
      <CameraSwitch cameraMode={cameraMode} onChange={handleCameraModeChange} />
      <ModeSwitch mode={mode} onChange={onModeChange} />
    </div>
  )
}
