# dsh-sister

A warm, cheerful **"little sister" companion** for DeepSeek Harness. She speaks
with a soft, cute **Chinese-first** voice played by the **browser** on the
user's own machine (Web Speech API — cross-platform, no server TTS), reads
every reply aloud, fires scheduled daily cheers, and showers the learner with
positive energy. Built for a 9–12-year-old, but fun for anyone.

> Sister companion · browser TTS · daily cheer scheduler · zero build

## What it does

- **Auto-reads every reply aloud** — the sister always "talks": each assistant
  message is spoken by the browser after a 1s beat (text first, then sound).
- **`speak` / `cheer` model tools** — the sister can ask that a line be read
  aloud or fire a warm cheer chip at any moment.
- **Daily cheer scheduler** — at configured times (default `08:00` and
  `16:30`) she pipes up with a short cheer into every live sister session,
  spoken + shown as a 💛 chip. Persisted to
  `$DSH_HOME/state/dsh-sister/schedule.json`; once per time per day, missed
  runs are skipped.
- **Voice picker (先听再选)** — the 🎤 button in the chat box lists every
  available browser voice (Chinese first), previews each one on click, and
  remembers your last pick in `localStorage`. The 🔊 button mutes/unmutes.
- **Soft female voice preference** — Chinese soft-girl voices (Tingting,
  Yu-shu, Meijia, Xiaoxiao, Xiaoyi, Sandy/Shelley/Flo zh…) lead, then English
  soft female (Samantha, Karen, Moira…). Handles the browser's async
  `getVoices()` load so the first utterance never falls back to a male
  default.

## Install (in a profile)

```bash
dsh plugin --profile web add github:Yihong89/dsh-sister
```

The bundle patch is intentionally empty — the plugin only activates where a
preset composes a `name: dsh-sister` row (like the shipped `sister` preset:
`~/.dsh/.agent-presets/sister/agent.cordis.yml`). Also add the event registrar
to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-sister-registrar
      name: dsh-sister/register-events
```

## Commands

| Command | What it does |
| --- | --- |
| `/speak on\|off` | Toggle browser TTS auto-speak |
| `/speak <text>` | Speak text aloud right now |
| `/cheer [text]` | Fire a cheer now (spoken + chip); bank default if no text |
| `/cheer-at 08:00 16:30` | Set the daily cheer times (HH:MM, 24h) |
| `/sister` | Show status: TTS on/off + daily cheer times |

## Daily scheduled cheers

The schedule lives **in the plugin** (server-side on the host), so it works
regardless of which browser/GUI is in front — the only requirement for the
**sound** is that the DSH tab is open on the listener's machine at cheer time.
Set it with:

```
/cheer-at 08:00 17:30
```

- Once per configured time per day, into every live sister session.
- Missed times (no session open) are skipped, never queued.
- The cheer bank rotates by day-of-year (stable per day).

## Preset

`~/.dsh/.agent-presets/sister/` ships with:

- `preset.yml` — name `妹妹 (Sister)` (shown in the GUI preset picker)
- `agent.cordis.yml` — Chinese-first soft-cute persona + the `dsh-sister` row.
  Lean by design: no shell, filesystem, or delegation tools.

## Tests

```bash
node --test test/*.test.js   # 37 tests
```

## License

MIT
