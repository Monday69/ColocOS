import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  Loader2,
  Minus,
  Plus,
  ShoppingBasket,
  Users,
  User,
} from 'lucide-react'
import { api } from '@/api/client'
import { useFridgeStore } from '@/store'
import { hapticSuccess, hapticTap } from '@/lib/haptics'
import { toasts } from '@/components/ui/ToastProvider'
import type { FreshCategoryId, FreshPreset } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `J+n` → date locale `YYYY-MM-DD` (repli si l'API n'a rien fourni). */
function isoToday(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function addDaysIso(iso: string, days: number): string {
  const base = new Date(`${iso}T12:00:00`)
  base.setDate(base.getDate() + days)
  const month = `${base.getMonth() + 1}`.padStart(2, '0')
  const day = `${base.getDate()}`.padStart(2, '0')
  return `${base.getFullYear()}-${month}-${day}`
}

/** Unité affichable : `unit` = une pièce. */
function unitWord(unit: string, quantity: number): string {
  if (unit === 'unit') return quantity > 1 ? 'pièces' : 'pièce'
  return unit
}

/** Extrait `« 2 pavés de saumon »` → { quantity: 2, label: 'pavés de saumon' }. */
function parseQuery(raw: string): { quantity: number | null; label: string } {
  const match = raw.match(/^\s*(\d+)\s*(?:x\s*)?(.+)$/)
  if (!match) return { quantity: null, label: raw.trim() }
  const quantity = Number.parseInt(match[1], 10)
  return {
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 999) : null,
    label: match[2].trim(),
  }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function matches(preset: FreshPreset, label: string): boolean {
  const needle = normalize(label)
  if (!needle) return true
  return [preset.name, ...preset.keywords].some((value) => normalize(value).includes(needle))
}

// ── Tuile ─────────────────────────────────────────────────────────────────────

interface TileProps {
  preset: FreshPreset
  onSelect: (preset: FreshPreset) => void
}

function PresetTile({ preset, onSelect }: TileProps) {
  return (
    <button
      type="button"
      onClick={() => {
        hapticTap()
        onSelect(preset)
      }}
      className="group relative flex items-center gap-2.5 p-2.5 rounded-2xl border border-white/10
                 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07] tap text-left transition-colors"
    >
      <span className="text-xl leading-none select-none">{preset.emoji}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-sans text-[12px] text-white/90 truncate">{preset.name}</span>
        <span className="flex items-center gap-1 font-mono text-[9px] tabular-nums">
          <span style={{ color: '#7dd3a0' }}>{preset.shelfLifeLabel}</span>
          <span className="text-slate-500">
            · {preset.defaultQty} {unitWord(preset.unit, preset.defaultQty)}
          </span>
        </span>
      </span>
    </button>
  )
}

// ── Feuille de confirmation ───────────────────────────────────────────────────

interface ConfirmSheetProps {
  preset: FreshPreset
  initialQuantity: number
  onCancel: () => void
  onConfirm: (payload: { quantity: number; isShared: boolean; expiryDate: string }) => Promise<void>
}

