/**
 * Client-bundle test for the dsh-companion thin shell: evaluates lib/client.js
 * (which requires the shared dsh-voice-core bundle) with a mocked
 * `window.__ModuleLoader__` and a `react` stub. The core bundle is evaluated
 * first and provided to the require map so the thin shell resolves it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function evalBundle(source) {
  let captured = null
  globalThis.window = {
    __ModuleLoader__: { load: (def) => { captured = def } },
    fetch: () => {},
  }
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  ;(0, eval)(source)
  if (captured === null) throw new Error('bundle did not call __ModuleLoader__.load')
  return captured
}

function loadCore() {
  const source = readFileSync(join(ROOT, 'node_modules', 'dsh-voice-core', 'lib', 'client.js'), 'utf8')
  return evalBundle(source)
}

function loadBundle(coreDef) {
  const source = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  const def = evalBundle(source)
  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (init) => [init, () => {}],
    useEffect: (fn) => { fn() },
    useRef: (init) => ({ current: init }),
  }
  const coreModule = coreDef.factory((spec) => {
    if (spec === 'react') return reactStub
    if (spec === 'react/jsx-runtime') return reactStub
    throw new Error(`unexpected core require: ${spec}`)
  })
  const moduleObj = def.factory((spec) => {
    if (spec === 'react') return reactStub
    if (spec === 'react/jsx-runtime') return reactStub
    if (spec === 'dsh-voice-core') return coreModule
    throw new Error(`unexpected require: ${spec}`)
  })
  return { moduleObj, reactStub }
}

function mockSlots() {
  const entries = []
  const slots = {
    inject: (slot, callback) => entries.push({ slot, register: callback }),
    register: (opts, component) => ({ opts, component }),
  }
  return { slots, entries }
}

test('client bundle exports a slots plugin', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  assert.equal(moduleObj.name, 'dsh-companion')
  assert.deepEqual(moduleObj.inject, ['slots', 'conversation'])
  assert.equal(typeof moduleObj.apply, 'function')
})

test('apply registers the invisible auto-read mount and the background overlay, no picker/toggle UI', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })

  const speakBtn = entries.find((e) => e.slot === 'conversation.input.right' && e.register().opts.id === 'dsh-voice-companion-speak')
  assert.ok(speakBtn, 'the auto-read mount is registered')
  const overlays = entries.filter((e) => e.slot === 'shell.overlay').map((e) => e.register().opts.id)
  assert.ok(overlays.includes('dsh-voice-companion-background'))
  assert.ok(!overlays.some((id) => id.includes('style-picker')), 'no style-picker overlay is registered')
})

test('SpeakToggle never renders any UI, and is gated to companion sessions for its underlying effects', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const btn = entries.find((e) => e.slot === 'conversation.input.right' && e.register().opts.id === 'dsh-voice-companion-speak')
  const { component: SpeakToggle } = btn.register()

  const base = {
    sessionId: 's1',
    useProjection: () => ({ speakEnabled: true, lastSpoken: null, lastCheer: null }),
    session: { nodes: [], chat: { order: [], nodes: {} } },
  }
  const notCompanion = SpeakToggle(Object.assign({}, base, {
    useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'teacher' } } }),
  }))
  assert.equal(notCompanion, null)

  const companion = SpeakToggle(Object.assign({}, base, {
    useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'companion' } } }),
  }))
  assert.equal(companion, null, 'no UI to render, even for a companion session')
})

test('core _test helpers are re-exported by the thin shell', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  assert.equal(typeof moduleObj._test.latestAssistantText, 'function')
  assert.equal(typeof moduleObj._test.assistantNodeText, 'function')
  assert.equal(typeof moduleObj._test.speakable, 'function')
  const { speakable } = moduleObj._test
  assert.equal(speakable('**Hello** ✅'), 'Hello ✅')
})

test('registers the persona button in the session header and the modal in shell.overlay (no style picker)', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const header = entries.filter((e) => e.slot === 'conversation.session.header.actions')
  assert.equal(header.length, 1)
  assert.equal(header[0].register().opts.id, 'dsh-companion-persona-button')
  const overlays = entries.filter((e) => e.slot === 'shell.overlay').map((e) => e.register().opts.id)
  assert.ok(overlays.includes('dsh-companion-persona-modal'))
  assert.ok(!overlays.some((id) => id.includes('style-picker')), 'no style picker overlay registered')
})

test('persona button only renders for a companion-preset session', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const { component: PersonaButton } = entries.find((e) => e.slot === 'conversation.session.header.actions').register()

  const other = PersonaButton({
    sessionId: 's1',
    useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'teacher' } } }),
  })
  assert.equal(other, null)

  const mine = PersonaButton({
    sessionId: 's1',
    useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'companion' } } }),
  })
  assert.ok(mine !== null)
  assert.equal(mine.type, 'button')
})

test('persona button shows the generic default name before any persona is fetched, then the fetched name', async () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { fetchPersona, DEFAULT_PERSONA } = moduleObj._test
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const { component: PersonaButton } = entries.find((e) => e.slot === 'conversation.session.header.actions').register()

  const savedFetch = globalThis.fetch
  globalThis.fetch = (url) => {
    assert.equal(url, '/dsh-companion/persona?sessionId=s9')
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...DEFAULT_PERSONA, name: '小雪' }) })
  }
  try {
    const before = PersonaButton({ sessionId: 's9', useSessions: (sel) => sel({ byId: { s9: { agentPreset: 'companion' } } }) })
    assert.ok(before.children.some((c) => typeof c === 'string' && c.includes(DEFAULT_PERSONA.name)))
    await moduleObj._test.fetchPersona('s9')
    const after = PersonaButton({ sessionId: 's9', useSessions: (sel) => sel({ byId: { s9: { agentPreset: 'companion' } } }) })
    assert.ok(after.children.some((c) => typeof c === 'string' && c.includes('小雪')))
  } finally {
    globalThis.fetch = savedFetch
  }
})

test('resolveInstruct returns the cached persona\'s instruct once fetched, else the default', async () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { fetchPersona, resolveInstruct, DEFAULT_PERSONA } = moduleObj._test
  assert.equal(resolveInstruct('never-fetched'), DEFAULT_PERSONA.voice.instruct)

  const savedFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ...DEFAULT_PERSONA, voice: { presetKey: 'onee', instruct: 'onee-instruct' } }),
  })
  try {
    await fetchPersona('s1')
    assert.equal(resolveInstruct('s1'), 'onee-instruct')
  } finally {
    globalThis.fetch = savedFetch
  }
})

test('savePersona PATCHes and updates the cache used by resolveInstruct', async () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { savePersona, resolveInstruct } = moduleObj._test
  const savedFetch = globalThis.fetch
  let sentBody = null
  globalThis.fetch = (url, init) => {
    assert.equal(url, '/dsh-companion/persona?sessionId=s1')
    assert.equal(init.method, 'PATCH')
    sentBody = JSON.parse(init.body)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...sentBody, voice: { ...sentBody.voice } }) })
  }
  try {
    await savePersona('s1', { name: '小雪', personality: 'x', voice: { presetKey: 'onee', instruct: 'onee-instruct' }, schedule: { times: [] } })
    assert.equal(sentBody.name, '小雪')
    assert.equal(resolveInstruct('s1'), 'onee-instruct')
  } finally {
    globalThis.fetch = savedFetch
  }
})
