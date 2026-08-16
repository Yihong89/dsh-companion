/**
 * dsh-sister host plugin — thin shell over the shared dsh-voice-core engine.
 *
 * All voice machinery (Qwen3-TTS proxy, speak/cheer tools, voiceSpeak
 * projection, daily greeting scheduler, commands) lives in dsh-voice-core;
 * this plugin only configures it for the sister persona and keeps the
 * backward-compatible exports used by tests / existing presets. It also
 * serves its own backdrop image and pre-baked cheer-bank audio
 * (dsh-voice-core's BackgroundLayer/cheer-audio matching just render/play
 * whatever URL they're given — sourcing/serving those assets is a
 * per-consumer concern, since only sister wants them right now).
 *
 * @module dsh-sister
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { applyVoice, normalizeConfig, VoiceController, VoiceSchedule, TICK_MS } from 'dsh-voice-core'
import { DEFAULT_STYLES, DEFAULT_CHEERS } from 'dsh-voice-core'

const BACKGROUND_PATH = '/dsh-sister/background.jpg'
const BACKGROUND_FILE = fileURLToPath(new URL('./assets/background.jpg', import.meta.url))

// Pre-baked audio for the fixed DEFAULT_CHEERS bank (see
// scripts/generate-cheer-audio.mjs) — one clip per bank entry, in the
// SAME order, spoken in the default (paimon) voice. Served as static
// files so a fired cheer never has to touch the live TTS backend; see
// dsh-voice-core's opts.cheerAudioManifestUrl.
const CHEER_AUDIO_DIR = fileURLToPath(new URL('./assets/cheer-audio/', import.meta.url))
const CHEER_AUDIO_PREFIX = '/dsh-sister/cheer-audio/'
const CHEER_AUDIO_MANIFEST_PATH = CHEER_AUDIO_PREFIX + 'manifest.json'
const CHEER_AUDIO_FILES = DEFAULT_CHEERS.map((text, i) => ({
  text,
  file: `${String(i).padStart(2, '0')}.m4a`,
}))

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

  const webServer = ctx.get('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    webServer.register({
      kind: 'exact',
      path: BACKGROUND_PATH,
      handler: async (_req, res) => {
        try {
          const buf = await readFile(BACKGROUND_FILE)
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=604800, immutable' })
          res.end(buf)
        } catch (error) {
          ctx.logger?.warn?.(`dsh-sister: background image unreadable: ${error}`)
          res.writeHead(404, { 'content-type': 'text/plain' })
          res.end('not found')
        }
      },
    })

    webServer.register({
      kind: 'exact',
      path: CHEER_AUDIO_MANIFEST_PATH,
      handler: (_req, res) => {
        const manifest = Object.fromEntries(CHEER_AUDIO_FILES.map((e) => [e.text, CHEER_AUDIO_PREFIX + e.file]))
        const body = JSON.stringify(manifest)
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=604800' })
        res.end(body)
      },
    })
    for (const { file } of CHEER_AUDIO_FILES) {
      const filePath = fileURLToPath(new URL(`./assets/cheer-audio/${file}`, import.meta.url))
      webServer.register({
        kind: 'exact',
        path: CHEER_AUDIO_PREFIX + file,
        handler: async (_req, res) => {
          try {
            const buf = await readFile(filePath)
            res.writeHead(200, { 'content-type': 'audio/mp4', 'cache-control': 'public, max-age=604800, immutable' })
            res.end(buf)
          } catch (error) {
            ctx.logger?.warn?.(`dsh-sister: cheer audio ${file} unreadable: ${error}`)
            res.writeHead(404, { 'content-type': 'text/plain' })
            res.end('not found')
          }
        },
      })
    }
  }
  // Cordis treats a plugin's `apply` return value as an "effect" (dispose
  // function, promise, or iterable of those) — returning the arbitrary
  // VoiceController object here throws `TypeError: Invalid effect` when the
  // real fiber runner applies this plugin (host-smoke tests use a mock ctx
  // that never noticed). No return value needed; nothing consumes it.
}
