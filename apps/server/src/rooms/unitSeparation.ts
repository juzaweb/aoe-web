import { UnitState } from '../schema/UnitState.js';

/**
 * Minimum distance between two unit centres, in tiles.
 *
 * A unit's body is a little over half a tile wide once its sheet is scaled, so
 * two figures closer than this draw on top of each other and a squad reads as one
 * soldier instead of five. Formation cells are laid out at exactly this spacing
 * (see `FORMATION_SPACING`), so a group ordered to a point arrives already legal
 * and this pass rarely has anything to undo.
 */
export const UNIT_SEPARATION = 0.6;

/**
 * Fastest a unit may be shoved out of an overlap, in tiles per second.
 *
 * The shove is a presentation fix, not a walk: quick enough that a freshly
 * trained squad settles within a fraction of a second, slow enough that no single
 * tick teleports a figure. Two tiles per second is a tenth of a tile per tick at
 * the 20 Hz sim rate.
 */
const SEPARATION_PUSH_SPEED = 2;

/**
 * How far from its own destination a unit may stand and still count as parked.
 *
 * A parked unit's destination is where it stands, so a shove has to move that
 * destination with it — otherwise the next tick sees the unit a few hundredths of
 * a tile off its target, walks back, and the pair buzzes forever. A unit with a
 * real destination keeps it: dragging that along would slide the squad off course.
 * The threshold matches the movement step's own 0.15 arrival tolerance with slack,
 * so a unit that has just arrived still counts as parked.
 */
const PARKED_TARGET_RADIUS = 0.2;

/**
 * Tells the pass which tiles a unit may not be pushed onto.
 *
 * The unit is passed because an on-wall figure uses the wall-top layer, where
 * almost every tile is blocked, while a ground figure uses the courtyard layer.
 */
export type BlockedTileTest = (unit: UnitState, x: number, y: number) => boolean;

/** Anything that can enumerate the room's units; `MapSchema` satisfies it. */
export interface UnitSource {
  readonly size: number;
  forEach(cb: (unit: UnitState) => void): void;
}

/**
 * Deterministic direction two exactly co-located units are pushed apart along.
 *
 * A pure hash of both ids, so the pair picks the same direction on every tick and
 * in every process instead of flipping between axes and making the sprites buzz.
 */
