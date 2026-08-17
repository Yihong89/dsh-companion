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

test('client bundle exports a slots plugin (thin shell over core)', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  assert.equal(moduleObj.name, 'dsh-voice-core/companion')
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
  const overlays = entries.filter((e) => e.slot === 'shell.overlay').map((e) => e.register().opts.id).sort()
  assert.deepEqual(overlays, ['dsh-voice-companion-background'], 'no style-picker overlay is registered')
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
