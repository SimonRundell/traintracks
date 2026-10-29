import * as THREE from 'three'
import { closestPointOnCurve } from './curveMath.js'
import { buildTrackMeshes } from './track.js'
import { disposeSharedJunctionMaterials, placeJunctionArrow } from './junctionArrow.js'
import { createDeadEndMarker, disposeSharedDeadEndMaterial, setMarkerSelected } from './deadEndMarker.js'
import { linkPieceEnds, buildJunction } from './trackGraph.js'
import { freeCandidates, forkCandidates } from './pieceCandidates.js'
import { POINT_DIVERGE_ANGLE, Y_POINT_HALF_ANGLE } from './trackCatalogue.js'
import { buildLayoutSnapshot, deserializeLayout } from './layoutSerializer.js'

const SNAP_POSITION_TOLERANCE = 4 // metres — how close a piece's end has to land to another piece's curve to auto-join it, whether that lands it on a free end (a plain link) or mid-piece (a fork — see findConnection)
const SNAP_ANGLE_TOLERANCE = THREE.MathUtils.degToRad(8) // how close to parallel (for a plain link) or to a real point/Y-point's diverge angle (for a fork) the two tangents have to be — catalogue pieces are rigid, nothing here ever bends to fit
const FREE_END_PROXIMITY = 3 // metres — within this of an open piece's free end counts as "the end itself"
const MAGNET_RADIUS = 20 // metres — how far from a drawer drag's live cursor position to look for a landing spot worth aiming at, so dropping a piece doesn't require pixel-perfect aim against fixed-geometry track
const PREVIEW_SAMPLES = 24
const PREVIEW_RADIUS = 0.35
const PREVIEW_COLOR = 0x5eead4

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
 * @property {{start: PieceLink | null, end: PieceLink | null}} links Unconditional, switch-free continuations onto whatever was built contiguously from this piece's two ends (see pathWalker.js's stepPath) — distinct from a junction, which is an actual fork with a choice to make. Plain extension of an existing piece, or snapping onto another piece's free end, sets these instead of creating a junction.
 * @property {{start: THREE.Mesh | null, end: THREE.Mesh | null}} markers Floating dead-end marker over an end, present only while that end is genuinely unconnected — see deadEndMarker.js. A piece's end can become dangling either when it's first built unconnected, or later, if whatever it used to connect to gets deleted — so, unlike the old drag-only tool, either end can carry one.
 * @property {string} [type] Catalogue item this piece represents, e.g. "curve-3-left" — see pieceCandidates.js's matching labels; shown in the piece inspector's hover label.
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
 * @property {1 | -1} requiredHostDirection The only hostPiece travel direction for which diverting is velocity-continuous — a point built off at an angle is only a real fork from one side; from the other, the "branch" would require an instantaneous reversal, so it's ignored rather than offered.
 * @property {TrackPiece} divertPiece The piece a train is sent onto when this switch is thrown to index 1.
 * @property {number} divertT Parameter on divertPiece to continue from — always 0 or 1, one of divertPiece's own true ends (never mid-piece).
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
 * Whether a point on a piece is at (or effectively at) its free end — the
 * tip of an open piece where nothing continues past it yet. An end that's
 * already linked no longer counts as free — a piece arriving there is a
 * genuine fork and needs a proper junction, same as branching off the middle
 * of a piece would. A closed loop has no free end — every point on it
 * continues both ways.
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
 * Picks which way a fork should leave its host tangent: +1 to carry on the same way the host was already
 * heading, -1 to leave backwards instead — whichever side of the host's tangent line the drag cursor is
 * currently on, re-evaluated every move so the choice tracks the live cursor rather than locking in once.
 *
 * @param {THREE.Vector3} hostTangent Host piece's tangent at the fork point.
 * @param {THREE.Vector3} hostPoint Fork point.
 * @param {THREE.Vector3} cursor Live cursor ground position.
 * @returns {1 | -1} Sign to multiply hostTangent by.
 */
