import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map as MapIcon, X } from 'lucide-react';
import { Room } from '@colyseus/sdk';
import { MAP_GRID_HEIGHT, MAP_GRID_WIDTH, TILE_HEIGHT, TILE_WIDTH, screenToGrid, terrainForZone } from '@chien-quoc/shared';
import { WorldScene } from '../game/scenes/WorldScene.js';
import { UNKNOWN_OWNER_COLOR, colorToCss } from '../game/render/ownerColor.js';
import { useModalFocus } from './useModalFocus.js';
import {
  MINIMAP_COLORS,
  MINIMAP_COMPACT_CSS_SIZE,
  MINIMAP_CSS_SIZE,
  MINIMAP_SIZE,
  buildGroundPixels,
  gridToMinimap,
  markerColor,
  minimapClusters,
  pointerToGrid,
  portalGlyphRects,
  renderForestLayer,
  type MinimapCluster
} from './minimapArt.js';

interface MinimapProps {
  room: Room | null;
  sceneRef?: React.RefObject<WorldScene | null>;
  onPanToGrid: (gx: number, gy: number) => void;
  /** CTL-07: right-click issues a move order to the grid cell under the cursor. */
  onCommandAtGrid: (gx: number, gy: number) => void;
  /** MOB-06: 96 px radar for the landscape phone dock. */
  compact?: boolean;
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
/** Upper bound on cached ground rasters; a stroke adds one entry. */
const MAX_GROUND_CACHE = 8;
let clusterCache: { key: string; clusters: MinimapCluster[]; layer: HTMLCanvasElement | null } = {
  key: '',
  clusters: [],
  layer: null
};

/**
 * Road tiles of the current room, plus a signature that changes whenever one is
 * added or removed.
 *
 * A kingdom's roads are painted state, so the raster cannot be cached by zone
 * alone. The signature is a cheap sum of the tile coordinates: a repaint only
 * happens while the player is drawing, not every frame.
 */
let roadCache: {
  roads: unknown;
  version: number;
  tiles: Array<{ gridX: number; gridY: number }>;
  signature: string;
} = { roads: null, version: -1, tiles: [], signature: '0:0' };

function roadsOf(
  room: Room | null,
  version: number
): {
  tiles: Array<{ gridX: number; gridY: number }>;
  signature: string;
} {
  const roads = (room?.state as any)?.roads;
  // Walking a 4000-tile map every animation frame is wasted work, and the tile
  // count is not a change signal (a stroke can remove one tile and add another).
  // The scene already sees every add/remove, so its version counter is the key.
  if (roads && roadCache.roads === roads && roadCache.version === version) {
    return { tiles: roadCache.tiles, signature: roadCache.signature };
  }

  const tiles: Array<{ gridX: number; gridY: number }> = [];
  let signature = 0;
  roads?.forEach((road: any) => {
    if (road.isConstructed === false) return;
    tiles.push({ gridX: road.gridX, gridY: road.gridY });
    signature = (signature + road.gridX * 73856093 + road.gridY * 19349663) | 0;
  });
  const result = { tiles, signature: `${tiles.length}:${signature}` };
  roadCache = { roads: roads ?? null, version, ...result };
  return result;
}

function groundFor(
  zoneId: string,
  width: number,
  height: number,
  roads: Array<{ gridX: number; gridY: number }>,
  roadSignature: string
): ImageData {
  const key = `${zoneId}:${width}x${height}:${roadSignature}`;
  let entry = groundCache.get(key);
  if (!entry) {
    // Width/height come from the room, not only from the zone constant: the
    // server owns the map size, and the raster must cover exactly what the
    // minimap scales against.
    const pixels = buildGroundPixels({ ...terrainForZone(zoneId), width, height }, roads);
    entry = { pixels, image: new ImageData(pixels, MINIMAP_SIZE, MINIMAP_SIZE) };
    groundCache.set(key, entry);
    // The cache is keyed by the road signature now, so a long editing session
    // would otherwise leak one 78k-pixel buffer per stroke.
    if (groundCache.size > MAX_GROUND_CACHE) {
      const oldest = groundCache.keys().next().value;
      if (oldest !== undefined) groundCache.delete(oldest);
    }
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

export const Minimap: React.FC<MinimapProps> = ({
  room,
  sceneRef,
  onPanToGrid,
  onCommandAtGrid,
  compact = false
}) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** MOB-06: compact only — the radar is collapsed behind its button by default. */
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // UIX-09: the floated radar is the compact layout's only panel, so it behaves
  // as a modal dialog while open. The desktop radar lives inside the fixed dock
  // band and stays a plain region — `compact` keeps the hook off there.
  useModalFocus(panelRef, compact && open, () => setOpen(false));
  /**
   * MOB-06: a long-press on the minimap is the touch right-click, so a move order
   * needs a timer and the pan that the tap would otherwise fire must be suppressed.
   */
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  useEffect(() => {
    // The compact layout mounts this canvas only once the panel is open, which is
    // why `open` is a dependency below: a mount that bailed out here would never
    // restart the loop on the next open.
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    // MOB-09: a phone that is locked or switched away keeps the tab alive; the
    // radar redraw is pure CPU and has nothing to show while hidden.
    let running = !document.hidden;

    const render = () => {
      if (!running) return;
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

      // 1. Terrain: real grass and road tiles, no hand-drawn hatching. The
      // signature covers player-painted kingdom roads, which change at runtime.
      const roadState = roadsOf(room, sceneRef?.current?.roadsVersion ?? 0);
      ctx.putImageData(groundFor(zoneId, width, height, roadState.tiles, roadState.signature), 0, 0);

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
          // An arch with an open doorway reads as a gate; a diamond read as a
          // generic point of interest. Fixed pixel size, so it survives the
          // 110-tile and 220-tile maps equally.
          const point = gridToMinimap(b.gridX + b.sizeX / 2, b.gridY + b.sizeY / 2, width);
          ctx.fillStyle = MINIMAP_COLORS.portal;
          for (const rect of portalGlyphRects(point.x, point.y)) {
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          }
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

      // 5b. ATK-04: under-attack pings (red pulse at the hit location).
      const nowMs = Date.now();
      const pings = scene?.getUnderAttackPings?.(nowMs) ?? [];
      pings.forEach((ping: any) => {
        const point = gridToMinimap(ping.gx, ping.gy, width);
        const lifetime = Math.max(1, ping.until - ping.startedAt);
        const age = Math.min(1, (nowMs - ping.startedAt) / lifetime);
        const alpha = 1 - age;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ef4444';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
        ctx.lineWidth = 2;
        const radius = 4 + age * 8;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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

    const onVisibilityChange = () => {
      const next = !document.hidden;
      if (next === running) return;
      running = next;
      if (running) {
        render();
      } else {
        cancelAnimationFrame(animId);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    render();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      running = false;
      cancelAnimationFrame(animId);
    };
  }, [room, sceneRef, open]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    };
  }, []);

  // Closing the compact panel with a finger still down must drop its timer too:
  // it would otherwise fire a move order from a radar that is no longer on screen.
  useEffect(() => {
    if (open) return;
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressFired.current = false;
  }, [open]);

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
  const gridFromEvent = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const { width, height } = sizeOf(room);
    return pointerToGrid(e, rect, { width: canvas.clientWidth, height: canvas.clientHeight }, width, height);
  };

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  /**
   * MOB-06: touch has no right-click, so holding on the radar issues the move order
   * and a plain tap still pans. The press position is captured up front because the
   * timer fires while the finger has not moved.
   */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    longPressFired.current = false;
    if (e.pointerType !== 'touch') return;

    const grid = gridFromEvent(e);
    if (!grid) return;

    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      onCommandAtGrid(grid.gx, grid.gy);
    }, 350);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Mouse: only the primary button recentres. A right-click already issued its
    // order through `contextmenu`, and without this guard its release panned the
    // camera too — the old click handler could never fire for it.
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    clearLongPress();
    // The pan is the fallback: a long-press already issued its order.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    const grid = gridFromEvent(e);
    if (!grid) return;
    onPanToGrid(grid.gx, grid.gy);
  };

