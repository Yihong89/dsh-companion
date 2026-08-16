/**
 * Host-plugin smoke test: mounts index.js against mocked DSH services and
 * asserts commands/tools/projection register, then exercises the cheer
 * scheduler (due-time firing, once-per-day dedupe, persistence).
 *
 * index.js imports '@deepseek-ai/dsh-tools' (defineTool), which is normally
 * resolved from the DSH install. For this standalone test we materialize a
 * gitignored stub at node_modules/@deepseek-ai/dsh-tools so the bare import
 * resolves; defineTool is identity in the stub.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function installToolStub() {
  const dir = join(REPO_ROOT, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh-tools', type: 'module', main: 'index.js' }),
  )
  writeFileSync(join(dir, 'index.js'), 'export function defineTool(def) { return def }\n')
  const zodDir = join(REPO_ROOT, 'node_modules', 'zod')
  mkdirSync(zodDir, { recursive: true })
  writeFileSync(
    join(zodDir, 'package.json'),
    JSON.stringify({ name: 'zod', type: 'module', main: 'index.js' }),
  )
  writeFileSync(
    join(zodDir, 'index.js'),
    'export const z = { object: (s) => ({ _shape: s }), array: (x) => x, any: () => "any", boolean: () => "boolean", string: () => "string" }\n',
  )
  const sessionDir = join(REPO_ROOT, 'node_modules', '@deepseek-ai', 'dsh-session')
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(
    join(sessionDir, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh-session', type: 'module', main: 'index.js' }),
  )
  writeFileSync(
    join(sessionDir, 'index.js'),
    'export const KNOWN_SESSION_EVENT_TYPES = new Set()\n',
  )
  return dir
}

function mockSession(id = 's1') {
  const session = {
    id,
    events: [],
    append(type, data) {
      this.events.push({ type, data })
    },
  }
  return session
}

function mockCtx(opts = {}) {
  const registrations = { commands: [], tools: [], events: {}, projections: [], webRoutes: [] }
  const webServer = opts.webServer === true
    ? {
        register: (route) => {
          registrations.webRoutes.push(route)
          return () => {}
        },
      }
    : undefined
  const ctx = {
    get: (key) => (key === 'webServer' ? webServer : undefined),
    on(name, fn) {
      ;(registrations.events[name] ??= []).push(fn)
    },
    inject(_deps, fn) {
      fn(ctx)
    },
    systemPrompt: { section: () => {} },
    tools: { register: (t) => registrations.tools.push(t) },
    commands: { register: (c) => registrations.commands.push(c) },
    sessionProjections: { register: (def) => registrations.projections.push(def) },
    logger: { warn: () => {} },
    emit: () => {},
    events: registrations.events,
  }
  return { ctx, registrations }
}

/** Fire the registered 'dispose' hooks so the cheer timer stops (otherwise
 * the host's setInterval keeps the test process alive). */
function dispose(ctx) {
  for (const fn of ctx.events['dispose'] ?? []) fn()
}

let stubDir = null
let smokeHomeDir = null

before(() => {
  stubDir = installToolStub()
  smokeHomeDir = mkdtempSync(join(tmpdir(), 'dsh-sister-home-'))
  process.env.DSH_HOME = smokeHomeDir
})

after(() => {
  rmSync(stubDir, { recursive: true, force: true })
  rmSync(smokeHomeDir, { recursive: true, force: true })
})

test('apply resolves to undefined (cordis treats a plugin\'s return value as an effect; anything else throws "Invalid effect" in the real fiber runner)', async () => {
  const { apply } = await import('../index.js')
  const { ctx } = mockCtx()
  const result = await apply(ctx)
  dispose(ctx)
  assert.equal(result, undefined)
})

test('host plugin registers commands, tools, and the sisterSpeak projection', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx()
  await apply(ctx)
  dispose(ctx)
  assert.deepEqual(registrations.commands.map((c) => c.name).sort(), ['cheer', 'cheer-at', 'cheer-text', 'speak', 'voice'])
  assert.deepEqual(registrations.tools.map((t) => t.name).sort(), ['cheer', 'speak'])
  assert.equal(registrations.projections.length, 1)
  assert.equal(registrations.projections[0].key, 'voiceSpeak')
  assert.ok(registrations.events['agent/session-start'])
  assert.ok(registrations.events['agent/pre-step'])
  assert.ok(registrations.events['dispose'])
})

test('session event types are registered into the catalog', async () => {
  const { KNOWN_SESSION_EVENT_TYPES } = await import('@deepseek-ai/dsh-session')
  assert.ok(KNOWN_SESSION_EVENT_TYPES.has('voice/speak'))
  assert.ok(KNOWN_SESSION_EVENT_TYPES.has('voice/spoken'))
  assert.ok(KNOWN_SESSION_EVENT_TYPES.has('voice/cheer'))
})

