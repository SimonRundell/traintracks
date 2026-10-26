import * as THREE from 'three'

const GAUGE = 1.435
const HALF_GAUGE = GAUGE / 2
const RAIL_RADIUS = 0.07
const RAIL_TOP_Y = 0
const SLEEPER_TOP_Y = RAIL_TOP_Y - RAIL_RADIUS * 2
const SLEEPER_LENGTH = 2.6
const SLEEPER_HEIGHT = 0.22
const SLEEPER_WIDTH = 0.26
const SLEEPER_SPACING = 0.72
const BALLAST_TOP_Y = SLEEPER_TOP_Y - SLEEPER_HEIGHT
const BALLAST_THICKNESS = 0.3
const BALLAST_TOP_HALF_WIDTH = 1.9
const SAMPLES_PER_METRE = 1
const PICK_RADIUS = 1.6

const RAIL_COLOR = 0x9ca0a8
const SLEEPER_COLOR = 0x5a4634
const BALLAST_COLOR = 0x6e6a63

/**
 * Returns the horizontal (XZ-plane) unit normal to a tangent vector, rotated
 * 90 degrees so it points sideways across the track.
 *
 * @param {THREE.Vector3} tangent Unit tangent, assumed to have no Y component.
 * @returns {THREE.Vector3} Unit sideways normal.
 */
function horizontalNormal(tangent) {
  return new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
}

/**
 * Builds a curve offset sideways from a centreline by a fixed distance.
 *
 * @param {THREE.Curve} centerline Track centreline.
 * @param {number} offset Signed sideways displacement in metres.
 * @param {number} sampleCount Number of samples used to approximate the offset curve.
 * @param {boolean} closed True if the centreline loops back on itself.
 * @returns {THREE.CatmullRomCurve3} Curve offset from the centreline.
 */
function offsetCurve(centerline, offset, sampleCount, closed) {
  const points = []
  const steps = closed ? sampleCount : sampleCount + 1
  for (let i = 0; i < steps; i++) {
    const t = i / sampleCount
    const point = centerline.getPointAt(t)
    const tangent = centerline.getTangentAt(t)
    const normal = horizontalNormal(tangent)
    points.push(point.clone().addScaledVector(normal, offset))
  }
  return new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5)
}

/**
 * Builds a single rail as a seamless tube following an offset curve.
 *
 * @param {THREE.Curve} centerline Track centreline.
 * @param {number} offset Signed sideways displacement in metres (negative = inner rail).
 * @param {THREE.Material} material Shared rail material.
 * @param {boolean} closed True if the centreline loops back on itself.
 * @param {number} sampleCount Tube resolution along the curve.
 * @returns {THREE.Mesh} Rail mesh, already positioned so its top sits at RAIL_TOP_Y.
 */
function buildRail(centerline, offset, material, closed, sampleCount) {
  const curve = offsetCurve(centerline, offset, sampleCount, closed)
  const geometry = new THREE.TubeGeometry(curve, sampleCount, RAIL_RADIUS, 8, closed)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y += RAIL_TOP_Y - RAIL_RADIUS
  return mesh
}

/**
 * Builds the row of sleepers (railway ties) along the track, spaced evenly
 * for the curve's actual length.
 *
 * @param {THREE.Curve} centerline Track centreline.
 * @param {boolean} closed True if the centreline loops back on itself.
 * @param {number} curveLength Length of the centreline in metres.
 * @returns {THREE.InstancedMesh} One instanced mesh covering every sleeper.
 */
function buildSleepers(centerline, closed, curveLength) {
  const count = Math.max(2, Math.round(curveLength / SLEEPER_SPACING))
  const geometry = new THREE.BoxGeometry(SLEEPER_LENGTH, SLEEPER_HEIGHT, SLEEPER_WIDTH)
  const material = new THREE.MeshStandardMaterial({ color: SLEEPER_COLOR, roughness: 0.9 })
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  const sleeperCenterY = BALLAST_TOP_Y + SLEEPER_HEIGHT / 2

  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const forward = new THREE.Vector3(0, 0, 1)
  for (let i = 0; i < count; i++) {
    const t = closed ? i / count : i / (count - 1)
    const point = centerline.getPointAt(t)
    const tangent = centerline.getTangentAt(t)
    const normal = horizontalNormal(tangent)
    quaternion.setFromUnitVectors(forward, normal)
    matrix.makeRotationFromQuaternion(quaternion)
    matrix.setPosition(point.x, sleeperCenterY, point.z)
    mesh.setMatrixAt(i, matrix)
  }
  return mesh
}

