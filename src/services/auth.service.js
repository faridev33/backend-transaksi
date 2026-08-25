import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

export async function login({ email, password }) {
  const result = await pool.query(
    'SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
  }
  if (!user.is_active) throw new AppError(403, 'USER_INACTIVE', 'Akun pengguna tidak aktif.');

  const token = jwt.sign({ sub: user.id, role: user.role, name: user.name }, env.jwtSecret, { expiresIn: '1h' });
  return { accessToken: token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}
