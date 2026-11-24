import 'dotenv/config';
import { readConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

const pool = createPool(readConfig().database);
try {
  await runMigrations(pool);
  console.info('Database migrations are current.');
} catch (error) {
  console.error(`Database migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
