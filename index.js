/**
 * dsh-companion host plugin — thin shell over the shared dsh-voice-core
 * engine, configured generically. Persona identity, voice, and greeting
 * schedule are NOT fixed here (see lib/persona-store.js and friends,
 * landing in later tasks) -- they are per-session, user-configured data.
 *
 * @module dsh-companion
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applyVoice, VoiceController, VoiceSchedule, TICK_MS } from 'dsh-voice-core'
import { DEFAULT_STYLES, DEFAULT_STYLE } from 'dsh-voice-core'
import { registerPersonaRoutes } from './lib/persona-routes.js'
import { registerPersonaPrompt } from './lib/persona-prompt.js'
import { createPersonaScheduler } from './lib/persona-scheduler.js'

export const name = 'dsh-companion'

/** Required host services: tool registry and system-prompt assembly. */
export const inject = ['tools', 'systemPrompt']

// Backward-compatible re-exports (kept for callers importing the shared
// engine's classes through this package).
export { VoiceController, VoiceSchedule, TICK_MS }

/** Built-in voice quick-picks, offered in the persona config modal
 * alongside the free-text "describe your own voice" option. */
export const COMPANION_STYLES = DEFAULT_STYLES
export const DEFAULT_COMPANION_STYLE = DEFAULT_STYLE

export async function apply(ctx) {
  const controller = await applyVoice(ctx, {
    presetName: 'companion',
    ttsPath: '/dsh-companion/tts',
    ttsBase: process.env.DSH_VOICE_TTS_URL || 'http://127.0.0.1:3091',
    styles: COMPANION_STYLES,
    defaultStyle: DEFAULT_COMPANION_STYLE,
    // dsh-voice-core's own scheduler is global (one set of times shared by
    // every session on the preset); "cron job for the persona" needs each
    // session's own times, so it stays disabled and dsh-companion runs its
    // own per-session scheduler below instead.
    schedulerEnabled: false,
  })

  const stateDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'state', 'dsh-companion')
  const webServer = ctx.get('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    registerPersonaRoutes(webServer, stateDir, '/dsh-companion/persona', ctx.logger)
  }
  registerPersonaPrompt(ctx, stateDir)

  const scheduler = createPersonaScheduler(ctx, controller, stateDir)
  scheduler.start()
  ctx.on('dispose', () => scheduler.stop())
  // Cordis treats a plugin's `apply` return value as an "effect" (dispose
  // function, promise, or iterable of those) — returning the arbitrary
  // VoiceController object here throws `TypeError: Invalid effect` when the
  // real fiber runner applies this plugin. No return value needed; nothing
  // consumes it.
}
