import { Suspense, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  OrbitControls,
  Grid,
  Environment,
  BakeShadows,
  PerformanceMonitor,
  Stats,
} from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { FridgeCAD } from '@/components/3d/FridgeCAD';
import { ProductQuickAction } from '@/components/3d/ProductTooltip';
import { CameraController } from './CameraController';
import { useFridgeState } from '@/hooks/useFridgeState';
import { useZoneDetail } from '@/hooks/useZoneDetail';
import { useUIStore } from '@/store';

export function FridgeScene() {
  const { fridgeState } = useFridgeState();
  const { zoneDetail, openZone, closePanel } = useZoneDetail();
  // Source de vérité synchrone du clic 3D : le meshId est dispo avant la réponse API
  const selectedItemId = useUIStore((s) => s.selectedItemId);
  const setSelectedItemId = useUIStore((s) => s.setSelectedItemId);
  // Zone à cadrer quand aucun produit n'est sélectionné : la clayette ouverte
  // (panneau latéral), sinon la vue d'ensemble.
  const focusedZoneId = useUIStore(
    (s) => s.selectedMeshId ?? s.zoneDetail?.meshId ?? null,
  );
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // Raccourci clavier Échap : ferme le tooltip produit, sinon quitte le focus de zone
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedItemId) {
        setSelectedItemId(null);
        return;
      }
      if (zoneDetail) {
        closePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemId, setSelectedItemId, zoneDetail, closePanel]);

  return (
    <div className="fixed inset-0 w-full h-dvh">
      {/* ── Bouton de retour en vue globale si une clayette est ouverte ── */}
      {zoneDetail && (
        <button
          onClick={() => closePanel()}
          className="absolute top-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-wider text-white uppercase bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 rounded-full backdrop-blur-md transition-all shadow-lg shadow-black/40 hover:scale-105 active:scale-95"
        >
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          Vue d'ensemble <span className="text-slate-400 font-sans text-[10px]">(Échap)</span>
        </button>
      )}

      <Canvas
        shadows
        camera={{
          position: [-0.84, 1.75, 3.15],
          // FOV conservé à 42 ; le recul (3.15) laisse respirer le frigo en portrait.
          fov: 42,
          near: 0.1,
          far: 100,
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: 2,
          toneMappingExposure: 1.1,
        }}
        style={{ background: '#0a0b0d' }}
        onClick={() => (document.body.style.cursor = 'default')}
        // Clic dans le vide (sol, grille, fond) → referme le tooltip produit.
        // Les meshes de zone, eux, stoppent la propagation et ouvrent le panneau.
        onPointerMissed={() => setSelectedItemId(null)}
      >
        {import.meta.env.DEV && <Stats className="!left-auto !right-2 !top-2" />}

        <PerformanceMonitor
          onDecline={() => console.warn('[R3F] Performance dégradée — qualité réduite')}
        />

        {/* ── Éclairage — doux, avec rim light chaude pour détacher les
               silhouettes des packagings sur les clayettes en verre ──────── */}
        <ambientLight intensity={0.28} color="#9aa7c0" />
        <hemisphereLight args={['#c4d4ea', '#1a1410', 0.34]} />

        <directionalLight
          position={[3, 6, 4]}
          intensity={1.05}
          color="#d8e6ff"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={0.1}
          shadow-camera-far={20}
          shadow-camera-left={-5}
          shadow-camera-right={5}
          shadow-camera-top={5}
          shadow-camera-bottom={-5}
          shadow-bias={-0.0012}
          shadow-normalBias={0.02}
        />

        <directionalLight position={[-2, 3, -3]} intensity={0.28} color="#4466aa" />
        <pointLight position={[0, -1.2, 1.2]} intensity={0.7} color="#4fc3f7" distance={3} decay={2} />

        {/* Rim light chaude : contre-jour doux qui cisèle les bords des produits */}
        <pointLight position={[-1.75, 1.95, 0.05]} intensity={0.55} color="#ffb37a" distance={3.4} decay={2} />
        <directionalLight position={[0.8, 2.4, -1.8]} intensity={0.3} color="#ffd9b0" />

        {/* ── Sol et grille ───────────────────────────────────────────────── */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.05, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#080a0d" roughness={0.95} metalness={0.05} />
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

        {/* ── Modèle Digital Twin ─────────────────────────────────────────── */}
        <Suspense fallback={null}>
          <FridgeCAD fridgeState={fridgeState} onZoneSelect={openZone} />
        </Suspense>

        <BakeShadows />

        {/* ── Contrôles orbitaux & autofocus dynamique ────────────────────── */}
        <OrbitControls
          ref={controlsRef}
          target={[-0.84, 1.35, -0.44]}
          minDistance={0.2}
          maxDistance={9}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2.1}
          enablePan={true}
          panSpeed={0.5}
          rotateSpeed={0.6}
          zoomSpeed={0.8}
          dampingFactor={0.05}
          enableDamping
        />

        <CameraController
          selectedZoneId={focusedZoneId}
          selectedItemId={selectedItemId}
          controlsRef={controlsRef}
        />

        <Environment preset="warehouse" environmentIntensity={0.22} />
      </Canvas>

      {/* Carte d'action rapide mobile (hors canvas : ni distorsion, ni conflit
          avec OrbitControls). Masquée en desktop où le tooltip 3D est utilisé. */}
      <ProductQuickAction />
    </div>
  );
}