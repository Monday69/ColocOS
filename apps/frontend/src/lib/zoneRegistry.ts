import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Registre mesh 3D ↔ zone de stockage
//
// Module neutre (aucune dépendance React/R3F) partagé par FridgeCAD (écriture),
// ProductItem3D (placement des packagings) et CameraController (cadrage).
// Évite un import circulaire FridgeCAD ↔ ProductItem3D.
// ─────────────────────────────────────────────────────────────────────────────

const zoneObjects = new Map<string, Set<THREE.Object3D>>()

/** Enregistre un mesh pour une zone. Retourne la fonction de désinscription. */
export function registerZoneObject(zoneId: string, object: THREE.Object3D): () => void {
  const set = zoneObjects.get(zoneId) ?? new Set<THREE.Object3D>()
  zoneObjects.set(zoneId, set)
  set.add(object)

  return () => {
    set.delete(object)
    if (set.size === 0) zoneObjects.delete(zoneId)
  }
}

/**
 * Bornes des meshes d'une zone.
 * @param relativeTo Exprime le résultat dans le repère de cet objet (ex. groupe
 *   de porte) — indispensable pour que les produits des balconnets pivotent avec
 *   la porte. Sans argument → bornes monde.
 */
export function getZoneBounds(
  zoneId: string,
  relativeTo?: THREE.Object3D | null,
): THREE.Box3 | null {
  const objects = zoneObjects.get(zoneId)
  if (!objects || objects.size === 0) return null

  const inverse = new THREE.Matrix4()
  if (relativeTo) {
    relativeTo.updateWorldMatrix(true, false)
    inverse.copy(relativeTo.matrixWorld).invert()
  } else {
    inverse.identity()
  }

  const matrix = new THREE.Matrix4()
  const scratch = new THREE.Box3()
  const box = new THREE.Box3()

  for (const object of objects) {
    const mesh = object as THREE.Mesh
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (!geometry) continue

    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const local = geometry.boundingBox
    if (!local) continue

    mesh.updateWorldMatrix(true, false)
    matrix.multiplyMatrices(inverse, mesh.matrixWorld)
    scratch.copy(local).applyMatrix4(matrix)
    box.union(scratch)
  }

  return box.isEmpty() ? null : box
}
