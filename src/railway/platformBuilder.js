import * as THREE from 'three'
import { closestPointOnCurve } from './curveMath.js'
import { createPlatformMesh, disposeSharedPlatformMaterial, OFFSET_FROM_TRACK, platformItemLength } from './platform.js'

const MAGNET_RADIUS = 20 // metres — how far from a drag's live cursor position to look for straight track to snap beside, matching trackBuilder.js's own drag magnet radius for a consistent feel
const CHAIN_SNAP_TOLERANCE = 4 // metres — how close a drag has to land to an existing section's free end to chain onto it, matching trackBuilder.js's SNAP_POSITION_TOLERANCE
const PREVIEW_COLOR = 0x5eead4

// Drawer item key -> platform item kind (see platform.js's createPlatformMesh/platformItemLength).
const KIND_BY_KEY = {
  'platform-section': 'section',
  'platform-ramp-left': 'ramp-left',
  'platform-ramp-right': 'ramp-right',
}

/**
 * @typedef {Object} PlatformItem
 * @property {number} id
 * @property {'section' | 'ramp-left' | 'ramp-right'} kind
 * @property {THREE.Vector3} start World-space start of this item's own centreline — see platform.js's createPlatformMesh for what "start" means for each kind.
 * @property {THREE.Vector3} tangent Unit heading the item runs along, start to end.
 * @property {THREE.Mesh} mesh Visible mesh, already added to the scene.
 */

/**
 * Sets up LAY-mode platform placement: drag a "Platform Section" or "Platform Ramp" item from the drawer
 * onto the layout, the same drag-and-drop gesture as a track piece (see trackBuilder.js's beginDrawerDrag).
 * An item snaps onto the free end of an existing one if dropped near it — so a platform grows by chaining
 * items end to end (a flat section is exactly PLATFORM_SECTION_LENGTH; a ramp is exactly RAMP_LENGTH, and
 * slopes from platform height down to the ground, for capping a run's open end) — or beside a straight
 * piece of track if not (never a curve; a platform alongside a curve would need to be curved itself, which
 * isn't supported). Right-clicking an item removes just that one.
 *
 * Platforms don't carry trains and don't join the track graph at all — snapping is purely visual/
 * positional, computed once at placement time, not maintained as an ongoing relationship the way track
 * pieces' links are. So unlike trackBuilder.js there's no dangling-end bookkeeping here: an item is either
 * on the layout or it isn't, and deleting one never affects its neighbours' own geometry.
 *
 * @param {Object} deps
 * @param {THREE.Scene} deps.scene Scene to add new platform item meshes to.
 * @param {THREE.Camera} deps.camera Active camera, used for raycasting.
 * @param {HTMLElement} deps.domElement Canvas element to listen on.
 * @param {import('./trackBuilder.js').TrackPiece[]} deps.pieces Shared, live list of track pieces — read-only here, to find straight track to snap beside.
 * @param {PlatformItem[]} deps.platforms Shared, mutable list of platform items; new ones are pushed here, removed ones spliced out.
 * @returns {{setEnabled: (value: boolean) => void, beginDrag: (key: string) => void, updateDrag: (clientX: number, clientY: number) => void, endDrag: (commit: boolean) => void, dispose: () => void}} Control handle.
 */
