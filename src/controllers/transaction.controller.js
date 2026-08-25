import { z } from 'zod';
import * as transactionService from '../services/transaction.service.js';
import { AppError } from '../errors/app-error.js';

const transferSchema = z.object({
  senderAccountId: z.string().uuid(),
  receiverAccountId: z.string().uuid(),
  amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, 'Amount harus berupa angka positif dengan maksimal 2 desimal.')
    .refine((value) => Number(value) > 0 && Number(value) <= 1000000000000, 'Amount harus lebih dari 0 dan tidak melebihi batas.'),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  description: z.string().max(255).optional()
}).refine((value) => value.senderAccountId !== value.receiverAccountId, { message: 'Akun pengirim dan penerima tidak boleh sama.' });

function idempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 100) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key (maksimal 100 karakter) wajib dikirim.');
  return key;
}

export async function create(req, res) {
  const outcome = await transactionService.createTransaction({ id: req.user.sub, role: req.user.role }, transferSchema.parse(req.body), idempotencyKey(req));
  res.status(outcome.replayed ? 200 : 201).json({ data: outcome.transaction, replayed: outcome.replayed });
}

export async function refund(req, res) {
  const outcome = await transactionService.refundTransaction({ id: req.user.sub, role: req.user.role }, z.string().uuid().parse(req.params.id), idempotencyKey(req));
  res.status(outcome.replayed ? 200 : 201).json({ data: outcome.transaction, replayed: outcome.replayed });
}

export async function listMine(req, res) {
  res.json({ data: await transactionService.listMyTransactions(req.user.sub) });
}
