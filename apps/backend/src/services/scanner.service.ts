import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { ScannedProduct, ProductNutrition } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Scanner Service
//
// STRATÉGIE CACHE-FIRST :
//   1. Vérifie OffCache en BDD (TTL de 30 jours)
//   2. Si absent ou expiré → appel API OpenFoodFacts v2
//   3. Normalise le payload → ScannedProduct
//   4. Sauvegarde/rafraîchit le cache
//   5. Retourne avec flag `fromCache` pour monitoring
// ─────────────────────────────────────────────────────────────────────────────

const OFF_CACHE_TTL_DAYS = 30;

// ── Types bruts OpenFoodFacts ─────────────────────────────────────────────────

interface OFFNutriments {
  'energy-kcal_100g'?: number | string;
  'energy-kcal'?: number | string;
  proteins_100g?: number | string;
  carbohydrates_100g?: number | string;
  fat_100g?: number | string;
  fiber_100g?: number | string;
  salt_100g?: number | string;
}

interface OFFProduct {
  product_name?: string;
  product_name_fr?: string;
  brands?: string;
  image_front_url?: string;
  image_url?: string;
  nutriscore_grade?: string;
  nova_group?: number | string;
  quantity?: string;
  categories_tags?: string[];
  labels_tags?: string[];
  nutriments?: OFFNutriments;
  ingredients_text_fr?: string;
  ingredients_text?: string;
  allergens_tags?: string[];
}

interface OFFApiResponse {
  status: 0 | 1; // 0 = not found, 1 = found
  product?: OFFProduct;
}

// ── Normalisation du payload OFF ──────────────────────────────────────────────

/**
 * Convertit une valeur OFF (souvent une chaîne, parfois un nombre) en nombre
 * fini ≥ 0, sinon `null`. OFF renvoie régulièrement `""` ou `"unknown"` sur les
 * produits incomplets : ces cas ne doivent jamais produire `NaN` en base.
 */
