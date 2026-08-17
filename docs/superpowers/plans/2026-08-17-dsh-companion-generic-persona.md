# dsh-companion generic persona Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `dsh-sister` (one hardcoded 妹妹 persona) into `dsh-companion` (a generic companion plugin whose personality, voice, and daily greeting schedule are configured per chat session through a UI form).

**Architecture:** `dsh-companion` stays a thin host+client plugin over the shared `dsh-voice-core` engine (TTS proxy, `speak`/`cheer` tools, session tracking, the `voiceSpeak` projection — all reused unchanged). New code lives in `dsh-companion`: a per-session persona JSON store, HTTP endpoints to read/save it, a `systemPrompt` section that renders it live per session, a per-session greeting scheduler (replacing the core's global one), and a client-side header button + modal that replaces the old style picker. Two small, additive, backward-compatible options are added to `dsh-voice-core`'s shared client so `dsh-companion` can resolve TTS instruct per session and hide the core's built-in speak-toggle/style-picker UI — `dsh-teacher`, the other consumer, is unaffected by both.

**Tech Stack:** Node.js ES modules, `node --test`, Cordis plugin host, React (via the harness's `__ModuleLoader__`/`require` shim, no bundler — same untranspiled ES5-ish style as the existing client files), Qwen3-TTS VoiceDesign (unchanged).

## Global Constraints

- Node `>=22.5.0`, ES modules (`"type": "module"`) — matches both repos' existing `package.json`.
- Every task ends with `node --test 'test/*.test.js'` passing in the repo it touched, before commit.
- `dsh-voice-core` changes (Tasks 1–2) must be 100% additive: every new option defaults to today's exact behavior, so `dsh-teacher` (the sibling consumer, not touched by this plan) keeps working unmodified. Verify by running `dsh-voice-core`'s full existing test suite unchanged after each of those tasks.
- Do **not** rename the GitHub repositories or the local directory names (`dsh-sister/`, `dsh-voice-core/` stay as-is) — only the npm package `name`, plugin identity, preset id, and HTTP routes become `dsh-companion` / `/dsh-companion/*`. This is a deliberate scope decision: renaming a GitHub repo is a separate, user-initiated action.
- UI copy stays Chinese-first, matching every existing string in both repos.
- Commit messages: small, one commit per task, each ending with:
  ```
  Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
  ```

---

## Task 1: `dsh-voice-core` — session-aware TTS instruct (`resolveInstruct`)

Fixes a real latent bug: today's shared client always resolves the TTS instruct used for auto-read from the *static* `opts.defaultStyle`, never from whatever the (now-removed-for-companion) style picker saved — the picker only ever affected the preview. This task adds an optional per-session resolver a consumer can supply instead.

**Files:**
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-voice-core/lib/client.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-voice-core/test/client-bundle.test.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-voice-core/package.json`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-voice-core/README.md`

**Interfaces:**
- Produces: `createVoiceClient(opts)` accepts an optional `opts.resolveInstruct: (sessionId) => string`. When it returns a non-empty string, that value is used as the TTS `instruct` for the auto-read request instead of `opts.styles[opts.defaultStyle].instruct`. Absent/returns falsy ⇒ identical to today's behavior.

- [ ] **Step 1: Write the failing test**

Add to `test/client-bundle.test.js` (after the existing `'speakBrowser closes an older in-flight stream...'` test, same file):

```js
test('resolveInstruct overrides the static default style for the auto-read TTS request', () => {
  const { moduleObj } = loadBundle()
  const plugin = moduleObj.createVoiceClient({
    presetName: 'sister',
    ttsPath: '/dsh-sister/tts',
    styles: { paimon: { label: '派蒙', instruct: 'static-default-instruct' } },
    defaultStyle: 'paimon',
    resolveInstruct: (sessionId) => (sessionId === 's1' ? 'resolved-per-session-instruct' : ''),
  })
  const { slots, entries } = mockSlots()
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const { component: SpeakToggle } = entries.filter((e) => e.slot === 'conversation.input.right')[0].register()

  const { FakeEventSource, instances } = makeFakeEventSource()
  const savedEventSource = globalThis.EventSource
  globalThis.EventSource = FakeEventSource
  try {
    const s1Props = {
      sessionId: 's1',
      useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'sister' } } }),
      useProjection: () => ({ speakEnabled: true, lastSpoken: null, lastCheer: null }),
    }
    primeThenReply(SpeakToggle, s1Props)
    SpeakToggle({ ...s1Props, session: assistantSession(1, 'hello') })
    assert.equal(instances.length, 1)
    const sentInstruct = decodeURIComponent(instances[0].url.match(/instruct=([^&]*)/)[1])
    assert.equal(sentInstruct, 'resolved-per-session-instruct', 'resolveInstruct wins over the static default')
  } finally {
    globalThis.EventSource = savedEventSource
  }
})

test('resolveInstruct returning empty falls back to the static default style', () => {
  const { moduleObj } = loadBundle()
  const plugin = moduleObj.createVoiceClient({
    presetName: 'sister',
    ttsPath: '/dsh-sister/tts',
    styles: { paimon: { label: '派蒙', instruct: 'static-default-instruct' } },
    defaultStyle: 'paimon',
    resolveInstruct: () => '',
  })
  const { slots, entries } = mockSlots()
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const { component: SpeakToggle } = entries.filter((e) => e.slot === 'conversation.input.right')[0].register()

  const { FakeEventSource, instances } = makeFakeEventSource()
  const savedEventSource = globalThis.EventSource
  globalThis.EventSource = FakeEventSource
  try {
    const s1Props = {
      sessionId: 's1',
      useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'sister' } } }),
      useProjection: () => ({ speakEnabled: true, lastSpoken: null, lastCheer: null }),
    }
    primeThenReply(SpeakToggle, s1Props)
    SpeakToggle({ ...s1Props, session: assistantSession(1, 'hello') })
    const sentInstruct = decodeURIComponent(instances[0].url.match(/instruct=([^&]*)/)[1])
    assert.equal(sentInstruct, 'static-default-instruct')
  } finally {
    globalThis.EventSource = savedEventSource
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-voice-core && node --test test/client-bundle.test.js`
Expected: the two new tests FAIL (`sentInstruct` equals `'static-default-instruct'` in the first test, since `resolveInstruct` isn't wired yet).

- [ ] **Step 3: Implement `resolveInstruct`**

In `lib/client.js`, replace the `instructFor` function:

```js
/** Voice-design instruct string for a preset's currently selected style,
 * or the consumer's own per-session resolver when one is supplied. */
function instructFor(opts, sessionId) {
  if (typeof opts.resolveInstruct === 'function') {
    var resolved = opts.resolveInstruct(sessionId)
    if (typeof resolved === 'string' && resolved) return resolved
  }
  return opts.styles[opts.defaultStyle] ? opts.styles[opts.defaultStyle].instruct : ''
}
```

Then update the one call site inside `makeSpeakToggle`'s auto-read effect (the `voice.request({...})` call):

```js
voice.request({ text: msg.text, sessionId: props.sessionId, presetName: opts.presetName, ttsPath: opts.ttsPath, instruct: instructFor(opts, props.sessionId) })
```

(previously `instructFor(opts)` with no second argument).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-voice-core && node --test 'test/*.test.js'`
Expected: PASS, full suite (including every pre-existing test) green.

- [ ] **Step 5: Update package.json version and README**

In `package.json`, bump `"version": "0.1.0"` → `"version": "0.2.0"`.

In `README.md`, in the "**Client（`createVoiceClient(opts)`）**" bullet list, add one line after the existing bullets:

```markdown
- `opts.resolveInstruct(sessionId)` 可选：按会话动态决定 TTS instruct（优先于 `defaultStyle` 的静态值），供需要"每个会话自己的音色"的消费者使用
```

- [ ] **Step 6: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-voice-core
git add lib/client.js test/client-bundle.test.js package.json README.md
git commit -m "$(cat <<'EOF'
feat: let a consumer resolve TTS instruct per session

The style picker only ever affected the preview -- auto-read always used
the static defaultStyle instruct. opts.resolveInstruct(sessionId) lets a
consumer (dsh-companion) supply the real per-session voice; falls back to
today's static behavior when absent or empty, so dsh-teacher is unaffected.

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

---

## Task 2: `dsh-voice-core` — `showSpeakToggle` / `showStylePicker` visibility options

**Files:**
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-voice-core/lib/client.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-voice-core/test/client-bundle.test.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-voice-core/package.json`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-voice-core/README.md`

**Interfaces:**
- Consumes: `instructFor(opts, sessionId)` from Task 1 (unchanged signature).
- Produces: `createVoiceClient(opts)` accepts `opts.showSpeakToggle` (default `true`) and `opts.showStylePicker` (default `true`). `false` on either hides that icon's JSX (the 🔊 toggle / queue badge, or the 🎤 button) without touching the underlying effects (auto-read, queue polling, cheer-clip playback keep running — only visible UI is suppressed). When both are `false`, `SpeakToggle` renders `null` instead of an empty wrapper `div`, and the `shell.overlay` style-picker panel is not registered at all.

- [ ] **Step 1: Write the failing tests**

Add to `test/client-bundle.test.js`:

```js
test('showStylePicker: false hides the 🎤 button and does not register the picker overlay, even with multiple styles', () => {
  const { moduleObj } = loadBundle()
  const plugin = moduleObj.createVoiceClient({
    presetName: 'sister',
    ttsPath: '/dsh-sister/tts',
    styles: { paimon: { label: '派蒙', instruct: 'x' }, cute: { label: '软萌', instruct: 'y' } },
    defaultStyle: 'paimon',
    showStylePicker: false,
  })
  const { slots, entries } = mockSlots()
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const overlays = entries.filter((e) => e.slot === 'shell.overlay').map((e) => e.register().opts.id)
  assert.ok(!overlays.includes('dsh-voice-sister-style-picker'), 'picker overlay is not registered at all')

  const { component: SpeakToggle } = entries.filter((e) => e.slot === 'conversation.input.right')[0].register()
  const tree = SpeakToggle({
    sessionId: 's1',
    useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'sister' } } }),
    useProjection: () => ({ speakEnabled: true, lastSpoken: null, lastCheer: null }),
    session: { nodes: [], chat: { order: [], nodes: {} } },
  })
  const buttons = (tree ? tree.children : []).filter((c) => c && c.type === 'button')
  assert.equal(buttons.length, 1, 'only the 🔊 speak toggle remains')
})

