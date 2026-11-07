import { useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, VolumeX, CloudOff } from 'lucide-react';
import clsx from 'clsx';
import { useFridgeStore, useAudioStore, useConnectivityStore, useOfflineQueue } from '@/store';
import { HEALTH_COLORS } from '@/lib/healthColors';

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

  return (
    <div className="absolute top-4 left-4 flex flex-col gap-2 select-none z-10">
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="flex items-baseline gap-2 pointer-events-none">
        <span className="font-display text-2xl font-700 tracking-wider text-text-primary">COLOC</span>
        <span className="font-display text-2xl font-300 tracking-wider text-accent">OS</span>
        <span className="font-mono text-2xs text-text-tertiary ml-1">v1.0</span>
      </div>

      <div className="label-section mb-1 pointer-events-none">DIGITAL TWIN — CUISINE</div>

      {/* ── Stats + Mute button ───────────────────────────────────────────── */}
      <div className="panel px-3 py-2 flex items-center gap-3">
        {/* Stat chips */}
        <div className="flex gap-4 pointer-events-none">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-0.5">
              <span className="font-mono text-lg font-500 leading-none" style={{ color: s.color }}>
                {s.value}
              </span>
              <span className="font-display text-2xs text-text-tertiary tracking-widest">
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-surface-border/60 flex-shrink-0" />

        {/* Mute toggle — SEUL élément pointer-events auto dans ce panel */}
        <button
          onClick={handleMuteToggle}
          title={isMuted ? 'Activer le son' : 'Couper le son'}
          className={clsx(
            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
            'border transition-all duration-200 cursor-pointer',
            isMuted
              ? 'border-surface-border/50 text-text-tertiary hover:text-text-secondary hover:border-surface-border'
              : 'border-accent/30 text-accent bg-accent/5 hover:bg-accent/12',
          )}
          style={!isMuted ? { boxShadow: '0 0 10px rgba(79,195,247,0.12)' } : undefined}
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
    </div>
  );
}