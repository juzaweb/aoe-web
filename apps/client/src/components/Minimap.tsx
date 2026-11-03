import React, { useEffect, useRef } from 'react';
import { Room } from '@colyseus/sdk';
import { MAP_GRID_HEIGHT, MAP_GRID_WIDTH, TILE_HEIGHT, TILE_WIDTH, screenToGrid, terrainForZone } from '@chien-quoc/shared';
import { WorldScene } from '../game/scenes/WorldScene.js';
import { UNKNOWN_OWNER_COLOR, colorToCss } from '../game/render/ownerColor.js';
import {
  MINIMAP_COLORS,
  MINIMAP_CSS_SIZE,
  MINIMAP_SIZE,
  buildGroundPixels,
  gridToMinimap,
  markerColor,
  minimapClusters,
  pointerToGrid,
  renderForestLayer,
  type MinimapCluster
} from './minimapArt.js';

interface MinimapProps {
  room: Room | null;
  sceneRef?: React.RefObject<WorldScene | null>;
  onPanToGrid: (gx: number, gy: number) => void;
  /** CTL-07: right-click issues a move order to the grid cell under the cursor. */
  onCommandAtGrid: (gx: number, gy: number) => void;
}

type MinimapState = {
  mapWidth?: number;
  mapHeight?: number;
  zoneId?: string;
};

/** Map size the room replicates, falling back to the battlefield dimensions. */
function sizeOf(room: Room | null): { width: number; height: number } {
  const state = room?.state as MinimapState | null | undefined;
  const width = Number(state?.mapWidth);
  const height = Number(state?.mapHeight);
  return {
    width: Number.isFinite(width) && width > 0 ? width : MAP_GRID_WIDTH,
    height: Number.isFinite(height) && height > 0 ? height : MAP_GRID_HEIGHT
  };
}

function zoneOf(room: Room | null): string {
  return (room?.state as MinimapState | null | undefined)?.zoneId ?? 'battlefield';
}

// The ground bitmap costs 78k pixel tests, so it is built once per layout and
// reused until the zone changes. Clusters are rebuilt only when the number of
// standing trees changes (depletion), not every frame.
const groundCache = new Map<string, { pixels: Uint8ClampedArray<ArrayBuffer>; image: ImageData }>();
let clusterCache: { key: string; clusters: MinimapCluster[]; layer: HTMLCanvasElement | null } = {
  key: '',
  clusters: [],
  layer: null
};

function groundFor(zoneId: string, width: number, height: number): ImageData {
  const key = `${zoneId}:${width}x${height}`;
  let entry = groundCache.get(key);
  if (!entry) {
    // Width/height come from the room, not only from the zone constant: the
    // server owns the map size, and the raster must cover exactly what the
    // minimap scales against.
    const pixels = buildGroundPixels({ ...terrainForZone(zoneId), width, height });
    entry = { pixels, image: new ImageData(pixels, MINIMAP_SIZE, MINIMAP_SIZE) };
    groundCache.set(key, entry);
  }
  return entry.image;
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
  ctx.fill();
}

function drawTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y + radius);
  ctx.lineTo(x - radius, y + radius);
  ctx.closePath();
  ctx.fill();
}

