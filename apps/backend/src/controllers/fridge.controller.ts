import { Request, Response, NextFunction } from 'express';
import { storageService } from '../services/storage.service';
import { ApiResponse } from '../types';
import { FridgeStateTwin, ZoneDetail } from '../types/digitalTwin';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Fridge Controller (Digital Twin)
// ─────────────────────────────────────────────────────────────────────────────

export class FridgeController {
  /**
   * GET /api/fridge/state
   *
   * Endpoint principal du Digital Twin.
   * Retourne l'état complet indexé par meshId pour Three.js.
   *
   * Exemple de réponse (par zone) :
   * {
   *   "fridge_shelf_top": {
   *     "meshId": "fridge_shelf_top",
   *     "fillRatio": 0.45,
   *     "fillStatus": "medium",
   *     "healthStatus": "warning",
   *     "itemCount": 3,
   *     "ownerColors": ["#6366F1", "#EC4899"],
   *     "nextExpiryDays": 3,
   *     "type": "fridge"
   *   },
   *   ...
   * }
   *
   * Usage R3F côté frontend :
   *   const { data } = await fetch('/api/fridge/state');
   *   const zoneTwin = data.zones[mesh.name]; // O(1) lookup par meshId
   *   mesh.material.color.set(healthColorMap[zoneTwin.healthStatus]);
   */
  async getState(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const state = await storageService.getFridgeState();

      res.status(200).json({
        success: true,
        data: state,
      } satisfies ApiResponse<FridgeStateTwin>);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/fridge/zones
   *
   * Liste des zones sans items — pour l'initialisation R3F.
   * Permet de construire la map meshId → metadata avant le chargement du GLTF.
   */
  async listZones(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const zones = await storageService.listZones();

      res.status(200).json({
        success: true,
        data: zones,
        meta: { total: zones.length },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/fridge/zones/:meshId
   *
   * Détail complet d'une zone (déclenché par un clic sur un mesh en 3D).
   * Retourne les items, les propriétaires, les métriques et la hiérarchie.
   *
   * Le :meshId correspond exactement au mesh.name dans le fichier GLTF.
   * Ex: GET /api/fridge/zones/fridge_shelf_top
   */
  async getZone(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { meshId } = req.params;
      const zone = await storageService.getZoneByMeshId(meshId);

      res.status(200).json({
        success: true,
        data: zone,
      } satisfies ApiResponse<ZoneDetail>);
    } catch (err) {
      next(err);
    }
  }
}

export const fridgeController = new FridgeController();