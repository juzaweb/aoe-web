import {
  RAID_LEVEL_RANGE,
  RAID_LOOT_CAP_PER_RESOURCE,
  RAID_LOOT_PERCENT,
  RAID_TOWN_CENTER_HP_THRESHOLD
} from '../constants/index.js';
import type { Resources } from '../types/index.js';

/**
 * Pure raid rules and world-map geometry.
 *
 * Everything here is a function of its arguments: the server uses it to decide
 * who may be attacked and what a won raid pays out, the client uses the same
 * code to draw the hex map. Keeping it free of room state is what makes the
 * two sides agree without a round trip.
 */

/**
 * Whether two empires are close enough in Town Center level to see each other.
 *
 * A missing level (an empire with no Town Center at all) is not comparable, so
 * it never matches.
 */
export function isRaidLevelInRange(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) <= RAID_LEVEL_RANGE;
}

/**
 * Resources a won raid takes from `defender`.
 *
 * A share of each stock, capped per resource and floored to whole units, so the
 * payout is always spendable and the same on both sides of the transaction.
 */
export function computeRaidLoot(defender: Resources): Resources {
  const take = (amount: number): number => {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.min(RAID_LOOT_CAP_PER_RESOURCE, Math.floor(amount * RAID_LOOT_PERCENT));
  };

  return {
    wood: take(defender.wood),
    food: take(defender.food),
    gold: take(defender.gold),
    stone: take(defender.stone)
  };
}

/** Whether a defender's Town Center has been reduced far enough to end the raid. */
export function isRaidTownCenterBreached(hp: number, maxHp: number): boolean {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return false;
  if (hp <= 0) return false;
  return hp / maxHp <= RAID_TOWN_CENTER_HP_THRESHOLD;
}

/**
 * Lowest HP a defender's Town Center may reach during a raid.
 *
 * Damage is clamped here instead of letting the building die, because the raid
 * is decided by the threshold and destroying the heart of an empire would be a
 * punishment the owner cannot undo.
 */
export function clampRaidTownCenterHp(hp: number, maxHp: number): number {
  const floor = Math.ceil(maxHp * RAID_TOWN_CENTER_HP_THRESHOLD);
  return Math.max(floor, hp);
}

/** Axial coordinate on the world map. */
export interface HexPosition {
  q: number;
  r: number;
}

/**
 * Radius of the world map hex grid, in tiles from the centre.
 *
 * 13 rings holds 547 tiles, which is far more than a launch-day population but
 * still a bounded, readable map.
 */
export const WORLD_MAP_RADIUS = 12;

/** 32-bit FNV-1a, the same hash the server uses for stable ids and colours. */
function hashKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Tiles in a hex grid of `radius` rings: 1 + 3r(r+1). */
export function hexGridSize(radius: number = WORLD_MAP_RADIUS): number {
  return 1 + 3 * radius * (radius + 1);
}

/** Axial tile for a 0-based grid index, walking rings outward from the centre. */
export function hexTileAt(index: number, radius: number = WORLD_MAP_RADIUS): HexPosition {
  const size = hexGridSize(radius);
  let remaining = ((index % size) + size) % size;
  if (remaining === 0) return { q: 0, r: 0 };
  remaining -= 1;

  for (let ring = 1; ring <= radius; ring++) {
    const ringSize = ring * 6;
    if (remaining < ringSize) {
      const side = Math.floor(remaining / ring);
      const along = remaining % ring;
      // Start at the south-most tile of the ring and walk clockwise.
      let q = 0;
      let r = ring;
      switch (side) {
        case 0:
          q = along;
          r = ring - along;
          break;
        case 1:
          q = ring;
          r = -along;
          break;
        case 2:
          q = ring - along;
          r = -ring;
          break;
        case 3:
          q = -along;
          r = -ring + along;
          break;
        case 4:
          q = -ring;
          r = along;
          break;
        default:
          q = -ring + along;
          r = ring;
          break;
      }
      return { q, r };
    }
    remaining -= ringSize;
  }

  return { q: 0, r: 0 };
}

/**
 * Fixed world-map tile of an account.
 *
 * Derived from the account id so it never moves between sessions, and so two
 * clients that receive the same list agree on where every empire sits. Two
 * accounts may collide on the same tile; the overlay resolves that by nudging
 * later entries into the next free tile.
 */
export function hexPositionOf(userId: string, radius: number = WORLD_MAP_RADIUS): HexPosition {
  return hexTileAt(hashKey(userId), radius);
}
