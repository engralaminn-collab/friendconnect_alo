import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInstructionToPatch } from '../../src/lib/jara'

test('formal business suit -> clothing patch', () => {
  const r = parseInstructionToPatch('জারা, আজ থেকে তোমার পোশাক ফরমাল বিজনেস স্যুট করে দাও।')
  assert.ok(r.patch.clothing)
  assert.match(String(r.patch.clothing), /formal-business-suit/)
  assert.equal(r.scope, 'persistent')
})

test('ALO Labs official office background -> alo-office', () => {
  const r = parseInstructionToPatch('তোমার ব্যাকগ্রাউন্ড ALO Labs-এর অফিসিয়াল ব্যাকগ্রাউন্ড করে দাও।')
  assert.equal(r.patch.background, 'alo-office')
})

test('next video call outdoor temporary scope', () => {
  const r = parseInstructionToPatch('পরবর্তী ভিডিও কলে তুমি একটি সুন্দর আউটডোর পরিবেশে থাকবে।')
  assert.equal(r.scope, 'temporary_next_call')
  assert.equal(r.patch.background, 'outdoor')
})

test('bangla primary, english when needed -> mixed', () => {
  const r = parseInstructionToPatch('আজ থেকে সবার সঙ্গে প্রথমে বাংলায় কথা বলবে। প্রয়োজন হলে ইংরেজিতে উত্তর দেবে।')
  assert.equal(r.patch.voiceLanguage, 'mixed')
})

test('friendly and professional tone', () => {
  const r = parseInstructionToPatch('তুমি এখন থেকে আরও ভদ্র, বন্ধুত্বপূর্ণ এবং প্রফেশনালভাবে কথা বলবে।')
  assert.equal(r.patch.personality, 'friendly')
  assert.equal((r.patch as any).communicationStyle, 'professional')
})

test('restore default appearance', () => {
  const r = parseInstructionToPatch('জারা, তোমার আগের ডিফল্ট অফিসিয়াল লুক ফিরিয়ে আনো।')
  assert.equal(r.restoreDefault, true)
  assert.equal(r.patch.face, 'realistic')
  assert.equal(r.patch.background, 'gradient-emerald')
})