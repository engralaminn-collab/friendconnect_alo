import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto'

/** Verify Twilio's form-encoded webhook signature against the configured public URL. */
export function verifyTwilioWebhookSignature(input: {
  publicUrl: string
  authToken: string
  signature: string
  params: Record<string, string>
}): boolean {
  if (!input.publicUrl.startsWith('https://') || !input.authToken || !input.signature) return false
  const canonical = Object.keys(input.params)
    .sort()
    .reduce((value, key) => value + key + input.params[key], input.publicUrl)
  const expected = createHmac('sha1', input.authToken).update(canonical, 'utf8').digest('base64')
  const actualBytes = Buffer.from(input.signature, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function timingSafeMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Verify an HS256 JWT (used by httpSMS CloudEvents webhooks) or shared secret header. */
export function verifyHttpSmsWebhookAuth(input: {
  secret: string
  authorizationHeader?: string | null
  secretHeader?: string | null
  nowSeconds?: number
}): boolean {
  if (!input.secret) return false
  if (input.secretHeader && timingSafeMatch(input.secretHeader, input.secret)) {
    return true
  }
  const auth = (input.authorizationHeader || '').trim()
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  const token = auth.slice(7).trim()
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [headerB64, payloadB64, sigB64] = parts
  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'))
    if (header?.alg !== 'HS256') return false
    const expectedSig = createHmac('sha256', input.secret)
      .update(`${headerB64}.${payloadB64}`, 'utf8')
      .digest('base64url')
    if (!timingSafeMatch(sigB64, expectedSig)) return false
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
    if (typeof payload?.exp === 'number' && payload.exp < now) return false
    return true
  } catch {
    return false
  }
}

/** Verify Telnyx Ed25519 webhook signature (`telnyx-signature-ed25519` + `telnyx-timestamp`). */
export function verifyTelnyxWebhookSignature(input: {
  publicKey: string
  signatureBase64: string
  timestamp: string
  rawBody: string
  nowSeconds?: number
  toleranceSeconds?: number
}): boolean {
  if (!input.publicKey || !input.signatureBase64 || !input.timestamp || !input.rawBody) return false
  const ts = Number(input.timestamp)
  if (!Number.isFinite(ts)) return false
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSeconds ?? 300
  if (Math.abs(now - ts) > tolerance) return false

  try {
    const trimmed = input.publicKey.trim()
    let keyObj
    if (trimmed.includes('BEGIN PUBLIC KEY')) {
      keyObj = createPublicKey(trimmed)
    } else {
      const rawKey = Buffer.from(trimmed, 'base64')
      if (rawKey.length !== 32) return false
      // Wrap raw 32-byte Ed25519 key in SubjectPublicKeyInfo ASN.1 DER prefix
      const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex')
      keyObj = createPublicKey({
        key: Buffer.concat([spkiPrefix, rawKey]),
        format: 'der',
        type: 'spki',
      })
    }
    const sigBytes = Buffer.from(input.signatureBase64.trim(), 'base64')
    const signedPayload = Buffer.from(`${input.timestamp}|${input.rawBody}`, 'utf8')
    return verify(null, signedPayload, keyObj, sigBytes)
  } catch {
    return false
  }
}
