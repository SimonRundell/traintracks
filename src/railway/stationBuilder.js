import * as THREE from 'three'
import { loadModel } from './rollingStock.js'
import { PLATFORM_SECTION_LENGTH, PLATFORM_TOP_Y } from './platform.js'

export const STATION_TYPES = [
  { key: 'station-001', label: 'Station Building C', url: '/models/station-001.glb' },
  { key: 'station-002', label: 'Station Building A', url: '/models/station-002.glb' },
  { key: 'station-003', label: 'Station Building B', url: '/models/station-003.glb' },
]

const MAGNET_RADIUS = 10 // metres from a drag's live cursor to a platform section's own midpoint, within which it's a valid landing target
const PREVIEW_COLOR = 0x5eead4
const PREVIEW_OPACITY = 0.55

/**
 * @typedef {Object} StationFit
 * @property {THREE.Vector3} lengthAxis Unit vector along the model's own longer horizontal bounding-box axis — the one mapped onto a platform's tangent.
 * @property {number} scale Uniform scale factor that makes that axis span exactly one platform section.
 * @property {THREE.Vector3} localAnchor The model's own bounding-box point to place at the platform's surface — horizontally centred, vertically at the box's lowest point — so "fit" always means "resting on the platform", never guessed from the model's own origin.
 */

/**
 * Measures a freshly-loaded station model (still at its native scale and identity transform) and works out
 * how to fit it onto one platform section, without trusting anything about the glTF's own authored scale,
 * origin, or orientation — the exact assumptions that went wrong the first time this was attempted. The
 * model's longer horizontal footprint axis becomes its "length", scaled to match a platform section exactly;
 * its bounding box's lowest point becomes the contact point placed at the platform's walking surface.
 *
 * @param {THREE.Object3D} template Loaded glTF scene root, not yet added to a scene.
 * @returns {StationFit}
 */
function measureFit(template) {
  const box = new THREE.Box3().setFromObject(template)
  const size = new THREE.Vector3()
  box.getSize(size)
  const center = new THREE.Vector3()
  box.getCenter(center)
  const lengthAxis = size.x >= size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
  const lengthDim = Math.max(size.x, size.z)
  const scale = PLATFORM_SECTION_LENGTH / lengthDim
  const localAnchor = new THREE.Vector3(center.x, box.min.y, center.z)
  return { lengthAxis, scale, localAnchor }
}

const fitCache = new Map() // key -> Promise<{template, fit}> — module-level and shared with deserialization (see buildStationInstance) so a saved layout's stations reuse whatever the drawer has already loaded, rather than fetching the same glb twice

/**
 * Loads and measures a station type once, caching the promise so repeated placements of the same item
 * reuse it — including a fresh builder created after an old one's dispose() cleared this cache, which
 * reloads on demand exactly like platform.js's own shared material.
 *
 * @param {string} key
 * @returns {Promise<{template: THREE.Object3D, fit: StationFit}>}
 */
function loadFit(key) {
  if (!fitCache.has(key)) {
    const def = STATION_TYPES.find((entry) => entry.key === key)
    fitCache.set(
      key,
      loadModel(def.url).then((template) => ({ template, fit: measureFit(template) })),
    )
  }
  return fitCache.get(key)
}

/**
 * Builds one placed station instance: a clone of the loaded template, scaled and rotated per its fit, and
 * positioned so the fit's localAnchor — the model's own lowest, horizontally-centred point — lands exactly
 * at the given platform section's midpoint, resting on its walking surface.
 *
 * The model's own "front" (which side its doors/canopy face) can't be known from its bounding box, so
 * fitting it only pins its ridge line to run along the platform — which of the two directions along that
 * line it faces is a 180°, yaw-only ambiguity left to `facing`. See rotateStation, which lets the user flip
 * it once it's visibly backwards.
 *
 * @param {{template: THREE.Object3D, fit: StationFit}} ready Resolved load for one station key.
 * @param {import('./platformBuilder.js').PlatformSection} platform Platform section to sit on.
 * @param {1 | -1} [facing] Which way along the platform's tangent the model's length axis points.
 * @returns {THREE.Object3D}
 */
