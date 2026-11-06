import { MapTerrain, isPlazaTile } from '@chien-quoc/shared';
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

interface ClusterSpot {
  cx: number;
  cy: number;
}

/** Ring width, in tiles, measured from the map border inward. */
const KINGDOM_EDGE_BAND_MIN = 8;
const KINGDOM_EDGE_BAND_MAX = 22;
/** How far a cluster may drift along its edge before hitting the map corner. */
const EDGE_ALONG_MARGIN = 8;

/**
 * Cluster counts per map kind.
 *
 * A kingdom keeps the battlefield's full layout out of the middle: its clusters
 * sit in a ring around the border, so the Town Center and the build area stay
 * open while the frontier still supplies every resource.
 */
function resourcePlan(terrain: MapTerrain): ResourcePlan {
  if (terrain.kind === 'kingdom') {
    return { forests: 32, treesPerForest: 9, gold: 18, stone: 14, berries: 14 };
  }
  return { forests: 85, treesPerForest: 12, gold: 40, stone: 32, berries: 40 };
}

/**
 * Splits `count` clusters evenly across the four map edges.
 *
 * Each cluster sits at a random point along its edge and a random depth inside
 * the ring, so the border reads as a resource frontier while the middle of the
 * map stays open for the Town Center and the build area.
 */
function edgeBandSpots(width: number, height: number, count: number): ClusterSpot[] {
  const perEdge = Math.ceil(count / 4);
  const spots: ClusterSpot[] = [];
  const depth = () =>
    Math.floor(
      KINGDOM_EDGE_BAND_MIN + Math.random() * (KINGDOM_EDGE_BAND_MAX - KINGDOM_EDGE_BAND_MIN)
    );

  for (let edge = 0; edge < 4 && spots.length < count; edge++) {
    const take = Math.min(perEdge, count - spots.length);
    for (let i = 0; i < take; i++) {
      if (edge === 0 || edge === 1) {
        // Top / bottom edge: travel along x, offset inward by `depth()`.
        const gx = Math.floor(EDGE_ALONG_MARGIN + Math.random() * (width - EDGE_ALONG_MARGIN * 2));
        const gy = edge === 0 ? depth() : height - 1 - depth();
        spots.push({ cx: gx, cy: gy });
      } else {
        // Left / right edge: travel along y, offset inward by `depth()`.
        const gy = Math.floor(EDGE_ALONG_MARGIN + Math.random() * (height - EDGE_ALONG_MARGIN * 2));
        const gx = edge === 2 ? depth() : width - 1 - depth();
        spots.push({ cx: gx, cy: gy });
      }
    }
  }
  return spots;
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
    // A kingdom has no generated roads, so only the plaza has to stay clear
    // here. Player-painted roads are dropped by the room's own road layer.
    if (terrain.kind === 'kingdom' && isPlazaTile(gx, gy, terrain)) {
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

  /**
   * Where the clusters of one resource go.
   *
   * A kingdom gets the edge ring, the battlefield keeps its uniform scatter.
   * `margin` is the historical inset of each cluster type on the battlefield.
   */
  const clusterSpots = (count: number, margin: number): ClusterSpot[] => {
    if (terrain.kind === 'kingdom') return edgeBandSpots(width, height, count);
    return Array.from({ length: count }, () => ({
      cx: Math.floor(margin + Math.random() * (width - margin * 2)),
      cy: Math.floor(margin + Math.random() * (height - margin * 2))
    }));
  };

  // 1. Forest Groves (dense clusters, 12-16 trees each on the battlefield)
  for (const { cx, cy } of clusterSpots(plan.forests, 8)) {
    const treeCount = plan.treesPerForest + Math.floor(Math.random() * 5);
    const spread = terrain.kind === 'kingdom' ? 3 : 2;
    for (let t = 0; t < treeCount; t++) {
      const dx = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
      const dy = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
      spawnNode('TREE', 'wood', cx + dx, cy + dy, 200);
    }
  }

  // 2. Gold Veins (3-5 gold nodes each)
  for (const { cx, cy } of clusterSpots(plan.gold, 10)) {
    const nodeCount = 3 + Math.floor(Math.random() * 3);
    for (let n = 0; n < nodeCount; n++) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      spawnNode('GOLD_MINE', 'gold', cx + dx, cy + dy, 800);
    }
  }

  // 3. Stone Quarries (3-4 stone nodes each)
  for (const { cx, cy } of clusterSpots(plan.stone, 10)) {
    const nodeCount = 3 + Math.floor(Math.random() * 2);
    for (let n = 0; n < nodeCount; n++) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      spawnNode('STONE_MINE', 'stone', cx + dx, cy + dy, 600);
    }
  }

  // 4. Berry Groves (4-6 bushes each)
  for (const { cx, cy } of clusterSpots(plan.berries, 10)) {
    const bushCount = 4 + Math.floor(Math.random() * 3);
    for (let b = 0; b < bushCount; b++) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      spawnNode('BERRY_BUSH', 'food', cx + dx, cy + dy, 150);
    }
  }
}
