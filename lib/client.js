/**
 * dsh-sister Web client (hand-rolled module-loader bundle).
 *
 * A classic script registering with the web shell through
 * `window.__ModuleLoader__.load({ id, factory })`. Only `react` is imported;
 * no JSX, no TypeScript, no build step — plain `React.createElement`.
 *
 * Registers:
 *  - `conversation.input.right` "speak" toggle (🔊) — gates to sister-agent
 *    sessions (isSisterSession: `useSessions` agentPreset === 'sister').
 *  - `shell.overlay` cheer chip — a small floating card that appears when a
 *    cheer is fired (scheduled daily / /cheer / the cheer tool) and fades out.
 *
 * Speech: the browser's built-in Web Speech API plays on the USER'S machine —
 * cross-platform (macOS, Windows, Chrome, Edge, Safari), no server TTS. The
 * client auto-reads EVERY assistant reply aloud (1s beat so the text shows
 * first), honors explicit speak requests from the `sisterSpeak` projection,
 * and prefers soft female English voices.
 *
 * @module dsh-sister/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-sister',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')

    // ---- tiny shared store: cheer chip + voice picker + latest projection --
    var store = { cheer: null, sessionId: undefined, voiceOpen: false, listeners: [] }
    /** The plugin's apply() context, captured for component-side host calls. */
    var pluginCtx = null
    function emit() {
      for (var i = 0; i < store.listeners.length; i++) store.listeners[i]()
    }
    function subscribe(fn) {
      store.listeners.push(fn)
      return function () {
        var at = store.listeners.indexOf(fn)
        if (at >= 0) store.listeners.splice(at, 1)
      }
    }
    function setStoreVoiceOpen(open) {
      store.voiceOpen = open
      emit()
    }

    // ---- helpers -----------------------------------------------------------
    function h(type, props) {
      var children = Array.prototype.slice.call(arguments, 2)
      return React.createElement.apply(React, [type, props].concat(children))
    }

    // ---- styles (theme-variable driven) ------------------------------------
    var PANEL_CARD = {
      border: '1px solid var(--dsw-border-color, rgba(128,128,128,.25))',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 13,
      lineHeight: 1.5,
      background: 'var(--dsw-alias-bg-overlay, var(--dsw-surface-color, #ffffff))',
      boxShadow: '0 8px 30px rgba(0,0,0,.25)',
    }

    // ---- TTS ---------------------------------------------------------------
    // Browser voice lists load ASYNCHRONOUSLY: Chrome/Safari return [] from
    // getVoices() until a 'voiceschanged' event arrives. If the sister speaks
    // before that, the utterance falls back to the OS default — often a MALE
    // voice. We cache the list, refresh on 'voiceschanged', and queue any
    // early speech until voices are ready (falling back to the default only
    // after a short timeout so text is never dropped silently).
    var voiceCache = []
    var voiceCacheReady = false
    var pendingSpeaks = []
    var flushTimer = null

    // Soft/cute FEMALE voice preference, BEST FIRST. Chinese soft-girl voices
    // lead (the sister is Chinese-first); English soft female follows.
    var ZH_SOFT_VOICES = [
      // Windows / Edge natural Chinese female
      'xiaoxiao', 'xiaoyi',
      // macOS classic Chinese female
      'tingting', 'ting-ting', 'yu-shu', 'meijia', 'sinji',
      // macOS newer natural female Chinese variants
      'sandy (chinese', 'shelley (chinese', 'flo (chinese',
    ]
    var EN_SOFT_VOICES = [
      // macOS classics (soft female)
      'samantha', 'victoria', 'karen', 'moira', 'tessa', 'catherine', 'kathy',
      'nicky', 'martha', 'serena',
      // macOS newer natural female (Sandy/Shelley/Flo US/GB)
      'sandy (english (united states))', 'sandy (english (united kingdom))',
      'shelley (english (united states))', 'shelley (english (united kingdom))',
      'flo (english (united states))', 'flo (english (united kingdom))',
      // Windows / Edge natural female
      'zira', 'aria', 'jenny', 'libby', 'sonia', 'google us english',
      'google uk english female', 'microsoft aria', 'microsoft jenny',
      'microsoft libby', 'microsoft sonia', 'microsoft zira',
    ]

    var VOICE_PREF_KEY = 'dsh-sister.voice'
    function savedVoicePref() {
      try {
        return window.localStorage.getItem(VOICE_PREF_KEY)
      } catch (e) {
        return null
      }
    }
    function saveVoicePref(name) {
      try {
        window.localStorage.setItem(VOICE_PREF_KEY, name)
      } catch (e) {}
    }
    function refreshVoiceCache() {
      try {
        if (typeof window === 'undefined' || typeof window.speechSynthesis !== 'object') return
        var all = window.speechSynthesis.getVoices()
        if (Array.isArray(all) && all.length > 0) {
          voiceCache = all
          voiceCacheReady = true
          flushPendingSpeaks()
        }
      } catch (e) {}
    }
    // Kick off the async load and refresh when it arrives.
    try {
      refreshVoiceCache()
      if (typeof window.speechSynthesis === 'object') {
        if (typeof window.speechSynthesis.addEventListener === 'function') {
          window.speechSynthesis.addEventListener('voiceschanged', refreshVoiceCache)
        } else {
          window.speechSynthesis.onvoiceschanged = refreshVoiceCache
        }
      }
    } catch (e) {}

    /** All voices whose lang starts with the wanted prefix (cached). */
    function voicesFor(wantLang) {
      return voiceCache.filter(function (v) { return v && v.lang && v.lang.toLowerCase().indexOf(wantLang) === 0 })
    }
    /** First pool voice whose name contains the given substring (case-insensitive). */
    function findByName(pool, needle) {
      var n = needle.toLowerCase()
      for (var i = 0; i < pool.length; i++) {
        if (String(pool[i].name || '').toLowerCase().indexOf(n) !== -1) return pool[i]
      }
      return null
    }
    /** Pick the cutest available voice for the wanted language. */
    function pickVoice(wantLang) {
      var pool = voicesFor(wantLang)
      var prefs = wantLang === 'zh' ? ZH_SOFT_VOICES : EN_SOFT_VOICES
      if (pool.length === 0) {
        // Chinese text with no zh voices? fall back to en female; en → zh.
        var fallbackLang = wantLang === 'zh' ? 'en' : 'zh'
        pool = voicesFor(fallbackLang)
        prefs = fallbackLang === 'zh' ? ZH_SOFT_VOICES : EN_SOFT_VOICES
      }
      if (pool.length === 0) return null
      // A user-locked voice wins (the picker panel stores it).
      var saved = savedVoicePref()
      if (saved !== null) {
        var bySaved = findByName(pool, saved)
        if (bySaved !== null) return bySaved
      }
      // Best soft name first.
      for (var j = 0; j < prefs.length; j++) {
        var found = findByName(pool, prefs[j])
        if (found !== null) return found
      }
      return pool[0]
    }
    /** The next voice in the current language pool (for the cycle button). */
    function nextVoice(wantLang, currentName) {
      var pool = voicesFor(wantLang)
      if (pool.length === 0) return null
      var start = 0
      if (currentName !== null && currentName !== undefined) {
        for (var i = 0; i < pool.length; i++) {
          if (pool[i].name === currentName) {
            start = (i + 1) % pool.length
            break
          }
        }
      }
      return pool[start]
    }

    /** Strip markdown-ish markup so the speech is clean prose. */
    function speakable(text) {
      return String(text)
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    /** Actually hand a cleaned utterance to the Web Speech API. */
    function speakNow(text, forcedVoice) {
      if (typeof window === 'undefined' || typeof window.speechSynthesis !== 'object') return
      try {
        window.speechSynthesis.cancel()
        var utter = new window.SpeechSynthesisUtterance(text)
        var isChinese = /[\u4e00-\u9fff]/.test(text)
        utter.lang = isChinese ? 'zh-CN' : 'en-US'
        var voice = forcedVoice || pickVoice(isChinese ? 'zh' : 'en')
        if (voice !== null) {
          utter.voice = voice
          if (voice.lang) utter.lang = voice.lang
        }
        // Soft, cute delivery: a touch slower, brighter pitch.
        utter.rate = 0.95
        utter.pitch = 1.15
        window.speechSynthesis.speak(utter)
      } catch (e) {}
    }
    /** Flush queued early speech once voices arrive (or after the timeout). */
    function flushPendingSpeaks() {
      if (pendingSpeaks.length === 0) return
      if (!voiceCacheReady && flushTimer === null) {
        // Voices still absent — fall back to the default after a short beat
        // rather than dropping the speech entirely.
        flushTimer = setTimeout(function () {
          flushTimer = null
          voiceCacheReady = true // speak with whatever exists (default voice)
          flushPendingSpeaks()
        }, 1200)
        return
      }
      var batch = pendingSpeaks
      pendingSpeaks = []
      for (var i = 0; i < batch.length; i++) {
        speakNow(batch[i].text, batch[i].voice)
      }
    }

    /** Speak text with the browser's built-in TTS (sound on the user's own
     * machine). Picks the cutest female voice for the text's language, with a
     * slightly slower rate and a brighter pitch for a soft, cute delivery.
     * @param text - the text to speak.
     * @param forcedVoice - optional SpeechSynthesisVoice to use instead of
     *   the soft-voice pick (used by the picker panel's preview). */
    function speakBrowser(text, forcedVoice) {
      if (typeof window === 'undefined' || typeof window.speechSynthesis !== 'object') return
      var clean = speakable(text)
      if (!clean) return
      if (!voiceCacheReady) {
        pendingSpeaks.push({ text: clean, voice: forcedVoice })
        flushPendingSpeaks()
        return
      }
      speakNow(clean, forcedVoice)
    }

    /** Preview phrase for the picker: Chinese voice → Chinese line, else English. */
    function previewPhrase(voice) {
      var lang = voice && voice.lang ? voice.lang.toLowerCase() : ''
      if (lang.indexOf('zh') === 0 || lang.indexOf('cmn') === 0) {
        return '嗨嗨！我是你的妹妹呀～你喜欢我的声音吗？嘿嘿！'
      }
      if (lang.indexOf('en') === 0) {
        return 'Hi hi! I\'m your little sister! Do you like my voice? Hee hee!'
      }
      return 'Hi there! Do you like my voice?'
    }
    /** Sort voices for the picker: Chinese female first, then English, then the rest. */
    function sortVoicesForPicker() {
      function rank(v) {
        var lang = (v.lang || '').toLowerCase()
        var name = (v.name || '').toLowerCase()
        if (lang.indexOf('zh') === 0) return 0
        if (lang.indexOf('en') === 0) return 1
        return 2
      }
      return voiceCache.slice().sort(function (a, b) {
        var r = rank(a) - rank(b)
        return r !== 0 ? r : String(a.name).localeCompare(String(b.name))
      })
    }

    /** Text of an assistant node from its text blocks. Harness blocks use
     * `kind` ('text' = visible text, 'reasoning' = Think chain-of-thought);
     * accept the legacy `type` spelling too. */
    function assistantNodeText(node) {
      var blocks = node.blocks || []
      return blocks
        .filter(function (b) { return b !== null && (b.kind === 'text' || b.type === 'text') && typeof b.text === 'string' })
        .map(function (b) { return b.text })
        .join('\n')
        .trim()
    }

    /** The real conversation node behind a chat-store view wrapper. Chat
     * store entries are `{ key, kind, id, target, data }` — the assistant
     * step keeps its final message in `data.finalNode`. Returns the node
     * itself when it is already a raw conversation node. */
    function unwrapNode(node) {
      if (node === null || node === undefined) return null
      var d = node
      if (d.data !== undefined && d.data !== null && d.blocks === undefined && d.seq === undefined && d.kind !== 'assistant') {
        d = d.data
      }
      if (d !== null && d !== undefined && d.finalNode !== undefined && d.finalNode !== null) {
        d = d.finalNode
      }
      return d
    }

    /** Latest assistant message text from the conversation snapshot, or null.
     * Checks both the legacy top-level `nodes` array and the `chat` store. */
    function latestAssistantText(session) {
      if (session === null || session === undefined) return null
      if (Array.isArray(session.nodes)) {
        for (var i = session.nodes.length - 1; i >= 0; i--) {
          var n = unwrapNode(session.nodes[i])
          if (n === null || n.kind !== 'assistant') continue
          var text = assistantNodeText(n)
          if (text) return { seq: n.seq, text: text }
        }
      }
      if (session.chat !== null && session.chat !== undefined) {
        var order = session.chat.order || []
        var nodes = session.chat.nodes
        var get = typeof nodes.get === 'function' ? function (id) { return nodes.get(id) } : function (id) { return nodes[id] }
        for (var j = order.length - 1; j >= 0; j--) {
          var m = unwrapNode(get(order[j]))
          if (m === null || m.kind !== 'assistant') continue
          var t = assistantNodeText(m)
          if (t) return { seq: m.seq, text: t }
        }
      }
      return null
    }

    /** Sister-only gate: the host rows publish process-globally, so the
     * projection reaches every session — the toggle must additionally check
     * that THIS session actually runs the sister agent preset. */
    function isSisterSession(props) {
      if (props.sessionId === undefined || typeof props.useSessions !== 'function') return false
      var preset = props.useSessions(function (s) { return s.byId[props.sessionId]?.agentPreset })
      return preset === 'sister'
    }

    // ---- speak toggle ------------------------------------------------------
    function SpeakToggle(props) {
      var value = (props.useProjection ? props.useProjection('sisterSpeak') : null) || { speakEnabled: true, lastSpoken: null, lastCheer: null }
      var state = React.useState(value.speakEnabled !== false)
      React.useEffect(function () {
        state[1](value.speakEnabled !== false)
      }, [value.speakEnabled])
      var session = props.session || (props.useSession ? props.useSession(function (s) { return s }) : null)
      var isSister = isSisterSession(props)
      // Explicit speak requests (speak tool / /speak <text>).
      var spokenSeqRef = React.useRef(0)
      var spokenTextRef = React.useRef(null)
      React.useEffect(function () {
        var last = value.lastSpoken
        if (last === null || last === undefined) return
        if (last.seq <= spokenSeqRef.current) return
        spokenSeqRef.current = last.seq
        if (value.speakEnabled === false) return
        spokenTextRef.current = String(last.text || '')
        speakBrowser(last.text)
      }, [value.lastSpoken, value.speakEnabled])
      // Auto-read EVERY assistant reply (the sister always talks). Waits a
      // beat so the learner sees the text before the sound starts. The
      // pending timer lives in a ref so later snapshot re-renders do NOT
      // cancel it — only a genuinely new message supersedes the pending one.
      var spokenMsgRef = React.useRef(null)
      var pendingSpeakRef = React.useRef(null)
      React.useEffect(function () {
        if (!isSister) return
        if (value.speakEnabled === false) return
        var msg = latestAssistantText(session)
        if (msg === null) return
        if (spokenMsgRef.current !== null && spokenMsgRef.current.seq === msg.seq && spokenMsgRef.current.text === msg.text) return
        if (pendingSpeakRef.current !== null && pendingSpeakRef.current.seq === msg.seq && pendingSpeakRef.current.text === msg.text) return
        if (spokenTextRef.current !== null && spokenTextRef.current === msg.text) return
        if (pendingSpeakRef.current !== null) {
          clearTimeout(pendingSpeakRef.current.timer)
          pendingSpeakRef.current = null
        }
        var timer = setTimeout(function () {
          pendingSpeakRef.current = null
          spokenMsgRef.current = msg
          speakBrowser(msg.text)
        }, 1000)
        pendingSpeakRef.current = { seq: msg.seq, text: msg.text, timer: timer }
      }, [session, value.speakEnabled, isSister])
      // Cheer chip: surface a fired cheer into the shared store.
      React.useEffect(function () {
        var cheer = value.lastCheer
        if (cheer === null || cheer === undefined) return
        store.cheer = { text: String(cheer.text || ''), at: Date.now(), sessionId: props.sessionId }
        store.sessionId = props.sessionId
        emit()
      }, [value.lastCheer])
      React.useEffect(function () {
        return function () {
          if (pendingSpeakRef.current !== null) clearTimeout(pendingSpeakRef.current.timer)
        }
      }, [])
      if (!isSister) return null
      var enabled = state[0]
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 2 } },
        h('button', {
          onClick: function () { setStoreVoiceOpen(!store.voiceOpen) },
          title: '听一下再选妹妹的声音 — pick & preview the sister\'s voice',
          'aria-label': 'Sister voice picker',
          style: {
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, padding: '2px 4px',
            color: 'var(--dsw-text-color, inherit)',
          },
        }, '🎤'),
        h('button', {
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
          title: enabled ? 'Sister voice is on — click to mute' : 'Sister voice is muted — click to enable',
          'aria-label': 'Sister speak toggle',
          style: {
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, padding: '2px 6px',
            color: enabled ? 'var(--dsw-text-color, inherit)' : '#8e8e8e',
            textDecoration: enabled ? 'none' : 'line-through',
          },
        }, '🔊'),
      )
    }

    // ---- voice picker panel ------------------------------------------------
    // Centered modal listing every available voice, sorted Chinese-first.
    // Click a row: it previews the voice immediately AND locks the choice, so
    // the user can listen first and pick the cutest one.
    var PICKER_WRAP = {
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
      zIndex: 1000, width: 'min(620px, 94vw)', maxWidth: 620,
    }
    var PICKER_BACKDROP = {
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(0, 0, 0, 0.35)',
    }
    var PICKER_ROW = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 6,
      cursor: 'pointer', marginBottom: 2,
      border: '1px solid var(--dsw-border-color, rgba(128,128,128,.25))',
      background: 'var(--dsw-surface-color, transparent)',
      color: 'var(--dsw-text-color, inherit)', fontSize: 13,
    }
    function VoicePicker() {
      var openState = React.useState(store.voiceOpen)
      React.useEffect(function () {
        return subscribe(function () {
          openState[1](store.voiceOpen)
        })
      }, [])
      if (!openState[0]) return null
      var saved = savedVoicePref()
      var list = sortVoicesForPicker()
      var langLabel = function (lang) {
        var l = String(lang || '')
        if (l.indexOf('zh') === 0) return '中文'
        if (l.indexOf('en') === 0) return 'English'
        return l
      }
      var rows = list.map(function (v) {
        var active = saved !== null && String(saved).toLowerCase() === String(v.name).toLowerCase()
        return h('button', {
          key: v.name,
          onClick: function () {
            saveVoicePref(v.name)
            speakBrowser(previewPhrase(v), v)
          },
          style: Object.assign({}, PICKER_ROW, active ? { border: '2px solid #f39c12' } : {}),
        },
          h('span', { style: { fontWeight: active ? 700 : 400 } },
            (active ? '✓ ' : '') + v.name),
          h('span', { style: { fontSize: 11, opacity: .7, marginLeft: 8 } }, langLabel(v.lang)),
        )
      })
      return h(React.Fragment, null,
        h('div', { style: PICKER_BACKDROP, onClick: function () { setStoreVoiceOpen(false) } }),
        h('div', { style: PICKER_WRAP },
          h('div', { style: Object.assign({}, PANEL_CARD, { maxHeight: '86vh', overflow: 'auto' }), className: 'dsh-sister-voice-picker' },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
              h('span', { style: { fontWeight: 600 } }, '🎤 妹妹的声音 — click to preview & select'),
              h('button', { onClick: function () { setStoreVoiceOpen(false) }, style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 } }, '✕'),
            ),
            h('div', { style: { fontSize: 11, opacity: .6, marginBottom: 8 } },
              '点一下试听，自动记住你最后选的声音。Click a voice to hear it — your last pick is remembered.'),
            list.length === 0
              ? h('div', { style: { opacity: .6 } }, 'Loading voices… (your browser loads them in a moment)')
              : rows,
          ),
        ),
      )
    }

    // ---- cheer chip --------------------------------------------------------
    // A small floating card that pops up when a cheer fires and fades out.
    function CheerChip() {
      var state = React.useState(store.cheer)
      React.useEffect(function () {
        return subscribe(function () {
          state[1](store.cheer)
        })
      }, [])
      var cheer = state[0]
      var visibleState = React.useState(false)
      React.useEffect(function () {
        if (cheer === null || cheer === undefined || typeof cheer.text !== 'string' || cheer.text === '') {
          visibleState[1](false)
          return
        }
        // Only show when the cheering session is the one being viewed.
        visibleState[1](true)
        var timer = setTimeout(function () { visibleState[1](false) }, 9000)
        return function () { clearTimeout(timer) }
      }, [cheer])
      if (!visibleState[0] || cheer === null) return null
      return h('div', {
        style: { position: 'fixed', left: 16, bottom: 96, zIndex: 1000, maxWidth: 380, width: 'calc(100vw - 32px)' },
      },
        h('div', { style: Object.assign({}, PANEL_CARD, { borderLeft: '3px solid #f39c12' }), className: 'dsh-sister-cheer-chip' },
          h('div', { style: { fontWeight: 600, marginBottom: 2, color: 'var(--dsw-text-color, inherit)' } }, '💛 Sister says…'),
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dsw-text-color, inherit)' } }, cheer.text),
        ),
      )
    }

    // ---- plugin ------------------------------------------------------------
    exports.name = 'dsh-sister/client'
    exports.inject = ['slots', 'conversation']
    exports._test = { assistantNodeText, latestAssistantText, unwrapNode, speakable, pickVoice, nextVoice, previewPhrase, sortVoicesForPicker, refreshVoiceCache, voicesFor }
    exports.apply = function (ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      pluginCtx = ctx
      slots.inject('conversation.input.right', function () {
        return slots.register(
          { name: 'conversation.input.right', id: 'dsh-sister-speak', order: 9, label: function () { return 'Speak' } },
          SpeakToggle,
        )
      })
      slots.inject('shell.overlay', function () {
        return slots.register({ name: 'shell.overlay', id: 'dsh-sister-cheer-chip', order: 40 }, CheerChip)
      })
      slots.inject('shell.overlay', function () {
        return slots.register({ name: 'shell.overlay', id: 'dsh-sister-voice-picker', order: 45 }, VoicePicker)
      })
    }

    return module.exports
  },
})
