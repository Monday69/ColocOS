import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, Plus, Check, Sparkles,
  Loader2, AlertCircle, X, ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';
import { useShopping } from '@/hooks/useShopping';
import { api } from '@/api/client';
import { toasts } from '@/components/ui/ToastProvider';
import { hapticTap } from '@/lib/haptics';
import type { ShoppingItem, ShoppingPrediction } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Shopping Module
//
// Deux catégories d'items visuellement distinctes :
//   - Manuel      → bordure neutre, pas d'icône spéciale
//   - Auto-suggéré (stock épuisé) → bordure Amber + icône Sparkles
//
// Interactions :
//   - Clic sur un item → toggle checked (optimistic update)
//   - Bouton + → ouvre le mini-form d'ajout
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_OPTIONS = ['unité', 'L', 'ml', 'kg', 'g'];

// ── Item Row ──────────────────────────────────────────────────────────────────

function ShoppingItemRow({
  item,
  onCheck,
  index,
}: {
  item: ShoppingItem;
  onCheck: () => void;
  index: number;
}) {
  const isChecked = item.status === 'checked' || item.status === 'purchased';
  const isAuto    = item.isAutoSuggested;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: isChecked ? 0.45 : 1, x: 0 }}
      exit={{ opacity: 0, x: 8, height: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className={clsx(
        'group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-200 cursor-pointer',
        isChecked
          ? 'border-surface-border/20 bg-surface-2/20'
          : isAuto
          ? 'border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/40'
          : 'border-surface-border/40 bg-surface-2/40 hover:bg-surface-3/50 hover:border-surface-border',
      )}
      onClick={onCheck}
    >
      {/* Checkbox */}
      <div
        className={clsx(
          'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all duration-200',
          isChecked
            ? 'bg-health-ok/80 border-health-ok'
            : isAuto
            ? 'border border-amber-500/50 group-hover:border-amber-400'
            : 'border border-surface-border group-hover:border-text-secondary',
        )}
      >
        {isChecked && <Check size={9} className="text-surface-DEFAULT" strokeWidth={3} />}
      </div>

      {/* Auto-suggest indicator */}
      {isAuto && !isChecked && (
        <Sparkles size={11} className="text-amber-400 flex-shrink-0" />
      )}

      {/* Name */}
      <div className="flex-1 min-w-0">
        <span
          className={clsx(
            'font-body text-sm transition-all duration-200',
            isChecked
              ? 'line-through text-text-tertiary'
              : isAuto
              ? 'text-amber-100'
              : 'text-text-primary',
          )}
        >
          {item.name}
        </span>
        {item.note && (
          <span className="block font-mono text-2xs text-text-tertiary mt-0.5">{item.note}</span>
        )}
      </div>

      {/* Quantity + adder chip */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="font-mono text-xs text-text-secondary whitespace-nowrap">
          {item.quantity} {item.unit}
        </span>
        {item.addedBy && (
          <div
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{
              backgroundColor: item.addedBy.colorHex + '33',
              border: `1px solid ${item.addedBy.colorHex}55`,
            }}
            title={item.addedBy.name}
          />
        )}
      </div>
    </motion.div>
  );
}

// ── Add Item Form ─────────────────────────────────────────────────────────────

