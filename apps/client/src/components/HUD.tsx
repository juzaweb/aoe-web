import React from 'react';
import { Axe, Drumstick, Coins, Mountain, Users, ShieldCheck, Wifi, LogOut } from 'lucide-react';

interface HUDProps {
  playerName: string;
  playerColor: string;
  /** MAPS: "VƯƠNG QUỐC" or "CHIẾN TRƯỜNG", so the map is never ambiguous. */
  zoneLabel: string;
  wood: number;
  food: number;
  gold: number;
  stone: number;
  population: number;
  populationCap: number;
  isConnected: boolean;
  /** ECO-02: villagers standing idle, AoE2-style idle counter. */
  idleVillagers: number;
  /** ECO-02: jumps to the next idle villager, like pressing `.`. */
  onSelectIdleVillager: () => void;
  /** MOB-06: render the one-row mobile bar instead of the three-panel desktop one. */
  compact?: boolean;
  /** MOB-06: compact only; the desktop layout keeps its own floating button. */
  onLeaveGame?: () => void;
}

interface ResourceChipProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  /** Highlights the population chip at its cap, and nothing else. */
  danger?: boolean;
}

/**
 * One number with its icon. Used by the compact bar only: on a phone there is no
 * room for the desktop's 28 px framed icons, and the numbers are what the player
 * actually reads mid-game.
 */
const ResourceChip: React.FC<ResourceChipProps> = ({ icon, value, label, danger = false }) => (
  <span className="flex items-center gap-1" title={label}>
    {icon}
    <span
      className={`text-[11px] font-semibold tabular-nums ${
        danger ? 'text-red-400' : 'text-slate-100'
      }`}
    >
      {Math.floor(value)}
    </span>
  </span>
);

/**
 * Resource bar + empire identity.
 *
 * The compact branch (MOB-06) is the same information in one row with safe-area
 * offsets: a landscape phone has roughly 44 px of vertical space to spend here
 * before the map starts shrinking.
 */
