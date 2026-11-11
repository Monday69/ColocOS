import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { getZoneBounds } from '@/lib/zoneRegistry'
import { getExpiryStatus, getExpiryStatusFromDays, EXPIRY_COLORS } from '@/lib/expiry'
import { useUIStore } from '@/store'
import { ProductTooltip } from './ProductTooltip'
import type { ZoneItemTwin } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — ProductItem3D
//
// Packaging procédural posé sur une clayette du frigo CAD.
//   • Boîte 0.07 × 0.14 × 0.07 (échelle du meuble : ~1.8 m de haut)
//   • Face avant (+Z) texturée avec l'image OpenFoodFacts
//   • Autres faces : carton neutre partagé (#e2e8f0)
//   • Halo + léger agrandissement au survol
//   • Clic → sélection de l'item (store) → tooltip ancré au sommet du packaging
//     (nom, marque, Nutriscore, propriétaire, DLC, action « Consommer »).
//     Le clic n'ouvre plus le panneau de zone : `stopPropagation` empêche le
//     handler de la clayette parente.
//
// La texture est chargée impérativement (TextureLoader) plutôt que via
// useTexture/Suspense : une image OFF en CORS/404 ne doit jamais bloquer la
// scène, on retombe simplement sur le carton neutre.
// ─────────────────────────────────────────────────────────────────────────────

const ITEM_W = 0.07
const ITEM_H = 0.14
const ITEM_D = 0.07
const ITEM_GAP = 0.015
/** Tolérance de contact : 1,5 mm au-dessus de la face supérieure, juste assez
 *  pour éviter le Z-fighting avec le verre — aucun effet de lévitation. */
const ITEM_FLOOR_LIFT = 0.0015
/** Budget maximal d'attente d'une photo produit distante. */
export const TEXTURE_TIMEOUT_MS = 3000
/** Marge par rapport au bord avant de la clayette. */
const Z_FRONT_MARGIN = 0.04
/** Décalage vers l'avant pour dégager les packagings du fond du meuble. */
const Z_FORWARD_BIAS = 0.05
/** Fenêtre de recherche des bornes de zone avant de renoncer (ms). */
const PLACEMENT_TIMEOUT_MS = 10000

// ── Couleurs émissives statiques ──────────────────────────────────────────────
// Instanciées une seule fois au chargement du module : la boucle `useFrame` ne
// doit jamais créer de `THREE.Color` (GC sur Safari iOS = micro-saccades).
const EMISSIVE_CRITICAL = new THREE.Color(EXPIRY_COLORS.critical)
const EMISSIVE_WARNING = new THREE.Color(EXPIRY_COLORS.warning)
const EMISSIVE_RECIPE = new THREE.Color('#00e676')
const EMISSIVE_SELECTED = new THREE.Color('#22d3ee')
const EMISSIVE_HOVER = new THREE.Color('#4fc3f7')
const EMISSIVE_OFF = new THREE.Color('#000000')

/**
 * Ombre de contact « douce » partagée par tous les packagings.
 * Une simple texture radiale rend un ancrage naturel sur la clayette sans
 * coût de shadow-map supplémentaire (et sans frustum culling par produit).
 */
let contactShadowTexture: THREE.Texture | null = null

function getContactShadowTexture(): THREE.Texture {
  if (contactShadowTexture) return contactShadowTexture

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)')
  gradient.addColorStop(0.5, 'rgba(0,0,0,0.24)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  contactShadowTexture = texture
  return texture
}

