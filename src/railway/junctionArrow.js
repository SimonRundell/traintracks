import * as THREE from 'three'

const ARROW_HEIGHT = 4.4 // metres above rail — just clears the ~3.9m tall rolling stock, without floating far above the track
const TILT_ANGLE = THREE.MathUtils.degToRad(25) // downward pitch, so the direction reads clearly from an isometric angle instead of looking like a flat sliver
const SHAFT_LENGTH = 1.8
const SHAFT_RADIUS = 0.18
const HEAD_LENGTH = 1.2
const HEAD_RADIUS = 0.55
const INACTIVE_SCALE = 0.55 // the route not currently selected draws smaller, so it reads as background
const PICK_RADIUS = 1.8
const ACTIVE_COLOR = 0xe8b339 // matches the control panel's amber accent
const INACTIVE_COLOR = 0x5a5f6b // muted, so the active route is unmistakable at a glance

const LOCAL_FORWARD = new THREE.Vector3(1, 0, 0)

let activeMaterial = null
let inactiveMaterial = null
let pickMaterial = null

/**
 * Lazily creates (and caches) the shared materials, so every junction arrow
 * draws in a couple of batches rather than one material per instance.
 *
 * @returns {{activeMaterial: THREE.Material, inactiveMaterial: THREE.Material, pickMaterial: THREE.Material}} Shared materials.
 */
function getMaterials() {
  if (!activeMaterial) {
    activeMaterial = new THREE.MeshStandardMaterial({
      color: ACTIVE_COLOR,
      emissive: ACTIVE_COLOR,
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.1,
    })
  }
  if (!inactiveMaterial) {
    inactiveMaterial = new THREE.MeshStandardMaterial({
      color: INACTIVE_COLOR,
      roughness: 0.8,
      metalness: 0,
      transparent: true,
      opacity: 0.55,
    })
  }
  if (!pickMaterial) {
    pickMaterial = new THREE.MeshBasicMaterial({ visible: false })
  }
  return { activeMaterial, inactiveMaterial, pickMaterial }
}

/**
 * Builds one route's cone-and-shaft arrow, parented under its own yaw group
 * so it can be aimed independently of the other route.
 *
 * @param {THREE.Group} parent Tilt group to add the route under.
 * @param {THREE.Material} material Initial material (reassigned per-route on every placeJunctionArrow call).
 * @returns {{yawGroup: THREE.Group, shaft: THREE.Mesh, head: THREE.Mesh}} The route's parts.
 */
function buildRoute(parent, material) {
  const yawGroup = new THREE.Group()
  parent.add(yawGroup)

  const shaftGeometry = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 10)
  const shaft = new THREE.Mesh(shaftGeometry, material)
  shaft.rotation.z = Math.PI / 2
  shaft.position.x = SHAFT_LENGTH / 2
  yawGroup.add(shaft)

  const headGeometry = new THREE.ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 12)
  const head = new THREE.Mesh(headGeometry, material)
  head.rotation.z = -Math.PI / 2
  head.position.x = SHAFT_LENGTH + HEAD_LENGTH / 2
  yawGroup.add(head)

  return { yawGroup, shaft, head }
}

/**
 * Builds a floating switch indicator showing both of a junction's routes at
 * once — not just the selected one — so the choice itself is visible, not
 * just its current state: the selected route draws full size in bright
 * amber, the other draws smaller and dimmed, the way a track diagram shows
 * a whole point with one leg highlighted. Both are pitched down at a fixed
 * angle so their direction reads clearly from an isometric camera. A
 * generous invisible pick sphere covers the whole thing so it's easy to
 * click regardless of which way either route currently points.
 *
 * @returns {{group: THREE.Group, pickMesh: THREE.Mesh, routes: {yawGroup: THREE.Group, shaft: THREE.Mesh, head: THREE.Mesh}[]}} The visible group (to add to the scene), its pick target, and the two routes (for placeJunctionArrow to aim and style).
 */
export function createJunctionArrow() {
  const { inactiveMaterial } = getMaterials()

  const group = new THREE.Group()
  group.position.y = ARROW_HEIGHT

  // The tilt lives on an inner group so it stays fixed (always pitching
  // toward the ground) regardless of how each route is later yawed to aim
  // at its own direction — a Y-axis yaw leaves local Z mapped to a
  // horizontal world direction, not vertical, so the downward pitch has to
  // be applied here, inside the frame that still has local Y aligned with
  // world up.
  const tiltGroup = new THREE.Group()
  tiltGroup.rotation.z = -TILT_ANGLE
  group.add(tiltGroup)

  const routes = [buildRoute(tiltGroup, inactiveMaterial), buildRoute(tiltGroup, inactiveMaterial)]

  const pickGeometry = new THREE.SphereGeometry(PICK_RADIUS, 10, 8)
  const pickMesh = new THREE.Mesh(pickGeometry, pickMaterial ?? getMaterials().pickMaterial)
  pickMesh.position.set(0, ARROW_HEIGHT, 0)

  return { group, pickMesh, routes }
}

/**
 * Aims both of a junction's routes at their directions and styles them by
 * which one is active: full size and bright amber for the selected route,
 * smaller and dimmed for the other. Also (re)positions the group and pick
 * mesh, so this is the only function needed both at creation and on toggle.
 *
 * @param {Object} junction A junction as built by trackBuilder.js — needs position, directions, activeIndex, group, pickMesh, and routes.
 * @returns {void}
 */
export function placeJunctionArrow(junction) {
  const { group, pickMesh, routes, position, directions, activeIndex } = junction
  const { activeMaterial, inactiveMaterial } = getMaterials()

  group.position.set(position.x, position.y + ARROW_HEIGHT, position.z)
  pickMesh.position.set(position.x, position.y + ARROW_HEIGHT, position.z)
  pickMesh.updateMatrixWorld(true)

  directions.forEach((direction, i) => {
    const route = routes[i]
    route.yawGroup.quaternion.setFromUnitVectors(LOCAL_FORWARD, direction)
    const isActive = i === activeIndex
    const material = isActive ? activeMaterial : inactiveMaterial
    route.shaft.material = material
    route.head.material = material
    route.yawGroup.scale.setScalar(isActive ? 1 : INACTIVE_SCALE)
  })
}

/**
 * Frees the shared materials. Only safe to call once nothing will create
 * another junction arrow afterwards (e.g. on full scene teardown).
 *
 * @returns {void}
 */
export function disposeSharedJunctionMaterials() {
  activeMaterial?.dispose()
  inactiveMaterial?.dispose()
  pickMaterial?.dispose()
  activeMaterial = null
  inactiveMaterial = null
  pickMaterial = null
}
