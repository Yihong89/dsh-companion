import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sisterSpeakProjectionWith, SISTER_SPEAK_KEY,
  initSisterSpeakProjection, applySisterSpeakProjection,
} from '../lib/sister-projection.js'

test('projection key and version are stable', () => {
  const def = sisterSpeakProjectionWith({})
  assert.equal(def.key, SISTER_SPEAK_KEY)
  assert.equal(def.stateVersion, 1)
  assert.equal(typeof def.init, 'function')
  assert.equal(typeof def.apply, 'function')
  assert.equal(typeof def.view, 'function')
})

test('init has speak on and nothing spoken', () => {
  assert.deepEqual(initSisterSpeakProjection(), { speakEnabled: true, lastSpoken: null, lastCheer: null })
})

test('apply folds speak toggle, spoken, and cheer', () => {
  let s = initSisterSpeakProjection()
  s = applySisterSpeakProjection(s, { type: 'sister/speak', data: { enabled: false } })
  assert.equal(s.speakEnabled, false)
  s = applySisterSpeakProjection(s, { type: 'sister/spoken', time: 7, data: { text: 'hi', voice: null } })
  assert.deepEqual(s.lastSpoken, { text: 'hi', voice: null, seq: 7 })
  assert.equal(s.speakEnabled, false, 'toggle state survives')
  s = applySisterSpeakProjection(s, { type: 'sister/cheer', time: 9, data: { text: 'go!', at: 123 } })
  assert.deepEqual(s.lastCheer, { text: 'go!', at: 123, seq: 9 })
  assert.equal(s.speakEnabled, false)
})

test('apply returns the same reference for unrelated events', () => {
  const s = initSisterSpeakProjection()
  const next = applySisterSpeakProjection(s, { type: 'user/message', data: {} })
  assert.equal(next, s)
})

test('view is identity', () => {
  const s = initSisterSpeakProjection()
  assert.equal(sisterSpeakProjectionWith({}).view(s), s)
})
