import { pool, withDatabaseTransaction } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';

function businessError(code, message) {
  return new AppError(422, code, message);
}

async function validateActor(client, actor, mustBeAdmin = false) {
  const result = await client.query('SELECT is_active, role FROM users WHERE id = $1', [actor.id]);
  const user = result.rows[0];
  if (!user || !user.is_active) throw new AppError(401, 'UNAUTHENTICATED', 'Pengguna tidak aktif atau tidak ditemukan.');
  if (mustBeAdmin && user.role !== 'ADMIN') throw new AppError(403, 'FORBIDDEN', 'Hanya admin yang dapat melakukan refund.');
}

async function getTransaction(client, id) {
  const result = await client.query(
    `SELECT t.*, sa.account_number AS sender_account_number, ra.account_number AS receiver_account_number
     FROM transactions t
     JOIN accounts sa ON sa.id = t.sender_account_id
     JOIN accounts ra ON ra.id = t.receiver_account_id
     WHERE t.id = $1`,
    [id]
  );
  return result.rows[0];
}

async function lockAccounts(client, senderAccountId, receiverAccountId) {
  const result = await client.query(
    `SELECT a.id, a.user_id, a.currency, a.balance, a.is_active, u.is_active AS user_is_active
     FROM accounts a JOIN users u ON u.id = a.user_id
     WHERE a.id = ANY($1::uuid[]) ORDER BY a.id FOR UPDATE OF a`,
    [[senderAccountId, receiverAccountId]]
  );
  if (result.rows.length !== 2) throw businessError('ACCOUNT_NOT_FOUND', 'Akun pengirim atau penerima tidak ditemukan.');
  return result.rows;
}

async function markFailed(client, transactionId, error) {
  await client.query(
    `UPDATE transactions SET status = 'FAILED', failure_code = $2, failure_reason = $3, completed_at = NOW()
     WHERE id = $1`,
    [transactionId, error.code, error.message]
  );
}

