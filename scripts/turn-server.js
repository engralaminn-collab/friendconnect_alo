#!/usr/bin/env node
/**
 * Local STUN/TURN (node-turn) for WebRTC when Coturn is not deployed.
 * UDP only. Production across NATs should use Coturn with a public IP.
 */
require('./load-env.cjs')
const Turn = require('node-turn')

const port = Number(process.env.TURN_PORT || 3478)
const username = process.env.TURN_USERNAME || 'friendconnect'
const password = process.env.TURN_PASSWORD || 'fc-turn-dev-local'
const realm = process.env.TURN_REALM || 'friendconnect'
const debugLevel = process.env.TURN_DEBUG || 'INFO'

const server = new Turn({
  listeningPort: port,
  listeningIps: ['0.0.0.0'],
  authMech: 'long-term',
  credentials: { [username]: password },
  realm,
  debugLevel,
})

server.start()
console.log(`[turn] UDP ${port} realm=${realm} user=${username}`)

function stop() {
  try {
    if (typeof server.stop === 'function') server.stop()
  } catch {
    /* ignore */
  }
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
