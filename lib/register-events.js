/**
 * dsh-sister/register-events — profile-boot registrar.
 *
 * The shared voice event types live in dsh-voice-core; this thin registrar
 * forwards the core's apply() so existing profile patch rows
 * (`name: dsh-sister/register-events`) keep working after the refactor.
 *
 * @module dsh-sister/register-events
 */
import { apply as coreApply } from 'dsh-voice-core/register-events'

export const name = 'dsh-sister/register-events'

export function apply() {
  coreApply()
}
