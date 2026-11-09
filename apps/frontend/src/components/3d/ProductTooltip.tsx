import { useCallback, useState } from 'react'
import { Html } from '@react-three/drei'
import { Check, Loader2, Package2, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/api/client'
import { useFridgeStore, useUIStore } from '@/store'
import { toasts } from '@/components/ui/ToastProvider'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { findItem } from '@/lib/twinItems'
import { hapticSuccess } from '@/lib/haptics'
import type { ZoneItemTwin } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — ProductTooltip / ProductQuickAction
//
// Deux présentations pour une même sélection (`selectedItemId`) :
//   • Desktop (≥ md) : infobulle flottante ancrée au sommet du packaging via
//     drei <Html> + `distanceFactor` — lisible car la caméra est proche.
//   • Mobile (< md)  : carte d'action rapide 2D en bas d'écran (HUD translucide).
//     Le <Html> 3D y subit la distorsion de perspective grand angle (caméra
//     éloignée, fov 42, portrait) et devient illisible/impossible à cadrer.
//
// Les cartes sont du DOM pur (aucune dépendance R3F) → testables hors canvas ;
// seuls les conteneurs (`ProductTooltip` = <Html>, `ProductQuickAction` =
// overlay DOM) touchent à la scène ou à l'écran.
// ─────────────────────────────────────────────────────────────────────────────

/** Couleurs officielles du Nutriscore (A → E). */
const NUTRISCORE_COLORS: Record<string, string> = {
  a: '#1a8a3c',
  b: '#4ead2a',
  c: '#f5b800',
  d: '#e47c00',
  e: '#d32f2f',
}

function formatShortDate(iso: string | null): string | null {
  if (!iso) return null
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}/${month}/${year.slice(2)}`
}

/**
 * Libellé de péremption + couleur : rouge si périmé, ambre si ≤ 3 jours,
 * neutre au-delà.
 */
function expiryInfo(item: ZoneItemTwin): { text: string; className: string } | null {
  const date = formatShortDate(item.expiryDate)
  const days = item.daysUntilExpiry

  if (days === null) {
    return date ? { text: `DLC ${date}`, className: 'text-slate-400' } : null
  }
  if (days < 0) {
    return {
      text: `Périmé${date ? ` · ${date}` : ''}`,
      className: 'text-red-400',
    }
  }
  if (days === 0) {
    return { text: `Expire aujourd'hui${date ? ` · ${date}` : ''}`, className: 'text-amber-400' }
  }
  if (days <= 3) {
    return { text: `J-${days}${date ? ` · ${date}` : ''}`, className: 'text-amber-400' }
  }
  return { text: `J-${days}${date ? ` · ${date}` : ''}`, className: 'text-slate-400' }
}

function NutriscoreBadge({ score, size = 'sm' }: { score: string | null; size?: 'sm' | 'md' }) {
  const nutriscore = score?.toLowerCase() ?? null
  const background = nutriscore ? NUTRISCORE_COLORS[nutriscore] : undefined
  if (!nutriscore || !background) return null

  return (
    <span
      className={clsx(
        'rounded font-bold text-white text-center flex-shrink-0',
        size === 'md' ? 'w-6 h-6 text-[11px] leading-6' : 'w-4 h-4 text-[9px] leading-4',
      )}
      style={{ backgroundColor: background }}
      title={`Nutriscore ${nutriscore.toUpperCase()}`}
    >
      {nutriscore.toUpperCase()}
    </span>
  )
}

function OwnerPill({ item, className }: { item: ZoneItemTwin; className?: string }) {
  return (
    <span className={clsx('flex items-center gap-1 min-w-0', className)}>
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: item.ownerColorHex ?? '#64748b' }}
      />
      <span className="truncate">
        {item.ownerName ?? (item.isShared ? 'Partagé' : 'Sans propriétaire')}
      </span>
    </span>
  )
}