  const handleMinimapContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const grid = gridFromEvent(e);
    if (!grid) return;
    onCommandAtGrid(grid.gx, grid.gy);
  };

  const zoneKind = (room?.state as MinimapState | undefined)?.zoneId;
  const zoneLabel = zoneKind === 'battlefield' ? t('minimap.battlefield') : t('minimap.kingdom');

  if (compact) {
    return (
      <div className="pointer-events-auto relative flex flex-col items-start" data-minimap-compact>
        {/* MOB-06: the radar is the tallest part of the dock, so on a phone it is a
            button. Opening it floats the real radar above the dock; the button keeps
            the dock ~50 px tall when closed, which is the difference between a
            playable map and a HUD with a window in it. */}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          title={t('minimap.map')}
          className={`aoe-button flex h-12 w-12 flex-col items-center justify-center gap-0.5 ${
            open ? 'text-amber-100' : 'text-slate-200'
          }`}
        >
          <MapIcon size={18} />
          <span className="text-[11px] font-semibold leading-none">{t('minimap.map')}</span>
        </button>

        {open && (
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="aoe-panel absolute bottom-full left-0 z-30 mb-2 flex flex-col items-center rounded-lg p-1"
          >
            <div className="mb-1 flex w-full items-center justify-between px-0.5">
              <h2
                id={titleId}
                className={`font-medieval text-[11px] font-bold tracking-wider ${
                  zoneKind === 'battlefield' ? 'text-red-400' : 'text-amber-400'
                }`}
              >
                {zoneLabel}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('minimap.closeMap')}
                title={t('minimap.close')}
                // UIX-14: the 36 px box stays the visual size; the 44 px floor is
                // what a finger actually needs on the phone layout this panel
                // only exists in.
                style={{ minHeight: 44, minWidth: 44 }}
                className="aoe-button flex h-9 w-9 items-center justify-center text-slate-300"
              >
                <X size={13} />
              </button>
            </div>
            <canvas
              ref={canvasRef}
              width={MINIMAP_SIZE}
              height={MINIMAP_SIZE}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={clearLongPress}
              onPointerLeave={clearLongPress}
              onContextMenu={handleMinimapContextMenu}
              className="rounded cursor-crosshair border border-amber-900/50 shadow-inner"
              style={{ width: MINIMAP_COMPACT_CSS_SIZE, height: MINIMAP_COMPACT_CSS_SIZE }}
            />
            <p className="mt-0.5 text-[11px] leading-tight text-slate-400">
              {t('minimap.hint')}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    // DOCK-08: the desktop radar is a fixed 156 px tile of the command dock —
    // 140 px raster + 2*6 px padding + 2*2 px panel border. The zone name used to
    // be a flex row above the canvas and made the panel taller than the dock, so
    // it is now an overlay chip painted on top of the map instead of a box that
    // takes layout height.
    <div
      data-minimap-desktop
      className="aoe-panel pointer-events-auto relative flex items-center justify-center rounded p-1.5"
    >
      <span
        className={`absolute left-1 top-1 z-10 rounded border border-amber-800/60 bg-stone-950/85 px-1.5 font-medieval text-[11px] font-bold tracking-wider ${
          zoneKind === 'battlefield' ? 'text-red-400' : 'text-amber-400'
        }`}
      >
        {zoneLabel}
      </span>
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onContextMenu={handleMinimapContextMenu}
        className="rounded cursor-crosshair border border-amber-800/70 shadow-inner"
        style={{ width: MINIMAP_CSS_SIZE, height: MINIMAP_CSS_SIZE }}
      />
    </div>
  );
};
