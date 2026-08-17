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
