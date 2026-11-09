import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Shopping Service
//
// Source de vérité : `ShoppingList` (une seule liste active, `isArchived=false`)
// et `ShoppingItem` (statut `pending` → `checked`).
//
// Le schéma Prisma ne connaît pas de champ `status: 'ACTIVE'` sur la liste :
// l'état « active » est porté par `isArchived === false`. La liste est créée
// paresseusement au premier appel (`GET /api/shopping/lists/active`) : le front
// n'a jamais à gérer le cas « pas encore de liste ».
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIST_NAME = 'Courses de la coloc';

const UNIT_VALUES = ['g', 'kg', 'ml', 'L', 'unit'] as const;
type ApiUnit = (typeof UNIT_VALUES)[number];

/**
 * Le front envoie des libellés français (`unité`, `L`, `g`…), l'enum Prisma est
 * en anglais (`unit`, `L`, `g`…). Sans cette normalisation, ajouter un article
 * avec l'unité par défaut `unité` renvoyait 400 et le formulaire échouait
 * silencieusement (try/finally sans catch côté UI).
 */
const UNIT_ALIASES: Record<string, ApiUnit> = {
  unit: 'unit', unite: 'unit', 'unité': 'unit', unites: 'unit', 'unités': 'unit',
  u: 'unit', piece: 'unit', 'pièce': 'unit', pieces: 'unit', 'pièces': 'unit',
  pcs: 'unit', item: 'unit', article: 'unit',
  g: 'g', gr: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogramme: 'kg', kilogrammes: 'kg',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'L', litre: 'L', litres: 'L',
};

function parseUnit(raw: string | undefined): ApiUnit {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'unit';
  const key = String(raw).trim().toLowerCase().replace(/\.$/, '');
  const resolved = UNIT_ALIASES[key];
  if (resolved) return resolved;
  const exact = UNIT_VALUES.find((u) => u.toLowerCase() === key);
  if (exact) return exact;
  throw new AppError(400, `Unité invalide : ${String(raw)}.`);
}

/**
 * Variante tolérante pour les ajouts en lot : une unité inconnue ne doit pas
 * faire échouer les autres ingrédients de la recette.
 */
function safeParseUnit(raw: string | undefined): ApiUnit {
  try {
    return parseUnit(raw);
  } catch {
    return 'unit';
  }
}

