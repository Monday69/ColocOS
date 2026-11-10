import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scan, Search, X, Check, ChevronRight,
  AlertTriangle, Loader2, Package2,
  Zap,
  Camera, CameraOff, ZapOff,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import { useScannerStore, useFridgeStore, useAudioStore } from '@/store';
import { toasts } from '@/components/ui/ToastProvider';
import { ZONE_LAYOUT } from '@/lib/zoneLayout';
import { BarcodeScanEngine } from '@/lib/barcode/scanEngine';
import { hapticSuccess } from '@/lib/haptics';
import { QuickAddDrawer } from '@/components/ui/QuickAddDrawer';
import type { ScannedProduct } from '@/types';

// =============================================================================
// ColocOS — Scanner Module v2 (Sprint 9 — Camera Scanner)
//
// Modes: 'input' → saisie manuelle | 'camera' → viseur | 'result' → ProductCard
//
// Viseur : `BarcodeScanEngine` (lib/barcode) — le même pipeline que
// BarcodeScannerModal. getUserMedia en 1920×1080 (min 1280×720), canvas
// d'analyse à la résolution du flux (et non à la taille CSS du viseur),
// `BarcodeDetector` natif seulement si `ean_13` est réellement supporté, sinon
// ZXing JS à 10 fps. L'ancien `html5-qrcode` (qrbox 240×160) ne laissait pas
// assez de pixels pour les barres 1D sur iOS.
//
// Cycle de vie : startCamera() sur geste utilisateur → engine.start() ;
// détection → engine.stop() (LED éteinte) → onDetected(code) ; démontage → stop().
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

// ── Normalisation payload ↔ contrat backend ──────────────────────────────────
// Le backend (CreateItemSchema) n'accepte que l'enum Unit de Prisma.
// L'UI propose des libellés FR ('unité') et le centilitre ('cl') qui n'existent
// pas côté API : on convertit donc valeur + unité avant l'envoi.

type ApiUnit = 'g' | 'kg' | 'ml' | 'L' | 'unit';

function normalizeQuantityAndUnit(rawQuantity: number, rawUnit: string): {
  quantity: number;
  unit: ApiUnit;
} {
  switch (rawUnit) {
    case 'unité':
      return { quantity: rawQuantity, unit: 'unit' };
    case 'cl':
      // 1 cl = 10 ml — la quantité est convertie pour rester cohérente
      return { quantity: Math.round(rawQuantity * 1000) / 100, unit: 'ml' };
    case 'g':
    case 'kg':
    case 'ml':
    case 'L':
      return { quantity: rawQuantity, unit: rawUnit };
    default:
      return { quantity: rawQuantity, unit: 'unit' };
  }
}

