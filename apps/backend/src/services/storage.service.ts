import { Prisma, StorageType, Unit } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import {
  ZoneTwin,
  ZoneDetail,
  ZoneItemDetail,
  ZoneItemTwin,
  FridgeStateTwin,
  FridgeSummary,
  HealthStatus,
  FillStatus,
  HEALTH_THRESHOLDS,
} from '../types/digitalTwin';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Storage Service (Digital Twin)
//
// STRATÉGIE DE REQUÊTE — Zéro N+1 :
//   Une seule requête Prisma `findMany` sur StorageZone avec :
//     include.items.include.owner → charge items + owner en JOINs SQL
//     include.childZones           → charge la hiérarchie en une passe
//   Toutes les métriques (fillRatio, healthStatus, ownerColors) sont calculées
//   en mémoire sur le résultat — pas de requêtes supplémentaires.
//
// ESTIMATION DU VOLUME :
//   Un item alimentaire moyen occupe ~0.5–1 litre.
//   On utilise une table de conversion unit → litres estimés pour le calcul
//   du fillRatio quand les capacités sont connues.
//   Si capacityLiters est null → fallback sur itemCount / 10 (heuristique).
// ─────────────────────────────────────────────────────────────────────────────

// ── Table de conversion volume estimé par unité ───────────────────────────────
// Valeurs conservatives — l'objectif est le feedback visuel, pas la précision
const UNIT_TO_LITERS: Record<Unit, number> = {
  L:    1.0,
  ml:   0.001,
  kg:   1.0,    // 1 kg ≈ 1L (approximation pour les solides)
  g:    0.001,
  unit: 0.5,   // Un "item" occupe ~0.5L (bouteille, boite, etc.)
};

// ── Type interne Prisma (résultat du findMany enrichi) ───────────────────────

type ZoneWithItems = Prisma.StorageZoneGetPayload<{
  include: {
    items: {
      include: {
        owner: { select: { id: true; name: true; colorHex: true } };
      };
    };
    childZones: { select: { meshId: true } };
    parentZone: { select: { meshId: true } };
  };
}>;

// ── Calculs ───────────────────────────────────────────────────────────────────

/**
 * Estime le volume occupé par un ensemble d'items en litres.
 */
function estimateOccupiedLiters(
  items: Array<{ quantity: Prisma.Decimal; unit: Unit }>,
): number {
  return items.reduce((total, item) => {
    const qty = Number(item.quantity);
    const litersPerUnit = UNIT_TO_LITERS[item.unit] ?? 0.5;
    return total + qty * litersPerUnit;
  }, 0);
}

/**
 * Calcule le fillRatio (0..1) d'une zone.
 * Si capacityLiters est connu → ratio volumique précis.
 * Sinon → heuristique sur le nombre d'items (max 10 par zone sans capacité).
 */
function computeFillRatio(zone: ZoneWithItems): number {
  if (zone.items.length === 0) return 0;

  if (zone.capacityLiters !== null) {
    const capacity = Number(zone.capacityLiters);
    if (capacity <= 0) return 0;

    const occupied = estimateOccupiedLiters(zone.items);
    return Math.min(occupied / capacity, 1.0);
  }

  // Fallback heuristique : 10 items = zone pleine
  return Math.min(zone.items.length / 10, 1.0);
}

function computeFillStatus(fillRatio: number, itemCount: number): FillStatus {
  if (itemCount === 0) return 'empty';
  if (fillRatio >= HEALTH_THRESHOLDS.FILL_FULL) return 'full';
  if (fillRatio <= HEALTH_THRESHOLDS.FILL_LOW) return 'low';
  return 'medium';
}

/**
 * Calcule le healthStatus d'une zone basé sur la DLC la plus proche.
 * Un seul item périmé/critique suffit à faire monter toute la zone.
 */
function computeHealthStatus(
  items: Array<{ expiryDate: Date | null }>,
  now: Date,
): { healthStatus: HealthStatus; nextExpiryDays: number | null } {
  if (items.length === 0) {
    return { healthStatus: 'empty', nextExpiryDays: null };
  }

  const itemsWithExpiry = items
    .filter((i) => i.expiryDate !== null)
    .map((i) => {
      const diffMs = i.expiryDate!.getTime() - now.getTime();
      return Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // jours (peut être négatif)
    })
    .sort((a, b) => a - b); // trier du plus urgent au moins urgent

  if (itemsWithExpiry.length === 0) {
    return { healthStatus: 'ok', nextExpiryDays: null };
  }

  const nearest = itemsWithExpiry[0];

  if (nearest <= HEALTH_THRESHOLDS.CRITICAL_DAYS) {
    return { healthStatus: 'critical', nextExpiryDays: nearest };
  }
  if (nearest <= HEALTH_THRESHOLDS.WARNING_DAYS) {
    return { healthStatus: 'warning', nextExpiryDays: nearest };
  }
  return { healthStatus: 'ok', nextExpiryDays: nearest };
}