/** Include partagé : items triés (à acheter d'abord) + auteur. */
const LIST_INCLUDE = {
  items: {
    orderBy: [{ status: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      addedBy: { select: { id: true, name: true, colorHex: true } },
    },
  },
};

export interface ShoppingItemDTO {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  barcode: string | null;
  status: 'pending' | 'checked' | 'purchased';
  note: string | null;
  isAutoSuggested: boolean;
  createdAt: string;
  addedBy: { id: string; name: string; colorHex: string } | null;
}

export interface ShoppingListDTO {
  id: string;
  name: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  items: ShoppingItemDTO[];
}

type ItemRow = {
  id: string;
  name: string;
  quantity: unknown;
  unit: string;
  barcode: string | null;
  status: string;
  note: string | null;
  isAutoSuggested: boolean;
  createdAt: Date;
  addedBy: { id: string; name: string; colorHex: string } | null;
};

type ListRow = {
  id: string;
  name: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  items: ItemRow[];
};

function toItemDTO(item: ItemRow): ShoppingItemDTO {
  return {
    id: item.id,
    name: item.name,
    quantity: Number(item.quantity),
    unit: item.unit,
    barcode: item.barcode,
    status: item.status as ShoppingItemDTO['status'],
    note: item.note,
    isAutoSuggested: item.isAutoSuggested,
    createdAt: item.createdAt.toISOString(),
    addedBy: item.addedBy,
  };
}

function toListDTO(list: ListRow): ShoppingListDTO {
  return {
    id: list.id,
    name: list.name,
    isArchived: list.isArchived,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    items: list.items.map(toItemDTO),
  };
}

export interface AddShoppingItemInput {
  name: string;
  quantity?: number;
  unit?: string;
  barcode?: string | null;
  note?: string | null;
}

/** Élément d'un ajout en lot (pont Recettes → Courses). */
export interface AddShoppingBatchInput {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface AddShoppingBatchResult {
  list: ShoppingListDTO;
  created: number;
  /** Articles ignorés parce qu'ils sont déjà en attente dans la liste */
  skipped: number;
}

/** Plafond de sécurité : un lot plus gros est presque sûrement un bug d'appel. */
const MAX_BATCH_ITEMS = 50;

/** Clé de déduplication : insensible à la casse, aux accents et aux espaces. */
function normalizeItemName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export class ShoppingService {
  /**
   * Liste de courses active de la coloc. Créée à la volée si absente.
   *
   * Il n'existe pas de notion de foyer/colocation en base : toutes les listes
   * non archivées sont partagées. On prend la plus récente et on archive les
   * doublons éventuels pour garantir l'unicité de la liste active.
   */
  async getActiveList(): Promise<ShoppingListDTO> {
    const lists = await prisma.shoppingList.findMany({
      where: { isArchived: false },
      orderBy: { createdAt: 'desc' },
      include: LIST_INCLUDE,
      take: 5,
    });

    if (lists.length > 0) {
      const [active, ...duplicates] = lists;
      if (duplicates.length > 0) {
        await prisma.shoppingList.updateMany({
          where: { id: { in: duplicates.map((l) => l.id) } },
          data: { isArchived: true },
        });
        logger.warn(`[Shopping] ${duplicates.length} liste(s) active(s) en doublon archivée(s)`);
      }
      return toListDTO(active as ListRow);
    }

    const created = await prisma.shoppingList.create({
      data: { name: DEFAULT_LIST_NAME },
      include: LIST_INCLUDE,
    });
    logger.info(`[Shopping] Liste active créée : ${created.id}`);
    return toListDTO(created as ListRow);
  }

  /** Ajoute un article à la liste. */
  async addItem(
    listId: string,
    input: AddShoppingItemInput,
    userId?: string,
  ): Promise<ShoppingItemDTO> {
    const name = input.name?.trim();
    if (!name) throw new AppError(400, "Le nom de l'article est obligatoire.");

    const quantity = input.quantity ?? 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new AppError(400, 'La quantité doit être un nombre strictement positif.');
    }

    const unit = parseUnit(input.unit);

    const list = await prisma.shoppingList.findUnique({ where: { id: listId } });
    if (!list) throw new AppError(404, `Liste de courses introuvable : ${listId}`);
    if (list.isArchived) throw new AppError(409, 'Cette liste de courses est archivée.');

    const item = await prisma.shoppingItem.create({
      data: {
        name,
        quantity,
        unit,
        barcode: input.barcode ?? null,
        note: input.note ?? null,
        status: 'pending',
        shoppingListId: listId,
        addedById: userId ?? null,
      },
      include: { addedBy: { select: { id: true, name: true, colorHex: true } } },
    });

    if (userId) {
      await prisma.activityLog.create({
        data: {
          action: 'SHOPPING_ITEM_ADDED',
          userId,
          meta: { itemId: item.id, itemName: item.name, quantity, unit },
        },
      });
    }

    logger.debug(`[Shopping] Article ajouté : ${item.name} (${quantity} ${unit})`);
    return toItemDTO(item as ItemRow);
  }

  /**
   * Ajoute plusieurs articles à la liste active en une seule transaction.
   *
   * Usage : bouton « Ajouter les X manquants aux courses » d'une recette.
   * - la liste active est récupérée (ou créée) en amont ;
   * - les unités passent par `parseUnit()` (repli `unit`) ;
   * - les doublons déjà `pending` sont ignorés (nom normalisé) : un double tap
   *   sur le bouton ne remplit pas la liste de doublons ;
   * - la liste complète est renvoyée pour rafraîchir le store front.
   */
  async addBatchItemsToActiveList(
    userId: string,
    inputs: AddShoppingBatchInput[],
  ): Promise<AddShoppingBatchResult> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new AppError(400, 'Aucun article à ajouter.');
    }
    if (inputs.length > MAX_BATCH_ITEMS) {
      throw new AppError(400, `Maximum ${MAX_BATCH_ITEMS} articles par ajout groupé.`);
    }

    const active = await this.getActiveList();

    const pendingNames = new Set(
      active.items
        .filter((item) => item.status === 'pending')
        .map((item) => normalizeItemName(item.name)),
    );

    const data: Array<{
      name: string;
      quantity: number;
      unit: ApiUnit;
      status: 'pending';
      shoppingListId: string;
      addedById: string;
    }> = [];

    let skipped = 0;

    for (const input of inputs) {
      const name = input.name?.trim();
      if (!name) continue;

      const key = normalizeItemName(name);
      if (pendingNames.has(key)) {
        skipped += 1;
        continue;
      }
      pendingNames.add(key);

      const quantity = input.quantity ?? 1;

      data.push({
        name,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        // Une unité inconnue dans un lot ne doit pas faire échouer les autres
        // articles : on retombe sur `unit` plutôt que de renvoyer 400.
        unit: safeParseUnit(input.unit),
        // Enum Prisma `ShoppingItemStatus` : la valeur est `pending`
        // (le contrat front peut écrire `PENDING`, le mapping est ici).
        status: 'pending',
        shoppingListId: active.id,
        addedById: userId,
      });
    }

    if (data.length === 0) {
      logger.debug(`[Shopping] Lot ignoré (${skipped} doublon(s), 0 nouveau)`);
      return { list: active, created: 0, skipped };
    }

    await prisma.$transaction([
      prisma.shoppingItem.createMany({ data }),
      prisma.activityLog.create({
        data: {
          action: 'SHOPPING_ITEM_ADDED',
          userId,
          meta: {
            batch: true,
            count: data.length,
            names: data.map((row) => row.name),
            source: 'recipe',
          },
        },
      }),
    ]);

    const updated = await prisma.shoppingList.findUniqueOrThrow({
      where: { id: active.id },
      include: LIST_INCLUDE,
    });

    logger.debug(
      `[Shopping] ${data.length} article(s) ajouté(s) en lot (${skipped} doublon(s) ignoré(s))`,
    );

    return { list: toListDTO(updated as ListRow), created: data.length, skipped };
  }

  /**
   * Coche / décoche un article.
   * Sans `checked` explicite → coche (comportement attendu par le front).
   */
  async setItemChecked(
    listId: string,
    itemId: string,
    checked?: boolean,
    userId?: string,
  ): Promise<ShoppingItemDTO> {
    const item = await prisma.shoppingItem.findFirst({
      where: { id: itemId, shoppingListId: listId },
    });
    if (!item) throw new AppError(404, `Article introuvable : ${itemId}`);

    const nextChecked = checked ?? item.status === 'pending';
    const status = nextChecked ? 'checked' : 'pending';

    const updated = await prisma.shoppingItem.update({
      where: { id: itemId },
      data: { status },
      include: { addedBy: { select: { id: true, name: true, colorHex: true } } },
    });

    if (nextChecked && userId) {
      await prisma.activityLog.create({
        data: {
          action: 'SHOPPING_ITEM_CHECKED',
          userId,
          meta: { itemId, itemName: item.name },
        },
      });
    }

    // Bump updatedAt de la liste (tri « liste la plus récemment touchée »)
    await prisma.shoppingList.update({
      where: { id: listId },
      data: { updatedAt: new Date() },
    });

    return toItemDTO(updated as ItemRow);
  }

  /** Supprime définitivement un article de la liste. */
  async deleteItem(listId: string, itemId: string): Promise<void> {
    const deleted = await prisma.shoppingItem.deleteMany({
      where: { id: itemId, shoppingListId: listId },
    });
    if (deleted.count === 0) {
      throw new AppError(404, `Article introuvable : ${itemId}`);
    }
    logger.debug(`[Shopping] Article supprimé : ${itemId}`);
  }
}

export const shoppingService = new ShoppingService();