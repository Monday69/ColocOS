import { Router } from 'express';
import { shoppingController } from '../controllers/shopping.controller';
import { wrappedController } from '../controllers/wrapped.controller';
import { authenticate } from '../middlewares/auth.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// ColocOS — Shopping Routes
//
// GET    /api/shopping/lists/active                       → liste active (créée si absente)
// POST   /api/shopping/lists/:listId/items                → ajouter un article
// PATCH  /api/shopping/lists/:listId/items/:itemId/check  → cocher / décocher
// DELETE /api/shopping/lists/:listId/items/:itemId        → supprimer
//
// Alias « liste active » (API publique, sans connaître l'id de liste) :
// POST   /api/shopping/items
// PATCH  /api/shopping/items/:id
// DELETE /api/shopping/items/:id
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(authenticate);

router.get('/lists/active', shoppingController.getActiveList.bind(shoppingController));

// Ajout en lot sur la liste active (pont Recettes → Courses).
// Déclarée AVANT `/lists/:listId/items` pour rester sans ambiguïté de routage.
router.post(
  '/lists/active/items/batch',
  shoppingController.addBatchItemsToActiveList.bind(shoppingController),
);

router.post('/lists/:listId/items', shoppingController.addItem.bind(shoppingController));
router.patch(
  '/lists/:listId/items/:itemId/check',
  shoppingController.checkItem.bind(shoppingController),
);
router.delete('/lists/:listId/items/:itemId', shoppingController.deleteItem.bind(shoppingController));

// Suggestions intelligentes (habitudes d'achat)
router.get('/predictions', wrappedController.predictions.bind(wrappedController));

router.post('/items', shoppingController.addItemToActiveList.bind(shoppingController));
router.patch('/items/:id', shoppingController.checkItemInActiveList.bind(shoppingController));
router.delete('/items/:id', shoppingController.deleteItemFromActiveList.bind(shoppingController));

export default router;