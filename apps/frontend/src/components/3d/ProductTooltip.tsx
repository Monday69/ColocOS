import { useCallback, useState } from 'react'
import { Html } from '@react-three/drei'
import { Package2, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/api/client'
import { useFridgeStore, useUIStore } from '@/store'
import { toasts } from '@/components/ui/ToastProvider'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { findItem } from '@/lib/twinItems'
import { hapticSuccess, hapticTap } from '@/lib/haptics'
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

/** Couleurs NOVA (1 = brut → 4 = ultra-transformé). */
const NOVA_COLORS: Record<number, string> = {
  1: '#00e676',
  2: '#a3e635',
  3: '#f59e0b',
  4: '#ef4444',
}

/** Pastille NOVA — rien si le groupe est inconnu. */
function NovaBadge({ group }: { group: number | null }) {
  if (group === null || group === undefined) return null
  const color = NOVA_COLORS[group]
  if (!color) return null

  return (
    <span
      className="px-1 py-[1px] rounded text-[8px] font-mono leading-[10px] tracking-wide flex-shrink-0"
      style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}55` }}
      title={`NOVA ${group} — ${
        group === 1 ? 'non transformé' : group === 2 ? 'ingrédient culinaire' : group === 3 ? 'transformé' : 'ultra-transformé'
      }`}
    >
      NOVA {group}
    </span>
  )
}

/**
 * Mini-grille Liquid Glass des macros (pour 100 g / 100 ml).
 * Rien n'est rendu tant qu'Open Food Facts n'a fourni aucune valeur.
 */
function MacroGrid({ item }: { item: ZoneItemTwin }) {
  const metrics = [
    { label: 'kcal', value: item.calories },
    { label: 'Prot.', value: item.proteins },
    { label: 'Gluc.', value: item.carbohydrates },
    { label: 'Lip.', value: item.fat },
  ]

  if (!metrics.some((metric) => metric.value !== null && metric.value !== undefined)) return null

  return (
    <div className="mt-1.5">
      <div className="grid grid-cols-4 gap-1">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg bg-white/[0.04] border border-white/10 px-1 py-1 text-center"
          >
            <div className="font-mono text-[11px] leading-none text-white/90 tabular-nums">
              {metric.value === null || metric.value === undefined ? '—' : Math.round(metric.value)}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-slate-400/80 mt-[3px]">
              {metric.label}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[8px] text-slate-500 mt-1 text-right">pour 100 g</div>
    </div>
  )
}

/**
 * Action « Consommer » partagée par les deux présentations.
 * Le refetch de `/fridge/state` fait disparaître le mesh et referme la carte
 * quand le stock tombe à 0 (cf. `setFridgeState` dans le store).
 */
function useConsumeItem(item: ZoneItemTwin | null) {
  const setFridgeState = useFridgeStore((s) => s.setFridgeState)
  const setSelectedItemId = useUIStore((s) => s.setSelectedItemId)
  const [isConsuming, setIsConsuming] = useState(false)

  /**
   * Consommation progressive (Sprint 2). Le backend renvoie la quantité
   * restante ; on rafraîchit le twin (sans rechargement ni clignotement) et on
   * referme la fiche quand l'article est terminé (soft-delete côté API).
   */
  const consumeAmount = useCallback(
    async (amount: number) => {
      if (!item || isConsuming || !Number.isFinite(amount) || amount <= 0) return
      setIsConsuming(true)
      try {
        const result = await api.consumeItemPart(item.id, amount)
        toasts.consumed(item.name, amount, item.unit)

        const fresh = await api.getFridgeState()
        setFridgeState(fresh)

        if (result.isFullyConsumed) {
          hapticSuccess()
          setSelectedItemId(null)
        } else {
          hapticTap()
        }
      } catch (err) {
        toasts.error(
          'Consommation impossible',
          err instanceof Error ? err.message : 'Erreur serveur',
        )
      } finally {
        setIsConsuming(false)
      }
    },
    [isConsuming, item, setFridgeState, setSelectedItemId],
  )

  const consume = useCallback(() => consumeAmount(1), [consumeAmount])

  return { isConsuming, consume, consumeAmount }
}

// ── Jauge de niveau (Sprint 2) ───────────────────────────────────────────────

/** Libellé court d'unité : `unit` = une dose. */
const UNIT_LABEL: Record<string, string> = {
  unit: 'dose',
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  L: 'L',
}

/** ratio = clamp(currentQuantity / initialQuantity, 0, 1) */
function quantityRatio(item: ZoneItemTwin): number {
  const initial = item.initialQuantity > 0 ? item.initialQuantity : 1
  return Math.min(1, Math.max(0, item.quantity / initial))
}

function gaugeColor(percent: number): string {
  if (percent > 50) return '#00e676'
  if (percent >= 20) return '#f59e0b'
  return '#ef4444'
}

export interface QuantityGaugeProps {
  item: ZoneItemTwin
  isConsuming: boolean
  onConsumeAmount: (amount: number) => void
  compact?: boolean
}

/**
 * Jauge Liquid Glass + décrément rapide : −25 %, −1 dose, Finir.
 * Les montants dérivent de `initialQuantity` (pas de la quantité courante)
 * pour que −25 % reste 25 % du contenant d'origine.
 */
export function QuantityGauge({ item, isConsuming, onConsumeAmount, compact }: QuantityGaugeProps) {
  const ratio = quantityRatio(item)
  const percent = Math.round(ratio * 100)
  const color = gaugeColor(percent)

  const remaining = Number(item.quantity.toFixed(2))
  const initial = Number(item.initialQuantity.toFixed(2))
  const quarter = Math.round(item.initialQuantity * 25) / 100
  const unitLabel = UNIT_LABEL[item.unit] ?? item.unit

  const buttonClass = clsx(
    'rounded-lg border border-white/10 bg-white/[0.04] text-slate-300',
    'font-mono tabular-nums transition-all tap active:scale-95',
    'hover:border-white/25 hover:text-white disabled:opacity-40',
    compact ? 'h-9 text-[10px]' : 'h-7 text-[9px]',
  )

  return (
    <div className={compact ? 'mt-3' : 'mt-2'}>
      <div className="flex items-baseline justify-between font-mono text-[9px] tabular-nums">
        <span className="text-slate-400">
          {remaining} / {initial} {item.unit}
        </span>
        <span style={{ color }}>{percent}% restant</span>
      </div>

      <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%`, background: color, boxShadow: `0 0 8px ${color}80` }}
        />
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => onConsumeAmount(quarter)}
          disabled={isConsuming || remaining <= 0}
          aria-label={`Consommer 25 % (${quarter} ${item.unit})`}
          className={buttonClass}
        >
          −25%
        </button>
        <button
          type="button"
          onClick={() => onConsumeAmount(1)}
          disabled={isConsuming || remaining <= 0}
          aria-label={`Consommer 1 ${unitLabel}`}
          className={buttonClass}
        >
          −1 {unitLabel}
        </button>
        <button
          type="button"
          onClick={() => onConsumeAmount(remaining)}
          disabled={isConsuming || remaining <= 0}
          aria-label="Terminer l'article"
          className={clsx(
            buttonClass,
            'border-amber-400/30 text-amber-300 hover:border-amber-400/60 hover:text-amber-200',
          )}
        >
          Finir
        </button>
      </div>
    </div>
  )
}

