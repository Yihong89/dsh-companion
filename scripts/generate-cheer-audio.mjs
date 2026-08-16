#!/usr/bin/env node
/**
 * One-time (re-run only when DEFAULT_CHEERS changes) generator for the
 * pre-baked cheer-bank audio served from assets/cheer-audio/ — see
 * index.js's CHEER_AUDIO_* routes and lib/client.js's cheerAudioManifestUrl.
 *
 * Hits the LIVE TTS service (must be reachable and idle — it's a single
 * global lock, so this runs sequentially) once per DEFAULT_CHEERS entry in
 * the default (paimon) voice, then re-encodes the WAV response to AAC/m4a
 * via macOS's built-in `afconvert` (~5x smaller, same duration) before
 * writing assets/cheer-audio/<index>.wav.
 *
 * Usage: TTS_URL=http://<host>:3080/dsh-sister/tts node scripts/generate-cheer-audio.mjs
 */
import { writeFile, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CHEERS, DEFAULT_STYLES } from 'dsh-voice-core'

const run = promisify(execFile)

const TTS_URL = process.env.TTS_URL || 'http://127.0.0.1:3080/dsh-sister/tts'
const OUT_DIR = fileURLToPath(new URL('../assets/cheer-audio/', import.meta.url))
const instruct = DEFAULT_STYLES.paimon.instruct

for (let i = 0; i < DEFAULT_CHEERS.length; i++) {
  const text = DEFAULT_CHEERS[i]
  const url = `${TTS_URL}?text=${encodeURIComponent(text)}&instruct=${encodeURIComponent(instruct)}`
  const t0 = Date.now()
  process.stdout.write(`[${i}] generating "${text.slice(0, 16)}..." `)
  const res = await fetch(url)
  if (!res.ok) {
    console.log(`FAILED ${res.status}`)
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const index = String(i).padStart(2, '0')
  const wavPath = `${OUT_DIR}${index}.wav`
  const m4aPath = `${OUT_DIR}${index}.m4a`
  await writeFile(wavPath, buf)
  await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wavPath, m4aPath])
  await unlink(wavPath)
  console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
}
console.log('done')
