import * as THREE from 'three'

const GAUGE = 1.435
const HALF_GAUGE = GAUGE / 2
const RAIL_RADIUS = 0.07
const RAIL_TOP_Y = 0
const SLEEPER_TOP_Y = RAIL_TOP_Y - RAIL_RADIUS * 2
const SLEEPER_LENGTH = 2.6
const SLEEPER_HEIGHT = 0.22
const SLEEPER_WIDTH = 0.26
const SLEEPER_COUNT = 340
const BALLAST_TOP_Y = SLEEPER_TOP_Y - SLEEPER_HEIGHT
const BALLAST_THICKNESS = 0.3
const BALLAST_TOP_HALF_WIDTH = 1.9
const SAMPLE_COUNT = 300

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
 * Builds a closed curve offset sideways from a centreline by a fixed distance.
 *
 * @param {THREE.CatmullRomCurve3} centerline Closed centreline curve.
 * @param {number} offset Signed sideways displacement in metres.
 * @param {number} sampleCount Number of samples used to approximate the offset curve.
 * @returns {THREE.CatmullRomCurve3} Closed curve offset from the centreline.
 */
function offsetCurve(centerline, offset, sampleCount) {
  const points = []
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount
    const point = centerline.getPointAt(t)
    const tangent = centerline.getTangentAt(t)
    const normal = horizontalNormal(tangent)
    points.push(point.clone().addScaledVector(normal, offset))
  }
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5)
}

/**
 * Builds a single rail as a seamless closed tube following an offset curve.
 *
 * @param {THREE.CatmullRomCurve3} centerline Track centreline.
 * @param {number} offset Signed sideways displacement in metres (negative = inner rail).
 * @param {THREE.Material} material Shared rail material.
 * @returns {THREE.Mesh} Rail mesh, already positioned so its top sits at RAIL_TOP_Y.
 */
function buildRail(centerline, offset, material) {
  const curve = offsetCurve(centerline, offset, SAMPLE_COUNT)
  const geometry = new THREE.TubeGeometry(curve, SAMPLE_COUNT, RAIL_RADIUS, 8, true)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y += RAIL_TOP_Y - RAIL_RADIUS
  return mesh
}

/**
 * Builds the row of sleepers (railway ties) across the whole loop.
 *
 * @param {THREE.CatmullRomCurve3} centerline Track centreline.
 * @returns {THREE.InstancedMesh} One instanced mesh covering every sleeper.
 */
function buildSleepers(centerline) {
  const geometry = new THREE.BoxGeometry(SLEEPER_LENGTH, SLEEPER_HEIGHT, SLEEPER_WIDTH)
  const material = new THREE.MeshStandardMaterial({ color: SLEEPER_COLOR, roughness: 0.9 })
  const mesh = new THREE.InstancedMesh(geometry, material, SLEEPER_COUNT)
  const sleeperCenterY = BALLAST_TOP_Y + SLEEPER_HEIGHT / 2

  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const forward = new THREE.Vector3(0, 0, 1)
  for (let i = 0; i < SLEEPER_COUNT; i++) {
    const t = i / SLEEPER_COUNT
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
 * @param {THREE.CatmullRomCurve3} centerline Track centreline.
 * @returns {THREE.Mesh} Ballast mesh.
 */
function buildBallast(centerline) {
  const positions = []
  const indices = []

  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const t = (i % SAMPLE_COUNT) / SAMPLE_COUNT
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

    if (i < SAMPLE_COUNT) {
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
 * Builds the full oval track: ballast bed, sleepers and two rails.
 *
 * @param {THREE.CatmullRomCurve3} centerline Track centreline curve.
 * @returns {THREE.Group} Group containing every track mesh.
 */
export function buildTrack(centerline) {
  const group = new THREE.Group()
  group.name = 'Track'

  const railMaterial = new THREE.MeshStandardMaterial({ color: RAIL_COLOR, metalness: 0.6, roughness: 0.35 })

  group.add(buildBallast(centerline))
  group.add(buildSleepers(centerline))
  group.add(buildRail(centerline, HALF_GAUGE, railMaterial))
  group.add(buildRail(centerline, -HALF_GAUGE, railMaterial))

  return group
}
