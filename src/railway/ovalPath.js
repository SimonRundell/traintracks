import * as THREE from 'three'

export const TRACK_SEMI_MAJOR = 48
export const TRACK_SEMI_MINOR = 29

const CONTROL_POINTS = 64

/**
 * Builds the closed centreline curve for the oval running loop.
 *
 * @returns {THREE.CatmullRomCurve3} Closed curve through the rail centreline, in the XZ plane at Y = 0.
 */
export function createOvalCenterline() {
  const points = []
  for (let i = 0; i < CONTROL_POINTS; i++) {
    const angle = (i / CONTROL_POINTS) * Math.PI * 2
    points.push(
      new THREE.Vector3(
        Math.cos(angle) * TRACK_SEMI_MAJOR,
        0,
        Math.sin(angle) * TRACK_SEMI_MINOR,
      ),
    )
  }
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5)
}
