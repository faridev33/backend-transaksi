import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';

async function start() {
  await pool.query('SELECT 1');
  app.listen(env.port, () => console.log(`API berjalan di http://localhost:${env.port}`));
}

start().catch((error) => {
  console.error('Gagal memulai API:', error.message);
  process.exit(1);
});
