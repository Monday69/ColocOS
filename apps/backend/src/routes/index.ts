import { Router } from 'express';
import healthRouter   from './health';
import authRouter     from './auth';
import fridgeRouter   from './fridge';
import inventoryRouter from './inventory';
import recipesRouter  from './recipes';
import financeRouter  from './finance';
// Sprint 6 :
// import shoppingRouter from './shopping';

const router = Router();

router.use('/health',    healthRouter);
router.use('/auth',      authRouter);
router.use('/fridge',    fridgeRouter);
router.use('/inventory', inventoryRouter);
router.use('/recipes',   recipesRouter);
router.use('/finance',   financeRouter);   // ✅ Sprint 5
// router.use('/shopping', shoppingRouter);

export default router;