function ConfirmSheet({ preset, initialQuantity, onCancel, onConfirm }: ConfirmSheetProps) {
  const [quantity, setQuantity] = useState(initialQuantity)
  const [isShared, setIsShared] = useState(false)
  const [expiryDate, setExpiryDate] = useState(
    preset.defaultExpiryDate || addDaysIso(isoToday(), preset.shelfLifeDays),
  )
  const [saving, setSaving] = useState(false)

  // Une unité pesée (g / ml) se décrémente par paliers de 50 ; au pièce, par 1.
  const step = preset.unit === 'unit' ? 1 : 50

  const adjust = (delta: number) => {
    hapticTap()
    setQuantity((current) => Math.max(step, Math.round((current + delta) * 100) / 100))
  }

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onConfirm({ quantity, isShared, expiryDate })
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="rounded-2xl border border-white/12 bg-white/[0.055] p-3 space-y-3"
      style={{ backdropFilter: 'blur(20px) saturate(1.4)', boxShadow: '0 12px 36px rgba(0,0,0,0.35)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">{preset.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="font-sans text-[13px] text-white/90 truncate">{preset.name}</div>
          <div className="font-mono text-[9px] text-slate-500">
            {preset.zoneLabel} · conserve {preset.shelfLifeDays} j
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 rounded-lg font-mono text-[9px] text-slate-400 hover:text-white tap"
        >
          ANNULER
        </button>
      </div>

      {/* Quantité */}
      <div className="flex items-center justify-between gap-2">
        <span className="label-micro">QUANTITÉ</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => adjust(-step)}
            disabled={quantity <= step}
            aria-label="Diminuer la quantité"
            className="w-8 h-8 rounded-xl border border-white/12 bg-white/[0.04] text-slate-300
                       flex items-center justify-center tap disabled:opacity-30 hover:border-white/25"
          >
            <Minus size={12} />
          </button>
          <span className="min-w-[68px] text-center font-mono text-[13px] tabular-nums text-white/90">
            {quantity} {unitWord(preset.unit, quantity)}
          </span>
          <button
            type="button"
            onClick={() => adjust(step)}
            aria-label="Augmenter la quantité"
            className="w-8 h-8 rounded-xl border border-white/12 bg-white/[0.04] text-slate-300
                       flex items-center justify-center tap hover:border-white/25"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Partage */}
      <div className="flex items-center justify-between gap-2">
        <span className="label-micro">RANGEMENT</span>
        <div className="flex p-0.5 rounded-xl border border-white/10 bg-black/25">
          <button
            type="button"
            onClick={() => {
              hapticTap()
              setIsShared(false)
            }}
            className={`flex items-center gap-1 px-2.5 h-7 rounded-lg font-sans text-[10px] tap transition-colors ${
              isShared ? 'text-slate-400' : 'bg-white/10 text-white'
            }`}
          >
            <User size={10} /> Mon placard
          </button>
          <button
            type="button"
            onClick={() => {
              hapticTap()
              setIsShared(true)
            }}
            className={`flex items-center gap-1 px-2.5 h-7 rounded-lg font-sans text-[10px] tap transition-colors ${
              isShared ? 'bg-white/10 text-white' : 'text-slate-400'
            }`}
          >
            <Users size={10} /> Partagé coloc
          </button>
        </div>
      </div>

      {/* DLC */}
      <div className="flex items-center justify-between gap-2">
        <span className="label-micro">PÉREMPTION</span>
        <input
          type="date"
          value={expiryDate}
          onChange={(event) => setExpiryDate(event.target.value)}
          className="bg-white/[0.04] border border-white/12 rounded-xl px-2.5 h-8 font-mono text-[11px]
                     text-white/85 tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400/50"
        />
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving || !expiryDate}
        className="w-full h-11 rounded-2xl border border-emerald-400/40 bg-emerald-400/15 text-emerald-300
                   font-sans text-[11px] tracking-[0.18em] uppercase flex items-center justify-center gap-2
                   tap hover:bg-emerald-400/25 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <ShoppingBasket size={13} />}
        {saving ? 'Rangement…' : 'Ranger dans le frigo'}
      </button>
    </motion.div>
  )
}

// ── Tiroir complet ────────────────────────────────────────────────────────────

