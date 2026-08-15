/**
 * `sisterSpeak` session projection: folds `sister/speak`, `sister/spoken` and
 * `sister/cheer` events so the Web client can drive browser TTS through
 * `useProjection('sisterSpeak')` — auto-reading assistant replies, honoring
 * explicit speak requests, and surfacing scheduled cheers.
 */

export const SISTER_SPEAK_KEY = 'sisterSpeak'

export function initSisterSpeakProjection() {
  return { speakEnabled: true, lastSpoken: null, lastCheer: null }
}

/**
 * Fold one committed session event. Must return the SAME reference when the
 * event is not the unit's (the projection registry's zero-work contract).
 */
export function applySisterSpeakProjection(state, event) {
  if (event.type === 'sister/speak') {
    return { speakEnabled: Boolean(event.data.enabled), lastSpoken: state.lastSpoken, lastCheer: state.lastCheer }
  }
  if (event.type === 'sister/spoken') {
    return {
      speakEnabled: state.speakEnabled,
      lastSpoken: {
        text: event.data.text ?? '',
        voice: event.data.voice ?? null,
        seq: event.time ?? state.lastSpoken?.seq ?? 0,
      },
      lastCheer: state.lastCheer,
    }
  }
  if (event.type === 'sister/cheer') {
    return {
      speakEnabled: state.speakEnabled,
      lastSpoken: state.lastSpoken,
      lastCheer: {
        text: event.data.text ?? '',
        at: event.data.at ?? null,
        seq: event.time ?? state.lastCheer?.seq ?? 0,
      },
    }
  }
  return state
}

/** State → wire payload (read-side projection; schema-validated by the host). */
export function viewSisterSpeakProjection(state) {
  return state
}

/** Bind the fold to a schema and return a ProjectionDefinition. */
export function sisterSpeakProjectionWith(schema) {
  return {
    key: SISTER_SPEAK_KEY,
    schema,
    init: initSisterSpeakProjection,
    apply: applySisterSpeakProjection,
    view: viewSisterSpeakProjection,
    stateVersion: 1,
  }
}
