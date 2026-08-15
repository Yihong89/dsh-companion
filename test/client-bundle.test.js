/**
 * Client-bundle test: evaluates lib/client.js with a mocked
 * `window.__ModuleLoader__` and a `react` stub, then asserts the plugin shape,
 * slot registrations, the sister gate, and the assistant-text extraction
 * (harness `kind` blocks + chat-store wrappers).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function loadBundle() {
  const source = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  let captured = null
  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (init) => [init, () => {}],
    useEffect: (fn) => { fn() },
    useRef: (init) => ({ current: init }),
  }
  globalThis.window = {
    __ModuleLoader__: { load: (def) => { captured = def } },
  }
  // eslint-disable-next-line no-eval
  ;(0, eval)(source)
  assert.ok(captured, 'bundle did not call __ModuleLoader__.load')
  const moduleObj = captured.factory((spec) => {
    if (spec === 'react') return reactStub
    if (spec === 'react/jsx-runtime') return reactStub
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
  const { moduleObj } = loadBundle()
  assert.equal(moduleObj.name, 'dsh-sister/client')
  assert.deepEqual(moduleObj.inject, ['slots', 'conversation'])
  assert.equal(typeof moduleObj.apply, 'function')
})

test('apply registers the speak toggle in the chat box and the cheer chip overlay', () => {
  const { moduleObj } = loadBundle()
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })

  const speakBtn = entries.find((e) => e.slot === 'conversation.input.right' && e.register().opts.id === 'dsh-sister-speak')
  assert.ok(speakBtn, 'sister speak toggle registered in the chat box')
  const speakOpts = speakBtn.register().opts
  assert.equal(speakOpts.name, 'conversation.input.right')
  assert.equal(typeof speakOpts.label, 'function')

  const chip = entries.find((e) => e.slot === 'shell.overlay' && e.register().opts.id === 'dsh-sister-cheer-chip')
  assert.ok(chip, 'cheer chip overlay registered')
})

test('speak toggle renders only in sister sessions', () => {
  const { moduleObj } = loadBundle()
  const { slots, entries } = mockSlots()
  moduleObj.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const btn = entries.find((e) => e.slot === 'conversation.input.right' && e.register().opts.id === 'dsh-sister-speak')
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
  const buttons = sister.children.filter((c) => c && c.type === 'button')
  assert.equal(buttons.length, 2, 'voice picker + speak toggle')
})

test('assistantNodeText reads harness blocks by kind, skipping reasoning', () => {
  const { moduleObj } = loadBundle()
  const { assistantNodeText } = moduleObj._test
  const node = {
    kind: 'assistant',
    seq: 7,
    blocks: [
      { kind: 'text', text: 'Hello sunshine' },
      { kind: 'reasoning', text: 'chain of thought — never spoken' },
      { kind: 'text', text: ' part two' },
      { type: 'text', text: ' legacy block' },
    ],
  }
  assert.equal(assistantNodeText(node), 'Hello sunshine\n part two\n legacy block')
})

test('latestAssistantText unwraps chat-store view wrappers (assistant-step → finalNode)', () => {
  const { moduleObj } = loadBundle()
  const { latestAssistantText } = moduleObj._test
  const chatNodes = new Map([
    ['u1', { key: 'u1', kind: 'user', id: 'u1', target: 'chat', data: { kind: 'user', seq: 1, content: [], source: {} } }],
    ['a1', {
      key: 'a1',
      kind: 'assistant-step',
      id: 'a1',
      target: 'chat',
      data: { status: 'final', turn: 1, step: 1, finalNode: { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: 'You are awesome!' }] } },
    }],
  ])
  const session = {
    nodes: [],
    chat: { order: ['u1', 'a1'], nodes: { get: (id) => chatNodes.get(id) } },
  }
  assert.deepEqual(latestAssistantText(session), { seq: 2, text: 'You are awesome!' })
})

test('latestAssistantText finds the newest assistant message from raw nodes', () => {
  const { moduleObj } = loadBundle()
  const { latestAssistantText } = moduleObj._test
  const session = {
    nodes: [
      { kind: 'user', seq: 1, content: [], source: {} },
      { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: 'First' }] },
      { kind: 'assistant', seq: 3, blocks: [{ kind: 'reasoning', text: 'think' }, { kind: 'text', text: 'Latest reply' }] },
    ],
    chat: { order: [], nodes: {} },
  }
  assert.deepEqual(latestAssistantText(session), { seq: 3, text: 'Latest reply' })
})

test('voice styles: every style has an instruct, default is paimon', () => {
  const { moduleObj } = loadBundle()
  const { STYLES, DEFAULT_STYLE, styleInstruct } = moduleObj._test
  assert.equal(DEFAULT_STYLE, 'paimon')
  assert.deepEqual(Object.keys(STYLES).sort(), ['cool', 'cute', 'genki', 'paimon'])
  for (const key of Object.keys(STYLES)) {
    assert.ok(typeof STYLES[key].instruct === 'string' && STYLES[key].instruct.length > 10, key + ' instruct')
    assert.ok(typeof STYLES[key].label === 'string' && STYLES[key].label.length > 0, key + ' label')
  }
  // paimon instruct mentions 萝莉/萌 for the squeaky anime-girl vibe
  assert.match(STYLES.paimon.instruct, /萝莉|卖萌|撒娇/)
  // unknown style falls back to the default instruct
  assert.equal(styleInstruct('nope'), STYLES[DEFAULT_STYLE].instruct)
})

test('savedStyle reads the localStorage style key and falls back to default', () => {
  const { moduleObj } = loadBundle()
  const { savedStyle, DEFAULT_STYLE } = moduleObj._test
  globalThis.window.localStorage = {
    getItem: () => 'genki',
    setItem: () => {},
    removeItem: () => {},
  }
  assert.equal(savedStyle(), 'genki')
  delete globalThis.window.localStorage
})

test('savedStyle rejects unknown keys stored in localStorage', () => {
  const { moduleObj } = loadBundle()
  const { savedStyle } = moduleObj._test
  globalThis.window.localStorage = {
    getItem: () => 'totally-not-a-style',
    setItem: () => {},
    removeItem: () => {},
  }
  assert.equal(savedStyle(), null)
  delete globalThis.window.localStorage
})