function buildInstance(ready, platform, facing = 1) {
  const { template, fit } = ready
  const group = template.clone(true)
  group.scale.setScalar(fit.scale)
  const target = facing === -1 ? platform.tangent.clone().negate() : platform.tangent
  group.quaternion.setFromUnitVectors(fit.lengthAxis, target)
  const mid = platform.start.clone().addScaledVector(platform.tangent, PLATFORM_SECTION_LENGTH / 2)
  const anchorWorld = new THREE.Vector3(mid.x, PLATFORM_TOP_Y, mid.z)
  const worldOffset = fit.localAnchor.clone().applyQuaternion(group.quaternion).multiplyScalar(fit.scale)
  group.position.copy(anchorWorld).sub(worldOffset)
  return group
}

/**
 * Swaps every mesh in a station instance to a shared translucent preview material, and returns a disposer
 * for those (instance-specific, unlike the shared geometry) materials.
 *
 * @param {THREE.Object3D} group
 * @returns {void}
 */
function applyPreviewMaterial(group) {
  group.traverse((child) => {
    if (child.isMesh) child.material = new THREE.MeshBasicMaterial({ color: PREVIEW_COLOR, transparent: true, opacity: PREVIEW_OPACITY })
  })
}

/**
 * Disposes the per-instance materials created by applyPreviewMaterial. Never disposes geometry — every
 * instance (preview or committed) shares its geometry buffers with the cached template via Object3D.clone,
 * which copies mesh geometry by reference, not by value.
 *
 * @param {THREE.Object3D} group
 * @returns {void}
 */
function disposePreviewMaterials(group) {
  group.traverse((child) => {
    if (child.isMesh) child.material.dispose()
  })
}

/**
 * Loads (or reuses) a station's fit and builds one instance on the given platform section — the async
 * counterpart to buildInstance, for rebuilding a saved layout's stations where there's no drag in progress
 * to wait on. See layoutSerializer.js's deserializeStations. Returns the resolved `ready` alongside the
 * built group so the caller can store it on the instance for later re-use by rotateStation, without having
 * to re-await loadFit (already resolved by now) just to flip it.
 *
 * @param {string} key
 * @param {import('./platformBuilder.js').PlatformSection} platform
 * @param {1 | -1} [facing]
 * @returns {Promise<{group: THREE.Object3D, ready: {template: THREE.Object3D, fit: StationFit}}>}
 */
export function buildStationInstance(key, platform, facing = 1) {
  return loadFit(key).then((ready) => ({ group: buildInstance(ready, platform, facing), ready }))
}

/**
 * @typedef {Object} StationInstance
 * @property {number} id
 * @property {string} key Which STATION_TYPES entry this is.
 * @property {THREE.Vector3} start The platform section's own start this was placed on, at placement time.
 * @property {THREE.Vector3} tangent The platform section's own tangent this was placed on, at placement time.
 * @property {1 | -1} facing Which way along `tangent` the model currently faces — see buildInstance.
 * @property {{template: THREE.Object3D, fit: StationFit}} ready This station's resolved load, kept around so rotateStation can rebuild it without reloading.
 * @property {THREE.Object3D} group Visible model instance, already added to the scene.
 */

/**
 * Sets up LAY-mode station-building placement: drag a station item from the drawer onto an existing
 * platform section, the same drag-and-drop gesture as track pieces and platform sections. A station always
 * lands exactly on one platform section — its footprint is fit to the section's own length, so there's no
 * freeform positioning the way platforms-beside-track have, only "which section". Right-clicking a station
 * removes just that one, as with every other LAY-mode asset; left-clicking one flips it 180° along the
 * platform, for when it lands facing the wrong way (see rotateStation — there's no way to know a glTF's own
 * "front" from its bounding box alone, so this is a user correction, not something placement gets right by
 * construction).
 *
 * Like platforms, stations don't join the track graph and aren't a standing relationship with the platform
 * they sit on — the snap is computed once at placement time (captured as this instance's own start/tangent,
 * copied from that platform section), so deleting or moving the underlying platform afterwards doesn't
 * retroactively affect a station already placed on it.
 *
 * @param {Object} deps
 * @param {THREE.Scene} deps.scene Scene to add new station model instances to.
 * @param {THREE.Camera} deps.camera Active camera, used for raycasting.
 * @param {HTMLElement} deps.domElement Canvas element to listen on.
 * @param {import('./platformBuilder.js').PlatformSection[]} deps.platforms Shared, live list of platform sections — read-only here, to find a section to land on.
 * @param {StationInstance[]} deps.stations Shared, mutable list of placed stations; new ones are pushed here, removed ones spliced out.
 * @returns {{setEnabled: (value: boolean) => void, beginDrag: (key: string) => void, updateDrag: (clientX: number, clientY: number) => void, endDrag: (commit: boolean) => void, dispose: () => void}} Control handle.
 */
