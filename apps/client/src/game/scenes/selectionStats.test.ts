import { describe, expect, it } from 'vitest';
import { trainerLevelFor, unitCombatStats, type SelectionBuilding } from './selectionStats.js';

function building(overrides: Partial<SelectionBuilding> = {}): SelectionBuilding {
  return { type: 'BARRACKS', ownerId: 'me', level: 1, isConstructed: true, ...overrides };
}

describe('trainerLevelFor', () => {
  it('reads the highest finished level of the matching trainer', () => {
    const buildings = [
      building({ type: 'BARRACKS', level: 3 }),
      building({ type: 'BARRACKS', level: 7 }),
      building({ type: 'STABLE', level: 9 })
    ];
    expect(trainerLevelFor(buildings, 'me', 'SPEARMAN')).toBe(7);
  });

  it('ignores foundations so an unbuilt trainer grants no buff', () => {
    const buildings = [building({ type: 'BARRACKS', level: 8, isConstructed: false })];
    expect(trainerLevelFor(buildings, 'me', 'SPEARMAN')).toBe(1);
  });

  it('ignores another owner’s trainer', () => {
    const buildings = [building({ type: 'BARRACKS', level: 6, ownerId: 'enemy' })];
    expect(trainerLevelFor(buildings, 'me', 'SPEARMAN')).toBe(1);
  });

  it('falls back to level 1 when the owner has no trainer', () => {
    expect(trainerLevelFor([], 'me', 'ARCHER')).toBe(1);
  });

  it('maps villagers to the Town Center trainer', () => {
    const buildings = [building({ type: 'TOWN_CENTER', level: 4 })];
    expect(trainerLevelFor(buildings, 'me', 'VILLAGER')).toBe(4);
  });
});

describe('unitCombatStats', () => {
  it('returns the blueprint range and cooldown', () => {
    expect(unitCombatStats('ARCHER', 1, 1, 1)).toEqual({
      attackPower: 7,
      attackRange: 5,
      attackCooldownMs: 1400
    });
  });

  it('scales attack with research, Town Center aura and trainer level', () => {
    const base = unitCombatStats('SPEARMAN', 1, 1, 1).attackPower ?? 0;
    const buffed = unitCombatStats('SPEARMAN', 10, 10, 10).attackPower ?? 0;
    expect(buffed).toBeGreaterThan(base);
  });

  it('never applies the trainer buff to villagers', () => {
    expect(unitCombatStats('VILLAGER', 1, 1, 10).attackPower).toBe(
      unitCombatStats('VILLAGER', 1, 1, 1).attackPower
    );
  });

  it('returns no stats for an unknown unit type', () => {
    expect(unitCombatStats('DRAGON', 1, 1, 1)).toEqual({});
  });
});
