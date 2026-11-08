import React from 'react';
import { useTranslation } from 'react-i18next';
import { Axe, Drumstick, Coins, Mountain, Users, ShieldCheck, Wifi, LogOut, Map as MapIcon, Swords } from 'lucide-react';
import { CITADEL_HP_THRESHOLD, RAID_MAX_DURATION_MS, type CitadelStatus } from '@chien-quoc/shared';
import { MOBILE_MIN_TAP_PX } from '../device/inputMode.js';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher.js';

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
  /** ATK-05/ALERT-02: whether the player is currently under attack. */
  underAttack?: boolean;
  /** MOB-06: compact only; the desktop layout keeps its own floating button. */
  onLeaveGame?: () => void;
  /** Phase 23: opens the world map overlay. */
  onOpenWorldMap?: () => void;
  /** Phase 23: true while the player is attacking somebody else's kingdom. */
  inRaid?: boolean;
  /** Phase 23: timestamp when the current raid started. */
  raidStartedAt?: number;
  /** Phase 23: leaves the raid through the retreat gate. */
  onRetreat?: () => void;
  /** Aggregate health of the player's citadel; null on the battlefield. */
  citadelStatus?: CitadelStatus | null;
}

/**
 * Aggregate citadel health. Red at the loss threshold (20%), amber below half,
 * green while healthy, so "one more push" is readable at a glance.
 */
