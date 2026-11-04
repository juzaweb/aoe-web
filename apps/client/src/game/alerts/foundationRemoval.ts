/**
 * FND-01: client-side condition for alerting when a building is removed.
 *
 * A foundation (`isConstructed === false`) has `hp = 1`, so it is destroyed
 * in a single hit and may be removed before any `hp` patch reaches the client.
 * This helper decides whether such a removal should feed the under-attack
 * tracker, reusing phase 12's fallback `onRemove` path. Pure (no Phaser/React)
 * so it can be unit-tested like `underAttack.ts` and `ownerColor.ts`.
 */
export interface RemovableBuilding {
  ownerId?: string;
  hp?: number;
  isConstructed?: boolean;
}

export function shouldAlertOnBuildingRemoval(
  building: RemovableBuilding | null | undefined,
  myOwnerId: string,
  cancelled: boolean
): boolean {
  if (!building) return false;
  if (!myOwnerId) return false;
  if (building.ownerId !== myOwnerId) return false;
  if (cancelled) return false;

  if (building.isConstructed === true) {
    return (building.hp ?? 0) <= 0;
  }
  // Foundation or unknown construction state: any removal that is not a
  // self-cancel counts as an attack (foundation dies in one hit).
  return true;
}
