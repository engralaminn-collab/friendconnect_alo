import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const migrationsUrl = new URL('./migrations/', import.meta.url);

export async function runMigrations(pool) {
  const connection = await pool.getConnection();
  const lockName = 'friendconnect:self-hosted:migrations';
  let locked = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
    if (lock?.acquired !== 1) throw new Error('Could not acquire the schema migration lock.');
    locked = true;

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const migrationFiles = (await readdir(fileURLToPath(migrationsUrl)))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name))
      .sort();

    for (const name of migrationFiles) {
      const sql = await readFile(new URL(name, migrationsUrl), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const [applied] = await connection.query('SELECT checksum FROM schema_migrations WHERE name = ?', [name]);
      if (applied.length) {
        if (applied[0].checksum !== checksum) {
          throw new Error(`Applied migration ${name} has changed; add a new migration instead of editing it.`);
        }
        continue;
      }

      for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
        await connection.query(statement);
      }
      await connection.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [name, checksum]);
    }
  } finally {
    if (locked) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } catch {
        // The connection close also releases the advisory lock.
      }
    }
    connection.release();
  }
}
