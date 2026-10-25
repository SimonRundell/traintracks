/**
 * Shared mutable state for the train controller UI, read directly by the
 * render loop every frame. Fields are mutated in place by the control panel
 * so the animation loop always sees the latest values without needing a
 * React re-render round trip.
 *
 * @typedef {Object} TrainController
 * @property {number} speedFraction Throttle position in [0, 1].
 * @property {1 | -1} direction Direction of travel: 1 = forward, -1 = reverse.
 */

/**
 * Creates a fresh train controller state, stopped and set to forward.
 *
 * @returns {TrainController} A new controller state object.
 */
export function createTrainController() {
  return { speedFraction: 0, direction: 1 }
}
