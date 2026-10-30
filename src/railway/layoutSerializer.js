import * as THREE from 'three'
import { buildTrackMeshes } from './track.js'
import { buildJunction } from './trackGraph.js'
import { placeJunctionArrow } from './junctionArrow.js'
import { createPlatformMesh } from './platform.js'
import { buildStationInstance } from './stationBuilder.js'

/**
 * Converts a track piece's curve to a plain, JSON-safe object — exact and lossless, since every piece's
 * curve is always one of these two THREE.Curve kinds (see trackCatalogue.js's placeStraight/placeArc),
 * both fully defined by the data captured here.
 *
 * @param {THREE.Curve} curve
 * @returns {Object}
 */
function serializeCurve(curve) {
  if (curve.isLineCurve3) {
    return { kind: 'line', v1: curve.v1.toArray(), v2: curve.v2.toArray() }
  }
  return {
    kind: 'catmullrom',
    points: curve.points.map((point) => point.toArray()),
    closed: curve.closed,
    curveType: curve.curveType,
    tension: curve.tension,
  }
}

/**
 * Reconstructs a curve from serializeCurve's output.
 *
 * @param {Object} data
 * @returns {THREE.Curve}
 */
function deserializeCurve(data) {
  if (data.kind === 'line') {
    return new THREE.LineCurve3(new THREE.Vector3().fromArray(data.v1), new THREE.Vector3().fromArray(data.v2))
  }
  const points = data.points.map((point) => new THREE.Vector3().fromArray(point))
  return new THREE.CatmullRomCurve3(points, data.closed, data.curveType, data.tension)
}

/**
 * @param {import('./trackBuilder.js').PieceLink | null} link
 * @returns {Object | null}
 */
function serializeLink(link) {
  return link ? { pieceId: link.piece.id, end: link.end } : null
}

/**
 * @param {import('./trackBuilder.js').TrackPiece} piece
 * @returns {Object} JSON-safe snapshot of one piece.
 */
export function serializePiece(piece) {
  return {
    id: piece.id,
    type: piece.type ?? 'straight',
    curve: serializeCurve(piece.curve),
    links: { start: serializeLink(piece.links.start), end: serializeLink(piece.links.end) },
  }
}

/**
 * @param {import('./trackBuilder.js').Junction} junction
 * @returns {Object} JSON-safe snapshot of one junction.
 */
export function serializeJunction(junction) {
  return {
    id: junction.id,
    hostPieceId: junction.hostPiece.id,
    hostT: junction.hostT,
    divertPieceId: junction.divertPiece.id,
    divertT: junction.divertT,
    divertDirection: junction.divertDirection,
    activeIndex: junction.activeIndex,
  }
}

/**
 * @param {import('./platformBuilder.js').PlatformItem} platform
 * @returns {Object} JSON-safe snapshot of one platform item.
 */
export function serializePlatform(platform) {
  return { id: platform.id, kind: platform.kind, start: platform.start.toArray(), tangent: platform.tangent.toArray() }
}

/**
 * Rebuilds real PlatformItem objects (meshes added to `scene`) from a saved layout's data — the mirror
 * image of serializePlatform. Independent of pieces/junctions: platforms don't reference track or each
 * other, so there's no cross-referencing pass needed the way deserializeLayout's links/junctions need.
 *
 * `kind` defaults to 'section' for layouts saved before platform ramps existed, when every saved platform
 * was implicitly a flat section.
 *
 * @param {Object[]} platformsData As returned by api/layouts/load.php's `platforms` array.
 * @param {THREE.Scene} scene Scene to add every item's mesh to.
 * @returns {import('./platformBuilder.js').PlatformItem[]}
 */
export function deserializePlatforms(platformsData, scene) {
  return platformsData.map((data) => {
    const kind = data.kind ?? 'section'
    const start = new THREE.Vector3().fromArray(data.start)
    const tangent = new THREE.Vector3().fromArray(data.tangent)
    const mesh = createPlatformMesh(kind, start, tangent)
    scene.add(mesh)
    return { id: data.id, kind, start, tangent, mesh }
  })
}

/**
 * @param {import('./stationBuilder.js').StationInstance} station
 * @returns {Object} JSON-safe snapshot of one placed station.
 */
