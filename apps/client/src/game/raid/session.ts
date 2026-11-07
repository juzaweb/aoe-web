/**
 * The raid a client is currently fighting, persisted per account.
 *
 * A raid survives a page reload: the army sits in the defender's kingdom until
 * the raid is settled, so a refresh must be able to rejoin the same fight. The
 * record is only a lookup key — the server re-verifies it against the database
 * on every join.
 */
export interface RaidSession {
  raidId: string;
  defenderId: string;
}

const RAID_SESSION_PREFIX = 'cq_raid';

function raidSessionKey(userId: string): string {
  return `${RAID_SESSION_PREFIX}:${userId}`;
}

export function getStoredRaid(userId: string): RaidSession | null {
  try {
    const raw = localStorage.getItem(raidSessionKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RaidSession>;
    if (typeof parsed.raidId !== 'string' || typeof parsed.defenderId !== 'string') return null;
    return { raidId: parsed.raidId, defenderId: parsed.defenderId };
  } catch {
    return null;
  }
}

export function storeRaid(userId: string, raid: RaidSession): void {
  try {
    localStorage.setItem(raidSessionKey(userId), JSON.stringify(raid));
  } catch {
    // A failed write only costs the F5 convenience.
  }
}

export function clearStoredRaid(userId: string): void {
  try {
    localStorage.removeItem(raidSessionKey(userId));
  } catch {
    // Ignore.
  }
}