function pickTangentSign(hostTangent, hostPoint, cursor) {
  const toCursor = new THREE.Vector3().subVectors(cursor, hostPoint)
  if (toCursor.lengthSq() < 1e-6) return 1 // no meaningful direction yet — default to continuing forward
  return hostTangent.dot(toCursor) >= 0 ? 1 : -1
}

/**
 * Sets up the LAY-mode track-building tools on top of an existing Three.js scene, driven by a drawer of
 * catalogue pieces rendered outside this module (see pieceCandidates.js's freeCandidateMenu/
 * forkCandidateMenu). Two ways to place a piece:
 *
 * - Click a dead-end marker (the small red sphere over a genuinely-unconnected piece end) to select it,
 *   then click a free-end drawer item (a straight or curve) to append it there — see appendPiece. The new
 *   piece's own far end becomes the selection in turn, so repeated clicks on the same item keep chaining
 *   in one direction.
 * - Drag a drawer item onto the layout — see beginDrawerDrag/updateDrawerDrag/endDrawerDrag. A free-end
 *   item snaps to the nearest dangling marker within range (the same thing clicking one selects); a
 *   fork item (a point or Y-point) snaps to the nearest point on existing track that *isn't* a free end,
 *   which side it leaves from picked by which side of the host's tangent the cursor is on. Either way a
 *   live preview tracks the current target, shown only while there is one.
 *
 * Either way, if the new piece's rigid far end happens to land cleanly on other track, it joins there
 * instead of staying open — a plain link on a free end (including two straights meeting end to end), or a
 * real fork if it lands mid-piece (or on an already-linked end) at a genuine point/Y-point angle — see
 * findConnection. Right-clicking any piece (including the starting layout's) deletes just that one;
 * whatever it was connected to on either side, including any fork it was itself the host or the diverging
 * road of, becomes dangling again rather than being silently reconnected. Every fork gets a floating arrow
 * showing, and letting you change, which way it's switched; clicking an arrow toggles it.
 *
 * Track-building interaction is only active while `setEnabled(true)` — intended to be armed for LAY mode
 * and disarmed for PLAY mode (which also cancels any in-progress drawer drag). Switch arrows can be
 * clicked in either mode.
 *
 * @param {Object} deps
 * @param {THREE.Scene} deps.scene Scene to add new track, switch arrows, and dead-end markers to.
 * @param {THREE.Camera} deps.camera Active camera, used for raycasting.
 * @param {HTMLElement} deps.domElement Canvas element to listen on.
 * @param {TrackPiece[]} deps.pieces Shared, mutable list of track pieces (including the starting layout); new pieces are pushed here, removed ones spliced out.
 * @param {(selection: {piece: TrackPiece, end: 'start' | 'end'} | null) => void} [deps.onSelectionChange] Called whenever the selected dangling end changes, so a host UI (the drawer) can reflect it.
 * @returns {{setEnabled: (value: boolean) => void, appendPiece: (key: string) => void, beginDrawerDrag: (key: string, isFork: boolean) => void, updateDrawerDrag: (clientX: number, clientY: number) => void, endDrawerDrag: (commit: boolean) => void, markInitialDanglingEnds: () => void, getSnapshot: () => Object, loadLayout: (data: Object) => void, dispose: () => void, junctions: Junction[]}} Control handle, including the live junction list for the train's path walker.
 */
