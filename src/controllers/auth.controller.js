import { z } from 'zod';
import * as authService from '../services/auth.service.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function login(req, res) {
  const result = await authService.login(loginSchema.parse(req.body));
  res.json(result);
}
