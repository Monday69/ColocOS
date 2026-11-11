import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, RefreshCw, ChevronDown, Flame, Beef } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import { hapticTap } from '@/lib/haptics';
import type { MealDaySummary, MealDayHistory } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Semainier nutritionnel
//
// Jauge du jour (protéines), graphique des 7 derniers jours et détail des repas
// du jour sélectionné. Données : /api/meals/today + /api/meals/history.
// ─────────────────────────────────────────────────────────────────────────────

/** Objectif quotidien de protéines, en grammes. */
export const DAILY_PROTEIN_GOAL = 140;

const DAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function hourLabel(iso: string): string {
  const d = new Date(iso);
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

/** « 2026-11-11 » → « Mer 11 » */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${DAY_LETTERS[d.getDay()]} ${d.getDate()}`;
}

export function NutritionWeekPanel() {
  const [history, setHistory] = useState<MealDayHistory[]>([]);
  const [today, setToday] = useState<MealDaySummary | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => isoDay(new Date()));
  const [detail, setDetail] = useState<MealDaySummary | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [historyRows, todaySummary] = await Promise.all([
        api.getMealsHistory(7),
        api.getMealsToday(),
      ]);
      setHistory(historyRows);
      setToday(todaySummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Journal nutritionnel indisponible');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Détail du jour sélectionné
  useEffect(() => {
    let cancelled = false;
    if (selectedDate === isoDay(new Date())) {
      setDetail(today);
      return;
    }
    api
      .getMealsToday(selectedDate)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, today]);

  // 7 derniers jours, du plus ancien à aujourd'hui
  const week = useMemo(() => {
    const byDate = new Map(history.map((row) => [row.date, row]));
    const now = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(now, index - 6);
      const iso = isoDay(date);
      const row = byDate.get(iso);
      return {
        iso,
        letter: DAY_LETTERS[date.getDay()],
        dayNumber: date.getDate(),
        proteins: row?.totalProteins ?? 0,
        calories: row?.totalCalories ?? 0,
        mealCount: row?.mealCount ?? 0,
      };
    });
  }, [history]);

  const maxProteins = Math.max(DAILY_PROTEIN_GOAL, ...week.map((day) => day.proteins));
  const todayProteins = today?.totalProteins ?? 0;
  const ratio = Math.min(1, todayProteins / DAILY_PROTEIN_GOAL);
  const percent = Math.round((todayProteins / DAILY_PROTEIN_GOAL) * 100);
  const goalReached = todayProteins >= DAILY_PROTEIN_GOAL;

  return (
    <div className="space-y-3">
      {/* ── Jauge du jour ─────────────────────────────────────────────── */}
      <div className="p-3 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <div className="label-micro flex items-center gap-1.5">
            <Beef size={11} className="text-cyan-300" />
            PROTÉINES DU JOUR
          </div>
          <div
            className={clsx(
              'px-2 py-0.5 rounded-md font-mono text-[9px] uppercase tracking-wider border',
              goalReached
                ? 'text-health-good border-health-good/40 bg-health-good/10'
                : 'text-cyan-300 border-cyan-400/30 bg-cyan-400/10',
            )}
          >
            {goalReached ? 'Objectif atteint !' : 'En cours'}
          </div>
        </div>

        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-600 tabular-nums" style={{ color: '#38bdf8' }}>
            {Math.round(todayProteins)}
          </span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            / {DAILY_PROTEIN_GOAL} g
          </span>
          <span className="ml-auto font-mono text-[10px] text-slate-400 tabular-nums">
            {percent}% • {Math.round(today?.totalCalories ?? 0)} kcal
          </span>
        </div>

        <div className="mt-2 h-2.5 rounded-full bg-white/8 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(ratio * 100, todayProteins > 0 ? 4 : 0)}%` }}
            transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
            className="h-full rounded-full"
            style={{
              background: goalReached
                ? 'linear-gradient(90deg,#22c55e,#4ade80)'
                : 'linear-gradient(90deg,#0ea5e9,#38bdf8)',
              boxShadow: '0 0 12px rgba(56,189,248,0.55)',
            }}
          />
        </div>

        <p className="mt-1.5 font-sans text-[10px] text-slate-500">
          Aujourd'hui : {Math.round(todayProteins)} g / {DAILY_PROTEIN_GOAL} g prot ({percent}%) •{' '}
          {Math.round(today?.totalCalories ?? 0)} kcal • {today?.mealCount ?? 0} repas
        </p>
      </div>

      {/* ── Graphique 7 jours ─────────────────────────────────────────── */}
      <div className="p-3 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <div className="label-micro">7 DERNIERS JOURS</div>
          <button
            type="button"
            onClick={() => {
              hapticTap();
              void load();
            }}
            aria-label="Rafraîchir le journal"
            className="text-slate-500 hover:text-cyan-300 tap transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="mt-3 flex items-end justify-between gap-1.5 h-32">
          {week.map((day) => {
            const isToday = day.iso === isoDay(new Date());
            const isSelected = day.iso === selectedDate;
            const height = Math.max(4, Math.round((day.proteins / maxProteins) * 100));
            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => {
                  hapticTap();
                  setSelectedDate(day.iso);
                }}
                className="flex-1 h-full flex flex-col items-center justify-end gap-1 tap group"
                aria-label={`${shortDate(day.iso)} : ${Math.round(day.proteins)} g de protéines`}
              >
                <span
                  className={clsx(
                    'font-mono text-[9px] tabular-nums',
                    isToday ? 'text-cyan-300' : 'text-slate-400',
                  )}
                >
                  {Math.round(day.proteins)}
                </span>
                <div
                  className={clsx(
                    'w-full rounded-t-md relative transition-colors',
                    isSelected ? 'bg-white/12' : 'bg-white/[0.06]',
                  )}
                  style={{ height: '100%' }}
                >
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${height}%` }}
                    transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
                    className={clsx(
                      'absolute bottom-0 left-0 right-0 rounded-t-md',
                      isToday || isSelected ? 'bg-cyan-400' : 'bg-cyan-500/45',
                    )}
                    style={
                      isToday
                        ? { boxShadow: '0 0 10px rgba(56,189,248,0.6)' }
                        : undefined
                    }
                  />
                </div>
                <span
                  className={clsx(
                    'font-mono text-[9px] leading-none',
                    isToday ? 'text-cyan-300 font-600' : 'text-slate-500',
                  )}
                >
                  {day.letter}
                </span>
                <span className="font-mono text-[8px] text-slate-600 leading-none">
                  {day.dayNumber}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Détail du jour sélectionné ─────────────────────────────────── */}
      <div className="p-3 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <div className="label-micro">
            REPAS DU {shortDate(selectedDate).toUpperCase()}
          </div>
          <div className="font-mono text-[9px] text-slate-500 tabular-nums">
            {detail?.mealCount ?? 0} repas
          </div>
        </div>

        {error && (
          <div className="mt-2 p-2 rounded-lg border border-health-critical/25 bg-health-critical/5">
            <span className="font-mono text-[10px] text-health-critical">{error}</span>
          </div>
        )}

        {!error && (detail?.meals.length ?? 0) === 0 && (
          <p className="mt-3 font-sans text-[11px] text-slate-500">
            Aucun repas enregistré pour ce jour.
          </p>
        )}

        <div className="mt-2 space-y-1.5">
          {(detail?.meals ?? []).map((meal) => {
            const isOpen = expanded === meal.id;
            return (
              <div key={meal.id} className="rounded-xl border border-white/8 bg-white/[0.02]">
                <button
                  type="button"
                  onClick={() => {
                    hapticTap();
                    setExpanded(isOpen ? null : meal.id);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 tap text-left"
                >
                  <span className="font-mono text-[10px] text-cyan-300 tabular-nums">
                    {hourLabel(meal.createdAt)}
                  </span>
                  <span className="font-sans text-[11px] text-slate-300 truncate flex-1">
                    {meal.items.length} aliment{meal.items.length > 1 ? 's' : ''} •{' '}
                    {Math.round(meal.totalProteins)} g prot • {Math.round(meal.totalCalories)} kcal
                  </span>
                  <ChevronDown
                    size={12}
                    className={clsx('text-slate-500 transition-transform', isOpen && 'rotate-180')}
                  />
                </button>

                {isOpen && (
                  <div className="px-2.5 pb-2 space-y-1">
                    {meal.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 font-mono text-[10px] text-slate-400 tabular-nums"
                      >
                        <span className="truncate text-slate-300">{item.name}</span>
                        <span className="flex-shrink-0">
                          {Math.round(item.grams)} g • {Math.round(item.proteins)} g prot
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {(loading || error) && (
        <div className="flex items-center justify-center gap-2 py-2 text-slate-500">
          {loading && <Loader2 size={13} className="animate-spin" />}
          <span className="font-mono text-[10px]">
            {loading ? 'Chargement du journal…' : 'Journal indisponible'}
          </span>
        </div>
      )}

      <p className="flex items-center gap-1.5 px-1 font-mono text-[9px] text-slate-600">
        <Flame size={10} />
        Objectif {DAILY_PROTEIN_GOAL} g de protéines / jour
      </p>
    </div>
  );
}
