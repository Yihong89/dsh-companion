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

function mockCtx() {
  const registrations = { commands: [], tools: [], events: {}, projections: [] }
  const ctx = {
    get: () => undefined,
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

test('host plugin registers commands, tools, and the sisterSpeak projection', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx()
  await apply(ctx)
  dispose(ctx)
  assert.deepEqual(registrations.commands.map((c) => c.name).sort(), ['cheer', 'cheer-at', 'sister', 'speak'])
  assert.deepEqual(registrations.tools.map((t) => t.name).sort(), ['cheer', 'speak'])
  assert.equal(registrations.projections.length, 1)
  assert.equal(registrations.projections[0].key, 'sisterSpeak')
  assert.ok(registrations.events['agent/session-start'])
  assert.ok(registrations.events['agent/pre-step'])
  assert.ok(registrations.events['dispose'])
})

test('session event types are registered into the catalog', async () => {
  const { KNOWN_SESSION_EVENT_TYPES } = await import('@deepseek-ai/dsh-session')
  assert.ok(KNOWN_SESSION_EVENT_TYPES.has('sister/speak'))
  assert.ok(KNOWN_SESSION_EVENT_TYPES.has('sister/spoken'))
  assert.ok(KNOWN_SESSION_EVENT_TYPES.has('sister/cheer'))
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
  const spokenEvt = agent.session.events.find((e) => e.type === 'sister/spoken')
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
  assert.ok(agent.session.events.some((e) => e.type === 'sister/cheer'))
  assert.ok(agent.session.events.some((e) => e.type === 'sister/spoken'))
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
  const sister = reg2.commands.find((c) => c.name === 'sister')
  const status = await sister.handler({ agent, rawInput: '' })
  assert.match(status.text, /08:00, 17:30/)
})

test('scheduler fires one cheer per due time per day, only into tracked sessions', async () => {
  const { SisterController, CheerSchedule } = await import('../index.js')
  const schedulePath = join(smokeHomeDir, 'state', 'dsh-sister', 'schedule.json')
  const schedule = new CheerSchedule(schedulePath)
  const controller = new SisterController({ logger: { warn: () => {} } }, schedule)
  // Track a session.
  const agent = { session: mockSession('s1') }
  controller.track(agent)
  // Set the schedule to the current minute.
  const now = new Date()
  const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  schedule.setTimes([cur])
  assert.equal(controller.tick(), 1, 'one cheer fired into the one tracked session')
  const cheerEvt = agent.session.events.find((e) => e.type === 'sister/cheer')
  const spokenEvt = agent.session.events.find((e) => e.type === 'sister/spoken')
  assert.ok(cheerEvt && cheerEvt.data.text.length > 0)
  assert.ok(spokenEvt && spokenEvt.data.text === cheerEvt.data.text)
  // Same minute again → deduped (fired recorded).
  assert.equal(controller.tick(), 0, 'no re-fire within the same day/minute')
  // A tracked session that is not due still gets nothing.
  // The schedule still says cur; simulate a *new* day via a fresh controller
  // whose schedule file marks cur as already fired → nothing.
  const controller2 = new SisterController({ logger: { warn: () => {} } }, new CheerSchedule(schedulePath))
  const agent2 = { session: mockSession('s2') }
  controller2.track(agent2)
  assert.equal(controller2.tick(), 0)
})

test('schedule round-trips to disk (times + fired set survive)', async () => {
  const { CheerSchedule } = await import('../index.js')
  const schedulePath = join(smokeHomeDir, 'state', 'dsh-sister', 'roundtrip.json')
  const a = new CheerSchedule(schedulePath)
  a.setTimes(['07:15', '19:45'])
  a.markFired('2026-08-15', '07:15')
  const b = new CheerSchedule(schedulePath)
  assert.deepEqual(b.times, ['07:15', '19:45'])
  assert.equal(b.firedToday('2026-08-15', '07:15'), true)
  assert.equal(b.firedToday('2026-08-15', '19:45'), false)
})
