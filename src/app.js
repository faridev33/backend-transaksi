import express from 'express';
import authRoutes from './routes/auth.routes.js';
import transactionRoutes from './routes/transaction.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

export const app = express();
app.use(express.json({ limit: '20kb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use(errorHandler);
