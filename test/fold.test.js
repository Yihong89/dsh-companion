import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldSisterState, SPEAK_EVENT, SPOKEN_EVENT, CHEER_EVENT } from '../lib/fold.js'

test('fold defaults: speak on, nothing spoken or cheered', () => {
  const s = foldSisterState([])
  assert.equal(s.speakEnabled, true)
  assert.equal(s.lastSpoken, null)
  assert.equal(s.lastCheer, null)
})

test('fold tracks the speak toggle (last one wins)', () => {
  const events = [
    { type: SPEAK_EVENT, data: { enabled: false } },
    { type: SPEAK_EVENT, data: { enabled: true } },
  ]
  assert.equal(foldSisterState(events).speakEnabled, true)
})

test('fold records the last spoken request with its seq', () => {
  const events = [
    { type: SPOKEN_EVENT, time: 5, data: { text: 'first' } },
    { type: SPOKEN_EVENT, time: 9, data: { text: 'second', voice: 'en-US' } },
  ]
  const s = foldSisterState(events)
  assert.deepEqual(s.lastSpoken, { text: 'second', voice: 'en-US', seq: 9 })
})

test('fold records the last cheer', () => {
  const events = [
    { type: CHEER_EVENT, time: 3, data: { text: 'You are awesome!', at: 100 } },
  ]
  const s = foldSisterState(events)
  assert.deepEqual(s.lastCheer, { text: 'You are awesome!', at: 100, seq: 3 })
})

test('fold respects a prefix end', () => {
  const events = [
    { type: SPOKEN_EVENT, time: 1, data: { text: 'a' } },
    { type: SPOKEN_EVENT, time: 2, data: { text: 'b' } },
  ]
  assert.equal(foldSisterState(events, 1).lastSpoken.text, 'a')
  assert.equal(foldSisterState(events, 2).lastSpoken.text, 'b')
})