function AddItemForm({ onAdd, onClose }: { onAdd: (name: string, qty: number, unit: string) => Promise<void>; onClose: () => void }) {
  const [name, setName]     = useState('');
  const [qty, setQty]       = useState('1');
  const [unit, setUnit]     = useState('unité');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onAdd(name.trim(), parseFloat(qty) || 1, unit);
      toasts.addItem(name.trim());
      setName(''); setQty('1');
      onClose();
    } catch (err) {
      // Ne jamais laisser un échec silencieux : l'utilisateur doit savoir que
      // l'article n'a pas été enregistré (ex. unité refusée, réseau coupé).
      toasts.error(err instanceof Error ? err.message : "Impossible d'ajouter l'article");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="panel rounded-xl p-4 mb-3 border border-accent/20"
      style={{ boxShadow: '0 0 24px #4fc3f710' }}
    >
      <div className="label-section mb-3">AJOUTER UN ARTICLE</div>

      <input
        autoFocus
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        placeholder="Ex: Lait demi-écrémé…"
        className="w-full bg-surface-3 border border-surface-border rounded-lg px-3 py-2
                   font-body text-sm text-text-primary placeholder-text-tertiary
                   focus:outline-none focus:border-accent transition-colors mb-3"
      />

      <div className="flex gap-2">
        <input
          type="number"
          value={qty}
          onChange={e => setQty(e.target.value)}
          min="0.1"
          step="0.1"
          className="w-20 bg-surface-3 border border-surface-border rounded-lg px-2 py-2
                     font-mono text-sm text-text-primary
                     focus:outline-none focus:border-accent transition-colors"
        />
        <select
          value={unit}
          onChange={e => setUnit(e.target.value)}
          className="flex-1 bg-surface-3 border border-surface-border rounded-lg px-2 py-2
                     font-mono text-sm text-text-primary
                     focus:outline-none focus:border-accent transition-colors"
        >
          {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>

        <button
          onClick={onClose}
          className="px-3 py-2 rounded-lg border border-surface-border text-text-tertiary
                     hover:text-text-primary transition-all"
        >
          <X size={14} />
        </button>

        <button
          onClick={handleSubmit}
          disabled={loading || !name.trim()}
          className="px-4 py-2 rounded-lg font-mono text-sm flex items-center gap-1.5
                     bg-accent/15 border border-accent/40 text-accent
                     hover:bg-accent/25 disabled:opacity-40 transition-all"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          ADD
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ShoppingModule() {
  const { shoppingList, isShoppingLoading, shoppingError, checkItem, addItem } = useShopping();
  const [showAddForm, setShowAddForm] = useState(false);

  const items       = shoppingList?.items ?? [];
  const pending     = items.filter(i => i.status === 'pending');
  const checked     = items.filter(i => i.status !== 'pending');
  const autoItems   = pending.filter(i => i.isAutoSuggested);
  const manualItems = pending.filter(i => !i.isAutoSuggested);

  const completionRate = items.length > 0
    ? Math.round((checked.length / items.length) * 100)
    : 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h2 className="font-display text-2xl font-black tracking-wider text-white uppercase mt-0.5">
            {shoppingList?.name ?? 'Courses'}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {/* Completion ring */}
          {items.length > 0 && (
            <div className="relative w-9 h-9">
              <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#1c1f25" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15" fill="none"
                  stroke="#00e676" strokeWidth="3"
                  strokeDasharray={`${completionRate * 0.942} 94.2`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-mono text-2xs text-health-ok">
                {completionRate}%
              </span>
            </div>
          )}

          <button
            onClick={() => setShowAddForm(v => !v)}
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200',
              showAddForm
                ? 'bg-accent/20 border border-accent/50 text-accent'
                : 'border border-surface-border text-text-tertiary hover:text-text-primary hover:border-surface-border',
            )}
          >
            {showAddForm ? <X size={14} /> : <Plus size={14} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Add form */}
        <AnimatePresence>
          {showAddForm && (
            <AddItemForm
              key="add-form"
              onAdd={addItem}
              onClose={() => setShowAddForm(false)}
            />
          )}
        </AnimatePresence>

        {/* Loading / error states */}
        {isShoppingLoading && !shoppingList && (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin text-text-tertiary" />
          </div>
        )}

        {shoppingError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-health-critical-glow border border-health-critical/30 mb-3">
            <AlertCircle size={14} className="text-health-critical" />
            <span className="font-mono text-xs text-health-critical">{shoppingError}</span>
          </div>
        )}

        {!isShoppingLoading && !shoppingError && items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <ShoppingCart size={28} className="text-text-tertiary" />
            <div className="text-center">
              <div className="font-mono text-sm text-text-tertiary">LISTE VIDE</div>
              <div className="font-body text-xs text-text-tertiary/60 mt-1">
                Ajoutez des articles avec le bouton +
              </div>
            </div>
          </div>
        )}

        {/* Suggestions intelligentes (habitudes d'achat) */}
        <SmartPredictions onAdd={addItem} />

        {/* Auto-suggested section */}
        <AnimatePresence>
          {autoItems.length > 0 && (
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={11} className="text-amber-400" />
                <span className="label-section" style={{ color: '#f59e0b99' }}>
                  SUGGESTIONS AUTO — STOCK ÉPUISÉ
                </span>
                <span className="font-mono text-2xs text-amber-500/60 ml-auto">{autoItems.length}</span>
              </div>
              <div className="space-y-1.5">
                {autoItems.map((item, i) => (
                  <ShoppingItemRow
                    key={item.id}
                    item={item}
                    index={i}
                    onCheck={async () => { await checkItem(item.id); toasts.checkItem(item.name); }}
                  />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Manual items section */}
        {manualItems.length > 0 && (
          <section className="mb-4">
            {autoItems.length > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="label-section">ARTICLES</span>
                <span className="font-mono text-2xs text-text-tertiary ml-auto">{manualItems.length}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <AnimatePresence>
                {manualItems.map((item, i) => (
                  <ShoppingItemRow
                    key={item.id}
                    item={item}
                    index={autoItems.length + i}
                    onCheck={async () => { await checkItem(item.id); toasts.checkItem(item.name); }}
                  />
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* Checked items (collapsed style) */}
        {checked.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Check size={11} className="text-health-ok" />
              <span className="label-section text-health-ok/60">COCHÉS</span>
              <span className="font-mono text-2xs text-text-tertiary ml-auto">{checked.length}</span>
            </div>
            <div className="space-y-1">
              <AnimatePresence>
                {checked.map((item, i) => (
                  <ShoppingItemRow
                    key={item.id}
                    item={item}
                    index={i}
                    onCheck={async () => { await checkItem(item.id); toasts.checkItem(item.name); }}
                  />
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}
      </div>

      {/* Footer stats */}
      {items.length > 0 && (
        <div className="flex-shrink-0 pt-3 mt-3 border-t border-surface-border/50
                        flex items-center justify-between">
          <span className="font-mono text-2xs text-text-tertiary">
            {checked.length}/{items.length} articles
          </span>
          {autoItems.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Sparkles size={10} className="text-amber-400" />
              <span className="font-mono text-2xs text-amber-500/70">
                {autoItems.length} suggestion{autoItems.length > 1 ? 's' : ''} auto
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggestions intelligentes — habitudes d'achat déduites des StockEvent
// ─────────────────────────────────────────────────────────────────────────────

function SmartPredictions({
  onAdd,
}: {
  onAdd: (name: string, quantity: number, unit: string) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ShoppingPrediction[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || items !== null) return
    let cancelled = false
    void api
      .getShoppingPredictions()
      .then((result) => {
        if (!cancelled) setItems(result)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [open, items])

  const addOne = async (prediction: ShoppingPrediction) => {
    try {
      await onAdd(prediction.itemName, 1, 'unité')
      toasts.addItem(prediction.itemName)
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : "Impossible d'ajouter")
    }
  }

  const addAll = async () => {
    if (!items || items.length === 0 || busy) return
    setBusy(true)
    try {
      for (const prediction of items) {
        await onAdd(prediction.itemName, 1, 'unité')
      }
      toasts.addItem(`${items.length} suggestions`)
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : "Impossible d'ajouter")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <button
        type="button"
        onClick={() => {
          hapticTap()
          setOpen((value) => !value)
        }}
        className="w-full flex items-center justify-between px-3 py-2.5 tap"
      >
        <span className="flex items-center gap-2">
          <Sparkles size={11} className="text-accent" />
          <span className="label-section">SUGGESTIONS INTELLIGENTES</span>
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
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1.5">
              {items === null && (
                <div className="flex items-center gap-2 py-3 justify-center text-slate-500">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="font-mono text-[10px]">Analyse des habitudes…</span>
                </div>
              )}

              {items !== null && items.length === 0 && (
                <p className="font-sans text-[11px] text-slate-500 py-2">
                  Pas encore assez d'historique — ajoute et termine quelques produits pour
                  débloquer les prédictions.
                </p>
              )}

              {items?.map((prediction) => (
                <div
                  key={prediction.normalized}
                  className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-2.5 py-2"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor:
                        prediction.urgency === 'high'
                          ? '#f87171'
                          : prediction.urgency === 'medium'
                            ? '#fbbf24'
                            : '#38bdf8',
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-sans text-[11px] text-white/85 truncate">
                      {prediction.itemName}
                    </div>
                    <div className="font-mono text-[8px] text-slate-500 truncate">
                      {prediction.reason}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void addOne(prediction)}
                    className="px-2 h-7 rounded-lg border border-accent/35 bg-accent/10 font-mono text-[9px] text-accent tap"
                  >
                    + Ajouter
                  </button>
                </div>
              ))}

              {items !== null && items.length > 0 && (
                <button
                  type="button"
                  onClick={() => void addAll()}
                  disabled={busy}
                  className="w-full h-8 rounded-lg border border-white/12 bg-white/[0.05] font-mono text-[10px] text-slate-200 tap disabled:opacity-50"
                >
                  {busy ? 'AJOUT…' : 'TOUT AJOUTER'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
