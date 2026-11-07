import { BUILDING_BLUEPRINTS } from '../constants/index.js';
import type { BuildingType } from '../types/index.js';
import { getBuildingLevelStats } from './levels.js';

/**
 * Geometry and scoring rules for a kingdom's citadel.
 *
 * Every kingdom owns one citadel: a walled compound with a Town Center, two
 * barracks and five houses. The layout is a pure function of the Town Center's
 * top-left tile, so the server (which spawns the buildings and blocks movement
 * through the walls) and the client (which draws the stone floor and walls and
 * shows the aggregate health bar) cannot disagree without a round trip.
 *
 * The citadel's health is the sum of the health of its eight buildings. It is a
 * raid score, not a second building: when it falls to
 * {@link CITADEL_HP_THRESHOLD}, the attacker has won.
 */

/** Side length of the walled compound, in tiles. */
export const CITADEL_SIZE = 17;

/** Town Center top-left offset from the compound's top-left corner. */
export const CITADEL_TOWN_CENTER_OFFSET_X = 1;
export const CITADEL_TOWN_CENTER_OFFSET_Y = 6;

/** Width of the single gate opening in the middle of the east wall. */
export const CITADEL_GATE_WIDTH = 3;

/** Share of the citadel's maximum HP at which a raid is lost. */
export const CITADEL_HP_THRESHOLD = 0.2;

/** One building slot, in map tiles. */
export interface CitadelSlot {
  type: BuildingType;
  gridX: number;
  gridY: number;
  sizeX: number;
  sizeY: number;
}

/** One wall tile, in map tiles. */
export interface CitadelTile {
  gridX: number;
  gridY: number;
}

/** The complete citadel geometry for one Town Center position. */
export interface CitadelLayout {
  originX: number;
  originY: number;
  size: number;
  /** Inclusive interior bounds; the stone floor fills these tiles. */
  innerMinX: number;
  innerMinY: number;
  innerMaxX: number;
  innerMaxY: number;
  slots: CitadelSlot[];
  walls: CitadelTile[];
  /** Tiles intentionally left open so units can walk in and out. */
  gates: CitadelTile[];
}

interface SlotOffset {
  type: BuildingType;
  dx: number;
  dy: number;
}

/**
 * The eight buildings, relative to the compound's top-left corner.
 *
 * The citadel faces east: the single gate sits in the middle of the east wall
 * and a straight walkway runs west to the Town Center at the far end. Barracks
 * are grouped along the north side of the walkway and houses along the south
 * side, so the compound reads as two wings around one avenue.
 */
const SLOT_OFFSETS: readonly SlotOffset[] = [
  { type: 'TOWN_CENTER', dx: 1, dy: 6 },
  { type: 'BARRACKS', dx: 8, dy: 2 },
  { type: 'BARRACKS', dx: 12, dy: 2 },
  { type: 'HOUSE', dx: 2, dy: 12 },
  { type: 'HOUSE', dx: 5, dy: 12 },
  { type: 'HOUSE', dx: 8, dy: 12 },
  { type: 'HOUSE', dx: 11, dy: 12 },
  { type: 'HOUSE', dx: 14, dy: 12 }
];

function slotSize(type: BuildingType): { sizeX: number; sizeY: number } {
  const blueprint = BUILDING_BLUEPRINTS[type];
  return {
    sizeX: blueprint?.sizeX ?? 1,
    sizeY: blueprint?.sizeY ?? 1
  };
}

/** Gate tiles always sit in the middle third of the east wall. */
function gateStart(): number {
  return Math.floor((CITADEL_SIZE - CITADEL_GATE_WIDTH) / 2);
}

/**
 * Top-left tile of the centred compound on a `mapWidth x mapHeight` map.
 *
 * A cheap primitive for callers that only need the bounding square (the
 * resource generator runs it for every tile) and the source of truth for
 * {@link citadelTownCenterFor}.
 */
export function citadelOriginFor(
  mapWidth: number,
  mapHeight: number
): { originX: number; originY: number } {
  return {
    originX: Math.round((mapWidth - CITADEL_SIZE) / 2),
    originY: Math.round((mapHeight - CITADEL_SIZE) / 2)
  };
}

/**
 * Town Center position of a kingdom citadel centred on a `mapWidth x mapHeight` map.
 *
 * The compound sits in the middle of the map and faces east: its only gate is on
 * the east wall. Both the server's spawn and the client's terrain exclusion read
 * this, so every kingdom starts with the same centred citadel.
 */
export function citadelTownCenterFor(
  mapWidth: number,
  mapHeight: number
): { gridX: number; gridY: number } {
  const { originX, originY } = citadelOriginFor(mapWidth, mapHeight);
  return {
    gridX: originX + CITADEL_TOWN_CENTER_OFFSET_X,
    gridY: originY + CITADEL_TOWN_CENTER_OFFSET_Y
  };
}

