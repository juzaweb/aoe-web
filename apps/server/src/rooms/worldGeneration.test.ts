import { describe, expect, it } from 'vitest';
import { TERRAIN_KINGDOM, isDirtRoadTile, isPlazaTile } from '@chien-quoc/shared';
import { WorldState } from '../schema/WorldState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { generateWorldResources } from './worldGeneration.js';

/** Closest distance from a tile to any map border, in tiles. */
function edgeDistance(gx: number, gy: number, width: number, height: number): number {
  return Math.min(gx, gy, width - 1 - gx, height - 1 - gy);
}

function nodesOf(state: WorldState): ResourceNodeState[] {
  const nodes: ResourceNodeState[] = [];
  state.resourceNodes.forEach((node: ResourceNodeState) => nodes.push(node));
  return nodes;
}

describe('generateWorldResources - kingdom edge band', () => {
  it('keeps every generated cluster on the map border', () => {
    const state = new WorldState();
    state.mapWidth = TERRAIN_KINGDOM.width;
    state.mapHeight = TERRAIN_KINGDOM.height;
    state.zoneId = 'kingdom:tester';

    generateWorldResources(state, TERRAIN_KINGDOM);

    // A cluster centre may sit up to `depth()` inside the ring; a tree may
    // spread 3 tiles further. 26 tiles covers both plus the spawn inset.
    for (const node of nodesOf(state)) {
      expect(edgeDistance(node.gridX, node.gridY, TERRAIN_KINGDOM.width, TERRAIN_KINGDOM.height))
        .toBeLessThanOrEqual(26);
    }
  });

  it('places wood and gold on all four edges', () => {
    const state = new WorldState();
    state.mapWidth = TERRAIN_KINGDOM.width;
    state.mapHeight = TERRAIN_KINGDOM.height;
    state.zoneId = 'kingdom:tester';

    generateWorldResources(state, TERRAIN_KINGDOM);

    const wood = { top: 0, bottom: 0, left: 0, right: 0 };
    const gold = { top: 0, bottom: 0, left: 0, right: 0 };
    const width = TERRAIN_KINGDOM.width;
    const height = TERRAIN_KINGDOM.height;

    for (const node of nodesOf(state)) {
      const targets =
        node.type === 'TREE' ? wood : node.type === 'GOLD_MINE' ? gold : null;
      if (!targets) continue;

      const dx = node.gridX;
      const dy = node.gridY;
      const among = [
        { key: 'top' as const, value: dy },
        { key: 'bottom' as const, value: height - 1 - dy },
        { key: 'left' as const, value: dx },
        { key: 'right' as const, value: width - 1 - dx }
      ].sort((a, b) => a.value - b.value)[0];
      targets[among.key]++;
    }

    expect(wood.top).toBeGreaterThan(0);
    expect(wood.bottom).toBeGreaterThan(0);
    expect(wood.left).toBeGreaterThan(0);
    expect(wood.right).toBeGreaterThan(0);
    expect(gold.top).toBeGreaterThan(0);
    expect(gold.bottom).toBeGreaterThan(0);
    expect(gold.left).toBeGreaterThan(0);
    expect(gold.right).toBeGreaterThan(0);
  });

  it('stays out of the roads and the central plaza', () => {
    const state = new WorldState();
    state.mapWidth = TERRAIN_KINGDOM.width;
    state.mapHeight = TERRAIN_KINGDOM.height;
    state.zoneId = 'kingdom:tester';

    generateWorldResources(state, TERRAIN_KINGDOM);

    for (const node of nodesOf(state)) {
      expect(isDirtRoadTile(node.gridX, node.gridY, TERRAIN_KINGDOM)).toBe(false);
      expect(isPlazaTile(node.gridX, node.gridY, TERRAIN_KINGDOM)).toBe(false);
    }
  });

  it('generates a denser ring than the old 25% layout', () => {
    const state = new WorldState();
    state.mapWidth = TERRAIN_KINGDOM.width;
    state.mapHeight = TERRAIN_KINGDOM.height;
    state.zoneId = 'kingdom:tester';

    generateWorldResources(state, TERRAIN_KINGDOM);

    // 32 forests x 9-13 trees + 18 gold + 14 stone + 14 berries, minus the
    // tiles the ring drops (road, plaza, overlap). Measured 406-464 over ten
    // seeds; the old layout produced ~274.
    expect(state.resourceNodes.size).toBeGreaterThan(380);
    expect(state.resourceNodes.size).toBeLessThan(680);
  });

  it('leaves the battlefield scatter untouched', () => {
    const state = new WorldState();
    state.mapWidth = 220;
    state.mapHeight = 220;
    state.zoneId = 'battlefield';

    generateWorldResources(state, { width: 220, height: 220, kind: 'battlefield' });

    let centerCount = 0;
    state.resourceNodes.forEach((node: ResourceNodeState) => {
      const distance = Math.min(node.gridX, node.gridY, 219 - node.gridX, 219 - node.gridY);
      if (distance > 40) centerCount++;
    });
    // The battlefield still scatters across the whole map, not just the border.
    expect(centerCount).toBeGreaterThan(100);
  });
});
