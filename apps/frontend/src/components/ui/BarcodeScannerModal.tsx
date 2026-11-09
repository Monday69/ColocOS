import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CameraOff, Loader2, ScanLine, X } from 'lucide-react'
import { BarcodeScanEngine, type ScanStats } from '@/lib/barcode/scanEngine'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — BarcodeScannerModal
//
// Viseur caméra pour peupler le formulaire d'ajout sans saisie manuelle
// (EAN-13 / EAN-8 / UPC-A / UPC-E).
//
// Le flux et le décodage sont gérés par `BarcodeScanEngine` (lib/barcode) :
//   • caméra arrière principale en 1920×1080 (min 1280×720) ;
//   • canvas d'analyse à la résolution du flux (et non à la taille CSS) ;
//   • décodeur natif `BarcodeDetector` uniquement si `ean_13` est réellement
//     supporté, sinon ZXing pur JS à 10 fps (repli automatique).
//
// CYCLE DE VIE STRICT (la LED caméra doit s'éteindre dans tous les cas) :
//   1. montage     → engine.start() (sonde → getUserMedia → boucle)
//   2. succès      → stop() → onScanSuccess(code)
//   3. ✕ / Échap   → stop() → onClose()
//   4. démontage   → stop() (cleanup useEffect)
//
// Rendu via portail (document.body) : le panneau latéral utilise un transform
// (translate-x) qui ferait de tout `position: fixed` un descendant contraint.
// ─────────────────────────────────────────────────────────────────────────────

type ScannerStatus = 'starting' | 'active' | 'detected' | 'error'

/**
 * Bandeau de diagnostic temporaire (moteur actif, caméra, résolution, frames).
 * Affiché en dev Vite ou en ajoutant `?scanDebug=1` à l'URL ; masquable d'un tap.
 */
const DEBUG_ENABLED =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('scanDebug'))

/** Bip court (880 Hz) — silencieux si l'AudioContext est bloqué par le navigateur. */
function playBeep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.14)
    osc.onended = () => { void ctx.close().catch(() => {}) }
  } catch {
    /* pas de son — non bloquant */
  }
}

/** Message d'erreur utilisateur à partir d'une erreur d'acquisition caméra. */
function toFriendlyCameraError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/permission|denied|notallowed/i.test(message)) {
    return 'Accès caméra refusé. Autorisez la caméra puis réessayez.'
  }
  if (/notfound|devices|overconstrained/i.test(message)) {
    return 'Aucune caméra compatible détectée sur cet appareil.'
  }
  if (/sécurisée|insecure|getusermedia indisponible/i.test(message)) {
    return 'La caméra exige une origine sécurisée (HTTPS).'
  }
  return 'Impossible de démarrer la caméra.'
}

export interface BarcodeScannerModalProps {
  onScanSuccess: (barcode: string) => void
  onClose: () => void
}

