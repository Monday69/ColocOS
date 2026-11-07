import Decimal from 'decimal.js';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Greedy Debt Simplification Algorithm
//
// MODULE ISOLÉ — pas de dépendance Prisma, testable en pur unitaire.
//
// COMPLEXITÉ :
//   Temps  : O(n log n) — dominé par les deux tris initiaux
//   Espace : O(n)       — deux tableaux de taille n
//   Transactions générées : au plus n−1 (optimal théorique)
//
// PRÉCISION :
//   Tous les calculs utilisent Decimal.js (base 10 exacte).
//   Zéro flottant IEEE 754 dans tout ce module.
//   Seuil "zéro" : EPSILON = 0.005€ (demi-centime) pour absorber les
//   restes de répartition équitable (ex: 10€ / 3 = 3.333...€).
// ─────────────────────────────────────────────────────────────────────────────

// Configure Decimal.js pour la finance : 20 chiffres significatifs, ROUND_HALF_UP
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Seuil en dessous duquel une balance est considérée comme nulle (demi-centime) */
const EPSILON = new Decimal('0.005');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BalanceEntry {
  userId: string;
  name: string;
  colorHex: string;
  /** Solde net : positif = créditeur, négatif = débiteur */
  balance: Decimal;
}

export interface DebtTransaction {
  fromUserId: string;
  fromName: string;
  fromColorHex: string;
  toUserId: string;
  toName: string;
  toColorHex: string;
  /** Montant arrondi à 2 décimales */
  amount: number;
  amountDecimal: Decimal;
}

// ── Algorithme principal ──────────────────────────────────────────────────────

/**
 * Simplifie un ensemble de balances nettes en une liste minimale de virements.
 *
 * INVARIANT : sum(balances) doit être ≈ 0 (vérifié en entrée).
 *
 * ALGORITHME :
 *   1. Sépare débiteurs (balance < 0) et créditeurs (balance > 0)
 *   2. Trie chaque groupe par valeur absolue décroissante
 *   3. À chaque itération :
 *      a. Prend le plus gros débiteur D et le plus gros créditeur C
 *      b. Transfer = min(|balance_D|, balance_C)
 *      c. Génère le virement "D → C pour Transfer€"
 *      d. Met à jour les deux balances
 *      e. Retire celui qui atteint zéro, continue avec l'autre
 *   4. S'arrête quand tous les acteurs sont à zéro (± EPSILON)
 *
 * @param entries - Balances nettes de chaque utilisateur (Decimal.js)
 * @returns Liste de virements à effectuer, au plus n−1 transactions
 */
export function simplifyDebts(entries: BalanceEntry[]): DebtTransaction[] {
  // ── Validation de l'invariant de conservation ─────────────────────────────
  const totalSum = entries.reduce(
    (acc, e) => acc.plus(e.balance),
    new Decimal(0),
  );

  if (totalSum.abs().greaterThan(EPSILON.times(entries.length))) {
    throw new Error(
      `Violation de conservation : somme des balances = ${totalSum.toFixed(4)}€ ≠ 0. ` +
        'Vérifier le calcul des balances avant simplification.',
    );
  }

  // ── Copie mutable des balances ────────────────────────────────────────────
  // On travaille sur des copies pour ne pas muter les entrées originales
  const mutableEntries = entries.map((e) => ({ ...e, balance: e.balance }));

  // ── Séparation débiteurs / créditeurs ─────────────────────────────────────
  // Utilise des tableaux simples — les max-heaps seraient O(n log n) aussi
  // mais moins lisibles pour une taille n ≤ 10

  const debtors = mutableEntries
    .filter((e) => e.balance.lessThan(EPSILON.negated()))
    .sort((a, b) => a.balance.comparedTo(b.balance)); // croissant : plus négatif en premier

  const creditors = mutableEntries
    .filter((e) => e.balance.greaterThan(EPSILON))
    .sort((a, b) => b.balance.comparedTo(a.balance)); // décroissant : plus positif en premier

  const transactions: DebtTransaction[] = [];

  let di = 0; // index débiteur courant
  let ci = 0; // index créditeur courant

  while (di < debtors.length && ci < creditors.length) {
    const debtor   = debtors[di];
    const creditor = creditors[ci];

    // Montant du virement : min(dette, créance)
    const debtAbs = debtor.balance.abs();
    const credit  = creditor.balance;
    const transfer = Decimal.min(debtAbs, credit);

    // Arrondi à 2 décimales pour le virement réel
    const transferRounded = transfer.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    if (transferRounded.greaterThan(EPSILON)) {
      transactions.push({
        fromUserId:   debtor.userId,
        fromName:     debtor.name,
        fromColorHex: debtor.colorHex,
        toUserId:     creditor.userId,
        toName:       creditor.name,
        toColorHex:   creditor.colorHex,
        amount:       transferRounded.toNumber(),
        amountDecimal: transferRounded,
      });
    }

    // Mise à jour des balances
    debtor.balance   = debtor.balance.plus(transfer);   // devient moins négatif
    creditor.balance = creditor.balance.minus(transfer); // devient moins positif

    // Avance l'index de celui qui a atteint zéro (± EPSILON)
    if (debtor.balance.abs().lessThanOrEqualTo(EPSILON))   di++;
    if (creditor.balance.abs().lessThanOrEqualTo(EPSILON)) ci++;
  }

  return transactions;
}

// ── Helpers de précision monétaire ────────────────────────────────────────────

/**
 * Répartit un montant équitablement entre n participants, avec
 * redistribution du reste (centimes) aux premiers participants.
 *
 * Ex: 10.00€ / 3 → [3.34, 3.33, 3.33] (somme = 10.00 ✓)
 *
 * @param total       Montant total à répartir
 * @param count       Nombre de participants
 * @returns           Tableau de montants arrondis, somme = total
 */
export function splitEqually(total: Decimal, count: number): Decimal[] {
  if (count <= 0) throw new Error('count doit être > 0');

  // Division entière en centimes pour éviter tout flottant
  const totalCents = total.times(100).round().toNumber();
  const baseCents  = Math.floor(totalCents / count);
  const remainder  = totalCents % count; // centimes supplémentaires à distribuer

  return Array.from({ length: count }, (_, i) => {
    const cents = baseCents + (i < remainder ? 1 : 0);
    return new Decimal(cents).dividedBy(100);
  });
}

/**
 * Vérifie que la somme d'une répartition custom correspond au total
 * (tolérance : 1 centime pour les erreurs d'arrondi de saisie).
 */
export function validateCustomSplits(
  total: Decimal,
  splits: Array<{ amount: number }>,
): boolean {
  const sum = splits.reduce(
    (acc, s) => acc.plus(new Decimal(s.amount)),
    new Decimal(0),
  );
  return sum.minus(total).abs().lessThanOrEqualTo(new Decimal('0.01'));
}

/**
 * Arrondit un Decimal à 2 décimales (ROUND_HALF_UP) et retourne un number.
 * Utile pour la sérialisation JSON.
 */
export function toMoney(d: Decimal): number {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}