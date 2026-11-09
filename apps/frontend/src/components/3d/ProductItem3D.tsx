import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { getZoneBounds } from '@/lib/zoneRegistry'
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

    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose()
          return
        }
        tex.colorSpace = THREE.SRGBColorSpace
        disposePrevious()
        textureRef.current = tex
        setTexture(tex)
      },
      undefined,
      () => {
        // CORS / 404 / réseau : fallback silencieux sur le carton
        if (!cancelled) setTexture(null)
      },
    )

    return () => {
      cancelled = true
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
}

export function ProductItem3D({ item, position, zoneId }: ProductItem3DProps) {
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

  // Pont « recette → frigo » : les packagings des zones qui contiennent les
  // ingrédients d'une recette survolée/épinglée pulsent en vert, sans écraser
  // la sélection (priorité visuelle à la sélection cyan).
  useFrame((state) => {
    if (!isRecipeHighlighted || isSelected) return
    const targets = [cartonMaterial, frontMaterial].filter(
      (material): material is THREE.MeshStandardMaterial => material !== null,
    )
    // Pulsation sinusoïdale 0.06 → 0.30, période ~2 s
    const intensity = 0.18 + 0.12 * Math.sin(state.clock.elapsedTime * 3)
    for (const material of targets) {
      material.emissive.set('#00e676')
      material.emissiveIntensity = Math.max(0.05, intensity)
    }
  })

  // Surbrillance : émissive cyan, plus marquée quand l'item est sélectionné.
  // Les matériaux sont propres à l'instance → mutation sans effet de bord.
  useEffect(() => {
    const targets = [cartonMaterial, frontMaterial].filter(
      (material): material is THREE.MeshStandardMaterial => material !== null,
    )
    const emissive = new THREE.Color(active ? (isSelected ? '#22d3ee' : '#4fc3f7') : '#000000')
    // Intensité volontairement basse : au zoom « objet » (0.4 m) une émission
    // forte aplatit le packaging en une plaque cyan et efface son étiquette ;
    // c'est le halo qui porte l'information « sélectionné ».
    const intensity = active ? (isSelected ? 0.14 : 0.1) : 0

    for (const material of targets) {
      material.emissive.copy(emissive)
      material.emissiveIntensity = intensity
      material.needsUpdate = true
    }
  }, [active, isSelected, isRecipeHighlighted, cartonMaterial, frontMaterial])

  // Le curseur est global : on le restaure même si le mesh est démonté survolé
  useEffect(() => () => {
    document.body.style.cursor = 'default'
  }, [])

  // Léger décalage vers l'avant pour l'item sélectionné (feedback discret)
  const lift = isSelected ? 0.02 : hovered ? 0.012 : 0

  return (
    // `name` : le CameraController retrouve le packaging dans la scène pour
    // cadrer la caméra sur ses coordonnées monde (vrai zoom objet).
    <group name={`item:${item.id}`} position={[position[0], position[1] + lift, position[2]]}>
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
}

type Placed = { key: string; item: ZoneItemTwin; position: [number, number, number] }

function computeLayout(bounds: THREE.Box3, items: ZoneItemTwin[]): Placed[] {
  const size = bounds.getSize(new THREE.Vector3())

  const pitchX = ITEM_W + ITEM_GAP
  const pitchZ = ITEM_D + ITEM_GAP
  const cols = Math.max(1, Math.floor(Math.max(size.x, ITEM_W) / pitchX))
  const rows = Math.max(1, Math.floor(Math.max(size.z, ITEM_D) / pitchZ))

  // Grille centrée dans la zone
  const gridW = cols * pitchX - ITEM_GAP
  const gridD = rows * pitchZ - ITEM_GAP
  const startX = bounds.min.x + (size.x - gridW) / 2 + ITEM_W / 2
  const startZ = bounds.min.z + (size.z - gridD) / 2 + ITEM_D / 2

  const floorY =
    size.y < 0.05 ? bounds.max.y : bounds.min.y

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
        startZ + row * pitchZ,
      ] as [number, number, number],
    }
  })
}

export function ZoneProducts({ zoneId, items, relativeToRef }: ZoneProductsProps) {
  const [placed, setPlaced] = useState<Placed[]>([])

  useEffect(() => {
    if (items.length === 0) {
      setPlaced([])
      return
    }

    let frame = 0
    let cancelled = false

    // Les meshes de zone sont enregistrés au montage : on attend qu'ils le soient
    const tryCompute = () => {
      if (cancelled) return

      const bounds = getZoneBounds(zoneId, relativeToRef?.current ?? null)
      if (!bounds) {
        if (frame++ < 180) requestAnimationFrame(tryCompute)
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
      {placed.map(({ key, item, position }) => (
        <ProductItem3D key={key} item={item} position={position} zoneId={zoneId} />
      ))}
    </group>
  )
}
