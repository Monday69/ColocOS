import { useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  Clock,
  Link2,
  Loader2,
  Save,
  ShoppingBasket,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { api } from '@/api/client'
import { hapticSuccess } from '@/lib/haptics'
import { toasts } from '@/components/ui/ToastProvider'
import { useShoppingStore } from '@/store'
import type { ScrapedRecipePreview } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Import d'une recette par URL (JSON-LD Schema.org)
// ─────────────────────────────────────────────────────────────────────────────

interface RecipeImportModalProps {
  open: boolean
  onClose: () => void
  /** Appelé après enregistrement réussi (rafraîchit le hub sans reload) */
  onSaved?: () => void
}

export function RecipeImportModal({ open, onClose, onSaved }: RecipeImportModalProps) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ScrapedRecipePreview | null>(null)

  // Champs éditables de l'aperçu
  const [title, setTitle] = useState('')
  const [prepTime, setPrepTime] = useState('')
  const [cookTime, setCookTime] = useState('')
  const [servings, setServings] = useState('4')
  const [batchState, setBatchState] = useState<'idle' | 'loading' | 'done'>('idle')

  const setShoppingList = useShoppingStore((s) => s.setShoppingList)

  const reset = () => {
    setPreview(null)
    setError(null)
    setUrl('')
    setBatchState('idle')
  }

  const analyze = useCallback(async () => {
    if (!url.trim() || loading) return
    setLoading(true)
    setError(null)
    setPreview(null)
    try {
      const data = await api.extractRecipeFromUrl(url.trim())
      setPreview(data)
      setTitle(data.title)
      setPrepTime(data.prepTimeMin !== null ? String(data.prepTimeMin) : '')
      setCookTime(data.cookTimeMin !== null ? String(data.cookTimeMin) : '')
      setServings(String(data.servings))
      hapticSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import impossible')
    } finally {
      setLoading(false)
    }
  }, [url, loading])

  const missing = preview ? preview.ingredients.filter((ingredient) => !ingredient.inStock) : []

  /** Envoie les ingrédients manquants dans la liste de courses active. */
  const addMissingToShopping = async () => {
    if (!preview || missing.length === 0 || batchState !== 'idle') return
    setBatchState('loading')
    try {
      const list = await api.addMissingIngredientsToShopping(
        missing.map((ingredient) => ({ name: ingredient.name })),
      )
      setShoppingList(list)
      hapticSuccess()
      toasts.shoppingBatchAdd(missing.length, preview.title)
      setBatchState('done')
    } catch (err) {
      setBatchState('idle')
      toasts.error(
        'Ajout impossible',
        err instanceof Error ? err.message : 'Erreur serveur',
      )
    }
  }

  const save = async () => {
    if (!preview || saving) return
    setSaving(true)
    try {
      await api.createCustomRecipe({
        title: title.trim() || preview.title,
        sourceUrl: preview.sourceUrl,
        imageUrl: preview.imageUrl,
        prepTimeMin: prepTime ? Number.parseInt(prepTime, 10) : null,
        cookTimeMin: cookTime ? Number.parseInt(cookTime, 10) : null,
        servings: servings ? Number.parseInt(servings, 10) : 4,
        instructions: preview.instructions,
        ingredients: preview.ingredients.map((ingredient) => ({
          name: ingredient.name,
          quantity: ingredient.quantity ?? null,
          unit: ingredient.unit ?? null,
        })),
      })

      hapticSuccess()
      toasts.info('Recette enregistrée', `${title || preview.title} rejoint les recettes de la coloc`)
      onSaved?.()
      reset()
      onClose()
    } catch (err) {
      toasts.error(
        'Enregistrement impossible',
        err instanceof Error ? err.message : 'Erreur serveur',
      )
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pt-[112px] sm:pt-0">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />

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
            <Link2 size={15} className="text-cyan-300" />
            <div>
              <div className="label-micro">IMPORT</div>
              <div className="font-display text-sm text-white/90">Recette par lien</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'import"
            className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center tap text-slate-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
          {/* Saisie de l'URL */}
          <div className="space-y-2">
            <label className="label-micro" htmlFor="import-url">
              LIEN DE LA RECETTE
            </label>
            <div className="flex gap-1.5">
              <input
                id="import-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void analyze()
                  }
                }}
                placeholder="https://www.marmiton.org/recettes/…"
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-2xl px-3 h-10
                           font-sans text-[12px] text-white/90 placeholder-slate-500
                           focus:outline-none focus:border-cyan-400/50 focus:bg-white/[0.07]"
              />
              <button
                type="button"
                onClick={() => void analyze()}
                disabled={loading || url.trim().length < 8}
                className="px-3 h-10 rounded-2xl border border-cyan-400/40 bg-cyan-400/15 text-cyan-300
                           font-sans text-[10px] tracking-widest uppercase flex items-center gap-1.5
                           tap hover:bg-cyan-400/25 disabled:opacity-40 transition-colors flex-shrink-0"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Analyser
              </button>
            </div>
            <p className="font-mono text-[9px] text-slate-500 leading-relaxed">
              Lit les données structurées Schema.org (Marmiton, 750g, blogs…). Rien n'est enregistré avant validation.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl border border-amber-400/25 bg-amber-400/5">
              <AlertTriangle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <span className="font-mono text-[10px] text-amber-300 leading-relaxed">{error}</span>
            </div>
          )}

          {/* Prévisualisation */}
          <AnimatePresence>
            {preview && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-2.5"
              >
                {/* Bandeau image + compte de stock */}
                <div className="relative rounded-2xl overflow-hidden border border-white/10">
                  {preview.imageUrl ? (
                    <img
                      src={preview.imageUrl}
                      alt={preview.title}
                      className="w-full h-28 object-cover"
                      onError={(event) => {
                        ;(event.currentTarget as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="w-full h-20 bg-white/[0.03] flex items-center justify-center">
                      <span className="font-mono text-[10px] text-slate-500">Sans visuel</span>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/65 backdrop-blur-sm">
                    <span className="font-mono text-[9px] text-emerald-300 tabular-nums">
                      {preview.stockSummary.inStock}
                    </span>
                    <span className="font-mono text-[9px] text-slate-400">/</span>
                    <span className="font-mono text-[9px] text-slate-300 tabular-nums">
                      {preview.stockSummary.total}
                    </span>
                    <span className="font-mono text-[9px] text-slate-500">en stock</span>
                  </div>
                </div>

                {/* Champs éditables */}
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label="Titre de la recette"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-2.5 h-9
                             font-sans text-[12px] text-white/90 focus:outline-none focus:border-cyan-400/50"
                />

                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: 'PRÉPA', value: prepTime, set: setPrepTime, icon: <Clock size={9} />, unit: 'min' },
                    { label: 'CUISSON', value: cookTime, set: setCookTime, icon: <Clock size={9} />, unit: 'min' },
                    { label: 'PARTS', value: servings, set: setServings, icon: <Users size={9} />, unit: '' },
                  ].map((field) => (
                    <div key={field.label} className="rounded-xl border border-white/8 bg-white/[0.03] p-1.5">
                      <div className="flex items-center gap-1 font-mono text-[8px] text-slate-500 uppercase">
                        {field.icon}
                        {field.label}
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={field.value}
                        onChange={(event) => field.set(event.target.value)}
                        aria-label={field.label}
                        className="w-full bg-transparent font-mono text-[12px] text-white/90 tabular-nums
                                   focus:outline-none"
                      />
                    </div>
                  ))}
                </div>

                {/* Ingrédients + pastilles de stock */}
                <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="label-micro">INGRÉDIENTS</span>
                    <span className="font-mono text-[9px] text-slate-500">
                      {preview.ingredients.length}
                    </span>
                  </div>
                  <ul className="space-y-0.5 max-h-44 overflow-y-auto pr-0.5">
                    {preview.ingredients.map((ingredient, index) => (
                      <li
                        key={`${ingredient.name}-${index}`}
                        className="flex items-center gap-2 py-0.5"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: ingredient.inStock ? '#00e676' : '#f59e0b',
                            boxShadow: ingredient.inStock
                              ? '0 0 6px #00e676aa'
                              : '0 0 6px #f59e0b88',
                          }}
                        />
                        <span className="flex-1 min-w-0 truncate font-sans text-[11px] text-white/85">
                          {ingredient.name}
                        </span>
                        <span className="font-mono text-[9px] text-slate-500 tabular-nums flex-shrink-0">
                          {ingredient.quantity ?? ''} {ingredient.unit ?? ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {preview.instructions.length > 0 && (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-2">
                    <span className="label-micro">ÉTAPES</span>
                    <ol className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                      {preview.instructions.map((step, index) => (
                        <li key={index} className="font-sans text-[10px] text-slate-300 leading-snug">
                          <span className="font-mono text-[9px] text-cyan-300 mr-1">{index + 1}.</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Actions */}
        {preview && (
          <div className="flex-shrink-0 p-3 border-t border-white/8 space-y-1.5">
            <button
              type="button"
              onClick={() => void addMissingToShopping()}
              disabled={missing.length === 0 || batchState !== 'idle'}
              className="w-full h-9 rounded-xl border border-white/12 bg-white/[0.04] text-slate-300
                         font-sans text-[10px] flex items-center justify-center gap-1.5
                         tap hover:border-white/25 disabled:opacity-40 transition-colors"
            >
              {batchState === 'loading' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : batchState === 'done' ? (
                <Check size={12} className="text-emerald-400" />
              ) : (
                <ShoppingBasket size={12} />
              )}
              {batchState === 'done'
                ? 'Ingrédients ajoutés aux courses ✓'
                : missing.length > 0
                  ? `+ Ajouter les ${missing.length} manquants aux courses`
                  : 'Tous les ingrédients sont en stock'}
            </button>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !title.trim()}
              className="w-full h-11 rounded-2xl border border-emerald-400/40 bg-emerald-400/15
                         text-emerald-300 font-sans text-[11px] tracking-[0.16em] uppercase
                         flex items-center justify-center gap-2 tap hover:bg-emerald-400/25
                         disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Enregistrement…' : 'Enregistrer dans les recettes coloc'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}
