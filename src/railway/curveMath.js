import * as THREE from 'three'

/**
 * Finds the point on a curve closest to a given world point, by coarse
 * sampling followed by a local refinement pass.
 *
 * @param {THREE.Curve} curve Curve to search.
 * @param {THREE.Vector3} point World point to measure against.
 * @param {Object} [options]
 * @param {boolean} [options.closed] True if the curve loops back on itself.
 * @param {number} [options.samples] Coarse sample count.
 * @returns {{t: number, point: THREE.Vector3, distance: number}} Closest point found.
 */
export function closestPointOnCurve(curve, point, { closed = false, samples = 150 } = {}) {
  let bestT = 0
  let bestDistSq = Infinity
  let bestPoint = curve.getPointAt(0)

  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    if (closed && i === samples) break
    const p = curve.getPointAt(t)
    const distSq = p.distanceToSquared(point)
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestT = t
      bestPoint = p
    }
  }

  const window = 1 / samples
  const refineSamples = 20
  for (let i = 0; i <= refineSamples; i++) {
    let t = bestT - window + (2 * window * i) / refineSamples
    if (closed) t = ((t % 1) + 1) % 1
    else t = Math.min(1, Math.max(0, t))
    const p = curve.getPointAt(t)
    const distSq = p.distanceToSquared(point)
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestT = t
      bestPoint = p
    }
  }

  return { t: bestT, point: bestPoint, distance: Math.sqrt(bestDistSq) }
}

/**
 * Finds the smallest radius of curvature anywhere along a quadratic Bezier,
 * by sampling. A perfectly straight curve has infinite radius.
 *
 * @param {THREE.Vector3} p0 Start point.
 * @param {THREE.Vector3} p1 Control point.
 * @param {THREE.Vector3} p2 End point.
 * @param {number} [samples] Number of samples to check.
 * @returns {number} Minimum radius of curvature, in the same units as the input points.
 */
export function quadraticBezierMinRadius(p0, p1, p2, samples = 24) {
  const d1a = new THREE.Vector3().subVectors(p1, p0)
  const d1b = new THREE.Vector3().subVectors(p2, p1)
  const secondDerivative = new THREE.Vector3()
    .addScaledVector(p2, 2)
    .addScaledVector(p1, -4)
    .addScaledVector(p0, 2)

  let minRadius = Infinity
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const mt = 1 - t
    const firstDerivative = new THREE.Vector3().addScaledVector(d1a, 2 * mt).addScaledVector(d1b, 2 * t)
    const speed = firstDerivative.length()
    if (speed < 1e-6) continue
    const crossLength = new THREE.Vector3().crossVectors(firstDerivative, secondDerivative).length()
    if (crossLength < 1e-6) continue // effectively straight here
    const radius = speed ** 3 / crossLength
    if (radius < minRadius) minRadius = radius
  }
  return minRadius
}

/**
 * Finds the smallest radius of curvature anywhere along any curve, by
 * sampling points and estimating curvature from the circumradius of each
 * consecutive triplet. Less precise than an analytic formula, but works for
 * any curve type (cubic Bezier, CatmullRom, ...) without one.
 *
 * @param {THREE.Curve} curve Curve to check.
 * @param {number} [samples] Number of sample points.
 * @returns {number} Minimum radius of curvature found.
 */
export function curveMinRadius(curve, samples = 30) {
  const points = []
  for (let i = 0; i <= samples; i++) points.push(curve.getPoint(i / samples))

  let minRadius = Infinity
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const ab = a.distanceTo(b)
    const bc = b.distanceTo(c)
    const ac = a.distanceTo(c)
    const s = (ab + bc + ac) / 2
    const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ac)))
    if (area < 1e-9) continue
    const radius = (ab * bc * ac) / (4 * area)
    if (radius < minRadius) minRadius = radius
  }
  return minRadius
}