/**
 * Extrait les couleurs hex des propriétaires uniques présents dans une zone.
 * Dédupliquées + triées pour stabilité du rendu Three.js.
 */
function extractOwnerColors(
  items: Array<{ owner: { colorHex: string } | null }>,
): string[] {
  const colorSet = new Set<string>();
  for (const item of items) {
    if (item.owner?.colorHex) {
      colorSet.add(item.owner.colorHex);
    }
  }
  return Array.from(colorSet).sort();
}

/**
 * Transforme un item Prisma enrichi en ZoneItemDetail (payload panneau latéral).
 */
function toZoneItemDetail(
  item: ZoneWithItems['items'][number],
  now: Date,
): ZoneItemDetail {
  const expiryDate = item.expiryDate
    ? item.expiryDate.toISOString().split('T')[0]
    : null;

  const daysUntilExpiry =
    item.expiryDate !== null
      ? Math.ceil((item.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    quantity: Number(item.quantity),
    unit: item.unit,
    expiryDate,
    daysUntilExpiry,
    imageUrl: item.imageUrl,
    nutriscore: item.nutriscore,
    isShared: item.isShared,
    owner: item.owner
      ? { id: item.owner.id, name: item.owner.name, colorHex: item.owner.colorHex }
      : null,
  };
}

/**
 * Transforme un item Prisma enrichi en projection légère pour la 3D.
 */
function toZoneItemTwin(
  item: ZoneWithItems['items'][number],
  now: Date,
): ZoneItemTwin {
  const daysUntilExpiry =
    item.expiryDate !== null
      ? Math.ceil((item.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

  return {
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    quantity: Number(item.quantity),
    unit: item.unit,
    ownerColorHex: item.owner?.colorHex ?? null,
    isShared: item.isShared,
    daysUntilExpiry,
    // Champs consommés par le tooltip produit du mesh 3D (clic sur packaging) :
    // l'état /fridge/state doit suffire à l'afficher, sans second appel réseau.
    brand: item.brand,
    nutriscore: item.nutriscore,
    ownerName: item.owner?.name ?? null,
    expiryDate: item.expiryDate
      ? item.expiryDate.toISOString().split('T')[0]
      : null,
    // Macros (pour 100 g) — alimentent la fiche nutrition du packaging
    calories: item.calories,
    proteins: item.proteins,
    carbohydrates: item.carbohydrates,
    fat: item.fat,
    fiber: item.fiber,
    novaGroup: item.novaGroup,
  };
}

/**
 * Convertit le type Prisma StorageType en union littérale TypeScript.
 */
function toZoneType(t: StorageType): 'fridge' | 'freezer' | 'pantry' | 'cabinet' {
  return t as 'fridge' | 'freezer' | 'pantry' | 'cabinet';
}

// ── Service ───────────────────────────────────────────────────────────────────

export class StorageService {
  /**
   * Requête principale du Digital Twin.
   * Retourne l'état complet de toutes les zones indexé par meshId.
   *
   * PERF : 1 requête SQL (JOIN zones + items + owners + childZones)
   *        + calculs in-memory O(n) sur les items
   *
   * Payload optimisé Three.js : ~200–400 bytes/zone, ~5 KB total pour 15 zones.
   */
  async getFridgeState(): Promise<FridgeStateTwin> {
    const now = new Date();

    // ── Requête unique — tous les JOINs en une passe ──────────────────────────
    const zones = await prisma.storageZone.findMany({
      include: {
        items: {
          include: {
            // On charge seulement les champs nécessaires au calcul des couleurs
            owner: {
              select: { id: true, name: true, colorHex: true },
            },
          },
          orderBy: { expiryDate: 'asc' }, // Items triés par DLC pour calcul rapide
        },
        childZones: {
          select: { meshId: true },
        },
        parentZone: {
          select: { meshId: true },
        },
      },
      orderBy: [
        { type: 'asc' },
        { label: 'asc' },
      ],
    });

    logger.debug(`[Storage] getFridgeState : ${zones.length} zones chargées`);

    // ── Calculs in-memory ─────────────────────────────────────────────────────
    const zoneMap: Record<string, ZoneTwin> = {};
    const summary: FridgeSummary = {
      totalItems: 0,
      criticalZones: 0,
      warningZones: 0,
      emptyZones: 0,
      fullZones: 0,
      expiringThisWeek: 0,
    };

    for (const zone of zones) {
      const fillRatio = computeFillRatio(zone);
      const fillStatus = computeFillStatus(fillRatio, zone.items.length);
      const { healthStatus, nextExpiryDays } = computeHealthStatus(zone.items, now);
      const ownerColors = extractOwnerColors(zone.items);

      // Compte des items expirant dans les 7 jours (pour le summary global)
      const weekExpiring = zone.items.filter((item) => {
        if (!item.expiryDate) return false;
        const days = Math.ceil(
          (item.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        return days >= 0 && days <= 7;
      }).length;

      // ── Payload ZoneTwin (léger, pour Three.js) ───────────────────────────
      zoneMap[zone.meshId] = {
        meshId: zone.meshId,
        fillRatio: Math.round(fillRatio * 1000) / 1000, // 3 décimales max
        fillStatus,
        healthStatus,
        itemCount: zone.items.length,
        ownerColors,
        nextExpiryDays,
        type: toZoneType(zone.type),
        items: zone.items.map((item) => toZoneItemTwin(item, now)),
      };

      // ── Agrégation summary ─────────────────────────────────────────────────
      summary.totalItems += zone.items.length;
      summary.expiringThisWeek += weekExpiring;
      if (healthStatus === 'critical') summary.criticalZones++;
      if (healthStatus === 'warning')  summary.warningZones++;
      if (fillStatus === 'empty')      summary.emptyZones++;
      if (fillStatus === 'full')       summary.fullZones++;
    }

    return {
      zones: zoneMap,
      summary,
      computedAt: now.toISOString(),
    };
  }

  /**
   * Détail complet d'une zone spécifique (clic sur un mesh en 3D).
   * Inclut les items complets avec propriétaires et métriques.
   *
   * @throws AppError(404) si le meshId est inconnu
   */
  async getZoneByMeshId(meshId: string): Promise<ZoneDetail> {
    const now = new Date();

    const zone = await prisma.storageZone.findUnique({
      where: { meshId },
      include: {
        items: {
          include: {
            owner: {
              select: { id: true, name: true, colorHex: true },
            },
          },
          orderBy: [
            { expiryDate: 'asc' },   // Items les plus urgents en premier
            { name: 'asc' },
          ],
        },
        childZones: {
          select: { meshId: true },
        },
        parentZone: {
          select: { meshId: true },
        },
      },
    });

    if (!zone) {
      throw new AppError(404, `Zone introuvable : meshId "${meshId}"`);
    }

    // Métriques (mêmes calculs que getFridgeState, mais pour une seule zone)
    const fillRatio = computeFillRatio(zone);
    const fillStatus = computeFillStatus(fillRatio, zone.items.length);
    const { healthStatus, nextExpiryDays } = computeHealthStatus(zone.items, now);
    const ownerColors = extractOwnerColors(zone.items);

    // Position 3D (null si coordonnées non renseignées dans le modèle)
    const position =
      zone.positionX !== null && zone.positionY !== null && zone.positionZ !== null
        ? { x: zone.positionX, y: zone.positionY, z: zone.positionZ }
        : null;

    return {
      id: zone.id,
      meshId: zone.meshId,
      label: zone.label,
      type: toZoneType(zone.type),
      capacityLiters: zone.capacityLiters !== null ? Number(zone.capacityLiters) : null,
      fillRatio: Math.round(fillRatio * 1000) / 1000,
      fillStatus,
      healthStatus,
      nextExpiryDays,
      ownerColors,
      position,
      parentMeshId: zone.parentZone?.meshId ?? null,
      childMeshIds: zone.childZones.map((c) => c.meshId),
      items: zone.items.map((item) => toZoneItemDetail(item, now)),
      itemCount: zone.items.length,
    };
  }

  /**
   * Liste toutes les zones disponibles (sans items — pour initialisation R3F).
   * Utile au boot du frontend pour construire la map meshId → metadata.
   */
  async listZones(): Promise<
    Array<{
      id: string;
      meshId: string;
      label: string;
      type: string;
      capacityLiters: number | null;
      position: { x: number; y: number; z: number } | null;
      parentMeshId: string | null;
    }>
  > {
    const zones = await prisma.storageZone.findMany({
      select: {
        id: true,
        meshId: true,
        label: true,
        type: true,
        capacityLiters: true,
        positionX: true,
        positionY: true,
        positionZ: true,
        parentZone: { select: { meshId: true } },
      },
      orderBy: [{ type: 'asc' }, { label: 'asc' }],
    });

    return zones.map((z) => ({
      id: z.id,
      meshId: z.meshId,
      label: z.label,
      type: z.type,
      capacityLiters: z.capacityLiters !== null ? Number(z.capacityLiters) : null,
      position:
        z.positionX !== null && z.positionY !== null && z.positionZ !== null
          ? { x: z.positionX, y: z.positionY, z: z.positionZ }
          : null,
      parentMeshId: z.parentZone?.meshId ?? null,
    }));
  }
}

export const storageService = new StorageService();