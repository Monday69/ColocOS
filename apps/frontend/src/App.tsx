import { FridgeScene } from '@/components/canvas/FridgeScene';
import { HudOverlay } from '@/components/ui/HudOverlay';
import { ZoneDetailPanel } from '@/components/ui/ZoneDetailPanel';
import { HealthLegend } from '@/components/ui/HealthLegend';
import { NavDock } from '@/components/ui/NavDock';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { useConnectivity } from '@/hooks/useConnectivity';
import { AuthModal } from '@/components/auth/AuthModal';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — App Layout v4 (Sprint 8 — Offline + Audio)
//
// Nouveautés :
//   • useConnectivity() monté ici — écoute online/offline en global,
//     déclenche syncOfflineQueue() automatiquement au retour du réseau
//   • HudOverlay reçoit onAudioStart — déclenché au premier clic sur Mute,
//     ce qui déverrouille l'AudioContext (autoplay browser policy)
//   • L'audio démarre aussi via le premier clic sur la porte du frigo
//     (wired dans InteractiveDoor.tsx → audio.start())
// ─────────────────────────────────────────────────────────────────────────────

function AppContent() {
  useConnectivity();

  return (
    <div className="fixed inset-0 h-dvh w-screen overflow-hidden scanlines grain">
      {/* 🟢 AJOUTE LA MODAL ICI */}
      <AuthModal /> 

      <ToastProvider />

      {/* Le canvas remplit l'écran jusqu'au bord physique (safe-areas gérées
          par le HUD, le dock et la légende) */}
      <div className="absolute inset-0 h-dvh w-full">
        <FridgeScene />
      </div>

      <HudOverlay />
      <HealthLegend />
      <NavDock />
      <ZoneDetailPanel />
    </div>
  );
}

export default function App() {
  return <AppContent />;
}