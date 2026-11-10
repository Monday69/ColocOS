// FinanceModule.tsx
// ColocOS — Finance Module v2 (Hybrid-Pay Engine)
// Corrections appliquées vs version Gemini :
//   1. handleNfcScan : montant validé avant scan, result.fromName au lieu de 'Alice' hardcodé,
//      onreadingerror handler, messages d'erreur distincts NotAllowedError vs erreur matériel
//   2. Mode NFC : input montant + bouton MAX ajouté avant "ACTIVER LE LECTEUR"
//   3. /settle-nfc : route déclarée hors authenticate (voir finance.routes.ts)

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, TrendingUp, TrendingDown, Minus,
  CircleDollarSign, CheckCircle2, X, AlertCircle, Loader2,
  Nfc, QrCode, Cpu, Smartphone
} from 'lucide-react';
import clsx from 'clsx';
import { useFinance } from '@/hooks/useFinance';
import { useFinanceStore, useBridge, useAuth } from '@/store';
import { api } from '@/api/client';
import { toasts } from '@/components/ui/ToastProvider';
import type { UserBalance, DebtTransaction } from '@/types';

// ── Balance Card ──────────────────────────────────────────────────────────────

function BalanceCard({ balance, isCurrentUser }: { balance: UserBalance; isCurrentUser: boolean }) {
  const isCredit = balance.netBalance > 0;
  const isZero   = Math.abs(balance.netBalance) < 0.01;
  const statusColor = isZero ? '#5a5d6e' : isCredit ? '#00e676' : '#ff3b3b';
  const Icon = isZero ? Minus : isCredit ? TrendingUp : TrendingDown;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'relative flex items-center gap-3 p-3 rounded-lg border transition-all duration-200',
        'bg-surface-2/60 hover:bg-surface-3/60',
        isCurrentUser ? 'border-accent/40' : 'border-surface-border/50',
      )}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-mono font-500"
        style={{
          backgroundColor: balance.colorHex + '22',
          border: `1.5px solid ${balance.colorHex}60`,
          color: balance.colorHex,
          boxShadow: isCurrentUser ? `0 0 12px ${balance.colorHex}40` : undefined,
        }}
      >
        {balance.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-body text-sm text-text-primary truncate">{balance.name}</span>
          {isCurrentUser && <span className="font-mono text-2xs text-accent">VOUS</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-2xs text-text-tertiary">payé {balance.totalPaid.toFixed(2)}€</span>
          <span className="text-surface-border">·</span>
          <span className="font-mono text-2xs text-text-tertiary">doit {balance.totalOwed.toFixed(2)}€</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Icon size={12} style={{ color: statusColor }} />
        <span className="font-mono text-sm font-500" style={{ color: statusColor }}>
          {isZero ? '±0.00' : `${isCredit ? '+' : ''}${balance.netBalance.toFixed(2)}`}€
        </span>
      </div>
    </motion.div>
  );
}

// ── Debt Row ──────────────────────────────────────────────────────────────────

function DebtRow({ debt, canSettle, onSettle, index }: {
  debt: DebtTransaction; canSettle: boolean; onSettle: () => void; index: number;
}) {
  const { setHighlightedOwnerColor } = useBridge();

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 }}
      className="group flex items-center gap-3 p-3 rounded-lg border border-surface-border/30 bg-surface-2/40 hover:bg-surface-3/50 hover:border-surface-border transition-all duration-200 cursor-default"
      onMouseEnter={() => setHighlightedOwnerColor(debt.toColorHex)}
      onMouseLeave={() => setHighlightedOwnerColor(null)}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-2xs font-mono flex-shrink-0"
          style={{ backgroundColor: debt.fromColorHex + '22', border: `1px solid ${debt.fromColorHex}50`, color: debt.fromColorHex }}>
          {debt.fromName.charAt(0)}
        </div>
        <span className="font-body text-sm text-text-secondary truncate">{debt.fromName}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <ArrowRight size={12} className="text-text-tertiary" />
        <span className="font-mono text-sm font-500 text-text-primary">{debt.amount.toFixed(2)}€</span>
        <ArrowRight size={12} className="text-text-tertiary" />
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
        <span className="font-body text-sm text-text-secondary truncate text-right">{debt.toName}</span>
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-2xs font-mono flex-shrink-0"
          style={{ backgroundColor: debt.toColorHex + '22', border: `1px solid ${debt.toColorHex}50`, color: debt.toColorHex }}>
          {debt.toName.charAt(0)}
        </div>
      </div>
      {canSettle && (
        <button onClick={onSettle}
          className="ml-2 flex-shrink-0 px-2 py-1 rounded border border-accent/40 text-accent font-mono text-2xs hover:bg-accent/10 hover:border-accent transition-all opacity-0 group-hover:opacity-100">
          RÉGLER
        </button>
      )}
    </motion.div>
  );
}