export function createStationBuilder({ scene, camera, domElement, platforms, stations }) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  let enabled = false
  let nextId = 1
  let drag = null // { key, target: PlatformSection | null, previewObject: THREE.Object3D | null, ready: {template, fit} | null, lastClient: {x, y} | null }

  // Preload every station type eagerly, so by the time anyone actually drags one from the drawer it's
  // almost always already resolved (loadFit's cache is shared at module scope — see its own doc comment).
  STATION_TYPES.forEach((entry) => loadFit(entry.key))

  /**
   * Finds the nearest flat platform section to a live drag point, within MAGNET_RADIUS of its midpoint —
   * a station always occupies a whole section, so "nearest section" is the only thing that needs deciding.
   * Ramps (sloped, see platformBuilder.js) are never a valid landing spot — there's no sensible way to
   * rest a building's flat base on one.
   *
   * @param {THREE.Vector3} ground Live drag point on the ground plane.
   * @returns {import('./platformBuilder.js').PlatformItem | null}
   */
  function findPlatformTarget(ground) {
    let best = null
    let bestDist = MAGNET_RADIUS
    for (const platform of platforms) {
      if (platform.kind !== 'section') continue
      const mid = platform.start.clone().addScaledVector(platform.tangent, PLATFORM_SECTION_LENGTH / 2)
      const dist = mid.distanceTo(ground)
      if (dist < bestDist) {
        best = platform
        bestDist = dist
      }
    }
    return best
  }

  /**
   * Rebuilds the drag's preview instance from its current target and loaded model. No target, or the
   * model hasn't finished loading yet, means no preview.
   *
   * @returns {void}
   */
  function updatePreview() {
    if (drag.previewObject) {
      scene.remove(drag.previewObject)
      disposePreviewMaterials(drag.previewObject)
      drag.previewObject = null
    }
    if (!drag.target || !drag.ready) return
    const group = buildInstance(drag.ready, drag.target)
    applyPreviewMaterial(group)
    drag.previewObject = group
    scene.add(group)
  }

  /**
   * Updates an in-progress drag from the pointer's current screen position — mirrors platformBuilder.js's
   * own updateDrag. Remembers the last pointer position so a preview can appear retroactively once a
   * still-loading model's fit resolves mid-drag.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @returns {void}
   */
  function updateDrag(clientX, clientY) {
    if (!drag) return
    drag.lastClient = { x: clientX, y: clientY }
    if (!drag.ready) return
    const rect = domElement.getBoundingClientRect()
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const ground = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(groundPlane, ground)) return
    drag.target = findPlatformTarget(ground)
    updatePreview()
  }

  /**
   * Raycasts against every placed station's own model (recursively, since each is a multi-mesh glTF group)
   * and returns the closest hit's owning instance.
   *
   * @returns {StationInstance | null}
   */
  function pickStation() {
    raycaster.setFromCamera(pointer, camera)
    const groups = stations.map((station) => station.group)
    const hits = raycaster.intersectObjects(groups, true)
    if (hits.length === 0) return null
    let object = hits[0].object
    while (object && !groups.includes(object)) object = object.parent
    return stations.find((station) => station.group === object) ?? null
  }

  /**
   * Right-click handling: deletes whichever station was clicked, if any.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleContextMenu(event) {
    if (!enabled) return
    const rect = domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    const station = pickStation()
    if (!station) return
    event.preventDefault()
    scene.remove(station.group)
    const index = stations.indexOf(station)
    if (index !== -1) stations.splice(index, 1)
  }

  /**
   * Flips a station 180° along the platform it sits on — the fix for a model whose "front" turned out to
   * face the wrong way once placed (its own bounding box gives no way to know that up front). Rebuilds the
   * instance in place from its own already-resolved `ready`, so this is synchronous, no reload involved.
   *
   * @param {StationInstance} station
   * @returns {void}
   */
  function rotateStation(station) {
    const facing = station.facing === 1 ? -1 : 1
    const group = buildInstance(station.ready, { start: station.start, tangent: station.tangent }, facing)
    scene.remove(station.group)
    station.group = group
    station.facing = facing
    scene.add(group)
  }

  /**
   * Left-click handling: rotates whichever station was clicked, if any — the LAY-mode-only click-to-toggle
   * pattern trackBuilder.js already uses for dead-end markers.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleClick(event) {
    if (!enabled) return
    const rect = domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    const station = pickStation()
    if (!station) return
    rotateStation(station)
  }

  domElement.addEventListener('contextmenu', handleContextMenu)
  domElement.addEventListener('click', handleClick)

  return {
    /**
     * Arms or disarms station placement. Disabling cancels any in-progress drag.
     *
     * @param {boolean} value True to arm (LAY mode), false to disarm (PLAY mode).
     * @returns {void}
     */
    setEnabled(value) {
      if (value === enabled) return
      enabled = value
      if (!enabled && drag) {
        if (drag.previewObject) {
          scene.remove(drag.previewObject)
          disposePreviewMaterials(drag.previewObject)
        }
        drag = null
      }
    },

    /**
     * Starts a station drag for one of STATION_TYPES' keys. Call once the drawer's own pointer-drag
     * threshold is crossed; follow with repeated updateDrag calls as the pointer moves, and exactly one
     * endDrag to finish.
     *
     * @param {string} key
     * @returns {void}
     */
    beginDrag(key) {
      drag = { key, target: null, previewObject: null, ready: null, lastClient: null }
      loadFit(key).then((ready) => {
        if (!drag || drag.key !== key) return // drag already ended, or moved on to a different item, before this resolved
        drag.ready = ready
        if (drag.lastClient) updateDrag(drag.lastClient.x, drag.lastClient.y)
      })
    },

    updateDrag,

    /**
     * Ends an in-progress drag, either committing a new station at its current target or discarding it.
     *
     * @param {boolean} commit True to place the station at the current target; false to cancel outright.
     * @returns {void}
     */
    endDrag(commit) {
      if (!drag) return
      const { key, target, ready } = drag
      if (drag.previewObject) {
        scene.remove(drag.previewObject)
        disposePreviewMaterials(drag.previewObject)
      }
      drag = null
      if (!commit || !target || !ready) return

      const group = buildInstance(ready, target, 1)
      scene.add(group)
      stations.push({ id: nextId++, key, start: target.start.clone(), tangent: target.tangent.clone(), facing: 1, ready, group })
    },

    /**
     * Removes the contextmenu listener, cancels any in-progress drag, and frees every cached template's
     * geometry and materials, clearing the shared cache so a later builder reloads fresh — matches
     * platform.js's disposeSharedPlatformMaterial. Does not remove already-committed stations from the
     * scene — matches platformBuilder.js's own dispose, which leaves that to the caller.
     *
     * @returns {void}
     */
    dispose() {
      domElement.removeEventListener('contextmenu', handleContextMenu)
      domElement.removeEventListener('click', handleClick)
      if (drag?.previewObject) {
        scene.remove(drag.previewObject)
        disposePreviewMaterials(drag.previewObject)
      }
      fitCache.forEach((promise) => {
        promise.then(({ template }) => {
          template.traverse((child) => {
            if (child.isMesh) {
              child.geometry.dispose()
              child.material.dispose()
            }
          })
        })
      })
      fitCache.clear()
    },
  }
}
