import { ZodError } from 'zod';

export function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Data request tidak valid.', details: error.flatten() } });
  }
  if (error.code === '23505') {
    return res.status(409).json({ error: { code: 'DUPLICATE_DATA', message: 'Data duplikat.' } });
  }
  const status = error.statusCode ?? error.status ?? 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: { code: error.code ?? 'INTERNAL_ERROR', message: status >= 500 ? 'Terjadi kesalahan internal.' : error.message, details: error.details } });
}
