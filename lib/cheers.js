/**
 * dsh-sister cheer bank + daily schedule.
 *
 * The sister fires a short, warm, upbeat English cheer at configured times of
 * day (e.g. "08:00" after waking up, "16:30" after school). The bank is pure
 * data; the scheduler logic is a tiny pure module so it unit-tests without
 * clocks or files.
 */

/** Default cheer rotation — warm, playful, age-appropriate (9–12), English. */
export const DEFAULT_CHEERS = [
  "Morning sunshine! ☀️ I hope today treats you like the awesome person you are. You've got this!",
  "Hey champ! 🏆 Just a reminder: one small step is still a step forward. Proud of you already!",
  "You're braver than you think, smarter than you know, and cooler than you realize. 😎",
  "Quick high-five through the screen! ✋ Whatever you're doing right now — you're doing great.",
  "Remember: even the best heroes take breaks. Drink some water and give yourself a smile. 💧😊",
  "Your brain is amazing, and today it's going to learn something cool. Let's go! 🚀",
  "If kindness were a superpower, you'd be the strongest hero ever. 🦸 Keep shining!",
  "Don't worry about perfect — just try your best. Trying already makes you a winner. 🌟",
  "Guess what? You make the people around you happier just by being you. That's magic. ✨",
  "Deep breath in… deep breath out… you've handled every hard day so far, and today is no different. 💪",
  "I believe in you — and that's not just sister talk. You're genuinely awesome! 😄",
  "Let's make today a good day: a little bit of effort, a whole lot of heart. You can do it! ❤️",
  "Psst… secret: the person who cheers you on the most is your biggest fan. That's me! 🎉",
  "Homework, chores, practice — whatever's next, you'll knock it out. You always do. 🔥",
  "You're one of a kind, and that's the best kind. Stay curious, stay you! 🌈",
  "Little steps every day add up to big things. Today's step? You're already taking it. 👣",
  "Smile bonus unlocked! 😁 Your mood lifts everyone around you — including me.",
  "When things feel tricky, remember how far you've come. Future-you is grateful to you. 🌱",
  "Energy boost incoming: you are loved, you are enough, and you are doing amazing. 💛",
  "End of day check-in! 🌙 Whatever happened, you made it through. Rest well, superstar.",
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
