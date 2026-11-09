import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, Flame, Loader2, Target, User, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/api/client'
import { toasts } from '@/components/ui/ToastProvider'
import { hapticSuccess } from '@/lib/haptics'
import type { NutritionGoal, NutritionTargets, UserProfile } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — UserProfileModal
//
// Fiche profil & biométrie : poids, taille, date de naissance, genre, niveau
// d'activité (1.2 → 1.9) et objectif nutritionnel. La carte de synthèse affiche
// les cibles recalculées par le backend après `PATCH /users/me/profile` : aucun
// rechargement de page n'est nécessaire.
// ─────────────────────────────────────────────────────────────────────────────

const GOALS: Array<{ value: NutritionGoal; label: string; hint: string }> = [
  { value: 'MAINTENANCE', label: 'Maintien', hint: '1.4 g/kg' },
  { value: 'LEAN_BULK', label: 'Prise de muscle', hint: '1.8 g/kg' },
  { value: 'CUT', label: 'Sèche', hint: '2.0 g/kg' },
  { value: 'HIGH_PROTEIN', label: 'Protéines+', hint: '2.2 g/kg' },
]

const ACTIVITY_STEPS: Array<{ value: number; label: string }> = [
  { value: 1.2, label: 'Sédentaire' },
  { value: 1.375, label: 'Léger' },
  { value: 1.55, label: 'Modéré' },
  { value: 1.725, label: 'Actif' },
  { value: 1.9, label: 'Très actif' },
]

function activityLabel(value: number): string {
  const nearest = ACTIVITY_STEPS.reduce((acc, step) =>
    Math.abs(step.value - value) < Math.abs(acc.value - value) ? step : acc,
  )
  return nearest.label
}

export interface UserProfileModalProps {
  open: boolean
  onClose: () => void
}

