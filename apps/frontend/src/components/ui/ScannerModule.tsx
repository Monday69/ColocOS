import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scan, Search, X, Check, ChevronRight,
  AlertTriangle, Loader2, Package2,
  Thermometer, Zap, Beef, Wheat,
  Camera, CameraOff, ZapOff,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import { useScannerStore, useFridgeStore, useAudioStore } from '@/store';
import { toasts } from '@/components/ui/ToastProvider';
import { ZONE_LAYOUT } from '@/lib/zoneLayout';
import type { ScannedProduct } from '@/types';

// =============================================================================
// ColocOS — Scanner Module v2 (Sprint 9 — Camera Scanner)
//
// Modes: 'input' → saisie manuelle | 'camera' → viseur html5-qrcode | 'result' → ProductCard
//
// html5-qrcode : chargement dynamique (import()) pour éviter le SSR.
// L'instance est montée sur un div dédié (id unique via useId).
// stopCamera() appelé explicitement à chaque démontage.
// onSuccess → stop() → handleScan() + playDetectBlip()
//
// Overlay caméra Industrial Dark :
//   - Vignette radiale noire autour du flux vidéo
//   - 4 coins cyan (#4fc3f7) = cadre de visée
//   - Laser horizontal sweep (animation framer-motion, 3s loop)
//   - Badge SCANNING… pulsé
//   - Flash vert (#00e676) + coins verts à la détection
// =============================================================================

// ── Nutriscore ────────────────────────────────────────────────────────────────

const NUTRISCORE_COLORS = {
  a: { bg: '#1a8a3c', text: '#ffffff', label: 'A' },
  b: { bg: '#4ead2a', text: '#ffffff', label: 'B' },
  c: { bg: '#f5b800', text: '#ffffff', label: 'C' },
  d: { bg: '#e47c00', text: '#ffffff', label: 'D' },
  e: { bg: '#d32f2f', text: '#ffffff', label: 'E' },
} as Record<string, { bg: string; text: string; label: string }>;

function NutriscoreBadge({ score }: { score: string }) {
  const colors = NUTRISCORE_COLORS[score.toLowerCase()] ?? { bg: '#3a3d45', text: '#8b8fa8', label: score.toUpperCase() };
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-2xs text-text-tertiary">NUTRI</span>
      <div className="w-6 h-6 rounded font-display text-sm font-700 flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: colors.bg, color: colors.text, boxShadow: `0 0 10px ${colors.bg}60` }}>
        {colors.label}
      </div>
    </div>
  );
}

function MacroPill({ icon, label, value, unit, color }: { icon: React.ReactNode; label: string; value: number | undefined; unit: string; color: string }) {
  if (value === undefined) return null;
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg bg-surface-3/60 border border-surface-border/40 min-w-0">
      <div style={{ color }}>{icon}</div>
      <span className="font-mono text-xs font-500 text-text-primary">{Math.round(value)}{unit}</span>
      <span className="font-display text-2xs text-text-tertiary tracking-wider">{label}</span>
    </div>
  );
}

const GROUP_LABELS: Record<string, string> = {
  fridge: '❄ Réfrigérateur', freezer: '🧊 Congélateur', door: '🚪 Porte frigo',
  cabinet_left: '🗄 Placard gauche', cabinet_right: '🗄 Placard droit', pantry: '🧺 Garde-manger',
};