/**
 * Action « Consommer » partagée par les deux présentations.
 * Le refetch de `/fridge/state` fait disparaître le mesh et referme la carte
 * quand le stock tombe à 0 (cf. `setFridgeState` dans le store).
 */
function useConsumeItem(item: ZoneItemTwin | null) {
  const setFridgeState = useFridgeStore((s) => s.setFridgeState)
  const [isConsuming, setIsConsuming] = useState(false)

  const consume = useCallback(async () => {
    if (!item || isConsuming) return
    setIsConsuming(true)
    try {
      // Consommer 1 unité : le backend supprime l'item quand le stock tombe à 0
      await api.consumeItem(item.id, 1)
      hapticSuccess()
      toasts.consumed(item.name, 1, item.unit)
      const fresh = await api.getFridgeState()
      setFridgeState(fresh)
    } catch (err) {
      toasts.error(
        'Consommation impossible',
        err instanceof Error ? err.message : 'Erreur serveur',
      )
    } finally {
      setIsConsuming(false)
    }
  }, [isConsuming, item, setFridgeState])

  return { isConsuming, consume }
}

// ── Carte desktop (compacte, ancrée au packaging) ─────────────────────────────

export interface ProductTooltipCardProps {
  item: ZoneItemTwin
  isConsuming: boolean
  onConsume: () => void
  onDismiss: () => void
}

