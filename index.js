/**
 * dsh-sister host plugin.
 *
 * A warm, cheerful companion ("little sister") for the learner. The sister's
 * voice is played by the BROWSER on the user's own machine (Web Speech API) —
 * this host only records speak/cheer requests as log-only session events:
 *
 * - `sister/speak`  — TTS toggle (folded, so resume/fork recover it)
 * - `sister/spoken` — a speak request (speak tool / /speak <text>)
 * - `sister/cheer`  — a cheer fired (scheduled daily, /cheer, or the cheer tool)
 *
 * The host also runs the DAILY CHEER SCHEDULER: at configured times (default
 * 08:00 and 16:30, overridable with /cheer-at) it appends a cheer event to
 * every live sister session, and the client speaks it aloud + shows it in a
 * little chip. The schedule is persisted to $DSH_HOME/state/dsh-sister/
 * schedule.json so restarts don't double-fire.
 *
 * Model-facing tools (speak, cheer) are always registered by the plugin; the
 * plugin itself only activates where a preset composes a `name: dsh-sister`
 * row, so only sister agents see them.
 *
 * @module dsh-sister
 */
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'

import { SPEAK_EVENT, SPOKEN_EVENT, CHEER_EVENT, foldSisterState } from './lib/fold.js'
import { sisterSpeakProjectionWith } from './lib/sister-projection.js'
import { DEFAULT_CHEERS, pickCheer, parseTimes, dateKey, dueTimes } from './lib/cheers.js'

for (const type of [SPEAK_EVENT, SPOKEN_EVENT, CHEER_EVENT]) {
  KNOWN_SESSION_EVENT_TYPES.add(type)
}

export const name = 'dsh-sister'

/** Required host services: tool registry and system-prompt assembly. */
export const inject = ['tools', 'systemPrompt']

const DEFAULT_CHEER_TIMES = ['08:00', '16:30']
const TICK_MS = 30_000

function stateDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'state', 'dsh-sister')
}

function scheduleFilePath() {
  return join(stateDir(), 'schedule.json')
}

/** Persisted daily-cheer schedule: { times: string[], fired: Record<date, string[]> }. */
class CheerSchedule {
  constructor(path) {
    this.path = path
    this.times = [...DEFAULT_CHEER_TIMES]
    this.fired = {}
    this.load()
  }

  load() {
    try {
      if (existsSync(this.path)) {
        const data = JSON.parse(readFileSync(this.path, 'utf8'))
        if (Array.isArray(data.times) && data.times.length > 0) this.times = data.times
        if (data.fired && typeof data.fired === 'object') this.fired = data.fired
      }
    } catch (error) {
      // corrupt schedule file → fall back to defaults
    }
  }

  save() {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify({ times: this.times, fired: this.fired }, null, 2))
    } catch (error) {
      // best-effort persistence
    }
  }

  setTimes(times) {
    this.times = times
    this.save()
  }

  markFired(day, time) {
    ;(this.fired[day] ??= []).push(time)
    this.save()
  }

  firedToday(day, time) {
    return Array.isArray(this.fired[day]) && this.fired[day].includes(time)
  }
}

/**
 * Session-scoped controller: TTS fold state per session + the shared cheer
 * schedule. Keyed by the stable session id (a string), not the Session object.
 */
class SisterController {
  constructor(ctx, schedule) {
    this.ctx = ctx
    this.schedule = schedule
    this.sessions = new Map() // sessionId -> { agent }
    this.timer = null
  }

  /** Stable per-session state key: the session id (a string). */
  sessionKey(agent) {
    return agent.session.id
  }

  track(agent) {
    if (agent !== undefined && agent !== null && agent.session !== undefined) {
      this.sessions.set(this.sessionKey(agent), { agent })
    }
  }

  speakEnabledOf(agent) {
    return foldSisterState(agent.session.events).speakEnabled
  }