// ── Carte desktop (compacte, ancrée au packaging) ─────────────────────────────

export interface ProductTooltipCardProps {
  item: ZoneItemTwin
  isConsuming: boolean
  onConsumeAmount: (amount: number) => void
  onDismiss: () => void
}

export function ProductTooltipCard({ item, isConsuming, onConsumeAmount, onDismiss }: ProductTooltipCardProps) {
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
        <NovaBadge group={item.novaGroup} />
        <OwnerPill item={item} className="text-[10px] text-slate-300" />
        <span className="text-[10px] text-slate-400/80 ml-auto flex-shrink-0 tabular-nums">
          ×{Number(item.quantity.toFixed(2))} {item.unit}
        </span>
      </div>

      {expiry && <div className={clsx('text-[10px] mt-1 truncate tabular-nums', expiry.className)}>{expiry.text}</div>}

      <MacroGrid item={item} />

      {/* Jauge de niveau + décrément rapide (Sprint 2) */}
      <QuantityGauge item={item} isConsuming={isConsuming} onConsumeAmount={onConsumeAmount} />
    </div>
  )
}

// ── Carte mobile (action rapide HUD, bas d'écran) ────────────────────────────

export interface ProductQuickActionCardProps {
  item: ZoneItemTwin
  isConsuming: boolean
  onConsumeAmount: (amount: number) => void
  onDismiss: () => void
}

export function ProductQuickActionCard({ item, isConsuming, onConsumeAmount, onDismiss }: ProductQuickActionCardProps) {
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
            <NovaBadge group={item.novaGroup} />
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

      <MacroGrid item={item} />

      <QuantityGauge item={item} isConsuming={isConsuming} onConsumeAmount={onConsumeAmount} compact />
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
  const { isConsuming, consumeAmount } = useConsumeItem(item)

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
          onConsumeAmount={(amount) => void consumeAmount(amount)}
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
  const { isConsuming, consumeAmount } = useConsumeItem(item)

  const handleDismiss = useCallback(() => setSelectedItemId(null), [setSelectedItemId])

  if (isDesktop || !item) return null

  return (
    <div className="absolute inset-x-4 bottom-20 z-40 pointer-events-auto">
      <ProductQuickActionCard
        item={item}
        isConsuming={isConsuming}
        onConsumeAmount={(amount) => void consumeAmount(amount)}
        onDismiss={handleDismiss}
      />
    </div>
  )
}