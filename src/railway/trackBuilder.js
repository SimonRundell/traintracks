import * as THREE from 'three'
import { closestPointOnCurve, curveMinRadius, quadraticBezierMinRadius } from './curveMath.js'
import { buildTrackMeshes } from './track.js'
import { createJunctionArrow, disposeSharedJunctionMaterials, placeJunctionArrow } from './junctionArrow.js'

const MIN_CURVE_RADIUS = 15 // metres — anything tighter is rejected as too hard a curve to run a train on
// Beyond 90°, the radius a given drag distance can achieve stops increasing monotonically with
// distance (it's proportional to sin of the deflection angle, which turns back down past 90°) — so
// without a hard cap here, a single drag could satisfy MIN_CURVE_RADIUS at every point while still
// forming a tight hairpin overall. Even a per-point-valid hairpin is still far too sharp for a rigid
// ~23m carriage body to follow without visibly cutting across itself, so sharper turns have to be
// built as a sequence of more moderate segments instead of one extreme one.
const MAX_DEFLECTION_ANGLE = Math.PI / 2 // 90°
const MIN_SEGMENT_LENGTH = 2 // metres — shorter drags are discarded as stray clicks
const SNAP_TOLERANCE = 4 // metres — how close a drag's end has to pass another piece to auto-connect to it
const JUNCTION_SAMPLE_DISTANCE = 3 // metres along each route, used to find a direction the switch arrow can point along
const FREE_END_PROXIMITY = 3 // metres — within this of an open piece's free end counts as "the end itself"
const PREVIEW_SAMPLES = 24
const PREVIEW_RADIUS = 0.35
const PREVIEW_COLOR = 0x5eead4

/**
 * @typedef {Object} TrackPiece
 * @property {number} id
 * @property {THREE.Curve} curve
 * @property {boolean} closed
 * @property {THREE.Group} group Visible meshes, already added to the scene.
 * @property {THREE.Mesh} pickMesh Invisible mesh used for raycasting, not added to the scene.
 * @property {Junction[]} junctions Switch points this piece created (removed together with it on undo).
 */

/**
 * @typedef {Object} Junction
 * @property {number} id
 * @property {THREE.Vector3} position Where the switch sits, on the rail.
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
 * Finds the direction from a point on a curve toward another point a fixed
 * arc-length distance further along it (forward for a positive offset,
 * backward for a negative one). Used so a switch arrow points toward where
 * a route actually goes, not just the instantaneous tangent at the switch
 * itself — two routes that leave a junction tangent to each other still
 * read as distinct directions a few metres out.
 *
 * @param {THREE.Curve} curve Curve to sample.
 * @param {number} t Reference parameter in [0, 1].
 * @param {number} arcOffset Signed distance in metres to step along the curve.
 * @param {boolean} closed True if the curve loops back on itself.
 * @returns {THREE.Vector3} Unit direction from the reference point toward the sampled point.
 */
function sampleDirectionAlong(curve, t, arcOffset, closed) {
  const length = curve.getLength()
  const deltaT = length > 1e-6 ? arcOffset / length : 0
  let t2 = t + deltaT
  t2 = closed ? ((t2 % 1) + 1) % 1 : Math.min(1, Math.max(0, t2))
  const p1 = curve.getPointAt(t)
  const p2 = curve.getPointAt(t2)
  const direction = new THREE.Vector3().subVectors(p2, p1)
  return direction.lengthSq() < 1e-8 ? curve.getTangentAt(t).clone() : direction.normalize()
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
 * tip of an open piece, where nothing continues past it. Building from a
 * free end is a plain continuation with nowhere else to go, not a choice
 * between routes, so it shouldn't get a switch arrow. A closed loop (the
 * main oval) has no free end — every point on it continues both ways.
 *
 * @param {TrackPiece} piece Piece the point is on.
 * @param {number} t Parameter on that piece's curve.
 * @returns {boolean} True if building from here is just an extension, not a branch.
 */
function isAtFreeEnd(piece, t) {
  if (piece.closed) return false
  const length = piece.curve.getLength()
  return t * length < FREE_END_PROXIMITY || (1 - t) * length < FREE_END_PROXIMITY
}

