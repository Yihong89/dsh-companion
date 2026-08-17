import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonaScheduler } from '../lib/persona-scheduler.js'
import { writePersona, readPersona } from '../lib/persona-store.js'

function curTime(now = new Date()) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function mockController(sessions) {
  const cheers = []
  return {
    sessions,
    appendCheer: (agent, text) => { cheers.push({ agent, text }); return true },
    cheers,
  }
}

test('tick fires into a tracked session whose persona has a due time, and marks it fired', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-sched-'))
  try {
    const cur = curTime()
    writePersona(dir, 's1', { name: '小雪', personality: '安静体贴', voice: { instruct: 'x' }, schedule: { times: [cur] } })
    const agent = { session: { id: 's1' } } // no followup -> falls back to appendCheer
    const controller = mockController(new Map([['s1', { agent }]]))
    const scheduler = createPersonaScheduler({ logger: { warn: () => {} } }, controller, dir)
    const fired = await scheduler.tick()
    assert.equal(fired, 1)
    assert.equal(controller.cheers.length, 1)
    const persona = readPersona(dir, 's1')
    const day = new Date().toISOString().slice(0, 10)
    assert.ok(persona.schedule.fired[day]?.includes(cur))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tick does not re-fire the same time twice in one day', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-sched-'))
  try {
    const cur = curTime()
    writePersona(dir, 's1', { name: 'A', personality: 'x', voice: { instruct: 'y' }, schedule: { times: [cur] } })
    const agent = { session: { id: 's1' } }
    const controller = mockController(new Map([['s1', { agent }]]))
    const scheduler = createPersonaScheduler({ logger: { warn: () => {} } }, controller, dir)
    assert.equal(await scheduler.tick(), 1)
    assert.equal(await scheduler.tick(), 0, 'same minute, already fired')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a session with no schedule times configured is skipped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-sched-'))
  try {
    writePersona(dir, 's1', { name: 'A', personality: 'x', voice: { instruct: 'y' }, schedule: { times: [] } })
    const agent = { session: { id: 's1' } }
    const controller = mockController(new Map([['s1', { agent }]]))
    const scheduler = createPersonaScheduler({ logger: { warn: () => {} } }, controller, dir)
    assert.equal(await scheduler.tick(), 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two tracked sessions with independent schedules only fire their own due times', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-sched-'))
  try {
    const cur = curTime()
    writePersona(dir, 's1', { name: 'A', personality: 'x', voice: { instruct: 'y' }, schedule: { times: [cur] } })
    writePersona(dir, 's2', { name: 'B', personality: 'z', voice: { instruct: 'w' }, schedule: { times: ['23:59'] } })
    const agent1 = { session: { id: 's1' } }
    const agent2 = { session: { id: 's2' } }
    const controller = mockController(new Map([['s1', { agent: agent1 }], ['s2', { agent: agent2 }]]))
    const scheduler = createPersonaScheduler({ logger: { warn: () => {} } }, controller, dir)
    assert.equal(await scheduler.tick(), 1, 'only s1 is due')
    assert.equal(controller.cheers[0].agent, agent1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a session with a followup capability gets a persona-flavored nudge instead of a direct cheer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-sched-'))
  try {
    const cur = curTime()
    writePersona(dir, 's1', { name: '小雪', personality: '安静体贴', voice: { instruct: 'x' }, schedule: { times: [cur] } })
    const followups = []
    const agent = { session: { id: 's1' }, followup: (msg) => { followups.push(msg) } }
    const controller = mockController(new Map([['s1', { agent }]]))
    const scheduler = createPersonaScheduler({ logger: { warn: () => {} } }, controller, dir)
    assert.equal(await scheduler.tick(), 1)
    assert.equal(followups.length, 1)
    assert.match(followups[0].content[0].text, /小雪/)
    assert.match(followups[0].content[0].text, /安静体贴/)
    assert.equal(controller.cheers.length, 0, 'followup path does not also append a direct cheer')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('start/stop control an interval without leaking a live timer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-sched-'))
  try {
    const controller = mockController(new Map())
    const scheduler = createPersonaScheduler({ logger: { warn: () => {} } }, controller, dir)
    scheduler.start()
    scheduler.start() // idempotent
    scheduler.stop()
    scheduler.stop() // idempotent
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
