import { describe, expect, it } from 'vitest';
import { BUILDING_BLUEPRINTS, UNIT_BLUEPRINTS } from '@chien-quoc/shared';
import {
  ARCHER_DRAW_MS,
  RangedFireSim,
  distanceToFootprint,
  type BuildingShotSource,
  type RangedWorld,
  type UnitShotSource
} from './rangedFire.js';

/**
 * Cadences and ranges are read from the shared blueprints instead of being
 * copied into the tests, so a balance pass cannot silently invalidate the
 * expectations below: the test then fails only if the *rule* drifted.
 */
const ARCHER_RANGE = UNIT_BLUEPRINTS.ARCHER.attackRange;
const ARCHER_COOLDOWN_MS = UNIT_BLUEPRINTS.ARCHER.attackCooldownMs;
const TOWER_COOLDOWN_MS = BUILDING_BLUEPRINTS.TOWER.attackCooldownMs;

/** An archer mid-fight: attacking a unit that stands two tiles away. */
function archer(overrides: Partial<UnitShotSource> = {}): UnitShotSource {
  return {
    id: 'archer-1',
    ownerId: 'player-1',
    type: 'ARCHER',
    x: 10,
    y: 10,
    actionState: 'ATTACKING',
    targetEntityId: 'enemy-1',
    targetEntityType: 'unit',
    ...overrides
  };
}

/** A hostile spearman: melee, so it never contributes arrows of its own. */
function enemy(overrides: Partial<UnitShotSource> = {}): UnitShotSource {
  return {
    id: 'enemy-1',
    ownerId: 'player-2',
    type: 'SPEARMAN',
    x: 12,
    y: 10,
    actionState: 'IDLE',
    targetEntityId: '',
    targetEntityType: '',
    ...overrides
  };
}

/** A finished tower on a 2x2 footprint at the map origin. */
function tower(overrides: Partial<BuildingShotSource> = {}): BuildingShotSource {
  return {
    id: 'tower-1',
    ownerId: 'player-1',
    type: 'TOWER',
    gridX: 0,
    gridY: 0,
    sizeX: 2,
    sizeY: 2,
    isConstructed: true,
    ...overrides
  };
}

/**
 * A hostile unit standing inside the tower's footprint radius, so a tower has
 * something to shoot while the archer keeps its own, farther target.
 */
function towerBait(): UnitShotSource {
  return enemy({ id: 'bait-1', x: 3, y: 3 });
}

function world(
  units: UnitShotSource[],
  buildings: BuildingShotSource[] = []
): RangedWorld {
  return { units, buildings };
}

describe('distanceToFootprint', () => {
  // 2x2 footprint spanning 4..6 on both axes.
  const building = tower({ gridX: 4, gridY: 4 });

  it('is zero anywhere inside the footprint, edges included', () => {
    expect(distanceToFootprint(4, 4, building)).toBe(0);
    expect(distanceToFootprint(5, 5, building)).toBe(0);
    expect(distanceToFootprint(6, 6, building)).toBe(0);
  });

  it('measures to the nearest edge from outside', () => {
    expect(distanceToFootprint(3, 5, building)).toBe(1);
    expect(distanceToFootprint(9, 5, building)).toBe(3);
    expect(distanceToFootprint(3, 9, building)).toBeCloseTo(Math.hypot(1, 3));
  });
});

