import React, { useEffect, useRef } from 'react';
import { Room } from '@colyseus/sdk';
import {
  MAP_GRID_HEIGHT,
  MAP_GRID_WIDTH,
  TILE_HEIGHT,
  TILE_WIDTH,
  getRoadSplinePoints,
  screenToGrid,
  terrainForZone
} from '@chien-quoc/shared';
import { WorldScene } from '../game/scenes/WorldScene.js';
import { UNKNOWN_OWNER_COLOR, colorToCss } from '../game/render/ownerColor.js';

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

/**
 * The road network as grid-space polylines, cached per layout.
 *
 * `getRoadSplinePoints` returns screen-space stamps for the world renderer; the
 * minimap needs grid coordinates, and rebuilding that conversion every frame
 * would burn through the trig cache for no reason. A jump between consecutive
 * stamps means a new route (or the kingdom's central plaza), so the line is cut
 * there instead of drawn straight across the gap.
 */
const roadPathCache = new Map<string, Array<Array<{ x: number; y: number }>>>();

function roadPathsFor(zoneId: string): Array<Array<{ x: number; y: number }>> {
  const terrain = terrainForZone(zoneId);
  // Keyed by layout, not by zone id: every kingdom shares the same road plan, so
  // a per-account key would leak one cache entry per visitor.
  const key = `${terrain.kind}:${terrain.width}x${terrain.height}`;
  let cached = roadPathCache.get(key);
  if (cached) return cached;

  const paths: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (const point of getRoadSplinePoints(terrain)) {
    const grid = screenToGrid(point.x, point.y);
    const last = current[current.length - 1];
    if (last && Math.hypot(grid.gridX - last.x, grid.gridY - last.y) > 2) {
      paths.push(current);
      current = [];
    }
    current.push({ x: grid.gridX, y: grid.gridY });
  }
  if (current.length > 0) paths.push(current);

  roadPathCache.set(key, paths);
  return paths;
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
      // loop for the rest of the session, which is how the units, buildings and
      // camera box all disappeared from the minimap while the roads stayed.
      animId = requestAnimationFrame(render);

      // AoE Terrain Grass Background (never pitch black)
      ctx.fillStyle = '#1e3f16';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle diagonal terrain texture lines
      ctx.strokeStyle = 'rgba(46, 99, 36, 0.4)';
      ctx.lineWidth = 1;
      for (let i = -canvas.height; i < canvas.width; i += 16) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + canvas.height, canvas.height);
        ctx.stroke();
      }

      // Outer border
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, canvas.width, canvas.height);

      if (room && room.state) {
        const { width, height } = sizeOf(room);
        const zoneId = zoneOf(room);
        const scaleX = canvas.width / width;
        const scaleY = canvas.height / height;

        // 1. Draw the dirt road network of whichever map is joined
        ctx.strokeStyle = '#c3946a';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        for (const path of roadPathsFor(zoneId)) {
          ctx.beginPath();
          // Every fourth stamp is ~1.4 tiles at the generator's 0.35 step.
          for (let i = 0; i < path.length; i += 4) {
            const point = path[i];
            if (i === 0) ctx.moveTo(point.x * scaleX, point.y * scaleY);
            else ctx.lineTo(point.x * scaleX, point.y * scaleY);
          }
          ctx.stroke();
        }

        // 2. Draw Resource Nodes
        room.state.resourceNodes?.forEach((res: any) => {
          if (res.remainingAmount <= 0) return;
          if (res.type === 'TREE') {
            ctx.fillStyle = '#166534';
            ctx.fillRect(res.gridX * scaleX, res.gridY * scaleY, 2, 2);
          } else if (res.type === 'GOLD_MINE') {
            ctx.fillStyle = '#facc15';
            ctx.fillRect(res.gridX * scaleX, res.gridY * scaleY, 2.5, 2.5);
          } else if (res.type === 'STONE_MINE') {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(res.gridX * scaleX, res.gridY * scaleY, 2.5, 2.5);
          } else {
            ctx.fillStyle = '#fb7185';
            ctx.fillRect(res.gridX * scaleX, res.gridY * scaleY, 2.5, 2.5);
          }
        });

        // 2. Draw Buildings
        // OWN-04: blips use the owner's real colour so the minimap matches the
        // world; only the size distinguishes our units (see below).
        const scene = sceneRef?.current;
        const myOwnerId = scene?.myOwnerId ?? '';
        const colorFor = (ownerId: string) =>
          scene?.ownerColorCss(ownerId) ?? colorToCss(UNKNOWN_OWNER_COLOR);
        room.state.buildings?.forEach((b: any) => {
          // MAPS: portals are travel infrastructure, drawn as a cyan diamond so
          // they stand out from the owner-coloured building blocks.
          if (b.type === 'PORTAL') {
            const cx = (b.gridX + b.sizeX / 2) * scaleX;
            const cy = (b.gridY + b.sizeY / 2) * scaleY;
            ctx.fillStyle = '#22d3ee';
            ctx.beginPath();
            ctx.moveTo(cx, cy - 4);
            ctx.lineTo(cx + 4, cy);
            ctx.lineTo(cx, cy + 4);
            ctx.lineTo(cx - 4, cy);
            ctx.closePath();
            ctx.fill();
            return;
          }

          ctx.fillStyle = colorFor(b.ownerId);
          const bw = Math.max(3.5, b.sizeX * scaleX);
          const bh = Math.max(3.5, b.sizeY * scaleY);
          ctx.fillRect(b.gridX * scaleX, b.gridY * scaleY, bw, bh);
        });

        // 3. Draw Units
        room.state.units?.forEach((u: any) => {
          const isMe = u.ownerId === myOwnerId;
          ctx.fillStyle = colorFor(u.ownerId);
          const size = isMe ? 3 : 2.5;
          ctx.fillRect(u.x * scaleX, u.y * scaleY, size, size);
        });

        // 4. Draw Camera Viewport Box (AoE white view rectangle)
        if (scene && scene.cameras?.main) {
          const cam = scene.cameras.main;
          const centerGrid = screenToGrid(cam.scrollX + cam.width / 2, cam.scrollY + cam.height / 2);
          const viewWGrid = (cam.width / cam.zoom) / TILE_WIDTH;
          const viewHGrid = (cam.height / cam.zoom) / TILE_HEIGHT;

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(
            (centerGrid.gridX - viewWGrid / 2) * scaleX,
            (centerGrid.gridY - viewHGrid / 2) * scaleY,
            Math.max(12, viewWGrid * scaleX),
            Math.max(8, viewHGrid * scaleY)
          );
        }
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [room, sceneRef]);

  /**
   * Maps a minimap pointer event to fractional grid coordinates.
   *
   * Divides by the rendered rect, not the backing store: the canvas has a 1px
   * border, so `rect.width` (142) is the real pointer area while `canvas.width`
   * is 140. Using the backing store shifts every click ~1.4% toward the origin,
   * which at 220 cells is more than two grid cells of error.
   */
  const gridFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const { width, height } = sizeOf(room);
    return {
      gx: ((e.clientX - rect.left) / rect.width) * width,
      gy: ((e.clientY - rect.top) / rect.height) * height
    };
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
        width={140}
        height={140}
        onClick={handleMinimapClick}
        onContextMenu={handleMinimapContextMenu}
        className="rounded cursor-crosshair border border-amber-900/50 shadow-inner"
      />
    </div>
  );
};