// Le backend exige un datetime ISO 8601 complet ; <input type="date"> renvoie YYYY-MM-DD
function toExpiryIso(dateInput: string): string | null {
  if (!dateInput) return null;
  const parsed = new Date(dateInput);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// ── Résolution meshId 3D → UUID de StorageZone ───────────────────────────────
// GET /fridge/zones est la seule route exposant les deux identifiants.

type StorageZoneOption = { id: string; meshId: string; label: string; type: string };

let storageZonesCache: StorageZoneOption[] | null = null;

async function resolveStorageZoneId(meshId: string): Promise<string | null> {
  if (!storageZonesCache) storageZonesCache = await api.getStorageZones();
  return storageZonesCache.find((zone) => zone.meshId === meshId)?.id ?? null;
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
      const storageZoneId = await resolveStorageZoneId(selectedMeshId);
      if (!storageZoneId) {
        toasts.error(
          'Zone introuvable',
          `Aucune zone de stockage ne correspond à « ${selectedLabel || selectedMeshId} ».`,
        );
        return;
      }

      const { quantity: apiQuantity, unit: apiUnit } = normalizeQuantityAndUnit(
        parseFloat(quantity),
        unit,
      );

      await api.addToInventory({
        barcode: product.barcode || undefined,
        name: product.name,
        brand: product.brand,
        imageUrl: product.imageUrl,
        nutriscore: product.nutriscore,
        quantity: apiQuantity,
        unit: apiUnit,
        storageZoneId,
        expiryDate: toExpiryIso(expiryDate),
        isShared,
        // Macros OFF — persistées avec l'item (fiche nutrition du packaging 3D)
        calories: product.nutrition?.calories ?? product.kcalPer100g ?? null,
        proteins: product.nutrition?.proteins ?? null,
        carbohydrates: product.nutrition?.carbohydrates ?? null,
        fat: product.nutrition?.fat ?? null,
        fiber: product.nutrition?.fiber ?? null,
        novaGroup: product.nutrition?.novaGroup ?? null,
      });
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
      className="rounded-2xl border border-white/10 bg-slate-900/50 backdrop-blur-xl overflow-hidden"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
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
        {typeof product.kcalPer100g === 'number' && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-3/60 border border-surface-border/40">
              <Zap size={10} className="text-amber-400" />
              <span className="font-mono text-xs font-500 text-text-primary tabular-nums">
                {Math.round(product.kcalPer100g)} kcal / 100g
              </span>
            </div>
            {typeof product.nutrition?.proteins === 'number' && (
              <div className="px-2.5 py-1.5 rounded-lg bg-surface-3/60 border border-surface-border/40 font-mono text-xs text-text-secondary tabular-nums">
                P {Math.round(product.nutrition.proteins)} g
              </div>
            )}
            {typeof product.nutrition?.carbohydrates === 'number' && (
              <div className="px-2.5 py-1.5 rounded-lg bg-surface-3/60 border border-surface-border/40 font-mono text-xs text-text-secondary tabular-nums">
                G {Math.round(product.nutrition.carbohydrates)} g
              </div>
            )}
            {typeof product.nutrition?.fat === 'number' && (
              <div className="px-2.5 py-1.5 rounded-lg bg-surface-3/60 border border-surface-border/40 font-mono text-xs text-text-secondary tabular-nums">
                L {Math.round(product.nutrition.fat)} g
              </div>
            )}
            {product.nutrition?.novaGroup ? (
              <div className="px-2.5 py-1.5 rounded-lg bg-surface-3/60 border border-surface-border/40 font-mono text-xs text-text-secondary">
                NOVA {product.nutrition.novaGroup}
              </div>
            ) : null}
          </div>
        )}
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-surface-border/60 to-transparent" />
      <div className="px-4 py-3 flex flex-wrap items-end gap-2">
        <div className="flex-shrink-0">
          <div className="label-micro !text-[9px] mb-1">Qté</div>
          <input type="number" value={quantity} min="0.1" step="0.1" onChange={e => setQuantity(e.target.value)}
            className="w-16 bg-white/5 border border-white/10 rounded-xl px-2 py-2 font-mono text-sm text-white/90 text-center tabular-nums focus:outline-none focus:border-accent/60 transition-colors" />
        </div>
        <div className="flex-shrink-0">
          <div className="label-micro !text-[9px] mb-1">Unité</div>
          <select value={unit} onChange={e => setUnit(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-2 py-2 font-sans text-sm text-white/90 focus:outline-none focus:border-accent/60 transition-colors">
            {['unité','L','ml','kg','g','cl'].map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="order-last basis-full sm:order-none sm:basis-auto sm:flex-1 min-w-[132px]">
          <div className="label-micro !text-[9px] mb-1">Expiration</div>
          <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-2 py-2 font-sans text-xs text-white/90
                       focus:outline-none focus:border-accent/60 transition-colors [color-scheme:dark]" />
        </div>
        <div className="flex-shrink-0 text-center">
          <div className="label-micro !text-[9px] mb-1">Partagé</div>
          <button onClick={() => setIsShared(v => !v)}
            className={clsx('w-10 h-6 rounded-full relative tap transition-colors duration-200', isShared ? 'bg-accent/40' : 'bg-white/10 border border-white/10')}>
            <motion.div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow"
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
      {/* Barre d'action collée au bas de la fiche : CONFIRMER reste accessible
          même quand la carte défile dans la bottom sheet. */}
      <div className="sticky bottom-0 px-4 pb-4 pt-2 bg-slate-900/70 backdrop-blur-xl border-t border-white/10">
        <button onClick={handleConfirm} disabled={!canConfirm || isConfirming}
          className={clsx('w-full py-3 rounded-2xl font-sans text-sm flex items-center justify-center gap-2 ease-ios tap',
            canConfirm && !isConfirming ? 'bg-health-ok/15 border border-health-ok/40 text-health-ok hover:bg-health-ok/25 cursor-pointer' : 'bg-white/5 border border-white/10 text-slate-500 cursor-not-allowed')}
          style={canConfirm ? { boxShadow: '0 0 24px #00e67618, inset 0 1px 0 rgba(255,255,255,0.08)' } : undefined}>
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

// ── Mode « Composer un repas » ──────────────────────────────────────────────
type NutritionMode = 'stock' | 'meal'

interface MealLine {
  key: string
  name: string
  grams: number
  kcal100: number
  prot100: number
  carb100: number
  fat100: number
  hasMacros: boolean
}

const MEAL_PORTIONS = [50, 100, 150, 200] as const

/** Extrait les valeurs pour 100 g renvoyées par Open Food Facts. */
function macrosOf(product: ScannedProduct) {
  const n = product.nutrition
  const kcal = n?.calories ?? product.kcalPer100g ?? null
  return {
    kcal100: typeof kcal === 'number' ? kcal : 0,
    prot100: typeof n?.proteins === 'number' ? n.proteins : 0,
    carb100: typeof n?.carbohydrates === 'number' ? n.carbohydrates : 0,
    fat100: typeof n?.fat === 'number' ? n.fat : 0,
    hasMacros: typeof kcal === 'number' || typeof n?.proteins === 'number',
  }
}

/** Cartouche de réglage rapide d'un ingrédient du repas. */
function MealLineCard({
  line,
  onGrams,
  onRemove,
}: {
  line: MealLine
  onGrams: (key: string, grams: number) => void
  onRemove: (key: string) => void
}) {
  const prot = (line.prot100 * line.grams) / 100;
  const kcal = (line.kcal100 * line.grams) / 100;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      className="p-3 rounded-2xl border border-white/10 bg-white/[0.03]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-sans text-[13px] text-white/90 leading-tight min-w-0 break-words">
          {line.name}
        </p>
        <button
          type="button"
          onClick={() => onRemove(line.key)}
          aria-label={`Retirer ${line.name}`}
          className="p-1 -m-1 flex-shrink-0 text-slate-500 hover:text-health-critical tap transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {MEAL_PORTIONS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onGrams(line.key, p)}
            className={clsx(
              'px-2.5 py-1 rounded-lg border font-mono text-[10px] tabular-nums tap transition-colors',
              line.grams === p
                ? 'bg-accent/15 text-accent border-accent/40'
                : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200',
            )}
          >
            {p}g
          </button>
        ))}
        <input
          type="number"
          min={1}
          step={10}
          value={line.grams}
          onChange={(e) => onGrams(line.key, Math.max(1, Number(e.target.value) || 1))}
          className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1 font-mono text-[10px] text-white/90 text-center tabular-nums focus:outline-none focus:border-accent/60 [color-scheme:dark]"
          aria-label={`Quantité en grammes pour ${line.name}`}
        />
      </div>

      <p className="mt-1.5 font-mono text-[10px] text-slate-400 tabular-nums">
        {line.hasMacros ? (
          <>
            <span className="text-accent">{prot.toFixed(1)} g prot</span>
            {' • '}
            {Math.round(kcal)} kcal
          </>
        ) : (
          'Macros indisponibles pour ce produit'
        )}
      </p>
    </motion.div>
  );
}

