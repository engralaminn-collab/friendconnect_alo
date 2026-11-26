#!/usr/bin/env node
/**
 * Local STUN/TURN (node-turn) for WebRTC when Coturn is not deployed.
 * UDP only. Production across NATs should use Coturn with a public IP.
 *
 * Gracefully handles missing node-turn module: logs a helpful message and
 * exits cleanly so dev orchestration does not abort when TURN is unavailable.
 */
require('./load-env.cjs')

let Turn = null
try {
  Turn = require('node-turn')
} catch (e) {
  console.warn('[turn] node-turn module not found — TURN relay disabled.', e?.message || '')
  console.warn('[turn] Install with: npm install node-turn  # or deploy Coturn for production TURN')
}

const port = Number(process.env.TURN_PORT || 3478)
const username = process.env.TURN_USERNAME || 'friendconnect'
const password = process.env.TURN_PASSWORD || 'fc-turn-dev-local'
const realm = process.env.TURN_REALM || 'friendconnect'
const debugLevel = process.env.TURN_DEBUG || 'INFO'
// Public IP of this server. Without it node-turn advertises relay candidates as
// 0.0.0.0:<port>, which no browser can reach — TURN relay silently never works
// and calls between different networks (mobile data <-> WiFi) hang on "Connecting…".
const externalIp = process.env.TURN_EXTERNAL_IP || process.env.PUBLIC_IP || ''
const minPort = Number(process.env.TURN_MIN_PORT || 49152)
const maxPort = Number(process.env.TURN_MAX_PORT || 65535)

if (Turn) {
  const server = new Turn({
    listeningPort: port,
    listeningIps: ['0.0.0.0'],
    ...(externalIp ? { externalIps: externalIp } : {}),
    minPort,
    maxPort,
    authMech: 'long-term',
    credentials: { [username]: password },
    realm,
    debugLevel,
  })

  server.start()
  console.log(`[turn] UDP ${port} realm=${realm} user=${username} relay=${minPort}-${maxPort} external=${externalIp || '(unset)'}`)
  if (!externalIp && process.env.NODE_ENV === 'production') {
    console.warn('[turn] TURN_EXTERNAL_IP is not set — relay candidates will be unusable for calls across networks. Set it to this server\'s public IP.')
  }

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
} else {
  console.log('[turn] TURN disabled — using STUN only.')
  console.log('[turn] STUN servers: ' + (process.env.STUN_SERVERS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478'))
  console.log(`[turn] Config: port=${port} user=${username} realm=${realm}`)
}
