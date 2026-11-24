import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync, sign } from 'node:crypto'
import {
  verifyHttpSmsWebhookAuth,
  verifyTelnyxWebhookSignature,
  verifyTwilioWebhookSignature,
} from '../../src/lib/jara-sms-signature'
import { getSmsCapability, isValidE164, sendSmsViaProvider } from '../../src/lib/jara-sms'

function signature(url: string, token: string, params: Record<string, string>) {
  const canonical = Object.keys(params).sort().reduce((value, key) => value + key + params[key], url)
  return createHmac('sha1', token).update(canonical, 'utf8').digest('base64')
}

function makeHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const s = createHmac('sha256', secret).update(`${h}.${p}`, 'utf8').digest('base64url')
  return `${h}.${p}.${s}`
}

test('Twilio verifier accepts a valid form signature independent of object key order', () => {
  const url = 'https://example.test/api/jara/sms/webhook'
  const token = 'test-auth-token'
  const params = { Body: 'hello', From: '+15551234567', To: '+15557654321' }
  assert.equal(verifyTwilioWebhookSignature({ publicUrl: url, authToken: token, signature: signature(url, token, params), params }), true)
})

test('Twilio verifier rejects tampering, wrong credentials, and non-HTTPS URLs', () => {
  const url = 'https://example.test/api/jara/sms/webhook'
  const token = 'test-auth-token'
  const params = { Body: 'hello', From: '+15551234567' }
  const signed = signature(url, token, params)
  assert.equal(verifyTwilioWebhookSignature({ publicUrl: url, authToken: token, signature: signed, params: { ...params, Body: 'changed' } }), false)
  assert.equal(verifyTwilioWebhookSignature({ publicUrl: url, authToken: 'wrong-token', signature: signed, params }), false)
  assert.equal(verifyTwilioWebhookSignature({ publicUrl: url.replace('https:', 'http:'), authToken: token, signature: signed, params }), false)
})

test('httpSMS verifier accepts valid HS256 JWT or secret header and rejects expired/bad tokens', () => {
  const secret = 'httpsms-signing-secret'
  const now = 1_800_000_000
  const validJwt = makeHs256Jwt({ sub: 'user-1', exp: now + 60 }, secret)
  const expiredJwt = makeHs256Jwt({ sub: 'user-1', exp: now - 10 }, secret)
  assert.equal(verifyHttpSmsWebhookAuth({ secret, authorizationHeader: `Bearer ${validJwt}`, nowSeconds: now }), true)
  assert.equal(verifyHttpSmsWebhookAuth({ secret, authorizationHeader: `Bearer ${expiredJwt}`, nowSeconds: now }), false)
  assert.equal(verifyHttpSmsWebhookAuth({ secret, authorizationHeader: `Bearer ${validJwt}`, nowSeconds: now }), true)
  assert.equal(verifyHttpSmsWebhookAuth({ secret, secretHeader: secret }), true)
  assert.equal(verifyHttpSmsWebhookAuth({ secret, secretHeader: 'wrong' }), false)
})

test('Telnyx Ed25519 verifier verifies valid payloads and rejects tampered bodies or stale timestamps', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const now = 1_800_000_000
  const rawBody = JSON.stringify({ data: { event_type: 'message.received', payload: { text: 'hi' } } })
  const sig = sign(null, Buffer.from(`${now}|${rawBody}`, 'utf8'), privateKey).toString('base64')

  assert.equal(verifyTelnyxWebhookSignature({ publicKey: pubPem, signatureBase64: sig, timestamp: String(now), rawBody, nowSeconds: now }), true)
  assert.equal(verifyTelnyxWebhookSignature({ publicKey: pubPem, signatureBase64: sig, timestamp: String(now), rawBody: rawBody + ' ', nowSeconds: now }), false)
  assert.equal(verifyTelnyxWebhookSignature({ publicKey: pubPem, signatureBase64: sig, timestamp: String(now), rawBody, nowSeconds: now + 600 }), false)
})

test('SMS capability and send fail closed when provider credentials are missing', async () => {
  assert.equal(isValidE164('+8801712345678'), true)
  assert.equal(isValidE164('01712345678'), false)
  const cap = getSmsCapability({ enabled: true, provider: 'httpsms', outboundEnabled: true })
  assert.equal(cap.outboundReady, false)
  const res = await sendSmsViaProvider({ provider: 'none', from: '+15550001111', to: '+15550002222', body: 'hi' })
  assert.equal(res.ok, false)
  assert.equal(res.httpStatus, 503)
})
