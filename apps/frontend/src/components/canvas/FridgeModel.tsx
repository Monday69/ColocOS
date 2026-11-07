import { useMemo } from 'react';
import * as THREE from 'three';
import { StorageBox } from './StorageBox';
import { InteractiveDoor } from './InteractiveDoor';
import { ZONE_LAYOUT } from '@/lib/zoneLayout';
import { useNavStore } from '@/store';
import type { FridgeStateTwin } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — FridgeModel v2 (Sprint 6 — Interactive Door)
//
// ARCHITECTURE :
//   FridgeModel
//     ├─ FridgeBody    (carcasse + congélateur, sans porte)
//     ├─ CabinetBody   ×2
//     ├─ PantryBody
//     ├─ InteractiveDoor  ← porte drag+spring + lumière intérieure + zones porte
//     └─ StorageBox ×N    ← zones intérieures + placards + garde-manger
//
// SÉCURITÉ RAYCASTING :
//   Zones group='fridge'|'freezer' → disabled si isDoorOpen = false
//   Empêche les clics "à travers" la porte fermée.
// ─────────────────────────────────────────────────────────────────────────────

const INTERIOR_GROUPS = new Set(['fridge', 'freezer']);
const DOOR_GROUPS = new Set(['door']);

interface FridgeModelProps {
  fridgeState: FridgeStateTwin | null;
  onZoneSelect: (meshId: string) => void;
}

function FridgeBody() {
  const bodyEdges    = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.85, 1.7, 0.65)), []);
  const freezerEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.85, 0.28, 0.65)), []);

  return (
    <group position={[0, 0.2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.85, 1.7, 0.65]} />
        <meshStandardMaterial color="#0d0f13" transparent opacity={0.35} roughness={0.8} metalness={0.4} side={THREE.BackSide} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.83, 1.68, 0.63]} />
        <meshStandardMaterial color="#12151c" transparent opacity={0.6} roughness={0.6} metalness={0.2} side={THREE.BackSide} />
      </mesh>
      <lineSegments geometry={bodyEdges}>
        <lineBasicMaterial color="#2a2d35" transparent opacity={0.5} />
      </lineSegments>
      <mesh position={[0, -0.7, 0]}>
        <boxGeometry args={[0.85, 0.28, 0.65]} />
        <meshStandardMaterial color="#060810" transparent opacity={0.5} roughness={0.7} metalness={0.5} />
      </mesh>
      <lineSegments geometry={freezerEdges} position={[0, -0.7, 0]}>
        <lineBasicMaterial color="#1e2128" transparent opacity={0.4} />
      </lineSegments>
      {/* LED strips intérieures */}
      {[-0.3, 0.3, 0.9].map((yOffset, i) => (
        <mesh key={i} position={[0, yOffset, 0.31]}>
          <boxGeometry args={[0.8, 0.006, 0.003]} />
          <meshStandardMaterial color="#4fc3f7" emissive="#4fc3f7" emissiveIntensity={0.25} transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function CabinetBody({ position }: { position: [number, number, number] }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.75, 0.55)), []);
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.9, 0.75, 0.55]} />
        <meshStandardMaterial color="#08090c" transparent opacity={0.3} roughness={0.9} metalness={0.2} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#2a2d35" transparent opacity={0.4} />
      </lineSegments>
    </group>
  );
}

function PantryBody() {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.0, 0.85, 0.6)), []);
  return (
    <group position={[2.8, 0.38, 0]}>
      <mesh>
        <boxGeometry args={[1.0, 0.85, 0.6]} />
        <meshStandardMaterial color="#08090c" transparent opacity={0.3} roughness={0.9} metalness={0.2} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#2a2d35" transparent opacity={0.4} />
      </lineSegments>
    </group>
  );
}

export function FridgeModel({ fridgeState, onZoneSelect }: FridgeModelProps) {
  const zones          = fridgeState?.zones ?? {};
  const { isDoorOpen } = useNavStore();
  const nonDoorLayouts = ZONE_LAYOUT.filter(z => !DOOR_GROUPS.has(z.group));

  return (
    <group>
      <FridgeBody />
      <CabinetBody position={[-1.6, 0.5, 0]} />
      <CabinetBody position={[1.6, 0.5, 0]} />
      <PantryBody />

      {/* Porte interactive — décalage Y=0.2 pour aligner avec FridgeBody */}
      <group position={[0, 0.2, 0]}>
        <InteractiveDoor zones={zones} onZoneSelect={onZoneSelect} />
      </group>

      {/* Zones hors-porte */}
      {nonDoorLayouts.map((layout) => {
        const isInterior = INTERIOR_GROUPS.has(layout.group);
        const canInteract = !isInterior || isDoorOpen;
        return (
          <StorageBox
            key={layout.meshId}
            layout={layout}
            zoneTwin={zones[layout.meshId] ?? null}
            onSelect={canInteract ? onZoneSelect : () => {}}
            disabled={!canInteract}
          />
        );
      })}
    </group>
  );
}