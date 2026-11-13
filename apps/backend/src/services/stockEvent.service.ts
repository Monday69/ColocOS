import { StockEventType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Stock events (journal structuré des mouvements)
//
// Écriture systématiquement non bloquante : une erreur de journalisation ne
// doit jamais faire échouer une action utilisateur (ajout, consommation…).
// ─────────────────────────────────────────────────────────────────────────────

export interface StockEventInput {
  itemId?: string | null;
  itemName: string;
  category?: string | null;
  zoneId?: string | null;
  userId?: string | null;
  eventType: StockEventType;
  quantityRatio?: number | null;
  unitCost?: number | null;
  daysToExpiry?: number | null;
}

/** Jours restants avant la DLC (négatif si dépassée). */
export function daysToExpiry(expiryDate: Date | null | undefined, now: Date = new Date()): number | null {
  if (!expiryDate) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = Date.UTC(
    expiryDate.getUTCFullYear(),
    expiryDate.getUTCMonth(),
    expiryDate.getUTCDate(),
  );
  return Math.round((target - today) / dayMs);
}

export async function recordStockEvent(input: StockEventInput): Promise<void> {
  try {
    await prisma.stockEvent.create({
      data: {
        itemId: input.itemId ?? null,
        itemName: input.itemName.slice(0, 255),
        category: input.category ?? null,
        zoneId: input.zoneId ?? null,
        userId: input.userId ?? null,
        eventType: input.eventType,
        quantityRatio: input.quantityRatio ?? null,
        unitCost: input.unitCost ?? null,
        daysToExpiry: input.daysToExpiry ?? null,
      },
    });
  } catch (err) {
    logger.warn(`[StockEvent] Journalisation ignorée : ${String(err)}`);
  }
}