/**
 * Sets up interactive click-and-drag track laying on top of an existing
 * Three.js scene: dragging from a piece of existing track extends it with a
 * new, curvature-limited segment; right-clicking undoes the most recently
 * laid segment (a plain stack, so repeated right-clicks walk back further).
 * If a drag's end passes close to a different piece of track, it snaps onto
 * it with a tangent-matched join and a switch point instead of ending free.
 * Every branch point (where a new piece starts, and any auto-connected end)
 * gets a floating arrow showing — and letting you change — which way it's
 * switched; clicking an arrow toggles it.
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
  let nextId = 1
  let nextJunctionId = 1
  const undoStack = []
  const junctions = []
  let drag = null

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
   * Finds the closest point, on any track piece other than the one given, to
   * a world point — if one exists within SNAP_TOLERANCE.
   *
   * @param {THREE.Vector3} point World point to search near (e.g. the live drag target).
   * @param {TrackPiece} excludePiece Piece to ignore (the one the current drag started from).
   * @returns {{piece: TrackPiece, t: number, point: THREE.Vector3, distance: number} | null} Closest nearby point, or null if nothing is within tolerance.
   */
  function findSnapTarget(point, excludePiece) {
    let best = null
    for (const piece of pieces) {
      if (piece === excludePiece) continue
      const closest = closestPointOnCurve(piece.curve, point, { closed: piece.closed })
      if (closest.distance <= SNAP_TOLERANCE && (!best || closest.distance < best.distance)) {
        best = { piece, t: closest.t, point: closest.point, distance: closest.distance }
      }
    }
    return best
  }

  /**
   * Given a fixed start point/tangent and a free target point, finds the
   * buildable end point closest to the target that keeps the curve within
   * the minimum radius.
   *
   * For this tangent-locked construction (the control point sits on the
   * fixed start tangent, at half the chord length), the radius of curvature
   * for a given deflection angle scales with distance — a sharp turn only
   * becomes safe with enough room to curve through, not less. So distance
   * is preserved from the drag, and only the deflection angle (between the
   * fixed tangent and the chord to the target) is clamped, swinging the end
   * point toward the tangent just enough to stay within the minimum radius.
   *
   * @param {THREE.Vector3} start Fixed start point.
   * @param {THREE.Vector3} tangent Unit tangent the new track must leave the start point along.
   * @param {THREE.Vector3} target Free target point (e.g. under the cursor).
   * @returns {{end: THREE.Vector3, control: THREE.Vector3}} Clamped end point and the matching Bezier control point.
   */
  function clampToBuildable(start, tangent, target) {
    const direct = new THREE.Vector3().subVectors(target, start)
    const distance = direct.length()
    if (distance < 1e-4) return { end: start.clone(), control: start.clone() }

    const chordDir = direct.clone().normalize()
    const handleLength = distance * 0.5
    const control = new THREE.Vector3().copy(start).addScaledVector(tangent, handleLength)

    const axis = new THREE.Vector3().crossVectors(tangent, chordDir)
    if (axis.lengthSq() < 1e-10) {
      // Chord already runs along (or exactly against) the tangent — no turning involved either way.
      const end = new THREE.Vector3().copy(start).addScaledVector(chordDir, distance)
      return { end, control }
    }
    axis.normalize()
    const fullAngle = Math.min(
      Math.acos(THREE.MathUtils.clamp(tangent.dot(chordDir), -1, 1)),
      MAX_DEFLECTION_ANGLE,
    )

    function endAndRadiusForAngle(theta) {
      const rotatedChordDir = tangent.clone().applyAxisAngle(axis, theta)
      const end = new THREE.Vector3().copy(start).addScaledVector(rotatedChordDir, distance)
      return { end, radius: quadraticBezierMinRadius(start, control, end) }
    }

    let best = endAndRadiusForAngle(fullAngle)
    if (best.radius < MIN_CURVE_RADIUS) {
      let lo = 0 // angle 0 (straight ahead) always has infinite radius, so it's always safe
      let hi = fullAngle
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2
        const candidate = endAndRadiusForAngle(mid)
        if (candidate.radius >= MIN_CURVE_RADIUS) {
          lo = mid
          best = candidate
        } else {
          hi = mid
        }
      }
    }
    return { end: best.end, control }
  }

  /**
   * Tries to build a smooth, tangent-matched connection from a fixed
   * start point/tangent to a point on another piece of track, so the new
   * track joins it like a real point rather than butting in at an angle.
   * Returns null if no nearby track is in range, or if the smoothest
   * possible join would still be tighter than the minimum curve radius.
   *
   * @param {THREE.Vector3} start Fixed start point.
   * @param {THREE.Vector3} tangent Unit tangent the new track must leave the start point along.
   * @param {THREE.Vector3} searchPoint Point to search near for other track (e.g. the live drag target).
   * @param {TrackPiece} excludePiece The piece the drag started from, excluded from the search.
   * @returns {{piece: TrackPiece, t: number, point: THREE.Vector3, tangent: THREE.Vector3, curve: THREE.CubicBezierCurve3} | null} The snap target and matching curve, or null.
   */
  function trySnapConnection(start, tangent, searchPoint, excludePiece) {
    const target = findSnapTarget(searchPoint, excludePiece)
    if (!target) return null

    const targetTangent = target.piece.curve.getTangentAt(target.t).clone()
    const chord = start.distanceTo(target.point)
    if (chord < 1e-4) return null

    // Reject a join that would need a sharper turn than a single segment is
    // ever allowed to make at either end — otherwise a cubic curve (unlike
    // the quadratic free-drag case) can form a genuine S-bend that still
    // passes the pointwise minimum-radius check but is still unworkable for
    // a long rigid vehicle.
    const chordDir = new THREE.Vector3().subVectors(target.point, start).normalize()
    const departureAngle = Math.acos(THREE.MathUtils.clamp(tangent.dot(chordDir), -1, 1))
    const arrivalAngle = Math.acos(THREE.MathUtils.clamp(targetTangent.dot(chordDir), -1, 1))
    if (departureAngle > MAX_DEFLECTION_ANGLE || arrivalAngle > MAX_DEFLECTION_ANGLE) return null

    const handleLength = chord / 3
    const p1 = new THREE.Vector3().copy(start).addScaledVector(tangent, handleLength)
    const p2 = new THREE.Vector3().copy(target.point).addScaledVector(targetTangent, -handleLength)
    const curve = new THREE.CubicBezierCurve3(start.clone(), p1, p2, target.point.clone())

    if (curveMinRadius(curve, 30) < MIN_CURVE_RADIUS) return null
    return { piece: target.piece, t: target.t, point: target.point, tangent: targetTangent, curve }
  }

  /**
   * Creates a switch arrow at a point, adds it to the scene, and registers
   * it in the shared junction list along with the routing it controls.
   *
   * @param {THREE.Vector3} position Where the switch sits.
   * @param {THREE.Vector3[]} directions The two directions it can point.
   * @param {TrackPiece} hostPiece Piece a train passes straight through on when this switch is at index 0.
   * @param {number} hostT Parameter on hostPiece where the switch sits.
   * @param {TrackPiece} divertPiece Piece a train is sent onto when this switch is thrown to index 1.
   * @param {number} divertT Parameter on divertPiece to continue from.
   * @param {1 | -1} divertDirection Direction of travel to continue in on divertPiece.
   * @returns {Junction} The new junction.
   */
  function createJunctionAt(position, directions, hostPiece, hostT, divertPiece, divertT, divertDirection) {
    const { group, pickMesh, routes } = createJunctionArrow()
    scene.add(group)

    // Velocity continuity at the transition requires hostTangent * hostDirection
    // to equal divertTangent * divertDirection (both are unit vectors, so they
    // must be exactly parallel or exactly opposite — true by construction for
    // both callers). Solving for hostDirection gives the one host travel
    // direction this switch is actually a fork for; from the other direction,
    // "diverting" would require an instant reversal, so it must never be
    // offered as an event at all.
    const hostTangent = hostPiece.curve.getTangentAt(hostT)
    const divertTangentAtEntry = divertPiece.curve.getTangentAt(divertT)
    const alignment = hostTangent.dot(divertTangentAtEntry) >= 0 ? 1 : -1
    const requiredHostDirection = divertDirection * alignment

    const junction = {
      id: nextJunctionId++,
      position: position.clone(),
      directions,
      activeIndex: 0,
      group,
      pickMesh,
      routes,
      hostPiece,
      hostT,
      requiredHostDirection,
      divertPiece,
      divertT,
      divertDirection,
    }
    placeJunctionArrow(junction)
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
   * Rebuilds the drag preview tube from the current drag's curve.
   *
   * @returns {void}
   */
  function updatePreview() {
    if (drag.previewMesh) {
      scene.remove(drag.previewMesh)
      disposeDeep(drag.previewMesh)
    }
    const curve = drag.snap ? drag.snap.curve : new THREE.QuadraticBezierCurve3(drag.start, drag.control, drag.end)
    const geometry = new THREE.TubeGeometry(curve, PREVIEW_SAMPLES, PREVIEW_RADIUS, 6, false)
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
    controls.enabled = true
    drag = null
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

    const rawTangent = hit.piece.curve.getTangentAt(hit.t).clone()
    drag = {
      pointerId: event.pointerId,
      startPiece: hit.piece,
      startT: hit.t,
      start: hit.point.clone(),
      rawTangent,
      tangentSign: 1, // default: continue the same way the source piece was heading
      control: hit.point.clone(),
      end: hit.point.clone(),
      snap: null,
      previewMesh: null,
    }
  }

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  function handlePointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    setPointerFromEvent(event)
    const ground = pickGround()
    if (!ground) return

    drag.tangentSign = pickTangentSign(drag.rawTangent, drag.start, ground)
    const tangent = drag.rawTangent.clone().multiplyScalar(drag.tangentSign)
    const { end, control } = clampToBuildable(drag.start, tangent, ground)
    drag.end = end
    drag.control = control
    drag.tangent = tangent
    drag.snap = trySnapConnection(drag.start, tangent, ground, drag.startPiece)
    updatePreview()
  }

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  function handlePointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return

    const finalCurve = drag.snap ? drag.snap.curve : new THREE.QuadraticBezierCurve3(drag.start, drag.control, drag.end)
    if (drag.previewMesh) {
      scene.remove(drag.previewMesh)
      disposeDeep(drag.previewMesh)
    }

    if (finalCurve.getLength() >= MIN_SEGMENT_LENGTH) {
      const { group, pickMesh } = buildTrackMeshes(finalCurve, { closed: false })
      scene.add(group)
      const piece = { id: nextId++, curve: finalCurve, closed: false, group, pickMesh, junctions: [] }
      pieces.push(piece)
      undoStack.push(piece)

      // Branch point: where this new piece leaves its source track. Only a
      // real junction if the source track continues past this point some
      // other way too — building off an open piece's free end is just an
      // extension, with nowhere else to go, so it gets no switch arrow.
      if (!isAtFreeEnd(drag.startPiece, drag.startT)) {
        piece.junctions.push(
          createJunctionAt(
            drag.start,
            [
              sampleDirectionAlong(drag.startPiece.curve, drag.startT, JUNCTION_SAMPLE_DISTANCE, drag.startPiece.closed),
              sampleDirectionAlong(finalCurve, 0, JUNCTION_SAMPLE_DISTANCE, false),
            ],
            drag.startPiece,
            drag.startT,
            piece,
            0,
            1,
          ),
        )
      }

      // Auto-connected end, if this drag snapped onto another piece — same rule applies there.
      if (drag.snap && !isAtFreeEnd(drag.snap.piece, drag.snap.t)) {
        piece.junctions.push(
          createJunctionAt(
            drag.snap.point,
            [
              sampleDirectionAlong(drag.snap.piece.curve, drag.snap.t, JUNCTION_SAMPLE_DISTANCE, drag.snap.piece.closed),
              sampleDirectionAlong(finalCurve, 1, -JUNCTION_SAMPLE_DISTANCE, false),
            ],
            drag.snap.piece,
            drag.snap.t,
            piece,
            1,
            -1,
          ),
        )
      }
    }

    controls.enabled = true
    drag = null
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
    const index = pieces.indexOf(piece)
    if (index !== -1) pieces.splice(index, 1)
    piece.junctions.forEach(disposeJunction)
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
      enabled = value
      if (!value) cancelDrag()
    },

    /**
     * Removes all event listeners, cancels any in-progress drag, and frees
     * every junction arrow's geometry and shared materials. Does not remove
     * already-committed track pieces.
     *
     * @returns {void}
     */
    dispose() {
      cancelDrag()
      domElement.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      domElement.removeEventListener('contextmenu', handleContextMenu)
      domElement.removeEventListener('click', handleClick)
      junctions.slice().forEach(disposeJunction)
      disposeSharedJunctionMaterials()
    },

    /**
     * Live, read-only-by-convention list of every junction currently in the
     * network (switch state, routing, and arrow). Used by the train's path
     * walker to decide where to go at each one.
     */
    junctions,
  }
}
