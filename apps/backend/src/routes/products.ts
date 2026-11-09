import { Router, Request, Response, NextFunction } from 'express';
import { scannerService } from '../services/scanner.service';
import { authenticate } from '../middlewares/auth.middleware';
import { AppError } from '../middlewares/errorHandler';
import { ApiResponse } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Products Routes
//
// GET /api/products/lookup/:barcode
//   Lookup OpenFoodFacts (cache-first, via ScannerService) avec une projection
//   propre destinée aux formulaires front : { name, brand, imageUrl,
//   nutriscore, category, barcode }.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticate);

const BARCODE_RE = /^\d{8,14}$/;

export interface ProductLookup {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  nutriscore: string | null;
  category: string | null;
}

router.get(
  '/lookup/:barcode',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const barcode = String(req.params.barcode);

      if (!BARCODE_RE.test(barcode)) {
        throw new AppError(400, 'Code-barres invalide (8 à 14 chiffres attendus).');
      }

      // scanBarcode expose des champs étendus (categories, ingredientsText…)
      // au-delà du type ScannedProduct de base.
      const product = (await scannerService.scanBarcode(barcode)) as unknown as {
        name: string;
        brand: string | null;
        imageUrl: string | null;
        nutriscore: string | null;
        categories?: string[];
      };

      const data: ProductLookup = {
        barcode,
        name: product.name,
        brand: product.brand,
        imageUrl: product.imageUrl,
        nutriscore: product.nutriscore,
        category:
          product.categories?.[0]?.replace(/^[a-z]{2}:/, '') ?? null,
      };

      res.status(200).json({
        success: true,
        data,
      } satisfies ApiResponse<ProductLookup>);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
