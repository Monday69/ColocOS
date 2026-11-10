import { useCallback, useEffect, useState } from 'react';
import { Camera, Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react';
import { useZoneDetail } from '@/hooks/useZoneDetail';
import { HEALTH_COLORS } from '@/lib/healthColors';
import { hapticSuccess } from '@/lib/haptics';
import { api } from '@/api/client';
import { useFridgeStore, useUIStore } from '@/store';
import { toasts } from '@/components/ui/ToastProvider';
import { BarcodeScannerModal } from '@/components/ui/BarcodeScannerModal';
import type {
  AddToInventoryPayload,
  AuthUser,
  ProductLookup,
  ZoneDetail,
  ZoneItemDetail,
} from '@/types';
import clsx from 'clsx';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Zone Detail Panel
// Panneau latéral droit — glisse au clic sur une zone 3D
//
// Chaque item expose deux actions de consommation :
//   −  : consomme une portion (1 pour les unités, 100 g/ml, 0.1 kg/L)
//   🗑 : consomme la totalité du stock restant (déclenche le réappro auto
//        côté backend si l'item est partagé)
// Après succès : refetch /fridge/state + détail de la zone → couleurs et
// compteurs des meshes 3D mis à jour immédiatement.
// ─────────────────────────────────────────────────────────────────────────────

function NutriScoreBadge({ score }: { score: string | null }) {
  if (!score) return null;
  const colors: Record<string, string> = {
    A: 'bg-green-600',
    B: 'bg-lime-600',
    C: 'bg-yellow-600',
    D: 'bg-orange-600',
    E: 'bg-red-700',
  };
  return (
    <span
      className={clsx(
        'font-mono text-2xs font-500 px-1 py-0.5 rounded text-white',
        colors[score] ?? 'bg-surface-3',
      )}
    >
      {score}
    </span>
  );
}

function ExpiryBadge({ days }: { days: number | null }) {
  if (days === null) return null;

  const label =
    days < 0
      ? `PÉRIMÉ`
      : days === 0
      ? `AUJOURD'HUI`
      : `J+${days}`;

  const color =
    days < 0 ? HEALTH_COLORS.critical : days <= 2 ? HEALTH_COLORS.critical : days <= 7 ? HEALTH_COLORS.warning : '#5a5d6e';

  return (
    <span className="font-mono text-2xs px-1.5 py-0.5 rounded" style={{ color, border: `1px solid ${color}40` }}>
      {label}
    </span>
  );
}

/** Portion consommée par le bouton rapide −, exprimée dans l'unité de l'item. */
function consumePortion(item: ZoneItemDetail): number {
  switch (item.unit) {
    case 'kg':
    case 'L':
      return 0.1;
    case 'g':
    case 'ml':
      return 100;
    case 'unit':
    default:
      return 1;
  }
}

function ItemRow({
  item,
  isConsuming,
  isDeleting,
  onConsume,
  onDelete,
}: {
  item: ZoneItemDetail;
  isConsuming: boolean;
  isDeleting: boolean;
  onConsume: (item: ZoneItemDetail, quantity: number) => void;
  onDelete: (item: ZoneItemDetail) => void;
}) {
  // Confirmation rapide (3 s) avant suppression définitive
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <div className="flex items-start gap-2 py-2 border-b border-surface-border/50 last:border-0">
      {/* Owner color dot */}
      <div
        className="status-dot mt-1.5 flex-shrink-0"
        style={{ backgroundColor: item.owner?.colorHex ?? '#3a3d45' }}
        title={item.owner?.name ?? 'Partagé'}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-body text-sm text-text-primary truncate">{item.name}</span>
          <NutriScoreBadge score={item.nutriscore} />
          {!item.isShared && (
            <span className="font-mono text-2xs text-text-tertiary">PRIVÉ</span>
          )}
        </div>
        {item.brand && (
          <span className="font-body text-2xs text-text-tertiary">{item.brand}</span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="font-mono text-xs text-text-mono whitespace-nowrap">
          {item.quantity} {item.unit}
        </span>
        <ExpiryBadge days={item.daysUntilExpiry} />
      </div>

      {/* Actions de consommation / suppression */}
      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
        {isConsuming || isDeleting ? (
          <div className="w-12 h-6 flex items-center justify-center">
            <Loader2 size={12} className="animate-spin text-text-tertiary" />
          </div>
        ) : confirming ? (
          <button
            onClick={() => {
              setConfirming(false);
              onDelete(item);
            }}
            title="Confirmer la suppression"
            aria-label={`Confirmer la suppression de ${item.name}`}
            className="h-6 px-1.5 rounded border border-health-critical/60 bg-health-critical/15 flex items-center justify-center
                       text-health-critical font-mono text-2xs hover:bg-health-critical/25 tap transition-all duration-150"
          >
            SUPPR. ?
          </button>
        ) : (
          <>
            <button
              onClick={() => onConsume(item, Math.min(consumePortion(item), item.quantity))}
              title="Consommer une portion"
              aria-label={`Consommer une portion de ${item.name}`}
              className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center
                         text-slate-400 tap hover:text-accent hover:border-accent/50 hover:bg-accent/10
                         transition-colors duration-150"
            >
              <Minus size={11} />
            </button>
            <button
              onClick={() => setConfirming(true)}
              title="Marquer comme consommé (supprimer)"
              aria-label={`Marquer ${item.name} comme consommé`}
              className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center
                         text-slate-400 tap hover:text-health-critical hover:border-health-critical/50
                         hover:bg-health-critical/10 transition-colors duration-150"
            >
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddProductForm — scan/saisie code-barres + enrichissement OpenFoodFacts
// ─────────────────────────────────────────────────────────────────────────────

const INPUT_CLS =
  'w-full bg-surface-3 border border-surface-border rounded-lg px-2.5 py-2 font-mono text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent transition-colors';

function AddProductForm({ zone, onDone }: { zone: ZoneDetail; onDone: () => void }) {
  const { setFridgeState } = useFridgeStore();
  const { openZone } = useZoneDetail();

  const [barcode, setBarcode] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [product, setProduct] = useState<ProductLookup | null>(null);
  const [name, setName] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [roommates, setRoommates] = useState<AuthUser[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getRoommates()
      .then((list) => { if (!cancelled) setRoommates(list); })
      .catch(() => { /* le sélecteur restera sur « Moi » */ });
    return () => { cancelled = true; };
  }, []);

  const lookupBarcode = useCallback(async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    setIsLookingUp(true);
    setError(null);
    try {
      const found = await api.lookupProduct(code);
      setProduct(found);
      setName(found.name);
      setBarcode(found.barcode);
    } catch (err) {
      setProduct(null);
      setError(err instanceof Error ? err.message : 'Produit introuvable');
    } finally {
      setIsLookingUp(false);
    }
  }, []);

  const handleLookup = () => { void lookupBarcode(barcode); };

  // Code lu par la caméra → injecté dans le champ + lookup OFF immédiat
  const handleScanSuccess = useCallback(
    (code: string) => {
      setShowScanner(false);
      setBarcode(code);
      void lookupBarcode(code);
    },
    [lookupBarcode],
  );

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Le nom du produit est requis.');
      return;
    }

    const payload: AddToInventoryPayload = {
      barcode: barcode.trim() || undefined,
      name: trimmedName,
      brand: product?.brand ?? null,
      imageUrl: product?.imageUrl ?? null,
      nutriscore: product?.nutriscore ?? null,
      quantity: 1,
      unit: 'unit',
      storageZoneId: zone.id,
      expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null,
      isShared,
      ownerId: ownerId || null,
    };

    setIsSubmitting(true);
    setError(null);
    try {
      await api.addToInventory(payload);
      toasts.addItem(trimmedName);

      // Rafraîchit l'état 3D global + le détail de la zone ouverte
      const [freshState] = await Promise.all([
        api.getFridgeState(),
        openZone(zone.meshId),
      ]);
      setFridgeState(freshState);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'ajout");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2.5 p-3 mb-3 rounded-xl border border-accent/25 bg-accent/[0.03]">
      {/* Code-barres + recherche */}
      <div className="flex gap-2">
        <input
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleLookup(); }}
          placeholder="Code-barres (EAN-13)…"
          inputMode="numeric"
          className={INPUT_CLS}
        />
        <button
          onClick={() => setShowScanner(true)}
          title="Scanner avec la caméra"
          aria-label="Scanner avec la caméra"
          className="flex items-center justify-center w-9 rounded-lg border border-accent/40 bg-accent/10
                     text-accent hover:bg-accent/20 transition-all flex-shrink-0"
        >
          <Camera size={14} />
        </button>
        <button
          onClick={handleLookup}
          disabled={isLookingUp || !barcode.trim()}
          className="flex items-center gap-1.5 px-3 rounded-lg border border-accent/40 bg-accent/10 text-accent
                     font-mono text-2xs hover:bg-accent/20 transition-all disabled:opacity-40 flex-shrink-0"
        >
          {isLookingUp ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          RECHERCHER
        </button>
      </div>

      {/* Aperçu OpenFoodFacts */}
      {product && (
        <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-2/60 border border-surface-border/50">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-10 h-10 object-contain rounded bg-white/90 flex-shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-10 h-10 rounded bg-surface-3 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-body text-xs text-text-primary truncate">{product.name}</div>
            <div className="font-mono text-2xs text-text-tertiary">
              {[product.brand, product.category].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
          {product.nutriscore && (
            <span className="ml-auto font-mono text-2xs px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary border border-surface-border/60">
              NUTRI {product.nutriscore}
            </span>
          )}
        </div>
      )}

      {/* Nom éditable */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom du produit"
        className={INPUT_CLS}
      />

      {/* Péremption + propriétaire */}
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className={INPUT_CLS}
          title="Date de péremption"
        />
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className={INPUT_CLS}
          title="Propriétaire"
        >
          <option value="">Moi</option>
          {roommates.map((user) => (
            <option key={user.id} value={user.id}>{user.name}</option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 font-mono text-2xs text-text-tertiary cursor-pointer">
        <input
          type="checkbox"
          checked={isShared}
          onChange={(e) => setIsShared(e.target.checked)}
          className="accent-[#4fc3f7]"
        />
        PARTAGÉ AVEC LA COLOC
      </label>

      {error && (
        <div className="font-mono text-2xs text-health-warning">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-health-ok/40
                     bg-health-ok/10 text-health-ok font-mono text-2xs hover:bg-health-ok/20 transition-all disabled:opacity-40"
        >
          {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          VALIDER
        </button>
        <button
          onClick={onDone}
          className="px-3 py-2 rounded-lg border border-surface-border/60 text-text-tertiary font-mono text-2xs hover:text-text-primary transition-colors"
        >
          ANNULER
        </button>
      </div>

      {/* Viseur caméra — rendu en portail (hors du panneau transformé) */}
      {showScanner && (
        <BarcodeScannerModal
          onScanSuccess={handleScanSuccess}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}

export function ZoneDetailPanel() {
  const { zoneDetail, isPanelOpen, isDetailLoading, closePanel, openZone } = useZoneDetail();
  const { setFridgeState } = useFridgeStore();
  const setZoneDetail = useUIStore((s) => s.setZoneDetail);
  const [consumingId, setConsumingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Réinitialise le formulaire quand on change de zone (ou fermeture du panneau)
  useEffect(() => { setShowAddForm(false); }, [zoneDetail?.meshId]);

  const handleConsume = useCallback(
    async (item: ZoneItemDetail, requestedQuantity: number) => {
      if (consumingId) return;

      const quantity = Math.min(requestedQuantity, item.quantity);
      if (!(quantity > 0)) return;

      setConsumingId(item.id);
      try {
        await api.consumeItem(item.id, quantity);
        hapticSuccess();
        toasts.consumed(item.name, quantity, item.unit);

        // Refetch parallèle : état 3D (couleurs/compteurs) + détail du panneau
        const meshId = zoneDetail?.meshId;
        const [freshState, freshDetail] = await Promise.all([
          api.getFridgeState(),
          meshId ? api.getZoneDetail(meshId).catch(() => null) : Promise.resolve(null),
        ]);

        setFridgeState(freshState);
        if (freshDetail) {
          setZoneDetail(freshDetail);
        } else if (zoneDetail) {
          // Fallback local : retire l'item (épuisé → supprimé côté serveur)
          const exhausted = quantity >= item.quantity;
          setZoneDetail({
            ...zoneDetail,
            items: exhausted
              ? zoneDetail.items.filter((i) => i.id !== item.id)
              : zoneDetail.items.map((i) =>
                  i.id === item.id ? { ...i, quantity: i.quantity - quantity } : i,
                ),
            itemCount: exhausted ? Math.max(0, zoneDetail.itemCount - 1) : zoneDetail.itemCount,
          });
        }
      } catch (err) {
        toasts.error(
          'Consommation impossible',
          err instanceof Error ? err.message : 'Erreur serveur',
        );
      } finally {
        setConsumingId(null);
      }
    },
    [consumingId, zoneDetail, setFridgeState, setZoneDetail],
  );

  /**
   * Suppression définitive (bouton « marquer comme consommé »).
   * DELETE /inventory/items/:id → refetch zone + état 3D.
   */
  const handleDelete = useCallback(
    async (item: ZoneItemDetail) => {
      if (deletingId || consumingId) return;

      const meshId = zoneDetail?.meshId;
      setDeletingId(item.id);
      try {
        await api.deleteItem(item.id);
        hapticSuccess();
        toasts.consumed(item.name, item.quantity, item.unit);

        // Rafraîchissement synchrone : panneau (openZone) + frigo 3D
        const [freshState] = await Promise.all([
          api.getFridgeState(),
          meshId ? openZone(meshId) : Promise.resolve(),
        ]);
        setFridgeState(freshState);
      } catch (err) {
        toasts.error(
          'Suppression impossible',
          err instanceof Error ? err.message : 'Erreur serveur',
        );
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId, consumingId, zoneDetail, openZone, setFridgeState],
  );

  const healthColor = zoneDetail
    ? HEALTH_COLORS[zoneDetail.healthStatus]
    : '#3a3d45';

  return (
    <>
      {/* Panneau — Bottom Sheet sur mobile, panneau latéral sur desktop.
          Pas de backdrop plein écran : la scène 3D reste cliquable au-dessus du
          tiroir (fermeture : ✕, Échap ou bouton "Vue d'ensemble"). */}
      <div
        className={clsx(
          // Mobile : tiroir bas pleine largeur, limité à 80vh
          'fixed inset-x-0 bottom-0 w-full z-30 pointer-events-auto',
          // Desktop : panneau latéral droit fixe
          'md:absolute md:inset-x-auto md:top-0 md:right-0 md:bottom-auto md:h-full md:w-80',
          // Courbe iOS (cubic-bezier(0.32, 0.72, 0, 1)) — sortie douce, sans rebond
          'transition-transform duration-400 ease-ios',
          isPanelOpen
            ? 'translate-y-0 md:translate-x-0'
            : 'translate-y-full md:translate-y-0 md:translate-x-full',
        )}
      >
        <div
          className="glass-sheet flex flex-col max-h-[38vh] md:max-h-none md:h-full
                     rounded-t-[28px] md:rounded-t-none md:rounded-l-[20px]
                     md:border-l md:border-t-0 overflow-hidden"
        >
          {/* Poignée de préhension (mobile uniquement) */}
          <div className="md:hidden h-1.5 w-12 rounded-full bg-slate-600 mx-auto my-2 flex-shrink-0" />

          {/* Header */}
          <div
            className="px-4 py-3 border-b border-surface-border flex items-center justify-between"
            style={{ borderLeftColor: healthColor, borderLeftWidth: 3 }}
          >
            <div>
              <div className="label-section">ZONE SÉLECTIONNÉE</div>
              <h2 className="font-display text-lg font-600 text-text-primary mt-0.5">
                {zoneDetail?.label ?? '—'}
              </h2>
            </div>
            <button
              onClick={closePanel}
              className="text-text-tertiary hover:text-text-primary transition-colors p-1"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Metrics row */}
          {zoneDetail && (
            <div className="px-4 py-2.5 border-b border-white/10 flex gap-4">
              <div>
                <div className="font-mono text-lg font-medium tabular-nums" style={{ color: healthColor }}>
                  {zoneDetail.itemCount}
                </div>
                <div className="label-micro !text-[9px]">Items</div>
              </div>
              <div>
                <div className="font-mono text-lg font-medium text-text-primary tabular-nums">
                  {Math.round(zoneDetail.fillRatio * 100)}%
                </div>
                <div className="label-micro !text-[9px]">Rempli</div>
              </div>
              <div>
                <div className="font-mono text-lg font-medium tabular-nums" style={{ color: healthColor }}>
                  {zoneDetail.nextExpiryDays !== null ? `J+${zoneDetail.nextExpiryDays}` : '—'}
                </div>
                <div className="label-micro !text-[9px]">Prochain exp.</div>
              </div>
              {/* Owner colors */}
              <div className="ml-auto flex flex-col items-end">
                <div className="flex gap-1 mt-0.5">
                  {zoneDetail.ownerColors.map((c) => (
                    <div
                      key={c}
                      className="w-3 h-3 rounded-full ring-1 ring-white/20"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="label-micro !text-[9px] mt-1">Proprio</div>
              </div>
            </div>
          )}

          {/* Items list */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 pb-8 md:pb-3">
            {/* Ajout de produit */}
            {zoneDetail && (
              <div className="mb-3">
                <button
                  onClick={() => setShowAddForm((v) => !v)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-accent/30
                             bg-accent/[0.06] text-accent font-mono text-2xs hover:bg-accent/15 transition-all"
                >
                  <Plus size={12} />
                  AJOUTER UN PRODUIT
                </button>
                {showAddForm && (
                  <div className="mt-2.5">
                    <AddProductForm zone={zoneDetail} onDone={() => setShowAddForm(false)} />
                  </div>
                )}
              </div>
            )}

            {isDetailLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="font-mono text-sm text-text-tertiary animate-pulse">
                  CHARGEMENT...
                </div>
              </div>
            ) : zoneDetail?.items.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="font-display text-4xl text-surface-border mb-2">∅</div>
                  <div className="font-mono text-xs text-text-tertiary">ZONE VIDE</div>
                </div>
              </div>
            ) : (
              <div>
                <div className="label-section mb-2">CONTENU</div>
                {zoneDetail?.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    isConsuming={consumingId === item.id}
                    isDeleting={deletingId === item.id}
                    onConsume={handleConsume}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer — mesh ID for debug */}
          {zoneDetail && (
            <div className="px-4 py-2 border-t border-surface-border">
              <span className="badge-mono">{zoneDetail.meshId}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
