import * as THREE from 'three'

const LABEL_STYLE = {
  position: 'fixed',
  top: '12px',
  left: '12px',
  padding: '4px 10px',
  background: 'rgba(16, 18, 24, 0.82)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '4px',
  font: '13px ui-monospace, "Courier New", monospace',
  color: '#e5e7eb',
  pointerEvents: 'none',
  zIndex: '10',
  display: 'none',
}

/**
 * Shows the id of whichever track piece the pointer is over, in a small label fixed to the top-left
 * corner — a diagnostic aid for telling which (visually seamless) stretch of track belongs to which piece
 * (see track.js's buildBoundaryMarker for the matching white stripes at each piece's ends). Independent of
 * trackBuilder's own hover handling, so it works in both LAY and PLAY mode.
 *
 * @param {Object} deps
 * @param {THREE.Camera} deps.camera
 * @param {HTMLElement} deps.domElement Canvas to listen for pointer movement on.
 * @param {import('./trackBuilder.js').TrackPiece[]} deps.pieces Shared, live list of track pieces.
 * @returns {{dispose: () => void}} Call dispose to remove the listener and label element.
 */
export function createPieceInspector({ camera, domElement, pieces }) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  const label = document.createElement('div')
  Object.assign(label.style, LABEL_STYLE)
  document.body.appendChild(label)

  function handlePointerMove(event) {
    const rect = domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(pointer, camera)
    const pickMeshes = pieces.map((piece) => piece.pickMesh)
    const hits = raycaster.intersectObjects(pickMeshes, false)
    if (hits.length === 0) {
      label.style.display = 'none'
      return
    }
    const piece = pieces.find((candidate) => candidate.pickMesh === hits[0].object)
    label.textContent = `#${piece.id} — ${piece.type ?? 'unknown'}`
    label.style.display = 'block'
  }

  domElement.addEventListener('pointermove', handlePointerMove)

  return {
    dispose() {
      domElement.removeEventListener('pointermove', handlePointerMove)
      label.remove()
    },
  }
}