export const HUD: React.FC<HUDProps> = ({
  playerName,
  playerColor,
  zoneLabel,
  wood,
  food,
  gold,
  stone,
  population,
  populationCap,
  isConnected,
  idleVillagers,
  onSelectIdleVillager,
  compact = false,
  onLeaveGame
}) => {
  const zoneIsBattle = zoneLabel === 'CHIẾN TRƯỜNG';

  if (compact) {
    return (
      <div className="pointer-events-none absolute left-[calc(env(safe-area-inset-left)+0.5rem)] right-[calc(env(safe-area-inset-right)+0.5rem)] top-[calc(env(safe-area-inset-top)+0.25rem)] z-20 flex select-none items-center gap-1.5">
        {/* Identity: a dot, a name short enough for a thumb-wide screen, and the
            map colour as a dot so the zone chip's text can be dropped. */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-amber-600/70 bg-slate-900/90 px-2 py-1 shadow-lg backdrop-blur-sm">
          <div
            className="h-3 w-3 shrink-0 rounded-full border border-white/50"
            style={{ backgroundColor: playerColor || '#3b82f6' }}
          />
          <span className="font-medieval max-w-[68px] truncate text-xs font-bold tracking-wide text-amber-300">
            {playerName || 'Emperor'}
          </span>
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              zoneIsBattle ? 'bg-red-500' : 'bg-emerald-500'
            }`}
            title={zoneLabel}
          />
        </div>

        {/* Resources: icon + number only, dividers instead of labels. */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-amber-700/80 bg-slate-950/90 px-2 py-1 shadow-2xl backdrop-blur-md">
          <ResourceChip icon={<Axe size={13} className="text-amber-400" />} value={wood} label="Gỗ" />
          <ResourceChip
            icon={<Drumstick size={13} className="text-red-400" />}
            value={food}
            label="Lương thực"
          />
          <ResourceChip icon={<Coins size={13} className="text-yellow-400" />} value={gold} label="Vàng" />
          <ResourceChip icon={<Mountain size={13} className="text-slate-400" />} value={stone} label="Đá" />

          <div className="h-3.5 w-px bg-slate-700" />

          <span className="flex items-center gap-1" title="Dân số">
            <ShieldCheck size={13} className="text-sky-400" />
            <span
              className={`text-[11px] font-semibold tabular-nums ${
                population >= populationCap ? 'text-red-400' : 'text-slate-100'
              }`}
            >
              {population}/{populationCap}
            </span>
          </span>

          <div className="h-3.5 w-px bg-slate-700" />

          <button
            type="button"
            onClick={onSelectIdleVillager}
            disabled={idleVillagers === 0}
            data-idle-villagers={idleVillagers}
            title="Nông dân đang rảnh"
            className={`flex items-center gap-1 ${
              idleVillagers > 0 ? 'cursor-pointer text-amber-300' : 'cursor-default text-slate-500'
            }`}
          >
            <Users size={13} className={idleVillagers > 0 ? 'animate-pulse' : ''} />
            <span className="text-[11px] font-semibold tabular-nums">{idleVillagers}</span>
          </button>
        </div>

        <div className="ml-auto pointer-events-auto flex items-center gap-1.5 rounded-md border border-slate-700/80 bg-slate-900/90 px-2 py-1 backdrop-blur-sm">
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-emerald-400' : 'animate-pulse bg-red-500'
            }`}
            title={isConnected ? 'ONLINE' : 'OFFLINE'}
          />
          <Wifi size={13} className={isConnected ? 'text-emerald-400' : 'text-red-500'} />
          {onLeaveGame && (
            <button
              type="button"
              onClick={onLeaveGame}
              title="Đăng xuất"
              aria-label="Đăng xuất"
              className="ml-0.5 flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 active:border-amber-400"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none select-none z-20">
      {/* Player Emblem & Name */}
      <div className="flex items-center gap-3 bg-slate-900/90 border border-amber-600/70 rounded-md px-4 py-2 shadow-lg backdrop-blur-sm pointer-events-auto">
        <div
          className="w-4 h-4 rounded-full border border-white/50 shadow-sm"
          style={{ backgroundColor: playerColor || '#3b82f6' }}
        />
        <span className="font-medieval text-amber-300 font-bold tracking-wide text-base">
          {playerName || 'Emperor'}
        </span>
        <span
          className={`text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border ${
            zoneLabel === 'CHIẾN TRƯỜNG'
              ? 'text-red-300 border-red-700/70 bg-red-950/50'
              : 'text-emerald-300 border-emerald-700/70 bg-emerald-950/50'
          }`}
        >
          {zoneLabel}
        </span>
      </div>

      {/* Central Resource Bar (AoE Classic Style) */}
      <div className="flex items-center gap-5 bg-slate-950/85 border-2 border-amber-700/80 rounded-lg px-6 py-2 shadow-2xl backdrop-blur-md pointer-events-auto">
        {/* Wood */}
        <div className="flex items-center gap-2" title="Gỗ (Wood)">
          <div className="w-7 h-7 rounded bg-amber-950/70 border border-amber-600/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/wood.png?v=3"
              alt="Gỗ"
              className="w-full h-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span className="font-semibold text-slate-100 text-sm tabular-nums">{Math.floor(wood)}</span>
        </div>

        {/* Food */}
        <div className="flex items-center gap-2" title="Thực lương (Food)">
          <div className="w-7 h-7 rounded bg-red-950/70 border border-red-600/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/food.png?v=3"
              alt="Lương thực"
              className="w-full h-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span className="font-semibold text-slate-100 text-sm tabular-nums">{Math.floor(food)}</span>
        </div>

        {/* Gold */}
        <div className="flex items-center gap-2" title="Vàng (Gold)">
          <div className="w-7 h-7 rounded bg-yellow-950/70 border border-yellow-600/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/gold.png?v=3"
              alt="Vàng"
              className="w-full h-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span className="font-semibold text-slate-100 text-sm tabular-nums">{Math.floor(gold)}</span>
        </div>

        {/* Stone */}
        <div className="flex items-center gap-2" title="Đá (Stone)">
          <div className="w-7 h-7 rounded bg-slate-800/70 border border-slate-500/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/stone.png?v=3"
              alt="Đá"
              className="w-full h-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span className="font-semibold text-slate-100 text-sm tabular-nums">{Math.floor(stone)}</span>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-slate-700" />

        {/* Population */}
        <div className="flex items-center gap-2" title="Dân số (Population)">
          <div className="w-7 h-7 rounded bg-sky-950/70 border border-sky-600/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/population.png?v=3"
              alt="Dân số"
              className="w-full h-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span
            className={`font-semibold text-sm tabular-nums ${
              population >= populationCap ? 'text-red-400 font-bold' : 'text-slate-100'
            }`}
          >
            {population} / {populationCap}
          </span>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-slate-700" />

        {/* ECO-02: idle villagers, AoE2's idle counter. Clicking jumps to the
            next one, exactly like pressing `.`. */}
        <button
          type="button"
          onClick={onSelectIdleVillager}
          disabled={idleVillagers === 0}
          data-idle-villagers={idleVillagers}
          title="Nông dân đang rảnh (phím .)"
          className={`flex items-center gap-1.5 transition-colors ${
            idleVillagers > 0
              ? 'text-amber-300 hover:text-amber-200 cursor-pointer'
              : 'text-slate-500 cursor-default'
          }`}
        >
          <Users size={15} className={idleVillagers > 0 ? 'animate-pulse' : ''} />
          <span className="font-semibold text-sm tabular-nums">{idleVillagers}</span>
        </button>
      </div>

      {/* Network Status indicator */}
      <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 rounded-md px-3 py-2 text-xs backdrop-blur-sm pointer-events-auto">
        <Wifi size={14} className={isConnected ? 'text-emerald-400' : 'text-red-500 animate-pulse'} />
        <span className={isConnected ? 'text-emerald-400' : 'text-red-400'}>
          {isConnected ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
    </div>
  );
};