/** Whether a building footprint covers any of the given wall tiles. */
export function footprintTouchesWalls(
  walls: readonly CitadelTile[],
  gridX: number,
  gridY: number,
  sizeX: number,
  sizeY: number
): boolean {
  return walls.some(
    (wall) =>
      wall.gridX >= gridX &&
      wall.gridX < gridX + sizeX &&
      wall.gridY >= gridY &&
      wall.gridY < gridY + sizeY
  );
}

/**
 * Full citadel geometry for the Town Center anchored at `townCenterGridX/Y`.
 *
 * Only the Town Center's top-left tile is needed: every other slot and wall
 * tile is an offset from it.
 */
export function citadelLayoutFor(
  townCenterGridX: number,
  townCenterGridY: number
): CitadelLayout {
  const originX = townCenterGridX - CITADEL_TOWN_CENTER_OFFSET_X;
  const originY = townCenterGridY - CITADEL_TOWN_CENTER_OFFSET_Y;

  const slots: CitadelSlot[] = SLOT_OFFSETS.map(({ type, dx, dy }) => {
    const { sizeX, sizeY } = slotSize(type);
    return {
      type,
      gridX: originX + dx,
      gridY: originY + dy,
      sizeX,
      sizeY
    };
  });

  const gates: CitadelTile[] = [];
  const gateFrom = gateStart();
  const gateTo = gateFrom + CITADEL_GATE_WIDTH - 1;
  for (let i = gateFrom; i <= gateTo; i++) {
    gates.push({ gridX: originX + CITADEL_SIZE - 1, gridY: originY + i });
  }

  const gateKeys = new Set(gates.map((tile) => `${tile.gridX},${tile.gridY}`));
  const walls: CitadelTile[] = [];
  const pushWall = (gridX: number, gridY: number) => {
    if (gateKeys.has(`${gridX},${gridY}`)) return;
    walls.push({ gridX, gridY });
  };

  for (let i = 0; i < CITADEL_SIZE; i++) {
    pushWall(originX + i, originY);
    pushWall(originX + i, originY + CITADEL_SIZE - 1);
  }
  for (let j = 1; j < CITADEL_SIZE - 1; j++) {
    pushWall(originX, originY + j);
    pushWall(originX + CITADEL_SIZE - 1, originY + j);
  }

  return {
    originX,
    originY,
    size: CITADEL_SIZE,
    innerMinX: originX + 1,
    innerMinY: originY + 1,
    innerMaxX: originX + CITADEL_SIZE - 2,
    innerMaxY: originY + CITADEL_SIZE - 2,
    slots,
    walls,
    gates
  };
}

/** Live state of one building, as needed to score a citadel. */
export interface CitadelBuildingLike {
  type: string;
  gridX: number;
  gridY: number;
  hp: number;
  maxHp: number;
  level?: number;
}

export interface CitadelStatus {
  hp: number;
  maxHp: number;
  /** `hp / maxHp`, or 0 when the citadel has no capacity at all. */
  ratio: number;
}

/** Whether `building` occupies `slot` (same type at the same tile). */
function isInSlot(building: CitadelBuildingLike, slot: CitadelSlot): boolean {
  return (
    building.type === slot.type &&
    Math.round(building.gridX) === slot.gridX &&
    Math.round(building.gridY) === slot.gridY
  );
}

/**
 * Aggregate health of the citadel's eight buildings.
 *
 * A missing slot still counts its level-1 maximum, so losing a building drops
 * the ratio instead of shrinking the denominator alongside it. The baseline is
 * what lets a raid end even after a house has been destroyed outright.
 */
export function citadelStatus(
  buildings: Iterable<CitadelBuildingLike>,
  townCenterGridX: number,
  townCenterGridY: number
): CitadelStatus {
  const list = Array.from(buildings);
  const layout = citadelLayoutFor(townCenterGridX, townCenterGridY);

  let hp = 0;
  let maxHp = 0;
  for (const slot of layout.slots) {
    const building = list.find((candidate) => isInSlot(candidate, slot));
    const baseline = getBuildingLevelStats(slot.type, 1).maxHp;
    if (building) {
      hp += Math.max(0, building.hp);
      maxHp += building.maxHp > 0 ? building.maxHp : baseline;
    } else {
      maxHp += baseline;
    }
  }

  return {
    hp,
    maxHp,
    ratio: maxHp > 0 ? hp / maxHp : 0
  };
}

/** Whether a citadel at `hp` of `maxHp` has lost the fight. */
export function isCitadelBreached(hp: number, maxHp: number): boolean {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return false;
  return hp / maxHp <= CITADEL_HP_THRESHOLD;
}