describe('RangedFireSim archers', () => {
  it('draws the bow for ARCHER_DRAW_MS before the first arrow, then fires on the blueprint cadence', () => {
    const sim = new RangedFireSim();
    const units = [archer(), enemy()];

    expect(sim.update(0, world(units))).toEqual([]);
    expect(sim.update(ARCHER_DRAW_MS - 1, world(units))).toEqual([]);

    expect(sim.update(ARCHER_DRAW_MS, world(units))).toEqual([
      {
        shooterId: 'archer-1',
        shooterKind: 'unit',
        fromX: 10,
        fromY: 10,
        targetId: 'enemy-1',
        toX: 12,
        toY: 10
      }
    ]);

    expect(sim.update(ARCHER_DRAW_MS + 1, world(units))).toEqual([]);
    expect(sim.update(ARCHER_DRAW_MS + ARCHER_COOLDOWN_MS, world(units))).toHaveLength(1);
  });

  it('releases at most one arrow per update, however long the frame was', () => {
    const sim = new RangedFireSim();
    const units = [archer(), enemy()];

    sim.update(0, world(units));
    sim.update(ARCHER_DRAW_MS, world(units));

    // A stalled tab must not release a burst to catch up on cooldowns it never
    // drew; the arrow after a long frame waits for the next cooldown.
    expect(
      sim.update(ARCHER_DRAW_MS + ARCHER_COOLDOWN_MS * 4, world(units))
    ).toHaveLength(1);
  });

  it('never fires for a melee unit, even while it is attacking in range', () => {
    const sim = new RangedFireSim();
    // Half a tile away, so range is not what keeps this one quiet: the
    // blueprint's reach is melee, and only ranged weapons draw arrows.
    const spearman = archer({ id: 'spearman-1', type: 'SPEARMAN' });
    const adjacent = enemy({ x: 10.5 });

    for (const now of [0, ARCHER_DRAW_MS, ARCHER_DRAW_MS + ARCHER_COOLDOWN_MS, 60_000]) {
      expect(sim.update(now, world([spearman, adjacent]))).toEqual([]);
    }
  });

  it('holds fire while the target is outside the archer range', () => {
    const sim = new RangedFireSim();
    const farEnemy = enemy({ x: 10 + ARCHER_RANGE + 1 });

    expect(sim.update(0, world([archer(), farEnemy]))).toEqual([]);
    expect(sim.update(ARCHER_DRAW_MS, world([archer(), farEnemy]))).toEqual([]);
    expect(sim.update(ARCHER_DRAW_MS * 2, world([archer(), farEnemy]))).toEqual([]);

    // Walking back into range starts a fresh draw rather than an instant arrow.
    const inRange = [archer(), enemy()];
    expect(sim.update(2000, world(inRange))).toEqual([]);
    expect(sim.update(2000 + ARCHER_DRAW_MS, world(inRange))).toHaveLength(1);
  });

  it('holds fire when the target id does not resolve or resolves to the wrong kind', () => {
    const sim = new RangedFireSim();
    const ghost = archer({ targetEntityId: 'ghost-1' });
    const wrongType = archer({ targetEntityType: 'resource', targetEntityId: 'enemy-1' });
    const unitIdAsBuilding = archer({
      targetEntityType: 'building',
      targetEntityId: 'enemy-1'
    });
    const missingBuilding = archer({
      targetEntityType: 'building',
      targetEntityId: 'ghost-building'
    });

    for (const broken of [ghost, wrongType, unitIdAsBuilding, missingBuilding]) {
      expect(sim.update(0, world([broken, enemy()]))).toEqual([]);
      expect(sim.update(ARCHER_DRAW_MS, world([broken, enemy()]))).toEqual([]);
    }
  });

  it('measures a building target to its footprint and aims at its centre', () => {
    const sim = new RangedFireSim();
    // Footprint spans 14..16 x 8..10: the near edge is four tiles from the
    // archer, so this is in range even though the centre is 5.1 tiles away.
    const house = tower({
      id: 'house-1',
      ownerId: 'player-2',
      type: 'HOUSE',
      gridX: 14,
      gridY: 8
    });
    const attackingHouse = archer({ targetEntityId: 'house-1', targetEntityType: 'building' });

    expect(sim.update(0, world([attackingHouse], [house]))).toEqual([]);
    expect(sim.update(ARCHER_DRAW_MS, world([attackingHouse], [house]))).toEqual([
      {
        shooterId: 'archer-1',
        shooterKind: 'unit',
        fromX: 10,
        fromY: 10,
        targetId: 'house-1',
        toX: 15,
        toY: 9
      }
    ]);

    // The same building pushed four tiles further: the footprint edge is now out
    // of reach even though the archer is still "close" to the wall.
    const farHouse = tower({
      id: 'house-2',
      ownerId: 'player-2',
      type: 'HOUSE',
      gridX: 18,
      gridY: 8
    });
    const attackingFarHouse = archer({
      targetEntityId: 'house-2',
      targetEntityType: 'building'
    });
    const farSim = new RangedFireSim();

    expect(farSim.update(0, world([attackingFarHouse], [farHouse]))).toEqual([]);
    expect(farSim.update(ARCHER_DRAW_MS, world([attackingFarHouse], [farHouse]))).toEqual([]);
  });

  it('drops the draw clock when the archer leaves ATTACKING, so re-engaging draws again', () => {
    const sim = new RangedFireSim();
    const engaged = [archer(), enemy()];

    sim.update(0, world(engaged));
    // Ordered elsewhere: the fight is over and the bow comes down.
    expect(sim.update(500, world([archer({ actionState: 'MOVING' }), enemy()]))).toEqual([]);

    // Back on the same target 200 ms later: a fresh draw, not a resumed one.
    expect(sim.update(700, world(engaged))).toEqual([]);
    expect(sim.update(700 + ARCHER_DRAW_MS - 1, world(engaged))).toEqual([]);
    expect(sim.update(700 + ARCHER_DRAW_MS, world(engaged))).toHaveLength(1);
  });

  it('drops the draw clock when the target disappears, so re-engaging draws again', () => {
    const sim = new RangedFireSim();
    const engaged = [archer(), enemy()];

    sim.update(0, world(engaged));
    // The target died: it is no longer in the units iterable.
    expect(sim.update(300, world([archer()]))).toEqual([]);

    expect(sim.update(700, world(engaged))).toEqual([]);
    expect(sim.update(700 + ARCHER_DRAW_MS, world(engaged))).toHaveLength(1);
  });
});

