import { Router } from 'express';
import * as transactionController from '../controllers/transaction.controller.js';
import { requireAdmin, requireAuth } from '../middleware/auth.middleware.js';

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.use(requireAuth);
router.get('/mine', asyncHandler(transactionController.listMine));
router.post('/', asyncHandler(transactionController.create));
router.post('/:id/refund', requireAdmin, asyncHandler(transactionController.refund));

export default router;