export const Minimap: React.FC<MinimapProps> = ({ room, sceneRef, onPanToGrid, onCommandAtGrid }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      // Scheduled before anything can throw: a single bad frame used to end the
      // loop for the rest of the session.
      animId = requestAnimationFrame(render);

      if (!room || !room.state) {
        ctx.fillStyle = '#1b2613';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const { width, height } = sizeOf(room);
      const zoneId = zoneOf(room);
      const scale = MINIMAP_SIZE / width;

      // 1. Terrain: real grass and road tiles, no hand-drawn hatching.
      ctx.putImageData(groundFor(zoneId, width, height), 0, 0);

      // 2. Forest as clusters: 892 battlefield trees are ~77 clumps, so drawing
      // one blip per tree only produced a smear. A light rim carries the
      // contrast (3.68:1) that a dark fill cannot.
      // Signature, not just a count: a felled tree and a respawn in the same
      // frame would otherwise keep the stale cluster layer on screen.
      let standingTrees = 0;
      let treeSignature = 0;
      room.state.resourceNodes?.forEach((res: any) => {
        if (res.remainingAmount > 0 && res.type === 'TREE') {
          standingTrees++;
          treeSignature = (treeSignature + res.gridX * 73856093 + res.gridY * 19349663) | 0;
        }
      });
      const clusterKey = `${zoneId}:${width}x${height}:${standingTrees}:${treeSignature}`;
      if (clusterKey !== clusterCache.key) {
        // Only walk the nodes into an array when the cluster set is stale: this
        // used to allocate ~900 objects every frame just to compute a key.
        const trees: Array<{ gridX: number; gridY: number }> = [];
        room.state.resourceNodes?.forEach((res: any) => {
          if (res.remainingAmount > 0 && res.type === 'TREE') {
            trees.push({ gridX: res.gridX, gridY: res.gridY });
          }
        });
        const clusters = minimapClusters(trees);
        clusterCache = { key: clusterKey, clusters, layer: renderForestLayer(clusters, scale) };
      }
      // One pre-rendered layer per cluster change: the blobs are circles around
      // the trees, so a clump reads as a forest edge instead of a bounding box.
      if (clusterCache.layer) ctx.drawImage(clusterCache.layer, 0, 0);

      // 3. Ore and bushes as 3px glyphs: shape distinguishes them even when the
      // colour does not survive the small size.
      room.state.resourceNodes?.forEach((res: any) => {
        if (res.remainingAmount <= 0 || res.type === 'TREE') return;
        const point = gridToMinimap(res.gridX, res.gridY, width);
        ctx.fillStyle = markerColor(res.type);
        ctx.strokeStyle = MINIMAP_COLORS.outline;
        ctx.lineWidth = 0.75;
        if (res.type === 'GOLD_MINE') {
          drawDiamond(ctx, point.x, point.y, 2);
          ctx.stroke();
        } else if (res.type === 'STONE_MINE') {
          drawTriangle(ctx, point.x, point.y, 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // 4. Buildings. Ground truth is the state, so the icon matches the world.
      const scene = sceneRef?.current;
      const myOwnerId = scene?.myOwnerId ?? '';
      const colorFor = (ownerId: string) =>
        scene?.ownerColorCss(ownerId) ?? colorToCss(UNKNOWN_OWNER_COLOR);

      room.state.buildings?.forEach((b: any) => {
        if (b.type === 'PORTAL') {
          const point = gridToMinimap(b.gridX + b.sizeX / 2, b.gridY + b.sizeY / 2, width);
          ctx.fillStyle = MINIMAP_COLORS.portal;
          drawDiamond(ctx, point.x, point.y, 3);
          return;
        }
        ctx.fillStyle = colorFor(b.ownerId);
        ctx.strokeStyle = MINIMAP_COLORS.outline;
        ctx.lineWidth = 0.75;
        const bw = Math.max(3.5, b.sizeX * scale);
        const bh = Math.max(3.5, b.sizeY * scale);
        ctx.fillRect(b.gridX * scale, b.gridY * scale, bw, bh);
        ctx.strokeRect(b.gridX * scale, b.gridY * scale, bw, bh);
      });

      // 5. Units: dots, with a white ring on our own so it stays findable.
      room.state.units?.forEach((u: any) => {
        const isMe = u.ownerId === myOwnerId;
        const point = gridToMinimap(u.x, u.y, width);
        const radius = isMe ? 2 : 1.5;
        ctx.fillStyle = colorFor(u.ownerId);
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isMe ? '#ffffff' : MINIMAP_COLORS.outline;
        ctx.lineWidth = isMe ? 1 : 0.75;
        ctx.stroke();
      });

      // 6. Camera viewport: the white rectangle AoE draws on its minimap.
      if (scene && scene.cameras?.main) {
        const cam = scene.cameras.main;
        const centerGrid = screenToGrid(cam.scrollX + cam.width / 2, cam.scrollY + cam.height / 2);
        const viewWGrid = (cam.width / cam.zoom) / TILE_WIDTH;
        const viewHGrid = (cam.height / cam.zoom) / TILE_HEIGHT;
        const boxX = (centerGrid.gridX - viewWGrid / 2) * scale;
        const boxY = (centerGrid.gridY - viewHGrid / 2) * scale;
        const boxW = Math.max(12, viewWGrid * scale);
        const boxH = Math.max(8, viewHGrid * scale);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeStyle = MINIMAP_COLORS.viewport;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(boxX, boxY, boxW, boxH);
      }

      // 7. Frame.
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, canvas.width, canvas.height);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [room, sceneRef]);

  /**
   * Maps a minimap pointer event to fractional grid coordinates.
   *
   * Divides by the *content* box, not the backing store and not the border box:
   * the canvas draws 280 backing pixels into 140 CSS pixels and carries a 1px
   * border, so `rect.width` is 142. Dividing by that stretches the mapping by
   * 1.4% - at 110 tiles a full tile and a half, which is a visible miss on a
   * right-click order. `clientWidth` excludes the border, and its inset is
   * removed from the pointer position.
   */
  const gridFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const { width, height } = sizeOf(room);
    return pointerToGrid(e, rect, { width: canvas.clientWidth, height: canvas.clientHeight }, width, height);
  };

  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const grid = gridFromEvent(e);
    if (!grid) return;
    onPanToGrid(grid.gx, grid.gy);
  };

  /**
   * CTL-07: right-click orders the selection to that spot instead of panning.
   * The native context menu is suppressed so the order is the only effect.
   */
  const handleMinimapContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const grid = gridFromEvent(e);
    if (!grid) return;
    onCommandAtGrid(grid.gx, grid.gy);
  };

  const zoneKind = (room?.state as MinimapState | undefined)?.zoneId;
  const zoneLabel = zoneKind === 'battlefield' ? 'CHIẾN TRƯỜNG' : 'VƯƠNG QUỐC';

  return (
    <div className="aoe-panel p-2 rounded-lg pointer-events-auto flex flex-col items-center">
      <div
        className={`font-medieval text-[10px] font-bold mb-1 tracking-wider ${
          zoneKind === 'battlefield' ? 'text-red-400' : 'text-amber-400'
        }`}
      >
        BẢN ĐỒ · {zoneLabel}
      </div>
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        onClick={handleMinimapClick}
        onContextMenu={handleMinimapContextMenu}
        className="rounded cursor-crosshair border border-amber-900/50 shadow-inner"
        style={{ width: MINIMAP_CSS_SIZE, height: MINIMAP_CSS_SIZE }}
      />
    </div>
  );
};