// ── Settle Modal — Hybrid-Pay Engine ─────────────────────────────────────────

function SettleModal() {
  const { settleModal, closeSettleModal } = useFinanceStore();
  const [paymentMode, setPaymentMode] = useState<'manual' | 'nfc' | 'qr'>('manual');
  const [nfcStatus, setNfcStatus] = useState<'idle' | 'scanning' | 'success'>('idle');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useFinance();

  if (!settleModal) return null;

  // ── NFC (Hybrid-Pay) ────────────────────────────────────────────────────────
  // Correction 1 : validation montant AVANT le scan (UX — évite le scan sans montant)
  // Correction 2 : result.fromName au lieu de 'Alice' hardcodé
  // Correction 3 : onreadingerror handler + messages d'erreur distincts
  const handleNfcScan = async () => {
    // Support check — NDEFReader uniquement Chrome Android (pas iOS, pas Firefox desktop)
    if (!('NDEFReader' in window)) {
      setError('Web NFC non supporté. Utilisez Chrome sur Android, ou passez en mode Manuel.');
      return;
    }

    const val = parseFloat(amount) || settleModal.maxAmount;
    if (isNaN(val) || val <= 0) {
      setError('Entrez un montant valide avant de scanner.');
      return;
    }

    try {
      setError(null);
      setNfcStatus('scanning');
      const reader = new (window as any).NDEFReader();
      await reader.scan();

      reader.onreading = async ({ serialNumber }: { serialNumber: string }) => {
        setLoading(true);
        try {
          // result.fromName provient du backend (settleByBadge → settleDebt → fromUser.name)
          const result = (await api.settleByNfc(serialNumber, settleModal.toUserId, val, note || undefined)) as any;
          setNfcStatus('success');
          await refresh();
          toasts.settle(result.fromName, settleModal.toName, val, settleModal.toColorHex);
          setTimeout(closeSettleModal, 1500);
        } catch (err: any) {
          setError(err.message || 'Badge non reconnu. Associez d\'abord votre badge dans le profil.');
          setNfcStatus('idle');
        } finally {
          setLoading(false);
        }
      };

      reader.onreadingerror = () => {
        setError('Erreur de lecture du tag NFC. Réessayez.');
        setNfcStatus('idle');
      };
    } catch (err: any) {
      setNfcStatus('idle');
      setError(
        err?.name === 'NotAllowedError'
          ? 'Permission NFC refusée. Autorisez le NFC dans les paramètres du navigateur.'
          : 'Erreur matériel NFC. Vérifiez que le NFC est activé sur votre appareil.'
      );
    }
  };

  const handleManualSettle = async () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) { setError('Montant invalide'); return; }
    setLoading(true);
    try {
      await api.settleDebt(settleModal.toUserId, val, note || undefined);
      await refresh();
      toasts.settle('Vous', settleModal.toName, val, settleModal.toColorHex);
      closeSettleModal();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={closeSettleModal} />
      <motion.div
        initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 16 }}
        className="relative w-full max-w-sm panel p-6 rounded-2xl border-t-2"
        style={{ borderColor: settleModal.toColorHex + '50', boxShadow: `0 0 60px ${settleModal.toColorHex}15` }}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="label-section mb-1">HYBRID-PAY ENGINE</div>
            <h3 className="font-display text-lg font-600 text-text-primary">
              Régler à <span style={{ color: settleModal.toColorHex }}>{settleModal.toName}</span>
            </h3>
          </div>
          <button onClick={closeSettleModal} className="text-text-tertiary hover:text-text-primary"><X size={18}/></button>
        </div>

        {/* Mode Selector */}
        <div className="flex p-1 bg-surface-3 rounded-xl mb-6 border border-surface-border/50">
          {([
            { id: 'manual', icon: Smartphone, label: 'MANUEL' },
            { id: 'nfc',    icon: Cpu,        label: 'BADGE' },
            { id: 'qr',     icon: QrCode,     label: 'SCAN QR' }
          ] as const).map((mode) => (
            <button
              key={mode.id}
              onClick={() => { setPaymentMode(mode.id); setError(null); setNfcStatus('idle'); }}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-mono text-[10px] transition-all',
                paymentMode === mode.id
                  ? 'bg-accent text-black font-bold shadow-lg'
                  : 'text-text-tertiary hover:text-text-primary'
              )}
            >
              <mode.icon size={14} /> {mode.label}
            </button>
          ))}
        </div>

        {/* Dynamic Content */}
        <div className="min-h-[220px] flex flex-col">

          {/* ── MODE MANUEL ── */}
          {paymentMode === 'manual' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div>
                <label className="label-section block mb-2">MONTANT (€)</label>
                <div className="relative">
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                    placeholder={settleModal.maxAmount.toFixed(2)}
                    className="w-full bg-surface-3 border border-surface-border rounded-lg px-3 py-2.5 font-mono text-sm text-text-primary focus:border-accent outline-none" />
                  <button onClick={() => setAmount(settleModal.maxAmount.toFixed(2))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-2xs text-accent">MAX</button>
                </div>
              </div>
              <div>
                <label className="label-section block mb-2">NOTE (OPTIONNEL)</label>
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex: Virement Lydia, Courses..."
                  className="w-full bg-surface-3 border border-surface-border rounded-lg px-3 py-2 font-body text-xs text-text-primary outline-none focus:border-accent transition-all" />
              </div>
              <button onClick={handleManualSettle} disabled={loading}
                className="w-full py-3 rounded-lg bg-accent text-black font-mono font-bold text-xs hover:bg-accent-bright transition-all disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin mx-auto" size={16}/> : 'CONFIRMER LE VIREMENT'}
              </button>
            </div>
          )}

          {/* ── MODE NFC (BADGE) ── */}
          {paymentMode === 'nfc' && (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-2 animate-in zoom-in-95 duration-300">
              <div className={clsx(
                'w-20 h-20 rounded-full flex items-center justify-center mb-4 border-2 transition-all duration-500',
                nfcStatus === 'scanning'
                  ? 'border-accent bg-accent/10 animate-pulse shadow-[0_0_20px_rgba(79,195,247,0.3)]'
                  : nfcStatus === 'success'
                  ? 'border-health-ok bg-health-ok/10'
                  : 'border-surface-border bg-surface-3'
              )}>
                <Nfc size={32} className={
                  nfcStatus === 'scanning' ? 'text-accent'
                  : nfcStatus === 'success' ? 'text-health-ok'
                  : 'text-text-tertiary'
                } />
              </div>

              <p className="font-display text-sm text-text-primary mb-1 uppercase tracking-tight">
                {nfcStatus === 'scanning' ? 'Recherche du badge...' :
                 nfcStatus === 'success'  ? 'Paiement validé !' :
                                            'Prêt pour scan'}
              </p>
              <p className="text-[10px] text-text-tertiary font-mono mb-4">APPROCHEZ VOTRE TAG NFC</p>

              {/* Correction 2 : input montant présent en mode NFC avant le scan */}
              {nfcStatus === 'idle' && (
                <div className="w-full space-y-3">
                  <div>
                    <label className="label-section block mb-1.5">MONTANT (€)</label>
                    <div className="relative">
                      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                        placeholder={settleModal.maxAmount.toFixed(2)}
                        className="w-full bg-surface-3 border border-surface-border rounded-lg px-3 py-2 font-mono text-sm text-text-primary focus:border-accent outline-none text-center" />
                      <button onClick={() => setAmount(settleModal.maxAmount.toFixed(2))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-2xs text-accent">MAX</button>
                    </div>
                  </div>
                  <button onClick={handleNfcScan}
                    className="w-full px-6 py-2 rounded-full border border-accent text-accent font-mono text-xs hover:bg-accent hover:text-black transition-all">
                    ACTIVER LE LECTEUR
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── MODE QR (placeholder) ── */}
          {paymentMode === 'qr' && (
            <div className="flex-1 flex flex-col items-center justify-center py-2 animate-in zoom-in-95 duration-300">
              <div className="p-3 bg-white rounded-xl mb-4 shadow-xl">
                <QrCode size={100} className="text-black" />
              </div>
              <p className="text-[10px] text-text-tertiary font-mono uppercase tracking-widest text-center mb-2">
                {settleModal.toName} scanne ce QR pour recevoir le paiement
              </p>
              <p className="text-[10px] text-accent/60 font-mono text-center">
                — Implémentation à venir (html5-qrcode) —
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 p-2.5 rounded-lg bg-health-critical-glow border border-health-critical/30 flex items-center gap-2">
            <AlertCircle size={14} className="text-health-critical flex-shrink-0" />
            <span className="font-mono text-[10px] text-health-critical uppercase leading-relaxed">{error}</span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function FinanceModule() {
  const { user } = useAuth();
  const { financeStatus, isFinanceLoading, financeError, settleModal, openSettleModal } = useFinanceStore();
  useFinance();

  const stats = financeStatus?.monthlyStats;
  const CATEGORY_LABELS: Record<string, string> = {
    groceries: 'COURSES', utilities: 'CHARGES', rent: 'LOYER', other: 'AUTRE',
  };

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div>
            <div className="label-section">MODULE FINANCIER</div>
            <h2 className="font-display text-2xl font-black tracking-wider text-white uppercase mt-0.5">
              Tricount <span className="text-accent">Coloc</span>
            </h2>
          </div>
          {stats && (
            <div className="text-right">
              <div className="font-mono text-lg font-500 text-text-primary">{stats.totalSpent.toFixed(2)}€</div>
              <div className="label-section">
                {new Date(stats.year, stats.month - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase()}
              </div>
            </div>
          )}
        </div>

        {/* Category breakdown */}
        {stats && Object.keys(stats.byCategory).length > 0 && (
          <div className="flex gap-2 mb-4 flex-shrink-0">
            {Object.entries(stats.byCategory).map(([cat, amount]) => (
              <div key={cat} className="flex-1 panel px-2 py-1.5 rounded-lg text-center min-w-0">
                <div className="font-mono text-xs text-text-primary">{(amount as number).toFixed(0)}€</div>
                <div className="font-display text-2xs text-text-tertiary tracking-widest">{CATEGORY_LABELS[cat] ?? cat.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
          {isFinanceLoading && !financeStatus && (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          )}
          {financeError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-health-critical-glow border border-health-critical/30">
              <AlertCircle size={14} className="text-health-critical" />
              <span className="font-mono text-xs text-health-critical">{financeError}</span>
            </div>
          )}

          {financeStatus && (
            <>
              {/* Balances */}
              <section>
                <div className="label-section mb-2">BALANCES NETTES</div>
                <div className="space-y-1.5">
                  {financeStatus.allBalances.map((b, i) => (
                    <motion.div key={b.userId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                      <BalanceCard balance={b} isCurrentUser={b.userId === user?.id} />
                    </motion.div>
                  ))}
                </div>
              </section>

              {/* Simplified debts */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="label-section">VIREMENTS SUGGÉRÉS</div>
                  <div className="flex items-center gap-1.5">
                    <CircleDollarSign size={11} className="text-text-tertiary" />
                    <span className="font-mono text-2xs text-text-tertiary">
                      {financeStatus.simplifiedDebts.length} transaction{financeStatus.simplifiedDebts.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {financeStatus.simplifiedDebts.length === 0 ? (
                  <div className="flex items-center justify-center py-6 rounded-lg border border-surface-border/30 bg-surface-2/30">
                    <div className="text-center">
                      <CheckCircle2 size={20} className="text-health-ok mx-auto mb-1.5" />
                      <div className="font-mono text-xs text-text-tertiary">TOUT LE MONDE EST À L'ÉQUILIBRE</div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {financeStatus.simplifiedDebts.map((debt, i) => (
                      <DebtRow
                        key={`${debt.fromUserId}-${debt.toUserId}`}
                        debt={debt} index={i}
                        canSettle={debt.fromUserId === user?.id}
                        onSettle={() => openSettleModal(debt.toUserId, debt.toName, debt.toColorHex, debt.amount)}
                      />
                    ))}
                  </div>
                )}
                <p className="font-mono text-2xs text-text-tertiary mt-2 leading-relaxed">
                  Survolez une dette pour illuminer les zones du créancier dans la scène 3D.
                </p>
              </section>
            </>
          )}
        </div>
      </div>

      {/* Settle Modal */}
      <AnimatePresence>
        {settleModal?.open && <SettleModal key="settle-modal" />}
      </AnimatePresence>
    </>
  );
}