test('showSpeakToggle: false and showStylePicker: false together render nothing', () => {
  const { moduleObj } = loadBundle()
  const plugin = moduleObj.createVoiceClient({
    presetName: 'sister',
    ttsPath: '/dsh-sister/tts',
    styles: { paimon: { label: '派蒙', instruct: 'x' }, cute: { label: '软萌', instruct: 'y' } },
    defaultStyle: 'paimon',
    showSpeakToggle: false,
    showStylePicker: false,
  })
  const { slots, entries } = mockSlots()
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const overlays = entries.filter((e) => e.slot === 'shell.overlay').map((e) => e.register().opts.id)
  assert.ok(!overlays.includes('dsh-voice-sister-style-picker'))

  const { component: SpeakToggle } = entries.filter((e) => e.slot === 'conversation.input.right')[0].register()
  const tree = SpeakToggle({
    sessionId: 's1',
    useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'sister' } } }),
    useProjection: () => ({ speakEnabled: true, lastSpoken: null, lastCheer: null }),
    session: { nodes: [], chat: { order: [], nodes: {} } },
  })
  assert.equal(tree, null, 'no icons to show ⇒ component renders nothing')
})

test('auto-read and queue polling keep working with both UI icons hidden', () => {
  // Suppressing the icons must not suppress the underlying behavior.
  const { moduleObj } = loadBundle()
  const plugin = moduleObj.createVoiceClient({
    presetName: 'sister',
    ttsPath: '/dsh-sister/tts',
    styles: { paimon: { label: '派蒙', instruct: 'x' } },
    defaultStyle: 'paimon',
    showSpeakToggle: false,
    showStylePicker: false,
  })
  const { slots, entries } = mockSlots()
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const { component: SpeakToggle } = entries.filter((e) => e.slot === 'conversation.input.right')[0].register()

  const { FakeEventSource, instances } = makeFakeEventSource()
  const savedEventSource = globalThis.EventSource
  globalThis.EventSource = FakeEventSource
  try {
    const s1Props = {
      sessionId: 's1',
      useSessions: (sel) => sel({ byId: { s1: { agentPreset: 'sister' } } }),
      useProjection: () => ({ speakEnabled: true, lastSpoken: null, lastCheer: null }),
    }
    primeThenReply(SpeakToggle, s1Props)
    SpeakToggle({ ...s1Props, session: assistantSession(1, 'hello') })
    assert.equal(instances.length, 1, 'auto-read still fires with icons hidden')
  } finally {
    globalThis.EventSource = savedEventSource
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-voice-core && node --test test/client-bundle.test.js`
Expected: the three new tests FAIL (picker overlay still registered; both-hidden tree is a `div`, not `null`).

- [ ] **Step 3: Implement the visibility options**

In `lib/client.js`'s `createVoiceClient` defaults `Object.assign`, add two entries:

```js
function createVoiceClient(opts) {
  var o = Object.assign({
    presetName: 'voice',
    ttsPath: '/dsh-voice/tts',
    styles: {},
    defaultStyle: null,
    previewText: '嗨嗨！我是你的妹妹呀～你喜欢我的声音吗？嘿嘿！',
    backgroundUrl: null,
    cheerAudioManifestUrl: null,
    resolveInstruct: null,
    showSpeakToggle: true,
    showStylePicker: true,
  }, opts || {})
```

In `makeSpeakToggle(opts)`'s returned component, replace the final `return h('div', ...)` block. Today it always renders a `div` with the 🎤 button (conditional on `styleKeys.length > 1`), the 🔊 button, and the queue badge. Change it to:

```js
        if (!isVoice) return null
        var enabled = state[0]
        var styleKeys = Object.keys(opts.styles)
        var queue = queueState[0]
        var showPicker = opts.showStylePicker !== false && styleKeys.length > 1
        var showToggle = opts.showSpeakToggle !== false
        if (!showPicker && !showToggle) return null
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: 2 } },
          showPicker
            ? h('button', {
                onClick: function () { setPickerOpen(!pickerStore.open) },
                title: '选择音色 — pick & preview the voice',
                'aria-label': opts.presetName + ' voice picker',
                style: {
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, padding: '2px 4px',
                  color: 'var(--dsw-text-color, inherit)',
                },
              }, '🎤')
            : null,
          showToggle
            ? h('button', {
                onClick: function () {
                  var next = !enabled
                  state[1](next)
                  try {
                    var sessions = pluginCtx.get('sessions')
                    var binding = sessions === undefined ? undefined : sessions.binding(props.sessionId)
                    if (binding !== undefined && typeof binding.session.command === 'function') {
                      binding.session.command('/speak ' + (next ? 'on' : 'off')).catch(function () {})
                    }
                  } catch (e) {}
                },
                title: enabled ? 'Voice is on — click to mute' : 'Voice is muted — click to enable',
                'aria-label': opts.presetName + ' speak toggle',
                style: {
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, padding: '2px 6px',
                  color: enabled ? 'var(--dsw-text-color, inherit)' : '#8e8e8e',
                  textDecoration: enabled ? 'none' : 'line-through',
                },
              }, '🔊')
            : null,
          showToggle && queue !== null && queue.pending > 0
            ? h('span', {
                title: 'TTS 排队中 — ' + queue.pending + ' 个请求在等待'
                  + (queue.lastGenerationMs !== null ? '（上一次生成用时 ' + Math.round(queue.lastGenerationMs / 1000) + 's）' : ''),
                'aria-label': opts.presetName + ' tts queue depth',
                style: {
                  fontSize: 11, marginLeft: 1, color: '#f39c12', whiteSpace: 'nowrap',
                  cursor: 'default',
                },
              }, '⏳' + queue.pending)
            : null,
        )
```

In `createVoiceClient`'s `apply`, gate the picker overlay registration:

```js
          slots.inject('shell.overlay', function () {
            return slots.register({ name: 'shell.overlay', id: 'dsh-voice-' + o.presetName + '-background', order: 1 }, BackgroundLayer)
          })
          if (o.showStylePicker !== false) {
            slots.inject('shell.overlay', function () {
              return slots.register({ name: 'shell.overlay', id: 'dsh-voice-' + o.presetName + '-style-picker', order: 45 }, VoicePicker)
            })
          }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-voice-core && node --test 'test/*.test.js'`
Expected: PASS, full suite green (including the existing `'single-style config omits the picker button'` test, which must keep passing unchanged since it doesn't set the new options).

- [ ] **Step 5: Update package.json version and README**

Bump `"version": "0.2.0"` → `"version": "0.3.0"`.

Add two more README bullets next to the `resolveInstruct` one added in Task 1:

```markdown
- `opts.showSpeakToggle` / `opts.showStylePicker`（默认都是 `true`）：隐藏对应的图标（自动朗读、队列徽标等底层行为不受影响，只是不渲染 UI），供有自己一套配置界面的消费者使用
```

- [ ] **Step 6: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-voice-core
git add lib/client.js test/client-bundle.test.js package.json README.md
git commit -m "$(cat <<'EOF'
feat: let a consumer hide the built-in speak toggle and style picker

dsh-companion is replacing both with its own persona button/modal and
must not show two competing controls. showSpeakToggle/showStylePicker
default to true (today's exact behavior) so dsh-teacher is unaffected;
the underlying auto-read/queue/cheer-clip effects keep running either way
-- only the icon JSX is suppressed.

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

---

## Task 3: `dsh-companion` — rename from `dsh-sister`, drop sister-only assets

This is a mechanical rename plus deletion of the background-image/pre-baked-cheer-audio machinery (dropped per spec — arbitrary custom voices can't be pre-baked, and live streaming TTS already starts in ~1s). After this task, `dsh-companion` behaves exactly like today's `dsh-sister` (fixed 派蒙 persona, global schedule) but under the new name/routes/preset, with no persona system yet — that lands in later tasks.

**Files:**
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/package.json`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/index.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/lib/client.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/lib/register-events.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/cordis.patch.yml`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/host-smoke.test.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/client-bundle.test.js`
- Delete: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/assets/background.jpg`
- Delete: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/assets/cheer-audio/` (directory, 20 `.m4a` files + any manifest)
- Delete: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/scripts/generate-cheer-audio.mjs`

**Interfaces:**
- Produces: plugin `name` export `'dsh-companion'`; `applyVoice` called with `presetName: 'companion'`, `ttsPath: '/dsh-companion/tts'`; client module id `'dsh-companion'`; `DEFAULT_CHEER_TIMES` and the persona system are NOT yet touched (still the old global-schedule shape) — that changes in Task 7.

- [ ] **Step 1: Update `package.json`**

```json
{
  "name": "dsh-companion",
  "version": "0.1.0",
  "description": "DSH companion plugin: a fully customizable voice-and-personality companion. Configure any name, personality, and TTS voice per chat session -- no forking or publishing a new package required.",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": {
      "default": "./lib/client.js"
    },
    "./register-events": {
      "default": "./lib/register-events.js"
    },
    "./package.json": "./package.json"
  },
  "license": "MIT",
  "engines": {
    "node": ">=22.5.0"
  },
  "scripts": {
    "test": "node --test 'test/*.test.js'"
  },
  "keywords": [
    "deepseek-harness",
    "deepseek",
    "dsh",
    "dsh-plugin",
    "cordis",
    "companion",
    "tts",
    "persona",
    "cheer"
  ],
  "dependencies": {
    "zod": "^4.0.0",
    "dsh-voice-core": "github:Yihong89/dsh-voice-core"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "dsh-voice-core"
      ]
    }
  },
  "peerDependencies": {}
}
```

- [ ] **Step 2: Delete the sister-only assets**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
git rm -r assets/background.jpg assets/cheer-audio scripts/generate-cheer-audio.mjs
```

