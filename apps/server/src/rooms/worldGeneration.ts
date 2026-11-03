import { MapTerrain, isDirtRoadTile, isPlazaTile } from '@chien-quoc/shared';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { WorldState } from '../schema/WorldState.js';
import { entityIds } from '../services/EntityIdAllocator.js';

interface ResourcePlan {
  forests: number;
  treesPerForest: number;
  gold: number;
  stone: number;
  berries: number;
}

/**
 * Cluster counts per map kind.
 *
 * A 110x110 kingdom is 25% of the battlefield's area, so it gets 25% of the
 * clusters. Keeping the battlefield numbers untouched is deliberate: its
 * resource layout is part of the map players already know.
 */
function resourcePlan(terrain: MapTerrain): ResourcePlan {
  if (terrain.kind === 'kingdom') {
    return { forests: 21, treesPerForest: 8, gold: 10, stone: 8, berries: 10 };
  }
  return { forests: 85, treesPerForest: 12, gold: 40, stone: 32, berries: 40 };
}

/**
 * Fills an empty map with natural AoE-style resource clusters, sized to
 * `terrain`.
 *
 * Nodes are only placed on this map's playable area. A kingdom additionally
 * keeps its road network and central plaza clear: at 110 tiles a node on the
 * road is in the way all the time, and the plaza has to stay free for the Town
 * Center. The battlefield keeps its historical (slightly overlapping) layout.
 */
export function generateWorldResources(state: WorldState, terrain: MapTerrain): void {
  const { width, height } = terrain;
  const plan = resourcePlan(terrain);
  const occupiedTiles = new Set<string>();

  const spawnNode = (
    type: string,
    res: 'wood' | 'food' | 'gold' | 'stone',
    gx: number,
    gy: number,
    amount: number
  ) => {
    if (gx < 5 || gx >= width - 5 || gy < 5 || gy >= height - 5) return;
    if (terrain.kind === 'kingdom' && (isDirtRoadTile(gx, gy, terrain) || isPlazaTile(gx, gy, terrain))) {
      return;
    }
    const key = `${gx},${gy}`;
    if (occupiedTiles.has(key)) return;

    occupiedTiles.add(key);
    const id = `res_${entityIds.nextId()}`;
    const node = new ResourceNodeState();
    node.id = id;
    node.type = type;
    node.resourceType = res;
    node.gridX = gx;
    node.gridY = gy;
    node.remainingAmount = amount;
    node.maxAmount = amount;
    state.resourceNodes.set(id, node);
  };

  // 1. Forest Groves (dense clusters, 12-16 trees each on the battlefield)
  for (let c = 0; c < plan.forests; c++) {
    const cx = Math.floor(8 + Math.random() * (width - 16));
    const cy = Math.floor(8 + Math.random() * (height - 16));
    const treeCount = plan.treesPerForest + Math.floor(Math.random() * 5);
    for (let t = 0; t < treeCount; t++) {
      const dx = Math.floor(Math.random() * 5) - 2;
      const dy = Math.floor(Math.random() * 5) - 2;
      spawnNode('TREE', 'wood', cx + dx, cy + dy, 200);
    }
  }

  // 2. Gold Veins (3-5 gold nodes each)
  for (let c = 0; c < plan.gold; c++) {
    const cx = Math.floor(10 + Math.random() * (width - 20));
    const cy = Math.floor(10 + Math.random() * (height - 20));
    const nodeCount = 3 + Math.floor(Math.random() * 3);
    for (let n = 0; n < nodeCount; n++) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      spawnNode('GOLD_MINE', 'gold', cx + dx, cy + dy, 800);
    }
  }

  // 3. Stone Quarries (3-4 stone nodes each)
  for (let c = 0; c < plan.stone; c++) {
    const cx = Math.floor(10 + Math.random() * (width - 20));
    const cy = Math.floor(10 + Math.random() * (height - 20));
    const nodeCount = 3 + Math.floor(Math.random() * 2);
    for (let n = 0; n < nodeCount; n++) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      spawnNode('STONE_MINE', 'stone', cx + dx, cy + dy, 600);
    }
  }

  // 4. Berry Groves (4-6 bushes each)
  for (let c = 0; c < plan.berries; c++) {
    const cx = Math.floor(10 + Math.random() * (width - 20));
    const cy = Math.floor(10 + Math.random() * (height - 20));
    const bushCount = 4 + Math.floor(Math.random() * 3);
    for (let b = 0; b < bushCount; b++) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      spawnNode('BERRY_BUSH', 'food', cx + dx, cy + dy, 150);
    }
  }
}
