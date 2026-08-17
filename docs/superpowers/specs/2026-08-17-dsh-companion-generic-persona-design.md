# dsh-companion: generic, user-configurable persona (design spec)

Date: 2026-08-17
Status: approved, implementing

## Problem

`dsh-sister` is a companion plugin hardcoded to one persona (妹妹/paimon voice):
voice styles, greeting text, background image, and pre-baked cheer audio are
all fixed in JS, shipped as this one package. The sibling `dsh-teacher`
package shows the existing scaling story: fork the repo, hardcode a new
persona, publish a new package. The goal is to let a user define **any**
personality and **any** voice sound without forking or publishing anything —
configured entirely through the running app.

## Non-goals

- Multiple personas active at once across different presets (out of scope;
  one dedicated preset, one persona per session).
- A marketplace/registry of shareable persona configs.
- Full cron-expression scheduling (daily HH:MM times only, like today's
  `/cheer-at`).
- Custom background images or pre-baked cheer audio per persona (see
  "Assets" below — dropped for v1).

## Architecture

`dsh-companion` (renamed from `dsh-sister`) stays a thin host+client plugin
over the shared `dsh-voice-core` engine — TTS proxy, `speak`/`cheer` tools,
`voiceSpeak` projection, and session tracking are all reused unchanged.
What's new lives entirely in `dsh-companion`:

- A dedicated agent preset (`~/.dsh/.agent-presets/companion/agent.cordis.yml`)
  is the only place the plugin activates — same opt-in pattern as today's
  empty `cordis.patch.yml` (a preset row must explicitly name
  `dsh-companion`).
- Package/route rename: `dsh-sister` → `dsh-companion`, `/dsh-sister/*` →
  `/dsh-companion/*`, preset `sister` → `companion`.
- `DSH_SISTER_TTS_URL` env var dropped; `DSH_VOICE_TTS_URL` (already
  supported by `dsh-voice-core`) is the only override.

## Persona storage — per session

`$DSH_HOME/state/dsh-companion/personas/<sessionId>.json`:

```json
{
  "name": "小雪",
  "personality": "free-text prose describing tone/relationship/backstory",
  "voice": { "presetKey": "paimon", "instruct": "resolved natural-language TTS instruct" },
  "schedule": { "times": ["08:00", "16:30"], "fired": { "2026-08-17": ["08:00"] } },
  "createdAt": 0,
  "updatedAt": 0
}
```

No file yet ⇒ the session runs as a small built-in generic default persona
(neutral, warm, default voice) until the user opens the config window and
saves. `presetKey` is omitted when the voice was hand-described; `instruct`
is always populated (either the preset's fixed instruct or the user's own
text) since that's what the TTS backend actually consumes.

Persisted with the same atomic best-effort read/write pattern
`VoiceSchedule` already uses in `dsh-voice-core` (corrupt file ⇒ fall back
to defaults, never throw).

## Client UI

**Persona button.** Registered in the session header's
`conversation.session.header.actions` slot (beside the session title), not
the composer row. Opens a `shell.overlay` modal (same mechanism as today's
style picker) with:

- Name (text input)
- Personality (textarea — free prose, becomes the persona's system-prompt
  text)
- Voice: the existing 4 style presets as click-to-preview quick picks, plus
  a "custom" textarea for a fully free-text voice description (sent
  verbatim as the TTS instruct — this is what makes "any voice" possible
  without growing the preset catalog)
- Schedule: one or more HH:MM daily greeting times (same UX as today's
  `/cheer-at`, now a form field instead of a slash command)
- Save → `PATCH`s the persona file via a small host endpoint, applies
  immediately (no restart, no new session needed)

**Speak toggle removed.** The composer-row 🔊 icon is dropped entirely —
auto-speak is on by default for a companion session; muting stays available
via the existing `/speak off` command for anyone who wants it, just no
dedicated icon. The composer row ends up with zero custom icons; everything
lives behind the one header button.