function separationAngle(aId: string, bId: string): number {
  let hash = 2166136261;
  const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

/**
 * Pushes overlapping units apart so a squad reads as N figures, not one.
 *
 * Units do not block each other — only buildings and resource nodes occupy a
 * tile — so a group ordered onto one point, or trained one after another at the
 * same front door, ends up on identical coordinates and would draw as a single
 * soldier. Nothing else in the simulation separates them.
 *
 * This is not an order: the route and the action state are untouched, so a
 * walking unit keeps walking and a harvester keeps harvesting — both interact
 * from ranges several separation radii wide. Only a parked unit's destination
 * moves, and only by the amount it was shoved (see
 * {@link PARKED_TARGET_RADIUS}).
 *
 * Displacements are accumulated across the whole pass and applied afterwards, so
 * the outcome does not depend on the order units are visited in.
 *
 * One instance per room: the scratch buffers are reused, because allocating
 * several arrays per tick would hand the collector work for the process lifetime.
 */
export class UnitSeparation {
  /**
   * Positions copied out of the Schema before the pair scan. Every `unit.x` read
   * goes through a Colyseus proxy getter; at 1600 units the scan measured 5.5 ms
   * through the proxy against 2.1 ms over plain arrays, and the copy is O(n).
   */
  private readonly posX: number[] = [];
  private readonly posY: number[] = [];
  /** Unit indices ordered by x bucket, plus each bucket's offset in it. */
  private readonly order: number[] = [];
  private readonly bucketStart: number[] = [];
  private readonly bucketCursor: number[] = [];
  private readonly units: UnitState[] = [];
  private readonly shiftX: number[] = [];
  private readonly shiftY: number[] = [];

  /**
   * Runs one separation pass over every unit in `unitMap`.
   *
   * @param unitMap Authoritative units of the room; the pass mutates the `x`/`y`
   *   of the entries it shoves.
   * @param dtSeconds Tick duration, which bounds how far one unit may move.
   * @param mapWidth Map size, so a shove at the edge cannot push a unit off the
   *   world.
   * @param mapHeight See `mapWidth`.
   * @param isBlocked Tile predicate, so a shove can never push a figure into a
   *   wall.
   */
  separate(
    unitMap: UnitSource,
    dtSeconds: number,
    mapWidth: number,
    mapHeight: number,
    isBlocked: BlockedTileTest
  ) {
    const maxPush = SEPARATION_PUSH_SPEED * dtSeconds;
    if (!(maxPush > 0)) return;

    const count = unitMap.size;
    if (count < 2) return;

    this.gather(unitMap, count);
    this.shiftX.length = count;
    this.shiftY.length = count;
    this.shiftX.fill(0);
    this.shiftY.fill(0);

    const buckets = this.sortByX(count);
    if (buckets === 0) return;
    this.scanPairs(buckets, maxPush);
    this.applyShifts(count, maxPush, mapWidth, mapHeight, isBlocked);
  }

  private gather(unitMap: UnitSource, count: number) {
    const units = this.units;
    units.length = 0;
    unitMap.forEach((unit: UnitState) => units.push(unit));

    const posX = this.posX;
    const posY = this.posY;
    posX.length = count;
    posY.length = count;
    for (let i = 0; i < count; i++) {
      posX[i] = units[i].x;
      posY[i] = units[i].y;
    }
  }

  /**
   * Counting-sorts unit indices by x into buckets {@link UNIT_SEPARATION} wide.
   *
   * Two units can only overlap when their x values differ by less than the
   * separation, so with this order every overlapping pair lives in the same
   * bucket or in the one after it. That turns the sweep into O(n + nearby pairs):
   * measured 1600 units drop from 10.7 ms to 0.45 ms per pass, and the cost no
   * longer grows with the square of the army size.
   *
   * @returns Number of buckets, i.e. the range `0..buckets` of valid offsets.
   */
  private sortByX(count: number): number {
    const posX = this.posX;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = posX[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }

    // A non-finite coordinate would poison the histogram; skip the pass instead of
    // scattering every unit from a NaN bucket.
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return 0;

    const buckets = Math.floor((maxX - minX) / UNIT_SEPARATION) + 1;
    const start = this.bucketStart;
    start.length = buckets + 1;
    start.fill(0);

    // Entry `c + 1` is incremented first, so after the prefix sum `start[c]` is
    // bucket `c`'s offset and `start[buckets]` is the total.
    for (let i = 0; i < count; i++) start[this.bucketOfX(posX[i], minX) + 1]++;
    for (let c = 0; c < buckets; c++) start[c + 1] += start[c];

    const order = this.order;
    order.length = count;
    const cursor = this.bucketCursor;
    cursor.length = buckets + 1;
    for (let c = 0; c <= buckets; c++) cursor[c] = start[c];
    // Backwards placement keeps the sort stable, so identical inputs always
    // produce the same iteration order — the pass is deterministic.
    for (let i = count - 1; i >= 0; i--) {
      order[cursor[this.bucketOfX(posX[i], minX)]++] = i;
    }

    return buckets;
  }

  private bucketOfX(x: number, minX: number): number {
    return Math.floor((x - minX) / UNIT_SEPARATION);
  }

  /** Adds one half-shove per overlapping pair into the shift accumulators. */
  private scanPairs(buckets: number, maxPush: number) {
    const posX = this.posX;
    const posY = this.posY;
    const order = this.order;
    const start = this.bucketStart;
    const units = this.units;
    const shiftX = this.shiftX;
    const shiftY = this.shiftY;

    const pushApart = (i: number, j: number, dx: number, dy: number) => {
      let nx = dx;
      let ny = dy;
      let dist = Math.hypot(dx, dy);
      if (dist >= UNIT_SEPARATION) return;

      if (dist < 1e-4) {
        const angle = separationAngle(units[i].id, units[j].id);
        nx = Math.cos(angle);
        ny = Math.sin(angle);
        dist = 0;
      }

      // Half the remaining gap each, so neither unit is treated as the anchor.
      const push = Math.min(maxPush / 2, (UNIT_SEPARATION - dist) / 2);
      const inv = 1 / (dist || 1);
      shiftX[i] -= nx * inv * push;
      shiftY[i] -= ny * inv * push;
      shiftX[j] += nx * inv * push;
      shiftY[j] += ny * inv * push;
    };

    for (let c = 0; c < buckets; c++) {
      const first = start[c];
      const last = start[c + 1];
      const nextLast = c + 2 <= buckets ? start[c + 2] : last;

      for (let a = first; a < last; a++) {
        const i = order[a];
        const ax = posX[i];
        const ay = posY[i];

        for (let b = a + 1; b < last; b++) {
          const j = order[b];
          // Cheap reject before the square root: most same-bucket pairs are far
          // apart on y even though they share an x band.
          const dy = posY[j] - ay;
          if (dy >= UNIT_SEPARATION || dy <= -UNIT_SEPARATION) continue;
          pushApart(i, j, posX[j] - ax, dy);
        }

        // `continue`, not `break`: the counting sort keeps units in insertion
        // order inside a bucket, so this bucket is not itself x-sorted. Buckets
        // are only one separation wide, so the extra checks stay bounded.
        for (let b = last; b < nextLast; b++) {
          const j = order[b];
          const dx = posX[j] - ax;
          if (dx >= UNIT_SEPARATION) continue;
          pushApart(i, j, dx, posY[j] - ay);
        }
      }
    }
  }

  /** Applies the accumulated shove, clamped and checked against obstacles. */
  private applyShifts(
    count: number,
    maxPush: number,
    mapWidth: number,
    mapHeight: number,
    isBlocked: BlockedTileTest
  ) {
    const units = this.units;
    const shiftX = this.shiftX;
    const shiftY = this.shiftY;
    const maxX = mapWidth - 1;
    const maxY = mapHeight - 1;

    for (let i = 0; i < count; i++) {
      const totalX = shiftX[i];
      const totalY = shiftY[i];
      if (totalX === 0 && totalY === 0) continue;

      const unit = units[i];
      // A unit surrounded on several sides accumulates one shove per neighbour;
      // clamp the total so a crowded squad settles instead of teleporting.
      const total = Math.hypot(totalX, totalY);
      const scale = total > maxPush ? maxPush / total : 1;

      // The shove is a nudge, never a teleport: clamping to the map keeps a squad
      // trained at a corner from being pushed off the world.
      const x = Math.max(0, Math.min(maxX, unit.x + totalX * scale));
      const y = Math.max(0, Math.min(maxY, unit.y + totalY * scale));
      // A shove must never push a figure into a wall. A unit already standing on a
      // blocked tile — a villager working the node tile itself — is exempt, or two
      // harvesters would stay stacked forever on ground they cannot leave.
      if (
        isBlocked(unit, Math.floor(x), Math.floor(y)) &&
        !isBlocked(unit, Math.floor(unit.x), Math.floor(unit.y))
      ) {
        continue;
      }

      // Measured before the move, because "parked" is about where the unit stood
      // when the tick began, not where the shove is about to put it.
      const parked =
        Math.hypot(unit.targetX - unit.x, unit.targetY - unit.y) < PARKED_TARGET_RADIUS;

      const appliedX = x - unit.x;
      const appliedY = y - unit.y;
      unit.x = x;
      unit.y = y;

      if (parked) {
        unit.targetX = Math.max(0, Math.min(maxX, unit.targetX + appliedX));
        unit.targetY = Math.max(0, Math.min(maxY, unit.targetY + appliedY));
      }
    }
  }
}
