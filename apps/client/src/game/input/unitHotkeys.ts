import type { UnitType } from '@chien-quoc/shared';

/**
 * UIX-04: the training hotkey printed on a production button.
 *
 * The letters are mnemonic (Villager / Spearman / Archer / Cavalry) rather than
 * a positional grid. Every key is already used by another command in a *different
 * context*, so the two can never fire on one press:
 *
 * - `V` is otherwise free.
 * - `S` stops the selected units, which requires a unit selection; training
 *   requires a building selection, and this game never mixes the two.
 * - `A` arms attack-move for a unit selection; training is building-only.
 * - `C` starts a Stable placement, which requires a selected villager.
 * - `M` is free; it stands for the siege machine (a catapult).
 *
 * `CommandController` binds these keys and `EntityDetails` prints the same
 * letters on its buttons, so the badge can never claim a key that does nothing.
 */
export const UNIT_TRAINING_HOTKEYS: ReadonlyArray<{ key: string; unitType: UnitType }> = [
  { key: 'V', unitType: 'VILLAGER' },
  { key: 'S', unitType: 'SPEARMAN' },
  { key: 'A', unitType: 'ARCHER' },
  { key: 'C', unitType: 'CAVALRY' },
  { key: 'M', unitType: 'CATAPULT' }
];

/** Reverse lookup for the production panel, which renders one button per unit. */
export const UNIT_TRAINING_HOTKEY_BY_TYPE = Object.fromEntries(
  UNIT_TRAINING_HOTKEYS.map(({ key, unitType }) => [unitType, key])
) as Record<UnitType, string>;
