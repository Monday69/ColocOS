import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, Plus, Check, Sparkles,
  Loader2, AlertCircle, X,
} from 'lucide-react';
import clsx from 'clsx';
import { useShopping } from '@/hooks/useShopping';
import { toasts } from '@/components/ui/ToastProvider';
import type { ShoppingItem } from '@/types';

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
          <div className="label-section">LISTE DE COURSES</div>
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