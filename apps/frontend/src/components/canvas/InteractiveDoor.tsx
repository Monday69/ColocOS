import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { animated } from '@react-spring/three';
import * as THREE from 'three';
import { useInteractiveDoor } from '@/hooks/useInteractiveDoor';
import { useFridgeAudio } from '@/hooks/useFridgeAudio';
import { useNavStore } from '@/store';
import { ZONE_LAYOUT } from '@/lib/zoneLayout';
import { StorageBox } from './StorageBox';
import type { ZoneTwin } from '@/types';
import { toasts } from '@/components/ui/ToastProvider';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — InteractiveDoor Component
//
// ARCHITECTURE DU PIVOT :
//
//   Les réfrigérateurs s'ouvrent du côté DROIT de la porte (vu de face).
//   La charnière est sur le bord gauche de la porte (x = -0.425).
//
//   Structure Three.js :
//     pivotGroup (position = charnière = [-0.425, 0.15, -0.325])
//       └─ doorMesh (position = [+0.425, 0, 0])   ← centre du mesh = +0.425 du pivot
//       └─ doorShelves group (zones porte)
//
//   Quand pivotGroup.rotation.y = θ :
//     - θ = 0       → porte fermée (face au spectateur)
//     - θ = π×105/180 → porte ouverte à 105° (dépasse la surface latérale)
//
//   La conversion Δx_souris → Δθ est documentée dans useInteractiveDoor.ts.
//
// LUMIÈRE INTÉRIEURE :
//   Un pointLight est positionné à l'intérieur du frigo (z légèrement positif).
//   Son intensity est animée par le spring lightIntensity (0 → 0.8).
//   Cet effet simule la "lampe du frigo" qui s'allume à l'ouverture.
// ─────────────────────────────────────────────────────────────────────────────

const DOOR_ZONES = ['fridge_door_shelf_1', 'fridge_door_shelf_2', 'fridge_door_shelf_3'];

interface InteractiveDoorProps {
  /** Map des zones twin pour hydrater les StorageBox de la porte */
  zones: Record<string, ZoneTwin>;
  onZoneSelect: (meshId: string) => void;
}

export function InteractiveDoor({ zones, onZoneSelect }: InteractiveDoorProps) {
  const { bind, rotY, lightIntensity, toggleDoor, angleRef } = useInteractiveDoor();
  const { isDoorOpen } = useNavStore();

  // ── Audio — reçoit angleRef pour la synchronisation frame-par-frame ──────
  // useFridgeAudio lit angleRef.current dans useFrame (thread RAF)
  // sans passer par React state → zéro re-render, zéro zipper noise
  const audio = useFridgeAudio(angleRef);
  const lightRef = useRef<THREE.PointLight>(null!);

  // Synchronise la light intensity dans useFrame pour un fade ultra-fluide.
  // @react-spring/three SpringValue expose .get() — le cast est nécessaire car
  // les typings TS de SpringValue<number> n'expriment pas get() directement.
  useFrame(() => {
    if (!lightRef.current) return;
    const springVal = lightIntensity as { get?: () => number; _value?: number };
    const val = springVal.get?.() ?? springVal._value ?? 0;
    lightRef.current.intensity = val * 1.4;
  });

  // Zones de la porte à rendre
  const doorLayouts = ZONE_LAYOUT.filter(z => DOOR_ZONES.includes(z.meshId));

  const handleDoorClick = () => {
    // Premier clic = déverrouillement AudioContext (autoplay policy)
    audio.start();
    toggleDoor();
    setTimeout(() => {
      toasts.doorState(!isDoorOpen);
    }, 150);
  };

  return (
    <>
      {/* ── Lumière intérieure du frigo ─────────────────────────────────── */}
      {/* Positionnée à l'intérieur du corps, indépendante de la porte */}
      <pointLight
        ref={lightRef}
        position={[0, 0.5, 0.1]}
        color="#c8e8ff"    // Blanc légèrement bleuté — LED frigo
        intensity={0}     // Sera animée par useFrame
        distance={1.2}
        decay={2}
        castShadow={false}
      />

      {/* ── Groupe pivot : position = charnière gauche ─────────────────── */}
      {/* 
          Charnière : x = -0.425 (bord gauche porte, 0.85/2)
                      y =  0.15  (centre vertical de la porte)
                      z = -0.325 (avant du corps frigo, 0.65/2)
      */}
      <animated.group
        position={[-0.425, 0.15, -0.325]}
        rotation-y={rotY}
      >
        {/* ── Mesh de la porte ──────────────────────────────────────────── */}
        {/* Décalé de +0.425 sur X pour que le pivot soit sur le bord gauche */}
        <mesh
          position={[0.425, 0, 0]}
          castShadow
          receiveShadow
          onClick={handleDoorClick}
          {...(bind() as Record<string, unknown>)}
          onPointerEnter={() => { document.body.style.cursor = 'grab'; }}
          onPointerLeave={() => { document.body.style.cursor = 'default'; }}
          onPointerDown={() => { document.body.style.cursor = 'grabbing'; }}
          onPointerUp={() => { document.body.style.cursor = 'grab'; }}
        >
          <boxGeometry args={[0.85, 1.55, 0.1]} />
          <animated.meshStandardMaterial
            color="#0c0e14"
            roughness={0.2}
            metalness={0.75}
            // Légère emissive sur la tranche quand ouverte
            emissive={new THREE.Color('#1a2030')}
            emissiveIntensity={0.3}
            transparent
            opacity={0.92}
          />
        </mesh>

        {/* Arêtes de la porte — liseret lumineux */}
        <lineSegments position={[0.425, 0, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(0.85, 1.55, 0.1)]} />
          <lineBasicMaterial color="#3a3d50" transparent opacity={0.6} />
        </lineSegments>

        {/* ── Handle visuel ────────────────────────────────────────────── */}
        {/* Barre chromée verticale, côté droit de la porte */}
        <mesh position={[0.8, 0, 0.06]}>
          <boxGeometry args={[0.02, 0.35, 0.025]} />
          <meshStandardMaterial
            color="#c0c8d8"
            roughness={0.05}
            metalness={0.95}
          />
        </mesh>

        {/* ── Zones de la porte (StorageBox sur l'intérieur de la porte) ─ */}
        {/* Décalage Z positif pour être "à l'intérieur" de la porte */}
        <group position={[0.425, 0, 0.07]}>
          {doorLayouts.map(layout => (
            <StorageBox
              key={layout.meshId}
              layout={{
                ...layout,
                // Les zones porte sont dans le repère local du pivot
                position: [
                  layout.position[0],        // X relatif au pivot
                  layout.position[1] - 0.15, // Y relatif au centre porte
                  0,
                ],
              }}
              zoneTwin={zones[layout.meshId] ?? null}
              onSelect={isDoorOpen ? onZoneSelect : () => {}}
            />
          ))}
        </group>
      </animated.group>
    </>
  );
}