function useProductTexture(url: string | null | undefined): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const textureRef = useRef<THREE.Texture | null>(null)

  useEffect(() => {
    // Libère la texture précédente (changement d'URL ou démontage)
    const disposePrevious = () => {
      textureRef.current?.dispose()
      textureRef.current = null
    }

    if (!url) {
      disposePrevious()
      setTexture(null)
      return
    }

    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')

    // Garde-fou : une photo OpenFoodFacts lente (tunnel mobile) ne doit pas
    // retarder l'affichage. Passé 3 s on garde définitivement le carton.
    const timeout = window.setTimeout(() => {
      cancelled = true
      setTexture(null)
    }, TEXTURE_TIMEOUT_MS)

    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose()
          return
        }
        window.clearTimeout(timeout)
        tex.colorSpace = THREE.SRGBColorSpace
        disposePrevious()
        textureRef.current = tex
        setTexture(tex)
      },
      undefined,
      () => {
        // CORS / 404 / réseau : fallback silencieux sur le carton
        window.clearTimeout(timeout)
        if (!cancelled) setTexture(null)
      },
    )

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [url])

  useEffect(() => () => {
    textureRef.current?.dispose()
    textureRef.current = null
  }, [])

  return texture
}

export interface ProductItem3DProps {
  item: ZoneItemTwin
  position: [number, number, number]
  /** Clayette d'appartenance : sert au pont « recette → zones surlignées » */
  zoneId?: string
  /** Intro cinématique : chute depuis +25 cm avec overshoot élastique */
  introActive?: boolean
  /** Retard d'apparition dans la cascade, en secondes */
  introDelay?: number
}