describe('RangedFireSim towers', () => {
  it('fires the moment an enemy is in range, then on the blueprint cadence', () => {
    const sim = new RangedFireSim();
    const units = [enemy({ x: 3, y: 3 })];
    const buildings = [tower()];

    // The server's tower cooldown starts at zero, so the first arrow leaves on
    // the first frame the target exists.
    expect(sim.update(0, world(units, buildings))).toEqual([
      {
        shooterId: 'tower-1',
        shooterKind: 'building',
        fromX: 1,
        fromY: 1,
        targetId: 'enemy-1',
        toX: 3,
        toY: 3
      }
    ]);

    expect(sim.update(1, world(units, buildings))).toEqual([]);
    expect(sim.update(TOWER_COOLDOWN_MS, world(units, buildings))).toHaveLength(1);
  });

  it('stays loaded while nothing is in range and fires the frame a target arrives', () => {
    const sim = new RangedFireSim();
    const buildings = [tower()];

    expect(sim.update(0, world([], buildings))).toEqual([]);
    expect(sim.update(5000, world([], buildings))).toEqual([]);
    expect(sim.update(5100, world([enemy({ x: 3, y: 3 })], buildings))).toHaveLength(1);
  });

  it('shoots the nearest enemy unit and ignores units of its own owner', () => {
    const sim = new RangedFireSim();
    const units = [
      // Closest unit of all, but friendly: never a target.
      enemy({ id: 'own-spearman', ownerId: 'player-1', x: 3, y: 3 }),
      enemy({ id: 'far-enemy', x: 6, y: 3 }),
      enemy({ id: 'near-enemy', x: 4, y: 3 })
    ];

    const [shot] = sim.update(0, world(units, [tower()]));

    expect(shot.targetId).toBe('near-enemy');
  });

  it('stays silent when only its own units are around', () => {
    const sim = new RangedFireSim();
    const units = [enemy({ id: 'own-1', ownerId: 'player-1', x: 3, y: 3 })];

    expect(sim.update(0, world(units, [tower()]))).toEqual([]);
    expect(sim.update(1000, world(units, [tower()]))).toEqual([]);
  });

  it('never fires from a foundation, from a range-less blueprint, or from an unknown type', () => {
    const sim = new RangedFireSim();
    const units = [enemy({ x: 3, y: 3 })];
    const foundation = tower({ isConstructed: false });
    // A house is finished, but SIM-03 gives it `attackRange: 0`: no weapon.
    const house = tower({ id: 'house-1', type: 'HOUSE' });
    // A type this client does not know (a newer server) is skipped, not trusted.
    const unknown = tower({ id: 'future-1', type: 'SKY_KEEP' });

    for (const building of [foundation, house, unknown]) {
      expect(sim.update(0, world(units, [building]))).toEqual([]);
      expect(sim.update(1000, world(units, [building]))).toEqual([]);
    }
  });
});

