import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { getZoneBounds } from '@/lib/zoneRegistry'

interface CameraControllerProps {
  selectedZoneId?: string | null
  /** Packaging sélectionné (clic sur un produit) — priorité sur la zone */
  selectedItemId?: string | null
  controlsRef: React.RefObject<OrbitControlsImpl>
}

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — CameraController (autofocus Digital Twin)
//
// Le meuble CAD n'est PAS centré sur [0,0,0] : d'après les transforms du GLB,
// le caisson occupe X ∈ [-1.24, -0.44], Y ∈ [0.53, 2.31], Z ∈ [-0.75, -0.13],
// soit un centre ≈ [-0.84, 1.42, -0.44]. La face avant est +Z.
//
// Deux niveaux de cadrage :
//   1. Bornes 3D réelles du/des mesh(s) de la zone (registre alimenté par
//      FridgeCAD) → cadre exact, y compris pour les balconnets quand la porte
//      a tourné.
//   2. Fallback statique (ZONE_CAMERA_TARGETS) si le mesh n'est pas encore monté.
// ─────────────────────────────────────────────────────────────────────────────

type Framing = { target: [number, number, number]; position: [number, number, number] }

/** Cadrage dédié aux bacs à légumes (inspection du bas du frigo) */
const CRISPER_ZONE_IDS = new Set(['fridge_crisper_left', 'fridge_crisper_right'])

/** Angle de plongee dans le bac ouvert (degres sous l'horizontale) */
const CRISPER_PLUNGE_DEG = 40

/**
 * Vue plongeante calculee sur les bornes reelles du bac.
 *
 * Les coordonnees absolues du brief (z ~ 0.85) placent la camera a l'interieur
 * du caisson : le GLB range les bacs a z ~ -0.5. On derive donc la position des
 * bornes du mesh, avec une cible abaissee sous le tiroir pour le projeter dans
 * le tiers superieur de l'ecran, au-dessus du volet de detail.
 */
function crisperFraming(zoneId: string): Framing | null {
  const bounds = getZoneBounds(zoneId)
  if (!bounds) return null

  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const fov = (44 * Math.PI) / 180
  const extent = Math.max(size.x, size.z, size.y, 0.3)
  const distance = (extent / (2 * Math.tan(fov / 2))) * 2.0
  const angle = (CRISPER_PLUNGE_DEG * Math.PI) / 180

  return {
    position: [
      center.x,
      center.y + Math.sin(angle) * distance,
      center.z + Math.cos(angle) * distance,
    ],
    target: [center.x, center.y - 0.30, center.z],
  }
}

const ZONE_CAMERA_TARGETS: Record<string, Framing> = {
  // Vue d'ensemble par défaut (frigo entier, 3/4 face)
  DEFAULT: {
    target: [-0.84, 1.55, 0],
    // Cadrage final 390 px : recul à 2.80 m pour que le frigo tienne en largeur
    // (plus de débordement à droite) tout en gardant la hauteur utile.
    position: [-0.84, 1.65, 2.9],
  },
  fridge_shelf_top: {
    target: [-0.84, 1.51, -0.5],
    position: [-0.84, 1.58, 1.0],
  },
  fridge_shelf_middle: {
    target: [-0.84, 1.23, -0.5],
    position: [-0.84, 1.3, 1.0],
  },
  fridge_shelf_bottom: {
    target: [-0.84, 1.1, -0.52],
    position: [-0.84, 1.18, 1.0],
  },
  fridge_crisper_left: {
    target: [-1.03, 0.8, -0.45],
    position: [-1.03, 0.9, 0.9],
  },
  fridge_crisper_right: {
    target: [-0.66, 0.8, -0.45],
    position: [-0.66, 0.9, 0.9],
  },
  freezer_drawer_1: {
    target: [-0.85, 2.03, -0.45],
    position: [-0.85, 2.12, 0.85],
  },
  fridge_door_shelf_1: {
    target: [-0.84, 1.62, -0.15],
    position: [-0.84, 1.7, 0.85],
  },
  fridge_door_shelf_2: {
    target: [-0.84, 1.43, -0.15],
    position: [-0.84, 1.5, 0.85],
  },
  fridge_door_shelf_3: {
    target: [-0.84, 1.1, -0.15],
    position: [-0.84, 1.2, 0.85],
  },
}

