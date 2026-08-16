/**
 * Client-bundle test for the dsh-sister thin shell: evaluates lib/client.js
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
    // speakBrowser guards on `typeof window.fetch === 'function'` but then
    // calls the bare `fetch(...)`, which resolves via globalThis. Keep this
    // truthy so the guard passes.
    fetch: () => {},
  }
  // This harness never invokes a useEffect's returned cleanup (there is no
  // real unmount/reconciliation here), so voice.watchQueue's setInterval
  // (started unconditionally whenever SpeakToggle renders with isVoice
  // true — see dsh-voice-core/lib/client.js) would leak a live timer past
  // the end of whichever test renders it. Default to a safe no-op.
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  // eslint-disable-next-line no-eval
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
  assert.equal(moduleObj.name, 'dsh-voice-core/sister')
  assert.deepEqual(moduleObj.inject, ['slots', 'conversation'])
  assert.equal(typeof moduleObj.apply, 'function')
})

test('apply registers the speak toggle and style picker', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })

  const speakBtn = entries.find((e) => e.slot === 'conversation.input.right' && e.register().opts.id === 'dsh-voice-sister-speak')
  assert.ok(speakBtn, 'sister speak toggle registered')
  const overlays = entries.filter((e) => e.slot === 'shell.overlay').map((e) => e.register().opts.id).sort()
  assert.deepEqual(overlays, ['dsh-voice-sister-background', 'dsh-voice-sister-style-picker'])
})

test('speak toggle renders only in sister sessions', () => {
  const coreDef = loadCore()
  const { moduleObj } = loadBundle(coreDef)
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const btn = entries.find((e) => e.slot === 'conversation.input.right' && e.register().opts.id === 'dsh-voice-sister-speak')
  const { component: SpeakToggle } = btn.register()

  const base = {
    sessionId: 's1',
    useProjection: () => ({ speakEnabled: true, lastSpoken: null, lastCheer: null }),
    session: { nodes: [], chat: { order: [], nodes: {} } },
  }
  const nonSister = SpeakToggle(Object.assign({}, base, {
    useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'teacher' } } }),
  }))
  assert.equal(nonSister, null)

  const sister = SpeakToggle(Object.assign({}, base, {
    useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'sister' } } }),
  }))
  assert.ok(sister !== null)
  assert.equal(sister.type, 'div')
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
