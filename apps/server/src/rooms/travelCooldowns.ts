import { TRAVEL_COOLDOWN_MS } from '@chien-quoc/shared';

/**
 * Account-wide travel cooldown.
 *
 * A per-room map reset on every map switch, which made ping-ponging through a
 * portal one click per arrival. Keyed by account id and kept in memory next to
 * the session coordinator: a restart simply clears it.
 */
const cooldownUntilByOwner = new Map<string, number>();

export function isTravelCoolingDown(ownerId: string, now = Date.now()): boolean {
  return now < (cooldownUntilByOwner.get(ownerId) ?? 0);
}

export function markTravel(ownerId: string, now = Date.now()): void {
  cooldownUntilByOwner.set(ownerId, now + TRAVEL_COOLDOWN_MS);
}

/** Test hook; production never clears cooldowns early. */
export function resetTravelCooldowns(): void {
  cooldownUntilByOwner.clear();
}
