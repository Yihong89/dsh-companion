import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldVoiceState, SPEAK_EVENT, SPOKEN_EVENT, CHEER_EVENT } from 'dsh-voice-core/lib/fold.js'

test('voice fold comes from dsh-voice-core (shared engine)', () => {
  const s = foldVoiceState([])
  assert.equal(s.speakEnabled, true)
  const events = [
    { type: SPOKEN_EVENT, time: 9, data: { text: 'hi', voice: 'paimon' } },
    { type: CHEER_EVENT, time: 10, data: { text: 'go!', at: 1 } },
  ]
  const folded = foldVoiceState(events)
  assert.deepEqual(folded.lastSpoken, { text: 'hi', voice: 'paimon', seq: 9 })
  assert.deepEqual(folded.lastCheer, { text: 'go!', at: 1, seq: 10 })
})
