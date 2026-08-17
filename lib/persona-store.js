/**
 * dsh-companion persona store — per-session persona JSON, read/written the
 * same best-effort way dsh-voice-core's VoiceSchedule persists the (now
 * unused, for this plugin) global schedule: corrupt or missing data falls
 * back to defaults instead of throwing.
 *
 * A preset composition mounts once per process and is shared by every
 * session on it (dsh-agent-presets' standing mount) -- persona state can't
 * live in a plugin-apply-time closure, so it's a file per session, read
 * live wherever it's needed (system-prompt render, TTS instruct
 * resolution, the scheduler tick).
 *
 * @module dsh-companion/lib/persona-store
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_STYLES, DEFAULT_STYLE } from 'dsh-voice-core'

export const DEFAULT_PERSONA = Object.freeze({
  name: '小助手',
  personality: '一个温暖、友善的陪伴助手。用简短、真诚的话语回应，偶尔带点关心和鼓励。',
  voice: Object.freeze({ presetKey: DEFAULT_STYLE, instruct: DEFAULT_STYLES[DEFAULT_STYLE].instruct }),
  schedule: Object.freeze({ times: Object.freeze([]), fired: Object.freeze({}) }),
})

export function personaPath(stateDir, sessionId) {
  return join(stateDir, 'personas', `${sessionId}.json`)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function mergeWithDefault(data) {
  const base = clone(DEFAULT_PERSONA)
  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : base.name,
    personality: typeof data.personality === 'string' && data.personality.trim() ? data.personality.trim() : base.personality,
    voice: {
      presetKey: typeof data.voice?.presetKey === 'string' && data.voice.presetKey ? data.voice.presetKey : undefined,
      instruct: typeof data.voice?.instruct === 'string' && data.voice.instruct.trim() ? data.voice.instruct.trim() : base.voice.instruct,
    },
    schedule: {
      times: Array.isArray(data.schedule?.times) ? data.schedule.times.filter((t) => typeof t === 'string') : [],
      fired: data.schedule?.fired && typeof data.schedule.fired === 'object' ? data.schedule.fired : {},
    },
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
  }
}

/** Read one session's persona, merged over DEFAULT_PERSONA. Never throws. */
export function readPersona(stateDir, sessionId) {
  const path = personaPath(stateDir, sessionId)
  try {
    if (!existsSync(path)) return clone(DEFAULT_PERSONA)
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return mergeWithDefault(data)
  } catch (error) {
    return clone(DEFAULT_PERSONA)
  }
}

/** Persist one session's persona (name/personality/voice/schedule.times),
 * preserving schedule.fired and createdAt across saves. Best-effort. */
export function writePersona(stateDir, sessionId, partial, now = Date.now()) {
  const existing = readPersona(stateDir, sessionId)
  const payload = {
    name: String(partial.name ?? existing.name).trim() || DEFAULT_PERSONA.name,
    personality: String(partial.personality ?? existing.personality).trim() || DEFAULT_PERSONA.personality,
    voice: {
      presetKey: partial.voice?.presetKey || undefined,
      instruct: String(partial.voice?.instruct ?? existing.voice.instruct).trim() || DEFAULT_PERSONA.voice.instruct,
    },
    schedule: {
      times: Array.isArray(partial.schedule?.times) ? partial.schedule.times : existing.schedule.times,
      fired: existing.schedule.fired,
    },
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
  }
  const path = personaPath(stateDir, sessionId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(payload, null, 2))
  return payload
}

/** Mark one due time fired today for a session's persona. Best-effort,
 * mirrors VoiceSchedule.markFired's failure handling. */
export function markFired(stateDir, sessionId, day, time) {
  try {
    const persona = readPersona(stateDir, sessionId)
    const fired = { ...persona.schedule.fired }
    fired[day] = [...(fired[day] ?? []), time]
    const payload = { ...persona, schedule: { ...persona.schedule, fired } }
    const path = personaPath(stateDir, sessionId)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(payload, null, 2))
  } catch (error) {
    // best-effort persistence, same as VoiceSchedule.save()
  }
}
