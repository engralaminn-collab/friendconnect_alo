import { createHmac, timingSafeEqual } from 'node:crypto'

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