- [ ] **Step 3: Rewrite `index.js`**

```js
/**
 * dsh-companion host plugin — thin shell over the shared dsh-voice-core
 * engine, configured generically. Persona identity, voice, and greeting
 * schedule are NOT fixed here (see lib/persona-store.js and friends,
 * landing in later tasks) -- they are per-session, user-configured data.
 *
 * @module dsh-companion
 */
import { applyVoice, VoiceController, VoiceSchedule, TICK_MS } from 'dsh-voice-core'
import { DEFAULT_STYLES, DEFAULT_STYLE } from 'dsh-voice-core'

export const name = 'dsh-companion'

/** Required host services: tool registry and system-prompt assembly. */
export const inject = ['tools', 'systemPrompt']

// Backward-compatible re-exports (kept for callers importing the shared
// engine's classes through this package, same pattern dsh-sister used).
export { VoiceController, VoiceSchedule, TICK_MS }
export const DEFAULT_CHEER_TIMES = ['15:00']

/** Built-in voice quick-picks, offered in the persona config modal
 * alongside the free-text "describe your own voice" option. */
export const COMPANION_STYLES = DEFAULT_STYLES
export const DEFAULT_COMPANION_STYLE = DEFAULT_STYLE

export async function apply(ctx) {
  const controller = await applyVoice(ctx, {
    presetName: 'companion',
    ttsPath: '/dsh-companion/tts',
    ttsBase: process.env.DSH_VOICE_TTS_URL || 'http://127.0.0.1:3091',
    styles: COMPANION_STYLES,
    defaultStyle: DEFAULT_COMPANION_STYLE,
    cheerTimes: DEFAULT_CHEER_TIMES,
    schedulerEnabled: true,
    scheduleName: 'dsh-companion',
    greetingPrompt:
      '（定时问候）现在是下午 3 点。请先用 cheer 工具送上一句温暖的欢迎回家问候，并顺带分享一个有趣的小知识或今天的小新闻（可以用网络搜索），一两句话就好，说完请休息放松。',
  })
  ctx.logger?.info?.(`dsh-companion: activated via dsh-voice-core — daily greetings at ${controller.schedule.times.join(', ')}, fixed text: ${controller.schedule.text ? `"${controller.schedule.text}"` : 'auto'}`)
  // Cordis treats a plugin's `apply` return value as an "effect" (dispose
  // function, promise, or iterable of those) — returning the arbitrary
  // VoiceController object here throws `TypeError: Invalid effect` when the
  // real fiber runner applies this plugin. No return value needed; nothing
  // consumes it.
}
```

- [ ] **Step 4: Rewrite `lib/client.js`**

```js
/**
 * dsh-companion Web client — thin shell over dsh-voice-core's shared voice
 * UI. Composes createVoiceClient with the generic built-in style catalog
 * and TTS proxy path. All audio-queue/streaming/auto-read machinery lives
 * in the core; the persona button/modal (replacing the core's style
 * picker) lands in a later task.
 *
 * @module dsh-companion/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-companion',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var core = require('dsh-voice-core')

    var COMPANION_STYLES = {
      paimon: {
        label: '✨ 派蒙风 — 尖尖脆脆的萝莉音',
        instruct: '体现撒娇稚嫩的萝莉女声，音调偏高且起伏明显，营造出黏人、做作又刻意卖萌的听觉效果。说话语气活泼俏皮，像动画里的小精灵。',
      },
      cute: {
        label: '🌸 软萌可爱',
        instruct: '温柔甜美的少女音，音调柔和偏高，说话软糯撒娇，语气温暖亲切，带着浅浅的笑意。',
      },
      genki: {
        label: '⚡ 元气少女',
        instruct: '活泼元气的高中少女音，清亮明快，语速稍快，充满阳光与干劲，经常带着惊叹和感叹词。',
      },
      onee: {
        label: '🎧 清冷御姐',
        instruct: '清冷柔和的成年女声，御姐音色，语速平缓，语调沉稳优雅，带着淡淡的温柔与从容，听起来可靠又亲切。',
      },
    }

    var voiceClient = core.createVoiceClient({
      presetName: 'companion',
      ttsPath: '/dsh-companion/tts',
      styles: COMPANION_STYLES,
      defaultStyle: 'paimon',
      previewText: '嗨嗨！我是你的新搭档呀～你喜欢我的声音吗？',
    })

    exports.name = voiceClient.name
    exports.inject = voiceClient.inject
    exports.apply = voiceClient.apply
    exports._test = core._test

    return module.exports
  },
})
```

- [ ] **Step 5: Rename `lib/register-events.js`'s exported name**

Change the one string:

```js
export const name = 'dsh-companion/register-events'
```

(the `apply` function body forwarding `coreApply()` is unchanged).

- [ ] **Step 6: Update `cordis.patch.yml`**

```yaml
# dsh-companion bundle patch — INTENTIONALLY EMPTY.
#
# Installing this package into a profile joins the bundle layer but inserts NO
# plugin row, so dsh-companion never activates profile-wide and no existing
# agent sees its tools. It activates only where an explicit row is composed
# — i.e. in an agent preset that opts in (see the "companion" preset: a row
# with `name: dsh-companion`).
#
# To opt a profile in globally (not recommended), uncomment the insert below:
#
# - insert:
#     - id: dsh-companion
#       name: dsh-companion
[]
```

- [ ] **Step 7: Update `test/host-smoke.test.js`**

Apply these string replacements throughout the file (every occurrence):
- `'dsh-sister-home-'` → `'dsh-companion-home-'`
- `join(smokeHomeDir, 'state', 'dsh-sister', ...)` → `join(smokeHomeDir, 'state', 'dsh-companion', ...)` (four occurrences: `'schedule.json'`, `'greet.json'`, `'fixed.json'`, `'roundtrip.json'`)
- `/dsh-sister/tts` → `/dsh-companion/tts` (in the `'registers the TTS proxy routes...'` and `'TTS proxy rejects a request without text'` tests)
- `/dsh-sister/tts-health` → `/dsh-companion/tts-health`

