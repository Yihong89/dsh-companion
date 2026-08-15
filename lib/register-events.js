/**
 * dsh-sister/register-events — profile-boot registrar.
 *
 * The harness persistence read path refuses any session log containing an
 * event type outside its generated `KNOWN_SESSION_EVENT_TYPES` catalog (the
 * "unknown to this harness and not marked ignorable" refusal). `session.append`
 * cannot mark events ignorable, and the catalog has no registration API — but
 * the catalog IS a shared `Set` that the persistence imports from the same
 * `@deepseek-ai/dsh-session` module instance, so this tiny plugin registers
 * dsh-sister's event types into it at profile boot.
 *
 * Install as a profile-level row so registration happens before any session
 * log is read:
 *
 *   - id: dsh-sister-registrar
 *     name: dsh-sister/register-events
 *
 * It provides no tools and no prompt sections, so it does NOT give other
 * agents sister capabilities — it only widens the event catalog by three
 * type names. The main plugin entry (index.js) also registers at module load,
 * so sister sessions self-register even without this row.
 *
 * @module dsh-sister/register-events
 */
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { SPEAK_EVENT, SPOKEN_EVENT, CHEER_EVENT } from './fold.js'

export const name = 'dsh-sister/register-events'

export function apply() {
  for (const type of [SPEAK_EVENT, SPOKEN_EVENT, CHEER_EVENT]) {
    KNOWN_SESSION_EVENT_TYPES.add(type)
  }
}