export function BarcodeScannerModal({ onScanSuccess, onClose }: BarcodeScannerModalProps) {
  const [status, setStatus] = useState<ScannerStatus>('starting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [stats, setStats] = useState<ScanStats | null>(null)
  const [showDebug, setShowDebug] = useState(DEBUG_ENABLED)

  const videoRef = useRef<HTMLVideoElement>(null)
  const engineRef = useRef<BarcodeScanEngine | null>(null)
  const handledRef = useRef(false)
  const cancelledRef = useRef(false)

  // Callbacks toujours à jour sans relancer le flux caméra
  const onScanRef = useRef(onScanSuccess)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onScanRef.current = onScanSuccess }, [onScanSuccess])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const handleDetected = useCallback((decodedText: string) => {
    if (handledRef.current) return
    handledRef.current = true

    setStatus('detected')
    navigator.vibrate?.(100)
    playBeep()

    // Coupe la caméra AVANT de remonter le code (LED éteinte immédiatement)
    const engine = engineRef.current
    engineRef.current = null
    // Dernier instantané de diagnostic avant la coupure (sinon le bandeau gèle à « … »)
    if (engine) setStats(engine.getStats())
    engine?.stop()

    if (!cancelledRef.current) onScanRef.current(decodedText)
  }, [])

  const handleClose = useCallback(() => {
    const engine = engineRef.current
    engineRef.current = null
    engine?.stop()
    onCloseRef.current()
  }, [])

  // Démarrage du flux + nettoyage au démontage
  useEffect(() => {
    cancelledRef.current = false
    const video = videoRef.current
    if (!video) {
      setStatus('error')
      setErrorMessage('Viseur vidéo indisponible.')
      return
    }

    const engine = new BarcodeScanEngine(video, {
      onDetected: handleDetected,
      onFatal: (message) => {
        if (cancelledRef.current) return
        engineRef.current?.stop()
        engineRef.current = null
        setErrorMessage(message)
        setStatus('error')
      },
    })
    engineRef.current = engine

    void engine
      .start()
      .then(() => {
        if (!cancelledRef.current && engineRef.current === engine) setStatus('active')
      })
      .catch((error: unknown) => {
        if (cancelledRef.current) return
        engine.stop()
        if (engineRef.current === engine) engineRef.current = null
        // `onFatal` peut déjà avoir posé un message plus précis (décodeur ZXing
        // indisponible, flux interrompu) : on ne l'écrase pas par un message
        // générique de caméra.
        setErrorMessage((previous) => previous ?? toFriendlyCameraError(error))
        setStatus('error')
      })

    return () => {
      cancelledRef.current = true
      engine.stop()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [handleDetected])

  // Remontée des stats (polling : évite un rendu React à chaque frame)
  useEffect(() => {
    if (!showDebug) return
    const timer = window.setInterval(() => {
      const engine = engineRef.current
      if (engine) setStats(engine.getStats())
    }, 300)
    return () => window.clearInterval(timer)
  }, [showDebug])

  // Échap ferme le viseur (et coupe la caméra)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [handleClose])

  const corner =
    status === 'detected' ? 'border-health-ok' : 'border-accent'
  const glow =
    status === 'detected' ? '0 0 12px rgba(0,230,118,0.8)' : '0 0 10px rgba(79,195,247,0.7)'

  return createPortal(
    // Mobile : plein écran noir (z-50). Desktop : modale centrée sur backdrop.
    <div className="fixed inset-0 z-50 md:z-[300] flex items-stretch md:items-center justify-center bg-black md:bg-black/80 md:backdrop-blur-sm md:p-4">
      {/* Card — full screen mobile, carte desktop */}
      <div className="relative flex flex-col w-full h-full md:h-auto md:max-w-sm md:max-h-[90vh] overflow-hidden bg-black md:bg-surface-2 md:rounded-xl md:border md:border-surface-border">
        {/* Header — marge de sécurité iOS (encoche / Dynamic Island) */}
        <div className="flex items-center justify-between pl-4 pr-2 pt-safe border-b border-surface-border/60 md:pt-0">
          <div className="flex items-center gap-2">
            <ScanLine size={14} className="text-accent" />
            <span className="font-display text-xs tracking-widest text-text-primary">
              SCANNER CODE-BARRES
            </span>
          </div>
          {/* Cible tactile ≥ 44×44 px */}
          <button
            onClick={handleClose}
            aria-label="Fermer le scanner"
            className="w-11 h-11 flex items-center justify-center rounded-full text-text-secondary
                       hover:text-text-primary hover:bg-white/5 active:bg-white/10 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* Viewfinder — plein espace disponible sur mobile */}
        <div className="relative flex-1 min-h-0 md:flex-none md:aspect-[4/3] bg-black overflow-hidden">
          {/* `object-cover` : on décode exactement la zone visible (cf. scanEngine) */}
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            autoPlay
            playsInline
            disablePictureInPicture
          />

          {/* ── Bandeau de diagnostic (temporaire) ─────────────────────────────
              Moteur réellement actif, caméra, résolution du flux et du canvas
              d'analyse, frames traitées et dernière erreur de la boucle. */}
          {showDebug && (
            <div
              className="absolute inset-x-0 top-0 z-20 bg-black/70 px-2 py-1
                         font-mono text-[10px] leading-[1.4] text-white/85 select-text"
              onClick={() => setShowDebug(false)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    NATIF:{' '}
                    <span className={stats?.probe?.usable ? 'text-health-ok' : 'text-health-warning'}>
                      {stats?.probe ? (stats.probe.present ? 'OUI' : 'NON') : '…'}
                    </span>
                    {stats?.probe?.present && (
                      <>
                        {' · '}ean_13:{' '}
                        <span className={stats.probe.usable ? 'text-health-ok' : 'text-health-critical'}>
                          {stats.probe.usable ? 'OK' : 'KO'}
                        </span>
                      </>
                    )}
                    {' · '}MOTEUR <span className="text-accent">{stats?.engineLabel ?? '…'}</span>
                  </div>
                  <div className="truncate text-white/60">
                    CAM {stats?.camera ?? '…'}
                  </div>
                  <div className="truncate text-white/60">
                    FLUX {stats?.videoWidth ?? 0}×{stats?.videoHeight ?? 0} → CANVAS{' '}
                    {stats?.canvasWidth ?? 0}×{stats?.canvasHeight ?? 0}
                  </div>
                  <div className="truncate text-white/60">
                    FRAMES {stats?.frames ?? 0} · {stats?.fps ? stats.fps.toFixed(1) : '0.0'} fps
                  </div>
                  {stats?.probe?.error && (
                    <div className="truncate text-health-warning">NATIF KO · {stats.probe.error}</div>
                  )}
                  {stats?.fallbackNote && (
                    <div className="truncate text-health-warning">REPLI · {stats.fallbackNote}</div>
                  )}
                  {stats?.lastError && (
                    <div className="truncate text-health-critical">ERR · {stats.lastError}</div>
                  )}
                </div>
                <span className="shrink-0 text-white/40">tap=masquer</span>
              </div>
            </div>
          )}

          {/* Vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 70% 62% at 50% 50%, transparent 40%, rgba(0,0,0,0.75) 100%)' }}
          />

          {/* Cadre de visée décoratif (le décodage couvre tout le cadre visible) */}
          {(status === 'active' || status === 'detected') && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-[85%] h-[35%]">
                <span className={`absolute top-0 left-0 w-7 h-7 border-t-2 border-l-2 ${corner}`} style={{ boxShadow: glow }} />
                <span className={`absolute top-0 right-0 w-7 h-7 border-t-2 border-r-2 ${corner}`} style={{ boxShadow: glow }} />
                <span className={`absolute bottom-0 left-0 w-7 h-7 border-b-2 border-l-2 ${corner}`} style={{ boxShadow: glow }} />
                <span className={`absolute bottom-0 right-0 w-7 h-7 border-b-2 border-r-2 ${corner}`} style={{ boxShadow: glow }} />
                <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-accent/60 animate-pulse" />
              </div>
            </div>
          )}

          {/* Statut */}
          {status === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span className="font-mono text-2xs text-text-tertiary tracking-wider">
                INITIALISATION CAMÉRA…
              </span>
            </div>
          )}

          {status === 'detected' && (
            <div className="absolute inset-0 flex items-center justify-center bg-health-ok/15">
              <span className="font-mono text-xs text-health-ok tracking-widest">CODE DÉTECTÉ</span>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <CameraOff size={20} className="text-health-critical" />
              <span className="font-mono text-2xs text-text-secondary leading-relaxed">
                {errorMessage}
              </span>
            </div>
          )}
        </div>

        {/* Footer — bouton d'annulation large, accessible au pouce */}
        <div className="px-4 pb-safe pt-3 border-t border-surface-border/60">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="font-mono text-2xs text-text-tertiary">
              EAN-13 · EAN-8 · UPC-A · UPC-E
            </span>
            {DEBUG_ENABLED && !showDebug && (
              <button
                onClick={() => setShowDebug(true)}
                className="font-mono text-2xs text-text-tertiary underline underline-offset-2"
              >
                debug
              </button>
            )}
          </div>
          <button
            onClick={handleClose}
            className="w-full py-3 mb-3 rounded-xl border border-surface-border/70 bg-white/5
                       font-mono text-xs tracking-wider text-text-primary
                       hover:bg-white/10 active:scale-[0.99] transition-all
                       md:py-2 md:text-2xs md:mb-0"
          >
            ANNULER
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}