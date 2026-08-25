import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.post('/login', asyncHandler(authController.login));

export default router;
