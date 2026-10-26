/**
 * Shared mutable state for the train controller UI, read directly by the
 * render loop every frame. Fields are mutated in place by the control panel
 * so the animation loop always sees the latest values without needing a
 * React re-render round trip.
 *
 * @typedef {Object} TrainController
 * @property {number} speedFraction Throttle position in [0, 1].
 * @property {1 | -1} direction Direction of travel: 1 = forward, -1 = reverse.
 * @property {'static' | 'follow'} cameraMode 'static' leaves the camera where the user left it;
 *   'follow' keeps its orbit target on the lead loco while still allowing rotate/zoom.
 * @property {'play' | 'lay'} mode 'play' runs the train formation; 'lay' hides it and arms
 *   click-and-drag track building instead.
 */

/**
 * Creates a fresh train controller state, stopped, set to forward, with a static camera, in play mode.
 *
 * @returns {TrainController} A new controller state object.
 */
export function createTrainController() {
  return { speedFraction: 0, direction: 1, cameraMode: 'static', mode: 'play' }
}
