// WebRTC ICE configuration. Direct P2P first, STUN discovery, TURN fallback.
export const STUN_SERVER = process.env.STUN_SERVER || 'stun:stun.l.google.com:19302'
export const TURN_SERVER = process.env.TURN_SERVER || ''
export const TURN_USERNAME = process.env.TURN_USERNAME || ''
export const TURN_PASSWORD = process.env.TURN_PASSWORD || ''

export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: STUN_SERVER }]
  if (TURN_SERVER) {
    servers.push({
      urls: TURN_SERVER,
      username: TURN_USERNAME,
      credential: TURN_PASSWORD,
    })
  }
  return servers
}

// Realtime event names shared between client and the socket.io mini-service
export const RT = {
  // client -> server
  AUTH: 'auth',
  MESSAGE_SEND: 'message:send',
  MESSAGE_SEEN: 'message:seen',
  TYPING: 'typing',
  CALL_OFFER: 'call:offer',
  CALL_ANSWER: 'call:answer',
  CALL_ICE: 'call:ice',
  CALL_END: 'call:end',
  CALL_RINGING: 'call:ringing',
  CALL_REJECT: 'call:reject',
  GROUP_MESSAGE_SEND: 'group:message:send',
  REACTION_ADD: 'reaction:add',
  REACTION_REMOVE: 'reaction:remove',
  // server -> client
  MESSAGE_NEW: 'message:new',
  MESSAGE_STATUS: 'message:status',
  TYPING_INDICATOR: 'typing:indicator',
  PRESENCE: 'presence',
  NOTIFICATION: 'notification',
  CALL_INCOMING: 'call:incoming',
  CALL_SDP: 'call:sdp',
  CALL_ICE_CANDIDATE: 'call:ice-candidate',
  CALL_ENDED: 'call:ended',
  GROUP_MESSAGE_NEW: 'group:message:new',
  REACTION_UPDATE: 'reaction:update',
  AUTH_OK: 'auth:ok',
  AUTH_ERROR: 'auth:error',
} as const

export const REALTIME_PORT = 3003