Then **delete** these three tests entirely (the routes/assets they cover no longer exist):
- `'serves the background image at /dsh-sister/background.jpg'`
- `'serves a cheer-audio manifest mapping every DEFAULT_CHEERS entry to a static clip URL'`
- `'serves the pre-baked audio clip for a cheer-bank entry'`

- [ ] **Step 8: Update `test/client-bundle.test.js`**

Apply these string replacements throughout the file (every occurrence):
- `'dsh-voice-sister-speak'` → `'dsh-voice-companion-speak'`
- `'dsh-voice-sister-background'` → `'dsh-voice-companion-background'`
- `'dsh-voice-sister-style-picker'` → `'dsh-voice-companion-style-picker'`
- `presetName: 'sister'` → `presetName: 'companion'`
- `moduleObj.name, 'dsh-voice-core/sister'` → `moduleObj.name, 'dsh-voice-core/companion'`
- `agentPreset: 'sister'` → `agentPreset: 'companion'`
- `'apply registers the speak toggle and style picker'` test's overlay assertion array `['dsh-voice-sister-background', 'dsh-voice-sister-style-picker']` → `['dsh-voice-companion-background', 'dsh-voice-companion-style-picker']`
- `'speak toggle renders only in sister sessions'` test title → `'speak toggle renders only in companion sessions'`

- [ ] **Step 9: Run the test suite**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test 'test/*.test.js'`
Expected: PASS (the deleted asset tests are gone; every remaining test reflects the new names/paths).

- [ ] **Step 10: Reinstall the dependency to pick up Tasks 1–2**

`dsh-voice-core` is a git dependency (`github:Yihong89/dsh-voice-core`, no ref pin). Push the Task 1–2 commits, then refresh the local copy:

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-voice-core
git push origin main
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
pnpm install
node --test 'test/*.test.js'
```

Expected: `pnpm install` pulls the updated `dsh-voice-core`; tests still PASS (this repo doesn't use `resolveInstruct`/`showSpeakToggle`/`showStylePicker` yet — Task 8 does).

- [ ] **Step 11: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
git add -A
git commit -m "$(cat <<'EOF'
rename: dsh-sister -> dsh-companion, drop sister-only background/cheer assets

Mechanical rename of the package identity, preset, and routes to the
generic dsh-companion name ahead of the per-session persona work. Drops
the pre-baked background image and cheer-audio bank -- both only worked
because sister had exactly one fixed voice; arbitrary custom personas
can't be pre-baked, and live streaming TTS already starts in ~1s.

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

---

## Task 4: `dsh-companion` — persona store (per-session read/write/defaults)

**Files:**
- Create: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/lib/persona-store.js`
- Create: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/persona-store.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_PERSONA: { name, personality, voice: { presetKey, instruct }, schedule: { times: [], fired: {} } }`
  - `personaPath(stateDir, sessionId): string`
  - `readPersona(stateDir, sessionId): Persona` — never throws, merges over `DEFAULT_PERSONA`
  - `writePersona(stateDir, sessionId, partial, now?): Persona` — full-replace write of name/personality/voice/schedule.times; preserves `schedule.fired`/`createdAt` across saves
  - `markFired(stateDir, sessionId, day, time): void` — best-effort, appends to `schedule.fired[day]`

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test test/persona-store.test.js`
Expected: FAIL with "Cannot find module '../lib/persona-store.js'".

- [ ] **Step 3: Implement `lib/persona-store.js`**

```js
/**
 * dsh-companion persona store — per-session persona JSON, read/written the
 * same best-effort way dsh-voice-core's VoiceSchedule persists the (now
 * unused, for this plugin) global schedule: corrupt or missing data falls
 * back to defaults instead of throwing.
 *
 * A preset composition mounts once per process and is shared by every
 * session on it (dsh-agent-presets' standing mount) -- persona state can't
 * live in a plugin-apply-time closure, so it's a file per session, read
 * live wherever it's needed (system-prompt render, TTS instruct
 * resolution, the scheduler tick).
 *
 * @module dsh-companion/lib/persona-store
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_STYLES, DEFAULT_STYLE } from 'dsh-voice-core'

export const DEFAULT_PERSONA = Object.freeze({
  name: '小助手',
  personality: '一个温暖、友善的陪伴助手。用简短、真诚的话语回应，偶尔带点关心和鼓励。',
  voice: Object.freeze({ presetKey: DEFAULT_STYLE, instruct: DEFAULT_STYLES[DEFAULT_STYLE].instruct }),
  schedule: Object.freeze({ times: Object.freeze([]), fired: Object.freeze({}) }),
})

export function personaPath(stateDir, sessionId) {
  return join(stateDir, 'personas', `${sessionId}.json`)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function mergeWithDefault(data) {
  const base = clone(DEFAULT_PERSONA)
  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : base.name,
    personality: typeof data.personality === 'string' && data.personality.trim() ? data.personality.trim() : base.personality,
    voice: {
      presetKey: typeof data.voice?.presetKey === 'string' && data.voice.presetKey ? data.voice.presetKey : undefined,
      instruct: typeof data.voice?.instruct === 'string' && data.voice.instruct.trim() ? data.voice.instruct.trim() : base.voice.instruct,
    },
    schedule: {
      times: Array.isArray(data.schedule?.times) ? data.schedule.times.filter((t) => typeof t === 'string') : [],
      fired: data.schedule?.fired && typeof data.schedule.fired === 'object' ? data.schedule.fired : {},
    },
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
  }
}

/** Read one session's persona, merged over DEFAULT_PERSONA. Never throws. */
export function readPersona(stateDir, sessionId) {
  const path = personaPath(stateDir, sessionId)
  try {
    if (!existsSync(path)) return clone(DEFAULT_PERSONA)
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return mergeWithDefault(data)
  } catch (error) {
    return clone(DEFAULT_PERSONA)
  }
}

/** Persist one session's persona (name/personality/voice/schedule.times),
 * preserving schedule.fired and createdAt across saves. Best-effort. */
export function writePersona(stateDir, sessionId, partial, now = Date.now()) {
  const existing = readPersona(stateDir, sessionId)
  const payload = {
    name: String(partial.name ?? existing.name).trim() || DEFAULT_PERSONA.name,
    personality: String(partial.personality ?? existing.personality).trim() || DEFAULT_PERSONA.personality,
    voice: {
      presetKey: partial.voice?.presetKey || undefined,
      instruct: String(partial.voice?.instruct ?? existing.voice.instruct).trim() || DEFAULT_PERSONA.voice.instruct,
    },
    schedule: {
      times: Array.isArray(partial.schedule?.times) ? partial.schedule.times : existing.schedule.times,
      fired: existing.schedule.fired,
    },
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
  }
  const path = personaPath(stateDir, sessionId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(payload, null, 2))
  return payload
}

/** Mark one due time fired today for a session's persona. Best-effort,
 * mirrors VoiceSchedule.markFired's failure handling. */
export function markFired(stateDir, sessionId, day, time) {
  try {
    const persona = readPersona(stateDir, sessionId)
    const fired = { ...persona.schedule.fired }
    fired[day] = [...(fired[day] ?? []), time]
    const payload = { ...persona, schedule: { ...persona.schedule, fired } }
    const path = personaPath(stateDir, sessionId)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(payload, null, 2))
  } catch (error) {
    // best-effort persistence, same as VoiceSchedule.save()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test 'test/*.test.js'`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
git add lib/persona-store.js test/persona-store.test.js
git commit -m "$(cat <<'EOF'
feat: add per-session persona store

Read/write persona JSON (name, personality, voice instruct, greeting
schedule) keyed by session id under $DSH_HOME/state/dsh-companion/personas.
Best-effort persistence and default-merging, same failure handling as
dsh-voice-core's VoiceSchedule. No file yet -> DEFAULT_PERSONA, a small
generic companion, not sister-flavored.

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

---

## Task 5: `dsh-companion` — persona HTTP routes (GET/PATCH)

**Files:**
- Create: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/lib/persona-routes.js`
- Create: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/persona-routes.test.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/index.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/host-smoke.test.js`

**Interfaces:**
- Consumes: `readPersona`, `writePersona` from `./persona-store.js` (Task 4).
- Produces: `registerPersonaRoutes(webServer, stateDir, path, logger)` — registers one `kind: 'exact'` route at `path` (`/dsh-companion/persona`) handling `GET ?sessionId=` (200 + persona JSON) and `PATCH`/`POST` ?sessionId= with a JSON body `{name, personality, voice: {presetKey?, instruct?}, schedule: {times}}` (200 + saved persona JSON, or 400 on missing sessionId / invalid times / missing instruct).

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test test/persona-routes.test.js`
Expected: FAIL with "Cannot find module '../lib/persona-routes.js'".

- [ ] **Step 3: Implement `lib/persona-routes.js`**

```js
/**
 * dsh-companion persona HTTP routes — GET/PATCH the current session's
 * persona, backing the client's config modal.
 *
 * @module dsh-companion/lib/persona-routes
 */
import { parseTimes } from 'dsh-voice-core/lib/voice.js'
import { DEFAULT_STYLES } from 'dsh-voice-core'
import { readPersona, writePersona } from './persona-store.js'

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function registerPersonaRoutes(webServer, stateDir, path, logger) {
  webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (!sessionId) {
        sendJson(res, 400, { ok: false, error: 'sessionId is required' })
        return
      }
      if (req.method === 'GET') {
        sendJson(res, 200, readPersona(stateDir, sessionId))
        return
      }
      if (req.method === 'PATCH' || req.method === 'POST') {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
          return
        }
        let times
        try {
          times = Array.isArray(body.schedule?.times) && body.schedule.times.length > 0
            ? parseTimes(body.schedule.times)
            : []
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message })
          return
        }
        const presetKey = typeof body.voice?.presetKey === 'string' && DEFAULT_STYLES[body.voice.presetKey]
          ? body.voice.presetKey
          : undefined
        const instruct = presetKey
          ? DEFAULT_STYLES[presetKey].instruct
          : String(body.voice?.instruct ?? '').trim()
        if (!instruct) {
          sendJson(res, 400, { ok: false, error: 'voice.instruct or a known voice.presetKey is required' })
          return
        }
        const saved = writePersona(stateDir, sessionId, {
          name: body.name,
          personality: body.personality,
          voice: { presetKey, instruct },
          schedule: { times },
        })
        logger?.info?.(`dsh-companion: persona saved for session ${sessionId}: "${saved.name}"`)
        sendJson(res, 200, saved)
        return
      }
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  })
}
```

- [ ] **Step 4: Run new tests to verify they pass**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test test/persona-routes.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the routes into `index.js`**

Add the import and call. In `index.js`, add to the imports:

```js
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerPersonaRoutes } from './lib/persona-routes.js'
```

Inside `apply(ctx)`, after the `applyVoice(...)` call and its `ctx.logger?.info?.(...)` line, add:

```js
  const stateDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'state', 'dsh-companion')
  const webServer = ctx.get('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    registerPersonaRoutes(webServer, stateDir, '/dsh-companion/persona', ctx.logger)
  }
