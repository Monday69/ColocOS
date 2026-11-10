import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, VolumeX, CloudOff, BellRing, BellOff, Loader2, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { useFridgeStore, useAudioStore, useConnectivityStore, useOfflineQueue, useNavStore } from '@/store';
import { HEALTH_COLORS } from '@/lib/healthColors';
import { toasts } from '@/components/ui/ToastProvider';
import { UserProfileModal } from '@/components/ui/UserProfileModal';
import { hapticTap } from '@/lib/haptics';
import { disablePush, enablePush, getPushStatus, isPushSupported, type PushStatus } from '@/lib/push';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — HUD Overlay v2 (Sprint 8 — Audio Mute + Offline Indicator)
//
// Nouveautés :
//   • Bouton Mute (haut-parleur) — démarre aussi l'AudioContext au premier clic
//     (résout la restriction autoplay des navigateurs)
//   • Indicateur "HORS-LIGNE" avec icône CloudOff animé
//   • Badge file d'attente offline : "N items en attente de sync"
//   • pointer-events: auto uniquement sur les boutons interactifs
// ─────────────────────────────────────────────────────────────────────────────

interface HudOverlayProps {
  /** Callback fourni par FridgeScene pour démarrer l'audio au premier clic */
  onAudioStart?: () => void;
}