async function executeBalanceMove(client, { transactionId, actor, senderAccountId, receiverAccountId, amount, currency, allowSystemDebit = false }) {
  const accounts = await lockAccounts(client, senderAccountId, receiverAccountId);
  const sender = accounts.find((account) => account.id === senderAccountId);
  const receiver = accounts.find((account) => account.id === receiverAccountId);

  if (!sender.is_active || !sender.user_is_active) throw businessError('SENDER_INACTIVE', 'Akun pengirim tidak aktif.');
  if (!receiver.is_active || !receiver.user_is_active) throw businessError('RECEIVER_INACTIVE', 'Akun penerima tidak aktif.');
  if (!allowSystemDebit && sender.user_id !== actor.id) throw new AppError(403, 'SENDER_NOT_OWNED', 'Akun pengirim bukan milik pengguna yang login.');
  if (sender.currency !== receiver.currency || sender.currency !== currency) throw businessError('CURRENCY_MISMATCH', 'Mata uang kedua akun harus sama.');

  const senderUpdate = await client.query(
    'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance',
    [amount, senderAccountId]
  );
  if (senderUpdate.rowCount !== 1) throw businessError('INSUFFICIENT_BALANCE', 'Saldo pengirim tidak mencukupi.');
  const receiverUpdate = await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2 RETURNING balance', [amount, receiverAccountId]);

  await client.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, balance_after)
     VALUES ($1, $2, 'DEBIT', $3, $4), ($1, $5, 'CREDIT', $3, $6)`,
    [transactionId, senderAccountId, amount, senderUpdate.rows[0].balance, receiverAccountId, receiverUpdate.rows[0].balance]
  );
}

async function createTransfer({ actor, senderAccountId, receiverAccountId, amount, currency, description, idempotencyKey, type = 'TRANSFER', relatedTransactionId = null, allowSystemDebit = false }) {
  const outcome = await withDatabaseTransaction(async (client) => {
    await validateActor(client, actor);
    const inserted = await client.query(
      `INSERT INTO transactions
       (type, actor_user_id, sender_account_id, receiver_account_id, amount, currency, description, idempotency_key, related_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (actor_user_id, idempotency_key) DO NOTHING RETURNING id`,
      [type, actor.id, senderAccountId, receiverAccountId, amount, currency, description ?? null, idempotencyKey, relatedTransactionId]
    );

    if (inserted.rowCount === 0) {
      const existing = await client.query(
        `SELECT * FROM transactions WHERE actor_user_id = $1 AND idempotency_key = $2`,
        [actor.id, idempotencyKey]
      );
      return { transaction: existing.rows[0], replayed: true };
    }

    const transactionId = inserted.rows[0].id;
    try {
      await executeBalanceMove(client, { transactionId, actor, senderAccountId, receiverAccountId, amount, currency, allowSystemDebit });
      await client.query("UPDATE transactions SET status = 'SUCCESS', completed_at = NOW() WHERE id = $1", [transactionId]);
      return { transaction: await getTransaction(client, transactionId), replayed: false };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await markFailed(client, transactionId, error);
      return { transaction: await getTransaction(client, transactionId), replayed: false, businessError: error };
    }
  });

  if (outcome.businessError) {
    outcome.businessError.details = { transactionId: outcome.transaction.id, status: outcome.transaction.status };
    throw outcome.businessError;
  }
  if (outcome.transaction.status === 'FAILED') {
    const error = businessError(outcome.transaction.failure_code ?? 'TRANSACTION_FAILED', outcome.transaction.failure_reason ?? 'Transaksi sebelumnya gagal.');
    error.details = { transactionId: outcome.transaction.id, status: outcome.transaction.status };
    throw error;
  }
  return outcome;
}

export function createTransaction(actor, input, idempotencyKey) {
  return createTransfer({ actor, ...input, idempotencyKey });
}

export async function refundTransaction(actor, originalTransactionId, idempotencyKey) {
  const outcome = await withDatabaseTransaction(async (client) => {
    await validateActor(client, actor, true);
    const originalResult = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [originalTransactionId]);
    const original = originalResult.rows[0];
    if (!original) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transaksi asal tidak ditemukan.');

    const existingRefund = await client.query('SELECT * FROM transactions WHERE related_transaction_id = $1', [original.id]);
    if (existingRefund.rowCount) return { transaction: existingRefund.rows[0], replayed: true };
    if (original.status !== 'SUCCESS') throw businessError('REFUND_NOT_ALLOWED', 'Hanya transaksi sukses yang dapat direfund.');

    const inserted = await client.query(
      `INSERT INTO transactions (type, actor_user_id, sender_account_id, receiver_account_id, amount, currency, description, idempotency_key, related_transaction_id)
       VALUES ('REFUND', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [actor.id, original.receiver_account_id, original.sender_account_id, original.amount, original.currency, `Refund untuk ${original.id}`, idempotencyKey, original.id]
    );
    const refundId = inserted.rows[0].id;
    try {
      await executeBalanceMove(client, {
        transactionId: refundId, actor, senderAccountId: original.receiver_account_id, receiverAccountId: original.sender_account_id,
        amount: original.amount, currency: original.currency, allowSystemDebit: true
      });
      await client.query("UPDATE transactions SET status = 'SUCCESS', completed_at = NOW() WHERE id = $1", [refundId]);
      await client.query("UPDATE transactions SET status = 'REFUNDED', completed_at = NOW() WHERE id = $1", [original.id]);
      return { transaction: await getTransaction(client, refundId), replayed: false };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await markFailed(client, refundId, error);
      return { transaction: await getTransaction(client, refundId), replayed: false, businessError: error };
    }
  });
  if (outcome.businessError) {
    outcome.businessError.details = { transactionId: outcome.transaction.id, status: outcome.transaction.status };
    throw outcome.businessError;
  }
  if (outcome.transaction.status === 'FAILED') {
    const error = businessError(outcome.transaction.failure_code ?? 'REFUND_FAILED', outcome.transaction.failure_reason ?? 'Refund sebelumnya gagal.');
    error.details = { transactionId: outcome.transaction.id, status: outcome.transaction.status };
    throw error;
  }
  return outcome;
}

export async function listMyTransactions(userId) {
  const result = await pool.query(
    `SELECT t.*, sa.account_number AS sender_account_number, ra.account_number AS receiver_account_number
     FROM transactions t JOIN accounts sa ON sa.id = t.sender_account_id JOIN accounts ra ON ra.id = t.receiver_account_id
     WHERE sa.user_id = $1 OR ra.user_id = $1 ORDER BY t.created_at DESC`,
    [userId]
  );
  return result.rows;
}
