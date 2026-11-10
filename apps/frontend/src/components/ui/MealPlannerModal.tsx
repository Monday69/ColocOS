import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CalendarDays,
  Check,
  ChefHat,
  Loader2,
  Moon,
  ShoppingCart,
  Sparkles,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { api } from '@/api/client'
import { hapticSuccess, hapticTap } from '@/lib/haptics'
import { toasts } from '@/components/ui/ToastProvider'
import { useShoppingStore, useStore } from '@/store'
import type {
  GroceryConsolidation,
  MealPlanEntry,
  MealSlot,
  RecipeSuggestion,
  RoommateProfile,
} from '@/types'

// ── Helpers de dates (semaine courante, lundi → dimanche) ─────────────────────

function toIso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function startOfWeek(base = new Date()): Date {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 0)
  const weekday = (date.getDay() + 6) % 7 // lundi = 0
  date.setDate(date.getDate() - weekday)
  return date
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12, 0, 0)
  return copy
}

const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

function dayLabel(date: Date, index: number): string {
  const day = `${date.getDate()}`.padStart(2, '0')
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  return `${WEEKDAYS[index]} ${day}/${month}`
}

// ── Sélecteur de créneau rapide (utilisé par les cartes recette) ──────────────

export interface QuickSlotOption {
  label: string
  date: string
  slot: MealSlot
}

/** « Ce soir », « Demain midi », « Demain soir ». */
export function quickSlotOptions(now = new Date()): QuickSlotOption[] {
  const today = toIso(now)
  const tomorrow = toIso(addDays(now, 1))
  return [
    { label: 'Ce soir', date: today, slot: 'DINNER' },
    { label: 'Demain midi', date: tomorrow, slot: 'LUNCH' },
    { label: 'Demain soir', date: tomorrow, slot: 'DINNER' },
  ]
}

// ── Modale semainier ─────────────────────────────────────────────────────────

interface MealPlannerModalProps {
  open: boolean
  onClose: () => void
  recipes: RecipeSuggestion[]
  /** Notifié après chaque écriture (pour rafraîchir les compteurs hors modale) */
  onChanged?: () => void
}

interface PickerState {
  date: string
  slot: MealSlot
}