  /** Toggle TTS auto-speak (log-only `sister/speak` event). */
  setSpeak(agent, enabled) {
    try {
      agent.session.append(SPEAK_EVENT, { enabled })
      return 'committed'
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-sister: failed to append sister/speak: ${error}`)
      return 'queued'
    }
  }

  /** Record a speak request (browser plays it; never blocks the agent). */
  appendSpoken(agent, text, voice = null) {
    try {
      agent.session.append(SPOKEN_EVENT, { text: String(text ?? ''), voice })
      return true
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-sister: failed to append sister/spoken: ${error}`)
      return false
    }
  }

  /** Record a cheer (client speaks it AND shows the chip). */
  appendCheer(agent, text) {
    try {
      agent.session.append(CHEER_EVENT, { text: String(text ?? ''), at: Date.now() })
      // Also record the spoken event so the client reads it aloud even when
      // the cheer arrives without an assistant turn.
      agent.session.append(SPOKEN_EVENT, { text: String(text ?? ''), voice: null })
      return true
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-sister: failed to append sister/cheer: ${error}`)
      return false
    }
  }

  /** Fire today's due cheer into every live sister session, once per time. */
  tick() {
    const now = new Date()
    const day = dateKey(now)
    const due = dueTimes(this.schedule.times, now, new Set(this.schedule.fired[day] ?? []))
    if (due.length === 0) return 0
    let fired = 0
    for (const time of due) {
      const cheer = pickCheer(DEFAULT_CHEERS, now)
      for (const { agent } of this.sessions.values()) {
        if (this.appendCheer(agent, cheer)) fired++
      }
      this.schedule.markFired(day, time)
    }
    return fired
  }

  start() {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      try {
        this.tick()
      } catch (error) {
        this.ctx.logger?.warn?.(`dsh-sister: cheer tick failed: ${error}`)
      }
    }, TICK_MS)
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

export async function apply(ctx) {
  const schedule = new CheerSchedule(scheduleFilePath())
  const controller = new SisterController(ctx, schedule)

  // Track live sessions so the scheduler can cheer into them.
  ctx.on('agent/session-start', ({ agent }) => {
    controller.track(agent)
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    controller.track(agent)
    return next()
  })

  // Session projection: fold sister/speak + sister/spoken + sister/cheer so
  // the Web client drives browser TTS and the cheer chip via
  // useProjection('sisterSpeak').
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(
      sisterSpeakProjectionWith(
        z.object({
          speakEnabled: z.boolean(),
          lastSpoken: z.any(),
          lastCheer: z.any(),
        }),
      ),
    )
  })

  // Daily cheer scheduler: fire once per configured time per day.
  controller.start()
  ctx.on('dispose', () => controller.stop())

  // ---- TTS proxy -----------------------------------------------------------
  // The sister's voice is generated by the local Qwen3-TTS service
  // (127.0.0.1:3091, a Python FastAPI process started by launchd). The browser
  // cannot reach that loopback port, so we proxy /dsh-sister/tts through the
  // web server. Query params: text (required), instruct (voice-design style).
  const TTS_BASE = process.env.DSH_SISTER_TTS_URL || 'http://127.0.0.1:3091'
  const webServer = ctx.get('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    webServer.register({
      kind: 'exact',
      path: '/dsh-sister/tts',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x')
        const text = url.searchParams.get('text') ?? ''
        const instruct = url.searchParams.get('instruct') ?? ''
        if (!text) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'text is required' }))
          return
        }
        try {
          const target = new URL('/tts', TTS_BASE)
          target.searchParams.set('text', text)
          if (instruct) target.searchParams.set('instruct', instruct)
          const upstream = await fetch(target.toString())
          if (!upstream.ok) {
            res.writeHead(502, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: `tts upstream ${upstream.status}` }))
            return
          }
          const buf = Buffer.from(await upstream.arrayBuffer())
          res.writeHead(200, {
            'content-type': 'audio/wav',
            'cache-control': 'no-store',
            'content-length': String(buf.length),
            'x-tts-ms': upstream.headers.get('x-tts-ms') ?? '',
          })
          res.end(buf)
        } catch (error) {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `tts service unreachable: ${String(error)}` }))
        }
      },
    })
    webServer.register({
      kind: 'exact',
      path: '/dsh-sister/tts-health',
      handler: async (_req, res) => {
        try {
          const upstream = await fetch(new URL('/health', TTS_BASE).toString())
          const body = await upstream.text()
          res.writeHead(upstream.status, { 'content-type': 'application/json' })
          res.end(body)
        } catch {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'tts service unreachable' }))
        }
      },
    })
  }

  // ---- commands -----------------------------------------------------------
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'speak',
      description: 'Toggle TTS auto-speak, or speak text aloud right now',
      input: { hint: '[on|off|<text>]' },
      handler: async ({ agent, rawInput }) => {
        const action = rawInput.trim()
        if (action === 'on' || action === 'off') {
          const enabled = action === 'on'
          controller.setSpeak(agent, enabled)
          return { kind: 'success', text: `TTS ${enabled ? 'on' : 'off'}.` }
        }
        if (action === '') {
          return {
            kind: 'success',
            text: controller.speakEnabledOf(agent)
              ? 'TTS auto-speak is on. /speak off to mute.'
              : 'TTS auto-speak is off. /speak on to enable.',
          }
        }
        if (controller.appendSpoken(agent, action)) {
          return { kind: 'success', text: 'Speaking…' }
        }
        return { kind: 'error', text: 'speak failed' }
      },
    })

    commandCtx.commands.register({
      name: 'cheer',
      description: 'Fire a warm cheer right now (spoken + shown as a chip)',
      input: { hint: '[<custom text>]' },
      handler: async ({ agent, rawInput }) => {
        const text = rawInput.trim() || pickCheer(DEFAULT_CHEERS)
        if (controller.appendCheer(agent, text)) {
          return { kind: 'success', text: 'Cheer sent! 💛' }
        }
        return { kind: 'error', text: 'cheer failed' }
      },
    })

    commandCtx.commands.register({
      name: 'cheer-at',
      description: 'Set the daily cheer times (HH:MM, 24h). e.g. /cheer-at 08:00 16:30',
      input: { hint: '<HH:MM> [<HH:MM> …]' },
      handler: async ({ rawInput }) => {
        try {
          const times = parseTimes(rawInput.trim().split(/\s+/), null)
          controller.schedule.setTimes(times)
          return {
            kind: 'success',
            text: `Daily cheers set at ${times.join(', ')} — the sister will pipe up at those times (browser tab open required for sound).`,
          }
        } catch (error) {
          return { kind: 'error', text: error.message }
        }
      },
    })

    commandCtx.commands.register({
      name: 'sister',
      description: 'Show the sister status: TTS on/off and daily cheer times',
      input: { hint: '' },
      handler: async ({ agent }) => {
        const enabled = controller.speakEnabledOf(agent)
        return {
          kind: 'success',
          text: `Sister status: TTS ${enabled ? 'on' : 'off'} · daily cheers at ${controller.schedule.times.join(', ')} · /speak on|off toggles voice · /cheer-at sets times.`,
        }
      },
    })
  })

  // ---- model-facing tools -------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'speak',
    description:
      'Ask that text be spoken aloud to the learner. The speech is played by the browser on the user\'s own machine — this tool only records the request. Use it for short, warm, encouraging lines (1–2 sentences). Respect /speak off (TTS muted).',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to speak aloud.' },
      voice: { type: 'string', description: 'Preferred voice language hint (e.g. "en-US", "zh-CN"); the browser picks a matching voice.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
        },
      },
      render: (_args, result) => [
        { type: 'text', text: result.ok ? 'Speech requested.' : 'speak failed' },
      ],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('speak requires a calling agent')
      if (!controller.appendSpoken(agent, String(args.text ?? ''), args.voice ?? null)) {
        throw new Error('speak failed')
      }
      return { ok: true }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Speak', kind: 'other' }),
    presentResult: (_args, result) => {
      if (result.isError) return void 0
      return { card: 'generic', title: 'Speech requested', content: 'The browser will read it aloud on the user\'s machine.' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cheer',
    description:
      'Send the learner a warm, positive cheer. The browser speaks it aloud and shows a little chip. Use it generously — whenever the learner achieves something, feels down, or just needs a boost. Keep it to 1–2 short, cheerful English sentences.',
    parameters: {
      text: { type: 'string', description: 'Optional custom cheer text; a bank cheer is picked when omitted.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
        },
      },
      render: (_args, result) => [
        { type: 'text', text: result.ok ? 'Cheer sent.' : 'cheer failed' },
      ],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('cheer requires a calling agent')
      const text = String(args.text ?? '').trim() || pickCheer(DEFAULT_CHEERS)
      if (!controller.appendCheer(agent, text)) {
        throw new Error('cheer failed')
      }
      return { ok: true }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Cheer', kind: 'other' }),
    presentResult: (_args, result) => {
      if (result.isError) return void 0
      return { card: 'generic', title: 'Cheer sent', content: 'The browser will read it aloud and show the chip.' }
    },
  }))
}

// Test-only exports (ignored by the plugin loader, which reads only
// name/inject/apply).
export { SisterController, CheerSchedule, DEFAULT_CHEER_TIMES, TICK_MS }
