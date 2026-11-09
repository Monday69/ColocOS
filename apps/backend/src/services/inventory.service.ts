import { Prisma, Unit } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { CreateItemDTO, ConsumeItemDTO, ListItemsQueryDTO } from '../dtos/inventory.dto';
import { ItemSummary } from '../types';

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

export interface PaginatedItems {
  items: (ItemSummary & { storageZoneLabel: string; storageZoneMeshId: string })[];
  total: number;
  page: number;
  limit: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
        expiryDate: data.expiryDate ?? null,
        imageUrl: data.imageUrl ?? null,
        nutriscore: data.nutriscore ?? null,
        isShared: data.isShared,
        storageZoneId: data.storageZoneId,
        ownerId: data.ownerId ?? userId ?? null,
      },
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
   * Consomme une quantité d'un item.
   *
   * Logique :
   *   - Si quantité résiduelle > 0 → mise à jour
   *   - Si quantité résiduelle ≤ 0 → suppression de l'item
   *   - Si l'item était `isShared` → ajout automatique à la liste de courses active
   */
  async consumeItem(
    itemId: string,
    dto: ConsumeItemDTO,
    userId?: string,
  ): Promise<ConsumeResult> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: { storageZone: true },
    });

    if (!item) {
      throw new AppError(404, `Item introuvable : ${itemId}`);
    }

    const currentQty = Number(item.quantity);
    const newQty = currentQty - dto.quantity;

    if (newQty > 0) {
      // ── Cas 1 : stock partiel restant ─────────────────────────────────────
      await prisma.item.update({
        where: { id: itemId },
        data: { quantity: new Prisma.Decimal(newQty) },
      });

      logger.debug(`[Inventory] Consommation partielle : ${item.name} → ${newQty} ${item.unit}`);

      if (userId) {
        await prisma.activityLog.create({
          data: {
            action: 'ITEM_UPDATED',
            userId,
            meta: {
              itemId,
              itemName: item.name,
              consumed: dto.quantity,
              remaining: newQty,
              unit: item.unit,
            },
          },
        });
      }

      return {
        remainingQuantity: newQty,
        wasExhausted: false,
        addedToShoppingList: false,
      };
    }

    // ── Cas 2 : stock épuisé ─────────────────────────────────────────────────
    await prisma.item.delete({ where: { id: itemId } });

    logger.info(`[Inventory] Stock épuisé : ${item.name} — item supprimé`);

    if (userId) {
      await prisma.activityLog.create({
        data: {
          action: 'ITEM_REMOVED',
          userId,
          meta: {
            itemId,
            itemName: item.name,
            zoneName: item.storageZone.label,
            reason: 'exhausted',
          },
        },
      });
    }

    // ── Ajout automatique à la liste de courses (si isShared) ────────────────
    let addedToShoppingList = false;

    if (item.isShared) {
      addedToShoppingList = await this.autoAddToShoppingList(item, userId);
    }

    return {
      remainingQuantity: 0,
      wasExhausted: true,
      addedToShoppingList,
    };
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
  async getExpiryAlerts(thresholdDays = EXPIRY_ALERT_THRESHOLD_DAYS): Promise<ExpiryAlert[]> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + thresholdDays);

    const items = await prisma.item.findMany({
      where: {
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
    const where: Prisma.ItemWhereInput = {};

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
      where: { quantity: { gt: 0 } },
      distinct: ['name'],
    });
  }
}

export const inventoryService = new InventoryService();