export function ProductTooltipCard({ item, isConsuming, onConsume, onDismiss }: ProductTooltipCardProps) {
  const expiry = expiryInfo(item)

  return (
    <div
      className="w-[210px] rounded-2xl border border-white/10 bg-slate-900/70
                 backdrop-blur-2xl backdrop-saturate-150
                 px-3 py-2.5 shadow-glass-lg font-sans select-none"
      role="dialog"
      aria-label={`Produit ${item.name}`}
    >
      {/* En-tête : nom + fermeture */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] leading-tight text-white/95 truncate" title={item.name}>
            {item.name}
          </div>
          {item.brand && (
            <div className="text-[10px] leading-tight text-slate-400 truncate">{item.brand}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer l'infobulle"
          className="-mt-0.5 -mr-1 w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full
                     tap text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Nutriscore · propriétaire · quantité */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <NutriscoreBadge score={item.nutriscore} />
        <OwnerPill item={item} className="text-[10px] text-slate-300" />
        <span className="text-[10px] text-slate-400/80 ml-auto flex-shrink-0 tabular-nums">
          ×{Number(item.quantity.toFixed(2))} {item.unit}
        </span>
      </div>

      {expiry && <div className={clsx('text-[10px] mt-1 truncate tabular-nums', expiry.className)}>{expiry.text}</div>}

      {/* Action rapide */}
      <button
        type="button"
        onClick={onConsume}
        disabled={isConsuming}
        className={clsx(
          'mt-2 w-full py-2 rounded-xl border flex items-center justify-center gap-1.5',
          'text-[10px] tracking-wider uppercase tap ease-ios',
          isConsuming
            ? 'border-white/10 bg-white/5 text-slate-500 cursor-wait'
            : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20',
        )}
      >
        {isConsuming ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        {isConsuming ? 'Consommation…' : 'Consommer'}
      </button>
    </div>
  )
}

// ── Carte mobile (action rapide HUD, bas d'écran) ────────────────────────────

export interface ProductQuickActionCardProps {
  item: ZoneItemTwin
  isConsuming: boolean
  onConsume: () => void
  onDismiss: () => void
}

export function ProductQuickActionCard({ item, isConsuming, onConsume, onDismiss }: ProductQuickActionCardProps) {
  const expiry = expiryInfo(item)

  return (
    <div
      className="rounded-[22px] border border-white/10 bg-slate-900/60
                 backdrop-blur-2xl backdrop-saturate-150
                 px-3.5 py-3 shadow-glass-lg font-sans"
      role="dialog"
      aria-label={`Actions rapides ${item.name}`}
    >
      <div className="flex items-start gap-3">
        {/* Photo produit (fallback icône si image OFF absente / CORS) */}
        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-contain p-1" />
          ) : (
            <Package2 size={18} className="text-slate-500" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-tight text-white/95 truncate" title={item.name}>
            {item.name}
          </div>
          {item.brand && (
            <div className="text-[11px] leading-tight text-slate-400 truncate mt-0.5">{item.brand}</div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <NutriscoreBadge score={item.nutriscore} size="md" />
            <OwnerPill item={item} className="text-[11px] text-slate-300" />
            <span className="text-[11px] text-slate-400/80 ml-auto flex-shrink-0 tabular-nums">
              ×{Number(item.quantity.toFixed(2))} {item.unit}
            </span>
          </div>
          {expiry && <div className={clsx('text-[11px] mt-0.5 truncate tabular-nums', expiry.className)}>{expiry.text}</div>}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer l'infobulle"
          className="-mt-1 -mr-1 w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full
                     tap text-slate-400 hover:text-white active:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <button
        type="button"
        onClick={onConsume}
        disabled={isConsuming}
        className={clsx(
          'mt-3 w-full h-11 rounded-2xl border flex items-center justify-center gap-2',
          'text-[11px] tracking-widest uppercase tap ease-ios',
          isConsuming
            ? 'border-white/10 bg-white/5 text-slate-500 cursor-wait'
            : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300 active:bg-emerald-400/20',
        )}
      >
        {isConsuming ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        {isConsuming ? 'Consommation…' : 'Consommer'}
      </button>
    </div>
  )
}

// ── Ancrage 3D (desktop uniquement) ──────────────────────────────────────────

export interface ProductTooltipProps {
  item: ZoneItemTwin
  /** Position de l'ancre dans le repère du produit (sommet du packaging) */
  position: [number, number, number]
}

export function ProductTooltip({ item, position }: ProductTooltipProps) {
  const isDesktop = useIsDesktop()
  const setSelectedItemId = useUIStore((s) => s.setSelectedItemId)
  const { isConsuming, consume } = useConsumeItem(item)

  const handleDismiss = useCallback(() => setSelectedItemId(null), [setSelectedItemId])

  // Sur mobile, `ProductQuickAction` prend le relais en 2D : pas de <Html> 3D
  if (!isDesktop) return null

  return (
    // Pas de `distanceFactor` : depuis le zoom objet (0.4 m), une carte mise à
    // l'échelle par la distance deviendrait énorme. Taille écran constante.
    <Html position={position} center zIndexRange={[100, 0]} style={{ pointerEvents: 'auto' }}>
      {/* Les événements souris/tactiles ne doivent pas atteindre le canvas
          (sinon OrbitControls démarre une rotation au clic sur le bouton). */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <ProductTooltipCard
          item={item}
          isConsuming={isConsuming}
          onConsume={() => void consume()}
          onDismiss={handleDismiss}
        />
      </div>
    </Html>
  )
}

// ── Overlay 2D (mobile) ──────────────────────────────────────────────────────

/**
 * Carte d'action rapide mobile, ancrée juste au-dessus de la barre de
 * navigation. Rendue hors du canvas : aucun conflit avec OrbitControls et
 * aucune distorsion de perspective.
 */
export function ProductQuickAction() {
  const isDesktop = useIsDesktop()
  const setSelectedItemId = useUIStore((s) => s.setSelectedItemId)
  const item = useUIStore((s) => findItem(s.fridgeState, s.selectedItemId))
  const { isConsuming, consume } = useConsumeItem(item)

  const handleDismiss = useCallback(() => setSelectedItemId(null), [setSelectedItemId])

  if (isDesktop || !item) return null

  return (
    <div className="absolute inset-x-4 bottom-20 z-40 pointer-events-auto">
      <ProductQuickActionCard
        item={item}
        isConsuming={isConsuming}
        onConsume={() => void consume()}
        onDismiss={handleDismiss}
      />
    </div>
  )
}