export function ProductItem3D({
  item,
  position,
  zoneId,
  introActive = false,
  introDelay = 0,
}: ProductItem3DProps) {
  const introGroupRef = useRef<THREE.Group>(null)
  const introStartRef = useRef<number | null>(null)
  const [hovered, setHovered] = useState(false)
  // Sélection pilotée par le store : un seul item sélectionné dans toute la scène
  const isSelected = useUIStore((s) => s.selectedItemId === item.id)
  const setSelectedItemId = useUIStore((s) => s.setSelectedItemId)
  // Recette survolée/épinglée → les packagings des zones concernées pulsent
  const isRecipeHighlighted = useUIStore(
    (s) => zoneId !== undefined && s.highlightedMeshIds.includes(zoneId),
  )
  const texture = useProductTexture(item.imageUrl)

  // Carton neutre possédé par l'instance : sa libération au démontage ne peut
  // jamais impacter les autres produits (pas de matériau partagé mutable).
  const cartonMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e2e8f0',
        roughness: 0.8,
        metalness: 0.04,
      }),
    [],
  )
  useEffect(() => () => cartonMaterial.dispose(), [cartonMaterial])

  const frontMaterial = useMemo(() => {
    if (!texture) return null
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.55,
      metalness: 0.03,
    })
  }, [texture])

  useEffect(() => () => frontMaterial?.dispose(), [frontMaterial])

  // Ordre des groupes de faces BoxGeometry : +X, -X, +Y, -Y, +Z, -Z
  const materials = useMemo(
    () => [
      cartonMaterial,
      cartonMaterial,
      cartonMaterial,
      cartonMaterial,
      frontMaterial ?? cartonMaterial,
      cartonMaterial,
    ],
    [cartonMaterial, frontMaterial],
  )

  const active = hovered || isSelected

  // ── Statut de péremption ──────────────────────────────────────────────────
  // `daysUntilExpiry` vient du backend : même arrondi que la couleur des zones,
  // donc jamais de packaging rouge sur une clayette verte. On ne recalcule
  // depuis `expiryDate` que si le champ est absent.
  const expiryStatus = useMemo(
    () =>
      item.daysUntilExpiry !== null && item.daysUntilExpiry !== undefined
        ? getExpiryStatusFromDays(item.daysUntilExpiry)
        : getExpiryStatus(item.expiryDate),
    [item.daysUntilExpiry, item.expiryDate],
  )

  // Tableau stable : `useFrame` tourne 60×/s, il ne doit rien allouer
  const emissiveTargets = useMemo(
    () => (frontMaterial ? [cartonMaterial, frontMaterial] : [cartonMaterial]),
    [cartonMaterial, frontMaterial],
  )

  // Coque d'alerte (BackSide, 1.02) : donne un liseré rouge/ambre lisible même
  // quand l'émissivité seule reste diluée par le carton clair. Matériau
  // possédé par l'instance, opacité pilotée par `useFrame` (zéro allocation).
  const alertShellMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.BackSide,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => alertShellMaterial.dispose(), [alertShellMaterial])

  const isExpiryAlert = expiryStatus === 'CRITICAL' || expiryStatus === 'WARNING'

  // Halo dynamique — priorité : sélection (cyan, géré par l'effet ci-dessous)
  // > recette survolée/épinglée (vert) > péremption (rouge / ambre).
  // Aucune allocation ici : couleurs statiques + matériaux pré-calculés.
  useFrame((state) => {
    if (isSelected) {
      alertShellMaterial.opacity = 0
      return
    }
    const t = state.clock.elapsedTime
    let color: THREE.Color
    let intensity: number

    if (isRecipeHighlighted) {
      color = EMISSIVE_RECIPE
      intensity = 0.18 + 0.12 * Math.sin(t * 3)
      alertShellMaterial.opacity = 0
    } else if (expiryStatus === 'CRITICAL') {
      // Alerte rapide : 0.15 → 0.65 (+ liseré 0.15 → 0.75)
      color = EMISSIVE_CRITICAL
      intensity = 0.4 + 0.25 * Math.sin(t * 5)
      alertShellMaterial.color.copy(color)
      alertShellMaterial.opacity = 0.45 + 0.3 * Math.sin(t * 5)
    } else if (expiryStatus === 'WARNING') {
      // Respiration lente : 0.05 → 0.35 (+ liseré 0.04 → 0.40)
      color = EMISSIVE_WARNING
      intensity = 0.2 + 0.15 * Math.sin(t * 2.5)
      alertShellMaterial.color.copy(color)
      alertShellMaterial.opacity = 0.22 + 0.18 * Math.sin(t * 2.5)
    } else {
      alertShellMaterial.opacity = 0
      return
    }

    for (let i = 0; i < emissiveTargets.length; i += 1) {
      const material = emissiveTargets[i]
      material.emissive.copy(color)
      material.emissiveIntensity = Math.max(0, intensity)
    }
  })

  // Surbrillance : émissive cyan, plus marquée quand l'item est sélectionné.
  // Les matériaux sont propres à l'instance → mutation sans effet de bord.
  // Cet effet remet aussi l'émission à zéro quand l'item redevient normal
  // (sortie de sélection, ou péremption redevenue lointaine).
  useEffect(() => {
    const emissive = active
      ? isSelected
        ? EMISSIVE_SELECTED
        : EMISSIVE_HOVER
      : EMISSIVE_OFF
    // Intensité volontairement basse : au zoom « objet » (0.4 m) une émission
    // forte aplatit le packaging en une plaque cyan et efface son étiquette ;
    // c'est le halo qui porte l'information « sélectionné ».
    const intensity = active ? (isSelected ? 0.14 : 0.1) : 0

    for (let i = 0; i < emissiveTargets.length; i += 1) {
      const material = emissiveTargets[i]
      material.emissive.copy(emissive)
      material.emissiveIntensity = intensity
      material.needsUpdate = true
    }
  }, [active, isSelected, isRecipeHighlighted, expiryStatus, emissiveTargets])

  // Le curseur est global : on le restaure même si le mesh est démonté survolé
  useEffect(() => () => {
    document.body.style.cursor = 'default'
  }, [])

  // Léger décalage vers l'avant pour l'item sélectionné (feedback discret)
  const lift = isSelected ? 0.02 : hovered ? 0.012 : 0

  // Chute du packaging pendant l'intro : tout est calculé dans la boucle de
  // rendu (aucun setState) pour rester à 60 fps sur WebKit iOS.
  useFrame((state) => {
    const group = introGroupRef.current
    if (!group) return

    const baseY = position[1] + lift

    if (!introActive) {
      if (introStartRef.current !== null) {
        introStartRef.current = null
        group.scale.setScalar(1)
        group.position.y = baseY
      }
      return
    }

    if (introStartRef.current === null) {
      introStartRef.current = state.clock.elapsedTime
    }

    const DURATION = 0.55
    const elapsed = state.clock.elapsedTime - introStartRef.current - introDelay

    if (elapsed <= 0) {
      group.scale.setScalar(0.001)
      group.position.y = baseY + 0.25
      return
    }

    const progress = Math.min(1, elapsed / DURATION)

    // easeOutBack : dépasse 1 puis se stabilise (rebond élastique)
    const c1 = 1.70158
    const c3 = c1 + 1
    const overshoot = 1 + c3 * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2)

    // easeOutCubic sur la hauteur : la chute ralentit en touchant la clayette
    const fall = 1 - Math.pow(1 - progress, 3)

    group.scale.setScalar(Math.max(0.001, overshoot))
    group.position.y = baseY + 0.25 * (1 - fall)
  })

  return (
    // `name` : le CameraController retrouve le packaging dans la scène pour
    // cadrer la caméra sur ses coordonnées monde (vrai zoom objet).
    <group
      ref={introGroupRef}
      name={`item:${item.id}`}
      position={[position[0], position[1] + lift, position[2]]}
    >
      {/* Ombre de contact : pose le packaging sur la clayette (texture radiale
          douce, rayon de picking neutralisé) */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, -ITEM_H / 2 + 0.0015, 0]}
        raycast={() => null}
      >
        <planeGeometry args={[ITEM_W * 2.1, ITEM_D * 2.1]} />
        <meshBasicMaterial
          map={getContactShadowTexture()}
          transparent
          opacity={0.75}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Liseré « fraîcheur » : coque inversée (BackSide) très discrète à la
          couleur du colocataire. Statique — aucun clignotement, aucun
          post-processing, une seule mesh supplémentaire par packaging. */}
      {expiryStatus === 'FRESH' && (
        <mesh raycast={() => null} scale={1.03}>
          <boxGeometry args={[ITEM_W, ITEM_H, ITEM_D]} />
          <meshBasicMaterial
            color={item.ownerColorHex ?? EXPIRY_COLORS.fresh}
            side={THREE.BackSide}
            transparent
            opacity={0.28}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Coque d'alerte de péremption : liseré rouge/ambre pulsant, rendu
          uniquement pour les items CRITIQUE/WARNING (aucun coût pour les
          autres). Le matériau est partagé avec `useFrame` (opacité animée). */}
      {isExpiryAlert && (
        <mesh raycast={() => null} scale={1.06} material={alertShellMaterial}>
          <boxGeometry args={[ITEM_W, ITEM_H, ITEM_D]} />
        </mesh>
      )}

      <mesh
        material={materials}
        castShadow
        scale={active ? 1.1 : 1}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHovered(false)
          // Reste « main » quand l'item est sélectionné (tooltip ouvert)
          document.body.style.cursor = isSelected ? 'pointer' : 'default'
        }}
        onClick={(e) => {
          // stopPropagation : ne déclenche PAS la sélection de la clayette
          // parente (ouverture du panneau latéral) ni le toggle de porte.
          e.stopPropagation()
          setSelectedItemId(item.id)
        }}
      >
        <boxGeometry args={[ITEM_W, ITEM_H, ITEM_D]} />
      </mesh>

      {/* Halo — survol, sélection, ou recette épinglée, non cliquable */}
      {(active || isRecipeHighlighted) && (
        <mesh raycast={() => null} scale={1.06}>
          <boxGeometry args={[ITEM_W + 0.012, ITEM_H + 0.012, ITEM_D + 0.012]} />
          <meshBasicMaterial
            color={
              isSelected
                ? '#22d3ee'
                : isRecipeHighlighted
                  ? '#00e676'
                  : item.ownerColorHex ?? '#38bdf8'
            }
            transparent
            opacity={isSelected ? 0.32 : isRecipeHighlighted ? 0.22 : 0.18}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Infobulle ancrée au sommet du packaging */}
      {isSelected && (
        <ProductTooltip item={item} position={[0, ITEM_H / 2 + 0.03, 0]} />
      )}
    </group>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ZoneProducts — placement en grille des items d'une zone
//
// Les bounds sont lues sur le mesh réel (FridgeCAD.getZoneBounds) :
//   • clayette fine (size.y < 0.05) → on pose sur la face supérieure (max.y)
//   • bac/tiroir volumique           → on pose sur le fond intérieur (min.y)
// `relativeToRef` permet d'exprimer les coordonnées dans le repère de la porte
// afin que les produits des balconnets pivotent avec elle.
// ─────────────────────────────────────────────────────────────────────────────

interface ZoneProductsProps {
  zoneId: string
  items: ZoneItemTwin[]
  relativeToRef?: React.RefObject<THREE.Object3D>
  /** Intro cinématique : les aliments tombent en cascade */
  introActive?: boolean
}

type Placed = { key: string; item: ZoneItemTwin; position: [number, number, number] }

function computeLayout(bounds: THREE.Box3, items: ZoneItemTwin[]): Placed[] {
  const size = bounds.getSize(new THREE.Vector3())

  const pitchX = ITEM_W + ITEM_GAP
  const pitchZ = ITEM_D + ITEM_GAP
  const cols = Math.max(1, Math.floor(Math.max(size.x, ITEM_W) / pitchX))
  const rows = Math.max(1, Math.floor(Math.max(size.z, ITEM_D) / pitchZ))

  // Grille centrée sur l'axe X
  const gridW = cols * pitchX - ITEM_GAP
  const startX = bounds.min.x + (size.x - gridW) / 2 + ITEM_W / 2

  // Grille centrée en Z, puis avancée vers la caméra (bord avant) et bornée
  // pour ne jamais sortir de la clayette.
  const gridD = rows * pitchZ - ITEM_GAP
  const startZ = bounds.min.z + (size.z - gridD) / 2 + ITEM_D / 2
  const maxZ = bounds.max.z - ITEM_D / 2 - Z_FRONT_MARGIN

  // Le packaging repose au contact de la face SUPÉRIEURE de la clayette.
  // La géométrie est centrée en local ([-H/2, +H/2]), donc le centre se place
  // à floorY + ITEM_H / 2 : la base touche exactement la surface.
  const floorY = bounds.max.y + ITEM_FLOOR_LIFT

  const perLayer = cols * rows
  const maxItems = Math.min(items.length, perLayer * 2)

  return items.slice(0, maxItems).map((item, index) => {
    const layer = Math.floor(index / perLayer)
    const slot = index % perLayer
    const col = slot % cols
    const row = Math.floor(slot / cols)

    return {
      key: item.id,
      item,
      position: [
        startX + col * pitchX,
        floorY + ITEM_H / 2 + layer * (ITEM_H + 0.01),
        Math.min(startZ + row * pitchZ + Z_FORWARD_BIAS, maxZ),
      ] as [number, number, number],
    }
  })
}

export function ZoneProducts({ zoneId, items, relativeToRef, introActive = false }: ZoneProductsProps) {
  const [placed, setPlaced] = useState<Placed[]>([])

  useEffect(() => {
    if (items.length === 0) {
      setPlaced([])
      return
    }

    let cancelled = false
    const startedAt = performance.now()

    // Les meshes de zone sont enregistrés au montage du GLB : on réessaie tant
    // que les bornes manquent. Aucun abandon définitif — sinon le placement
    // attendait le prochain poll `/fridge/state` (jusqu'à 30 s).
    const tryCompute = () => {
      if (cancelled) return

      const bounds = getZoneBounds(zoneId, relativeToRef?.current ?? null)
      if (!bounds || bounds.isEmpty()) {
        if (performance.now() - startedAt > PLACEMENT_TIMEOUT_MS) return
        window.setTimeout(tryCompute, 120)
        return
      }

      setPlaced(computeLayout(bounds, items))
    }

    tryCompute()

    return () => {
      cancelled = true
    }
  }, [zoneId, items, relativeToRef])

  return (
    <group name={`products:${zoneId}`}>
      {placed.map(({ key, item, position }, index) => (
        <ProductItem3D
          key={key}
          item={item}
          position={position}
          zoneId={zoneId}
          introActive={introActive}
          // Cascade : après l'ouverture des portes (2,35 s) + 70 ms par aliment
          introDelay={2.35 + index * 0.07}
        />
      ))}
    </group>
  )
}