const DEFAULT_FRAMING = ZONE_CAMERA_TARGETS.DEFAULT

// Distance de recul bornée — évite les gros plans inutilisables sur un mesh plat
const MIN_DISTANCE = 0.75
const MAX_DISTANCE = 2.5
const DISTANCE_FACTOR = 2.0

/** Cadrage déduit des bornes réelles du mesh — face avant = +Z. */
function framingFromBounds(zoneId: string): Framing | null {
  const box = getZoneBounds(zoneId)
  if (!box) return null

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  const span = Math.max(size.x, size.y, 0.05)
  const distance = THREE.MathUtils.clamp(span * DISTANCE_FACTOR, MIN_DISTANCE, MAX_DISTANCE)

  return {
    target: [center.x, center.y, center.z],
    position: [center.x, center.y + size.y * 0.25, center.z + distance],
  }
}

// ── Zoom « objet » (clic sur un packaging) ──────────────────────────────────
// On ne cadre plus la clayette entière (son échelle recule la caméra, surtout
// en portrait), mais le packaging lui-même : cible = centre monde du mesh,
// caméra à ~0.4 m, légèrement au-dessus (plongée douce).

const ITEM_DISTANCE = 0.4
const ITEM_RISE = 0.1

function framingForItem(
  scene: THREE.Object3D,
  camera: THREE.Camera,
  itemId: string,
): Framing | null {
  const object = scene.getObjectByName(`item:${itemId}`)
  if (!object) return null

  const target = object.getWorldPosition(new THREE.Vector3())

  // On garde le côté d'où l'utilisateur regarde (jamais à travers la porte)
  const direction = new THREE.Vector3().subVectors(camera.position, target)
  direction.y = 0
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1)
  direction.normalize()

  const position = target.clone().addScaledVector(direction, ITEM_DISTANCE)
  position.y = target.y + ITEM_RISE

  return {
    target: [target.x, target.y, target.z],
    position: [position.x, position.y, position.z],
  }
}

