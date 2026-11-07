import React from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import type { ControlGroupSummary } from '../game/scenes/WorldScene.js';

/**
 * Short unit labels for the group rows, translated by the active language.
 */
export function useUnitShortLabels(): Record<string, string> {
  const { t } = useTranslation();
  const map: Record<string, string> = {};
  for (const type of ['VILLAGER', 'SPEARMAN', 'ARCHER', 'CAVALRY']) {
    map[type] = t(`controlGroups.${type}`);
  }
  return map;
}

interface ControlGroupsProps {
  groups: ControlGroupSummary[];
  /** UIX-03: same recall as pressing the group's digit key. */
  onSelectGroup: (index: number) => void;
  /** MOB-06: narrower, one-line rows for the landscape phone HUD. */
  compact?: boolean;
}

/**
 * UIX-03: the `Ctrl+1..9` rosters, mirrored next to the HUD.
 *
 * AoE2 has no equivalent panel (it relies on muscle memory), but a browser RTS
 * loses the digit keys to tab switching often enough that the groups need to be
 * visible and clickable. Nothing renders while no group exists, so a player who
 * never groups units sees no extra chrome.
 */
export const ControlGroups: React.FC<ControlGroupsProps> = ({ groups, onSelectGroup, compact = false }) => {
  const { t } = useTranslation();
  const unitShortLabels = useUnitShortLabels();
  if (groups.length === 0) return null;

  return (
    <div
      className={`aoe-panel pointer-events-auto flex flex-col gap-1 rounded-lg ${
        compact ? 'w-32 p-1.5' : 'w-40 p-2'
      }`}
      data-control-groups
    >
      <div className="flex items-center gap-1.5 border-b border-amber-800/40 pb-1 text-[10px] font-bold tracking-wider text-amber-400">
        <Layers size={12} /> {t('controlGroups.title')}
      </div>

      {groups.map((group) => (
        <button
          key={group.index}
          type="button"
          onClick={() => onSelectGroup(group.index)}
          data-group-index={group.index}
          title={group.breakdown
            .map((entry) => `${unitShortLabels[entry.type] ?? entry.type} ×${entry.count}`)
            .join(', ')}
          className={`flex items-center gap-2 rounded border border-slate-700/70 bg-slate-900/70 px-1.5 text-left transition-colors hover:border-amber-400 hover:bg-slate-800/80 ${
            compact ? 'min-h-[34px] py-0.5' : 'py-1'
          }`}
        >
          <span className="w-4 shrink-0 text-center font-mono text-[10px] font-bold text-amber-300">
            {group.index}
          </span>
          <span className="flex-1 truncate font-semibold text-[11px] text-slate-200">
            {group.breakdown
              .map((entry) => `${unitShortLabels[entry.type] ?? entry.type} ${entry.count}`)
              .join(' · ')}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-slate-400 tabular-nums">
            {group.count}
          </span>
        </button>
      ))}
    </div>
  );
};
