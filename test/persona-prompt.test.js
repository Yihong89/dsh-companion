import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerPersonaPrompt } from '../lib/persona-prompt.js'
import { writePersona } from '../lib/persona-store.js'

function mockSystemPrompt() {
  const sections = []
  const variables = {}
  return {
    section: (s) => { sections.push(s); return () => { const i = sections.indexOf(s); if (i >= 0) sections.splice(i, 1) } },
    variable: (name, provider) => { variables[name] = provider; return () => { delete variables[name] } },
    sections,
    variables,
  }
}

test('registers exactly one order-0 section rendering the persona variable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-prompt-'))
  try {
    const systemPrompt = mockSystemPrompt()
    registerPersonaPrompt({ systemPrompt }, dir)
    assert.equal(systemPrompt.sections.length, 1)
    assert.equal(systemPrompt.sections[0].order, 0)
    assert.match(systemPrompt.sections[0].text, /\{\{companion_persona\}\}/)
    assert.equal(typeof systemPrompt.variables.companion_persona, 'function')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the variable provider resolves the right session\'s saved persona', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-prompt-'))
  try {
    writePersona(dir, 's1', { name: '小雪', personality: '安静体贴', voice: { instruct: 'x' }, schedule: { times: [] } })
    const systemPrompt = mockSystemPrompt()
    registerPersonaPrompt({ systemPrompt }, dir)
    const text = systemPrompt.variables.companion_persona({ agent: { session: { id: 's1' } } })
    assert.match(text, /小雪/)
    assert.match(text, /安静体贴/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the variable provider falls back to the generic default for an unconfigured session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-prompt-'))
  try {
    const systemPrompt = mockSystemPrompt()
    registerPersonaPrompt({ systemPrompt }, dir)
    const text = systemPrompt.variables.companion_persona({ agent: { session: { id: 'never-configured' } } })
    assert.match(text, /小助手/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the variable provider returns undefined with no agent scope (bare assemble())', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-prompt-'))
  try {
    const systemPrompt = mockSystemPrompt()
    registerPersonaPrompt({ systemPrompt }, dir)
    assert.equal(systemPrompt.variables.companion_persona({}), undefined)
    assert.equal(systemPrompt.variables.companion_persona(undefined), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the returned dispose function unregisters both the section and the variable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-companion-prompt-'))
  try {
    const systemPrompt = mockSystemPrompt()
    const dispose = registerPersonaPrompt({ systemPrompt }, dir)
    dispose()
    assert.equal(systemPrompt.sections.length, 0)
    assert.equal(systemPrompt.variables.companion_persona, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
