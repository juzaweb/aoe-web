import { MapTerrain, isDirtRoadTile } from '@chien-quoc/shared';
import { fbm } from '../game/render/visualVariation.js';

/**
 * Minimap rasterisation, kept out of the React component so it can be tested.
 *
 * At 140 CSS px a 220x220 battlefield is 0.64 px per tile: a per-node 2px blip
 * covers 3.1 tiles, so the old square blips merged into a green smear and the
 * forest (a darker green on dark green, 1.66:1) was effectively invisible.
 * Everything here therefore works at a 280x280 backing store and treats icons
 * as *glyphs*: shape first, colour second.
 */
export const MINIMAP_SIZE = 280;
export const MINIMAP_CSS_SIZE = 140;
/**
 * MOB-06: the landscape phone dock. The backing store stays at `MINIMAP_SIZE`, so
 * the radar keeps its detail and only the on-screen scale changes.
 */
export const MINIMAP_COMPACT_CSS_SIZE = 96;

/** Palette measured against the world sprites, then darkened for contrast. */
export const MINIMAP_COLORS = {
  /** Grass mean (102,124,45) darkened to 0.55 - the map should read as ground. */
  grass: [58, 74, 31] as const,
  /** Dirt road mean (173,145,94) lifted so it clears 3:1 on grass. */
  road: [176, 145, 97] as const,
  /** Canopy interior; the rim below is what carries the contrast. */
  forest: '#1d2c0e',
  /** 3.68:1 on grass, so a cluster edge is visible even when its fill is not. */
  forestRim: '#8aab52',
  gold: '#e0ad42',
  stone: '#b0b7bb',
  berry: '#e26a80',
  outline: '#0b1206',
  portal: '#22d3ee',
  viewport: '#ffffff'
} as const;

export type ResourceMarkerType = 'TREE' | 'GOLD_MINE' | 'STONE_MINE' | 'BERRY_BUSH';

export function markerColor(type: string): string {
  switch (type) {
    case 'GOLD_MINE':
      return MINIMAP_COLORS.gold;
    case 'STONE_MINE':
      return MINIMAP_COLORS.stone;
    case 'BERRY_BUSH':
      return MINIMAP_COLORS.berry;
    default:
      return MINIMAP_COLORS.forest;
  }
}

/** Grid coordinate to minimap pixel. One scale for both axes (maps are square). */
export function gridToMinimap(gx: number, gy: number, mapWidth: number): { x: number; y: number } {
  const scale = MINIMAP_SIZE / Math.max(1, mapWidth);
  return { x: gx * scale, y: gy * scale };
}

/** Minimap pixel to fractional grid coordinate (click/pan mapping). */
export function minimapToGrid(px: number, py: number, mapWidth: number): { gx: number; gy: number } {
  const scale = mapWidth / MINIMAP_SIZE;
  return { gx: px * scale, gy: py * scale };
}

/**
 * One RGBA buffer for the whole ground layer: grass noise plus the real road
 * tiles. Built once per layout (280x280 = 78400 pixels) and cached by the
 * component; drawing it is a single `putImageData`.
 */
