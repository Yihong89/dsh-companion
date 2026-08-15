import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CHEERS, pickCheer, parseTimes, timeOf, dateKey, dueTimes } from '../lib/cheers.js'

test('cheer bank is non-empty and stable per day', () => {
  assert.ok(DEFAULT_CHEERS.length >= 15)
  const now = new Date(2026, 7, 15, 9, 0, 0)
  assert.equal(pickCheer(DEFAULT_CHEERS, now), pickCheer(DEFAULT_CHEERS, new Date(2026, 7, 15, 23, 59)))
  assert.notEqual(pickCheer(DEFAULT_CHEERS, new Date(2026, 7, 15)), pickCheer(DEFAULT_CHEERS, new Date(2026, 7, 16)))
})

test('pickCheer handles empty bank and wraps around', () => {
  assert.equal(pickCheer([], new Date()), 'You are amazing! Keep going! 💛')
  const single = ['one']
  assert.equal(pickCheer(single, new Date()), 'one')
  const two = ['a', 'b']
  assert.equal(pickCheer(two, new Date(2026, 0, 1)), pickCheer(two, new Date(2026, 0, 3)))
})

test('parseTimes normalizes and dedupes', () => {
  assert.deepEqual(parseTimes(['8:00', '16:30']), ['08:00', '16:30'])
  assert.deepEqual(parseTimes('08:00,16:30'), ['08:00', '16:30'])
  assert.deepEqual(parseTimes('08:00 08:00'), ['08:00'])
  assert.deepEqual(parseTimes(undefined), ['08:00', '16:30'])
})

test('parseTimes rejects bad formats', () => {
  assert.throws(() => parseTimes(['25:00']), /invalid time/)
  assert.throws(() => parseTimes(['08:60']), /invalid time/)
  assert.throws(() => parseTimes(['nope']), /invalid time/)
  assert.throws(() => parseTimes([]), /at least one/)
})

test('timeOf / dateKey format local time', () => {
  const now = new Date(2026, 7, 15, 8, 5, 30)
  assert.equal(timeOf(now), '08:05')
  assert.equal(dateKey(now), '2026-08-15')
})

test('dueTimes fires each configured time once per day', () => {
  const at = new Date(2026, 7, 15, 8, 0, 10)
  assert.deepEqual(dueTimes(['08:00', '16:30'], at, new Set()), ['08:00'])
  // same minute already fired → nothing
  assert.deepEqual(dueTimes(['08:00', '16:30'], at, new Set(['08:00'])), [])
  // later time not due yet
  assert.deepEqual(dueTimes(['16:30'], at, new Set()), [])
})
