import { Router } from 'express';
import healthRouter   from './health';
import authRouter     from './auth';
import fridgeRouter   from './fridge';
import inventoryRouter from './inventory';
import recipesRouter  from './recipes';
import financeRouter  from './finance';
import productsRouter from './products';
import shoppingRouter from './shopping';

const router = Router();

router.use('/health',    healthRouter);
router.use('/auth',      authRouter);
router.use('/fridge',    fridgeRouter);
router.use('/inventory', inventoryRouter);
router.use('/recipes',   recipesRouter);
router.use('/finance',   financeRouter);   // ✅ Sprint 5
router.use('/products',  productsRouter);  // Lookup OFF pour le formulaire d'ajout
router.use('/shopping',  shoppingRouter);  // Liste de courses (lazy-create si absente)

export default router;