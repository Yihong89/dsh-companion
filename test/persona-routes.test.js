import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerPersonaRoutes } from '../lib/persona-routes.js'
import { readPersona } from '../lib/persona-store.js'

function mockWebServer() {
  const routes = []
  return { register: (r) => routes.push(r), routes }
}

function mockReq(method, url, bodyObj) {
  const bodyStr = bodyObj !== undefined ? JSON.stringify(bodyObj) : ''
  return {
    method,
    url,
    on(event, cb) {
      if (event === 'data' && bodyStr) cb(Buffer.from(bodyStr))
      if (event === 'end') cb()
    },
  }
}

function mockRes() {
  const res = { status: 0, headers: {}, body: null }
  res.writeHead = (s, h) => { res.status = s; res.headers = h }
  res.end = (b) => { res.body = b }
  return res
}

test('registers exactly one route at the given path', () => {
  const webServer = mockWebServer()
  registerPersonaRoutes(webServer, '/tmp/x', '/dsh-companion/persona', { warn: () => {}, info: () => {} })
  assert.equal(webServer.routes.length, 1)
  assert.equal(webServer.routes[0].path, '/dsh-companion/persona')
  assert.equal(webServer.routes[0].kind, 'exact')
})

test('GET without sessionId returns 400', async () => {
  const webServer = mockWebServer()
  registerPersonaRoutes(webServer, '/tmp/x', '/dsh-companion/persona', { warn: () => {}, info: () => {} })
  const res = mockRes()
  await webServer.routes[0].handler(mockReq('GET', '/dsh-companion/persona'), res)
  assert.equal(res.status, 400)
})

test('GET with sessionId returns the default persona when none saved yet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-routes-'))
  try {
    const webServer = mockWebServer()
    registerPersonaRoutes(webServer, dir, '/dsh-companion/persona', { warn: () => {}, info: () => {} })
    const res = mockRes()
    await webServer.routes[0].handler(mockReq('GET', '/dsh-companion/persona?sessionId=s1'), res)
    assert.equal(res.status, 200)
    const persona = JSON.parse(res.body)
    assert.equal(persona.name, '小助手')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PATCH with a known preset key resolves and stores the preset instruct', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-routes-'))
  try {
    const webServer = mockWebServer()
    registerPersonaRoutes(webServer, dir, '/dsh-companion/persona', { warn: () => {}, info: () => {} })
    const res = mockRes()
    await webServer.routes[0].handler(
      mockReq('PATCH', '/dsh-companion/persona?sessionId=s1', {
        name: '小雪', personality: '安静体贴', voice: { presetKey: 'onee' }, schedule: { times: ['08:00'] },
      }),
      res,
    )
    assert.equal(res.status, 200)
    const saved = JSON.parse(res.body)
    assert.equal(saved.name, '小雪')
    assert.equal(saved.voice.presetKey, 'onee')
    assert.match(saved.voice.instruct, /清冷/)
    assert.deepEqual(saved.schedule.times, ['08:00'])
    const persisted = readPersona(dir, 's1')
    assert.equal(persisted.name, '小雪')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PATCH with a custom voice instruct (no presetKey) stores it verbatim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-routes-'))
  try {
    const webServer = mockWebServer()
    registerPersonaRoutes(webServer, dir, '/dsh-companion/persona', { warn: () => {}, info: () => {} })
    const res = mockRes()
    await webServer.routes[0].handler(
      mockReq('PATCH', '/dsh-companion/persona?sessionId=s1', {
        name: 'Rex', personality: '沉稳的老管家', voice: { instruct: '低沉沙哑的男声，语速缓慢' }, schedule: { times: [] },
      }),
      res,
    )
    assert.equal(res.status, 200)
    const saved = JSON.parse(res.body)
    assert.equal(saved.voice.presetKey, undefined)
    assert.equal(saved.voice.instruct, '低沉沙哑的男声，语速缓慢')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PATCH with neither a preset key nor a custom instruct returns 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-routes-'))
  try {
    const webServer = mockWebServer()
    registerPersonaRoutes(webServer, dir, '/dsh-companion/persona', { warn: () => {}, info: () => {} })
    const res = mockRes()
    await webServer.routes[0].handler(
      mockReq('PATCH', '/dsh-companion/persona?sessionId=s1', { name: 'X', personality: 'y', voice: {}, schedule: { times: [] } }),
      res,
    )
    assert.equal(res.status, 400)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PATCH with an invalid time returns 400 and does not persist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-routes-'))
  try {
    const webServer = mockWebServer()
    registerPersonaRoutes(webServer, dir, '/dsh-companion/persona', { warn: () => {}, info: () => {} })
    const res = mockRes()
    await webServer.routes[0].handler(
      mockReq('PATCH', '/dsh-companion/persona?sessionId=s1', {
        name: 'X', personality: 'y', voice: { presetKey: 'paimon' }, schedule: { times: ['25:99'] },
      }),
      res,
    )
    assert.equal(res.status, 400)
    const persona = readPersona(dir, 's1')
    assert.equal(persona.name, '小助手', 'default persona untouched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unsupported method returns 405', async () => {
  const webServer = mockWebServer()
  registerPersonaRoutes(webServer, '/tmp/x', '/dsh-companion/persona', { warn: () => {}, info: () => {} })
  const res = mockRes()
  await webServer.routes[0].handler(mockReq('DELETE', '/dsh-companion/persona?sessionId=s1'), res)
  assert.equal(res.status, 405)
})