const CitadelBar: React.FC<{ status: CitadelStatus; compact?: boolean }> = ({
  status,
  compact = false
}) => {
  const pct = Math.max(0, Math.min(1, status.ratio));
  const color =
    pct <= CITADEL_HP_THRESHOLD
      ? 'bg-red-500'
      : pct <= 0.5
        ? 'bg-amber-400'
        : 'bg-emerald-400';

  return (
    <div
      title={`Thành trì: ${Math.ceil(status.hp)} / ${Math.ceil(status.maxHp)} máu`}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-md border border-slate-700/80 bg-slate-950/90 shadow-lg backdrop-blur-md ${
        compact ? 'px-2 py-1' : 'px-3 py-1.5'
      }`}
    >
      <span className={`font-medieval font-bold tracking-wide text-amber-300 ${compact ? 'text-[9px]' : 'text-[11px]'}`}>
        THÀNH TRÌ
      </span>
      <div className={`${compact ? 'h-1.5 w-16' : 'h-2 w-24'} overflow-hidden rounded-full bg-slate-800`}>
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span
        className={`font-semibold tabular-nums ${
          pct <= CITADEL_HP_THRESHOLD ? 'text-red-300' : 'text-slate-200'
        } ${compact ? 'text-[10px]' : 'text-[11px]'}`}
      >
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
};

interface ResourceChipProps {
  icon: React.ReactNode;
  value: number;
  label: string;
}

/**
 * One number with its icon. Used by the compact bar only: on a phone there is no
 * room for the desktop's 28 px framed icons, and the numbers are what the player
 * actually reads mid-game.
 */
const ResourceChip: React.FC<ResourceChipProps> = ({ icon, value, label }) => (
  <span className="flex items-center gap-1" title={label}>
    {icon}
    <span className="text-[11px] font-semibold tabular-nums text-slate-100">{Math.floor(value)}</span>
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
  underAttack = false,
  onLeaveGame,
  onOpenWorldMap,
  inRaid = false,
  raidStartedAt,
  onRetreat,
  citadelStatus = null
}) => {
  const { t } = useTranslation();
  const zoneIsBattle = inRaid;
  const [raidTimeRemaining, setRaidTimeRemaining] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!inRaid || !raidStartedAt) {
      setRaidTimeRemaining(null);
      return;
    }
    const updateTime = () => {
      const elapsed = Date.now() - raidStartedAt;
      const remaining = Math.max(0, RAID_MAX_DURATION_MS - elapsed);
      setRaidTimeRemaining(remaining);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [inRaid, raidStartedAt]);

  const formattedRaidTime = raidTimeRemaining !== null
    ? `${Math.floor(raidTimeRemaining / 60000)}:${Math.floor((raidTimeRemaining % 60000) / 1000).toString().padStart(2, '0')}`
    : null;

  if (compact) {
    const compactContent = (
    <>
      {/* Identity: a dot, a name short enough for a thumb-wide screen, and the
          map colour as a dot so the zone chip's text can be dropped. */}
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-amber-600/70 bg-slate-900/90 px-2 py-1 shadow-lg backdrop-blur-sm">
        <div
          className="h-3 w-3 shrink-0 rounded-full border border-white/50"
          style={{ backgroundColor: playerColor || '#3b82f6' }}
        />
        <span className="font-medieval max-w-[68px] truncate text-xs font-bold tracking-wide text-amber-300">
          {playerName || t('hud.emperor')}
        </span>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            zoneIsBattle ? 'bg-red-500' : 'bg-emerald-500'
          }`}
          title={zoneLabel}
        />
        {underAttack && (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse"
            title={t('hud.underAttack')}
          />
        )}
      </div>

      {/* Resources: icon + number only, dividers instead of labels. */}
      <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-amber-700/80 bg-slate-950/90 px-2 py-1 shadow-2xl backdrop-blur-md">
        <ResourceChip icon={<Axe size={13} className="text-amber-400" />} value={wood} label={t('hud.wood')} />
        <ResourceChip
          icon={<Drumstick size={13} className="text-red-400" />}
          value={food}
          label={t('hud.food')}
        />
        <ResourceChip icon={<Coins size={13} className="text-yellow-400" />} value={gold} label={t('hud.gold')} />
        <ResourceChip icon={<Mountain size={13} className="text-slate-400" />} value={stone} label={t('hud.stone')} />

        <div className="h-3.5 w-px bg-slate-700" />

        <span className="flex items-center gap-1" title={t('hud.population')}>
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
          title={t('hud.idleVillagers')}
          style={{ minHeight: MOBILE_MIN_TAP_PX, minWidth: MOBILE_MIN_TAP_PX }}
          className={`flex items-center justify-center gap-1 ${
            idleVillagers > 0 ? 'cursor-pointer text-amber-300' : 'cursor-default text-slate-500'
          }`}
        >
          <Users size={13} className={idleVillagers > 0 ? 'animate-pulse' : ''} />
          <span className="text-[11px] font-semibold tabular-nums">{idleVillagers}</span>
        </button>
      </div>

      <div className="ml-auto pointer-events-auto flex items-center gap-1.5">
        <LanguageSwitcher compact className="pointer-events-auto opacity-80" />
        {inRaid ? (
          <div className="flex items-center gap-1">
            {formattedRaidTime && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                (raidTimeRemaining ?? 0) <= 60000
                  ? 'bg-red-900/90 text-red-300 border border-red-500 animate-pulse'
                  : 'bg-black/60 text-amber-300 border border-amber-600/60'
              }`}>
                ⏱ {formattedRaidTime}
              </span>
            )}
            <button
              type="button"
              onClick={onRetreat}
              title={t('hud.retreat')}
              aria-label={t('hud.retreat')}
              style={{ minHeight: MOBILE_MIN_TAP_PX, minWidth: MOBILE_MIN_TAP_PX }}
              className="flex items-center justify-center rounded-md border border-red-700 bg-red-950/80 px-2 text-red-200"
            >
              <Swords size={15} />
            </button>
          </div>
        ) : (
          onOpenWorldMap && (
            <button
              type="button"
              onClick={onOpenWorldMap}
              title={t('hud.worldMap')}
              aria-label={t('hud.worldMap')}
              style={{ minHeight: MOBILE_MIN_TAP_PX, minWidth: MOBILE_MIN_TAP_PX }}
              className="flex items-center justify-center rounded-md border border-amber-700 bg-slate-900/90 px-2 text-amber-300"
            >
              <MapIcon size={15} />
            </button>
          )
        )}
      </div>

      <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-slate-700/80 bg-slate-900/90 px-2 py-1 backdrop-blur-sm">
        <span
          className={`h-2 w-2 rounded-full ${
            isConnected ? 'bg-emerald-400' : 'animate-pulse bg-red-500'
          }`}
          title={isConnected ? t('hud.online') : t('hud.offline')}
        />
        <Wifi size={13} className={isConnected ? 'text-emerald-400' : 'text-red-500'} />
        {onLeaveGame && (
          <button
            type="button"
            onClick={onLeaveGame}
            title={t('hud.logout')}
            aria-label={t('hud.logout')}
            style={{ minHeight: MOBILE_MIN_TAP_PX, minWidth: MOBILE_MIN_TAP_PX }}
            className="ml-0.5 flex items-center justify-center rounded border border-slate-700 text-slate-300 active:border-amber-400"
          >
            <LogOut size={14} />
          </button>
        )}
      </div>
    </>
    )
    return (
      <>
      <div className="pointer-events-none absolute left-[calc(env(safe-area-inset-left)+0.5rem)] right-[calc(env(safe-area-inset-right)+0.5rem)] top-[calc(env(safe-area-inset-top)+0.25rem)] z-20 flex select-none items-center gap-1.5">
        {compactContent}
      </div>
      {citadelStatus && (
        <div className="pointer-events-none absolute left-[calc(env(safe-area-inset-left)+0.5rem)] top-[calc(env(safe-area-inset-top)+2.5rem)] z-20 flex">
          <CitadelBar status={citadelStatus} compact />
        </div>
      )}
      </>
    );
  }

  return (
    <>
    <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none select-none z-20">
      {/* Left Section: Player Emblem & Name + Separate World Map Button */}
      <div className="flex items-center gap-2 pointer-events-none">
        <div className="flex items-center gap-2.5 bg-slate-900/90 border border-amber-600/70 rounded-md px-3.5 py-2 shadow-lg backdrop-blur-sm pointer-events-auto">
          <div
            className="w-4 h-4 rounded-full border border-white/50 shadow-sm shrink-0"
            style={{ backgroundColor: playerColor || '#3b82f6' }}
            title={zoneLabel}
          />
          <span className="font-medieval text-amber-300 font-bold tracking-wide text-base whitespace-nowrap">
            {playerName || t('hud.emperor')}
          </span>
        </div>

        {inRaid ? (
          <div className="flex items-center gap-2 pointer-events-auto">
            {formattedRaidTime && (
              <span className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-bold shadow-lg backdrop-blur-sm ${
                (raidTimeRemaining ?? 0) <= 60000
                  ? 'bg-red-950/90 text-red-300 border border-red-500 animate-pulse'
                  : 'bg-slate-900/90 text-amber-300 border border-amber-600/70'
              }`}>
                ⏱ {formattedRaidTime}
              </span>
            )}
            <button
              type="button"
              onClick={onRetreat}
              title={t('hud.retreat')}
              aria-label={t('hud.retreat')}
              className="flex items-center gap-1.5 rounded-md border border-red-600/80 bg-slate-900/90 hover:bg-red-950/70 px-3 py-2 text-xs font-semibold text-red-200 hover:border-red-400 shadow-lg backdrop-blur-sm pointer-events-auto cursor-pointer transition-colors whitespace-nowrap active:scale-95"
            >
              <Swords size={14} className="text-red-400" />
              <span>{t('hud.retreat')}</span>
            </button>
          </div>
        ) : (
          onOpenWorldMap && (
            <button
              type="button"
              onClick={onOpenWorldMap}
              title={t('hud.worldMap')}
              aria-label={t('hud.worldMap')}
              className="flex items-center gap-1.5 rounded-md border border-amber-600/70 bg-slate-900/90 hover:bg-amber-950/60 px-3 py-2 text-xs font-semibold text-amber-200 hover:text-amber-100 hover:border-amber-400 shadow-lg backdrop-blur-sm pointer-events-auto cursor-pointer transition-colors whitespace-nowrap active:scale-95"
            >
              <MapIcon size={14} className="text-amber-400" />
              <span>{t('hud.worldMap')}</span>
            </button>
          )
        )}
      </div>

      {/* Central Resource Bar (AoE Classic Style) */}
      <div className="flex items-center gap-5 bg-slate-950/85 border-2 border-amber-700/80 rounded-lg px-6 py-2 shadow-2xl backdrop-blur-md pointer-events-auto">
        {/* Wood */}
        <div className="flex items-center gap-2" title={t('hud.woodTitle')}>
          <div className="w-7 h-7 rounded bg-amber-950/70 border border-amber-600/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/wood.png?v=3"
              alt={t('hud.wood')}
              className="w-full h-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span className="font-semibold text-slate-100 text-sm tabular-nums">{Math.floor(wood)}</span>
        </div>

        {/* Food */}
        <div className="flex items-center gap-2" title={t('hud.foodTitle')}>
          <div className="w-7 h-7 rounded bg-red-950/70 border border-red-600/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/food.png?v=3"
              alt={t('hud.food')}
              className="w-full h-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span className="font-semibold text-slate-100 text-sm tabular-nums">{Math.floor(food)}</span>
        </div>

        {/* Gold */}
        <div className="flex items-center gap-2" title={t('hud.goldTitle')}>
          <div className="w-7 h-7 rounded bg-yellow-950/70 border border-yellow-600/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/gold.png?v=3"
              alt={t('hud.gold')}
              className="w-full h-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span className="font-semibold text-slate-100 text-sm tabular-nums">{Math.floor(gold)}</span>
        </div>

        {/* Stone */}
        <div className="flex items-center gap-2" title={t('hud.stoneTitle')}>
          <div className="w-7 h-7 rounded bg-slate-800/70 border border-slate-500/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/stone.png?v=3"
              alt={t('hud.stone')}
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
        <div className="flex items-center gap-2" title={t('hud.populationTitle')}>
          <div className="w-7 h-7 rounded bg-sky-950/70 border border-sky-600/50 flex items-center justify-center p-0.5 shadow-inner">
            <img
              src="/assets/icons/population.png?v=3"
              alt={t('hud.population')}
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
          title={t('hud.idleVillagersTitle')}
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
        {underAttack && (
          <span className="text-xs font-bold text-red-200 border border-red-500/80 bg-red-950/80 px-1.5 py-0.5 rounded animate-pulse">
            {t('hud.underAttack')}
          </span>
        )}
        <Wifi size={14} className={isConnected ? 'text-emerald-400' : 'text-red-500 animate-pulse'} />
        <span className={isConnected ? 'text-emerald-400' : 'text-red-400'}>
          {isConnected ? t('hud.online') : t('hud.offline')}
        </span>
        <LanguageSwitcher compact />
      </div>
    </div>
    {citadelStatus && (
      <div className="pointer-events-none absolute left-2 top-[4.25rem] z-20 flex">
        <CitadelBar status={citadelStatus} />
      </div>
    )}
    </>
  );
};