test('speak command toggles TTS and speaks arbitrary text', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx()
  await apply(ctx)
  dispose(ctx)
  const speak = registrations.commands.find((c) => c.name === 'speak')
  const agent = { session: mockSession() }
  // no argument → status
  const status = await speak.handler({ agent, rawInput: '' })
  assert.match(status.text, /TTS auto-speak is on/)
  // toggle off
  const off = await speak.handler({ agent, rawInput: 'off' })
  assert.match(off.text, /off/)
  // arbitrary text → spoken event
  const spoken = await speak.handler({ agent, rawInput: 'You are amazing!' })
  assert.match(spoken.text, /Speaking/)
  const spokenEvt = agent.session.events.find((e) => e.type === 'voice/spoken')
  assert.equal(spokenEvt.data.text, 'You are amazing!')
})

test('cheer command fires a cheer event with a bank default', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx()
  await apply(ctx)
  dispose(ctx)
  const cheer = registrations.commands.find((c) => c.name === 'cheer')
  const agent = { session: mockSession() }
  const res = await cheer.handler({ agent, rawInput: '' })
  assert.match(res.text, /Cheer sent/)
  assert.ok(agent.session.events.some((e) => e.type === 'voice/cheer'))
  assert.ok(agent.session.events.some((e) => e.type === 'voice/spoken'))
})

test('cheer-at validates and persists times', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx()
  await apply(ctx)
  dispose(ctx)
  const cheerAt = registrations.commands.find((c) => c.name === 'cheer-at')
  const agent = { session: mockSession() }
  const bad = await cheerAt.handler({ agent, rawInput: '25:00' })
  assert.equal(bad.kind, 'error')
  const good = await cheerAt.handler({ agent, rawInput: '08:00 17:30' })
  assert.equal(good.kind, 'success')
  assert.match(good.text, /08:00, 17:30/)
  // Persisted across a fresh controller (new apply with same DSH_HOME).
  const { ctx: ctx2, registrations: reg2 } = mockCtx()
  await (await import('../index.js')).apply(ctx2)
  dispose(ctx2)
  const voice = reg2.commands.find((c) => c.name === 'voice')
  const status = await voice.handler({ agent, rawInput: '' })
  assert.match(status.text, /08:00, 17:30/)
})

test('scheduler fires one cheer per due time per day, only into tracked sessions', async () => {
  const { VoiceController, VoiceSchedule } = await import('../index.js')
  const schedulePath = join(smokeHomeDir, 'state', 'dsh-sister', 'schedule.json')
  const schedule = new VoiceSchedule(schedulePath)
  const controller = new VoiceController({ logger: { warn: () => {} } }, schedule, { greetingPrompt: '欢迎回家+趣闻' })
  // Track a session (no followup → greet falls back to a direct cheer).
  const agent = { session: mockSession('s1') }
  controller.track(agent)
  // Set the schedule to the current minute.
  const now = new Date()
  const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  schedule.setTimes([cur])
  assert.equal(await controller.tick(), 1, 'one cheer fired into the one tracked session')
  const cheerEvt = agent.session.events.find((e) => e.type === 'voice/cheer')
  const spokenEvt = agent.session.events.find((e) => e.type === 'voice/spoken')
  assert.ok(cheerEvt && cheerEvt.data.text.length > 0)
  assert.ok(spokenEvt && spokenEvt.data.text === cheerEvt.data.text)
  // Same minute again → deduped (fired recorded).
  assert.equal(await controller.tick(), 0, 'no re-fire within the same day/minute')
  // A tracked session that is not due still gets nothing.
  // The schedule still says cur; simulate a *new* day via a fresh controller
  // whose schedule file marks cur as already fired → nothing.
  const controller2 = new VoiceController({ logger: { warn: () => {} } }, new VoiceSchedule(schedulePath), { greetingPrompt: 'x' })
  const agent2 = { session: mockSession('s2') }
  controller2.track(agent2)
  assert.equal(await controller2.tick(), 0)
})

test('greet nudges the sister via followup (model composes the welcome)', async () => {
  const { VoiceController, VoiceSchedule } = await import('../index.js')
  const schedulePath = join(smokeHomeDir, 'state', 'dsh-sister', 'greet.json')
  const schedule = new VoiceSchedule(schedulePath)
  const controller = new VoiceController({ logger: { warn: () => {} } }, schedule, { greetingPrompt: '（定时问候）欢迎回家+趣闻' })
  const followups = []
  const agent = {
    session: mockSession('s1'),
    followup: (msg) => { followups.push(msg) },
  }
  controller.track(agent)
  assert.equal(await controller.greet(agent), true)
  assert.equal(followups.length, 1)
  assert.equal(followups[0].role, 'user')
  assert.equal(followups[0].content[0].type, 'text')
  assert.match(followups[0].content[0].text, /欢迎回家/)
  // No cheer event appended on the followup path (the model will reply).
  assert.equal(agent.session.events.some((e) => e.type === 'voice/cheer'), false)
})

