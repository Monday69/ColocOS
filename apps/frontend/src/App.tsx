import { FridgeScene } from '@/components/canvas/FridgeScene';
import { HudOverlay } from '@/components/ui/HudOverlay';
import { ZoneDetailPanel } from '@/components/ui/ZoneDetailPanel';
import { NavDock } from '@/components/ui/NavDock';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { useConnectivity } from '@/hooks/useConnectivity';
import { AuthModal } from '@/components/auth/AuthModal';
import { ModuleScreen } from '@/components/ui/ModuleScreen';
import { FinanceModule } from '@/components/ui/FinanceModule';
import { ShoppingModule } from '@/components/ui/ShoppingModule';
import { ScannerModule } from '@/components/ui/ScannerModule';
import { RecipeModule } from '@/components/ui/RecipeModule';
import { useEffect } from 'react';
import { useNavStore, useAuth } from '@/store';
import { api } from '@/api/client';
import { toasts } from '@/components/ui/ToastProvider';

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

  /**
   * Lien magique NFC : l'API redirige vers `/#nfc=<accessToken>`. Le jeton
   * voyage dans le fragment (jamais envoyé au serveur), on l'échange contre
   * la session complète puis on nettoie l'URL.
   */
  useEffect(() => {
    const match = window.location.hash.match(/^#nfc=(.+)$/);
    if (!match) return;

    const accessToken = decodeURIComponent(match[1]);
    window.history.replaceState(null, '', window.location.pathname);

    useAuth.setState({ token: accessToken });

    void api
      .me()
      .then((user) => {
        useAuth.getState().setAuth(accessToken, useAuth.getState().refreshToken ?? '', user);
        toasts.info('Badge NFC reconnu', `Bonjour ${user.name} !`);
      })
      .catch(() => {
        useAuth.getState().logout();
        toasts.error('Badge NFC invalide', 'Régénère-le depuis Profil → Sécurité & NFC.');
      });
  }, []);
  const activeModule = useNavStore((s) => s.activeModule);
  const isFridgeTab = activeModule === 'fridge';

  return (
    <div className="fixed inset-0 h-dvh w-screen overflow-hidden scanlines grain">
      {/* 🟢 AJOUTE LA MODAL ICI */}
      <AuthModal /> 

      <ToastProvider />

      {/* ── Vue FRIGO : scène 3D + HUD ─────────────────────────────────────── */}
      <div
        className="absolute inset-0 h-dvh w-full"
        // La 3D reste montée (état caméra/sélection conservé) mais sa boucle de
        // rendu est coupée hors onglet frigo → zéro consommation GPU en fond.
        style={isFridgeTab ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
        aria-hidden={!isFridgeTab}
      >
        <FridgeScene active={isFridgeTab} />
      </div>

      {isFridgeTab && (
        <>
          <HudOverlay />
          <ZoneDetailPanel />
        </>
      )}

      {/* ── Modules : écrans plein format, mutuellement exclusifs ──────────── */}
      {activeModule === 'finance' && (
        <ModuleScreen module="finance">
          <FinanceModule />
        </ModuleScreen>
      )}
      {activeModule === 'shopping' && (
        <ModuleScreen module="shopping">
          <ShoppingModule />
        </ModuleScreen>
      )}
      {activeModule === 'scanner' && (
        <ModuleScreen module="scanner">
          <ScannerModule />
        </ModuleScreen>
      )}
      {activeModule === 'recipes' && (
        <ModuleScreen module="recipes">
          <RecipeModule />
        </ModuleScreen>
      )}

      {/* La barre d'onglets reste au-dessus de tout (z-40) */}
      <NavDock />
    </div>
  );
}

export default function App() {
  return <AppContent />;
}