function toNumberOrNull(value: number | string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Robuste : `nova_group` arrive en nombre ou en chaîne ("4"). */
function toNovaGroup(value: number | string | undefined | null): number | null {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return null;
  const rounded = Math.round(parsed);
  return rounded >= 1 && rounded <= 4 ? rounded : null;
}

function normalizeOFFProduct(barcode: string, raw: OFFProduct): ScannedProduct {
  // Priorité au nom français, puis générique
  const name =
    raw.product_name_fr?.trim() ||
    raw.product_name?.trim() ||
    `Produit ${barcode}`;

  // Nutriscore : l'API renvoie en minuscule, on capitalise
  const nutriscore = raw.nutriscore_grade
    ? raw.nutriscore_grade.toUpperCase()
    : null;

  // Image : priorité à la face avant
  const imageUrl = raw.image_front_url || raw.image_url || null;

  // Marque : prend la première si plusieurs (ex: "Danone, Activia")
  const brand = raw.brands ? raw.brands.split(',')[0].trim() : null;

  const nutriments = raw.nutriments ?? {};

  const nutrition: ProductNutrition = {
    calories: toNumberOrNull(
      nutriments['energy-kcal_100g'] ?? nutriments['energy-kcal'],
    ),
    proteins: toNumberOrNull(nutriments.proteins_100g),
    carbohydrates: toNumberOrNull(nutriments.carbohydrates_100g),
    fat: toNumberOrNull(nutriments.fat_100g),
    fiber: toNumberOrNull(nutriments.fiber_100g),
    novaGroup: toNovaGroup(raw.nova_group),
  };

  return {
    barcode,
    name,
    brand,
    imageUrl,
    nutriscore: nutriscore && ['A', 'B', 'C', 'D', 'E'].includes(nutriscore)
      ? nutriscore
      : null,
    quantity: raw.quantity ?? null,
    fromCache: false,
    nutrition,
    // Champs étendus exposés pour l'UI
    kcalPer100g: nutrition.calories,
    ingredientsText: raw.ingredients_text_fr || raw.ingredients_text || null,
    allergensTags: raw.allergens_tags ?? [],
    categories: raw.categories_tags?.slice(0, 5) ?? [],
  } as ScannedProduct & {
    kcalPer100g: number | null;
    ingredientsText: string | null;
    allergensTags: string[];
    categories: string[];
  };
}

// ── Service principal ─────────────────────────────────────────────────────────

export class ScannerService {
  /**
   * Scan un code-barres.
   * Cache-first : BDD → OpenFoodFacts API → normalisation → cache
   *
   * @throws AppError(404) si le produit est inconnu dans OFF
   * @throws AppError(503) si OFF est injoignable et le cache est vide
   */
  async scanBarcode(barcode: string): Promise<ScannedProduct> {
    // ── Étape 1 : Lookup cache BDD ────────────────────────────────────────────
    const cached = await prisma.offCache.findUnique({
      where: { barcode },
    });

    if (cached) {
      const ageInDays =
        (Date.now() - cached.fetchedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (ageInDays < OFF_CACHE_TTL_DAYS) {
        logger.debug(`[Scanner] Cache HIT pour barcode ${barcode} (${Math.floor(ageInDays)}j)`);
        const normalized = normalizeOFFProduct(barcode, cached.data as OFFProduct);
        return { ...normalized, fromCache: true };
      }

      logger.debug(`[Scanner] Cache STALE pour barcode ${barcode} (${Math.floor(ageInDays)}j > ${OFF_CACHE_TTL_DAYS}j) — refresh`);
    }

    // ── Étape 2 : Appel API OpenFoodFacts ────────────────────────────────────
    logger.debug(`[Scanner] Cache MISS — appel OFF API pour barcode ${barcode}`);

    let offData: OFFProduct;

    try {
      const response = await fetch(
        `${env.OPENFOODFACTS_BASE_URL}/product/${barcode}?fields=product_name,product_name_fr,brands,image_front_url,image_url,nutriscore_grade,nova_group,quantity,categories_tags,nutriments,ingredients_text_fr,allergens_tags`,
        {
          headers: {
            'User-Agent': 'ColocOS/1.0 (contact@colocos.local)',
          },
          signal: AbortSignal.timeout(8000), // 8s timeout
        },
      );

      if (!response.ok) {
        throw new Error(`OFF API HTTP ${response.status}`);
      }

      const body = (await response.json()) as OFFApiResponse;

      if (body.status === 0 || !body.product) {
        throw new AppError(
          404,
          `Produit inconnu (code-barres: ${barcode})`,
        );
      }

      offData = body.product;
    } catch (err) {
      if (err instanceof AppError) throw err;

      // L'API est injoignable — si on a un cache périmé, on l'utilise quand même
      if (cached) {
        logger.warn(`[Scanner] OFF API injoignable, utilisation du cache périmé pour ${barcode}`);
        const normalized = normalizeOFFProduct(barcode, cached.data as OFFProduct);
        return { ...normalized, fromCache: true };
      }

      logger.error(`[Scanner] OFF API injoignable et pas de cache pour ${barcode}`, err);
      throw new AppError(
        503,
        'Le service OpenFoodFacts est temporairement indisponible. Réessayez dans quelques instants.',
      );
    }

    // ── Étape 3 : Normalisation ───────────────────────────────────────────────
    const normalized = normalizeOFFProduct(barcode, offData);

    // ── Étape 4 : Sauvegarde cache (upsert) ──────────────────────────────────
    await prisma.offCache.upsert({
      where: { barcode },
      update: {
        data: offData as object,
        fetchedAt: new Date(),
      },
      create: {
        barcode,
        data: offData as object,
      },
    });

    logger.debug(`[Scanner] Cache sauvegardé pour barcode ${barcode}`);

    return { ...normalized, fromCache: false };
  }

  /**
   * Invalide manuellement le cache d'un produit (utile si les données OFF ont changé).
   */
  async invalidateCache(barcode: string): Promise<void> {
    await prisma.offCache.deleteMany({ where: { barcode } });
    logger.info(`[Scanner] Cache invalidé pour barcode ${barcode}`);
  }

  /**
   * Retourne les statistiques du cache OFF (utile pour le monitoring).
   */
  async getCacheStats(): Promise<{ totalEntries: number; staleEntries: number }> {
    const totalEntries = await prisma.offCache.count();
    const staleThreshold = new Date(
      Date.now() - OFF_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const staleEntries = await prisma.offCache.count({
      where: { fetchedAt: { lt: staleThreshold } },
    });

    return { totalEntries, staleEntries };
  }
}

export const scannerService = new ScannerService();