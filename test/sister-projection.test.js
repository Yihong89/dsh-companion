import { test } from 'node:test'
import assert from 'node:assert/strict'
import { voiceSpeakProjectionWith, VOICE_SPEAK_KEY } from 'dsh-voice-core/lib/voice-projection.js'

test('voiceSpeak projection comes from dsh-voice-core', () => {
  const def = voiceSpeakProjectionWith({})
  assert.equal(def.key, VOICE_SPEAK_KEY)
  assert.equal(def.stateVersion, 1)
})
