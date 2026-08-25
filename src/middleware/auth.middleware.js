import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

export function requireAuth(req, _res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(new AppError(401, 'UNAUTHENTICATED', 'Token Bearer wajib dikirim.'));
  try {
    req.user = jwt.verify(token, env.jwtSecret);
    next();
  } catch {
    next(new AppError(401, 'UNAUTHENTICATED', 'Token tidak valid atau sudah kedaluwarsa.'));
  }
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'ADMIN') return next(new AppError(403, 'FORBIDDEN', 'Hanya admin yang dapat melakukan refund.'));
  next();
}
