import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyTwilioWebhookSignature } from '../../src/lib/jara-sms-signature'

function signature(url: string, token: string, params: Record<string, string>) {
  const canonical = Object.keys(params).sort().reduce((value, key) => value + key + params[key], url)
  return createHmac('sha1', token).update(canonical, 'utf8').digest('base64')
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