test('fixed cheer text is spoken verbatim instead of the model nudge', async () => {
  const { VoiceController, VoiceSchedule } = await import('../index.js')
  const schedulePath = join(smokeHomeDir, 'state', 'dsh-sister', 'fixed.json')
  const schedule = new VoiceSchedule(schedulePath)
  schedule.setText('哥哥，欢迎回家')
  const controller = new VoiceController({ logger: { warn: () => {} } }, schedule)
  const followups = []
  const agent = {
    session: mockSession('s1'),
    followup: (msg) => { followups.push(msg) },
  }
  controller.track(agent)
  assert.equal(await controller.greet(agent), true)
  assert.equal(followups.length, 0, 'fixed text does not use the model')
  const cheerEvt = agent.session.events.find((e) => e.type === 'voice/cheer')
  assert.ok(cheerEvt && cheerEvt.data.text === '哥哥，欢迎回家')
})

test('schedule round-trips to disk (times + fired set survive)', async () => {
  const { VoiceSchedule } = await import('../index.js')
  const schedulePath = join(smokeHomeDir, 'state', 'dsh-sister', 'roundtrip.json')
  const a = new VoiceSchedule(schedulePath)
  a.setTimes(['07:15', '19:45'])
  a.markFired('2026-08-15', '07:15')
  const b = new VoiceSchedule(schedulePath)
  assert.deepEqual(b.times, ['07:15', '19:45'])
  assert.equal(b.firedToday('2026-08-15', '07:15'), true)
  assert.equal(b.firedToday('2026-08-15', '19:45'), false)
})

test('registers the TTS proxy routes when a web server is present', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx({ webServer: true })
  await apply(ctx)
  dispose(ctx)
  const paths = registrations.webRoutes.map((r) => r.path)
  assert.ok(paths.includes('/dsh-sister/tts'))
  assert.ok(paths.includes('/dsh-sister/tts-health'))
  const tts = registrations.webRoutes.find((r) => r.path === '/dsh-sister/tts')
  assert.equal(tts.kind, 'exact')
  assert.equal(typeof tts.handler, 'function')
})

test('serves the background image at /dsh-sister/background.jpg', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx({ webServer: true })
  await apply(ctx)
  dispose(ctx)
  const route = registrations.webRoutes.find((r) => r.path === '/dsh-sister/background.jpg')
  assert.ok(route, 'the background route is registered')
  assert.equal(route.kind, 'exact')

  let status = 0
  let headers = {}
  let body = null
  const res = {
    writeHead: (s, h) => { status = s; headers = h },
    end: (b) => { body = b },
  }
  await route.handler({}, res)
  assert.equal(status, 200)
  assert.equal(headers['content-type'], 'image/jpeg')
  assert.ok(Buffer.isBuffer(body) && body.length > 0, 'serves the actual image bytes')
})

test('serves a cheer-audio manifest mapping every DEFAULT_CHEERS entry to a static clip URL', async () => {
  const { apply } = await import('../index.js')
  const { DEFAULT_CHEERS } = await import('dsh-voice-core')
  const { ctx, registrations } = mockCtx({ webServer: true })
  await apply(ctx)
  dispose(ctx)
  const route = registrations.webRoutes.find((r) => r.path === '/dsh-sister/cheer-audio/manifest.json')
  assert.ok(route, 'the cheer-audio manifest route is registered')
  assert.equal(route.kind, 'exact')

  let status = 0
  let headers = {}
  let body = null
  const res = {
    writeHead: (s, h) => { status = s; headers = h },
    end: (b) => { body = b },
  }
  route.handler({}, res)
  assert.equal(status, 200)
  assert.equal(headers['content-type'], 'application/json')
  const manifest = JSON.parse(body)
  assert.equal(Object.keys(manifest).length, DEFAULT_CHEERS.length, 'one entry per bank phrase')
  for (const text of DEFAULT_CHEERS) {
    assert.ok(manifest[text]?.startsWith('/dsh-sister/cheer-audio/'), `manifest maps "${text.slice(0, 10)}..." to a static clip URL`)
  }
})

test('serves the pre-baked audio clip for a cheer-bank entry', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx({ webServer: true })
  await apply(ctx)
  dispose(ctx)
  const route = registrations.webRoutes.find((r) => r.path === '/dsh-sister/cheer-audio/00.m4a')
  assert.ok(route, 'the first cheer-audio clip route is registered')
  assert.equal(route.kind, 'exact')

  let status = 0
  let headers = {}
  let body = null
  const res = {
    writeHead: (s, h) => { status = s; headers = h },
    end: (b) => { body = b },
  }
  await route.handler({}, res)
  assert.equal(status, 200)
  assert.equal(headers['content-type'], 'audio/mp4')
  assert.ok(Buffer.isBuffer(body) && body.length > 0, 'serves the actual audio bytes')
})

test('TTS proxy rejects a request without text', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx({ webServer: true })
  await apply(ctx)
  dispose(ctx)
  const tts = registrations.webRoutes.find((r) => r.path === '/dsh-sister/tts')
  let status = 0
  let body = ''
  const res = {
    writeHead: (s) => { status = s },
    end: (b) => { body = b },
  }
  await tts.handler({ url: '/dsh-sister/tts?instruct=x' }, res)
  assert.equal(status, 400)
  assert.match(body, /text is required/)
})
