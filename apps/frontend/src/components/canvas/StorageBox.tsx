import { useRef, useState, useCallback } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { ZoneLayout } from '@/types';
import type { ZoneTwin } from '@/types';
import {
  HEALTH_COLORS,
  HEALTH_EMISSIVE,
  HEALTH_EMISSIVE_INTENSITY,
  HEALTH_HOVER_EMISSIVE_INTENSITY,
  HEALTH_OPACITY,
} from '@/lib/healthColors';
import { useUIStore, useBridge } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — StorageBox Component (Sprint 5 — 3D Bridge)
//
// Nouveauté Sprint 5 :
//   isFinanceHighlighted — quand l'utilisateur survole une dette dans le
//   module Finance, highlightedOwnerColor est renseigné dans le store.
//   Si zoneTwin.ownerColors contient cette couleur, le mesh pulse en blanc
//   avec une intensité emissive accrue pour créer un lien visuel Finance ↔ 3D.
// ─────────────────────────────────────────────────────────────────────────────

interface StorageBoxProps {
  layout: ZoneLayout;
  zoneTwin: ZoneTwin | null;
  onSelect: (meshId: string) => void;
  /** Désactive hover/click — utilisé quand la porte du frigo est fermée */
  disabled?: boolean;
}

export function StorageBox({ layout, zoneTwin, onSelect, disabled = false }: StorageBoxProps) {
  const meshRef   = useRef<THREE.Mesh>(null!);
  const timeRef   = useRef(0);
  const [hovered, setHovered] = useState(false);
  const { hoveredMeshId, selectedMeshId, setHoveredMesh } = useUIStore();
  const { highlightedOwnerColor, highlightedMeshIds } = useBridge();

  const isSelected = selectedMeshId === layout.meshId;
  const healthStatus = zoneTwin?.healthStatus ?? 'empty';

  // 3D Bridge: is this zone owned by the creditor currently hovered in Finance?
  const isFinanceHighlighted =
    highlightedOwnerColor !== null &&
    (zoneTwin?.ownerColors.includes(highlightedOwnerColor) ?? false);

  // 3D Bridge: does this zone contain available ingredients for a hovered recipe?
  const isRecipeHighlighted =
    highlightedMeshIds.length > 0 &&
    highlightedMeshIds.includes(layout.meshId);

  const targetColor    = new THREE.Color(HEALTH_COLORS[healthStatus]);
  const targetEmissive = new THREE.Color(HEALTH_EMISSIVE[healthStatus]);
  const baseIntensity  = HEALTH_EMISSIVE_INTENSITY[healthStatus];
  const hoverIntensity = HEALTH_HOVER_EMISSIVE_INTENSITY[healthStatus];
  const targetOpacity  = HEALTH_OPACITY[healthStatus];

  useFrame((_state, delta) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    timeRef.current += delta;

    // Recipe highlight — ingredient zone glows jade green
    if (isRecipeHighlighted) {
      const pulseT = (Math.sin(timeRef.current * 3.5) + 1) / 2;
      const jadePulse = new THREE.Color('#00e676');
      mat.color.lerp(jadePulse, Math.min(delta * 6, 1));
      mat.emissive.lerp(jadePulse, Math.min(delta * 6, 1));
      mat.emissiveIntensity = 0.35 + pulseT * 0.55;
    } else if (isFinanceHighlighted && highlightedOwnerColor) {
      const pulseT = (Math.sin(timeRef.current * 4) + 1) / 2; // 0..1 oscillate
      const highlightColor = new THREE.Color(highlightedOwnerColor);
      mat.color.lerp(highlightColor, Math.min(delta * 8, 1));
      mat.emissive.lerp(highlightColor, Math.min(delta * 8, 1));
      mat.emissiveIntensity = 0.5 + pulseT * 0.8; // pulse 0.5..1.3
    } else {
      // Normal state
      mat.color.lerp(targetColor, Math.min(delta * 4, 1));
      mat.emissive.lerp(targetEmissive, Math.min(delta * 4, 1));

      const targetIntensity = isSelected
        ? hoverIntensity * 1.5
        : hovered
        ? hoverIntensity
        : baseIntensity;

      mat.emissiveIntensity += (targetIntensity - mat.emissiveIntensity) * Math.min(delta * 6, 1);
    }

    // Disabled zones fade to near-invisible
    const disabledOpacity = disabled ? 0.08 : targetOpacity;
    if (mat.opacity !== disabledOpacity) {
      mat.opacity += (disabledOpacity - mat.opacity) * Math.min(delta * 4, 1);
    }
    const targetScale = !disabled && (hovered || isSelected || isFinanceHighlighted || isRecipeHighlighted) ? 1.025 : 1.0;
    meshRef.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, targetScale),
      Math.min(delta * 8, 1),
    );
  });

  const handlePointerEnter = useCallback(() => {
    if (disabled) return;
    setHovered(true);
    setHoveredMesh(layout.meshId);
    document.body.style.cursor = 'pointer';
  }, [disabled, layout.meshId, setHoveredMesh]);

  const handlePointerLeave = useCallback(() => {
    setHovered(false);
    setHoveredMesh(null);
    document.body.style.cursor = 'default';
  }, [setHoveredMesh]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (disabled) return;
      e.stopPropagation();
      console.log(`[Digital Twin] Zone cliquée : ${layout.meshId}`, zoneTwin);
      onSelect(layout.meshId);
    },
    [disabled, layout.meshId, zoneTwin, onSelect],
  );

  // font={undefined} → évite le crash Suspense si .woff absent. Three.js utilise sa font canvas par défaut.
  return (
    <group position={layout.position}>
      <mesh
        ref={meshRef}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        castShadow
        receiveShadow
      >
        <boxGeometry args={layout.size} />
        <meshStandardMaterial
          color={HEALTH_COLORS[healthStatus]}
          emissive={HEALTH_EMISSIVE[healthStatus]}
          emissiveIntensity={baseIntensity}
          transparent
          opacity={targetOpacity}
          roughness={0.6}
          metalness={0.1}
        />
      </mesh>

      {/* Wireframe edges */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(...layout.size)]} />
        <lineBasicMaterial
          color={
            isFinanceHighlighted && highlightedOwnerColor
              ? highlightedOwnerColor
              : hovered || isSelected
              ? HEALTH_COLORS[healthStatus]
              : '#2a2d35'
          }
          transparent
          opacity={isFinanceHighlighted ? 0.9 : hovered || isSelected ? 0.8 : 0.3}
        />
      </lineSegments>

      {/* Finance highlight: extra glow ring */}
      {isFinanceHighlighted && highlightedOwnerColor && (
        <pointLight
          position={[0, layout.size[1] * 0.5, layout.size[2] * 0.6]}
          color={highlightedOwnerColor}
          intensity={1.2}
          distance={0.9}
          decay={2}
        />
      )}
      {isRecipeHighlighted && (
        <pointLight
          position={[0, layout.size[1] * 0.5, layout.size[2] * 0.6]}
          color="#00e676"
          intensity={1.0}
          distance={0.85}
          decay={2}
        />
      )}

      {/* Label on hover/select */}
      {(hovered || isSelected) && (
        <Text
          position={[0, layout.size[1] / 2 + 0.08, 0]}
          fontSize={0.06}
          color="#e8eaf0"
          anchorX="center"
          anchorY="bottom"
          font={undefined}
          outlineWidth={0.004}
          outlineColor="#0a0b0d"
        >
          {layout.label}
          {zoneTwin ? `  [${zoneTwin.itemCount}]` : '  [--]'}
        </Text>
      )}

      {/* Item count badge */}
      {zoneTwin && zoneTwin.itemCount > 0 && !hovered && !isSelected && (
        <Text
          position={[layout.size[0] / 2 + 0.04, layout.size[1] / 2, 0]}
          fontSize={0.05}
          color={HEALTH_COLORS[healthStatus]}
          anchorX="left"
          anchorY="middle"
          font={undefined}
        >
          {zoneTwin.itemCount}
        </Text>
      )}

      {/* Dynamic owner point lights */}
      {zoneTwin?.ownerColors.slice(0, 2).map((color, i) => (
        <pointLight
          key={`${layout.meshId}-light-${i}`}
          position={[(i === 0 ? -1 : 1) * layout.size[0] * 0.3, layout.size[1] * 0.8, 0]}
          color={color}
          intensity={hovered ? 0.4 : 0.15}
          distance={0.6}
          decay={2}
        />
      ))}
    </group>
  );
}