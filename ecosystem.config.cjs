// PM2 process file. All settings come from .env (PORT, SOCKET_PORT, DATABASE_URL, …).
//   pm2 startOrReload ecosystem.config.cjs && pm2 save
//
// The Next.js standalone server does NOT read .env by itself, so every variable from
// .env is passed to the processes here. Edit .env, then `pm2 reload ecosystem.config.cjs`.
const fs = require('fs')
const path = require('path')

const APP_DIR = process.env.APP_DIR || path.resolve(__dirname)

function readDotEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    out[key] = val
  }
  return out
}

const dotenv = readDotEnv(path.join(APP_DIR, '.env'))
const env = { ...dotenv, NODE_ENV: 'production', APP_DIR }
const PORT = Number(env.PORT || 3000)
const SOCKET_PORT = Number(env.SOCKET_PORT || 3003)
const NAME = env.PM2_NAME || 'friendconnect'
const TURN_ENABLED = (env.TURN_ENABLED || 'true') !== 'false'

const common = {
  cwd: APP_DIR,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  watch: false,
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
}

const apps = [
  {
    ...common,
    name: NAME,
    script: '.next/standalone/server.js',
    max_memory_restart: '768M',
    env: { ...env, PORT, HOSTNAME: env.HOSTNAME || '127.0.0.1' },
    out_file: './logs/app-out.log',
    error_file: './logs/app-error.log',
    kill_timeout: 5000,
    listen_timeout: 15000,
  },
  {
    ...common,
    name: `${NAME}-socket`,
    script: 'socket-server.js',
    max_memory_restart: '384M',
    env: { ...env, SOCKET_PORT },
    out_file: './logs/socket-out.log',
    error_file: './logs/socket-error.log',
    kill_timeout: 5000,
  },
]

if (TURN_ENABLED) {
  apps.push({
    ...common,
    name: `${NAME}-turn`,
    script: 'scripts/turn-server.js',
    max_memory_restart: '192M',
    env: { ...env, TURN_PORT: Number(env.TURN_PORT || 3478) },
    out_file: './logs/turn-out.log',
    error_file: './logs/turn-error.log',
  })
}

module.exports = { apps }