export function buildGroundPixels(terrain: MapTerrain): Uint8ClampedArray<ArrayBuffer> {
  const pixels: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(MINIMAP_SIZE * MINIMAP_SIZE * 4);
  const scale = terrain.width / MINIMAP_SIZE;
  for (let py = 0; py < MINIMAP_SIZE; py++) {
    const gy = Math.min(terrain.height - 1, Math.floor(py * scale));
    for (let px = 0; px < MINIMAP_SIZE; px++) {
      const gx = Math.min(terrain.width - 1, Math.floor(px * scale));
      const road = isDirtRoadTile(gx, gy, terrain);
      const index = (py * MINIMAP_SIZE + px) * 4;
      if (road) {
        pixels[index] = MINIMAP_COLORS.road[0];
        pixels[index + 1] = MINIMAP_COLORS.road[1];
        pixels[index + 2] = MINIMAP_COLORS.road[2];
      } else {
        // +/-6% low-frequency variation keeps the ground from looking flat
        // without reintroducing the old diagonal hatch.
        const shade = 0.94 + fbm(gx / 30, gy / 30, 0x3a1f, 3) * 0.12;
        pixels[index] = Math.min(255, MINIMAP_COLORS.grass[0] * shade);
        pixels[index + 1] = Math.min(255, MINIMAP_COLORS.grass[1] * shade);
        pixels[index + 2] = Math.min(255, MINIMAP_COLORS.grass[2] * shade);
      }
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Pointer position to fractional grid, measured against the canvas *content*
 * box.
 *
 * The canvas backs 280 pixels into 140 CSS pixels and is drawn with a 1px
 * border, so the border box is 142: dividing by it stretches the mapping by
 * 1.4%, which is a tile and a half at kingdom scale. `contentSize` excludes the
 * border, and the inset is subtracted from the pointer. Results are clamped so
 * a click on the border cannot order a unit off the map.
 */
export function pointerToGrid(
  pointer: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
  contentSize: { width: number; height: number },
  mapWidth: number,
  mapHeight: number
): { gx: number; gy: number } {
  const contentWidth = contentSize.width || rect.width;
  const contentHeight = contentSize.height || rect.height;
  const borderX = (rect.width - contentWidth) / 2;
  const borderY = (rect.height - contentHeight) / 2;
  const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, value));
  return {
    gx: clamp(((pointer.clientX - rect.left - borderX) / contentWidth) * mapWidth, mapWidth),
    gy: clamp(((pointer.clientY - rect.top - borderY) / contentHeight) * mapHeight, mapHeight)
  };
}

/**
 * The portal marker, as a tiny gate silhouette rather than a diamond.
 *
 * At 280 px a 2x2 portal is ~2.5 px, so the glyph is deliberately drawn larger
 * than the footprint (fixed pixel size, like unit dots). Three rectangles make
 * an arch: two pillars and a lintel, leaving the doorway transparent so the
 * ground shows through - that gap is what makes it read as a gate and not as a
 * cyan blob.
 */
export function portalGlyphRects(
  x: number,
  y: number,
  unit = 2.2
): Array<{ x: number; y: number; w: number; h: number }> {
  const pillarWidth = unit;
  const totalWidth = unit * 3.4;
  const pillarHeight = unit * 2.2;
  const lintelHeight = unit * 1.1;
  return [
    { x: x - totalWidth / 2, y: y - pillarHeight / 2, w: pillarWidth, h: pillarHeight },
    { x: x + totalWidth / 2 - pillarWidth, y: y - pillarHeight / 2, w: pillarWidth, h: pillarHeight },
    {
      x: x - totalWidth / 2,
      y: y - pillarHeight / 2 - lintelHeight,
      w: totalWidth,
      h: lintelHeight
    }
  ];
}

export interface MinimapCluster {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
  /** Tile positions of the trees in this clump, for the blob renderer. */
  cells: Array<{ x: number; y: number }>;
}

/**
 * Draws the forest as one blob per clump instead of a bounding square.
 *
 * The old version filled each cluster's bbox, which at 0.64 px/tile turned every
 * forest into an axis-aligned rectangle. Circles around the actual trees union
 * into an organic silhouette; the rim pass is drawn slightly larger so the
 * light edge survives where the fill covers it. The layer is cached and only
 * rebuilt when the clusters change, so the per-frame cost is one drawImage.
 */
export function renderForestLayer(clusters: readonly MinimapCluster[], scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MINIMAP_SIZE;
  canvas.height = MINIMAP_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const radius = Math.max(2.1, scale * 1.7);
  ctx.fillStyle = MINIMAP_COLORS.forestRim;
  for (const cluster of clusters) {
    for (const cell of cluster.cells) {
      ctx.beginPath();
      ctx.arc(cell.x * scale + scale / 2, cell.y * scale + scale / 2, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = MINIMAP_COLORS.forest;
  for (const cluster of clusters) {
    for (const cell of cluster.cells) {
      ctx.beginPath();
      ctx.arc(cell.x * scale + scale / 2, cell.y * scale + scale / 2, radius - 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

export interface MinimapTree {
  gridX: number;
  gridY: number;
}

/**
 * Groups trees into forest clusters.
 *
 * 892 battlefield trees are only ~77 clumps; drawing one blip per tree at 0.64
 * px/tile produces a solid smear that also hides the roads. Clustering first
 * means the minimap draws 77 readable shapes and the count is enough to show
 * density.
 */
export function minimapClusters(trees: readonly MinimapTree[], radius = 2): MinimapCluster[] {
  const occupied = new Set<string>();
  for (const tree of trees) occupied.add(`${tree.gridX},${tree.gridY}`);

  const seen = new Set<string>();
  const clusters: MinimapCluster[] = [];
  for (const tree of trees) {
    const start = `${tree.gridX},${tree.gridY}`;
    if (seen.has(start)) continue;
    seen.add(start);
    const queue: Array<{ x: number; y: number }> = [{ x: tree.gridX, y: tree.gridY }];
    let minX = tree.gridX;
    let minY = tree.gridY;
    let maxX = tree.gridX;
    let maxY = tree.gridY;
    let count = 0;
    const cells: Array<{ x: number; y: number }> = [];
    while (queue.length > 0) {
      const cell = queue.pop()!;
      count++;
      cells.push(cell);
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const key = `${cell.x + dx},${cell.y + dy}`;
          if (occupied.has(key) && !seen.has(key)) {
            seen.add(key);
            queue.push({ x: cell.x + dx, y: cell.y + dy });
          }
        }
      }
    }
    clusters.push({ minX, minY, maxX, maxY, count, cells });
  }
  return clusters;
}
