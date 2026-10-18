#!/usr/bin/env node
const { spawn } = require('child_process')

const env = { ...process.env, PORT: process.env.PORT || '3000' }
const kids = []

function run(cmd, args, extra = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: { ...env, ...extra } })
  kids.push(child)
  child.on('exit', (code) => {
    if (code && code !== 0) shutdown(code)
  })
  return child
}

function shutdown(code = 0) {
  for (const k of kids) {
    try {
      k.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const fs = require('fs')
const path = require('path')
const redisBin = path.resolve(__dirname, '..', 'vendor', 'redis-server')
if (fs.existsSync(redisBin)) {
  fs.mkdirSync(path.resolve(__dirname, '..', 'logs', 'redis'), { recursive: true })
  run(redisBin, ['--port', process.env.REDIS_PORT || '6379', '--bind', '127.0.0.1', '--dir', path.resolve(__dirname, '..', 'logs', 'redis'), '--save', '', '--appendonly', 'no'])
}
run('node', ['scripts/mail-sink.cjs'])
run('npx', ['next', 'dev', '-H', '0.0.0.0', '-p', '3001'], { PORT: '3001' })
run('node', ['socket-server.js'], { SOCKET_PORT: '3003' })
run('node', ['scripts/gateway.cjs'], { PORT: '3000', NEXT_INTERNAL_PORT: '3001', SOCKET_PORT: '3003' })
run('node', ['scripts/turn-server.js'], {
  TURN_PORT: process.env.TURN_PORT || '3478',
  TURN_USERNAME: process.env.TURN_USERNAME || 'friendconnect',
  TURN_PASSWORD: process.env.TURN_PASSWORD || 'fc-turn-dev-local',
  TURN_REALM: process.env.TURN_REALM || 'friendconnect',
})
