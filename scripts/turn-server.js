#!/usr/bin/env node
/**
 * Local STUN/TURN (node-turn) for WebRTC when Coturn is not deployed.
 * UDP only. Production across NATs should use Coturn with a public IP.
 *
 * Gracefully handles missing node-turn module: falls back to STUN-only mode
 * and logs a helpful message instead of crashing in a restart loop.
 */
require('./load-env.cjs')
let Turn = null
try {
  Turn = require('node-turn')
} catch (e) {
  console.warn('[turn] node-turn module not found — TURN relay disabled. ', e.message || '')\n  console.warn('[turn] Install with: npm install node-turn  # or deploy Coturn for production TURN]')\n}\n\nconst port = Number(process.env.TURN_PORT || 3478)
const username = process.env.TURN_USERNAME || 'friendconnect'
const password = process.env.TURN_PASSWORD || 'fc-turn-dev-local'
const realm = process.env.TURN_REALM || 'friendconnect'
const debugLevel = process.env.TURN_DEBUG || 'INFO'
// Public IP of this server. Without it node-turn advertises relay candidates as
// 0.0.0.0:<port>, which no browser can reach — TURN relay silently never works// and calls between different networks (mobile data <-> WiFi) hang on \"Connecting…\".const externalIp = process.env.TURN_EXTERNAL_IP || process.env.PUBLIC_IP || ''const minPort = Number(process.env.TURN_MIN_PORT || 49152)
const maxPort = Number(process.env.TURN_MAX_PORT || 65535)
\n\nif (Turn) {\n  const server = new Turn({\n    listeningPort: port,\n    listeningIps: ['0.0.0.0'],\n    ...(externalIp ? { externalIps: externalIp } : {}),\n    minPort,\n    maxPort,\n    authMech: 'long-term',\n    credentials: { [username]: password },\n    realm,\n    debugLevel,\n  })\n\n  server.start()\n  console.log(`[turn] UDP ${port} realm=${realm} user=${username} relay=${minPort}-${maxPort} external=${externalIp || '(unset)'}`)\n  if (!externalIp && process.env.NODE_ENV === 'production') {\n    console.warn('[turn] TURN_EXTERNAL_IP is not set — relay candidates will be unusable for calls across networks. Set it to this server\\'s public IP.')\n  }\n\n  function stop() {\n    try {\n      if (typeof server.stop === 'function') server.stop()\n    } catch {\n      /* ignore */\n    }\n    process.exit(0)\n  }\n\n  process.on('SIGINT', stop)\n  process.on('SIGTERM', stop)\n} else {\n  console.log('[turn] TURN disabled — using STUN only.')\n  console.log('[turn] STUN servers: ' + (process.env.STUN_SERVERS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478'))\n  \n  // Still log the TURN config env vars for diagnostics\n  console.log(`[turn] Config: port=${port} user=${username} realm=${realm}`)\n}\n","kind":"text","lines":58,"size":1924}
