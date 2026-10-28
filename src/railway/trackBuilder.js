import * as THREE from 'three'
import { closestPointOnCurve } from './curveMath.js'
import { buildTrackMeshes } from './track.js'
import { disposeSharedJunctionMaterials, placeJunctionArrow } from './junctionArrow.js'
import { createDeadEndMarker, disposeSharedDeadEndMaterial } from './deadEndMarker.js'
import { linkPieceEnds, buildJunction } from './trackGraph.js'
import { freeCandidates, forkCandidates, closestCandidate } from './pieceCandidates.js'
import { POINT_DIVERGE_ANGLE, Y_POINT_HALF_ANGLE } from './trackCatalogue.js'

const MIN_DRAG_DISTANCE = 2 // metres — the cursor has to move at least this far from the start point for a drag to count as deliberate, not a stray click. Every catalogue piece is already far longer than this, so this gates intent, not the resulting piece's size.
const SNAP_POSITION_TOLERANCE = 4 // metres — how close a piece's end has to land to another piece's curve to auto-join it, whether that lands it on a free end (a plain link) or mid-piece (a fork — see findConnection)
const SNAP_ANGLE_TOLERANCE = THREE.MathUtils.degToRad(8) // how close to parallel (for a plain link) or to a real point/Y-point's diverge angle (for a fork) the two tangents have to be — catalogue pieces are rigid, so unlike the old free-form drag nothing ever bends to fit
const MAGNET_RADIUS = 20 // metres — how far from the cursor to look for a landing spot worth actively aiming a candidate at, so rejoining existing track doesn't require pixel-perfect aim against a fixed-geometry piece
const FREE_END_PROXIMITY = 3 // metres — within this of an open piece's free end counts as "the end itself"
const PREVIEW_SAMPLES = 24
const PREVIEW_RADIUS = 0.35
const PREVIEW_COLOR = 0x5eead4
const EDGE_PAN_MARGIN = 72 // pixels from the canvas edge that trigger panning during an active drag
const EDGE_PAN_PIXELS_PER_SECOND = 900 // pan rate at full margin intrusion, in screen pixels — converted to world units by the current zoom, so it feels the same regardless of how far zoomed in

/**
 * @typedef {Object} PieceLink
 * @property {TrackPiece} piece The piece this end continues onto.
 * @property {'start' | 'end'} end Which end of `piece` it continues onto — 'start' means arriving at that piece's t=0 (so travel continues there with direction +1); 'end' means arriving at its t=1 (direction -1).
 */

/**
 * @typedef {Object} TrackPiece
 * @property {number} id
 * @property {THREE.Curve} curve
 * @property {boolean} closed
 * @property {THREE.Group} group Visible meshes, already added to the scene.
 * @property {THREE.Mesh} pickMesh Invisible mesh used for raycasting, not added to the scene.
 * @property {Junction[]} junctions Switch points this piece created (removed together with it on undo).
 * @property {{start: PieceLink | null, end: PieceLink | null}} links Unconditional, switch-free continuations onto whatever was built contiguously from this piece's two ends (see pathWalker.js's stepPath) — distinct from `junctions`, which are actual forks with a choice to make. Plain extension of an existing piece, or snapping onto another piece's free end, sets these instead of creating a junction.
 * @property {THREE.Mesh | null} [endMarker] Floating dead-end marker over this piece's far (t=1) end, present only while that end is genuinely unconnected — see deadEndMarker.js. Never relevant for a piece's own t=0: that's always resolved (link or fork) at creation. Absent on pieces not built by trackBuilder.js (e.g. the starter oval, whose every end is always linked).
 */