describe('RangedFireSim timer bookkeeping', () => {
  it('prunes the clock of an archer that left the world', () => {
    const sim = new RangedFireSim();
    const engaged = [archer(), enemy()];

    sim.update(0, world(engaged));
    expect(sim.update(ARCHER_DRAW_MS, world(engaged))).toHaveLength(1);
    // Fired at 700, so a leaked clock would be ready again at 2100.

    // The archer died at 1000 and a fresh one (same id) spawned at 3000.
    expect(sim.update(1000, world([enemy()]))).toEqual([]);
    expect(sim.update(3000, world(engaged))).toEqual([]);
    expect(sim.update(3000 + ARCHER_DRAW_MS, world(engaged))).toHaveLength(1);
  });

  it('prunes the clock of a tower that left the world', () => {
    const sim = new RangedFireSim();
    const units = [enemy({ x: 3, y: 3 })];
    const buildings = [tower()];

    expect(sim.update(0, world(units, buildings))).toHaveLength(1);
    // Fired at 0, so a leaked clock would be ready again at 2000.

    // Demolished at 100 and rebuilt (same id) at 1000: the rebuilt tower has not
    // fired yet, so it must be loaded rather than still on the old cooldown.
    expect(sim.update(100, world(units, []))).toEqual([]);
    expect(sim.update(1000, world(units, buildings))).toHaveLength(1);
  });

  it('forget() drops one shooter and leaves the others alone', () => {
    const sim = new RangedFireSim();
    const units = [archer(), enemy(), towerBait()];
    const buildings = [tower()];

    // The tower fires at 0; the archer starts drawing at 0.
    sim.update(0, world(units, buildings));
    sim.forget('archer-1');

    // At 2000 the tower's own clock is due. The forgotten archer has to draw
    // from scratch, so it contributes nothing here.
    const [shot] = sim.update(TOWER_COOLDOWN_MS, world(units, buildings));
    expect(shot.shooterId).toBe('tower-1');
  });

  it('reset() clears every clock, for a scene that rebinds to another room', () => {
    const sim = new RangedFireSim();
    const units = [archer(), enemy(), towerBait()];
    const buildings = [tower()];

    sim.update(0, world(units, buildings));
    expect(sim.update(ARCHER_DRAW_MS, world(units, buildings))).toHaveLength(1);

    sim.reset();

    // The tower is loaded again and fires at once; the archer has to draw again.
    const [first] = sim.update(800, world(units, buildings));
    expect(first.shooterId).toBe('tower-1');
    const [second] = sim.update(800 + ARCHER_DRAW_MS, world(units, buildings));
    expect(second.shooterId).toBe('archer-1');
  });

  it('is deterministic: the same update sequence yields the same arrows', () => {
    const run = () => {
      const sim = new RangedFireSim();
      const units = [archer(), enemy(), towerBait()];
      const buildings = [tower()];
      return [0, 350, ARCHER_DRAW_MS, 1000, TOWER_COOLDOWN_MS, 3000].map((now) =>
        sim.update(now, world(units, buildings))
      );
    };

    expect(run()).toEqual(run());
  });
});