```

- [ ] **Step 6: Add a host-smoke coverage test for the wired route**

Add to `test/host-smoke.test.js` (near the other `'registers the TTS proxy routes...'` test):

```js
test('registers the persona route when a web server is present', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx({ webServer: true })
  await apply(ctx)
  dispose(ctx)
  const route = registrations.webRoutes.find((r) => r.path === '/dsh-companion/persona')
  assert.ok(route, 'the persona route is registered')
  assert.equal(route.kind, 'exact')
})
```

- [ ] **Step 7: Run the full suite**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test 'test/*.test.js'`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
git add lib/persona-routes.js test/persona-routes.test.js index.js test/host-smoke.test.js
git commit -m "$(cat <<'EOF'
feat: add GET/PATCH persona HTTP endpoint

Backs the client config modal (landing in a later task): GET reads the
current session's persona (falling back to the generic default), PATCH
validates and saves name/personality/voice/schedule.times, resolving a
known style preset key to its instruct or accepting a fully custom one.

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

---

## Task 6: `dsh-companion` — personality reaches the model (system-prompt wiring)

**Files:**
- Create: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/lib/persona-prompt.js`
- Create: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/persona-prompt.test.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/index.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/host-smoke.test.js`

**Interfaces:**
- Consumes: `readPersona` from `./persona-store.js` (Task 4).
- Produces: `registerPersonaPrompt(ctx, stateDir): () => void` — registers an agent-scoped `systemPrompt` section (order 0) rendering `{{companion_persona}}`, and a `systemPrompt.variable('companion_persona', provider)` whose provider resolves the session id from `context.agent.session.id` and returns persona-derived prompt text. Returns a combined dispose function.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test test/persona-prompt.test.js`
Expected: FAIL with "Cannot find module '../lib/persona-prompt.js'".

- [ ] **Step 3: Implement `lib/persona-prompt.js`**

```js
/**
 * dsh-companion persona -> system-prompt wiring. A preset composition
 * mounts once per process and is shared by every session on it, so the
 * persona text can't be baked into a closure at apply() time -- it's
 * resolved live, per assembly, from the session's own persona file.
 *
 * @module dsh-companion/lib/persona-prompt
 */
import { readPersona } from './persona-store.js'

const VARIABLE_NAME = 'companion_persona'
const SECTION_NAME = 'dsh-companion:persona'

export function registerPersonaPrompt(ctx, stateDir) {
  const disposeVariable = ctx.systemPrompt.variable(VARIABLE_NAME, (context) => {
    const sessionId = context?.agent?.session?.id
    if (sessionId === undefined) return undefined
    const persona = readPersona(stateDir, sessionId)
    return `你现在扮演「${persona.name}」。性格设定：${persona.personality}`
  })
  const disposeSection = ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: 0,
    text: `{{${VARIABLE_NAME}}}`,
  })
  return () => {
    disposeVariable()
    disposeSection()
  }
}
```

- [ ] **Step 4: Run new tests to verify they pass**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test test/persona-prompt.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into `index.js`**

Add the import:

```js
import { registerPersonaPrompt } from './lib/persona-prompt.js'
```

Inside `apply(ctx)`, right after the `registerPersonaRoutes(...)` block from Task 5, add:

```js
  registerPersonaPrompt(ctx, stateDir)
```

- [ ] **Step 6: Extend the host-smoke mock context and add coverage**

The mock `ctx.systemPrompt` in `test/host-smoke.test.js` only has `section: () => {}` today — add `variable`:

```js
    systemPrompt: { section: () => {}, variable: () => (() => {}) },
```

Add a new test:

```js
test('registers the persona system-prompt section', async () => {
  const { apply } = await import('../index.js')
  const { ctx } = mockCtx()
  const sections = []
  ctx.systemPrompt = { section: (s) => { sections.push(s); return () => {} }, variable: () => (() => {}) }
  await apply(ctx)
  dispose(ctx)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].order, 0)
  assert.match(sections[0].text, /companion_persona/)
})
```

- [ ] **Step 7: Run the full suite**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test 'test/*.test.js'`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
git add lib/persona-prompt.js test/persona-prompt.test.js index.js test/host-smoke.test.js
git commit -m "$(cat <<'EOF'
feat: render the saved persona into the model's system prompt

Agent-scoped order-0 section resolves {{companion_persona}} live per
assembly (not at plugin-mount time, since a preset composition is shared
by every session on it) from that session's own persona file, falling
back to the generic default for a session that hasn't configured one yet.

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

---

## Task 7: `dsh-companion` — per-session greeting scheduler

Replaces `dsh-voice-core`'s built-in *global* scheduler (one set of times shared by every session on the preset) with a per-session one, since "cron job for the persona" means each persona has its own times. `dsh-voice-core` itself is not modified — `dsh-teacher` is unaffected.

**Files:**
- Create: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/lib/persona-scheduler.js`
- Create: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/persona-scheduler.test.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/index.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/host-smoke.test.js`

