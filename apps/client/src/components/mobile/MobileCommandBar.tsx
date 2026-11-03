import React from 'react';
import {
  Hand,
  Landmark,
  Minus,
  MousePointerClick,
  Plus,
  Route,
  Shield,
  SquareDashed,
  Swords,
  X
} from 'lucide-react';
import type { ArmedOrder } from '../../game/scenes/WorldScene.js';

interface MobileCommandBarProps {
  /** The current selection can be commanded (at least one unit). */
  hasUnits: boolean;
  /** A single own building is selected, which exposes the rally-point order. */
  hasOwnBuilding: boolean;
  /** Which order is armed, so its button reads as pressed. */
  armed: ArmedOrder | null;
  /** The one-shot box-selection mode is armed. */
  boxSelectArmed: boolean;
  onArmContextual: () => void;
  onArmAttackMove: () => void;
  onArmPatrol: () => void;
  onStop: () => void;
  onCycleStance: () => void;
  onToggleBoxSelect: () => void;
  onClearSelection: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterBase: () => void;
  onCancelArmed: () => void;
}

interface CommandButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Tooltip and accessible name; the visible label is shortened for the bar. */
  title?: string;
}

/**
 * One command key. 48 px tall and never narrower than 44 px: below that a thumb
 * cannot hit it reliably, which is the whole reason the desktop dock is replaced.
 */
const CommandButton: React.FC<CommandButtonProps> = ({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
  title
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title ?? label}
    aria-label={title ?? label}
    aria-pressed={active}
    className={`flex h-12 min-w-[46px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 transition-colors ${
      active
        ? 'border-amber-400 bg-amber-600/40 text-amber-100 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
        : disabled
          ? 'border-slate-800 bg-slate-900/60 text-slate-600'
          : 'aoe-button border-amber-900/70 text-slate-200 active:brightness-125'
    }`}
  >
    {icon}
    <span className="max-w-[52px] truncate text-[9px] font-semibold leading-none">{label}</span>
  </button>
);

/**
 * MOB-05: the touch replacement for right-click and the keyboard order keys.
 *
 * Every button maps to an existing desktop action:
 * "Ra lệnh" arms the contextual dispatch (what a right click does), "Đánh" and
 * "Tuần tra" arm the same modes as `A` / `P`, and the rest are the `S`, `D`, `.`
 * and `+/-` keys. Nothing here sends a message directly; the buttons just raise
 * intents the scene already knows how to execute, so touch and desktop can never
 * disagree about what an order means.
 *
 * Always present while a room is joined: zoom, "Nhà chính" and "Chọn vùng" are
 * useful with nothing selected, and hiding the bar would reflow the dock mid-tap.
 * The buttons that need a selection are simply disabled.
 */
export const MobileCommandBar: React.FC<MobileCommandBarProps> = ({
  hasUnits,
  hasOwnBuilding,
  armed,
  boxSelectArmed,
  onArmContextual,
  onArmAttackMove,
  onArmPatrol,
  onStop,
  onCycleStance,
  onToggleBoxSelect,
  onClearSelection,
  onZoomIn,
  onZoomOut,
  onCenterBase,
  onCancelArmed
}) => {
  const canCommand = hasUnits || hasOwnBuilding;

  return (
    <div
      className="pointer-events-auto flex w-full items-center justify-start gap-1 overflow-x-auto rounded-lg border border-amber-800/60 bg-slate-950/85 px-1.5 py-1.5 shadow-2xl backdrop-blur-sm"
      data-mobile-command-bar
    >
      {armed !== null && (
        <CommandButton
          label="Huỷ lệnh"
          icon={<X size={18} className="text-red-300" />}
          onClick={onCancelArmed}
          active
          title="Huỷ lệnh đang chờ"
        />
      )}

      <CommandButton
        label="Ra lệnh"
        icon={<MousePointerClick size={18} />}
        onClick={onArmContextual}
        active={armed === 'CONTEXT'}
        disabled={!canCommand}
        title="Chạm điểm đích: đánh / thu hoạch / vào cổng / di chuyển"
      />
      <CommandButton
        label="Đánh"
        icon={<Swords size={18} />}
        onClick={onArmAttackMove}
        active={armed === 'ATTACK_MOVE'}
        disabled={!hasUnits}
        title="Đánh theo đường (attack-move)"
      />
      <CommandButton
        label="Tuần tra"
        icon={<Route size={18} />}
        onClick={onArmPatrol}
        active={armed === 'PATROL'}
        disabled={!hasUnits}
        title="Tuần tra tới điểm chạm"
      />
      <CommandButton
        label="Dừng"
        icon={<Hand size={18} />}
        onClick={onStop}
        disabled={!hasUnits}
        title="Dừng lệnh hiện tại"
      />
      <CommandButton
        label="Thế trận"
        icon={<Shield size={18} />}
        onClick={onCycleStance}
        disabled={!hasUnits}
        title="Đổi thế trận (chủ động / phòng thủ / cố thủ / không đánh)"
      />

      <div className="mx-0.5 h-8 w-px shrink-0 bg-slate-700" />

      <CommandButton
        label="Chọn vùng"
        icon={<SquareDashed size={18} />}
        onClick={onToggleBoxSelect}
        active={boxSelectArmed}
        title="Bật rồi kéo một lần để chọn nhiều quân"
      />
      <CommandButton
        label="Bỏ chọn"
        icon={<X size={18} />}
        onClick={onClearSelection}
        disabled={!canCommand}
        title="Bỏ chọn toàn bộ"
      />

      <div className="mx-0.5 h-8 w-px shrink-0 bg-slate-700" />

      <CommandButton label="−" icon={<Minus size={18} />} onClick={onZoomOut} title="Thu nhỏ" />
      <CommandButton label="+" icon={<Plus size={18} />} onClick={onZoomIn} title="Phóng to" />
      <CommandButton
        label="Nhà chính"
        icon={<Landmark size={18} />}
        onClick={onCenterBase}
        title="Về nhà chính"
      />
    </div>
  );
};
