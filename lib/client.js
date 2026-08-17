/**
 * dsh-companion Web client — persona button + config modal. The shared
 * core renders no picker/toggle UI of its own anymore, so this is the
 * ONLY voice-config surface. resolveInstruct makes the actual auto-read
 * TTS use THIS session's saved voice, not a static default (see
 * dsh-voice-core Task 1).
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
     * opts.resolveInstruct. Kicks off a background fetch on a cold cache so
     * the NEXT call is warm; returns a safe default meanwhile. */
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
        resolveInstruct: resolveInstruct,
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
    exports._test = Object.assign({}, core._test, {
      fetchPersona: fetchPersona, savePersona: savePersona, resolveInstruct: resolveInstruct, DEFAULT_PERSONA: DEFAULT_PERSONA, STYLES: STYLES,
    })

    return module.exports
  },
})