**Shared-core change (small, isolated).** `dsh-voice-core`'s
`createVoiceClient` gets one new opt-out option (default `true`, unchanged)
to suppress its own built-in picker button/panel — `dsh-companion` sets it
`false` since it renders its own. `dsh-teacher` is untouched.

## Personality → system prompt

`dsh-companion` registers one agent-scoped `ctx.systemPrompt.section`
(order 0) whose text is `{{companion_persona}}`, and a
`ctx.systemPrompt.variable('companion_persona', provider)` whose provider
reads the *current* session's persona file at **render** time (not
mount time) — required because a preset composition mounts once per
process and is shared by every session on it (`dsh-agent-presets`' standing
mount), so nothing can be baked into a closure at `apply()` time. The
provider resolves the session id off `context.agent.session.id`, same
pattern `VoiceController.sessionKey` already uses.

## Voice → speech

Today's shared client always resolves TTS instruct from the *static*
`opts.defaultStyle` (`instructFor()` in `dsh-voice-core/lib/client.js`),
never from whatever the picker saved — the picker only ever affected the
preview. `dsh-companion`'s own client fixes this for itself: it resolves
the instruct actually sent for auto-read/cheer speech from the current
session's saved persona (falling back to the built-in default persona's
voice when unset), not from a fixed plugin-wide default.

## Schedule → per-session tick

`dsh-voice-core`'s built-in global scheduler (`VoiceSchedule`/
`VoiceController.tick()`) is shared across every session on a preset — one
set of times, one `fired` log. That doesn't fit "cron job for the persona"
(per-session times). `dsh-companion` calls `applyVoice(ctx, {
schedulerEnabled: false, ... })` to disable the core's own scheduler
entirely, and runs its own `setInterval` (reusing the exported `TICK_MS`)
that:

1. Iterates the controller's tracked live sessions.
2. For each, reads that session's persona file's `schedule.times` /
   `schedule.fired`.
3. Fires a persona-aware greeting (`agent.followup` built from the
   persona's name/personality, falling back to `controller.appendCheer`
   with a bank pick on failure — mirrors `VoiceController.greet()`'s
   existing fallback shape) into just that session.
4. Marks `schedule.fired` in that session's own persona file.

This is entirely additive in `dsh-companion`; `dsh-voice-core`'s scheduler
classes are not modified, so `dsh-teacher` (which doesn't do per-session
personas) is unaffected.

## Assets — dropped for v1

Sister's background image and pre-baked cheer-audio bank only worked
because there was exactly one fixed voice to pre-render for. Arbitrary
custom voices can't be pre-baked. Cheers go through live streaming TTS for
every persona (already ~1s to first audio — see `tts_service.py`'s
streaming endpoint), which is an acceptable simplification rather than a
regression. No background image in v1 (YAGNI); can be revisited if wanted
later.

## Testing

Follows the existing `node --test test/*.test.js` pattern:

- Persona file read/write/fallback-to-default (mirrors existing
  `VoiceSchedule` tests in `dsh-voice-core`).
- Per-session `system-prompt` variable resolution (right session's persona
  text, generic default when none saved).
- Instruct resolution: preset key vs. custom text, missing persona
  fallback.
- Per-session tick/due-time firing and `fired` bookkeeping, adapted from
  `dueTimes`/`parseTimes` coverage already in `dsh-voice-core`.
- Host-smoke test extended to cover the new persona GET/PATCH endpoint.

## Open items carried into implementation

- Exact wording of the small `dsh-voice-core` client option name
  (`stylePicker: false` or similar) — decide during implementation, keep
  it additive/default-preserving.
- Whether `/cheer-at` and `/cheer-text` commands stay as power-user
  aliases writing to the same per-session persona file, or are retired in
  favor of the modal only. Default: keep them as aliases (cheap, backward
  compatible with existing muscle memory), unless implementation finds a
  reason not to.
