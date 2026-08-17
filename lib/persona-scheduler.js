/**
 * dsh-companion per-session greeting scheduler. dsh-voice-core's own
 * scheduler is global (one set of times shared by every session on the
 * preset) -- this plugin disables that (schedulerEnabled: false) and runs
 * its own tick loop keyed by each tracked session's OWN persona file, so
 * "cron job for the persona" means each persona really does have its own
 * times. dsh-voice-core itself is untouched; dsh-teacher is unaffected.
 *
 * @module dsh-companion/lib/persona-scheduler
 */
import { dateKey, dueTimes, pickCheer } from 'dsh-voice-core/lib/voice.js'
import { DEFAULT_CHEERS } from 'dsh-voice-core'
import { readPersona, markFired } from './persona-store.js'

export const TICK_MS = 30_000

export function createPersonaScheduler(ctx, controller, stateDir) {
  let timer = null

  async function greet(agent, persona) {
    const prompt = `（定时问候）请以「${persona.name}」的身份，按这段人设说话：${persona.personality}\n先用 cheer 工具送上一句温暖的问候，一两句话就好。`
    if (agent !== undefined && typeof agent.followup === 'function') {
      try {
        agent.followup({
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'plugin', plugin: 'dsh-companion' },
        })
        return true
      } catch (error) {
        ctx.logger?.warn?.(`dsh-companion: greet followup failed: ${error}`)
      }
    }
    return controller.appendCheer(agent, pickCheer(DEFAULT_CHEERS))
  }

  async function tick() {
    const now = new Date()
    const day = dateKey(now)
    let fired = 0
    for (const [sessionId, { agent }] of controller.sessions) {
      const persona = readPersona(stateDir, sessionId)
      const times = persona.schedule.times
      if (times.length === 0) continue
      const already = new Set(persona.schedule.fired[day] ?? [])
      const due = dueTimes(times, now, already)
      for (const time of due) {
        if (await greet(agent, persona)) fired++
        markFired(stateDir, sessionId, day, time)
      }
    }
    return fired
  }

  function start() {
    if (timer !== null) return
    timer = setInterval(() => {
      tick().catch((error) => ctx.logger?.warn?.(`dsh-companion: scheduler tick failed: ${error}`))
    }, TICK_MS)
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return { tick, start, stop }
}