export function UserProfileModal({ open, onClose }: UserProfileModalProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [targets, setTargets] = useState<NutritionTargets | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Champs éditables (chaînes pour les inputs contrôlés)
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [gender, setGender] = useState<'M' | 'F' | null>(null)
  const [activityLevel, setActivityLevel] = useState(1.2)
  const [goal, setGoal] = useState<NutritionGoal>('MAINTENANCE')

  const applyProfile = useCallback((next: UserProfile) => {
    setProfile(next)
    setWeight(next.weightKg === null ? '' : String(next.weightKg))
    setHeight(next.heightCm === null ? '' : String(next.heightCm))
    setBirthDate(next.birthDate ?? '')
    setGender(next.gender)
    setActivityLevel(next.activityLevel)
    setGoal(next.nutritionGoal)
  }, [])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const [freshProfile, freshTargets] = await Promise.all([
          api.getProfile(),
          api.getNutritionTargets(),
        ])
        if (cancelled) return
        applyProfile(freshProfile)
        setTargets(freshTargets)
      } catch (err) {
        if (!cancelled) {
          toasts.error('Profil indisponible', err instanceof Error ? err.message : undefined)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, applyProfile])

  // Échap ferme la modale
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)

    try {
      const result = await api.updateProfile({
        weightKg: weight.trim() === '' ? null : Number(weight),
        heightCm: height.trim() === '' ? null : Number(height),
        birthDate: birthDate.trim() === '' ? null : birthDate,
        gender,
        activityLevel,
        nutritionGoal: goal,
      })

      applyProfile(result.profile)
      setTargets(result.targets) // cibles recalculées sans refetch
      hapticSuccess()
      toasts.profileUpdated(result.targets.targetCalories, result.targets.targetProteins)
    } catch (err) {
      toasts.error('Enregistrement impossible', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="profile-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="profile-sheet"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="fixed inset-x-0 bottom-0 z-[121] md:inset-0 md:m-auto md:h-fit md:max-w-md"
        role="dialog"
        aria-label="Profil & objectifs nutritionnels"
      >
        <div className="glass-sheet rounded-t-[28px] md:rounded-[24px] max-h-[88vh] overflow-y-auto px-4 pb-6 pt-3 font-sans">
          {/* Poignée mobile */}
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 md:hidden" />

          <div className="flex items-center gap-2 mb-4">
            <User size={15} className="text-accent" />
            <span className="label-micro">
              Profil & biométrie{profile ? ` — ${profile.name}` : ''}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer le profil"
              className="ml-auto w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-slate-400 tap hover:text-white"
            >
              <X size={14} />
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              <span className="font-mono text-2xs">CHARGEMENT…</span>
            </div>
          )}

          {!loading && (
            <>
              {/* ── Champs biométriques ─────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="label-micro">Poids (kg)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={25}
                    max={250}
                    step={0.1}
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="72"
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-mono text-sm text-text-primary tabular-nums focus:outline-none focus:border-accent/60"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="label-micro">Taille (cm)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={80}
                    max={250}
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    placeholder="178"
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-mono text-sm text-text-primary tabular-nums focus:outline-none focus:border-accent/60"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="flex flex-col gap-1">
                  <span className="label-micro">Naissance</span>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-mono text-sm text-text-primary tabular-nums focus:outline-none focus:border-accent/60"
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <span className="label-micro">Genre</span>
                  <div className="flex gap-1">
                    {(['M', 'F'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setGender(value)}
                        className={clsx(
                          'flex-1 py-2 rounded-xl border text-xs font-medium tap ease-ios transition-all',
                          gender === value
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-white/10 text-slate-400 hover:text-slate-200',
                        )}
                      >
                        {value === 'M' ? 'Homme' : 'Femme'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Niveau d'activité ───────────────────────────────────── */}
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <span className="label-micro">Niveau d'activité</span>
                  <span className="font-mono text-2xs text-text-secondary tabular-nums">
                    {activityLabel(activityLevel)} · {activityLevel.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min={1.2}
                  max={1.9}
                  step={0.025}
                  value={activityLevel}
                  onChange={(e) => setActivityLevel(Number(e.target.value))}
                  className="w-full mt-2 accent-[#4fc3f7]"
                  aria-label="Niveau d'activité"
                />
                <div className="flex justify-between font-mono text-[9px] text-slate-500 mt-0.5">
                  <span>1.2</span>
                  <span>1.55</span>
                  <span>1.9</span>
                </div>
              </div>

              {/* ── Objectif nutritionnel ───────────────────────────────── */}
              <div className="mt-4">
                <span className="label-micro">Objectif</span>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  {GOALS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setGoal(option.value)}
                      className={clsx(
                        'rounded-xl border px-2 py-2 text-left tap ease-ios transition-all',
                        goal === option.value
                          ? 'border-health-ok/40 bg-health-ok/10'
                          : 'border-white/10 hover:border-white/20',
                      )}
                    >
                      <div
                        className={clsx(
                          'text-[11px] font-medium leading-tight',
                          goal === option.value ? 'text-health-ok' : 'text-slate-300',
                        )}
                      >
                        {option.label}
                      </div>
                      <div className="font-mono text-[9px] text-slate-500 mt-0.5 tabular-nums">
                        {option.hint}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Carte de synthèse ───────────────────────────────────── */}
              {targets && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Target size={12} className="text-accent" />
                    <span className="label-micro">Cibles calculées</span>
                    {targets.estimated && (
                      <span className="ml-auto font-mono text-[9px] text-health-warning">
                        ESTIMÉ
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-slate-400">Métabolisme de base</span>
                      <span className="font-mono text-sm text-text-primary tabular-nums">
                        {targets.bmr} kcal
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Activity size={10} /> Dépense journalière (TDEE)
                      </span>
                      <span className="font-mono text-sm text-text-primary tabular-nums">
                        {targets.tdee} kcal
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Flame size={10} /> Objectif calorique
                      </span>
                      <span className="font-mono text-sm text-accent tabular-nums">
                        {targets.targetCalories} kcal
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-slate-400">Cible protéines</span>
                      <span className="font-mono text-sm text-health-ok tabular-nums">
                        {targets.targetProteins} g/j
                      </span>
                    </div>
                  </div>

                  {targets.missingFields.length > 0 && (
                    <div className="mt-2 font-mono text-[9px] text-slate-500">
                      Champs manquants : {targets.missingFields.join(', ')}
                    </div>
                  )}
                </div>
              )}

              {/* ── Enregistrement ──────────────────────────────────────── */}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={clsx(
                  'mt-4 w-full h-11 rounded-2xl border flex items-center justify-center gap-2',
                  'text-[11px] tracking-wider uppercase tap ease-ios',
                  saving
                    ? 'border-white/10 bg-white/5 text-slate-500 cursor-wait'
                    : 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25',
                )}
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                {saving ? 'Recalcul…' : 'Enregistrer & recalculer'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