function CameraScanner({
  onDetected,
  onClose,
  continuous = false,
}: {
  onDetected: (barcode: string) => void
  onClose: () => void
  /** Mode repas : le viseur reste ouvert, plusieurs produits d'affilée */
  continuous?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<BarcodeScanEngine | null>(null);
  const lastCodeRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [permError, setPermError] = useState<string | null>(null);
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

  const stopEngine = useCallback(() => {
    const engine = engineRef.current;
    engineRef.current = null;
    engine?.stop();
  }, []);

  const handleDetected = useCallback((code: string) => {
    if (lastCodeRef.current === code) return;
    lastCodeRef.current = code;
    setScanState('detected');
    playDetectBlip();
    hapticSuccess();
    if (!continuous) {
      // Coupe la caméra AVANT de remonter le code (LED éteinte immédiatement)
      stopEngine();
    }
    onDetected(code);
    if (continuous) {
      // Reprise après 1.5 s : permet d'enchaîner plusieurs produits
      window.setTimeout(() => {
        lastCodeRef.current = null;
        setScanState('active');
      }, 1500);
    }
  }, [onDetected, playDetectBlip, stopEngine, continuous]);

  const startCamera = useCallback(async () => {
    if (engineRef.current) return;
    const video = videoRef.current;
    if (!video) {
      setPermError('Viseur vidéo indisponible.');
      setScanState('error');
      return;
    }

    setScanState('starting');
    setPermError(null);
    lastCodeRef.current = null;

    const engine = new BarcodeScanEngine(video, {
      onDetected: handleDetected,
      onFatal: (message) => {
        if (cancelledRef.current) return;
        engineRef.current = null;
        engine.stop();
        setPermError(message);
        setScanState('error');
      },
    });
    engineRef.current = engine;

    try {
      await engine.start();
      if (!cancelledRef.current && engineRef.current === engine) setScanState('active');
    } catch (err) {
      engine.stop();
      if (engineRef.current === engine) engineRef.current = null;
      if (cancelledRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setPermError(
        /permission|denied|notallowed/i.test(msg)
          ? 'Accès caméra refusé. Autorisez la caméra dans les paramètres du navigateur.'
          : `Impossible d'ouvrir la caméra : ${msg}`,
      );
      setScanState('error');
    }
  }, [handleDetected]);

  // Extinction garantie : fin de scan, fermeture, changement d'onglet, démontage
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      const engine = engineRef.current;
      engineRef.current = null;
      engine?.stop();
    };
  }, []);

  const cornerColor = scanState === 'detected' ? '#00e676' : '#4fc3f7';
  const cornerGlow  = scanState === 'detected' ? '0 0 12px #00e676' : '0 0 8px #4fc3f780';

  const handleClose = () => {
    stopEngine();
    onClose();
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      className="rounded-xl overflow-hidden border border-surface-border/60"
      style={{ background: '#0a0b0d', boxShadow: '0 0 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(79,195,247,0.1), inset 0 1px 0 rgba(255,255,255,0.04)' }}>

      {/* Viewfinder */}
      <div className="relative bg-black" style={{ aspectRatio: '4/3', minHeight: 220 }}>

        {/* Flux vidéo — résolution pleine (1920×1080 / min 1280×720).
            `object-cover` : le moteur décode la zone réellement visible, à la
            résolution du capteur (aucun canvas bridé à la taille CSS). */}
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          autoPlay
          playsInline
          disablePictureInPicture
        />

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
              className="flex items-center gap-2 h-11 px-5 rounded-2xl font-sans text-[13px] font-medium tap
                         bg-gradient-to-br from-accent to-[#29b6f6] text-slate-950 transition-colors"
              style={{ boxShadow: '0 0 28px rgba(79,195,247,0.35), inset 0 1px 0 rgba(255,255,255,0.35)' }}>
              <Camera size={14} />
              Démarrer la caméra
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
  const [nutritionMode, setNutritionMode] = useState<NutritionMode>('stock');
  const [mealItems, setMealItems] = useState<MealLine[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const handleScan = useCallback(async (barcode: string) => {
    if (!barcode.trim()) return;
    const mealMode = nutritionMode === 'meal';
    // En mode repas avec viseur ouvert, on garde la caméra active
    const keepCamera = mealMode && mode === 'camera';
    if (!keepCamera) setMode('input');
    setScanLoading(true);
    setScanError(null);
    if (!mealMode) setScannedProduct(null);
    try {
      const product = await api.scanBarcode(barcode.trim());
      if (mealMode) {
        // Ajout au panier repas (100 g par défaut), sans quitter le viseur
        const macros = macrosOf(product);
        setMealItems((prev) => [
          ...prev,
          {
            key: `${product.barcode}-${Date.now()}`,
            name: product.name,
            grams: 100,
            ...macros,
          },
        ]);
        hapticSuccess();
        setBarcodeInput('');
      } else {
        setScannedProduct(product);
        setMode('result');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      if (msg.includes('404') || msg.includes('not found') || msg.includes('reconnu')) {
        setScanError(`Produit non reconnu pour "${barcode}"`);
        toasts.productNotFound(barcode.trim());
      } else {
        setScanError(msg);
        toasts.error('Erreur de scan', msg);
      }
      if (!keepCamera) setMode('input');
    } finally { setScanLoading(false); }
  }, [setScannedProduct, setScanLoading, setScanError, nutritionMode, mode]);

  const handleDismiss = () => {
    setScannedProduct(null);
    setMode('input');
    setBarcodeInput('');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Totaux du repas, recalculés à chaque changement de portion
  const mealTotals = useMemo(
    () =>
      mealItems.reduce(
        (acc, l) => {
          const f = l.grams / 100;
          return {
            kcal: acc.kcal + l.kcal100 * f,
            prot: acc.prot + l.prot100 * f,
            carb: acc.carb + l.carb100 * f,
            fat: acc.fat + l.fat100 * f,
          };
        },
        { kcal: 0, prot: 0, carb: 0, fat: 0 },
      ),
    [mealItems],
  );

  const handleValidateMeal = () => {
    if (mealItems.length === 0) return;
    hapticSuccess();
    toasts.info(
      'Repas enregistré',
      `${Math.round(mealTotals.prot)} g de protéines • ${Math.round(mealTotals.kcal)} kcal • ${mealItems.length} aliment${mealItems.length > 1 ? 's' : ''}`,
    );
    setMealItems([]);
  };

  return (
    // Bottom sheet : hauteur bornée à 85 vh, contenu défilant et marge basse qui
    // dégage la barre de navigation → le bouton CONFIRMER reste atteignable.
    <div className="flex flex-col min-h-0 max-h-[85vh] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h2 className="font-display text-2xl font-black tracking-wider text-white uppercase mt-0.5">
            {nutritionMode === 'meal' ? (
              <>Composer un <span className="text-accent">repas</span></>
            ) : (
              <>Ajouter au <span className="text-accent">stock</span></>
            )}
          </h2>
        </div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center border border-surface-border/50"
          style={{ boxShadow: isScanLoading ? '0 0 16px #4fc3f730' : undefined }}>
          {isScanLoading ? <Loader2 size={16} className="animate-spin text-accent" /> : <Scan size={16} className="text-text-tertiary" />}
        </div>
      </div>

      {/* Sélecteur de mode : rangement vs composition de repas */}
      <div className="flex items-center gap-1 p-1 mb-3 rounded-2xl bg-white/[0.04] border border-white/10 flex-shrink-0">
        {(['stock', 'meal'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setNutritionMode(m);
              if (m === 'stock') { setMealItems([]); setMode('input'); }
            }}
            className={clsx(
              'flex-1 h-9 rounded-xl font-sans text-[11px] uppercase tracking-wider tap transition-colors',
              nutritionMode === m
                ? 'bg-accent/15 text-accent border border-accent/40'
                : 'text-slate-400 border border-transparent hover:text-slate-200',
            )}
          >
            {m === 'stock' ? 'Ranger au frigo' : 'Composer un repas'}
          </button>
        ))}
      </div>

      <div className={clsx('flex-1 overflow-y-auto space-y-3 min-h-0', nutritionMode === 'meal' ? 'pb-52' : 'pb-24')}>
        {/* Camera scanner */}
        <AnimatePresence>
          {mode === 'camera' && (
            <CameraScanner
              continuous={nutritionMode === 'meal'}
              onDetected={(code) => {
                if (nutritionMode !== 'meal') setMode('input');
                handleScan(code);
              }}
              onClose={() => setMode('input')}
            />
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
                  className="w-full bg-white/5 border border-white/10 rounded-2xl pl-9 pr-12 py-3 font-sans text-sm text-white/90 placeholder-slate-500 focus:outline-none focus:border-accent/60 focus:bg-white/[0.07] transition-colors"
                  style={{ caretColor: '#4fc3f7' }} />
                {barcodeInput && (
                  <button onClick={() => handleScan(barcodeInput)} disabled={isScanLoading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-2 bg-accent/15 border border-accent/40 text-accent rounded-xl font-sans text-[11px] uppercase tracking-wider tap hover:bg-accent/25 transition-colors disabled:opacity-50">
                    Scan
                  </button>
                )}
              </div>

              {/* Camera launch button */}
              <button onClick={() => setMode('camera')}
                className="w-full flex items-center justify-center gap-2.5 h-12 rounded-2xl border border-accent/25 tap group
                           bg-gradient-to-br from-accent/[0.10] to-accent/[0.02] transition-colors"
                style={{ boxShadow: '0 8px 28px rgba(79,195,247,0.10), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
                <Camera size={15} className="text-accent group-hover:scale-110 transition-transform" />
                <span className="font-sans text-[13px] text-accent tracking-[0.18em] uppercase">Démarrer caméra</span>
                <div className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-pulse" />
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
                      className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 font-sans text-[11px]
                                 text-slate-300 hover:text-accent hover:border-accent/40 hover:bg-accent/10
                                 tap transition-colors">
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

        {/* Ajout rapide — aliments frais sans code-barres (Sprint 3) */}
        {nutritionMode === 'stock' && <QuickAddDrawer />}

        {/* Panier repas */}
        {nutritionMode === 'meal' && (
          <div className="space-y-2">
            <div className="label-section">
              REPAS EN COURS {mealItems.length > 0 && `· ${mealItems.length}`}
            </div>
            {mealItems.length === 0 ? (
              <p className="font-sans text-xs text-slate-500 px-1">
                Scanne un produit ou saisis un code : il s'ajoute au repas sans fermer le viseur.
              </p>
            ) : (
              <AnimatePresence initial={false}>
                {mealItems.map((line) => (
                  <MealLineCard
                    key={line.key}
                    line={line}
                    onGrams={(key, grams) =>
                      setMealItems((prev) =>
                        prev.map((l) => (l.key === key ? { ...l, grams } : l)),
                      )
                    }
                    onRemove={(key) =>
                      setMealItems((prev) => prev.filter((l) => l.key !== key))
                    }
                  />
                ))}
              </AnimatePresence>
            )}
          </div>
        )}

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

      {/* Bandeau de synthèse nutritionnelle (mode repas) */}
      <AnimatePresence>
        {nutritionMode === 'meal' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed left-0 right-0 z-30 px-4"
            style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="rounded-2xl border border-white/10 bg-[#020617]/90 backdrop-blur-xl px-4 py-3 shadow-2xl shadow-black/50">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <div className="font-mono text-base font-600 text-white tabular-nums leading-none">
                    {Math.round(mealTotals.kcal)}
                  </div>
                  <div className="label-micro mt-1 !text-[8px]">KCAL</div>
                </div>
                <div>
                  <div className="font-mono text-base font-600 tabular-nums leading-none" style={{ color: '#38bdf8' }}>
                    {Math.round(mealTotals.prot)}
                  </div>
                  <div className="label-micro mt-1 !text-[8px]">PROT.</div>
                </div>
                <div>
                  <div className="font-mono text-base font-600 text-white/90 tabular-nums leading-none">
                    {Math.round(mealTotals.carb)}
                  </div>
                  <div className="label-micro mt-1 !text-[8px]">GLUC.</div>
                </div>
                <div>
                  <div className="font-mono text-base font-600 text-white/90 tabular-nums leading-none">
                    {Math.round(mealTotals.fat)}
                  </div>
                  <div className="label-micro mt-1 !text-[8px]">LIP.</div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setMealItems([])}
                  disabled={mealItems.length === 0}
                  className="flex-1 h-9 rounded-xl border border-white/10 bg-white/5 font-sans text-[11px] uppercase tracking-wider text-slate-300 tap transition-colors hover:text-white disabled:opacity-40"
                >
                  Vider
                </button>
                <button
                  type="button"
                  onClick={handleValidateMeal}
                  disabled={mealItems.length === 0}
                  className="flex-[1.6] h-9 rounded-xl border border-accent/40 bg-accent/15 font-sans text-[11px] uppercase tracking-wider text-accent tap transition-colors hover:bg-accent/25 disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  <Check size={13} />
                  Valider le repas
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}