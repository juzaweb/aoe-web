import { MAX_UNIT_LEVEL, UNIT_UPGRADE_ORDER } from '@chien-quoc/shared';

/**
 * `players.unit_levels` is a CSV in `UNIT_UPGRADE_ORDER`. These two helpers keep
 * the database shape out of the room/simulation layer: persistence only needs
 * the CSV, while the room only needs the array on `PlayerState`.
 */
export function parseUnitLevels(csv: string | null | undefined): number[] {
  const parts = (csv ?? '').split(',');
  return UNIT_UPGRADE_ORDER.map((_, index) => clampLevel(Number.parseInt(parts[index] ?? '', 10)));
}

export function serializeUnitLevels(levels: ArrayLike<number> | null | undefined): string {
  return UNIT_UPGRADE_ORDER.map((_, index) =>
    clampLevel(levels ? Number(levels[index]) : 1)
  ).join(',');
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_UNIT_LEVEL, Math.max(1, Math.floor(value)));
}
