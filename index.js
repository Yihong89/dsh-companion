/**
 * dsh-companion host plugin — thin shell over the shared dsh-voice-core
 * engine, configured generically. Persona identity, voice, and greeting
 * schedule are NOT fixed here (see lib/persona-store.js and friends,
 * landing in later tasks) -- they are per-session, user-configured data.
 *
 * @module dsh-companion
 */
import { applyVoice, VoiceController, VoiceSchedule, TICK_MS } from 'dsh-voice-core'
import { DEFAULT_STYLES, DEFAULT_STYLE } from 'dsh-voice-core'

export const name = 'dsh-companion'

/** Required host services: tool registry and system-prompt assembly. */
export const inject = ['tools', 'systemPrompt']

// Backward-compatible re-exports (kept for callers importing the shared
// engine's classes through this package, same pattern dsh-sister used).
export { VoiceController, VoiceSchedule, TICK_MS }
export const DEFAULT_CHEER_TIMES = ['15:00']

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
    cheerTimes: DEFAULT_CHEER_TIMES,
    schedulerEnabled: true,
    scheduleName: 'dsh-companion',
    greetingPrompt:
      '（定时问候）现在是下午 3 点。请先用 cheer 工具送上一句温暖的欢迎回家问候，并顺带分享一个有趣的小知识或今天的小新闻（可以用网络搜索），一两句话就好，说完请休息放松。',
  })
  ctx.logger?.info?.(`dsh-companion: activated via dsh-voice-core — daily greetings at ${controller.schedule.times.join(', ')}, fixed text: ${controller.schedule.text ? `"${controller.schedule.text}"` : 'auto'}`)
  // Cordis treats a plugin's `apply` return value as an "effect" (dispose
  // function, promise, or iterable of those) — returning the arbitrary
  // VoiceController object here throws `TypeError: Invalid effect` when the
  // real fiber runner applies this plugin. No return value needed; nothing
  // consumes it.
}
