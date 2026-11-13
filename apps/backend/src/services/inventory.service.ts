import { Prisma, Unit } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { profileService } from './profile.service';
import { daysToExpiry, recordStockEvent } from './stockEvent.service';
import {
  CreateItemDTO,
  ConsumeItemDTO,
  ListItemsQueryDTO,
  QuickAddDTO,
} from '../dtos/inventory.dto';
import { ItemSummary } from '../types';
import {
  FRESH_CATEGORIES,
  FRESH_PRESETS,
  findPreset,
  type FreshCategory,
  type FreshPreset,
} from '../constants/freshPresets';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Inventory Service
// ─────────────────────────────────────────────────────────────────────────────

// Seuil d'alerte expiration (en jours)
const EXPIRY_ALERT_THRESHOLD_DAYS = 7;

// ── Types internes ────────────────────────────────────────────────────────────

export interface ExpiryAlert {
  item: ItemSummary;
  storageZoneLabel: string;
  daysUntilExpiry: number;
  isExpired: boolean;
}

export interface ConsumeResult {
  remainingQuantity: number;
  wasExhausted: boolean;
  addedToShoppingList: boolean;
}

/** Résultat de `quickAddItem` (Sprint 3 — aliments frais sans code-barres). */
export interface QuickAddResult {
  item: ItemSummary & { storageZoneLabel: string };
  zoneId: string;
  zoneLabel: string;
  zoneMeshId: string;
  expiryDate: string;
  presetApplied: {
    id: string;
    name: string;
    shelfLifeDays: number;
    category: string;
  } | null;
}

/** Résultat de `consumeItemQuantity` (consommation progressive). */
export interface ConsumePartResult {
  item: ItemSummary & { storageZoneLabel: string };
  isFullyConsumed: boolean;
  remainingQuantity: number;
  addedToShoppingList: boolean;
}

export interface PaginatedItems {
  items: (ItemSummary & { storageZoneLabel: string; storageZoneMeshId: string })[];
  total: number;
  page: number;
  limit: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Date calendaire locale à midi, ramenée à minuit UTC (colonne `@db.Date`). */
function localDatePlusDays(base: Date, days: number): Date {
  const noon = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, 12, 0, 0);
  return new Date(Date.UTC(noon.getFullYear(), noon.getMonth(), noon.getDate()));
}

/** `YYYY-MM-DD`. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse `YYYY-MM-DD` en date UTC (évite tout décalage de fuseau). */
function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'Date de péremption invalide (format attendu : YYYY-MM-DD).');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, 'Date de péremption invalide.');
  }
  return parsed;
}