function ZonePicker({ selected, onSelect }: { selected: string | null; onSelect: (meshId: string, label: string) => void }) {
  const grouped = ZONE_LAYOUT.reduce<Record<string, typeof ZONE_LAYOUT>>((acc, z) => {
    if (!acc[z.group]) acc[z.group] = [];
    acc[z.group].push(z);
    return acc;
  }, {});
  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([group, zones]) => (
        <div key={group}>
          <div className="label-section mb-1">{GROUP_LABELS[group] ?? group}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {zones.map(zone => (
              <button key={zone.meshId} onClick={() => onSelect(zone.meshId, zone.label)}
                className={clsx('px-2.5 py-2 rounded-lg border text-left transition-all duration-150 font-body text-xs',
                  selected === zone.meshId ? 'border-accent/60 bg-accent/10 text-accent' : 'border-surface-border/40 bg-surface-3/40 text-text-secondary hover:border-surface-border hover:text-text-primary hover:bg-surface-3/70')}>
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">{zone.label}</span>
                  {selected === zone.meshId && <Check size={10} className="flex-shrink-0 text-accent" />}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-surface-border/40 bg-surface-2/60 p-4 space-y-3">
      <div className="flex gap-3">
        <div className="w-16 h-16 rounded-lg bg-surface-3 animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 bg-surface-3 rounded animate-pulse w-3/4" />
          <div className="h-2.5 bg-surface-3 rounded animate-pulse w-1/2" />
          <div className="h-2 bg-surface-3 rounded animate-pulse w-1/3 mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[1,2,3,4].map(i => <div key={i} className="h-12 bg-surface-3 rounded-lg animate-pulse" />)}
      </div>
    </div>
  );
}

function ProductCard({ product, onDismiss }: { product: ScannedProduct; onDismiss: () => void }) {
  const { setFridgeState } = useFridgeStore();
  const [selectedMeshId, setSelectedMeshId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('unité');
  const [expiryDate, setExpiryDate] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showZonePicker, setShowZonePicker] = useState(false);
  const canConfirm = selectedMeshId !== null && parseFloat(quantity) > 0;

  const handleConfirm = async () => {
    if (!selectedMeshId) return;
    setIsConfirming(true);
    try {
      await api.addToInventory({ barcode: product.barcode || undefined, name: product.name, brand: product.brand, imageUrl: product.imageUrl, nutriscore: product.nutriscore, quantity: parseFloat(quantity), unit, storageZoneId: selectedMeshId, expiryDate: expiryDate || null, isShared });
      const newState = await api.getFridgeState();
      setFridgeState(newState);
      toasts.productAdded(product.name, selectedLabel);
      onDismiss();
    } catch (err) {
      toasts.error('Ajout impossible', err instanceof Error ? err.message : 'Erreur serveur');
    } finally { setIsConfirming(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      className="rounded-xl border border-surface-border/60 bg-surface-2/80 overflow-hidden"
      style={{ boxShadow: '0 0 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
      <div className="p-4">
        <div className="flex gap-3 items-start">
          <div className="w-16 h-16 rounded-lg flex-shrink-0 overflow-hidden bg-surface-3 border border-surface-border/40 flex items-center justify-center">
            {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-contain p-1" /> : <Package2 size={24} className="text-text-tertiary" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-base font-600 text-text-primary leading-tight truncate">{product.name}</h3>
            {product.brand && <p className="font-body text-xs text-text-secondary mt-0.5">{product.brand}</p>}
            <div className="flex items-center gap-2 mt-1.5">
              {product.nutriscore && <NutriscoreBadge score={product.nutriscore} />}
              {product.quantity && <span className="font-mono text-2xs text-text-tertiary">{product.quantity}</span>}
              {product.fromCache && <span className="font-mono text-2xs text-accent/60 px-1.5 py-0.5 rounded bg-accent/5 border border-accent/15">CACHE</span>}
            </div>
          </div>
          <button onClick={onDismiss} className="text-text-tertiary hover:text-text-primary p-1 flex-shrink-0"><X size={14} /></button>
        </div>
        {product.nutriments && (
          <div className="grid grid-cols-4 gap-1.5 mt-3">
            <MacroPill icon={<Zap size={10} />} label="KCAL" value={product.nutriments.energy_kcal} unit="" color="#f59e0b" />
            <MacroPill icon={<Beef size={10} />} label="PROT" value={product.nutriments.proteins} unit="g" color="#4fc3f7" />
            <MacroPill icon={<Wheat size={10} />} label="GLUCIDES" value={product.nutriments.carbohydrates} unit="g" color="#a78bfa" />
            <MacroPill icon={<Thermometer size={10} />} label="FAT" value={product.nutriments.fat} unit="g" color="#fb7185" />
          </div>
        )}
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-surface-border/60 to-transparent" />
      <div className="px-4 py-3 flex items-center gap-2">
        <div className="flex-shrink-0">
          <div className="label-section mb-1">QTÉ</div>
          <input type="number" value={quantity} min="0.1" step="0.1" onChange={e => setQuantity(e.target.value)}
            className="w-16 bg-surface-3 border border-surface-border rounded px-2 py-1.5 font-mono text-sm text-text-primary text-center focus:outline-none focus:border-accent transition-colors" />
        </div>
        <div className="flex-shrink-0">
          <div className="label-section mb-1">UNITÉ</div>
          <select value={unit} onChange={e => setUnit(e.target.value)}
            className="bg-surface-3 border border-surface-border rounded px-2 py-1.5 font-mono text-sm text-text-primary focus:outline-none focus:border-accent transition-colors">
            {['unité','L','ml','kg','g','cl'].map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <div className="label-section mb-1">EXPIRATION</div>
          <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
            className="w-full bg-surface-3 border border-surface-border rounded px-2 py-1.5 font-mono text-xs text-text-primary focus:outline-none focus:border-accent transition-colors" />
        </div>
        <div className="flex-shrink-0 text-center">
          <div className="label-section mb-1">PARTAGÉ</div>
          <button onClick={() => setIsShared(v => !v)}
            className={clsx('w-9 h-5 rounded-full relative transition-colors duration-200', isShared ? 'bg-accent/40' : 'bg-surface-3 border border-surface-border')}>
            <motion.div className="absolute top-0.5 w-4 h-4 rounded-full bg-white"
              animate={{ left: isShared ? '18px' : '2px' }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
          </button>
        </div>
      </div>
      <div className="px-4 pb-3">
        <button onClick={() => setShowZonePicker(v => !v)}
          className={clsx('w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all',
            selectedMeshId ? 'border-accent/40 bg-accent/8 text-accent' : 'border-surface-border/60 bg-surface-3/50 text-text-secondary hover:text-text-primary hover:border-surface-border')}>
          <div className="flex items-center gap-2"><Package2 size={13} /><span className="font-body text-sm">{selectedMeshId ? selectedLabel : 'Choisir un emplacement…'}</span></div>
          <motion.div animate={{ rotate: showZonePicker ? 90 : 0 }} transition={{ duration: 0.15 }}><ChevronRight size={13} /></motion.div>
        </button>
        <AnimatePresence>
          {showZonePicker && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden mt-2">
              <ZonePicker selected={selectedMeshId} onSelect={(meshId, label) => { setSelectedMeshId(meshId); setSelectedLabel(label); setShowZonePicker(false); }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="px-4 pb-4">
        <button onClick={handleConfirm} disabled={!canConfirm || isConfirming}
          className={clsx('w-full py-3 rounded-xl font-mono text-sm flex items-center justify-center gap-2 transition-all duration-200',
            canConfirm && !isConfirming ? 'bg-health-ok/15 border border-health-ok/40 text-health-ok hover:bg-health-ok/25 cursor-pointer' : 'bg-surface-3/50 border border-surface-border/40 text-text-tertiary cursor-not-allowed')}
          style={canConfirm ? { boxShadow: '0 0 20px #00e67615' } : undefined}>
          {isConfirming ? <><Loader2 size={14} className="animate-spin" /> AJOUT EN COURS…</> : <><Check size={14} /> CONFIRMER L'AJOUT</>}
        </button>
      </div>
    </motion.div>
  );
}

// =============================================================================
// CameraScanner — Viseur html5-qrcode + overlay néon Industrial Dark
// =============================================================================

type ScanState = 'idle' | 'starting' | 'active' | 'detected' | 'error';

function CameraScanner({ onDetected, onClose }: { onDetected: (barcode: string) => void; onClose: () => void }) {
  // useId generates a stable unique id — safe with React 18 concurrent mode
  const rawId = useId();
  const viewfinderId = 'qr_' + rawId.replace(/[^a-zA-Z0-9]/g, '_');
  const scannerRef = useRef<{ stop: () => Promise<void>; isScanning: boolean } | null>(null);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [permError, setPermError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const { isMuted } = useAudioStore();

  const playDetectBlip = useCallback(() => {
    if (isMuted) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 1320;
      g.gain.setValueAtTime(0.14, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.04);
      osc.onended = () => ctx.close();
    } catch { /* silent fail */ }
  }, [isMuted]);

  const startCamera = useCallback(async () => {
    setScanState('starting');
    setPermError(null);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(viewfinderId);
      scannerRef.current = scanner as unknown as { stop: () => Promise<void>; isScanning: boolean };
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 240, height: 160 }, aspectRatio: 1.5, disableFlip: false },
        (decodedText: string) => {
          if (lastCode === decodedText) return;
          setLastCode(decodedText);
          setScanState('detected');
          playDetectBlip();
          scanner.stop().catch(() => {}).finally(() => {
            scannerRef.current = null;
            onDetected(decodedText);
          });
        },
        () => {},
      );
      setScanState('active');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPermError(
        msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')
          ? 'Accès caméra refusé. Autorisez la caméra dans les paramètres du navigateur.'
          : `Impossible d'ouvrir la caméra : ${msg}`
      );
      setScanState('error');
    }
  }, [viewfinderId, lastCode, onDetected, playDetectBlip]);

  useEffect(() => {
    return () => { if (scannerRef.current?.isScanning) scannerRef.current.stop().catch(() => {}); };
  }, []);

  const cornerColor = scanState === 'detected' ? '#00e676' : '#4fc3f7';
  const cornerGlow  = scanState === 'detected' ? '0 0 12px #00e676' : '0 0 8px #4fc3f780';

  const handleClose = () => {
    if (scannerRef.current?.isScanning) scannerRef.current.stop().catch(() => {});
    onClose();
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      className="rounded-xl overflow-hidden border border-surface-border/60"
      style={{ background: '#0a0b0d', boxShadow: '0 0 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(79,195,247,0.1), inset 0 1px 0 rgba(255,255,255,0.04)' }}>

      {/* Viewfinder */}
      <div className="relative bg-black" style={{ aspectRatio: '4/3', minHeight: 220 }}>

        {/* html5-qrcode video mount point */}
        <div id={viewfinderId} className="w-full h-full" />

        {/* Radial vignette */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 72% 62% at 50% 50%, transparent 38%, rgba(0,0,0,0.78) 100%)' }} />

        {/* Viewfinder corners + laser — only when active/detected */}
        {(scanState === 'active' || scanState === 'detected') && (
          <>
            {/* Top-left corner */}
            <div className="absolute" style={{ top: '18%', left: '13%', width: 28, height: 28 }}>
              <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: cornerColor, boxShadow: cornerGlow }} />
              <div className="absolute top-0 left-0 h-full w-[2px]" style={{ background: cornerColor, boxShadow: cornerGlow }} />
            </div>
            {/* Top-right corner */}
            <div className="absolute" style={{ top: '18%', right: '13%', width: 28, height: 28 }}>
              <div className="absolute top-0 right-0 w-full h-[2px]" style={{ background: cornerColor, boxShadow: cornerGlow }} />
              <div className="absolute top-0 right-0 h-full w-[2px]" style={{ background: cornerColor, boxShadow: cornerGlow }} />
            </div>
            {/* Bottom-left corner */}
            <div className="absolute" style={{ bottom: '18%', left: '13%', width: 28, height: 28 }}>
              <div className="absolute bottom-0 left-0 w-full h-[2px]" style={{ background: cornerColor, boxShadow: cornerGlow }} />
              <div className="absolute bottom-0 left-0 h-full w-[2px]" style={{ background: cornerColor, boxShadow: cornerGlow }} />
            </div>
            {/* Bottom-right corner */}
            <div className="absolute" style={{ bottom: '18%', right: '13%', width: 28, height: 28 }}>
              <div className="absolute bottom-0 right-0 w-full h-[2px]" style={{ background: cornerColor, boxShadow: cornerGlow }} />
              <div className="absolute bottom-0 right-0 h-full w-[2px]" style={{ background: cornerColor, boxShadow: cornerGlow }} />
            </div>

            {/* Scan laser sweep */}
            {scanState === 'active' && (
              <motion.div className="absolute pointer-events-none"
                style={{ left: '12%', right: '12%', height: 2,
                  background: 'linear-gradient(90deg, transparent, #4fc3f7cc, transparent)',
                  boxShadow: '0 0 8px #4fc3f7, 0 0 22px #4fc3f750' }}
                animate={{ top: ['19%', '81%', '19%'] }}
                transition={{ duration: 2.8, ease: 'easeInOut', repeat: Infinity }} />
            )}

            {/* Detection flash */}
            {scanState === 'detected' && (
              <motion.div className="absolute inset-0 pointer-events-none" initial={{ opacity: 0.45 }} animate={{ opacity: 0 }} transition={{ duration: 0.4 }}
                style={{ background: 'rgba(0,230,118,0.18)' }} />
            )}
          </>
        )}

        {/* Status badge */}
        <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none z-10">
          <AnimatePresence mode="wait">
            {scanState === 'starting' && (
              <motion.div key="st" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 border border-surface-border/60 backdrop-blur-sm">
                <Loader2 size={10} className="text-accent animate-spin" />
                <span className="font-mono text-2xs text-accent tracking-widest">INITIALISATION…</span>
              </motion.div>
            )}
            {scanState === 'active' && (
              <motion.div key="ac" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <motion.div className="flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-sm"
                  style={{ background: 'rgba(10,11,13,0.75)', border: '1px solid rgba(79,195,247,0.35)' }}
                  animate={{ boxShadow: ['0 0 8px rgba(79,195,247,0.2)', '0 0 20px rgba(79,195,247,0.5)', '0 0 8px rgba(79,195,247,0.2)'] }}
                  transition={{ duration: 1.8, repeat: Infinity }}>
                  <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  <span className="font-mono text-2xs text-accent tracking-[0.2em]">SCANNING…</span>
                </motion.div>
              </motion.div>
            )}
            {scanState === 'detected' && (
              <motion.div key="de" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(0,230,118,0.15)', border: '1px solid rgba(0,230,118,0.5)', boxShadow: '0 0 16px rgba(0,230,118,0.3)' }}>
                <Check size={10} className="text-health-ok" />
                <span className="font-mono text-2xs text-health-ok tracking-widest">CODE DÉTECTÉ</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Idle overlay */}
        {scanState === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ background: 'rgba(10,11,13,0.82)' }}>
            <div className="w-16 h-16 rounded-2xl border border-surface-border/50 bg-surface-3/30 flex items-center justify-center">
              <Camera size={28} className="text-text-tertiary" />
            </div>
            <p className="font-mono text-xs text-text-tertiary text-center px-6 leading-relaxed">
              Autorisez l'accès à la caméra<br />pour scanner un code-barres
            </p>
            <button onClick={startCamera}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-mono text-sm text-black font-600 transition-all hover:scale-105 active:scale-100"
              style={{ background: 'linear-gradient(135deg, #4fc3f7, #29b6f6)', boxShadow: '0 0 28px rgba(79,195,247,0.45), 0 4px 12px rgba(0,0,0,0.4)' }}>
              <Camera size={14} />
              DÉMARRER CAMÉRA
            </button>
          </div>
        )}

        {/* Error overlay */}
        {scanState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4" style={{ background: 'rgba(10,11,13,0.88)' }}>
            <CameraOff size={28} className="text-health-critical" />
            <p className="font-mono text-xs text-health-critical/80 text-center leading-relaxed">{permError}</p>
            <button onClick={() => { setScanState('idle'); setPermError(null); }}
              className="px-4 py-2 rounded-lg border border-surface-border/50 text-text-secondary font-mono text-2xs hover:text-text-primary transition-colors">
              RÉESSAYER
            </button>
          </div>
        )}

        {/* Close button */}
        <button onClick={handleClose}
          className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-black/60 border border-surface-border/50 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors backdrop-blur-sm z-20">
          <X size={12} />
        </button>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2.5 flex items-center gap-2 border-t border-surface-border/30">
        <ZapOff size={10} className="text-text-tertiary flex-shrink-0" />
        <p className="font-mono text-2xs text-text-tertiary leading-relaxed">
          Placez le code EAN face à la caméra. Détection automatique.
        </p>
      </div>
    </motion.div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

type ScannerMode = 'input' | 'camera' | 'result';

export function ScannerModule() {
  const { scannedProduct, isScanLoading, scanError, setScannedProduct, setScanLoading, setScanError } = useScannerStore();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [mode, setMode] = useState<ScannerMode>('input');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const handleScan = useCallback(async (barcode: string) => {
    if (!barcode.trim()) return;
    setMode('input');
    setScanLoading(true);
    setScanError(null);
    setScannedProduct(null);
    try {
      const product = await api.scanBarcode(barcode.trim());
      setScannedProduct(product);
      setMode('result');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      if (msg.includes('404') || msg.includes('not found') || msg.includes('reconnu')) {
        setScanError(`Produit non reconnu pour "${barcode}"`);
        toasts.productNotFound(barcode.trim());
      } else {
        setScanError(msg);
        toasts.error('Erreur de scan', msg);
      }
      setMode('input');
    } finally { setScanLoading(false); }
  }, [setScannedProduct, setScanLoading, setScanError]);

  const handleDismiss = () => {
    setScannedProduct(null);
    setMode('input');
    setBarcodeInput('');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <div className="label-section">SCANNER</div>
          <h2 className="font-display text-xl font-600 text-text-primary mt-0.5">
            Ajouter au <span className="text-accent font-300">stock</span>
          </h2>
        </div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center border border-surface-border/50"
          style={{ boxShadow: isScanLoading ? '0 0 16px #4fc3f730' : undefined }}>
          {isScanLoading ? <Loader2 size={16} className="animate-spin text-accent" /> : <Scan size={16} className="text-text-tertiary" />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
        {/* Camera scanner */}
        <AnimatePresence>
          {mode === 'camera' && (
            <CameraScanner onDetected={(code) => { setMode('input'); handleScan(code); }} onClose={() => setMode('input')} />
          )}
        </AnimatePresence>

        {/* Input panel */}
        <AnimatePresence mode="wait">
          {mode === 'input' && (
            <motion.div key="input-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
              {/* Text input */}
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"><Search size={14} /></div>
                <input ref={inputRef} type="text" inputMode="numeric" value={barcodeInput}
                  onChange={e => setBarcodeInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScan(barcodeInput); }}
                  placeholder="Code-barres EAN-13…"
                  className="w-full bg-surface-3 border border-surface-border rounded-xl pl-9 pr-12 py-3 font-mono text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent transition-colors"
                  style={{ caretColor: '#4fc3f7' }} />
                {barcodeInput && (
                  <button onClick={() => handleScan(barcodeInput)} disabled={isScanLoading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-accent/15 border border-accent/40 text-accent rounded-lg font-mono text-2xs hover:bg-accent/25 transition-all disabled:opacity-50">
                    SCAN
                  </button>
                )}
              </div>

              {/* Camera launch button */}
              <button onClick={() => setMode('camera')}
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl border transition-all duration-200 group"
                style={{ background: 'linear-gradient(135deg, rgba(79,195,247,0.07) 0%, rgba(79,195,247,0.02) 100%)', border: '1px solid rgba(79,195,247,0.28)', boxShadow: '0 0 20px rgba(79,195,247,0.08)' }}>
                <Camera size={15} className="text-accent group-hover:scale-110 transition-transform" />
                <span className="font-mono text-sm text-accent tracking-widest">DÉMARRER CAMÉRA</span>
                <div className="w-1.5 h-1.5 rounded-full bg-accent/50 animate-pulse" />
              </button>

              {/* Error */}
              {scanError && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  className="flex items-start gap-2 p-3 rounded-lg bg-health-warning/5 border border-health-warning/25">
                  <AlertTriangle size={14} className="text-health-warning flex-shrink-0 mt-0.5" />
                  <span className="font-mono text-xs text-health-warning">{scanError}</span>
                </motion.div>
              )}

              {/* Demo codes */}
              <div>
                <div className="label-section mb-2">CODES DEMO</div>
                <div className="flex flex-wrap gap-2">
                  {[{ code:'3017620422003',name:'Nutella'},{ code:'5000112637939',name:'Coca-Cola'},{ code:'3228857000852',name:'Évian'},{ code:'7622210449283',name:'Oreo'}].map(({ code, name }) => (
                    <button key={code} onClick={() => { setBarcodeInput(code); handleScan(code); }}
                      className="px-2.5 py-1.5 rounded-lg border border-surface-border/50 bg-surface-3/50 font-mono text-2xs text-text-secondary hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all">
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Info */}
              <div className="p-3 rounded-lg border border-surface-border/30 bg-surface-2/40">
                <div className="label-section mb-1.5">COMMENT ÇA MARCHE</div>
                <p className="font-body text-xs text-text-tertiary leading-relaxed">
                  Utilisez la caméra (EAN-8, EAN-13, QR Code…) ou entrez manuellement un code. Données via OpenFoodFacts, mises en cache côté backend.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading */}
        <AnimatePresence>
          {isScanLoading && (
            <motion.div key="skel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><SkeletonCard /></motion.div>
          )}
        </AnimatePresence>

        {/* Product card */}
        <AnimatePresence>
          {scannedProduct && mode === 'result' && (
            <ProductCard key={scannedProduct.barcode} product={scannedProduct} onDismiss={handleDismiss} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}