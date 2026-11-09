import { Request, Response, NextFunction } from 'express';
import { shoppingService } from '../services/shopping.service';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Shopping Controller
//
// Couche mince : validation légère → service → réponse { success, data }.
//
// Deux familles de routes pointent vers les mêmes cas d'usage :
//   • /lists/:listId/items/...  → utilisée par le front (liste connue)
//   • /items/...                → alias sur la liste active (API publique)
// ─────────────────────────────────────────────────────────────────────────────

function requireUser(req: Request): string {
  if (!req.user) throw new AppError(401, 'Non authentifié.');
  return req.user.id;
}

export class ShoppingController {
  /** GET /api/shopping/lists/active */
  async getActiveList(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const list = await shoppingService.getActiveList();
      res.status(200).json({
        success: true,
        data: list,
        message: `${list.items.length} article(s) dans la liste active`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/shopping/lists/:listId/items */
  async addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUser(req);
      const item = await shoppingService.addItem(req.params.listId, req.body ?? {}, userId);
      res.status(201).json({
        success: true,
        data: item,
        message: `« ${item.name} » ajouté à la liste`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /api/shopping/lists/:listId/items/:itemId/check */
  async checkItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUser(req);
      const checked =
        typeof req.body?.checked === 'boolean' ? (req.body.checked as boolean) : undefined;
      const item = await shoppingService.setItemChecked(
        req.params.listId,
        req.params.itemId,
        checked,
        userId,
      );
      res.status(200).json({
        success: true,
        data: item,
        message: item.status === 'checked' ? 'Article coché' : 'Article remis en attente',
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /api/shopping/lists/:listId/items/:itemId */
  async deleteItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      requireUser(req);
      await shoppingService.deleteItem(req.params.listId, req.params.itemId);
      res.status(200).json({ success: true, data: { id: req.params.itemId } } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  // ── Alias « liste active » ────────────────────────────────────────────────

  /** POST /api/shopping/items */
  async addItemToActiveList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUser(req);
      const list = await shoppingService.getActiveList();
      const item = await shoppingService.addItem(list.id, req.body ?? {}, userId);
      res.status(201).json({
        success: true,
        data: item,
        message: `« ${item.name} » ajouté à la liste active`,
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /api/shopping/items/:id */
  async checkItemInActiveList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUser(req);
      const list = await shoppingService.getActiveList();
      const checked =
        typeof req.body?.checked === 'boolean' ? (req.body.checked as boolean) : undefined;
      const item = await shoppingService.setItemChecked(list.id, req.params.id, checked, userId);
      res.status(200).json({ success: true, data: item } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /api/shopping/items/:id */
  async deleteItemFromActiveList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      requireUser(req);
      const list = await shoppingService.getActiveList();
      await shoppingService.deleteItem(list.id, req.params.id);
      res.status(200).json({ success: true, data: { id: req.params.id } } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}

export const shoppingController = new ShoppingController();