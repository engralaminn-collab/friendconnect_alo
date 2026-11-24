#!/usr/bin/env node
/**
 * Emit shell assignments for the MySQL connection parameters in DATABASE_URL.
 *
 * Used by scripts/deploy.sh to run `mysqldump` without printing credentials and
 * without the nested-quoting hazards of inlining JavaScript inside `eval`.
 *
 * Output (shell-quoted, eval-safe):
 *
 *   DB_NAME='friendconnect'; DB_HOST='db'; DB_PORT='3306'; DB_USER='app'; DB_PASS='...'
 *
 * Pass `--mysql-args` to instead print the equivalent `--host=… --user=…` flags
 * (still without the password, which the caller passes via MYSQL_PWD).
 *
 * Exits 1 when DATABASE_URL is not a MySQL/MariaDB URL.
 */

const url = process.env.DATABASE_URL

if (!url || !/^(mysql|mariadb):\/\//i.test(url)) {
  process.stderr.write('db-url-env: DATABASE_URL is not a mysql:// or mariadb:// URL\n')
  process.exit(1)
}

let parsed
try {
  parsed = new URL(url)
} catch (error) {
  process.stderr.write(`db-url-env: cannot parse DATABASE_URL: ${error.message}\n`)
  process.exit(1)
}

const database = parsed.pathname.replace(/^\//, '')
if (!database) {
  process.stderr.write('db-url-env: DATABASE_URL has no database name\n')
  process.exit(1)
}

const fields = {
  DB_NAME: database,
  DB_HOST: parsed.hostname || 'localhost',
  DB_PORT: parsed.port || '3306',
  DB_USER: decodeURIComponent(parsed.username || 'root'),
  DB_PASS: decodeURIComponent(parsed.password || ''),
}

if (process.argv.includes('--mysql-args')) {
  process.stdout.write(`--host=${fields.DB_HOST} --port=${fields.DB_PORT} --user=${fields.DB_USER}`)
  process.exit(0)
}

/** POSIX single-quote a value: ' -> '\'' */
const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

process.stdout.write(
  Object.entries(fields)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join('; ') + '\n',
)