/**
 * @typedef {Object} Junction
 * @property {number} id
 * @property {THREE.Vector3} position Where the arrow sits — beyond the fork itself, at the point where its two routes have visibly parted (see PARTING_SEPARATION), not at the branch vertex where they're still coincident.
 * @property {THREE.Vector3[]} directions The two directions the arrow can point.
 * @property {number} activeIndex Which of `directions` is currently shown/selected: 0 = pass straight through on the host piece, 1 = divert.
 * @property {THREE.Group} group Visible arrow, already added to the scene.
 * @property {THREE.Mesh} pickMesh Invisible click target, not added to the scene.
 * @property {{yawGroup: THREE.Group, shaft: THREE.Mesh, head: THREE.Mesh}[]} routes The two routes' arrow parts, for placeJunctionArrow to aim and style.
 * @property {TrackPiece} hostPiece The piece a train passes straight through on when this switch is at index 0.
 * @property {number} hostT Parameter on hostPiece where the switch sits.
 * @property {1 | -1} requiredHostDirection The only hostPiece travel direction for which diverting is velocity-continuous — a point built by dragging off at an angle is only a real fork from one side; from the other, the "branch" would require an instantaneous reversal, so it's ignored rather than offered.
 * @property {TrackPiece} divertPiece The piece a train is sent onto when this switch is thrown to index 1.
 * @property {number} divertT Parameter on divertPiece to continue from.
 * @property {1 | -1} divertDirection Direction of travel to continue in on divertPiece.
 */

/**
 * Disposes every geometry/material under a group, plus the group itself.
 * Not safe for junction arrows, whose materials are shared between instances
 * — use disposeJunction for those.
 *
 * @param {THREE.Object3D} root Root object to dispose.
 * @returns {void}
 */
function disposeDeep(root) {
  root.traverse((object) => {
    if (object.geometry) object.geometry.dispose()
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => material.dispose())
    }
  })
}

/**
 * Picks which way a new branch should leave its source tangent: +1 to carry
 * on the same way the source piece was already heading, -1 to leave
 * backwards instead. Re-evaluated from the live cursor position on every
 * move (not locked in once), so the default is always to continue in the
 * same direction, swapping only if the cursor is clearly on the other side.
 *
 * @param {THREE.Vector3} rawTangent Source piece's tangent at the branch point.
 * @param {THREE.Vector3} start Branch point.
 * @param {THREE.Vector3} target Live drag target.
 * @returns {1 | -1} Sign to multiply rawTangent by.
 */
function pickTangentSign(rawTangent, start, target) {
  const toTarget = new THREE.Vector3().subVectors(target, start)
  if (toTarget.lengthSq() < 1e-6) return 1 // no meaningful direction yet — default to continuing forward
  return rawTangent.dot(toTarget) >= 0 ? 1 : -1
}

/**
 * Whether a point on a piece is at (or effectively at) its free end — the
 * tip of an open piece where nothing continues past it yet. Building from a
 * free end is a plain continuation with nowhere else to compete with, not a
 * choice between routes, so it gets a switch-free link (see TrackPiece.links)
 * instead of a junction. An end that's already linked no longer counts as
 * free — a third piece arriving there is a genuine fork and needs a proper
 * junction, same as branching off the middle of a piece would. A closed loop
 * (the main oval) has no free end — every point on it continues both ways.
 *
 * @param {TrackPiece} piece Piece the point is on.
 * @param {number} t Parameter on that piece's curve.
 * @returns {boolean} True if building from here is just an extension, not a branch.
 */
function isAtFreeEnd(piece, t) {
  if (piece.closed) return false
  const length = piece.curve.getLength()
  if (t * length < FREE_END_PROXIMITY) return !piece.links.start
  if ((1 - t) * length < FREE_END_PROXIMITY) return !piece.links.end
  return false
}

