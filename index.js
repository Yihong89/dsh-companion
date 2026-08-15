/**
 * dsh-sister host plugin — thin shell over the shared dsh-voice-core engine.
 *
 * All voice machinery (Qwen3-TTS proxy, speak/cheer tools, voiceSpeak
 * projection, daily greeting scheduler, commands) lives in dsh-voice-core;
 * this plugin only configures it for the sister persona and keeps the
 * backward-compatible exports used by tests / existing presets.
 *
 * @module dsh-sister
 */
import { applyVoice, normalizeConfig, VoiceController, VoiceSchedule, TICK_MS } from 'dsh-voice-core'
import { DEFAULT_STYLES } from 'dsh-voice-core'

export const name = 'dsh-sister'

/** Required host services: tool registry and system-prompt assembly. */
export const inject = ['tools', 'systemPrompt']

// Backward-compatible aliases (older tests/consumers used the sister names).
export { VoiceController, VoiceSchedule, TICK_MS }
export const SisterController = VoiceController
export const CheerSchedule = VoiceSchedule
export const DEFAULT_CHEER_TIMES = ['15:00']

/** Sister's voice catalog: 派蒙风 default, plus the soft/cute alternatives. */
export const SISTER_STYLES = {
  paimon: DEFAULT_STYLES.paimon,
  cute: DEFAULT_STYLES.cute,
  genki: DEFAULT_STYLES.genki,
  onee: DEFAULT_STYLES.onee,
}

export const DEFAULT_STYLE = 'paimon'

export async function apply(ctx) {
  const controller = await applyVoice(ctx, {
    presetName: 'sister',
    ttsPath: '/dsh-sister/tts',
    ttsBase: process.env.DSH_SISTER_TTS_URL || process.env.DSH_VOICE_TTS_URL || 'http://127.0.0.1:3091',
    styles: SISTER_STYLES,
    defaultStyle: DEFAULT_STYLE,
    cheerTimes: DEFAULT_CHEER_TIMES,
    schedulerEnabled: true,
    scheduleName: 'dsh-sister',
    greetingPrompt:
      '（定时问候）现在是下午 3 点，哥哥应该快回家了。请先用 cheer 工具送上一句温暖的欢迎回家问候，并顺带分享一个有趣的小知识或今天的小新闻（可以用网络搜索），一两句话就好，说完请哥哥先休息放松。',
  })
  ctx.logger?.info?.(`dsh-sister: activated via dsh-voice-core — daily greetings at ${controller.schedule.times.join(', ')}, fixed text: ${controller.schedule.text ? `"${controller.schedule.text}"` : 'auto'}`)
  // Cordis treats a plugin's `apply` return value as an "effect" (dispose
  // function, promise, or iterable of those) — returning the arbitrary
  // VoiceController object here throws `TypeError: Invalid effect` when the
  // real fiber runner applies this plugin (host-smoke tests use a mock ctx
  // that never noticed). No return value needed; nothing consumes it.
}