export function createTrackBuilder({ scene, camera, domElement, pieces, onSelectionChange }) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  let enabled = false
  // Continues on from whatever ids the starting layout already used, rather than restarting at 1, so a
  // hand-laid piece can never collide with one of the default layout's — both share the same `pieces`
  // array and so must share one id space (see e.g. the piece inspector's hover label).
  let nextId = pieces.reduce((max, piece) => Math.max(max, piece.id), 0) + 1
  let nextJunctionId = 1
  const junctions = []
  let selection = null // {piece, end} | null — the dangling end a drawer click will extend
  let drawerDrag = null // in-progress drag from the drawer — see beginDrawerDrag

  /**
   * Updates the shared raycaster's NDC pointer from a mouse/pointer event.
   *
   * @param {PointerEvent | MouseEvent} event Source event.
   * @returns {void}
   */
  function setPointerFromEvent(event) {
    const rect = domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
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
   * Checks whether a (fixed, rigid) candidate piece's endpoint happens to land cleanly on another piece —
   * close enough in position (SNAP_POSITION_TOLERANCE) to count as a deliberate join rather than two
   * pieces just passing near each other. What landing there actually means depends on what's already
   * there: landing on a free end (see isAtFreeEnd) needs the tangents to be parallel or exactly opposite
   * (a plain link — a seamless continuation, including two straights meeting end to end); landing
   * mid-piece, or on an end that's already linked, needs the angle between the tangents to be close to a
   * *real* point's diverge angle (22.5°) or one leg of a Y-point's (11.25°) — a fork there. Any other angle
   * doesn't correspond to a real Setrack item, so no connection — nothing here ever bends to fit.
   *
   * @param {THREE.Vector3} endPoint Candidate's fixed endpoint.
   * @param {THREE.Vector3} endTangent Candidate's fixed unit tangent at endPoint.
   * @param {TrackPiece[]} excludePieces Pieces to ignore — the one the new piece was appended from, and the
   *   new piece itself (already in `pieces` by the time this runs; without excluding it too, its own t=1
   *   endpoint trivially "matches" itself at distance 0 and angle 0, always winning as a bogus self-link).
   * @returns {{type: 'link' | 'fork', piece: TrackPiece, t: number} | null} What kind of connection to make, and where.
   */
  function findConnection(endPoint, endTangent, excludePieces) {
    let best = null
    for (const piece of pieces) {
      if (excludePieces.includes(piece)) continue
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
   * Flags one end of a piece as genuinely unconnected with a small floating marker — see
   * deadEndMarker.js. A no-op if that end is already marked.
   *
   * @param {TrackPiece} piece
   * @param {'start' | 'end'} which
   * @returns {void}
   */
  function markEndDangling(piece, which) {
    if (piece.markers[which]) return
    const marker = createDeadEndMarker(piece.curve.getPointAt(which === 'start' ? 0 : 1))
    marker.userData = { piece, end: which }
    scene.add(marker)
    piece.markers[which] = marker
  }

  /**
   * Removes one end's dead-end marker, if it has one — called wherever something just connected to that
   * end. Harmless no-op if that end has no marker. Also clears the current selection if it pointed at the
   * marker being removed, since there's nothing left to highlight.
   *
   * @param {TrackPiece} piece
   * @param {'start' | 'end'} which
   * @returns {void}
   */
  function clearEndMarker(piece, which) {
    const marker = piece.markers[which]
    if (!marker) return
    // Clear the selection (if it pointed here) before the marker itself is gone — setSelection reads
    // the outgoing selection's own marker to un-highlight it, which needs piece.markers[which] to still
    // be the real mesh, not already nulled out.
    if (selection && selection.piece === piece && selection.end === which) setSelection(null)
    scene.remove(marker)
    marker.geometry.dispose()
    piece.markers[which] = null
  }

  /**
   * Changes which dangling end a drawer click will extend, updating the previous and new markers'
   * highlight and notifying the host UI.
   *
   * @param {{piece: TrackPiece, end: 'start' | 'end'} | null} next
   * @returns {void}
   */
  function setSelection(next) {
    if (selection) setMarkerSelected(selection.piece.markers[selection.end], false)
    selection = next
    if (selection) setMarkerSelected(selection.piece.markers[selection.end], true)
    onSelectionChange?.(selection)
  }

  /**
   * Builds a new, unwired piece's meshes and pushes it into the shared `pieces` list. Shared by
   * addAppendedPiece and addForkedPiece — only how its *start* gets wired in differs between them.
   *
   * @param {import('./trackCatalogue.js').PlacedRoad} placed Geometry to build, already positioned.
   * @param {string} type Catalogue label (see pieceCandidates.js), stored for the piece inspector.
   * @returns {TrackPiece} The new, as-yet-unconnected piece.
   */
  function buildBarePiece(placed, type) {
    const { group, pickMesh } = buildTrackMeshes(placed.curve, { closed: false })
    scene.add(group)
    const piece = {
      id: nextId++,
      curve: placed.curve,
      closed: false,
      group,
      pickMesh,
      links: { start: null, end: null },
      markers: { start: null, end: null },
      type,
    }
    pieces.push(piece)
    return piece
  }

  /**
   * Wires up a freshly-built piece's far (t=1) end: a plain link if it lands cleanly on a free end, a real
   * fork if it lands mid-piece (or on an already-linked end) at a genuine point/Y-point angle, or — if
   * neither — flags it dangling and selects it, ready for the next drawer click or drag to extend it
   * further. Shared tail of addAppendedPiece and addForkedPiece, which only differ in how the piece's
   * *start* gets wired in.
   *
   * @param {TrackPiece} piece The new piece, already pushed into `pieces`.
   * @param {import('./trackCatalogue.js').PlacedRoad} placed Its geometry (for the exact analytic endPoint/endTangent).
   * @param {TrackPiece[]} excludePieces Pieces findConnection must ignore — see its own doc comment.
   * @returns {void}
   */
  function wireNewPieceFarEnd(piece, placed, excludePieces) {
    const connection = findConnection(placed.endPoint, placed.endTangent, excludePieces)
    if (connection?.type === 'link') {
      linkPieceEnds(connection.piece, connection.t, piece, 1)
      clearEndMarker(connection.piece, connection.t < 0.5 ? 'start' : 'end')
      setSelection(null) // rejoined existing track — nothing open left to keep extending here
    } else if (connection?.type === 'fork') {
      createJunctionAt(connection.piece, connection.t, piece, 1, -1)
      setSelection(null)
    } else {
      markEndDangling(piece, 'end')
      setSelection({ piece, end: 'end' }) // keep the chain going: the next click or drag extends this new piece
    }
  }

  /**
   * Builds a brand-new piece and plainly links its start onto `fromPiece`'s given (free) end.
   *
   * @param {import('./trackCatalogue.js').PlacedRoad} placed Geometry to build, already positioned.
   * @param {string} type Catalogue label (see pieceCandidates.js), stored for the piece inspector.
   * @param {TrackPiece} fromPiece Piece this new one is appended from.
   * @param {'start' | 'end'} fromEnd Which of fromPiece's ends it's appended from.
   * @returns {void}
   */
  function addAppendedPiece(placed, type, fromPiece, fromEnd) {
    const piece = buildBarePiece(placed, type)
    linkPieceEnds(fromPiece, fromEnd === 'start' ? 0 : 1, piece, 0)
    clearEndMarker(fromPiece, fromEnd)
    wireNewPieceFarEnd(piece, placed, [fromPiece, piece])
  }

  /**
   * Builds a brand-new piece as the diverging road of a fork off `hostPiece`, at `hostT`.
   *
   * @param {import('./trackCatalogue.js').PlacedRoad} placed Geometry to build, already positioned.
   * @param {string} type Catalogue label (see pieceCandidates.js), stored for the piece inspector.
   * @param {TrackPiece} hostPiece Piece a train passes straight through on when this new fork is at index 0.
   * @param {number} hostT Parameter on hostPiece where the fork sits.
   * @param {1 | -1} divertDirection Direction of travel to continue in on the new piece once diverted onto it.
   * @returns {void}
   */
  function addForkedPiece(placed, type, hostPiece, hostT, divertDirection) {
    const piece = buildBarePiece(placed, type)
    createJunctionAt(hostPiece, hostT, piece, 0, divertDirection)
    wireNewPieceFarEnd(piece, placed, [hostPiece, piece])
  }

  /**
   * Deletes a single track piece: any junction it's either side of (host or diverging road) is disposed,
   * and whatever it was plainly linked to on either end becomes dangling again — no attempt is made to
   * bridge the resulting gap. Works on any piece, including ones from the starting layout, not just
   * recently hand-laid ones.
   *
   * @param {TrackPiece} piece
   * @returns {void}
   */
  function deletePiece(piece) {
    junctions
      .filter((junction) => junction.hostPiece === piece || junction.divertPiece === piece)
      .forEach((junction) => {
        // If this piece was the host, the diverging road's own toe just lost its only connection.
        if (junction.hostPiece === piece) markEndDangling(junction.divertPiece, junction.divertT < 0.5 ? 'start' : 'end')
        disposeJunction(junction)
      })

    if (piece.links.start) {
      const { piece: neighbour, end } = piece.links.start
      neighbour.links[end] = null
      markEndDangling(neighbour, end)
    }
    if (piece.links.end) {
      const { piece: neighbour, end } = piece.links.end
      neighbour.links[end] = null
      markEndDangling(neighbour, end)
    }

    clearEndMarker(piece, 'start')
    clearEndMarker(piece, 'end')

    scene.remove(piece.group)
    disposeDeep(piece.group)
    piece.pickMesh.geometry.dispose()
    piece.pickMesh.material.dispose()
    const index = pieces.indexOf(piece)
    if (index !== -1) pieces.splice(index, 1)
  }

  /**
   * Wipes every piece, junction, and marker currently on the layout — the whole-scene equivalent of
   * deletePiece, used right before loading a saved layout in to replace what's there now. Leaves `pieces`
   * and `junctions` as the same (now-empty) array instances, since other code (createRailwayScene.js's
   * train-position state, the piece inspector) holds onto those references directly.
   *
   * @returns {void}
   */
  function clearAllPieces() {
    cancelDrawerDrag()
    setSelection(null)
    junctions.slice().forEach(disposeJunction)
    pieces.forEach((piece) => {
      scene.remove(piece.group)
      disposeDeep(piece.group)
      piece.pickMesh.geometry.dispose()
      piece.pickMesh.material.dispose()
      clearEndMarker(piece, 'start')
      clearEndMarker(piece, 'end')
    })
    pieces.length = 0
  }

  /**
   * Updates the canvas cursor: a pointer over a dead-end marker (LAY mode only — click to select) or a
   * junction arrow (clickable in either mode), the default cursor otherwise.
   *
   * @param {PointerEvent} event
   * @returns {void}
   */
  function updateHoverCursor(event) {
    setPointerFromEvent(event)
    raycaster.setFromCamera(pointer, camera)
    if (enabled) {
      const markers = pieces.flatMap((piece) => [piece.markers.start, piece.markers.end]).filter(Boolean)
      if (raycaster.intersectObjects(markers, false).length > 0) {
        domElement.style.cursor = 'pointer'
        return
      }
    }
    const junctionHit = raycaster.intersectObjects(
      junctions.map((junction) => junction.pickMesh),
      false,
    )
    domElement.style.cursor = junctionHit.length > 0 ? 'pointer' : ''
  }

  /**
   * Left-click handling: in LAY mode, clicking a dead-end marker selects (or, if it's already selected,
   * deselects) it as the drawer's target end. Failing that, a junction arrow (clickable in either mode)
   * toggles its switch.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleClick(event) {
    setPointerFromEvent(event)
    raycaster.setFromCamera(pointer, camera)

    if (enabled) {
      const markers = pieces.flatMap((piece) => [piece.markers.start, piece.markers.end]).filter(Boolean)
      const markerHits = raycaster.intersectObjects(markers, false)
      if (markerHits.length > 0) {
        const { piece, end } = markerHits[0].object.userData
        setSelection(selection && selection.piece === piece && selection.end === end ? null : { piece, end })
        return
      }
    }

    const junctionHits = raycaster.intersectObjects(
      junctions.map((junction) => junction.pickMesh),
      false,
    )
    if (junctionHits.length === 0) return
    const junction = junctions.find((candidate) => candidate.pickMesh === junctionHits[0].object)
    junction.activeIndex = junction.activeIndex === 0 ? 1 : 0
    placeJunctionArrow(junction)
  }

  /**
   * Right-click handling: deletes whichever piece was clicked — see deletePiece.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleContextMenu(event) {
    if (!enabled) return
    event.preventDefault()
    setPointerFromEvent(event)
    const hit = pickTrack()
    if (!hit) return
    deletePiece(hit.piece)
  }

  domElement.addEventListener('pointermove', updateHoverCursor)
  domElement.addEventListener('contextmenu', handleContextMenu)
  domElement.addEventListener('click', handleClick)

  /**
   * Finds the nearest dangling end to a live drag point, for a free-end (straight/curve) item — the drag
   * equivalent of clicking a marker to select it. Only considers ends within MAGNET_RADIUS, so an
   * untargeted drag over open ground doesn't go reaching for distant track.
   *
   * @param {THREE.Vector3} ground Live drag point on the ground plane.
   * @returns {{piece: TrackPiece, end: 'start' | 'end'} | null}
   */
  function findFreeEndTarget(ground) {
    let best = null
    let bestDistSq = MAGNET_RADIUS * MAGNET_RADIUS
    for (const piece of pieces) {
      for (const end of ['start', 'end']) {
        if (!piece.markers[end]) continue
        const distSq = piece.curve.getPointAt(end === 'start' ? 0 : 1).distanceToSquared(ground)
        if (distSq < bestDistSq) {
          best = { piece, end }
          bestDistSq = distSq
        }
      }
    }
    return best
  }

  /**
   * Finds the nearest fork-eligible point to a live drag point, for a point/Y-point item — anywhere along
   * existing track that isn't a genuinely free end (see isAtFreeEnd; real points fork off continuous
   * track, not off an open tip), within MAGNET_RADIUS. Also works out which way the fork should leave the
   * host's tangent, from which side of it the cursor is currently on.
   *
   * @param {THREE.Vector3} ground Live drag point on the ground plane.
   * @returns {{piece: TrackPiece, t: number, tangentSign: 1 | -1} | null}
   */
  function findForkTarget(ground) {
    let best = null
    let bestDist = MAGNET_RADIUS
    for (const piece of pieces) {
      const closest = closestPointOnCurve(piece.curve, ground, { closed: piece.closed })
      if (closest.distance > bestDist) continue
      if (isAtFreeEnd(piece, closest.t)) continue
      best = { piece, t: closest.t, point: closest.point }
      bestDist = closest.distance
    }
    if (!best) return null
    const tangentSign = pickTangentSign(best.piece.curve.getTangentAt(best.t), best.point, ground)
    return { piece: best.piece, t: best.t, tangentSign }
  }

  /**
   * Builds (without placing) the geometry a drawer drag would commit if released right now, from its
   * current target — null if there's no target to build from.
   *
   * @returns {import('./trackCatalogue.js').PlacedRoad | null}
   */
  function buildDrawerDragCandidate() {
    if (!drawerDrag?.target) return null
    if (drawerDrag.isFork) {
      const { piece, t, tangentSign } = drawerDrag.target
      const point = piece.curve.getPointAt(t)
      const tangent = piece.curve.getTangentAt(t).clone().multiplyScalar(tangentSign)
      return forkCandidates(point, tangent).find((item) => item.label === drawerDrag.key)?.road ?? null
    }
    const { piece, end } = drawerDrag.target
    const basePoint = piece.curve.getPointAt(end === 'start' ? 0 : 1)
    const baseTangent = piece.curve.getTangentAt(end === 'start' ? 0 : 1).clone()
    const tangent = end === 'start' ? baseTangent.multiplyScalar(-1) : baseTangent
    return freeCandidates(basePoint, tangent).find((item) => item.label === drawerDrag.key)?.road ?? null
  }

  /**
   * Rebuilds the drawer drag's preview tube from its current target. No target (nothing in range) means
   * no preview — an untargeted drag shows nothing, signalling that releasing here won't place anything.
   *
   * @returns {void}
   */
  function updateDrawerDragPreview() {
    if (drawerDrag.previewMesh) {
      scene.remove(drawerDrag.previewMesh)
      disposeDeep(drawerDrag.previewMesh)
      drawerDrag.previewMesh = null
    }
    const road = buildDrawerDragCandidate()
    if (!road) return
    const geometry = new THREE.TubeGeometry(road.curve, PREVIEW_SAMPLES, PREVIEW_RADIUS, 6, false)
    const material = new THREE.MeshBasicMaterial({ color: PREVIEW_COLOR, transparent: true, opacity: 0.85 })
    drawerDrag.previewMesh = new THREE.Mesh(geometry, material)
    scene.add(drawerDrag.previewMesh)
  }

  /**
   * Discards any in-progress drawer drag's preview without committing anything. Safe to call with no
   * drag active.
   *
   * @returns {void}
   */
  function cancelDrawerDrag() {
    if (!drawerDrag) return
    if (drawerDrag.previewMesh) {
      scene.remove(drawerDrag.previewMesh)
      disposeDeep(drawerDrag.previewMesh)
    }
    drawerDrag = null
  }

  /**
   * Scans every piece for an end that's neither plainly linked nor the landing point of some junction's
   * diverging road, and flags each one dangling. A piece built procedurally (the starting layout) never
   * goes through markEndDangling at creation the way an interactively-appended one does, so without this
   * its genuinely open ends (a siding's stub, say) would have no marker and so no way to be selected —
   * call this once, after seeding `junctions` with the starting layout's own forks.
   *
   * @returns {void}
   */
  function markInitialDanglingEnds() {
    for (const piece of pieces) {
      if (piece.closed) continue
      for (const end of ['start', 'end']) {
        if (piece.links[end]) continue
        const t = end === 'start' ? 0 : 1
        const isForkLanding = junctions.some((junction) => junction.divertPiece === piece && junction.divertT === t)
        if (!isForkLanding) markEndDangling(piece, end)
      }
    }
  }

  return {
    /**
     * Arms or disarms track-laying interaction. Disabling clears any current selection (and its
     * highlight). Switch arrows stay clickable regardless.
     *
     * @param {boolean} value True to arm (LAY mode), false to disarm (PLAY mode).
     * @returns {void}
     */
    setEnabled(value) {
      if (value === enabled) return
      enabled = value
      if (!enabled) {
        setSelection(null)
        cancelDrawerDrag()
      }
    },

    /**
     * Appends one catalogue piece (see pieceCandidates.js's freeCandidateMenu for the available keys) to
     * the currently selected dangling end. A no-op if nothing is selected, or if `key` doesn't match a
     * free-end item — the click shortcut only ever targets the current selection, so it only makes sense
     * for free-end items; forks have no "selected end" to speak of and are only placed by dragging (see
     * beginDrawerDrag) onto existing track at a real point/Y-point angle.
     *
     * @param {string} key A freeCandidateMenu key, e.g. "straight-standard" or "curve-3-left".
     * @returns {void}
     */
    appendPiece(key) {
      if (!selection) return
      const { piece, end } = selection
      const basePoint = piece.curve.getPointAt(end === 'start' ? 0 : 1)
      const baseTangent = piece.curve.getTangentAt(end === 'start' ? 0 : 1).clone()
      const tangent = end === 'start' ? baseTangent.multiplyScalar(-1) : baseTangent
      const candidate = freeCandidates(basePoint, tangent).find((item) => item.label === key)
      if (!candidate) return
      addAppendedPiece(candidate.road, candidate.label, piece, end)
    },

    /**
     * See markInitialDanglingEnds above — call once, after seeding `junctions` with any pre-built
     * layout's own forks, so its genuinely open ends get a marker too.
     */
    markInitialDanglingEnds,

    /**
     * Builds a JSON-safe snapshot of the current layout — see layoutSerializer.js's buildLayoutSnapshot.
     * Ready to send straight to api/layouts/save.php.
     *
     * @returns {{pieces: Object[], junctions: Object[]}}
     */
    getSnapshot() {
      return buildLayoutSnapshot(pieces, junctions)
    },

    /**
     * Replaces the entire current layout with one loaded from the server — see layoutSerializer.js's
     * deserializeLayout. Everything currently on the layout (including the starting one, if nothing's
     * been saved over it yet) is wiped first; there's no merge.
     *
     * Callers also need to reset whatever they're tracking about the train's own position, since the
     * piece/junction objects it was walking no longer exist — see createRailwayScene.js's loadLayout,
     * which wraps this for exactly that reason.
     *
     * @param {Object} data As returned by api/layouts/load.php — `{pieces, junctions}`.
     * @returns {void}
     */
    loadLayout(data) {
      clearAllPieces()
      const loaded = deserializeLayout(data, scene)
      pieces.push(...loaded.pieces)
      junctions.push(...loaded.junctions)
      nextId = pieces.reduce((max, piece) => Math.max(max, piece.id), 0) + 1
      nextJunctionId = junctions.reduce((max, junction) => Math.max(max, junction.id), 0) + 1
      markInitialDanglingEnds()
    },

    /**
     * Starts a drawer drag: picking up a catalogue item (free-end or fork) to drop somewhere on the
     * layout. Call once the drawer's own pointer-drag threshold is crossed; follow with repeated
     * updateDrawerDrag calls as the pointer moves, and exactly one endDrawerDrag to finish.
     *
     * @param {string} key A freeCandidateMenu or forkCandidateMenu key (see pieceCandidates.js).
     * @param {boolean} isFork True for a point/Y-point key (lands on existing track, anywhere but a free
     *   end); false for a straight/curve key (lands on a free end only).
     * @returns {void}
     */
    beginDrawerDrag(key, isFork) {
      cancelDrawerDrag()
      drawerDrag = { key, isFork, target: null, previewMesh: null }
    },

    /**
     * Updates an in-progress drawer drag from the pointer's current screen position: re-finds the nearest
     * valid landing spot (if any) and refreshes the preview. A no-op if no drag is in progress, or if the
     * point doesn't land on the ground plane (camera looking edge-on, in principle — never happens with
     * this app's fixed isometric camera, but cheap to guard anyway).
     *
     * @param {number} clientX Pointer's clientX, as from a PointerEvent.
     * @param {number} clientY Pointer's clientY, as from a PointerEvent.
     * @returns {void}
     */
    updateDrawerDrag(clientX, clientY) {
      if (!drawerDrag) return
      const rect = domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const ground = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(groundPlane, ground)) return
      drawerDrag.target = drawerDrag.isFork ? findForkTarget(ground) : findFreeEndTarget(ground)
      updateDrawerDragPreview()
    },

    /**
     * Ends an in-progress drawer drag, either committing it at its current target (if any) or discarding
     * it. A no-op if no drag is in progress.
     *
     * @param {boolean} commit True to place the piece at the current target (the drawer item was
     *   released over the canvas); false to cancel outright (released back over the drawer, say).
     * @returns {void}
     */
    endDrawerDrag(commit) {
      if (!drawerDrag) return
      const { key, isFork, target } = drawerDrag
      cancelDrawerDrag() // clears drawerDrag and its preview before building, same as a fresh start would
      if (!commit || !target) return
      if (isFork) {
        const { piece, t, tangentSign } = target
        const point = piece.curve.getPointAt(t)
        const tangent = piece.curve.getTangentAt(t).clone().multiplyScalar(tangentSign)
        const candidate = forkCandidates(point, tangent).find((item) => item.label === key)
        if (candidate) addForkedPiece(candidate.road, candidate.label, piece, t, tangentSign)
      } else {
        const { piece, end } = target
        const basePoint = piece.curve.getPointAt(end === 'start' ? 0 : 1)
        const baseTangent = piece.curve.getTangentAt(end === 'start' ? 0 : 1).clone()
        const tangent = end === 'start' ? baseTangent.multiplyScalar(-1) : baseTangent
        const candidate = freeCandidates(basePoint, tangent).find((item) => item.label === key)
        if (candidate) addAppendedPiece(candidate.road, candidate.label, piece, end)
      }
    },

    /**
     * Removes all event listeners and frees every junction arrow's and dead-end marker's geometry and
     * shared materials. Does not remove already-committed track pieces.
     *
     * @returns {void}
     */
    dispose() {
      cancelDrawerDrag()
      domElement.removeEventListener('pointermove', updateHoverCursor)
      domElement.removeEventListener('contextmenu', handleContextMenu)
      domElement.removeEventListener('click', handleClick)
      junctions.slice().forEach(disposeJunction)
      disposeSharedJunctionMaterials()
      pieces.forEach((piece) => {
        clearEndMarker(piece, 'start')
        clearEndMarker(piece, 'end')
      })
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