export function CameraController({ selectedZoneId, selectedItemId, controlsRef }: CameraControllerProps) {
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const isTransitioning = useRef(false)
  const targetLookAt = useRef(new THREE.Vector3(...DEFAULT_FRAMING.target))
  const targetCamPos = useRef(new THREE.Vector3(...DEFAULT_FRAMING.position))

  const zoneId = selectedZoneId ?? null
  const itemId = selectedItemId ?? null
  const fallback = useMemo(
    () => (zoneId && ZONE_CAMERA_TARGETS[zoneId]) || DEFAULT_FRAMING,
    [zoneId],
  )

  const applyFraming = (framing: Framing) => {
    targetLookAt.current.set(...framing.target)
    targetCamPos.current.set(...framing.position)
    isTransitioning.current = true
  }

  // ── Priorité 1 : zoom sur le packaging sélectionné ────────────────────────
  // Le mesh peut être monté quelques frames après la sélection (chargement du
  // GLB, placement dans la clayette) : on retente tant que l'objet est absent.
  useEffect(() => {
    if (!itemId) return

    const framing = framingForItem(scene, camera, itemId)
    if (framing) {
      applyFraming(framing)
      return
    }

    let frame = 0
    let raf = 0
    const retry = () => {
      const next = framingForItem(scene, camera, itemId)
      if (next) {
        applyFraming(next)
        return
      }
      if (frame++ < 120) raf = requestAnimationFrame(retry)
    }
    retry()
    return () => cancelAnimationFrame(raf)
    // `camera` est stable ; on ne veut recalculer qu'au changement de sélection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, scene, camera])

  // ── Priorité 2 : cadrage de la clayette (ou vue d'ensemble) ───────────────
  // Désélectionné / pas d'item : on retrouve la clayette ouverte s'il y en a une,
  // sinon la vue d'ensemble d'origine.
  useEffect(() => {
    if (itemId) return
    // Bacs à légumes : cadrage dédié (bas du frigo) plutôt que les bornes du mesh
    if (zoneId && CRISPER_ZONE_IDS.has(zoneId)) {
      const plunge = crisperFraming(zoneId)
      if (plunge) {
        applyFraming(plunge)
        return
      }
    }
    // Balconnets de porte : la porte est pivotee a gauche, une vue de face
    // classique ne montre que la tranche. On se decale sur le flanc gauche et
    // on avance en Z pour regarder droit dans les rangements.
    if (zoneId && zoneId.startsWith('fridge_door_')) {
      const doorBox = getZoneBounds(zoneId)
      if (doorBox) {
        const doorCenter = doorBox.getCenter(new THREE.Vector3())
        const doorSize = doorBox.getSize(new THREE.Vector3())
        const doorSpan = Math.max(doorSize.x, doorSize.y, 0.05)
        const doorDistance = THREE.MathUtils.clamp(
          doorSpan * DISTANCE_FACTOR,
          MIN_DISTANCE,
          MAX_DISTANCE,
        )
        // 52 deg sur le flanc gauche : la porte ouverte est de biais, il faut
        // se decaler lateralement pour voir l'interieur des balconnets
        const doorAngle = (52 * Math.PI) / 180
        applyFraming({
          position: [
            doorCenter.x + Math.sin(doorAngle) * doorDistance,
            doorCenter.y + doorSize.y * 0.25,
            doorCenter.z + Math.cos(doorAngle) * doorDistance,
          ],
          target: [doorCenter.x, doorCenter.y, doorCenter.z],
        })
        return
      }
    }

    applyFraming((zoneId ? framingFromBounds(zoneId) : null) ?? fallback)
  }, [itemId, zoneId, fallback])

  // Sécurité : si les meshes n'étaient pas encore enregistrés au premier passage
  // (ex. GLB en cours de chargement), on recalcule dès qu'une frame est disponible.
  useEffect(() => {
    if (!zoneId || itemId) return
    if (getZoneBounds(zoneId)) return
    const id = window.setTimeout(() => {
      const framing = framingFromBounds(zoneId)
      if (!framing) return
      targetLookAt.current.set(...framing.target)
      targetCamPos.current.set(...framing.position)
      isTransitioning.current = true
    }, 250)
    return () => window.clearTimeout(id)
  }, [zoneId, itemId])

  useFrame((state, delta) => {
    if (!controlsRef.current || !isTransitioning.current) return

    const controls = controlsRef.current
    const camera = state.camera

    // Amorti exponentiel indépendant du framerate (1 - e^(-k·dt)) : la caméra
    // glisse sans à-coup et ne « saute » jamais sur une frame longue (mobile).
    // Deux constantes distinctes : la cible suit un peu plus vite que la caméra
    // → l'objectif se pose avant le déplacement, ce qui supprime les à-coups
    // angulaires en fin de transition.
    const lookLambda = 4.2
    const moveLambda = 3.6
    const lookStep = 1 - Math.exp(-lookLambda * delta)
    const moveStep = 1 - Math.exp(-moveLambda * delta)

    controls.target.lerp(targetLookAt.current, lookStep)
    camera.position.lerp(targetCamPos.current, moveStep)
    controls.update()

    // Fin de transition : recalage exact puis rendu de la main à l'utilisateur
    const targetDist = controls.target.distanceTo(targetLookAt.current)
    const camDist = camera.position.distanceTo(targetCamPos.current)

    if (targetDist < 0.012 && camDist < 0.018) {
      controls.target.copy(targetLookAt.current)
      camera.position.copy(targetCamPos.current)
      controls.update()
      isTransitioning.current = false
    }
  })

  return null
}
