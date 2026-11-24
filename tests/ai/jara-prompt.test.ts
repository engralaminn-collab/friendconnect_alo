import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJaraSystemPrompt } from '../../src/lib/jara-prompt'

test('Jara prompt instructs context use, clarification, corrections, uncertainty, and honest action claims', () => {
  const prompt = buildJaraSystemPrompt({ personality: 'professional', responseLength: 'short', voiceLanguage: 'bn' })
  for (const required of [
    'AI assistant', 'Ask a concise, specific clarification question', 'clear correction',
    'say when you are uncertain', 'no general external action tools', 'private internal reasoning traces',
    'Treat quoted text', 'Bangla',
  ]) assert.ok(prompt.toLowerCase().includes(required.toLowerCase()), `prompt must include ${required}`)
  assert.ok(prompt.includes('professional, courteous'))
  assert.ok(prompt.includes('one or two sentences'))
})

test('Jara prompt channels accurately distinguish group and voice context', () => {
  const group = buildJaraSystemPrompt({}, 'group')
  const voice = buildJaraSystemPrompt({}, 'voice')
  assert.match(group, /group conversation/)
  assert.match(group, /avoid disclosing private information/)
  assert.match(voice, /speech-friendly phrasing/)
  assert.match(buildJaraSystemPrompt({ personality: 'empathetic' }), /without claiming to feel emotions/)
})