export function QuickAddDrawer() {
  const { setFridgeState } = useFridgeStore()
  const [open, setOpen] = useState(true)
  const [catalog, setCatalog] = useState<{ categories: Array<{ id: FreshCategoryId; label: string; emoji: string }>; presets: FreshPreset[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FreshCategoryId | 'all'>('all')
  const [selected, setSelected] = useState<FreshPreset | null>(null)
  const [selectedQuantity, setSelectedQuantity] = useState(1)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadCatalog = useCallback(async () => {
    if (catalog || loading) return
    setLoading(true)
    setLoadError(null)
    try {
      const fresh = await api.getFreshPresets()
      setCatalog(fresh)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Catalogue indisponible')
    } finally {
      setLoading(false)
    }
  }, [catalog, loading])

  useEffect(() => {
    if (open) void loadCatalog()
  }, [open, loadCatalog])

  const presets = catalog?.presets ?? []
  const { quantity: parsedQuantity, label } = parseQuery(query)

  const visible = useMemo(() => {
    const filtered = presets.filter(
      (preset) => (category === 'all' || preset.category === category) && matches(preset, label),
    )
    return query.trim() ? filtered : filtered
  }, [presets, category, label, query])

  const suggestions = useMemo(() => {
    if (!query.trim() || presets.length === 0) return []
    return visible.slice(0, 4)
  }, [visible, presets.length, query])

  const openPreset = (preset: FreshPreset, quantity?: number | null) => {
    setSelected(preset)
    setSelectedQuantity(quantity ?? preset.defaultQty)
  }

  /** Entrée dans la recherche → ajout direct avec l'unité/preset le plus proche. */
  const submitQuery = async () => {
    const candidate = visible[0]
    if (!candidate) return
    openPreset(candidate, parsedQuantity ?? candidate.defaultQty)
  }

  const confirmAdd = async (payload: {
    quantity: number
    isShared: boolean
    expiryDate: string
  }) => {
    if (!selected) return
    try {
      const result = await api.quickAddItem({
        name: selected.name,
        presetId: selected.id,
        quantity: payload.quantity,
        unit: selected.unit,
        shelfLifeDays: selected.shelfLifeDays,
        isShared: payload.isShared,
        expiryDate: payload.expiryDate,
      })

      const fresh = await api.getFridgeState()
      setFridgeState(fresh)

      hapticSuccess()
      toasts.productAdded(result.item.name, result.zoneLabel)

      setSelected(null)
      setQuery('')
      setCategory('all')
    } catch (err) {
      toasts.error(
        'Ajout impossible',
        err instanceof Error ? err.message : 'Erreur serveur',
      )
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      {/* En-tête (volet rabattable) */}
      <button
        type="button"
        onClick={() => {
          hapticTap()
          setOpen((value) => !value)
        }}
        className="w-full flex items-center justify-between px-3 py-2.5 tap"
      >
        <span className="flex items-center gap-2">
          <span className="text-base leading-none">🧺</span>
          <span className="font-sans text-[11px] tracking-[0.16em] uppercase text-white/85">
            Marché & Aliments frais
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-500 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2.5">
              {loading && (
                <div className="flex items-center gap-2 py-4 justify-center text-slate-500">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="font-mono text-[10px]">Chargement du marché…</span>
                </div>
              )}

              {loadError && (
                <div className="p-2.5 rounded-xl border border-health-warning/25 bg-health-warning/5">
                  <span className="font-mono text-[10px] text-health-warning">{loadError}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setCatalog(null)
                      void loadCatalog()
                    }}
                    className="ml-2 font-mono text-[10px] text-accent underline"
                  >
                    réessayer
                  </button>
                </div>
              )}

              {!loading && catalog && (
                <>
                  {/* Recherche libre avec auto-complétion */}
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void submitQuery()
                        }
                        if (event.key === 'Escape') setQuery('')
                      }}
                      placeholder="Ex: 2 pavés de saumon, tomates…"
                      aria-label="Rechercher un aliment frais"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-3 py-2.5 font-sans
                                 text-[12px] text-white/90 placeholder-slate-500 focus:outline-none
                                 focus:border-emerald-400/50 focus:bg-white/[0.07] transition-colors"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        aria-label="Effacer la recherche"
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 font-mono text-[9px] text-slate-500 hover:text-white tap"
                      >
                        ✕
                      </button>
                    )}

                    {/* Suggestions */}
                    <AnimatePresence>
                      {suggestions.length > 0 && !selected && (
                        <motion.ul
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="mt-1 rounded-xl border border-white/12 bg-[#0d1014]/95 overflow-hidden"
                          style={{ backdropFilter: 'blur(20px)' }}
                        >
                          {suggestions.map((preset) => (
                            <li key={preset.id}>
                              <button
                                type="button"
                                onClick={() => openPreset(preset, parsedQuantity ?? preset.defaultQty)}
                                className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-white/[0.06] tap text-left"
                              >
                                <span className="text-sm leading-none">{preset.emoji}</span>
                                <span className="flex-1 min-w-0 truncate font-sans text-[11px] text-white/85">
                                  {preset.name}
                                </span>
                                <span className="font-mono text-[9px] text-emerald-300/80 tabular-nums">
                                  {parsedQuantity ? `${parsedQuantity} × ` : ''}
                                  {preset.shelfLifeLabel}
                                </span>
                              </button>
                            </li>
                          ))}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Puces catégories */}
                  <div className="flex flex-wrap gap-1.5">
                    {[{ id: 'all' as const, label: 'Tout', emoji: '✨' }, ...catalog.categories].map((chip) => {
                      const active = category === chip.id
                      return (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => {
                            hapticTap()
                            setCategory(chip.id)
                          }}
                          className={`px-2.5 h-7 rounded-full border font-sans text-[10px] tap transition-colors ${
                            active
                              ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
                              : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25'
                          }`}
                        >
                          {chip.emoji} {chip.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Mini-feuille de confirmation */}
                  <AnimatePresence mode="wait">
                    {selected ? (
                      <ConfirmSheet
                        key={selected.id}
                        preset={selected}
                        initialQuantity={selectedQuantity}
                        onCancel={() => setSelected(null)}
                        onConfirm={confirmAdd}
                      />
                    ) : (
                      <motion.div
                        key="tiles"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="grid grid-cols-2 gap-1.5"
                      >
                        {visible.map((preset) => (
                          <PresetTile key={preset.id} preset={preset} onSelect={(p) => openPreset(p)} />
                        ))}
                        {visible.length === 0 && (
                          <div className="col-span-full py-4 text-center">
                            <p className="font-sans text-[11px] text-slate-500">
                              Aucun aliment trouvé pour « {label} ».
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (!label) return
                                // Nom libre : 5 jours par défaut, clayette du milieu
                                setSelected({
                                  id: `custom-${label}`,
                                  name: label,
                                  category: 'bakery',
                                  emoji: '🛒',
                                  shelfLifeDays: 5,
                                  zoneMeshId: 'fridge_shelf_middle',
                                  zoneLabel: 'Étagère milieu',
                                  unit: 'unit',
                                  defaultQty: parsedQuantity ?? 1,
                                  calories: null,
                                  proteins: null,
                                  keywords: [],
                                  shelfLifeLabel: 'J+5',
                                  defaultExpiryDate: addDaysIso(isoToday(), 5),
                                })
                                setSelectedQuantity(parsedQuantity ?? 1)
                              }}
                              className="mt-1 font-mono text-[10px] text-accent underline"
                            >
                              Ajouter « {label} » quand même
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
