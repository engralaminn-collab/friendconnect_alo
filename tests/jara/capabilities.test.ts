import test from 'node:test'
import assert from 'node:assert/strict'
import { getRendererCapability } from '../../src/lib/jara-renderer'
import { getVoiceCapability } from '../../src/lib/jara-voice'
import { getMalwareScanner } from '../../src/lib/jara-scanner'

test('renderer capability is honest in default env', () => {
  const cap = getRendererCapability()
  assert.equal(cap.realVideoTrack, false)
  assert.equal(cap.audioDrivenLipSync, false)
  assert.equal(cap.mode, 'browser_fallback')
})

test('voice capability is honest in default env', () => {
  const cap = getVoiceCapability()
  assert.equal(cap.mode, 'browser_fallback')
  assert.equal(cap.stt.configured, false)
  assert.equal(cap.tts.configured, false)
  assert.equal(cap.realtime.streamingAsr, false)
})

test('malware scanner reports not_configured by default', async () => {
  const scanner = getMalwareScanner()
  const res = await scanner.scan(Buffer.from('test'), 'test.txt')
  assert.equal(res.status, 'not_configured')
})