export function HudOverlay({ onAudioStart }: HudOverlayProps) {
  const { fridgeState, isLoading, error, lastFetchedAt } = useFridgeStore();
  const { isMuted, setMuted }  = useAudioStore();
  const { isOnline }           = useConnectivityStore();
  const { offlineCheckQueue }  = useOfflineQueue();
  const audioStartedRef        = useRef(false);

  // ── Notifications push (alerte de péremption J+1) ─────────────────────────
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setPushStatus({
        supported: false,
        permission: 'unsupported',
        subscribed: false,
        serverConfigured: false,
      });
      return;
    }

    let cancelled = false;
    void getPushStatus()
      .then((status) => {
        if (!cancelled) setPushStatus(status);
      })
      .catch(() => {
        if (!cancelled) {
          setPushStatus({
            supported: true,
            permission: Notification.permission,
            subscribed: false,
            serverConfigured: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePushToggle = useCallback(async () => {
    if (pushBusy) return;
    hapticTap();
    setPushBusy(true);

    try {
      if (pushStatus?.subscribed) {
        setPushStatus(await disablePush());
        toasts.pushDisabled();
      } else {
        setPushStatus(await enablePush());
        toasts.pushEnabled();
      }
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : 'Notifications indisponibles');
      setPushStatus(await getPushStatus().catch(() => null));
    } finally {
      setPushBusy(false);
    }
  }, [pushBusy, pushStatus?.subscribed]);

  const summary = fridgeState?.summary;

  const stats = [
    { label: 'ITEMS',  value: summary?.totalItems       ?? '--', color: '#e8eaf0' },
    { label: 'CRITIC', value: summary?.criticalZones    ?? '--', color: HEALTH_COLORS.critical },
    { label: 'WARN',   value: summary?.warningZones     ?? '--', color: HEALTH_COLORS.warning },
    { label: 'EXP/7J', value: summary?.expiringThisWeek ?? '--', color: HEALTH_COLORS.warning },
    { label: 'VIDES',  value: summary?.emptyZones       ?? '--', color: HEALTH_COLORS.empty },
  ];

  // Toggle mute — premier clic démarre aussi l'AudioContext (autoplay policy)
  const handleMuteToggle = useCallback(() => {
    if (!audioStartedRef.current && onAudioStart) {
      onAudioStart();
      audioStartedRef.current = true;
    }
    setMuted(!isMuted);
  }, [isMuted, setMuted, onAudioStart]);

  const pendingSync = offlineCheckQueue.length;

  // Les stats du Digital Twin n'ont de sens que sur l'onglet FRIGO : sur SCAN /
  // COURSES / RECETTES, la barre libère la place au formulaire (le bouton mute,
  // lui, reste accessible).
  const showFridgeStats = useNavStore((s) => s.activeModule) === 'fridge';

  return (
    <div className="absolute top-[calc(env(safe-area-inset-top,47px)+10px)] left-[calc(1rem+env(safe-area-inset-left,0px))] flex flex-col gap-2 select-none z-10">
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="flex items-baseline gap-2 pointer-events-none">
        <span className="font-display text-2xl font-700 tracking-wider text-text-primary">COLOC</span>
        <span className="font-display text-2xl font-300 tracking-wider text-accent">OS</span>
        <span
          className="font-mono text-2xs ml-1 px-1.5 py-[1px] rounded-md"
          style={{
            color: '#4fc3f7',
            backgroundColor: 'rgba(79,195,247,0.12)',
            border: '1px solid rgba(79,195,247,0.35)',
            boxShadow: '0 0 10px rgba(79,195,247,0.25)',
          }}
        >
          v1.4-crisper-topview
        </span>
      </div>

      {showFridgeStats && (
        <div className="label-micro mb-1 pointer-events-none">Digital Twin — Cuisine</div>
      )}

      {/* ── Stats + Mute button ───────────────────────────────────────────── */}
      <div className="panel px-2.5 sm:px-3 py-2 flex items-center gap-2 sm:gap-3 max-w-[calc(100vw-2rem)]">
        {/* Stat chips */}
        {showFridgeStats && (
          <>
            <div className="flex gap-2.5 sm:gap-4 pointer-events-none">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col items-center gap-0.5">
                  <span
                    className="font-mono text-base sm:text-lg font-medium leading-none tabular-nums"
                    style={{ color: s.color }}
                  >
                    {s.value}
                  </span>
                  <span className="label-micro !text-[9px] !tracking-[0.14em]">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="w-px h-8 bg-white/10 flex-shrink-0" />
          </>
        )}

        {/* Mute toggle — SEUL élément pointer-events auto dans ce panel */}
        <button
          onClick={handleMuteToggle}
          title={isMuted ? 'Activer le son' : 'Couper le son'}
          className={clsx(
            'w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0',
            'border tap ease-ios cursor-pointer',
            isMuted
              ? 'border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'
              : 'border-accent/30 text-accent bg-accent/10 hover:bg-accent/15',
          )}
          style={!isMuted ? { boxShadow: '0 0 14px rgba(79,195,247,0.14)' } : undefined}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isMuted ? (
              <motion.div key="muted"
                initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.12 }}>
                <VolumeX size={14} />
              </motion.div>
            ) : (
              <motion.div key="unmuted"
                initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.12 }}>
                <Volume2 size={14} />
              </motion.div>
            )}
          </AnimatePresence>
        </button>

        {/* Notifications push — alerte de péremption J+1 */}
        <button
          onClick={handlePushToggle}
          disabled={pushBusy || pushStatus?.supported === false}
          title={
            pushStatus?.supported === false
              ? 'Notifications non supportées par ce navigateur'
              : pushStatus?.permission === 'denied'
                ? 'Notifications bloquées — autorise-les dans les réglages du navigateur'
                : pushStatus?.subscribed
                  ? 'Désactiver les alertes de péremption'
                  : 'Activer les alertes de péremption (9h, J+1)'
          }
          aria-label="Notifications de péremption"
          className={clsx(
            'w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0',
            'border tap ease-ios',
            pushStatus?.supported === false
              ? 'border-white/5 text-slate-600 cursor-not-allowed'
              : pushStatus?.subscribed
                ? 'border-health-ok/30 text-health-ok bg-health-ok/10 hover:bg-health-ok/15 cursor-pointer'
                : pushStatus?.permission === 'denied'
                  ? 'border-health-critical/30 text-health-critical/80 cursor-pointer'
                  : 'border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 cursor-pointer',
          )}
          style={
            pushStatus?.subscribed
              ? { boxShadow: '0 0 14px rgba(0,230,118,0.16)' }
              : undefined
          }
        >
          {pushBusy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : pushStatus?.subscribed ? (
            <BellRing size={14} />
          ) : (
            <BellOff size={14} />
          )}
        </button>

        {/* Profil & objectifs nutritionnels (BMR / TDEE / protéines) */}
        <button
          onClick={() => {
            hapticTap();
            setIsProfileOpen(true);
          }}
          title="Profil & objectifs nutritionnels"
          aria-label="Profil et objectifs nutritionnels"
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0
                     border border-white/10 text-slate-400 tap ease-ios cursor-pointer
                     hover:text-slate-200 hover:border-white/20"
        >
          <UserRound size={14} />
        </button>
      </div>

      {/* ── Status row ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-1 pointer-events-none">
        <div className={clsx(
          'status-dot',
          error ? 'bg-health-critical animate-pulse' : 'bg-health-ok animate-pulse-slow',
        )} />
        <span className="font-mono text-2xs text-text-tertiary">
          {error ? 'ERREUR API' : isLoading ? 'SYNC...' : lastFetchedAt
            ? `SYNC ${lastFetchedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : 'EN ATTENTE'}
        </span>
      </div>

      {/* ── Offline banner ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, x: -12, height: 0 }}
            animate={{ opacity: 1, x: 0,   height: 'auto' }}
            exit={{   opacity: 0, x: -12,  height: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="pointer-events-none overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg
                            bg-health-warning/8 border border-health-warning/30"
                 style={{ boxShadow: '0 0 16px rgba(245,158,11,0.08)' }}>
              <CloudOff size={12} className="text-health-warning flex-shrink-0 animate-pulse" />
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-2xs text-health-warning font-500 tracking-wider">
                  MODE HORS-LIGNE
                </span>
                {pendingSync > 0 && (
                  <span className="font-mono text-2xs text-health-warning/60">
                    {pendingSync} check{pendingSync > 1 ? 's' : ''} en attente de sync
                  </span>
                )}
              </div>

              {/* Pending sync count badge */}
              {pendingSync > 0 && (
                <div className="ml-auto w-5 h-5 rounded-full bg-health-warning/20 border border-health-warning/40
                                flex items-center justify-center flex-shrink-0">
                  <span className="font-mono text-[9px] text-health-warning leading-none">
                    {pendingSync > 9 ? '9+' : pendingSync}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sync complete flash (briefly shown when coming back online) ─── */}
      <AnimatePresence>
        {isOnline && pendingSync === 0 && offlineCheckQueue?.length === 0 && !isLoading && lastFetchedAt && (
          null // Placeholder — could add a "✓ Synchronisé" flash here
        )}
      </AnimatePresence>

      <UserProfileModal open={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </div>
  );
}