/**
 * Sets up interactive click-and-drag track laying on top of an existing
 * Three.js scene: dragging from a piece of existing track lays one piece
 * from the real Setrack-derived catalogue (trackCatalogue.js) — whichever
 * straight length or curve radius (dragging from a free end) or point/Y-point
 * diverging road (dragging from mid-piece, or an end that's already linked)
 * best matches the live cursor position, snapping discretely as you move;
 * right-clicking undoes the most recently laid piece (a plain stack, so
 * repeated right-clicks walk back further). If a piece's rigid end happens to
 * land cleanly on another piece, it joins there instead of ending free — a
 * seamless join on a free end (including two straights meeting end to end),
 * or a real fork if it lands mid-piece (or on an end that's already linked)
 * at a genuine point/Y-point angle, exactly as if it had been dragged the
 * other way round — see findConnection. Every fork gets a floating arrow
 * showing, and letting you change, which way it's switched; clicking an
 * arrow toggles it. A plain join gets no arrow: there's nothing to choose.
 *
 * Track-drag interaction is only active while `setEnabled(true)` — intended
 * to be armed for LAY mode and disarmed for PLAY mode. Switch arrows can be
 * clicked in either mode.
 *
 * @param {Object} deps
 * @param {THREE.Scene} deps.scene Scene to add new track, switch arrows, and the drag preview to.
 * @param {THREE.Camera} deps.camera Active camera, used for raycasting.
 * @param {HTMLElement} deps.domElement Canvas element to listen on.
 * @param {import('three/examples/jsm/controls/OrbitControls.js').OrbitControls} deps.controls Orbit controls to suspend during an active drag.
 * @param {TrackPiece[]} deps.pieces Shared, mutable list of track pieces (including the starting oval); new pieces are pushed here, removed ones spliced out.
 * @returns {{setEnabled: (value: boolean) => void, dispose: () => void, junctions: Junction[]}} Control handle, including the live junction list for the train's path walker.
 */
