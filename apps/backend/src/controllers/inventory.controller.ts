import { Request, Response, NextFunction } from 'express';
import { scannerService } from '../services/scanner.service';
import { inventoryService } from '../services/inventory.service';
import {
  ScanBarcodeSchema,
  CreateItemSchema,
  ConsumeItemSchema,
  ListItemsQuerySchema,
} from '../dtos/inventory.dto';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Inventory Controller
// Couche mince : validation DTO → délégation service → formatage réponse
//
// SÉCURITÉ :
//   - req.user est garanti non-undefined (middleware authenticate en amont)
//   - ownerId est automatiquement rempli avec req.user.id si non fourni dans le body
//   - Un colocataire ne peut consommer que les items partagés ou les siens
// ─────────────────────────────────────────────────────────────────────────────

export class InventoryController {
  /**
   * POST /api/inventory/scan
   * Body: { barcode: string }
   */
  async scan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { barcode } = ScanBarcodeSchema.parse(req.body);
      const product = await scannerService.scanBarcode(barcode);

      res.status(200).json({
        success: true,
        data: product,
        message: product.fromCache
          ? 'Produit trouvé (depuis le cache)'
          : 'Produit trouvé (OpenFoodFacts)',
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/inventory/items
   * Body: CreateItemDTO
   *
   * INJECTION AUTOMATIQUE ownerId :
   *   Si le body ne spécifie pas d'ownerId (cas standard), on utilise
   *   req.user.id — le colocataire connecté est propriétaire de l'item.
   *   Si ownerId est explicitement passé (ex: admin ajoute pour quelqu'un),
   *   on l'utilise tel quel.
   */
  async addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = CreateItemSchema.parse(req.body);

      // Injection automatique : req.user.id si ownerId non spécifié dans le body
      const dtoWithOwner = {
        ...dto,
        ownerId: dto.ownerId ?? req.user.id,
      };

      const item = await inventoryService.addItem(dtoWithOwner, req.user.id);

      res.status(201).json({
        success: true,
        data: item,
        message: `"${item.name}" ajouté à "${item.storageZoneLabel}"`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/inventory/items
   * Query: ListItemsQueryDTO
   */
  async listItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = ListItemsQuerySchema.parse(req.query);
      const result = await inventoryService.listItems(query);

      res.status(200).json({
        success: true,
        data: result.items,
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
        },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/inventory/items/:id
   */
  async getItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await inventoryService.getItemById(req.params.id);
      res.status(200).json({ success: true, data: item } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/inventory/items/:id/consume
   * Body: { quantity: number }
   *
   * Passe req.user.id pour l'ActivityLog et la liste de courses auto.
   */
  async consumeItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Non authentifié.');

      const dto = ConsumeItemSchema.parse(req.body);
      const result = await inventoryService.consumeItem(
        req.params.id,
        dto,
        req.user.id,
      );

      let message = `Consommation enregistrée. Restant : ${result.remainingQuantity}`;
      if (result.wasExhausted) {
        message = result.addedToShoppingList
          ? 'Stock épuisé. Produit ajouté automatiquement à la liste de courses.'
          : 'Stock épuisé.';
      }

      res.status(200).json({
        success: true,
        data: result,
        message,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/inventory/alerts/expiry
   * Query: { days?: number } — seuil en jours (défaut: 7)
   */
  async getExpiryAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const thresholdDays = req.query.days
        ? parseInt(req.query.days as string, 10)
        : undefined;

      const alerts = await inventoryService.getExpiryAlerts(thresholdDays);

      res.status(200).json({
        success: true,
        data: alerts,
        meta: { total: alerts.length },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const inventoryController = new InventoryController();