import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  OrbitControls,
  Grid,
  Environment,
  BakeShadows,
  PerformanceMonitor,
  Stats,
} from '@react-three/drei';
import { FridgeModel } from './FridgeModel';
import { useFridgeState } from '@/hooks/useFridgeState';
import { useZoneDetail } from '@/hooks/useZoneDetail';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — FridgeScene Component
//
// Configuration Three.js / R3F :
//   - Camera perspective avec position et target optimisés pour voir le frigo
//     + les placards latéraux dans un seul champ de vision
//   - OrbitControls avec limites de rotation (évite de passer sous le sol)
//   - Éclairage 3 points : ambient (base) + directional (ombres) + hemisphere
//   - Grid helper au sol pour ancrer la scène dans l'espace
//   - Suspense pour le chargement des assets (futur GLTF)
//   - PerformanceMonitor pour adapter la qualité automatiquement
// ─────────────────────────────────────────────────────────────────────────────

export function FridgeScene() {
  const { fridgeState } = useFridgeState();
  const { openZone } = useZoneDetail();

  return (
    <Canvas
      shadows
      camera={{
        position: [3.5, 1.8, 4.5],
        fov: 42,
        near: 0.1,
        far: 100,
      }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        toneMapping: 2, // THREE.ReinhardToneMapping — préserve les néons
        toneMappingExposure: 1.1,
      }}
      style={{ background: '#0a0b0d' }}
      // Réinitialise le curseur si on clique dans le vide
      onClick={() => document.body.style.cursor = 'default'}
    >
      {/* ── Monitoring perf (dev only) ──────────────────────────────────── */}
      {import.meta.env.DEV && <Stats className="!left-auto !right-2 !top-2" />}

      {/* ── Adaptive quality ─────────────────────────────────────────────── */}
      <PerformanceMonitor
        onDecline={() => console.warn('[R3F] Performance dégradée — qualité réduite')}
      />

      {/* ── Éclairage ────────────────────────────────────────────────────── */}

      {/* Ambient — lumière de base froide, reproduit une cuisine industrielle */}
      <ambientLight intensity={0.15} color="#8899bb" />

      {/* Hemisphere — ciel froid + sol chaud, donne de la profondeur */}
      <hemisphereLight
        args={['#b0c4de', '#1a1410', 0.3]}
      />

      {/* Key light — lumière principale (LED plafond) */}
      <directionalLight
        position={[3, 6, 4]}
        intensity={1.2}
        color="#d0e8ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.1}
        shadow-camera-far={20}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-bias={-0.001}
      />

      {/* Fill light — contre-jour doux depuis derrière */}
      <directionalLight
        position={[-2, 3, -3]}
        intensity={0.3}
        color="#4466aa"
      />

      {/* Accent néon bleu froid depuis le bas — rappelle un éclairage frigo */}
      <pointLight
        position={[0, -1.2, 1.2]}
        intensity={0.8}
        color="#4fc3f7"
        distance={3}
        decay={2}
      />

      {/* ── Sol et grille ─────────────────────────────────────────────────── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -1.05, 0]}
        receiveShadow
      >
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial
          color="#080a0d"
          roughness={0.95}
          metalness={0.05}
        />
      </mesh>

      <Grid
        position={[0, -1.04, 0]}
        args={[16, 16]}
        cellSize={0.5}
        cellThickness={0.4}
        cellColor="#1a1d24"
        sectionSize={2}
        sectionThickness={0.8}
        sectionColor="#252830"
        fadeDistance={12}
        fadeStrength={1.5}
        infiniteGrid
      />

      {/* ── Modèle Digital Twin ───────────────────────────────────────────── */}
      <Suspense fallback={null}>
        <FridgeModel fridgeState={fridgeState} onZoneSelect={openZone} />
      </Suspense>

      {/* ── Ombre baked après chargement ─────────────────────────────────── */}
      <BakeShadows />

      {/* ── Contrôles orbitaux ─────────────────────────────────────────────
           Cible le centre du frigo, pas le sol.
           Limites verticales : empêche de passer sous le sol ou au-dessus.
           autoRotate initial pour l'effet "démo".
      ───────────────────────────────────────────────────────────────────── */}
      <OrbitControls
        target={[0.8, 0.4, 0]}
        minDistance={2.5}
        maxDistance={9}
        minPolarAngle={0.3}           // ~17° — pas trop haut
        maxPolarAngle={Math.PI / 2.1} // ~85° — pas sous le sol
        enablePan={true}
        panSpeed={0.5}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        dampingFactor={0.05}
        enableDamping
      />

      {/* ── Environnement HDRI léger pour les reflets métalliques ────────── */}
      <Environment preset="warehouse" environmentIntensity={0.15} />
    </Canvas>
  );
}