export function createTrackBuilder({ scene, camera, domElement, controls, pieces }) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  let enabled = false
  // Continues on from whatever ids the starting layout already used, rather than restarting at 1, so a
  // hand-laid piece can never collide with one of the default layout's — both share the same `pieces`
  // array and so must share one id space (see e.g. the piece inspector's hover label).
  let nextId = pieces.reduce((max, piece) => Math.max(max, piece.id), 0) + 1
  let nextJunctionId = 1
  const undoStack = []
  const junctions = []
  let drag = null
  let edgePanFrameId = null
  let lastEdgePanTime = 0
  let lastPointerClientX = 0
  let lastPointerClientY = 0

  /**
   * Updates the shared raycaster's NDC pointer from a mouse/pointer event.
   *
   * @param {PointerEvent} event Source event.
   * @returns {void}
   */
  function setPointerFromEvent(event) {
    const rect = domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    lastPointerClientX = event.clientX
    lastPointerClientY = event.clientY
  }

  /**
   * Raycasts against every track piece's pick mesh and returns the closest
   * point on the closest piece's curve, if any.
   *
   * @returns {{piece: TrackPiece, t: number, point: THREE.Vector3} | null} Hit info, or null if nothing was hit.
   */
  function pickTrack() {
    raycaster.setFromCamera(pointer, camera)
    const pickMeshes = pieces.map((piece) => piece.pickMesh)
    const hits = raycaster.intersectObjects(pickMeshes, false)
    if (hits.length === 0) return null
    const hit = hits[0]
    const piece = pieces.find((candidate) => candidate.pickMesh === hit.object)
    const closest = closestPointOnCurve(piece.curve, hit.point, { closed: piece.closed })
    return { piece, t: closest.t, point: closest.point }
  }

  /**
   * Raycasts the current pointer against the ground plane (track level).
   *
   * @returns {THREE.Vector3 | null} World point on the ground plane, or null if the ray is parallel to it.
   */
  function pickGround() {
    raycaster.setFromCamera(pointer, camera)
    const point = new THREE.Vector3()
    return raycaster.ray.intersectPlane(groundPlane, point) ? point : null
  }

  /**
   * Checks whether a (now-fixed, rigid) candidate piece's endpoint happens to land cleanly on another
   * piece — close enough in position (SNAP_POSITION_TOLERANCE) to count as a deliberate join rather than
   * two pieces just passing near each other. What landing there actually means depends on what's already
   * there: landing on a free end (see isAtFreeEnd) needs the tangents to be parallel or exactly opposite
   * (a plain link — a seamless continuation, including two straights meeting end to end); landing
   * mid-piece, or on an end that's already linked, needs the angle between the tangents to be close to a
   * *real* point's diverge angle (22.5°) or one leg of a Y-point's (11.25°) — a fork there, exactly as if
   * this piece had been dragged outward from that spot as the host instead (see createJunctionAt). Any
   * other angle doesn't correspond to a real Setrack item, so no connection — nothing here ever bends to
   * fit, unlike the old free-form drag.
   *
   * @param {THREE.Vector3} endPoint Candidate's fixed endpoint.
   * @param {THREE.Vector3} endTangent Candidate's fixed unit tangent at endPoint.
   * @param {TrackPiece} excludePiece Piece to ignore (the one the current drag started from).
   * @returns {{type: 'link' | 'fork', piece: TrackPiece, t: number} | null} What kind of connection to make, and where.
   */
  function findConnection(endPoint, endTangent, excludePiece) {
    let best = null
    for (const piece of pieces) {
      if (piece === excludePiece) continue
      const closest = closestPointOnCurve(piece.curve, endPoint, { closed: piece.closed })
      if (closest.distance > SNAP_POSITION_TOLERANCE) continue
      if (best && closest.distance >= best.distance) continue

      const targetTangent = piece.curve.getTangentAt(closest.t)
      const angle = Math.acos(THREE.MathUtils.clamp(Math.abs(endTangent.dot(targetTangent)), -1, 1))
      if (isAtFreeEnd(piece, closest.t)) {
        if (angle < SNAP_ANGLE_TOLERANCE) best = { type: 'link', piece, t: closest.t, distance: closest.distance }
      } else if (Math.abs(angle - POINT_DIVERGE_ANGLE) < SNAP_ANGLE_TOLERANCE || Math.abs(angle - Y_POINT_HALF_ANGLE) < SNAP_ANGLE_TOLERANCE) {
        best = { type: 'fork', piece, t: closest.t, distance: closest.distance }
      }
    }
    return best
  }

  /**
   * Picks the drag's winning candidate for the current cursor position, and whether its far end connects
   * onto another piece — whether this drag is itself a plain continuation or a fork (see isFork in
   * handlePointerDown): either way, the resulting piece has its own tip, and that tip can just as well
   * land on more existing track (building a crossover between two lines in one drag, say).
   *
   * Checks *every* candidate in the set (not just whichever is nearest the cursor) against
   * findConnection, and keeps whichever connecting one lands closest to the cursor — trying only the
   * nearest candidate isn't enough, because "nearest to where you're aiming" and "the one shape that
   * actually lines up at a real Setrack angle" are frequently two different candidates: a curve 0.3m
   * closer to the cursor than another is still preferred by raw distance even if its arrival angle misses
   * the target's tangent by 15°, while the slightly-further curve might land dead-on. Only candidates
   * within MAGNET_RADIUS of the cursor are considered, so this can't reach out and connect to distant,
   * unrelated track the user isn't actually aiming anywhere near. Falls back to the plain
   * closest-to-cursor pick, unconnected, if nothing within range connects.
   *
   * @param {PieceCandidate[]} candidates This drag's candidate set (see pieceCandidates.js).
   * @param {THREE.Vector3} ground Live cursor ground position.
   * @param {TrackPiece} excludePiece The piece the current drag started from.
   * @returns {{winning: PieceCandidate, snap: {type: 'link' | 'fork', piece: TrackPiece, t: number} | null}} The chosen candidate and its connection, if any.
   */
  function pickDragCandidate(candidates, ground, excludePiece) {
    const direct = closestCandidate(candidates, ground)
    let best = null
    let bestDistSq = Infinity

    for (const candidate of candidates) {
      const distSq = candidate.road.endPoint.distanceToSquared(ground)
      if (distSq > MAGNET_RADIUS * MAGNET_RADIUS) continue
      const connection = findConnection(candidate.road.endPoint, candidate.road.endTangent, excludePiece)
      if (!connection) continue
      if (distSq < bestDistSq) {
        best = { winning: candidate, snap: connection }
        bestDistSq = distSq
      }
    }
    return best ?? { winning: direct, snap: null }
  }

  /**
   * Creates a switch arrow at a point, adds it to the scene, and registers it in the shared junction
   * list along with the routing it controls. Thin wrapper around trackGraph.js's shared buildJunction, so
   * both this interactive builder and defaultLayout.js's pre-built passing loops produce identical
   * Junction objects.
   *
   * @param {TrackPiece} hostPiece Piece a train passes straight through on when this switch is at index 0.
   * @param {number} hostT Parameter on hostPiece where the switch sits.
   * @param {TrackPiece} divertPiece Piece a train is sent onto when this switch is thrown to index 1.
   * @param {number} divertT Parameter on divertPiece to continue from.
   * @param {1 | -1} divertDirection Direction of travel to continue in on divertPiece.
   * @returns {Junction} The new junction.
   */
  function createJunctionAt(hostPiece, hostT, divertPiece, divertT, divertDirection) {
    const junction = buildJunction(nextJunctionId++, scene, hostPiece, hostT, divertPiece, divertT, divertDirection)
    junctions.push(junction)
    return junction
  }

  /**
   * Removes a junction's arrow from the scene and frees its per-instance
   * geometry. Its materials are shared across every junction arrow, so they
   * are deliberately left alone here.
   *
   * @param {Junction} junction Junction to remove.
   * @returns {void}
   */
  function disposeJunction(junction) {
    scene.remove(junction.group)
    junction.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose()
    })
    junction.pickMesh.geometry.dispose()
    const index = junctions.indexOf(junction)
    if (index !== -1) junctions.splice(index, 1)
  }

  /**
   * Flags a piece's far (t=1) end as genuinely unconnected with a small floating marker — see
   * deadEndMarker.js. A no-op if it's already marked. Never called for t=0: a piece's own start is
   * always resolved (plain link or fork) the instant it's created, so it never needs one.
   *
   * @param {TrackPiece} piece
   * @returns {void}
   */
  function markEndDangling(piece) {
    if (piece.endMarker) return
    const marker = createDeadEndMarker(piece.curve.getPointAt(1))
    scene.add(marker)
    piece.endMarker = marker
  }

  /**
   * Removes a piece's dead-end marker, if it has one — called wherever something just connected to a
   * piece's far end (a fresh plain link). Harmless no-op otherwise, including when called for a piece
   * whose relevant end was actually its t=0 (which never carries a marker in the first place — see
   * markEndDangling), so callers don't need to work out which end was involved before calling this.
   *
   * @param {TrackPiece} piece
   * @returns {void}
   */
  function clearEndMarker(piece) {
    if (!piece.endMarker) return
    scene.remove(piece.endMarker)
    piece.endMarker.geometry.dispose()
    piece.endMarker = null
  }

  /**
   * Rebuilds the drag preview tube from the current drag's winning candidate piece.
   *
   * @returns {void}
   */
  function updatePreview() {
    if (drag.previewMesh) {
      scene.remove(drag.previewMesh)
      disposeDeep(drag.previewMesh)
    }
    const geometry = new THREE.TubeGeometry(drag.winning.road.curve, PREVIEW_SAMPLES, PREVIEW_RADIUS, 6, false)
    const material = new THREE.MeshBasicMaterial({ color: PREVIEW_COLOR, transparent: true, opacity: 0.85 })
    drag.previewMesh = new THREE.Mesh(geometry, material)
    scene.add(drag.previewMesh)
  }

  /**
   * Cancels any in-progress drag, removing its preview and restoring controls.
   *
   * @returns {void}
   */
  function cancelDrag() {
    if (!drag) return
    if (drag.previewMesh) {
      scene.remove(drag.previewMesh)
      disposeDeep(drag.previewMesh)
    }
    releasePointerCapture(drag.pointerId)
    controls.enabled = true
    drag = null
    domElement.style.cursor = ''
  }

  /**
   * Explicitly captures the pointer to the canvas for the duration of a drag, so every subsequent
   * pointermove for this gesture is guaranteed to keep targeting (and bubbling from) this element even
   * once the cursor strays outside its bounds near the edge of the screen — without this, delivery of
   * those events is left to each browser's own implicit-capture heuristics, which edge-panning depends
   * on firing reliably. Safe to call even where unsupported (wrapped, since older pointerType edge cases
   * can throw).
   *
   * @param {number} pointerId
   * @returns {void}
   */
  function capturePointer(pointerId) {
    try {
      domElement.setPointerCapture(pointerId)
    } catch {
      // Unsupported for this pointer/browser — the browser's own implicit capture is the fallback.
    }
  }

  /**
   * @param {number} pointerId
   * @returns {void}
   */
  function releasePointerCapture(pointerId) {
    try {
      if (domElement.hasPointerCapture(pointerId)) domElement.releasePointerCapture(pointerId)
    } catch {
      // Already released, or unsupported — nothing to do either way.
    }
  }

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  function handlePointerDown(event) {
    if (!enabled || event.button !== 0) return
    setPointerFromEvent(event)
    const hit = pickTrack()
    if (!hit) return // not over track — let OrbitControls handle this as a normal camera drag

    event.preventDefault()
    controls.enabled = false
    capturePointer(event.pointerId)

    const rawTangent = hit.piece.curve.getTangentAt(hit.t).clone()
    drag = {
      pointerId: event.pointerId,
      startPiece: hit.piece,
      startT: hit.t,
      start: hit.point.clone(),
      rawTangent,
      tangentSign: 1, // default: continue the same way the source piece was heading
      // Decided once, at the start point, rather than re-checked every move: whether this is a plain
      // continuation (free end, so any straight/curve from the catalogue) or a genuine fork (mid-piece,
      // or an end that already has a plain link) which can only ever be a real point or Y-point's
      // diverging road — see freeCandidates/forkCandidates in pieceCandidates.js.
      isFork: !isAtFreeEnd(hit.piece, hit.t),
      groundDistance: 0,
      winning: null,
      snap: null,
      previewMesh: null,
    }
    domElement.style.cursor = 'crosshair'
    if (edgePanFrameId === null) edgePanFrameId = requestAnimationFrame(edgePanStep)
  }

  /**
   * Re-evaluates the in-progress drag's winning candidate and snap target from wherever the shared
   * `pointer` NDC currently points, and refreshes the preview. Split out from handlePointerMove so the
   * edge-pan loop (which moves the camera under a stationary cursor, not the cursor itself) can reuse
   * the same logic without a synthetic pointer event.
   *
   * @returns {void}
   */
  function updateDragFromPointer() {
    const ground = pickGround()
    if (!ground) return

    drag.groundDistance = ground.distanceTo(drag.start)
    drag.tangentSign = pickTangentSign(drag.rawTangent, drag.start, ground)
    const tangent = drag.rawTangent.clone().multiplyScalar(drag.tangentSign)
    const candidates = drag.isFork ? forkCandidates(drag.start, tangent) : freeCandidates(drag.start, tangent)
    const { winning, snap } = pickDragCandidate(candidates, ground, drag.startPiece)
    drag.winning = winning
    drag.snap = snap
    updatePreview()
  }

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  function handlePointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    setPointerFromEvent(event)
    updateDragFromPointer()
  }

  /**
   * Pans the camera (by moving OrbitControls' target — controls.update(), called here and again every
   * render frame, re-derives camera.position from it) whenever an in-progress drag's pointer sits near
   * the canvas edge, so a piece can be aimed at track beyond the current view without letting go to pan
   * manually first. Self-schedules via requestAnimationFrame and stops on its own once the drag ends.
   *
   * @param {number} now Timestamp from requestAnimationFrame.
   * @returns {void}
   */
  function edgePanStep(now) {
    if (!drag) {
      edgePanFrameId = null
      lastEdgePanTime = 0
      return
    }
    const delta = lastEdgePanTime ? Math.min(0.1, (now - lastEdgePanTime) / 1000) : 0
    lastEdgePanTime = now

    const rect = domElement.getBoundingClientRect()
    const px = lastPointerClientX - rect.left
    const py = lastPointerClientY - rect.top
    const edgeFactor = (distanceIntoMargin) => THREE.MathUtils.clamp(distanceIntoMargin / EDGE_PAN_MARGIN, 0, 1)

    let panX = 0
    let panY = 0
    if (px < EDGE_PAN_MARGIN) panX = -edgeFactor(EDGE_PAN_MARGIN - px)
    else if (px > rect.width - EDGE_PAN_MARGIN) panX = edgeFactor(px - (rect.width - EDGE_PAN_MARGIN))
    if (py < EDGE_PAN_MARGIN) panY = -edgeFactor(EDGE_PAN_MARGIN - py)
    else if (py > rect.height - EDGE_PAN_MARGIN) panY = edgeFactor(py - (rect.height - EDGE_PAN_MARGIN))

    if ((panX !== 0 || panY !== 0) && delta > 0) {
      // Orthographic frustum width/height at the current zoom, divided by canvas size, converts a
      // screen-pixel pan rate into the right world-space distance regardless of how far zoomed in.
      const worldPerPixelX = (camera.right - camera.left) / camera.zoom / rect.width
      const worldPerPixelY = (camera.top - camera.bottom) / camera.zoom / rect.height
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      const offset = new THREE.Vector3()
        .addScaledVector(right, panX * EDGE_PAN_PIXELS_PER_SECOND * delta * worldPerPixelX)
        .addScaledVector(up, -panY * EDGE_PAN_PIXELS_PER_SECOND * delta * worldPerPixelY) // screen Y grows downward, world "up" is the opposite sense
      controls.target.add(offset)
      controls.update()
      updateDragFromPointer() // the world point under the (unmoved) cursor just changed — refresh the preview to match
    }

    edgePanFrameId = requestAnimationFrame(edgePanStep)
  }

  /**
   * Updates the canvas cursor to show what a click would do: a pointer over a junction arrow (clickable
   * in either mode), a crosshair over track while LAY mode is armed (drag here to build), or the
   * default cursor otherwise. Left alone entirely while a drag is in progress.
   *
   * @param {PointerEvent} event
   * @returns {void}
   */
  function updateHoverCursor(event) {
    if (drag) return
    setPointerFromEvent(event)
    raycaster.setFromCamera(pointer, camera)
    const junctionHit = raycaster.intersectObjects(
      junctions.map((junction) => junction.pickMesh),
      false,
    )
    if (junctionHit.length > 0) {
      domElement.style.cursor = 'pointer'
      return
    }
    domElement.style.cursor = enabled && pickTrack() ? 'crosshair' : ''
  }

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  function handlePointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return

    if (drag.previewMesh) {
      scene.remove(drag.previewMesh)
      disposeDeep(drag.previewMesh)
    }

    // drag.winning is null until the first move, and the ground-distance gate rejects a bare click —
    // either way, nothing committed means nothing to build.
    if (drag.winning && drag.groundDistance >= MIN_DRAG_DISTANCE) {
      const finalCurve = drag.winning.road.curve
      const { group, pickMesh } = buildTrackMeshes(finalCurve, { closed: false })
      scene.add(group)
      const piece = {
        id: nextId++,
        curve: finalCurve,
        closed: false,
        group,
        pickMesh,
        junctions: [],
        links: { start: null, end: null },
        endMarker: null,
        type: drag.winning.label, // catalogue item this piece represents (see pieceCandidates.js) — shown in the piece inspector's hover label
      }
      pieces.push(piece)
      undoStack.push(piece)

      // Branch point: where this new piece leaves its source track. A plain,
      // switch-free extension off a free end (see TrackPiece.links); a
      // genuine fork (mid-piece, or an end that's already linked) resolves
      // into a real point or Y-point, using the exact catalogue geometry
      // drag.winning was chosen from — see pieceCandidates.js's
      // forkCandidates and the isFork decision in handlePointerDown.
      if (!drag.isFork) {
        linkPieceEnds(drag.startPiece, drag.startT, piece, 0)
        clearEndMarker(drag.startPiece) // drag.startPiece's own end, if it had one, just got connected
      } else {
        piece.junctions.push(createJunctionAt(drag.startPiece, drag.startT, piece, 0, 1))
      }

      // Auto-connected end, if this piece's rigid endpoint happened to land cleanly on another piece —
      // see findConnection. A plain link for a free end (including two straights meeting end to end); a
      // real fork, exactly like the branch above but built from the landing side instead, if it landed
      // mid-piece (or on an already-linked end) at a genuine point or Y-point angle.
      if (drag.snap?.type === 'link') {
        linkPieceEnds(drag.snap.piece, drag.snap.t, piece, 1)
        clearEndMarker(drag.snap.piece) // same here, for whichever existing piece this one just rejoined
      } else if (drag.snap?.type === 'fork') {
        piece.junctions.push(createJunctionAt(drag.snap.piece, drag.snap.t, piece, 1, -1))
      } else {
        markEndDangling(piece) // this piece's own far end didn't connect to anything — flag it
      }
    }

    releasePointerCapture(drag.pointerId)
    controls.enabled = true
    drag = null
    domElement.style.cursor = ''
  }

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleContextMenu(event) {
    if (!enabled) return
    event.preventDefault()
    const piece = undoStack.pop()
    if (!piece) return
    scene.remove(piece.group)
    disposeDeep(piece.group)
    piece.pickMesh.geometry.dispose()
    piece.pickMesh.material.dispose()
    clearEndMarker(piece) // marker lives directly in the scene, not under piece.group, so disposeDeep above doesn't reach it
    const index = pieces.indexOf(piece)
    if (index !== -1) pieces.splice(index, 1)
    piece.junctions.forEach(disposeJunction)
    // Clear the far side of any plain link so its neighbour reports as a free
    // end again, rather than dangling a reference to this now-disposed
    // piece — and flag that end with a marker again, since it's genuinely
    // open once more. Safe to assume that neighbour is older than this one
    // (and so still standing) — the undo stack only ever pops the most
    // recently laid piece, and anything laid after this one that links onto
    // it would have to be undone first.
    if (piece.links.start) {
      piece.links.start.piece.links[piece.links.start.end] = null
      if (piece.links.start.end === 'end') markEndDangling(piece.links.start.piece)
    }
    if (piece.links.end) {
      piece.links.end.piece.links[piece.links.end.end] = null
      if (piece.links.end.end === 'end') markEndDangling(piece.links.end.piece)
    }
  }

  /**
   * Toggles a switch arrow if the click landed on one. Not gated by
   * `enabled` — switches can be thrown in either PLAY or LAY mode.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleClick(event) {
    setPointerFromEvent(event)
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(
      junctions.map((junction) => junction.pickMesh),
      false,
    )
    if (hits.length === 0) return
    const junction = junctions.find((candidate) => candidate.pickMesh === hits[0].object)
    junction.activeIndex = junction.activeIndex === 0 ? 1 : 0
    placeJunctionArrow(junction)
  }

  domElement.addEventListener('pointerdown', handlePointerDown)
  domElement.addEventListener('pointermove', updateHoverCursor)
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  domElement.addEventListener('contextmenu', handleContextMenu)
  domElement.addEventListener('click', handleClick)

  return {
    /**
     * Arms or disarms track-laying interaction. Disabling mid-drag cancels it.
     * Switch arrows stay clickable regardless.
     *
     * @param {boolean} value True to arm (LAY mode), false to disarm (PLAY mode).
     * @returns {void}
     */
    setEnabled(value) {
      // Called every frame regardless of whether the mode actually changed (see createRailwayScene.js's
      // animate loop), so this must stay a no-op when nothing changed — cancelDrag() would otherwise
      // cancel a drag on the very next frame after it started.
      if (value === enabled) return
      enabled = value
      cancelDrag()
    },

    /**
     * Removes all event listeners, cancels any in-progress drag, and frees
     * every junction arrow's and dead-end marker's geometry and shared
     * materials. Does not remove already-committed track pieces.
     *
     * @returns {void}
     */
    dispose() {
      cancelDrag()
      if (edgePanFrameId !== null) cancelAnimationFrame(edgePanFrameId)
      domElement.removeEventListener('pointerdown', handlePointerDown)
      domElement.removeEventListener('pointermove', updateHoverCursor)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      domElement.removeEventListener('contextmenu', handleContextMenu)
      domElement.removeEventListener('click', handleClick)
      junctions.slice().forEach(disposeJunction)
      disposeSharedJunctionMaterials()
      pieces.forEach(clearEndMarker)
      disposeSharedDeadEndMaterial()
    },

    /**
     * Live, read-only-by-convention list of every junction currently in the
     * network (switch state, routing, and arrow). Used by the train's path
     * walker to decide where to go at each one.
     */
    junctions,
  }
}
