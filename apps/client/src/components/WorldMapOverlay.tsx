import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Eye, Map as MapIcon, Shield, Swords, X } from 'lucide-react';
import { RAID_MAX_UNITS, WorldMapEntry, WorldMapPayload } from '@chien-quoc/shared';
import { fetchWorldMap } from '../auth/api.js';
import {
  assignHexTiles,
  hexPolygonPoints,
  hexToPixel,
  levelDeltaColor,
  worldMapBounds
} from './worldMapArt.js';

interface WorldMapOverlayProps {
  open: boolean;
  /** The player's own display name, used for the "you are here" tile. */
  selfName: string;
  /** Units currently selected on the battle map; they are the raid army. */
  selectedUnitIds: string[];
  busy: boolean;
  onClose: () => void;
  onAttack: (entry: WorldMapEntry, unitIds: string[]) => void;
  /** Open a read-only view of this empire, in a second window. */
  onSpectate: (entry: WorldMapEntry) => void;
}

/**
 * Full-screen world map: every empire within ±5 Town Center levels.
 *
 * The list is fetched on open and never cached across opens: shields and
 * cooldowns change while the player is looking at the map, and a stale
 * "attack" button that the server then rejects is worse than a short spinner.
 */
export const WorldMapOverlay: React.FC<WorldMapOverlayProps> = ({
  open,
  selfName,
  selectedUnitIds,
  busy,
  onClose,
  onAttack,
  onSpectate
}) => {
  const [payload, setPayload] = useState<WorldMapPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchWorldMap()
      .then((data) => {
        setPayload(data);
        setSelectedId((current) => current ?? null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    reload();
  }, [open, reload]);

  // `Esc` closes the map, matching every other panel in the game.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const tiles = useMemo(() => {
    if (!payload) return new Map<string, { q: number; r: number }>();
    return assignHexTiles(payload.neighbors.map((entry) => entry.userId));
  }, [payload]);

  const bounds = useMemo(() => worldMapBounds(), []);

  if (!open) return null;

  const selfLevel = payload?.self.townCenterLevel ?? 0;
  const selected = payload?.neighbors.find((entry) => entry.userId === selectedId) ?? null;
  const armySize = selectedUnitIds.length;
  const tooMany = armySize > RAID_MAX_UNITS;
  const canSend = Boolean(selected?.canAttack) && armySize > 0 && !tooMany && !busy;

  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-slate-950/95 backdrop-blur-md">
      <header className="flex items-center gap-3 border-b border-amber-700/50 px-3 py-2">
        <MapIcon size={18} className="text-amber-400" />
        <div className="min-w-0 flex-1">
          <h2 className="font-medieval text-sm font-bold tracking-wider text-amber-200">
            BẢN ĐỒ THẾ GIỚI
          </h2>
          <p className="truncate text-[11px] text-slate-400">
            Các nước trong vòng 5 cấp Nhà chính của bạn · Bạn đang ở cấp {selfLevel || '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-amber-500 hover:text-amber-200"
        >
          Làm mới
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng bản đồ"
          className="rounded border border-slate-700 p-1 text-slate-300 hover:border-red-500 hover:text-red-300"
        >
          <X size={18} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:flex-row">
        {/* Hex grid */}
        <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950/70">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            </div>
          )}
          {error && (
            <div className="absolute inset-x-3 top-3 z-10 rounded border border-red-700 bg-red-950/90 px-3 py-2 text-[11px] text-red-200">
              {error}
            </div>
          )}

          {/* The self tile sits in the centre of the grid. */}
          <svg
            viewBox={`${bounds.minX - 10} ${bounds.minY - 10} ${bounds.width + 20} ${bounds.height + 20}`}
            className="h-full w-full"
            role="img"
            aria-label="Bản đồ các nước lân cận"
          >
            {payload?.neighbors.map((entry) => {
              const tile = tiles.get(entry.userId);
              if (!tile) return null;
              const centre = hexToPixel(tile);
              const isSelected = entry.userId === selectedId;
              return (
                <g
                  key={entry.userId}
                  onClick={() => setSelectedId(entry.userId)}
                  className="cursor-pointer"
                >
                  <polygon
                    points={hexPolygonPoints(tile)}
                    fill={levelDeltaColor(entry.townCenterLevel - selfLevel, entry.canAttack)}
                    fillOpacity={isSelected ? 0.95 : 0.7}
                    stroke={isSelected ? '#fbbf24' : '#0f172a'}
                    strokeWidth={isSelected ? 3 : 1.5}
                  />
                  <text
                    x={centre.x}
                    y={centre.y - 2}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                    fontSize={11}
                    fontWeight={700}
                    fill="#0f172a"
                  >
                    {entry.name.slice(0, 9)}
                  </text>
                  <text
                    x={centre.x}
                    y={centre.y + 12}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                    fontSize={10}
                    fill="#0f172a"
                  >
                    Lv {entry.townCenterLevel}
                  </text>
                </g>
              );
            })}

            {/* Own empire: a hollow white-ringed tile in the middle. */}
            <g>
              <polygon
                points={hexPolygonPoints({ q: 0, r: 0 })}
                fill="#1d4ed8"
                fillOpacity={0.8}
                stroke="#f8fafc"
                strokeWidth={3}
              />
              <text
                x={0}
                y={-2}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#f8fafc"
                className="pointer-events-none select-none"
              >
                {selfName.slice(0, 9) || 'Bạn'}
              </text>
              <text
                x={0}
                y={12}
                textAnchor="middle"
                fontSize={10}
                fill="#e2e8f0"
                className="pointer-events-none select-none"
              >
                Bạn · Lv {selfLevel || '—'}
              </text>
            </g>
          </svg>
        </div>

        {/* Detail panel */}
        <aside className="flex w-full shrink-0 flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/80 p-3 md:w-72">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Yếu hơn
            <span className="ml-2 inline-block h-2.5 w-2.5 rounded-sm bg-yellow-500" /> Ngang cấp
            <span className="ml-2 inline-block h-2.5 w-2.5 rounded-sm bg-red-500" /> Mạnh hơn
          </div>

          {!selected && (
            <p className="text-[11px] leading-relaxed text-slate-400">
              Chọn một ô trên bản đồ để xem thông tin nước đó.
            </p>
          )}

          {selected && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full border border-white/40"
                  style={{ backgroundColor: selected.color }}
                />
                <span className="font-medieval truncate text-sm font-bold text-amber-200">
                  {selected.name}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-300">
                <span className="text-slate-400">Nhà chính</span>
                <span className="text-right font-semibold">Cấp {selected.townCenterLevel}</span>
                <span className="text-slate-400">Chênh lệch</span>
                <span className="text-right font-semibold">
                  {selected.townCenterLevel - selfLevel > 0 ? '+' : ''}
                  {selected.townCenterLevel - selfLevel}
                </span>
              </div>

              {selected.blockReason && (
                <p className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-[11px] text-slate-300">
                  <Shield size={12} className="text-slate-400" />
                  {selected.blockReason}
                  {selected.shieldUntil > 0 && (
                    <span className="text-slate-500">
                      · còn {formatRemaining(selected.shieldUntil)}
                    </span>
                  )}
                  {selected.lockedUntil > 0 && (
                    <span className="text-slate-500">
                      · còn {formatRemaining(selected.lockedUntil)}
                    </span>
                  )}
                </p>
              )}

              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-300">
                <span>Quân mang theo</span>
                <span className={tooMany ? 'font-bold text-red-400' : 'font-semibold'}>
                  {armySize}/{RAID_MAX_UNITS}
                </span>
              </div>
              {armySize === 0 && (
                <p className="text-[11px] italic text-amber-300/80">
                  Hãy chọn quân trên bản đồ chính rồi mở lại bản đồ này.
                </p>
              )}

              <button
                type="button"
                disabled={!canSend}
                onClick={() => onAttack(selected, selectedUnitIds)}
                className="mt-1 flex min-h-[42px] items-center justify-center gap-2 rounded border-2 border-red-600 bg-gradient-to-r from-red-800 to-red-900 text-xs font-bold uppercase tracking-wider text-red-50 transition-all enabled:hover:border-red-400 disabled:cursor-not-allowed disabled:border-slate-700 disabled:from-slate-800 disabled:to-slate-900 disabled:text-slate-500"
              >
                <Swords size={15} />
                {busy ? 'Đang xuất quân...' : 'Tập kích'}
                <ChevronRight size={14} />
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => onSpectate(selected)}
                className="flex min-h-[42px] items-center justify-center gap-2 rounded border border-amber-600/70 bg-slate-950/60 text-xs font-bold uppercase tracking-wider text-amber-200 transition-all enabled:hover:border-amber-400 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              >
                <Eye size={15} />
                {busy ? 'Đang mở...' : 'Quan sát'}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

/** `2 ngày 3 giờ` / `45 phút` — enough precision for a cooldown label. */
function formatRemaining(until: number): string {
  const ms = Math.max(0, until - Date.now());
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} ngày ${restHours} giờ` : `${days} ngày`;
}
