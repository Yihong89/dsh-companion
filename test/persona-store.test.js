import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PERSONA, personaPath, readPersona, writePersona, markFired } from '../lib/persona-store.js'

test('readPersona returns DEFAULT_PERSONA when no file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-persona-'))
  try {
    const persona = readPersona(dir, 's1')
    assert.deepEqual(persona, DEFAULT_PERSONA)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writePersona then readPersona round-trips name/personality/voice/schedule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-persona-'))
  try {
    writePersona(dir, 's1', {
      name: '小雪',
      personality: '安静、体贴，喜欢用简短的话鼓励人。',
      voice: { presetKey: 'onee', instruct: '清冷柔和的成年女声' },
      schedule: { times: ['08:00', '20:00'] },
    }, 1000)
    const persona = readPersona(dir, 's1')
    assert.equal(persona.name, '小雪')
    assert.equal(persona.personality, '安静、体贴，喜欢用简短的话鼓励人。')
    assert.deepEqual(persona.voice, { presetKey: 'onee', instruct: '清冷柔和的成年女声' })
    assert.deepEqual(persona.schedule.times, ['08:00', '20:00'])
    assert.deepEqual(persona.schedule.fired, {})
    assert.equal(persona.createdAt, 1000)
    assert.equal(persona.updatedAt, 1000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writePersona preserves createdAt and schedule.fired across a later save', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-persona-'))
  try {
    writePersona(dir, 's1', { name: 'A', personality: 'x', voice: { instruct: 'y' }, schedule: { times: [] } }, 1000)
    markFired(dir, 's1', '2026-08-17', '08:00')
    writePersona(dir, 's1', { name: 'B', personality: 'z', voice: { instruct: 'w' }, schedule: { times: ['09:00'] } }, 2000)
    const persona = readPersona(dir, 's1')
    assert.equal(persona.name, 'B')
    assert.equal(persona.createdAt, 1000, 'createdAt survives the second save')
    assert.equal(persona.updatedAt, 2000)
    assert.deepEqual(persona.schedule.fired, { '2026-08-17': ['08:00'] }, 'fired log survives the second save')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readPersona falls back to DEFAULT_PERSONA on a corrupt file (never throws)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-persona-'))
  try {
    const path = personaPath(dir, 's1')
    mkdirSync(join(dir, 'personas'), { recursive: true })
    writeFileSync(path, '{ not valid json')
    const persona = readPersona(dir, 's1')
    assert.deepEqual(persona, DEFAULT_PERSONA)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('markFired accumulates multiple times for the same day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-persona-'))
  try {
    writePersona(dir, 's1', { name: 'A', personality: 'x', voice: { instruct: 'y' }, schedule: { times: ['08:00', '20:00'] } }, 1000)
    markFired(dir, 's1', '2026-08-17', '08:00')
    markFired(dir, 's1', '2026-08-17', '20:00')
    const persona = readPersona(dir, 's1')
    assert.deepEqual(persona.schedule.fired['2026-08-17'], ['08:00', '20:00'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('personaPath keys by session id under <stateDir>/personas', () => {
  const dir = '/tmp/example'
  assert.equal(personaPath(dir, 's1'), join(dir, 'personas', 's1.json'))
})