/**
 * Builds the flat ballast bed as a ribbon following the track, with thin
 * side skirts so it reads as a raised bed from an isometric angle.
 *
 * @param {THREE.Curve} centerline Track centreline.
 * @param {boolean} closed True if the centreline loops back on itself.
 * @param {number} sampleCount Ribbon resolution along the curve.
 * @returns {THREE.Mesh} Ballast mesh.
 */
function buildBallast(centerline, closed, sampleCount) {
  const positions = []
  const indices = []

  for (let i = 0; i <= sampleCount; i++) {
    const t = closed ? (i % sampleCount) / sampleCount : i / sampleCount
    const point = centerline.getPointAt(t)
    const tangent = centerline.getTangentAt(t)
    const normal = horizontalNormal(tangent)
    const left = point.clone().addScaledVector(normal, BALLAST_TOP_HALF_WIDTH)
    const right = point.clone().addScaledVector(normal, -BALLAST_TOP_HALF_WIDTH)

    // Top cap vertices, then the same two points dropped down for the side skirts.
    positions.push(
      left.x, BALLAST_TOP_Y, left.z,
      right.x, BALLAST_TOP_Y, right.z,
      left.x, BALLAST_TOP_Y - BALLAST_THICKNESS, left.z,
      right.x, BALLAST_TOP_Y - BALLAST_THICKNESS, right.z,
    )

    if (i < sampleCount) {
      const a = i * 4
      const b = a + 4
      // Top cap (two triangles).
      indices.push(a, a + 1, b, b, a + 1, b + 1)
      // Left skirt.
      indices.push(a, a + 2, b, b, a + 2, b + 2)
      // Right skirt.
      indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({ color: BALLAST_COLOR, roughness: 1 })
  return new THREE.Mesh(geometry, material)
}

/**
 * Builds an invisible, generously thick tube around the track for reliable
 * raycasting (hover/click detection), independent of the thin visible rails.
 * Not added to the scene graph — the caller raycasts against it directly.
 *
 * @param {THREE.Curve} centerline Track centreline.
 * @param {boolean} closed True if the centreline loops back on itself.
 * @param {number} sampleCount Tube resolution along the curve.
 * @returns {THREE.Mesh} Invisible pick mesh with its world matrix already current.
 */
function buildPickMesh(centerline, closed, sampleCount) {
  const geometry = new THREE.TubeGeometry(centerline, sampleCount, PICK_RADIUS, 6, closed)
  const material = new THREE.MeshBasicMaterial({ visible: false })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  return mesh
}

/**
 * Builds a full piece of track: ballast bed, sleepers, two rails, and an
 * invisible pick mesh for interaction.
 *
 * @param {THREE.Curve} centerline Track centreline curve.
 * @param {Object} [options]
 * @param {boolean} [options.closed] True if the centreline loops back on itself (the main oval); false for an open, dragged segment.
 * @returns {{group: THREE.Group, pickMesh: THREE.Mesh, curveLength: number}} The visible meshes, an invisible pick mesh, and the curve's length in metres.
 */
export function buildTrackMeshes(centerline, { closed = true } = {}) {
  const curveLength = centerline.getLength()
  const sampleCount = Math.max(8, Math.round(curveLength * SAMPLES_PER_METRE))

  const group = new THREE.Group()
  group.name = 'Track'

  const railMaterial = new THREE.MeshStandardMaterial({ color: RAIL_COLOR, metalness: 0.6, roughness: 0.35 })

  group.add(buildBallast(centerline, closed, sampleCount))
  group.add(buildSleepers(centerline, closed, curveLength))
  group.add(buildRail(centerline, HALF_GAUGE, railMaterial, closed, sampleCount))
  group.add(buildRail(centerline, -HALF_GAUGE, railMaterial, closed, sampleCount))

  const pickMesh = buildPickMesh(centerline, closed, sampleCount)

  return { group, pickMesh, curveLength }
}
