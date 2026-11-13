import { prisma } from '../config/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Suggestions intelligentes de liste de courses
//
// Analyse les StockEvent ADDED / FINISHED, groupés par nom normalisé :
//   • produits fréquents (>= 2 cycles) absents ou sous 20 % de stock
//   • produits cycliques dont la rupture est estimée sous 48 h
// ─────────────────────────────────────────────────────────────────────────────

export interface ShoppingPrediction {
  itemName: string
  normalized: string
  confidence: number
  urgency: 'high' | 'medium' | 'low'
  reason: string
  cycles: number
  averageIntervalDays: number | null
  lastEventAt: string
  inStock: boolean
  remainingRatio: number | null
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export class ShoppingPredictionService {
  async predict(limit = 8): Promise<ShoppingPrediction[]> {
    const [events, items] = await Promise.all([
      prisma.stockEvent.findMany({
        where: { eventType: { in: ['ADDED', 'FINISHED'] } },
        orderBy: { createdAt: 'asc' },
        select: { itemName: true, eventType: true, createdAt: true },
      }),
      prisma.item.findMany({
        where: { consumedAt: null },
        select: { name: true, quantity: true, initialQuantity: true },
      }),
    ]);

    const stockByName = new Map(
      items.map((item) => [
        normalize(item.name),
        {
          ratio:
            item.initialQuantity > 0 ? Number(item.quantity) / item.initialQuantity : null,
        },
      ]),
    );

    const groups = new Map<string, { label: string; added: Date[]; finished: Date[] }>();

    for (const event of events) {
      const key = normalize(event.itemName);
      const group = groups.get(key) ?? { label: event.itemName, added: [], finished: [] };
      if (event.eventType === 'ADDED') group.added.push(event.createdAt);
      else group.finished.push(event.createdAt);
      groups.set(key, group);
    }

    const predictions: ShoppingPrediction[] = [];
    const dayMs = 24 * 60 * 60 * 1000;

    for (const [key, group] of groups) {
      const cycles = Math.min(group.added.length, group.finished.length);
      if (cycles < 2) continue;

      // Intervalle moyen entre deux cycles « ajout → fin »
      const intervals: number[] = [];
      for (let i = 0; i < cycles; i += 1) {
        intervals.push((group.finished[i].getTime() - group.added[i].getTime()) / dayMs);
      }
      const avgInterval =
        intervals.length > 0
          ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
          : null;

      const lastAdded = group.added[group.added.length - 1];
      const stock = stockByName.get(key);
      const inStock = stock !== undefined;
      const remainingRatio = stock?.ratio ?? null;

      // Motif 1 : absent ou presque épuisé
      const nearlyEmpty = inStock && remainingRatio !== null && remainingRatio <= 0.2;
      if (!inStock || nearlyEmpty) {
        predictions.push({
          itemName: group.label,
          normalized: key,
          confidence: Math.min(1, 0.55 + cycles * 0.1),
          urgency: !inStock ? 'high' : 'medium',
          reason: !inStock
            ? `Stock épuisé · ${cycles} cycles observés`
            : `Stock à ${Math.round((remainingRatio ?? 0) * 100)} %`,
          cycles,
          averageIntervalDays: avgInterval !== null ? Math.round(avgInterval) : null,
          lastEventAt: lastAdded.toISOString(),
          inStock,
          remainingRatio,
        });
        continue;
      }

      // Motif 2 : rupture estimée sous 48 h
      if (avgInterval !== null && inStock) {
        const daysSinceAdd = (Date.now() - lastAdded.getTime()) / dayMs;
        const daysLeft = avgInterval - daysSinceAdd;
        if (daysLeft <= 2) {
          predictions.push({
            itemName: group.label,
            normalized: key,
            confidence: Math.min(1, 0.45 + cycles * 0.08),
            urgency: daysLeft <= 0 ? 'high' : 'medium',
            reason: `Cycle moyen : tous les ${Math.round(avgInterval)} jours · rupture estimée ${
              daysLeft <= 0 ? 'imminente' : `dans ${Math.ceil(daysLeft)} j`
            }`,
            cycles,
            averageIntervalDays: Math.round(avgInterval),
            lastEventAt: lastAdded.toISOString(),
            inStock,
            remainingRatio,
          });
        }
      }
    }

    const urgencyRank = { high: 0, medium: 1, low: 2 } as const;

    return predictions
      .sort(
        (a, b) =>
          urgencyRank[a.urgency] - urgencyRank[b.urgency] || b.confidence - a.confidence,
      )
      .slice(0, limit);
  }
}

export const shoppingPredictionService = new ShoppingPredictionService();
