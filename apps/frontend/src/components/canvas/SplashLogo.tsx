import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Splash logo « Fridge Slam »
//
// Phase 0 : apparition + flottement doux (0 → 0,9 s)
// Phase 1 : écrasement violent au moment de l'impact du frigo (1,15 s)
// Phase 3 : disparition complète (démontage à 1,4 s)
// ─────────────────────────────────────────────────────────────────────────────

interface SplashLogoProps {
  /** Horodatage `performance.now()` du départ de l'intro */
  startedAt: number | null;
  /** Tap / fin d'intro : on retire le logo immédiatement */
  active: boolean;
  onDone?: () => void;
}

const CRUSH_AT_MS = 1150;
const REMOVE_AT_MS = 1400;

export function SplashLogo({ startedAt, active, onDone }: SplashLogoProps) {
  const [crushed, setCrushed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!active) {
      setGone(true);
      return;
    }
    setCrushed(false);
    setGone(false);

    const crushTimer = window.setTimeout(() => setCrushed(true), CRUSH_AT_MS);
    const removeTimer = window.setTimeout(() => {
      setGone(true);
      onDone?.();
    }, REMOVE_AT_MS);

    return () => {
      window.clearTimeout(crushTimer);
      window.clearTimeout(removeTimer);
    };
  }, [active, startedAt, onDone]);

  if (gone) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={
            crushed
              ? { opacity: 0, scaleY: 0.05, scaleX: 1.6, y: 0 }
              : { opacity: 1, y: [0, -5, 0] }
          }
          transition={
            crushed
              ? { duration: 0.1, ease: 'easeOut' }
              : { duration: 2, repeat: Infinity, ease: 'easeInOut' }
          }
          className="flex flex-col items-center gap-2"
          style={{ transformOrigin: 'center 85%' }}
        >
          <div
            className="font-display text-[42px] leading-none tracking-[0.18em] uppercase"
            style={{
              color: '#f8fdff',
              textShadow: '0 0 24px rgba(56,189,248,0.55), 0 0 6px rgba(56,189,248,0.35)',
            }}
          >
            Coloc<span style={{ color: '#38bdf8' }}>OS</span>
          </div>

          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border"
            style={{
              borderColor: 'rgba(56,189,248,0.35)',
              background: 'rgba(56,189,248,0.08)',
            }}
          >
            <span className="w-1 h-1 rounded-full" style={{ background: '#38bdf8' }} />
            <span
              className="font-mono text-[8px] uppercase tracking-[0.28em]"
              style={{ color: '#7dd3fc' }}
            >
              Smart Kitchen
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