export function MealPlannerModal({ open, onClose, recipes, onChanged }: MealPlannerModalProps) {
  const user = useStore((s) => s.user)
  const weekStart = useMemo(() => startOfWeek(), [])
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  )

  const [meals, setMeals] = useState<MealPlanEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [cookId, setCookId] = useState<string | null>(null)
  const [roommates, setRoommates] = useState<RoommateProfile[]>([])
  const [saving, setSaving] = useState(false)
  const [pickSearch, setPickSearch] = useState('')

  // Bloc 2 — convives & courses de la semaine
  const [attendeeEditor, setAttendeeEditor] = useState<MealPlanEntry | null>(null)
  const [draftAttendees, setDraftAttendees] = useState<Set<string>>(new Set())
  const [savingAttendees, setSavingAttendees] = useState(false)
  const [groceries, setGroceries] = useState<GroceryConsolidation | null>(null)
  const [groceriesLoading, setGroceriesLoading] = useState(false)
  const [groceriesSaving, setGroceriesSaving] = useState(false)
  const setShoppingList = useShoppingStore((store) => store.setShoppingList)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const start = toIso(days[0])
      const end = toIso(days[6])
      const data = await api.getMealPlan(start, end)
      setMeals(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Semainier indisponible')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    if (!open) return
    void load()
    void api
      .getProfiles()
      .then((profiles) => setRoommates(profiles))
      .catch(() => setRoommates([]))
  }, [open, load])

  useEffect(() => {
    if (!open) {
      setPicker(null)
      setPickSearch('')
    }
  }, [open])

  const mealAt = (date: string, slot: MealSlot): MealPlanEntry | undefined =>
    meals.find((meal) => meal.date === date && meal.slot === slot)

  const pickerRecipes = useMemo(() => {
    const needle = pickSearch.trim().toLowerCase()
    const sorted = [...recipes].sort((a, b) => {
      if (!!b.isFavorite !== !!a.isFavorite) return b.isFavorite ? 1 : -1
      return b.matchScore - a.matchScore
    })
    if (!needle) return sorted.slice(0, 40)
    return sorted
      .filter((recipe) => recipe.title.toLowerCase().includes(needle))
      .slice(0, 40)
  }, [recipes, pickSearch])

  const assign = async (recipe: RecipeSuggestion) => {
    if (!picker || saving) return
    setSaving(true)
    try {
      const meal = await api.upsertMealPlan({
        date: picker.date,
        slot: picker.slot,
        recipeId: recipe.id,
        recipeName: recipe.title,
        cookId: cookId ?? user?.id ?? null,
      })
      setMeals((current) => {
        const others = current.filter(
          (entry) => !(entry.date === meal.date && entry.slot === meal.slot),
        )
        return [...others, meal].sort((a, b) =>
          a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date),
        )
      })
      hapticSuccess()
      toasts.info(
        'Repas planifié',
        `${meal.recipeName} — ${picker.slot === 'LUNCH' ? 'midi' : 'soir'}`,
      )
      setPicker(null)
      setPickSearch('')
      onChanged?.()
    } catch (err) {
      toasts.error('Planification impossible', err instanceof Error ? err.message : 'Erreur serveur')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (meal: MealPlanEntry) => {
    hapticTap()
    try {
      await api.deleteMealPlan(meal.id)
      setMeals((current) => current.filter((entry) => entry.id !== meal.id))
      onChanged?.()
    } catch (err) {
      toasts.error('Suppression impossible', err instanceof Error ? err.message : 'Erreur serveur')
    }
  }

  /** Ouvre l'éditeur de convives (toute la coloc cochée par défaut). */
  const openAttendeeEditor = (meal: MealPlanEntry) => {
    hapticTap()
    const ids = meal.attendeeIds ?? roommates.map((mate) => mate.id)
    setDraftAttendees(new Set(ids))
    setAttendeeEditor(meal)
  }

  const toggleDraftAttendee = (id: string) => {
    hapticTap()
    setDraftAttendees((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveAttendees = async () => {
    if (!attendeeEditor || savingAttendees) return
    if (draftAttendees.size === 0) {
      toasts.error('Au moins un convive', 'Sélectionnez au moins une personne à table.')
      return
    }
    setSavingAttendees(true)
    try {
      const updated = await api.updateMealPlanAttendees(
        attendeeEditor.id,
        Array.from(draftAttendees),
      )
      setMeals((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      )
      hapticSuccess()
      setAttendeeEditor(null)
      onChanged?.()
    } catch (err) {
      toasts.error('Mise à jour impossible', err instanceof Error ? err.message : 'Erreur serveur')
    } finally {
      setSavingAttendees(false)
    }
  }

  /** Prévisualisation (dryRun) puis ajout réel à la liste de courses. */
  const previewGroceries = async () => {
    if (groceriesLoading) return
    setGroceriesLoading(true)
    try {
      const result = await api.generateWeeklyGroceries(
        toIso(days[0]),
        toIso(days[6]),
        true,
      )
      setGroceries(result.consolidation)
    } catch (err) {
      toasts.error('Calcul impossible', err instanceof Error ? err.message : 'Erreur serveur')
    } finally {
      setGroceriesLoading(false)
    }
  }

  const confirmGroceries = async () => {
    if (!groceries || groceriesSaving) return
    setGroceriesSaving(true)
    try {
      const result = await api.generateWeeklyGroceries(
        toIso(days[0]),
        toIso(days[6]),
        false,
      )
      if (result.list) setShoppingList(result.list)
      hapticSuccess()
      toasts.info(
        `${result.addedItemsCount} ingrédient(s) ajouté(s)`,
        `${result.coveredItemsCount} déjà couvert(s) par le stock`,
      )
      setGroceries(null)
      onChanged?.()
    } catch (err) {
      toasts.error('Ajout impossible', err instanceof Error ? err.message : 'Erreur serveur')
    } finally {
      setGroceriesSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pt-[112px] sm:pt-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
        className="relative w-full sm:max-w-lg max-h-full sm:max-h-[84vh] flex flex-col rounded-t-3xl sm:rounded-3xl
                   border border-white/12 bg-[#0d1014]/95 overflow-hidden"
        style={{ backdropFilter: 'blur(28px) saturate(1.4)' }}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-cyan-300" />
            <div>
              <div className="label-micro">SEMAINIER</div>
              <div className="font-display text-sm text-white/90">
                {dayLabel(days[0], 0)} → {dayLabel(days[6], 6)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le semainier"
            className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center tap text-slate-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
              <Loader2 size={15} className="animate-spin" />
              <span className="font-mono text-[10px]">Chargement de la semaine…</span>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl border border-health-critical/25 bg-health-critical/5">
              <span className="font-mono text-[10px] text-health-critical">{error}</span>
              <button onClick={() => void load()} className="ml-2 font-mono text-[10px] text-accent underline">
                réessayer
              </button>
            </div>
          )}

          {!loading &&
            days.map((date, index) => {
              const iso = toIso(date)
              const isToday = iso === toIso(new Date())
              return (
                <div
                  key={iso}
                  className={`rounded-2xl border p-2.5 ${
                    isToday ? 'border-cyan-400/30 bg-cyan-400/[0.06]' : 'border-white/8 bg-white/[0.025]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-sans text-[11px] text-white/80">
                      {dayLabel(date, index)}
                      {isToday && (
                        <span className="ml-1.5 font-mono text-[8px] text-cyan-300">AUJOURD'HUI</span>
                      )}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    {(['LUNCH', 'DINNER'] as MealSlot[]).map((slot) => {
                      const meal = mealAt(iso, slot)
                      const SlotIcon = slot === 'LUNCH' ? Sun : Moon
                      return (
                        <div key={slot} className="flex items-center gap-2">
                          <span className="w-12 flex items-center gap-1 font-mono text-[8px] text-slate-500 uppercase">
                            <SlotIcon size={9} />
                            {slot === 'LUNCH' ? 'Midi' : 'Soir'}
                          </span>

                          {meal ? (
                            <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded-xl border border-white/10 bg-white/[0.05]">
                              <span className="flex-1 min-w-0 truncate font-sans text-[11px] text-white/85">
                                {meal.recipeName}
                              </span>
                              {meal.cook && (
                                <span
                                  className="px-1.5 py-[1px] rounded-full font-mono text-[8px] max-w-[76px] truncate"
                                  style={{
                                    color: meal.cook.colorHex,
                                    border: `1px solid ${meal.cook.colorHex}55`,
                                    backgroundColor: `${meal.cook.colorHex}18`,
                                  }}
                                >
                                  {meal.cook.name.split(' ').slice(-1)[0]}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => openAttendeeEditor(meal)}
                                aria-label={`Convives de ${meal.recipeName}`}
                                className="flex items-center gap-1 px-1.5 py-[1px] rounded-full border
                                           border-white/12 bg-white/[0.05] tap hover:border-cyan-400/40"
                              >
                                <span className="flex items-center -space-x-1">
                                  {(meal.attendeeIds ?? roommates.map((mate) => mate.id))
                                    .slice(0, 3)
                                    .map((attendeeId) => {
                                      const mate = roommates.find((entry) => entry.id === attendeeId)
                                      if (!mate) return null
                                      return (
                                        <span
                                          key={attendeeId}
                                          className="w-2.5 h-2.5 rounded-full border border-black/40"
                                          style={{ backgroundColor: mate.colorHex }}
                                        />
                                      )
                                    })}
                                </span>
                                <span className="font-mono text-[8px] text-slate-300 tabular-nums">
                                  {meal.servings ?? meal.attendeeIds?.length ?? roommates.length} pers.
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void remove(meal)}
                                aria-label={`Retirer ${meal.recipeName}`}
                                className="text-slate-500 hover:text-red-400 tap"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                hapticTap()
                                setPicker({ date: iso, slot })
                                setCookId(user?.id ?? null)
                              }}
                              className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded-xl
                                         border border-dashed border-white/12 text-slate-500
                                         hover:border-cyan-400/40 hover:text-cyan-300 tap transition-colors"
                            >
                              <ChefHat size={11} />
                              <span className="font-sans text-[10px]">Assigner une recette</span>
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
        </div>

        {/* Barre d'action : courses de la semaine (Bloc 2) */}
        <div className="flex-shrink-0 px-3 py-2 border-t border-white/8 bg-black/25">
          <button
            type="button"
            onClick={() => void previewGroceries()}
            disabled={groceriesLoading || meals.length === 0}
            className="w-full h-10 rounded-2xl border border-cyan-400/35 bg-cyan-400/12 text-cyan-300
                       font-sans text-[11px] tracking-[0.12em] uppercase flex items-center justify-center gap-2
                       tap hover:bg-cyan-400/20 disabled:opacity-40 transition-colors"
          >
            {groceriesLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {groceriesLoading ? 'Calcul des besoins…' : 'Générer les courses de la semaine'}
          </button>
        </div>

        {/* Éditeur de convives (Bloc 2) */}
        <AnimatePresence>
          {attendeeEditor && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-white/10 bg-black/40 overflow-hidden flex-shrink-0"
            >
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-cyan-300">
                    <Users size={11} />
                    {attendeeEditor.recipeName.slice(0, 22)} · {draftAttendees.size} pers.
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttendeeEditor(null)}
                    className="font-mono text-[9px] text-slate-500 hover:text-white tap"
                  >
                    ANNULER
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {roommates.map((mate) => {
                    const active = draftAttendees.has(mate.id)
                    return (
                      <button
                        key={mate.id}
                        type="button"
                        onClick={() => toggleDraftAttendee(mate.id)}
                        aria-pressed={active}
                        className={`px-2 h-7 rounded-full border font-sans text-[10px] flex items-center gap-1 tap ${
                          active ? 'text-white' : 'text-slate-400 border-white/10'
                        }`}
                        style={
                          active
                            ? {
                                borderColor: `${mate.colorHex}80`,
                                backgroundColor: `${mate.colorHex}25`,
                              }
                            : undefined
                        }
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: mate.colorHex }}
                        />
                        {mate.name.split(' ').slice(-1)[0]}
                        {active && <Check size={9} />}
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => void saveAttendees()}
                  disabled={savingAttendees || draftAttendees.size === 0}
                  className="w-full h-9 rounded-xl border border-emerald-400/40 bg-emerald-400/15
                             text-emerald-300 font-sans text-[10px] uppercase tracking-wider
                             flex items-center justify-center gap-1.5 tap disabled:opacity-40"
                >
                  {savingAttendees ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  Valider les convives
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Prévisualisation des courses (Bloc 2) */}
        <AnimatePresence>
          {groceries && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
            >
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="w-full max-h-[88%] flex flex-col rounded-t-3xl sm:rounded-3xl border border-white/12
                           bg-[#0d1014]/97 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={14} className="text-cyan-300" />
                    <div>
                      <div className="label-micro">COURSES DE LA SEMAINE</div>
                      <div className="font-sans text-[11px] text-white/85">
                        {groceries.needed.length} à acheter · {groceries.covered.length} déjà au frigo
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGroceries(null)}
                    aria-label="Fermer la prévisualisation"
                    className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-slate-400 tap"
                  >
                    <X size={12} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="label-micro">À ACHETER ({groceries.needed.length})</span>
                    </div>
                    <ul className="space-y-0.5">
                      {groceries.needed.map((line) => (
                        <li key={line.name} className="flex items-center gap-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                          <span className="flex-1 min-w-0 truncate font-sans text-[11px] text-white/85">
                            {line.name}
                            {line.estimated && (
                              <span className="ml-1 font-mono text-[8px] text-slate-500">≈</span>
                            )}
                          </span>
                          <span className="font-mono text-[9px] text-amber-300 tabular-nums flex-shrink-0">
                            {line.quantity} {line.unit === 'unit' ? '×' : line.unit}
                          </span>
                        </li>
                      ))}
                      {groceries.needed.length === 0 && (
                        <li className="font-sans text-[10px] text-slate-500 py-1">
                          Rien à acheter : le stock couvre déjà la semaine.
                        </li>
                      )}
                    </ul>
                  </div>

                  {groceries.covered.length > 0 && (
                    <div>
                      <div className="label-micro mb-1">DÉJÀ AU FRIGO ({groceries.covered.length})</div>
                      <ul className="space-y-0.5">
                        {groceries.covered.map((line) => (
                          <li key={line.name} className="flex items-center gap-2 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                            <span className="flex-1 min-w-0 truncate font-sans text-[11px] text-slate-300">
                              {line.name}
                            </span>
                            <span className="font-mono text-[9px] text-slate-500 tabular-nums flex-shrink-0">
                              stock {line.stockQuantity} {line.unit === 'unit' ? '×' : line.unit}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {groceries.unresolvedRecipes.length > 0 && (
                    <div className="p-2 rounded-xl border border-amber-400/25 bg-amber-400/5">
                      <span className="font-mono text-[9px] text-amber-300">
                        Ingrédients introuvables pour : {groceries.unresolvedRecipes.join(', ')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="p-3 border-t border-white/8">
                  <button
                    type="button"
                    onClick={() => void confirmGroceries()}
                    disabled={groceriesSaving || groceries.needed.length === 0}
                    className="w-full h-11 rounded-2xl border border-emerald-400/40 bg-emerald-400/15
                               text-emerald-300 font-sans text-[11px] tracking-[0.14em] uppercase
                               flex items-center justify-center gap-2 tap hover:bg-emerald-400/25
                               disabled:opacity-40 transition-colors"
                  >
                    {groceriesSaving ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <ShoppingCart size={13} />
                    )}
                    Valider l'ajout à la liste de courses
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sélecteur de recette */}
        <AnimatePresence>
          {picker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-white/10 bg-black/40 overflow-hidden flex-shrink-0"
            >
              <div className="p-3 space-y-2 max-h-[45vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-cyan-300">
                    {picker.slot === 'LUNCH' ? 'Midi' : 'Soir'} · {picker.date}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPicker(null)}
                    className="font-mono text-[9px] text-slate-500 hover:text-white tap"
                  >
                    ANNULER
                  </button>
                </div>

                {/* Cuisinier */}
                {roommates.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    <span className="font-mono text-[8px] text-slate-500 uppercase flex-shrink-0">
                      Cuisinier
                    </span>
                    {roommates.map((mate) => {
                      const active = (cookId ?? user?.id) === mate.id
                      return (
                        <button
                          key={mate.id}
                          type="button"
                          onClick={() => {
                            hapticTap()
                            setCookId(mate.id)
                          }}
                          className={`px-2 h-6 rounded-full border font-sans text-[9px] flex-shrink-0 tap ${
                            active ? 'text-white' : 'text-slate-400 border-white/10'
                          }`}
                          style={
                            active
                              ? { borderColor: `${mate.colorHex}80`, backgroundColor: `${mate.colorHex}25` }
                              : undefined
                          }
                        >
                          {mate.name.split(' ').slice(-1)[0]}
                        </button>
                      )
                    })}
                  </div>
                )}

                <input
                  type="text"
                  value={pickSearch}
                  onChange={(event) => setPickSearch(event.target.value)}
                  placeholder="Rechercher une recette…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 font-sans
                             text-[11px] text-white/90 placeholder-slate-500 focus:outline-none
                             focus:border-cyan-400/50"
                />

                <div className="space-y-1">
                  {pickerRecipes.map((recipe) => (
                    <button
                      key={recipe.id}
                      type="button"
                      disabled={saving}
                      onClick={() => void assign(recipe)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl border border-white/8
                                 bg-white/[0.03] hover:border-cyan-400/40 hover:bg-cyan-400/[0.08] tap text-left
                                 disabled:opacity-50"
                    >
                      <span className="flex-1 min-w-0 truncate font-sans text-[11px] text-white/85">
                        {recipe.title}
                      </span>
                      <span className="font-mono text-[8px] text-slate-500 tabular-nums flex-shrink-0">
                        {recipe.missingIngredients.length === 0
                          ? 'PRÊT'
                          : `${recipe.missingIngredients.length} manque${recipe.missingIngredients.length > 1 ? 's' : ''}`}
                      </span>
                      {recipe.isFavorite && (
                        <span className="font-mono text-[8px] text-rose-300 flex-shrink-0">♥</span>
                      )}
                    </button>
                  ))}
                  {pickerRecipes.length === 0 && (
                    <div className="py-3 text-center font-sans text-[10px] text-slate-500">
                      Aucune recette pour « {pickSearch} »
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