**Interfaces:**
- Consumes: `readPersona`, `markFired` from `./persona-store.js` (Task 4); `dateKey`, `dueTimes`, `pickCheer` from `dsh-voice-core/lib/voice.js`; `DEFAULT_CHEERS` from `dsh-voice-core`; a `VoiceController`-shaped object with `.sessions: Map<sessionId, {agent}>` and `.appendCheer(agent, text)` (from `applyVoice`'s return value).
- Produces: `createPersonaScheduler(ctx, controller, stateDir): { tick(): Promise<number>, start(): void, stop(): void }`. `tick()` returns the count of greetings actually fired.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test test/persona-scheduler.test.js`
Expected: FAIL with "Cannot find module '../lib/persona-scheduler.js'".

- [ ] **Step 3: Implement `lib/persona-scheduler.js`**

```js
/**
 * dsh-companion per-session greeting scheduler. dsh-voice-core's own
 * scheduler is global (one set of times shared by every session on the
 * preset) -- this plugin disables that (schedulerEnabled: false) and runs
 * its own tick loop keyed by each tracked session's OWN persona file, so
 * "cron job for the persona" means each persona really does have its own
 * times. dsh-voice-core itself is untouched; dsh-teacher is unaffected.
 *
 * @module dsh-companion/lib/persona-scheduler
 */
import { dateKey, dueTimes, pickCheer } from 'dsh-voice-core/lib/voice.js'
import { DEFAULT_CHEERS } from 'dsh-voice-core'
import { readPersona, markFired } from './persona-store.js'

export const TICK_MS = 30_000

export function createPersonaScheduler(ctx, controller, stateDir) {
  let timer = null

  async function greet(agent, persona) {
    const prompt = `（定时问候）请以「${persona.name}」的身份，按这段人设说话：${persona.personality}\n先用 cheer 工具送上一句温暖的问候，一两句话就好。`
    if (agent !== undefined && typeof agent.followup === 'function') {
      try {
        agent.followup({
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'plugin', plugin: 'dsh-companion' },
        })
        return true
      } catch (error) {
        ctx.logger?.warn?.(`dsh-companion: greet followup failed: ${error}`)
      }
    }
    return controller.appendCheer(agent, pickCheer(DEFAULT_CHEERS))
  }

  async function tick() {
    const now = new Date()
    const day = dateKey(now)
    let fired = 0
    for (const [sessionId, { agent }] of controller.sessions) {
      const persona = readPersona(stateDir, sessionId)
      const times = persona.schedule.times
      if (times.length === 0) continue
      const already = new Set(persona.schedule.fired[day] ?? [])
      const due = dueTimes(times, now, already)
      for (const time of due) {
        if (await greet(agent, persona)) fired++
        markFired(stateDir, sessionId, day, time)
      }
    }
    return fired
  }

  function start() {
    if (timer !== null) return
    timer = setInterval(() => {
      tick().catch((error) => ctx.logger?.warn?.(`dsh-companion: scheduler tick failed: ${error}`))
    }, TICK_MS)
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return { tick, start, stop }
}
```

- [ ] **Step 4: Run new tests to verify they pass**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test test/persona-scheduler.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into `index.js`**

Add the import:

```js
import { createPersonaScheduler } from './lib/persona-scheduler.js'
```

Change the `applyVoice(...)` call's config to disable the core's own scheduler:

```js
  const controller = await applyVoice(ctx, {
    presetName: 'companion',
    ttsPath: '/dsh-companion/tts',
    ttsBase: process.env.DSH_VOICE_TTS_URL || 'http://127.0.0.1:3091',
    styles: COMPANION_STYLES,
    defaultStyle: DEFAULT_COMPANION_STYLE,
    schedulerEnabled: false,
  })
```

(drop `cheerTimes`, `scheduleName`, and `greetingPrompt` from that config object — they configured the now-disabled global scheduler; `DEFAULT_CHEER_TIMES` export can be removed from `index.js` too, since nothing reads it anymore).

Right after the `registerPersonaPrompt(ctx, stateDir)` line, add:

```js
  const scheduler = createPersonaScheduler(ctx, controller, stateDir)
  scheduler.start()
  ctx.on('dispose', () => scheduler.stop())
```

- [ ] **Step 6: Update `test/host-smoke.test.js` for the disabled global scheduler**

The existing tests `'scheduler fires one cheer per due time per day...'`, `'greet nudges the sister via followup...'`, `'fixed cheer text is spoken verbatim...'`, `'schedule round-trips to disk...'`, and `'cheer-at validates and persists times'` all exercise `dsh-voice-core`'s own `VoiceController`/`VoiceSchedule` and the `/cheer-at`/`/cheer-text` commands directly (not through `dsh-companion`'s `apply()`), so they still pass unchanged — they test the shared engine's classes, which Task 7 doesn't modify. Leave them as-is.

Add one new test confirming the plugin's own scheduler is what's actually running:

```js
test('the plugin runs its own per-session scheduler (core global scheduler disabled)', async () => {
  const { apply } = await import('../index.js')
  const { ctx, registrations } = mockCtx()
  await apply(ctx)
  // dispose() must stop the plugin's own scheduler interval without throwing.
  assert.doesNotThrow(() => dispose(ctx))
})
```

- [ ] **Step 7: Run the full suite**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test 'test/*.test.js'`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
git add lib/persona-scheduler.js test/persona-scheduler.test.js index.js test/host-smoke.test.js
git commit -m "$(cat <<'EOF'
feat: per-session greeting schedule, replacing the shared global scheduler

dsh-voice-core's scheduler is one set of times shared by every session on
the preset -- doesn't fit "cron job for the persona" (each persona has its
own). Disables it (schedulerEnabled: false) and runs a small tick loop
keyed by each tracked session's own persona.schedule.times/fired, firing a
persona-flavored greeting into just that session. dsh-voice-core itself is
untouched, so dsh-teacher is unaffected.

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

---

## Task 8: `dsh-companion` — client persona button + config modal

Replaces the old style-picker UI entirely: a button beside the session title opens a modal with name, personality, voice (presets + custom text), and schedule times.

**Files:**
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/lib/client.js`
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/test/client-bundle.test.js`

