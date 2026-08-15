/**
 * Session-event folding for dsh-sister.
 *
 * The sister's voice state and cheer feed are log-only session state, so
 * resume/fork/compaction recover them without a live mirror (same pattern as
 * dsh-teacher):
 *
 * - `sister/speak`   { enabled: boolean }                — TTS toggle
 * - `sister/spoken`  { text, voice }                     — a speak request
 * - `sister/cheer`   { text, at }                        — a cheer fired
 */

export const SPEAK_EVENT = 'sister/speak'
export const SPOKEN_EVENT = 'sister/spoken'
export const CHEER_EVENT = 'sister/cheer'

/**
 * Fold sister state from a session log (or a prefix of it).
 * @returns {{ speakEnabled: boolean, lastSpoken: object|null, lastCheer: object|null }}
 */
export function foldSisterState(events, end = events.length) {
  let speakEnabled = true
  let lastSpoken = null
  let lastCheer = null
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === SPEAK_EVENT) {
      speakEnabled = Boolean(event.data.enabled)
    } else if (event.type === SPOKEN_EVENT) {
      lastSpoken = {
        text: event.data.text ?? '',
        voice: event.data.voice ?? null,
        seq: event.time ?? index,
      }
    } else if (event.type === CHEER_EVENT) {
      lastCheer = {
        text: event.data.text ?? '',
        at: event.data.at ?? null,
        seq: event.time ?? index,
      }
    }
  }
  return { speakEnabled, lastSpoken, lastCheer }
}

/** Whether the log holds an opened turn without its closing `turn/end`. */
export function hasOpenTurn(events) {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}
