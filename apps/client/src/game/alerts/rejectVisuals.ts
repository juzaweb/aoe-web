import { RejectCode } from '@chien-quoc/shared';

export interface RejectVisual {
  containerClass: string;
  iconClass: string;
  iconKey: string;
}

/**
 * Positioning deliberately lives in `TopOverlayStack` (UIX-10), not here: every
 * banner that carried its own `top-*` collided with its neighbours.
 */
const BASE =
  'aoe-frame-sm px-4 py-2 shadow-2xl backdrop-blur-md flex items-center gap-2 text-sm animate-bounce';

const DEFAULT_VISUAL: RejectVisual = {
  containerClass: `${BASE} bg-red-950/90 border border-red-500/80 text-red-200`,
  iconClass: 'text-red-400',
  iconKey: 'AlertCircle'
};

export const REJECT_VISUALS: Record<RejectCode, RejectVisual> = {
  [RejectCode.RESOURCE]: {
    containerClass: `${BASE} bg-amber-950/90 border border-amber-500/80 text-amber-200`,
    iconClass: 'text-amber-400',
    iconKey: 'Coins'
  },
  [RejectCode.PLACEMENT]: {
    containerClass: `${BASE} bg-red-950/90 border border-red-500/80 text-red-200`,
    iconClass: 'text-red-400',
    iconKey: 'MapPin'
  },
  [RejectCode.PREREQUISITE]: {
    containerClass: `${BASE} bg-blue-950/90 border border-blue-500/80 text-blue-200`,
    iconClass: 'text-blue-400',
    iconKey: 'Lock'
  },
  [RejectCode.BUSY]: {
    containerClass: `${BASE} bg-slate-950/90 border border-slate-500/80 text-slate-200`,
    iconClass: 'text-slate-400',
    iconKey: 'Clock'
  },
  [RejectCode.GONE]: {
    containerClass: `${BASE} bg-zinc-950/90 border border-zinc-500/80 text-zinc-200`,
    iconClass: 'text-zinc-400',
    iconKey: 'XCircle'
  },
  [RejectCode.INVALID]: {
    containerClass: `${BASE} bg-red-950/90 border border-red-500/80 text-red-200`,
    iconClass: 'text-red-400',
    iconKey: 'AlertTriangle'
  },
  [RejectCode.FORBIDDEN]: {
    containerClass: `${BASE} bg-rose-950/90 border border-rose-500/80 text-rose-200`,
    iconClass: 'text-rose-400',
    iconKey: 'ShieldBan'
  },
  [RejectCode.LIMIT]: {
    containerClass: `${BASE} bg-orange-950/90 border border-orange-500/80 text-orange-200`,
    iconClass: 'text-orange-400',
    iconKey: 'Users'
  }
};

export function getRejectVisual(code: RejectCode | null): RejectVisual {
  if (code !== null && Object.prototype.hasOwnProperty.call(REJECT_VISUALS, code)) {
    return REJECT_VISUALS[code as RejectCode];
  }
  return DEFAULT_VISUAL;
}