function toItemSummary(item: {
  id: string;
  name: string;
  brand: string | null;
  quantity: Prisma.Decimal;
  unit: Unit;
  expiryDate: Date | null;
  imageUrl: string | null;
  nutriscore: string | null;
  isShared: boolean;
  ownerId: string | null;
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fat: number | null;
  fiber: number | null;
  novaGroup: number | null;
  /** Quantité de référence pour la jauge (posée à la création) */
  initialQuantity: number;
  /** Date de fin de l'article (soft-delete) */
  consumedAt: Date | null;
}): ItemSummary {
  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    quantity: Number(item.quantity),
    unit: item.unit,
    expiryDate: item.expiryDate?.toISOString().split('T')[0] ?? null,
    imageUrl: item.imageUrl,
    nutriscore: item.nutriscore,
    isShared: item.isShared,
    ownerId: item.ownerId,
    calories: item.calories,
    proteins: item.proteins,
    carbohydrates: item.carbohydrates,
    fat: item.fat,
    fiber: item.fiber,
    novaGroup: item.novaGroup,
    initialQuantity: item.initialQuantity,
    consumedAt: item.consumedAt ? item.consumedAt.toISOString() : null,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class InventoryService {
  /**
   * Ajoute un item au stock dans une zone de stockage spécifiée.
   * Logue l'action dans activity_log.
   */
  async addItem(
    data: CreateItemDTO,
    userId?: string,
  ): Promise<ItemSummary & { storageZoneLabel: string }> {
    // Vérification que la zone existe
    const zone = await prisma.storageZone.findUnique({
      where: { id: data.storageZoneId },
    });

    if (!zone) {
      throw new AppError(404, `Zone de stockage introuvable : ${data.storageZoneId}`);
    }

    // Création de l'item
    const item = await prisma.item.create({
      data: {
        name: data.name,
        brand: data.brand ?? null,
        barcode: data.barcode ?? null,
        quantity: data.quantity,
        unit: data.unit as Unit,
        initialQuantity: data.quantity,
        expiryDate: data.expiryDate ?? null,
        imageUrl: data.imageUrl ?? null,
        nutriscore: data.nutriscore ?? null,
        calories: data.calories ?? null,
        proteins: data.proteins ?? null,
        carbohydrates: data.carbohydrates ?? null,
        fat: data.fat ?? null,
        fiber: data.fiber ?? null,
        novaGroup: data.novaGroup ?? null,
        isShared: data.isShared,
        storageZoneId: data.storageZoneId,
        ownerId: data.ownerId ?? userId ?? null,
      },
    });

    void recordStockEvent({
      itemId: item.id,
      itemName: item.name,
      zoneId: item.storageZoneId,
      userId,
      eventType: 'ADDED',
      quantityRatio: 1,
      unitCost: item.unitCost === null ? null : Number(item.unitCost),
      daysToExpiry: daysToExpiry(item.expiryDate),
    });

    // Log d'activité
    if (userId) {
      await prisma.activityLog.create({
        data: {
          action: 'ITEM_ADDED',
          userId,
          meta: {
            itemId: item.id,
            itemName: item.name,
            zoneName: zone.label,
            quantity: data.quantity,
            unit: data.unit,
          },
        },
      });
    }

    logger.info(`[Inventory] Item ajouté : ${item.name} (id: ${item.id}) → zone "${zone.label}"`);

    return {
      ...toItemSummary(item),
      storageZoneLabel: zone.label,
    };
  }

  /**
   * Consomme une quantité d'un item (API historique : quantité libre).
   *
   * Depuis Sprint 2 le stock épuisé n'est plus supprimé : `quantity` passe à 0
   * et `consumedAt` est renseigné (soft-delete). L'item sort du twin et de
   * l'inventaire actif, mais l'historique et la traçabilité sont conservés.
   */
  async consumeItem(
    itemId: string,
    dto: ConsumeItemDTO,
    userId?: string,
  ): Promise<ConsumeResult> {
    const result = await this.consumeCore(itemId, dto.quantity, userId);

    return {
      remainingQuantity: result.remainingQuantity,
      wasExhausted: result.isFullyConsumed,
      addedToShoppingList: result.addedToShoppingList,
    };
  }

  /**
   * Consommation progressive (Sprint 2) : `POST /inventory/items/:id/consume-part`.
   * Renvoie l'item mis à jour (pour la jauge du tooltip 3D) et le drapeau
   * `isFullyConsumed` qui déclenche la fermeture de la fiche côté front.
   */
  async consumeItemQuantity(
    itemId: string,
    userId: string | undefined,
    amount: number,
  ): Promise<ConsumePartResult> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(400, 'La quantité consommée doit être strictement positive.');
    }

    const result = await this.consumeCore(itemId, amount, userId);

    return {
      item: {
        ...toItemSummary(result.item),
        storageZoneLabel: result.item.storageZone.label,
      },
      isFullyConsumed: result.isFullyConsumed,
      remainingQuantity: result.remainingQuantity,
      addedToShoppingList: result.addedToShoppingList,
    };
  }

  /**
   * Cœur de la consommation, partagé par les deux routes.
   * - quantité restante arrondie au centième (colonne Decimal(8,2)) ;
   * - `consumedAt` posé une seule fois, à l'atteinte de 0 ;
   * - réassort automatique dans la liste de courses si l'item était partagé.
   */
  private async consumeCore(
    itemId: string,
    amount: number,
    userId?: string,
  ): Promise<{
    item: Prisma.ItemGetPayload<{ include: { storageZone: true } }>;
    isFullyConsumed: boolean;
    remainingQuantity: number;
    addedToShoppingList: boolean;
  }> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: { storageZone: true },
    });

    if (!item) {
      throw new AppError(404, `Item introuvable : ${itemId}`);
    }
    if (item.consumedAt) {
      throw new AppError(409, 'Cet article est déjà terminé.');
    }

    const currentQty = Number(item.quantity);
    const remaining = Math.max(0, Math.round((currentQty - amount) * 100) / 100);
    const isFullyConsumed = remaining <= 0;

    const updated = await prisma.item.update({
      where: { id: itemId },
      data: {
        quantity: new Prisma.Decimal(remaining),
        ...(isFullyConsumed ? { consumedAt: new Date() } : {}),
      },
      include: { storageZone: true },
    });

    logger.debug(
      `[Inventory] Consommation ${isFullyConsumed ? 'TOTALE' : 'partielle'} : ${item.name} → ${remaining} ${item.unit}`,
    );

    // Journal structuré : la première baisse de quantité vaut « ouverture ».
    // Les deux écritures sont séquencées (et non lancées en parallèle) pour que
    // `OPENED` précède toujours `CONSUMED_PARTIAL` dans l'historique.
    const ratio = currentQty > 0 ? Math.round(Math.min(1, amount / currentQty) * 1000) / 1000 : null;
    const wasUntouched = Math.abs(currentQty - item.initialQuantity) < 0.001;
    const baseEvent = {
      itemId: item.id,
      itemName: item.name,
      zoneId: item.storageZoneId,
      userId: userId ?? null,
      unitCost: item.unitCost === null ? null : Number(item.unitCost),
      daysToExpiry: daysToExpiry(item.expiryDate),
    };

    void (async () => {
      if (wasUntouched && !isFullyConsumed) {
        await recordStockEvent({ ...baseEvent, eventType: 'OPENED', quantityRatio: ratio });
      }
      await recordStockEvent({
        ...baseEvent,
        eventType: isFullyConsumed ? 'FINISHED' : 'CONSUMED_PARTIAL',
        quantityRatio: isFullyConsumed ? 1 : ratio,
      });
    })();

    // Journal macros : non bloquant (une erreur de tracking ne doit jamais
    // faire échouer une consommation de stock).
    if (userId && (item.calories !== null || item.proteins !== null)) {
      const grams = item.unit === 'g' || item.unit === 'ml' ? amount : amount * 100;
      const ratio = grams / 100;
      void profileService
        .logConsumption({
          userId,
          label: item.name,
          kcal: (item.calories ?? 0) * ratio,
          proteinG: (item.proteins ?? 0) * ratio,
          carbsG: (item.carbohydrates ?? 0) * ratio,
          fatG: (item.fat ?? 0) * ratio,
          source: 'STOCK_ACTION',
        })
        .catch((err) => logger.warn(`[Nutrition] Journal stock ignoré : ${String(err)}`));
    }

    if (userId) {
      await prisma.activityLog.create({
        data: {
          action: isFullyConsumed ? 'ITEM_REMOVED' : 'ITEM_CONSUMED_PARTIAL',
          userId,
          meta: {
            itemId,
            itemName: item.name,
            amount,
            remaining,
            unit: item.unit,
            ...(isFullyConsumed
              ? { reason: 'consumed', zoneName: item.storageZone.label }
              : {}),
          },
        },
      });
    }

    let addedToShoppingList = false;
    if (isFullyConsumed && item.isShared) {
      addedToShoppingList = await this.autoAddToShoppingList(item, userId);
    }

    return {
      item: updated,
      isFullyConsumed,
      remainingQuantity: remaining,
      addedToShoppingList,
    };
  }

  /**
   * Bascule un item en libre-service (`isShared: true`).
   *
   * Appelé par le bouton d'action d'une notification de péremption
   * (`POST /api/items/:id/share`), donc aussi depuis le Service Worker :
   * aucune ouverture de l'interface 3D n'est nécessaire.
   */
  async shareItem(
    itemId: string,
    userId?: string,
  ): Promise<{ id: string; name: string; isShared: boolean }> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true, name: true, isShared: true },
    });

    if (!item) throw new AppError(404, `Item introuvable : ${itemId}`);

    if (!item.isShared) {
      await prisma.item.update({ where: { id: itemId }, data: { isShared: true } });

      if (userId) {
        await prisma.activityLog.create({
          data: {
            action: 'ITEM_UPDATED',
            userId,
            meta: { itemId, itemName: item.name, isShared: true, reason: 'shared' },
          },
        });
      }

      logger.debug(`[Inventory] Item mis en libre-service : ${item.name}`);
    }

    return { id: item.id, name: item.name, isShared: true };
  }

  /**
   * Supprime définitivement un item du stock (consommation totale explicite).
   *
   * Différence avec consumeItem(quantity = tout le stock) :
   *   - pas d'ajout automatique à la liste de courses (suppression volontaire)
   *   - 404 propre si l'item n'existe pas
   */
  async deleteItem(
    itemId: string,
    userId?: string,
  ): Promise<{ deletedId: string; name: string }> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: { storageZone: true },
    });

    if (!item) {
      throw new AppError(404, `Item introuvable : ${itemId}`);
    }

    // Suppression volontaire = perte assumée (jeté / périmé)
    void recordStockEvent({
      itemId: item.id,
      itemName: item.name,
      zoneId: item.storageZoneId,
      userId: userId ?? null,
      eventType: 'WASTED',
      quantityRatio: 1,
      unitCost: item.unitCost === null ? null : Number(item.unitCost),
      daysToExpiry: daysToExpiry(item.expiryDate),
    });

    await prisma.item.delete({ where: { id: itemId } });

    if (userId) {
      await prisma.activityLog.create({
        data: {
          action: 'ITEM_REMOVED',
          userId,
          meta: {
            itemId,
            itemName: item.name,
            zoneName: item.storageZone.label,
            reason: 'deleted',
          },
        },
      });
    }

    logger.info(`[Inventory] Item supprimé : ${item.name} (id: ${itemId})`);

    return { deletedId: itemId, name: item.name };
  }

  /**
   * Ajoute automatiquement un item épuisé à la liste de courses active.
   * Évite les doublons (vérifie si un item pending avec le même nom existe déjà).
   */
  private async autoAddToShoppingList(
    item: { name: string; barcode: string | null; unit: Unit },
    userId?: string,
  ): Promise<boolean> {
    // Récupère la liste de courses active (non archivée, la plus récente)
    let activeList = await prisma.shoppingList.findFirst({
      where: { isArchived: false },
      orderBy: { createdAt: 'desc' },
    });

    // Crée une liste si elle n'existe pas
    if (!activeList) {
      activeList = await prisma.shoppingList.create({
        data: { name: 'Liste de courses' },
      });
    }

    // Vérifie qu'un item identique n'est pas déjà en attente
    const existingShoppingItem = await prisma.shoppingItem.findFirst({
      where: {
        shoppingListId: activeList.id,
        name: { equals: item.name, mode: 'insensitive' },
        status: 'pending',
      },
    });

    if (existingShoppingItem) {
      logger.debug(`[Inventory] "${item.name}" déjà en liste de courses — pas de doublon`);
      return false;
    }

    await prisma.shoppingItem.create({
      data: {
        name: item.name,
        barcode: item.barcode ?? null,
        unit: item.unit,
        quantity: 1,
        status: 'pending',
        isAutoSuggested: true,
        shoppingListId: activeList.id,
        addedById: userId ?? null,
      },
    });

    if (userId) {
      await prisma.activityLog.create({
        data: {
          action: 'SHOPPING_ITEM_ADDED',
          userId,
          meta: { itemName: item.name, reason: 'auto_exhausted' },
        },
      });
    }

    logger.info(`[Inventory] "${item.name}" ajouté automatiquement à la liste de courses`);
    return true;
  }

  /**
   * Retourne tous les items proches de leur date d'expiration ou déjà expirés.
   * Triés par urgence (expirés en premier, puis par date croissante).
   */
  // ── Sprint 3 : ajout rapide d'aliments frais (sans code-barres) ────────────

  /**
   * Catalogue des presets frais, prêt pour l'UI : catégories, DLC précalculées
   * (J+n) et libellés de zone.
   */
  getFreshPresets(): {
    categories: FreshCategory[];
    presets: Array<FreshPreset & { shelfLifeLabel: string; defaultExpiryDate: string }>;
  } {
    return {
      categories: FRESH_CATEGORIES,
      presets: FRESH_PRESETS.map((preset) => ({
        ...preset,
        shelfLifeLabel: `J+${preset.shelfLifeDays}`,
        defaultExpiryDate: toIsoDate(localDatePlusDays(new Date(), preset.shelfLifeDays)),
      })),
    };
  }

  /**
   * Ajout rapide d'un aliment frais :
   * - un preset fournit nom, macros, unité, durée sanitaire et zone conseillée ;
   * - la zone est résolue automatiquement (meshId conseillé → clayette du
   *   milieu → n'importe quelle zone frigo) si `storageZoneId` est absent ;
   * - `expiryDate = aujourd'hui + shelfLifeDays` à minuit local, sauf override.
   */
  async quickAddItem(userId: string, dto: QuickAddDTO): Promise<QuickAddResult> {
    const preset = dto.presetId ? findPreset(dto.presetId) : undefined;
    if (dto.presetId && !preset) {
      throw new AppError(400, `Preset inconnu : ${dto.presetId}`);
    }

    const name = (dto.name ?? preset?.name ?? '').trim();
    if (!name) {
      throw new AppError(400, "Le nom de l'aliment est requis.");
    }
    if (name.length > 120) {
      throw new AppError(400, 'Le nom ne peut pas dépasser 120 caractères.');
    }

    const quantity = dto.quantity ?? preset?.defaultQty ?? 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new AppError(400, 'La quantité doit être strictement positive.');
    }

    const unit = (dto.unit ?? preset?.unit ?? 'unit') as Unit;
    if (!Object.values(Unit).includes(unit)) {
      throw new AppError(400, `Unité invalide : ${unit}`);
    }

    const shelfLifeDays = dto.shelfLifeDays ?? preset?.shelfLifeDays ?? 5;
    if (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 0 || shelfLifeDays > 3650) {
      throw new AppError(400, 'La durée de conservation doit être comprise entre 0 et 3650 jours.');
    }

    const zone = await this.resolveQuickAddZone(dto.storageZoneId, preset?.zoneMeshId);

    const expiryDate = dto.expiryDate
      ? parseIsoDate(dto.expiryDate)
      : localDatePlusDays(new Date(), shelfLifeDays);

    const created = await prisma.item.create({
      data: {
        name,
        brand: null,
        quantity: new Prisma.Decimal(quantity),
        initialQuantity: quantity,
        unit,
        expiryDate,
        imageUrl: null,
        nutriscore: null,
        isShared: dto.isShared ?? false,
        calories: preset?.calories ?? null,
        proteins: preset?.proteins ?? null,
        storageZoneId: zone.id,
        ownerId: userId,
      },
      include: { storageZone: true },
    });

    void recordStockEvent({
      itemId: created.id,
      itemName: created.name,
      zoneId: created.storageZoneId,
      userId,
      eventType: 'ADDED',
      quantityRatio: 1,
      unitCost: created.unitCost === null ? null : Number(created.unitCost),
      daysToExpiry: daysToExpiry(created.expiryDate),
    });

    await prisma.activityLog.create({
      data: {
        action: 'ITEM_ADDED',
        userId,
        meta: {
          itemId: created.id,
          itemName: created.name,
          zoneName: zone.label,
          quantity,
          unit,
          quickAdd: true,
          ...(preset ? { presetId: preset.id, shelfLifeDays } : {}),
          expiryDate: toIsoDate(expiryDate),
        },
      },
    });

    logger.info(
      `[Inventory] Ajout rapide : ${created.name} (${quantity} ${unit}) → ${zone.label}, DLC ${toIsoDate(expiryDate)}`,
    );

    return {
      item: {
        ...toItemSummary(created),
        storageZoneLabel: zone.label,
      },
      zoneId: zone.id,
      zoneLabel: zone.label,
      zoneMeshId: zone.meshId,
      expiryDate: toIsoDate(expiryDate),
      presetApplied: preset
        ? { id: preset.id, name: preset.name, shelfLifeDays, category: preset.category }
        : null,
    };
  }

  /**
   * Zone cible d'un ajout rapide : zone explicite → meshId conseillé par le
   * preset → clayette du milieu → n'importe quelle zone frigo.
   */
  private async resolveQuickAddZone(
    storageZoneId?: string,
    preferredMeshId?: string,
  ): Promise<{ id: string; meshId: string; label: string }> {
    if (storageZoneId) {
      const explicit = await prisma.storageZone.findUnique({
        where: { id: storageZoneId },
        select: { id: true, meshId: true, label: true },
      });
      if (!explicit) throw new AppError(400, `Zone de stockage inconnue : ${storageZoneId}`);
      return explicit;
    }

    if (preferredMeshId) {
      const preferred = await prisma.storageZone.findUnique({
        where: { meshId: preferredMeshId },
        select: { id: true, meshId: true, label: true },
      });
      if (preferred) return preferred;
    }

    const middle = await prisma.storageZone.findUnique({
      where: { meshId: 'fridge_shelf_mid_low' },
      select: { id: true, meshId: true, label: true },
    });
    if (middle) return middle;

    const fallback = await prisma.storageZone.findFirst({
      where: { type: 'fridge' },
      orderBy: { positionY: 'asc' },
      select: { id: true, meshId: true, label: true },
    });
    if (fallback) return fallback;

    throw new AppError(409, 'Aucune zone de stockage configurée dans le frigo.');
  }

  async getExpiryAlerts(thresholdDays = EXPIRY_ALERT_THRESHOLD_DAYS): Promise<ExpiryAlert[]> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + thresholdDays);

    const items = await prisma.item.findMany({
      where: {
        consumedAt: null,
        expiryDate: {
          lte: thresholdDate, // ≤ aujourd'hui + threshold
          not: null,
        },
      },
      include: { storageZone: true },
      orderBy: { expiryDate: 'asc' },
    });

    const now = new Date();

    return items.map((item) => {
      const expiry = item.expiryDate!;
      const diffMs = expiry.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      return {
        item: toItemSummary(item),
        storageZoneLabel: item.storageZone.label,
        daysUntilExpiry,
        isExpired: daysUntilExpiry < 0,
      };
    });
  }

  /**
   * Liste le stock avec pagination et filtres.
   */
  async listItems(query: ListItemsQueryDTO): Promise<PaginatedItems> {
    // Les articles terminés (soft-delete) ne font plus partie de l'inventaire actif
    const where: Prisma.ItemWhereInput = { consumedAt: null };

    if (query.storageZoneId) where.storageZoneId = query.storageZoneId;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (typeof query.isShared === 'boolean') where.isShared = query.isShared;

    if (query.expiringInDays) {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() + query.expiringInDays);
      where.expiryDate = { lte: threshold, not: null };
    }

    const skip = (query.page - 1) * query.limit;

    const [items, total] = await prisma.$transaction([
      prisma.item.findMany({
        where,
        include: { storageZone: { select: { label: true, meshId: true } } },
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: query.limit,
      }),
      prisma.item.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...toItemSummary(item),
        storageZoneLabel: item.storageZone.label,
        storageZoneMeshId: item.storageZone.meshId,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Récupère un item par son ID.
   */
  async getItemById(id: string): Promise<ItemSummary & { storageZoneLabel: string }> {
    const item = await prisma.item.findUnique({
      where: { id },
      include: { storageZone: true },
    });

    if (!item) throw new AppError(404, `Item introuvable : ${id}`);

    return { ...toItemSummary(item), storageZoneLabel: item.storageZone.label };
  }

  /**
   * Retourne la liste brute des noms d'items en stock pour le moteur de recettes.
   * Optimisé : select minimal, pas de pagination.
   */
  async getStockIngredients(): Promise<Array<{ name: string; brand: string | null }>> {
    return prisma.item.findMany({
      select: { name: true, brand: true },
      where: { quantity: { gt: 0 }, consumedAt: null },
      distinct: ['name'],
    });
  }
}

export const inventoryService = new InventoryService();