export function createPlatformBuilder({ scene, camera, domElement, pieces, platforms }) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  let enabled = false
  let nextId = 1
  let drag = null // { kind, target: {start: Vector3, tangent: Vector3} | null, previewMesh: THREE.Mesh | null }

  /**
   * Finds the nearest free end of an existing platform item to a live drag point, within
   * CHAIN_SNAP_TOLERANCE — the new item continues from there in the same direction, so the two butt up
   * exactly, end to end, regardless of either one's own kind/length.
   *
   * @param {THREE.Vector3} ground Live drag point on the ground plane.
   * @param {number} newLength Length of the item currently being dragged — only needed for the backward
   *   case (extending off an existing item's *start*), where the new item's own far end must land exactly
   *   on that point, so where its own start goes depends on how long it itself is.
   * @returns {{start: THREE.Vector3, tangent: THREE.Vector3} | null}
   */
  function findChainTarget(ground, newLength) {
    let best = null
    let bestDistSq = CHAIN_SNAP_TOLERANCE * CHAIN_SNAP_TOLERANCE
    for (const platform of platforms) {
      const existingLength = platformItemLength(platform.kind)
      const end = platform.start.clone().addScaledVector(platform.tangent, existingLength)
      const endDistSq = end.distanceToSquared(ground)
      if (endDistSq < bestDistSq) {
        best = { start: end, tangent: platform.tangent.clone() }
        bestDistSq = endDistSq
      }
      const startDistSq = platform.start.distanceToSquared(ground)
      if (startDistSq < bestDistSq) {
        best = { start: platform.start.clone().addScaledVector(platform.tangent, -newLength), tangent: platform.tangent.clone() }
        bestDistSq = startDistSq
      }
    }
    return best
  }

  /**
   * Finds the nearest point on a straight piece of track to a live drag point, within MAGNET_RADIUS, and
   * works out which side of it the cursor is currently on — the new item centres there, offset sideways by
   * OFFSET_FROM_TRACK.
   *
   * @param {THREE.Vector3} ground Live drag point on the ground plane.
   * @param {number} newLength Length of the item currently being dragged, to centre it along the track.
   * @returns {{start: THREE.Vector3, tangent: THREE.Vector3} | null}
   */
  function findTrackTarget(ground, newLength) {
    let best = null
    let bestDist = MAGNET_RADIUS
    for (const piece of pieces) {
      if (!piece.curve.isLineCurve3) continue // platforms only ever run beside straight track
      const closest = closestPointOnCurve(piece.curve, ground, { closed: false })
      if (closest.distance >= bestDist) continue
      best = { point: closest.point, tangent: piece.curve.getTangentAt(closest.t) }
      bestDist = closest.distance
    }
    if (!best) return null

    const normal = new THREE.Vector3(-best.tangent.z, 0, best.tangent.x).normalize()
    const toCursor = new THREE.Vector3().subVectors(ground, best.point)
    const side = normal.dot(toCursor) >= 0 ? 1 : -1
    const centre = best.point.clone().addScaledVector(normal, side * OFFSET_FROM_TRACK)
    const start = centre.addScaledVector(best.tangent, -newLength / 2)
    return { start, tangent: best.tangent.clone() }
  }

  /**
   * Rebuilds the drag's preview mesh from its current target. No target (nothing in range) means no
   * preview, signalling that releasing here won't place anything.
   *
   * @returns {void}
   */
  function updatePreview() {
    if (drag.previewMesh) {
      scene.remove(drag.previewMesh)
      drag.previewMesh.geometry.dispose()
      drag.previewMesh = null
    }
    if (!drag.target) return
    const mesh = createPlatformMesh(drag.kind, drag.target.start, drag.target.tangent)
    mesh.material = new THREE.MeshBasicMaterial({ color: PREVIEW_COLOR, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    drag.previewMesh = mesh
    scene.add(mesh)
  }

  /**
   * Raycasts against every platform section's own visible mesh (no separate pick mesh needed — a
   * platform's box is large enough to click reliably, unlike the thin rails) and returns the closest hit.
   *
   * @returns {PlatformSection | null}
   */
  function pickPlatform() {
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(
      platforms.map((platform) => platform.mesh),
      false,
    )
    if (hits.length === 0) return null
    return platforms.find((platform) => platform.mesh === hits[0].object)
  }

  /**
   * Right-click handling: deletes whichever platform section was clicked, if any. Independent of
   * trackBuilder.js's own contextmenu handler — the two never hit the same geometry (platforms are
   * deliberately offset clear of the track), so there's nothing to coordinate; trackBuilder.js's handler
   * already suppresses the native menu whenever LAY mode is armed, so this one doesn't need to.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleContextMenu(event) {
    if (!enabled) return
    const rect = domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    const platform = pickPlatform()
    if (!platform) return
    event.preventDefault()
    scene.remove(platform.mesh)
    platform.mesh.geometry.dispose()
    const index = platforms.indexOf(platform)
    if (index !== -1) platforms.splice(index, 1)
  }

  domElement.addEventListener('contextmenu', handleContextMenu)

  return {
    /**
     * Arms or disarms platform placement. Disabling cancels any in-progress drag.
     *
     * @param {boolean} value True to arm (LAY mode), false to disarm (PLAY mode).
     * @returns {void}
     */
    setEnabled(value) {
      if (value === enabled) return
      enabled = value
      if (!enabled && drag) {
        if (drag.previewMesh) {
          scene.remove(drag.previewMesh)
          drag.previewMesh.geometry.dispose()
        }
        drag = null
      }
    },

    /**
     * Starts a platform drag for one of the drawer's platform item keys (see KIND_BY_KEY). Call once the
     * drawer's own pointer-drag threshold is crossed; follow with repeated updateDrag calls as the pointer
     * moves, and exactly one endDrag to finish.
     *
     * @param {string} key
     * @returns {void}
     */
    beginDrag(key) {
      drag = { kind: KIND_BY_KEY[key], target: null, previewMesh: null }
    },

    /**
     * Updates an in-progress drag from the pointer's current screen position — see trackBuilder.js's
     * updateDrawerDrag, this is the platform equivalent.
     *
     * @param {number} clientX
     * @param {number} clientY
     * @returns {void}
     */
    updateDrag(clientX, clientY) {
      if (!drag) return
      const rect = domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const ground = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(groundPlane, ground)) return
      const newLength = platformItemLength(drag.kind)
      drag.target = findChainTarget(ground, newLength) ?? findTrackTarget(ground, newLength)
      updatePreview()
    },

    /**
     * Ends an in-progress drag, either committing a new item at its current target or discarding it.
     *
     * @param {boolean} commit True to place the item at the current target; false to cancel outright.
     * @returns {void}
     */
    endDrag(commit) {
      if (!drag) return
      const { kind, target } = drag
      if (drag.previewMesh) {
        scene.remove(drag.previewMesh)
        drag.previewMesh.geometry.dispose()
      }
      drag = null
      if (!commit || !target) return

      const mesh = createPlatformMesh(kind, target.start, target.tangent)
      scene.add(mesh)
      platforms.push({ id: nextId++, kind, start: target.start, tangent: target.tangent, mesh })
    },

    /**
     * Removes the contextmenu listener and frees every platform section's geometry and the shared
     * material. Does not remove already-committed sections from the scene — matches trackBuilder.js's own
     * dispose, which leaves that to the caller.
     *
     * @returns {void}
     */
    dispose() {
      domElement.removeEventListener('contextmenu', handleContextMenu)
      if (drag?.previewMesh) {
        scene.remove(drag.previewMesh)
        drag.previewMesh.geometry.dispose()
      }
      platforms.forEach((platform) => platform.mesh.geometry.dispose())
      disposeSharedPlatformMaterial()
    },
  }
}