export function serializeStation(station) {
  return { id: station.id, key: station.key, start: station.start.toArray(), tangent: station.tangent.toArray(), facing: station.facing }
}

/**
 * Rebuilds real station instances (models added to `scene`) from a saved layout's data — the mirror image
 * of serializeStation. Each station re-derives its own placement from the saved start/tangent (the
 * platform section it was dropped on, at the time it was dropped), independent of whatever platforms
 * happen to be in the layout now — same independence platforms themselves have from track. Loading the
 * underlying glTF is async, so unlike every other asset type this resolves once the models are in, not
 * synchronously.
 *
 * @param {Object[]} stationsData As returned by api/layouts/load.php's `stations` array.
 * @param {THREE.Scene} scene Scene to add every instance's model to.
 * @returns {Promise<import('./stationBuilder.js').StationInstance[]>}
 */
export function deserializeStations(stationsData, scene) {
  return Promise.all(
    stationsData.map(async (data) => {
      const start = new THREE.Vector3().fromArray(data.start)
      const tangent = new THREE.Vector3().fromArray(data.tangent)
      const facing = data.facing ?? 1
      const { group, ready } = await buildStationInstance(data.key, { start, tangent }, facing)
      scene.add(group)
      return { id: data.id, key: data.key, start, tangent, facing, ready, group }
    }),
  )
}

/**
 * Builds the full JSON-safe payload for saving the current layout — see api/layouts/save.php.
 *
 * @param {import('./trackBuilder.js').TrackPiece[]} pieces
 * @param {import('./trackBuilder.js').Junction[]} junctions
 * @param {import('./platformBuilder.js').PlatformSection[]} platforms
 * @param {import('./stationBuilder.js').StationInstance[]} stations
 * @returns {{pieces: Object[], junctions: Object[], platforms: Object[], stations: Object[]}}
 */
export function buildLayoutSnapshot(pieces, junctions, platforms, stations) {
  return {
    pieces: pieces.map(serializePiece),
    junctions: junctions.map(serializeJunction),
    platforms: platforms.map(serializePlatform),
    stations: stations.map(serializeStation),
  }
}

/**
 * Rebuilds real TrackPiece and Junction objects (meshes added to `scene`) from a saved layout's data — the
 * mirror image of buildLayoutSnapshot. Pieces are built first so junctions (which reference them) and
 * cross-piece links can be resolved against real objects, not just the saved numeric ids.
 *
 * Markers aren't restored here — call trackBuilder.js's markInitialDanglingEnds() afterwards, same as for
 * the procedurally-built starting layout, to flag whichever ends turn out to be genuinely open.
 *
 * @param {Object} data As returned by api/layouts/load.php — `{pieces, junctions}`.
 * @param {THREE.Scene} scene Scene to add every piece's meshes and junction arrows to.
 * @returns {{pieces: import('./trackBuilder.js').TrackPiece[], junctions: import('./trackBuilder.js').Junction[]}}
 */
export function deserializeLayout(data, scene) {
  const pieceById = new Map()
  for (const pieceData of data.pieces) {
    const curve = deserializeCurve(pieceData.curve)
    const { group, pickMesh } = buildTrackMeshes(curve, { closed: false })
    scene.add(group)
    pieceById.set(pieceData.id, {
      id: pieceData.id,
      curve,
      closed: false,
      group,
      pickMesh,
      links: { start: null, end: null },
      markers: { start: null, end: null },
      type: pieceData.type,
    })
  }

  for (const pieceData of data.pieces) {
    const piece = pieceById.get(pieceData.id)
    for (const end of ['start', 'end']) {
      const link = pieceData.links[end]
      if (link) piece.links[end] = { piece: pieceById.get(link.pieceId), end: link.end }
    }
  }

  const junctions = data.junctions.map((junctionData) => {
    const junction = buildJunction(
      junctionData.id,
      scene,
      pieceById.get(junctionData.hostPieceId),
      junctionData.hostT,
      pieceById.get(junctionData.divertPieceId),
      junctionData.divertT,
      junctionData.divertDirection,
    )
    junction.activeIndex = junctionData.activeIndex
    placeJunctionArrow(junction)
    return junction
  })

  return { pieces: Array.from(pieceById.values()), junctions }
}
