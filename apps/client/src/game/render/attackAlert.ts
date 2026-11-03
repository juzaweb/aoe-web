/**
 * ALERT-01: pure helpers for the under-attack alert.
 *
 * The client detects HP loss on its own entities by comparing the replicated
 * `hp` against the value it stored when the sprite was created. Keeping the
 * decision logic (and the ping bookkeeping) here makes it unit-testable without
 * Phaser, the same way `ownerColor.ts` / `unitMotion.ts` are.
 */

export interface AttackPing {
  x: number;
  y: number;
  startMs: number;
  durationMs: number;
}

/** Banner (global) cooldown between two attack alerts. */
export const ATTACK_ALERT_COOLDOWN_MS = 4000;

/** How long a minimap ping stays visible. */
export const ATTACK_PING_DURATION_MS = 3000;

/** Maximum number of pings drawn on the minimap at once. */
export const MAX_ATTACK_PINGS = 12;

/**
 * Whether a replicated HP change should raise an attack alert.
 *
 * - `previousHp === undefined`: entity just created (or no stored value) → never
 *   alert, so a unit that was already wounded before we joined does not trigger.
 * - `myOwnerId === ''`: our ownership is not resolved yet → never alert, to
 *   avoid blaming the wrong player.
 * - Only an entity owned by us, with strictly decreasing HP, counts.
 */
export function shouldAlert(
  previousHp: number | undefined,
  nextHp: number,
  ownerId: string,
  myOwnerId: string
): boolean {
  if (previousHp === undefined) return false;
  if (!myOwnerId) return false;
  if (ownerId !== myOwnerId) return false;
  return Number.isFinite(nextHp) && nextHp < previousHp;
}

/** Drops pings whose lifetime has elapsed (`nowMs - startMs >= durationMs`). */
export function pruneAttackPings(
  pings: readonly AttackPing[],
  nowMs: number
): AttackPing[] {
  return pings.filter((p) => nowMs - p.startMs < p.durationMs);
}

/**
 * Caps the ping list to `max` entries by dropping the oldest ones first.
 * A non-positive `max` yields an empty list.
 */
export function capAttackPings(
  pings: readonly AttackPing[],
  max: number
): AttackPing[] {
  if (max <= 0) return [];
  if (pings.length <= max) return [...pings];
  return pings.slice(pings.length - max);
}
