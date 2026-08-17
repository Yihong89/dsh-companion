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
    })

    exports.name = voiceClient.name
    exports.inject = voiceClient.inject
    exports.apply = voiceClient.apply
    exports._test = core._test

    return module.exports
  },
})
