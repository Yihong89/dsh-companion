/**
 * dsh-companion/register-events — profile-boot registrar.
 *
 * The shared voice event types live in dsh-voice-core; this thin registrar
 * just forwards the core's apply().
 *
 * @module dsh-companion/register-events
 */
import { apply as coreApply } from 'dsh-voice-core/register-events'

export const name = 'dsh-companion/register-events'

export function apply() {
  coreApply()
}
