/**
 * dsh-sister cheer bank + daily schedule.
 *
 * The sister fires a short, warm, upbeat English cheer at configured times of
 * day (e.g. "08:00" after waking up, "16:30" after school). The bank is pure
 * data; the scheduler logic is a tiny pure module so it unit-tests without
 * clocks or files.
 */

/** Default cheer rotation — warm, playful, age-appropriate (9–12). The sister
 * speaks Chinese-first with a bit of English cuteness mixed in. */
export const DEFAULT_CHEERS = [
  '早安呀小太阳！☀️ 今天也要开开心心的，你是最棒的！',
  '嘿！冠军来啦～🏆 每走一小步都算进步，我为你骄傲！',
  '你比你自己想的还要勇敢、还要聪明、还要酷哦！😎',
  '隔着屏幕给你一个大大的击掌！✋ 你现在做的每一件事都超厉害。',
  '要记得哦：超级英雄也要休息的。喝口水，笑一个！💧😊',
  '你的小脑袋超厉害的，今天也要学到好玩的东西！🚀',
  '如果温柔是超能力，你一定是全场最强的那一个！🦸 继续发光吧！',
  '不用追求完美，只要努力就够啦——你已经是个小赢家啦！🌟',
  '告诉你一个小秘密：你一笑，周围的人都跟着开心，这就是魔法！✨',
  '深呼吸…放轻松…以前那么难的都挺过来了，今天也一样！💪',
  '我相信你哦——才不是客套话，你是真的很棒！😄',
  '今天也要一起加油：一点点努力，加一百分的心！❤️',
  '嘘…告诉你个秘密：最支持你的人就是我呀！🎉',
  '作业、练习、还有别的任务——你都能搞定，你一直都是！🔥',
  '你是独一无二的，而独一无二就是最棒的。保持好奇，做你自己！🌈',
  '每天的小小一步，都会变成大大的成就。你今天已经迈出啦！👣',
  '笑容加成开启！😁 你一开心，周围全都亮了，包括我。',
  '遇到难题的时候，想想你已经走了多远。未来的你会感谢现在的你。🌱',
  '能量补充中：你被爱着，你很棒，你正在做得很棒！💛',
  '睡前查收！🌙 不管今天怎么样，你都撑过来了。好好休息，小明星！',
]

/** Rotate by day-of-year so the same day gets the same cheer (stable, no state). */
export function pickCheer(cheers = DEFAULT_CHEERS, now = new Date()) {
  if (!Array.isArray(cheers) || cheers.length === 0) return 'You are amazing! Keep going! 💛'
  const start = new Date(now.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((now - start) / 86400000)
  return cheers[((dayOfYear % cheers.length) + cheers.length) % cheers.length]
}

/** Parse a list of "HH:MM" times (24h). Returns normalized strings or throws. */
export function parseTimes(raw, defaultValue = ['08:00', '16:30']) {
  if (raw === undefined || raw === null) return [...defaultValue]
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/)
  const out = []
  for (const item of list) {
    const s = String(item).trim()
    if (s === '') continue
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) {
      throw new Error(`invalid time "${s}" (expected HH:MM, 24h)`)
    }
    out.push(s.padStart(5, '0'))
  }
  if (out.length === 0) throw new Error('at least one cheer time is required (e.g. "08:00")')
  return [...new Set(out)]
}

/** "HH:MM" of the given Date (local time), zero-padded. */
export function timeOf(now = new Date()) {
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/** "YYYY-MM-DD" of the given Date (local time). */
export function dateKey(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Which configured times are due right now (this minute), given the set of
 * times already fired today. Pure — the host calls it from its timer and
 * persists the fired set.
 */
export function dueTimes(times, now = new Date(), firedToday = new Set()) {
  const cur = timeOf(now)
  return times.filter((t) => t === cur && !firedToday.has(t))
}
