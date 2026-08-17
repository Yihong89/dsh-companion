/**
 * dsh-companion persona HTTP routes — GET/PATCH the current session's
 * persona, backing the client's config modal.
 *
 * @module dsh-companion/lib/persona-routes
 */
import { parseTimes } from 'dsh-voice-core/lib/voice.js'
import { DEFAULT_STYLES } from 'dsh-voice-core'
import { readPersona, writePersona } from './persona-store.js'

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function registerPersonaRoutes(webServer, stateDir, path, logger) {
  webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (!sessionId) {
        sendJson(res, 400, { ok: false, error: 'sessionId is required' })
        return
      }
      if (req.method === 'GET') {
        sendJson(res, 200, readPersona(stateDir, sessionId))
        return
      }
      if (req.method === 'PATCH' || req.method === 'POST') {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
          return
        }
        let times
        try {
          times = Array.isArray(body.schedule?.times) && body.schedule.times.length > 0
            ? parseTimes(body.schedule.times)
            : []
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message })
          return
        }
        const presetKey = typeof body.voice?.presetKey === 'string' && DEFAULT_STYLES[body.voice.presetKey]
          ? body.voice.presetKey
          : undefined
        const instruct = presetKey
          ? DEFAULT_STYLES[presetKey].instruct
          : String(body.voice?.instruct ?? '').trim()
        if (!instruct) {
          sendJson(res, 400, { ok: false, error: 'voice.instruct or a known voice.presetKey is required' })
          return
        }
        const saved = writePersona(stateDir, sessionId, {
          name: body.name,
          personality: body.personality,
          voice: { presetKey, instruct },
          schedule: { times },
        })
        logger?.info?.(`dsh-companion: persona saved for session ${sessionId}: "${saved.name}"`)
        sendJson(res, 200, saved)
        return
      }
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  })
}