**Interfaces:**
- Consumes: `core.createVoiceClient(opts)` from `dsh-voice-core` with the Task 1/2 additions: `opts.resolveInstruct`, `opts.showSpeakToggle: false`, `opts.showStylePicker: false`.
- Produces: the exported plugin registers `PersonaButton` into `conversation.session.header.actions` (gated to `presetName === 'companion'`, mirrors dsh-voice-core's own preset-gating pattern) and `PersonaModal` into `shell.overlay`. `exports._test` gains `fetchPersona`, `savePersona`, `resolveInstruct`, `DEFAULT_PERSONA`, `STYLES` for direct unit coverage.

- [ ] **Step 1: Write the failing tests**

Add to `test/client-bundle.test.js` (this file already has `loadBundle()`/`mockSlots()` helpers from Task 3's rename — reuse them):

```js
test('registers the persona button in the session header and the modal in shell.overlay (no style picker)', () => {
  const { moduleObj } = loadBundle()
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
  const { moduleObj } = loadBundle()
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
  const { moduleObj } = loadBundle()
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
  const { moduleObj } = loadBundle()
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
  const { moduleObj } = loadBundle()
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test test/client-bundle.test.js`
Expected: FAIL (`conversation.session.header.actions` slot never registered; `moduleObj._test` lacks `fetchPersona`/`savePersona`/`resolveInstruct`/`DEFAULT_PERSONA`).

- [ ] **Step 3: Rewrite `lib/client.js`**

```js
/**
 * dsh-companion Web client — persona button + config modal, replacing the
 * shared core's style picker entirely (this plugin passes
 * showStylePicker/showSpeakToggle: false). resolveInstruct makes the
 * actual auto-read TTS use THIS session's saved voice, not a static
 * default (see dsh-voice-core Task 1).
 *
 * @module dsh-companion/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-companion',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var core = require('dsh-voice-core')

    function h(type, props) {
      var children = Array.prototype.slice.call(arguments, 2)
      return React.createElement.apply(React, [type, props].concat(children))
    }

    var TTS_PATH = '/dsh-companion/tts'
    var PERSONA_PATH = '/dsh-companion/persona'
    var PRESET_NAME = 'companion'

    var STYLES = {
      paimon: { label: '✨ 派蒙风', instruct: '体现撒娇稚嫩的萝莉女声，音调偏高且起伏明显，营造出黏人、做作又刻意卖萌的听觉效果。说话语气活泼俏皮，像动画里的小精灵。' },
      cute: { label: '🌸 软萌可爱', instruct: '温柔甜美的少女音，音调柔和偏高，说话软糯撒娇，语气温暖亲切，带着浅浅的笑意。' },
      genki: { label: '⚡ 元气少女', instruct: '活泼元气的高中少女音，清亮明快，语速稍快，充满阳光与干劲，经常带着惊叹和感叹词。' },
      onee: { label: '🎧 清冷御姐', instruct: '清冷柔和的成年女声，御姐音色，语速平缓，语调沉稳优雅，带着淡淡的温柔与从容，听起来可靠又亲切。' },
    }
    var DEFAULT_PERSONA = {
      name: '小助手',
      personality: '一个温暖、友善的陪伴助手。用简短、真诚的话语回应，偶尔带点关心和鼓励。',
      voice: { presetKey: 'paimon', instruct: STYLES.paimon.instruct },
      schedule: { times: [] },
    }

    // ---- persona fetch cache (sessionId -> persona) -------------------------
    var personaCache = {}
    var personaListeners = []
    function emitPersona() { for (var i = 0; i < personaListeners.length; i++) personaListeners[i]() }
    function subscribePersona(fn) {
      personaListeners.push(fn)
      return function () {
        var at = personaListeners.indexOf(fn)
        if (at >= 0) personaListeners.splice(at, 1)
      }
    }
    function fetchPersona(sessionId) {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve(DEFAULT_PERSONA)
      return fetch(PERSONA_PATH + '?sessionId=' + encodeURIComponent(sessionId))
        .then(function (res) { return res.ok ? res.json() : DEFAULT_PERSONA })
        .then(function (persona) {
          personaCache[sessionId] = persona
          emitPersona()
          return persona
        })
        .catch(function () { return DEFAULT_PERSONA })
    }
    function savePersona(sessionId, persona) {
      return fetch(PERSONA_PATH + '?sessionId=' + encodeURIComponent(sessionId), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(persona),
      })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('save failed: ' + res.status)) })
        .then(function (saved) {
          personaCache[sessionId] = saved
          emitPersona()
          return saved
        })
    }
    /** Per-session TTS instruct for the auto-read path — see dsh-voice-core's
     * opts.resolveInstruct (Task 1). Kicks off a background fetch on a cold
     * cache so the NEXT call is warm; returns a safe default meanwhile. */
    function resolveInstruct(sessionId) {
      var cached = personaCache[sessionId]
      if (cached !== undefined) return cached.voice.instruct
      fetchPersona(sessionId)
      return DEFAULT_PERSONA.voice.instruct
    }

    // ---- modal open/close: which session is being configured ----------------
    var modalStore = { open: false, sessionId: null, listeners: [] }
    function setModalOpen(open, sessionId) {
      modalStore.open = open
      modalStore.sessionId = sessionId || null
      for (var i = 0; i < modalStore.listeners.length; i++) modalStore.listeners[i]()
    }
    function subscribeModal(fn) {
      modalStore.listeners.push(fn)
      return function () {
        var at = modalStore.listeners.indexOf(fn)
        if (at >= 0) modalStore.listeners.splice(at, 1)
      }
    }

    var CARD = {
      border: '1px solid var(--dsw-border-color, rgba(128,128,128,.25))',
      borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
      background: 'var(--dsw-alias-bg-overlay, var(--dsw-surface-color, #ffffff))',
      boxShadow: '0 8px 30px rgba(0,0,0,.25)',
    }

    // ---- PersonaButton: conversation.session.header.actions -----------------
    function makePersonaButton(presetName) {
      return function PersonaButton(props) {
        var sessionId = props.sessionId
        var preset = sessionId !== undefined && typeof props.useSessions === 'function'
          ? props.useSessions(function (s) { return s.byId[sessionId] && s.byId[sessionId].agentPreset })
          : undefined
        var state = React.useState(sessionId !== undefined ? personaCache[sessionId] : undefined)
        React.useEffect(function () {
          return subscribePersona(function () { state[1](personaCache[sessionId]) })
        }, [sessionId])
        React.useEffect(function () {
          if (sessionId !== undefined && personaCache[sessionId] === undefined) fetchPersona(sessionId)
        }, [sessionId])
        if (preset !== presetName) return null
        var persona = state[0] || DEFAULT_PERSONA
        return h('button', {
          onClick: function () { setModalOpen(true, sessionId) },
          title: '配置这个会话的搭档人设与声音',
          'aria-label': 'configure companion persona',
          style: {
            background: 'none', border: '1px solid var(--dsw-border-color, rgba(128,128,128,.25))',
            borderRadius: 6, cursor: 'pointer', fontSize: 12, padding: '2px 8px',
            color: 'var(--dsw-text-color, inherit)', marginLeft: 6,
          },
        }, '👤 ' + persona.name)
      }
    }

    // ---- PersonaModal: shell.overlay -----------------------------------------
    function PersonaModal() {
      var openState = React.useState(modalStore.open)
      var sessionState = React.useState(modalStore.sessionId)
      React.useEffect(function () {
        return subscribeModal(function () {
          openState[1](modalStore.open)
          sessionState[1](modalStore.sessionId)
        })
      }, [])
      var sessionId = sessionState[0]
      var draftState = React.useState(null)
      var busyState = React.useState(false)
      var previewState = React.useState(null)
      React.useEffect(function () {
        if (!openState[0] || !sessionId) return
        var base = personaCache[sessionId] || DEFAULT_PERSONA
        draftState[1]({
          name: base.name,
          personality: base.personality,
          presetKey: base.voice.presetKey || null,
          customInstruct: base.voice.presetKey ? '' : base.voice.instruct,
          times: (base.schedule && base.schedule.times ? base.schedule.times : []).slice(),
        })
      }, [openState[0], sessionId])
      if (!openState[0] || draftState[0] === null) return null
      var draft = draftState[0]

      function setDraft(patch) { draftState[1](Object.assign({}, draft, patch)) }
      function preview(instruct) {
        previewState[1]('loading')
        fetch(TTS_PATH + '?text=' + encodeURIComponent('嗨，我是你的新搭档！') + '&instruct=' + encodeURIComponent(instruct))
          .then(function (res) { if (!res.ok) throw new Error('tts ' + res.status); return res.blob() })
          .then(function (blob) {
            var url = URL.createObjectURL(blob)
            new Audio(url).play().catch(function () {})
            previewState[1](null)
          })
          .catch(function () { previewState[1](null) })
      }
      function addTime() { setDraft({ times: draft.times.concat(['08:00']) }) }
      function setTime(i, value) {
        var next = draft.times.slice()
        next[i] = value
        setDraft({ times: next })
      }
      function removeTime(i) {
        var next = draft.times.slice()
        next.splice(i, 1)
        setDraft({ times: next })
      }
      function save() {
        busyState[1](true)
        var instruct = draft.presetKey ? STYLES[draft.presetKey].instruct : draft.customInstruct
        savePersona(sessionId, {
          name: draft.name,
          personality: draft.personality,
          voice: { presetKey: draft.presetKey || undefined, instruct: instruct },
          schedule: { times: draft.times },
        })
          .then(function () { busyState[1](false); setModalOpen(false) })
          .catch(function () { busyState[1](false) })
      }

      var styleRows = Object.keys(STYLES).map(function (key) {
        var active = draft.presetKey === key
        return h('button', {
          key: key, type: 'button',
          onClick: function () { setDraft({ presetKey: key }); preview(STYLES[key].instruct) },
          style: {
            display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', marginBottom: 4, borderRadius: 6, cursor: 'pointer',
            border: active ? '2px solid #f39c12' : '1px solid var(--dsw-border-color, rgba(128,128,128,.25))',
            background: 'var(--dsw-surface-color, transparent)', color: 'var(--dsw-text-color, inherit)', fontSize: 13,
          },
        }, (active ? '✓ ' : '') + STYLES[key].label)
      })

      return h(React.Fragment, null,
        h('div', { style: { position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,.35)' }, onClick: function () { setModalOpen(false) } }),
        h('div', { style: { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 1000, width: 'min(560px, 94vw)' } },
          h('div', { style: Object.assign({}, CARD, { maxHeight: '86vh', overflow: 'auto' }) },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              h('span', { style: { fontWeight: 600 } }, '👤 配置搭档'),
              h('button', { onClick: function () { setModalOpen(false) }, style: { background: 'none', border: 'none', cursor: 'pointer' } }, '✕'),
            ),
            h('label', { style: { display: 'block', fontSize: 12, marginBottom: 4 } }, '名字'),
            h('input', { value: draft.name, onChange: function (e) { setDraft({ name: e.target.value }) }, style: { width: '100%', marginBottom: 10, padding: 6, borderRadius: 6 } }),
            h('label', { style: { display: 'block', fontSize: 12, marginBottom: 4 } }, '性格设定'),
            h('textarea', { value: draft.personality, onChange: function (e) { setDraft({ personality: e.target.value }) }, rows: 3, style: { width: '100%', marginBottom: 10, padding: 6, borderRadius: 6 } }),
            h('label', { style: { display: 'block', fontSize: 12, marginBottom: 4 } }, '声音 — 点一下试听'),
            styleRows,
            h('button', {
              type: 'button', onClick: function () { setDraft({ presetKey: null }) },
              style: {
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', marginBottom: 4, borderRadius: 6, cursor: 'pointer',
                border: !draft.presetKey ? '2px solid #f39c12' : '1px solid var(--dsw-border-color, rgba(128,128,128,.25))',
                background: 'var(--dsw-surface-color, transparent)', color: 'var(--dsw-text-color, inherit)', fontSize: 13,
              },
            }, (!draft.presetKey ? '✓ ' : '') + '🎨 自定义 — 用文字描述声音'),
            !draft.presetKey ? h('textarea', {
              value: draft.customInstruct, placeholder: '例如：低沉沙哑的男声，语速缓慢，带一点疲惫感',
              onChange: function (e) { setDraft({ customInstruct: e.target.value }) },
              rows: 2, style: { width: '100%', marginBottom: 10, padding: 6, borderRadius: 6 },
            }) : null,
            !draft.presetKey && draft.customInstruct ? h('button', {
              type: 'button', onClick: function () { preview(draft.customInstruct) },
              style: { fontSize: 12, marginBottom: 10, cursor: 'pointer' },
            }, previewState[0] === 'loading' ? '⏳ 生成中…' : '▶ 试听') : null,
            h('label', { style: { display: 'block', fontSize: 12, marginBottom: 4 } }, '每日问候时间'),
            draft.times.map(function (t, i) {
              return h('div', { key: i, style: { display: 'flex', gap: 6, marginBottom: 4 } },
                h('input', { type: 'time', value: t, onChange: function (e) { setTime(i, e.target.value) } }),
                h('button', { type: 'button', onClick: function () { removeTime(i) } }, '✕'),
              )
            }),
            h('button', { type: 'button', onClick: addTime, style: { fontSize: 12, marginBottom: 10, cursor: 'pointer' } }, '+ 添加时间'),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
              h('button', { type: 'button', onClick: function () { setModalOpen(false) } }, '取消'),
              h('button', { type: 'button', disabled: busyState[0], onClick: save }, busyState[0] ? '保存中…' : '保存'),
            ),
          ),
        ),
      )
    }

    var PersonaButton = makePersonaButton(PRESET_NAME)

    exports.name = 'dsh-companion'
    exports.inject = ['slots', 'conversation']
    exports.apply = function (ctx) {
      var voiceClient = core.createVoiceClient({
        presetName: PRESET_NAME,
        ttsPath: TTS_PATH,
        styles: STYLES,
        defaultStyle: 'paimon',
        previewText: '嗨嗨！我是你的新搭档呀～',
        resolveInstruct: resolveInstruct,
        showSpeakToggle: false,
        showStylePicker: false,
      })
      voiceClient.apply(ctx)
      var slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('conversation.session.header.actions', function () {
        return slots.register({ name: 'conversation.session.header.actions', id: 'dsh-companion-persona-button', order: 10 }, PersonaButton)
      })
      slots.inject('shell.overlay', function () {
        return slots.register({ name: 'shell.overlay', id: 'dsh-companion-persona-modal', order: 46 }, PersonaModal)
      })
    }
    exports._test = { fetchPersona: fetchPersona, savePersona: savePersona, resolveInstruct: resolveInstruct, DEFAULT_PERSONA: DEFAULT_PERSONA, STYLES: STYLES }

    return module.exports
  },
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test 'test/*.test.js'`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
git add lib/client.js test/client-bundle.test.js
git commit -m "$(cat <<'EOF'
feat: persona button + config modal, replacing the style picker

Button moves to the session header (beside the title), opens a modal for
name, free-text personality, voice (4 built-in presets + a fully custom
text description), and daily greeting times. Wires dsh-voice-core's new
resolveInstruct/showSpeakToggle/showStylePicker options so auto-read
actually uses this session's saved voice and neither of the core's own
composer-row icons render.

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

---

## Task 9: Final polish — README, and a usable `companion` preset

**Files:**
- Modify: `/Users/yihongzhang/Documents/claude-workspace/dsh-sister/README.md`
- Create: `~/.dsh/.agent-presets/companion/agent.cordis.yml`

**Interfaces:** none (documentation + local environment scaffolding).

- [ ] **Step 1: Rewrite `README.md`**

```markdown
# dsh-companion

一个完全可自定义的陪伴 Agent（DeepSeek Harness 插件）——名字、性格、声音都由你
在对话里配置，不需要 fork 仓库或发布新包。声音由 **Qwen3-TTS**（本地部署在
mac mini 上）生成，浏览器播放——跨平台（macOS / Windows / Chrome / Edge /
Safari），无需服务器 TTS 或 API key。

> 任意人设 · 任意声音 · 每日定时打气 · 零构建

## 亮点

- **会话内配置**：会话标题旁的 👤 按钮打开配置窗口——填名字、性格设定，选一个
  内置音色（点击试听）或直接用文字描述一个全新的声音，Qwen3-TTS 会按你的描述
  生成。保存立刻生效，不用重启。
- **每个会话独立**：人设按会话保存，不同会话可以是完全不同的搭档。
- **自动朗读每一句回复**：搭档每次回话都会说出口。
- **`speak` / `cheer` 模型工具**：搭档可随时要求把某句念出来，或弹出 💛 打气卡片。
- **每个搭档自己的定时问候**：在配置窗口里加一个或多个时间（HH:MM），到点会
  用这个搭档的人设生成一句问候，只送进这一个会话。

## 架构

```
浏览器 (dsh web GUI)                 mac mini (dsh host)
┌─────────────────────┐   /dsh-companion/tts     ┌──────────────────────────┐
│  client.js            │ ───────────────────────► │ dsh-companion 插件 (Node) │
│  fetch WAV → <audio>  │                          │  代理 → 127.0.0.1:3091   │
└─────────────────────┘                          └──────────┬───────────────┘
                                                            │ http
                                              ┌─────────────▼─────────────┐
                                              │ tts_service.py (FastAPI)  │
                                              │ Qwen3-TTS-12Hz-1.7B-      │
                                              │ VoiceDesign (MPS)         │
                                              └───────────────────────────┘
```

人设/声音/问候时间存在 `$DSH_HOME/state/dsh-companion/personas/<sessionId>.json`，
按会话读写；系统提示词按会话动态渲染（一个 preset composition 每进程只挂载
一次，被所有会话共享，所以人设不能写死在插件启动时的闭包里）。

## 安装

### 1. mac mini 上部署 TTS 服务（只需一次）

```bash
brew install portaudio ffmpeg sox
/usr/local/bin/python3.12 -m venv ~/qwen-tts-venv
~/qwen-tts-venv/bin/pip install -U qwen-tts
# 把 tts_service.py 放到 ~/tts_service.py，然后：
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dsh.sister-tts.plist
```

### 2. 安装插件

```bash
dsh plugin --profile web add github:Yihong89/dsh-sister
```

Bundle patch 有意为空——插件只在预设里显式写了 `name: dsh-companion` 行时才
激活（即 `companion` 预设 `~/.dsh/.agent-presets/companion/agent.cordis.yml`）。

### 3. 创建 `companion` 预设

`~/.dsh/.agent-presets/companion/agent.cordis.yml`：

```yaml
- insert:
    - id: dsh-companion
      name: dsh-companion
```

用这个预设新建会话后，点会话标题旁的 👤 按钮即可开始配置。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/speak on\|off` | 开关自动朗读 |
| `/speak <text>` | 立刻把文字念出来 |
| `/cheer [text]` | 立刻送一句打气（朗读 + 💛 卡片）；不写文字用内置语库 |

## 测试

```bash
node --test test/*.test.js
```

## License

MIT
```

- [ ] **Step 2: Create the `companion` agent preset**

```bash
mkdir -p ~/.dsh/.agent-presets/companion
cat > ~/.dsh/.agent-presets/companion/agent.cordis.yml <<'EOF'
- insert:
    - id: dsh-companion
      name: dsh-companion
EOF
```

- [ ] **Step 3: Verify the full suite still passes after the README change**

Run: `cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister && node --test 'test/*.test.js'`
Expected: PASS (README-only change in this repo; the preset file lives outside the repo under `~/.dsh`).

- [ ] **Step 4: Commit**

```bash
cd /Users/yihongzhang/Documents/claude-workspace/dsh-sister
git add README.md
git commit -m "$(cat <<'EOF'
docs: rewrite README for the generic dsh-companion persona system

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014SAp4ExzYJzUNJcUxSdN8i
EOF
)"
```

(the `~/.dsh/.agent-presets/companion/` preset directory created in Step 2 is local machine state, not part of the git repo — nothing to commit there.)

---

## Manual verification (after all tasks)

1. Restart (or reload) the `dsh` web host so it picks up the new `dsh-companion` bundle and the `companion` preset.
2. Start a new session against the `companion` preset.
3. Click the 👤 button beside the session title. Confirm it shows "小助手" (the generic default) before any save.
4. Fill in a name, a personality description, pick a built-in voice preset, click it to preview, then switch to "🎨 自定义" and type a custom voice description, preview that too. Add one daily greeting time a couple of minutes in the future. Save.
5. Send a message and confirm the reply is spoken in the just-configured custom voice (not the old default 派蒙 voice).
6. Ask the model something that reveals its persona (e.g. "你是谁？") and confirm it answers in character with the name/personality just configured.
7. Wait for the configured greeting time; confirm a greeting fires into this session only (open a second `companion` session with a different/no schedule and confirm it does NOT also get a greeting at that time).
8. Confirm the composer row no longer shows a 🎤 or 🔊 icon.
