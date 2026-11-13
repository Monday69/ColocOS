import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Flame, Leaf, Loader2, Trophy, Wallet, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/api/client'
import { toasts } from '@/components/ui/ToastProvider'
import { hapticTap } from '@/lib/haptics'
import type { WrappedWeekly } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — WrappedModal
//
// Récap hebdomadaire : macros vs cibles, podium des aliments, score anti-gaspi
// et coût moyen par repas. Navigation entre la semaine en cours et la
// précédente (`offset` 0 → 1).
// ─────────────────────────────────────────────────────────────────────────────

export interface WrappedModalProps {
  open: boolean
  onClose: () => void
}

function RatioBar({
  label,
  consumed,
  target,
  color,
}: {
  label: string
  consumed: number
  target: number | null
  color: string
}) {
  const ratio = target && target > 0 ? Math.min(1, consumed / target) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-micro">{label}</span>
        <span className="font-mono text-[10px] tabular-nums text-text-secondary">
          {Math.round(consumed)}
          {target ? ` / ${Math.round(target)}` : ''}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-ios"
          style={{ width: `${ratio * 100}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

export function WrappedModal({ open, onClose }: WrappedModalProps) {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<WrappedWeekly | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)

    void api
      .getWrapped(offset)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) {
          toasts.error('Wrapped indisponible', err instanceof Error ? err.message : undefined)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, offset])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const nutrition = data?.nutrition
  const score = data?.antiWaste.score ?? 100

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="wrapped-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="wrapped-sheet"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="fixed inset-x-0 bottom-0 z-[131] md:inset-0 md:m-auto md:h-fit md:max-w-md"
        role="dialog"
        aria-label="ColocOS Wrapped"
      >
        <div className="glass-sheet rounded-t-[28px] md:rounded-[24px] max-h-[88vh] overflow-y-auto px-4 pb-6 pt-3 font-sans">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 md:hidden" />

          <div className="flex items-center gap-2 mb-3">
            <Trophy size={15} className="text-amber-300" />
            <span className="label-micro">ColocOS Wrapped</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer le Wrapped"
              className="ml-auto w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-slate-400 tap hover:text-white"
            >
              <X size={14} />
            </button>
          </div>

          {/* Navigation semaine */}
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1.5">
            <button
              type="button"
              onClick={() => {
                hapticTap()
                setOffset((value) => Math.min(12, value + 1))
              }}
              aria-label="Semaine précédente"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 tap hover:text-white"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="text-center">
              <div className="font-sans text-[11px] text-white/85">
                {offset === 0 ? 'Semaine en cours' : offset === 1 ? 'Semaine dernière' : `Il y a ${offset} semaines`}
              </div>
              {data && (
                <div className="font-mono text-[9px] text-slate-500 tabular-nums">
                  {data.week.start} → {data.week.end}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                hapticTap()
                setOffset((value) => Math.max(0, value - 1))
              }}
              disabled={offset === 0}
              aria-label="Semaine suivante"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 tap hover:text-white disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              <span className="font-mono text-2xs">CALCUL…</span>
            </div>
          )}

          {!loading && nutrition && (
            <>
              {/* Macros de la semaine */}
              <div className="mt-3 space-y-2 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <span className="label-micro">NUTRITION</span>
                  <span className="font-mono text-[9px] text-slate-500">
                    {nutrition.daysTracked} j suivis · {nutrition.workouts.sessions} séance
                    {nutrition.workouts.sessions > 1 ? 's' : ''}
                  </span>
                </div>
                <RatioBar
                  label="CALORIES"
                  consumed={nutrition.consumed.kcal}
                  target={nutrition.targets?.kcal ?? null}
                  color="#f59e0b"
                />
                <RatioBar
                  label="PROTÉINES"
                  consumed={nutrition.consumed.proteinG}
                  target={nutrition.targets?.proteinG ?? null}
                  color="#38bdf8"
                />
                <RatioBar
                  label="GLUCIDES"
                  consumed={nutrition.consumed.carbsG}
                  target={nutrition.targets?.carbsG ?? null}
                  color="#a78bfa"
                />
                <RatioBar
                  label="LIPIDES"
                  consumed={nutrition.consumed.fatG}
                  target={nutrition.targets?.fatG ?? null}
                  color="#f472b6"
                />
                {nutrition.workouts.bonusKcal > 0 && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <Flame size={10} className="text-emerald-300" />
                    <span className="font-mono text-[9px] text-emerald-300 tabular-nums">
                      +{nutrition.workouts.bonusKcal} kcal de séances incluses dans les cibles
                    </span>
                  </div>
                )}
              </div>

              {/* Podium */}
              <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <span className="label-micro">TOP ALIMENTS</span>
                {data.topFoods.length === 0 ? (
                  <p className="mt-1.5 font-sans text-[11px] text-slate-500">
                    Aucun repas enregistré cette semaine.
                  </p>
                ) : (
                  <ol className="mt-1.5 space-y-1">
                    {data.topFoods.map((food, index) => (
                      <li key={food.label} className="flex items-center gap-2">
                        <span
                          className={clsx(
                            'w-5 h-5 rounded-full flex items-center justify-center font-mono text-[9px]',
                            index === 0
                              ? 'bg-amber-400/20 text-amber-300'
                              : index === 1
                                ? 'bg-slate-300/15 text-slate-200'
                                : 'bg-orange-700/20 text-orange-300',
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className="flex-1 truncate font-sans text-[11px] text-white/85">
                          {food.label}
                        </span>
                        <span className="font-mono text-[9px] text-slate-500 tabular-nums">
                          ×{food.occurrences} · {food.kcal} kcal
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Anti-gaspi */}
              <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 label-micro">
                    <Leaf size={11} className="text-emerald-300" />
                    ANTI-GASPI
                  </span>
                  <span className="font-mono text-[11px] text-emerald-300 tabular-nums">
                    {score} %
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-white/8 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-ios"
                    style={{
                      width: `${score}%`,
                      backgroundColor: score >= 80 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171',
                    }}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-1.5">
                    <div className="font-mono text-[9px] text-emerald-300/70">SAUVÉ</div>
                    <div className="font-mono text-[12px] text-emerald-300 tabular-nums">
                      {data.antiWaste.savedEuros.toFixed(2)} €
                    </div>
                    <div className="font-mono text-[8px] text-slate-500">
                      {data.antiWaste.finished} produits finis
                    </div>
                  </div>
                  <div className="rounded-lg border border-red-400/20 bg-red-400/[0.07] px-2 py-1.5">
                    <div className="font-mono text-[9px] text-red-300/70">PERDU</div>
                    <div className="font-mono text-[12px] text-red-300 tabular-nums">
                      {data.antiWaste.wastedEuros.toFixed(2)} €
                    </div>
                    <div className="font-mono text-[8px] text-slate-500">
                      {data.antiWaste.wasted} jetés
                    </div>
                  </div>
                </div>
              </div>

              {/* Dépense */}
              <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                <span className="flex items-center gap-1.5 label-micro">
                  <Wallet size={11} className="text-slate-400" />
                  COÛT MOYEN / REPAS
                </span>
                <span className="font-mono text-[12px] text-white/90 tabular-nums">
                  {data.spending.avgPerMealEuros !== null
                    ? `${data.spending.avgPerMealEuros.toFixed(2)} €`
                    : '—'}
                </span>
              </div>
              <p className="mt-1.5 font-mono text-[9px] text-slate-500">
                {data.spending.mealsRecorded} repas enregistrés · {data.nutrition.mealKcal} kcal
                issus des repas
              </p>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
