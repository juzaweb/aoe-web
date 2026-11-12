import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  Coins,
  Lock,
  MapPin,
  ShieldBan,
  Users,
  XCircle
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RejectCode } from '@chien-quoc/shared';
import { getRejectVisual } from '../game/alerts/rejectVisuals.js';

const REJECT_ICON_MAP: Record<string, LucideIcon> = {
  Coins,
  MapPin,
  Lock,
  Clock,
  XCircle,
  AlertTriangle,
  ShieldBan,
  Users,
  AlertCircle
};

function RejectIcon({ iconKey, className }: { iconKey: string; className: string }) {
  const Icon = REJECT_ICON_MAP[iconKey] ?? AlertCircle;
  // Decorative: the message already says what went wrong, so announcing the
  // icon name as well only makes the screen-reader output longer.
  return <Icon size={16} className={className} aria-hidden="true" />;
}

/**
 * The red banner that explains a refused command or a failed action.
 *
 * Kept out of `App` so the component tree stays readable: this is presentation
 * only, driven by the code the server sends with the message.
 */
export const RejectNotification: React.FC<{
  message: string;
  code: RejectCode | null;
  /**
   * Monotonic counter from `showNotification`, used as the node key. A polite
   * live region is only re-read when its content changes, so rejecting the same
   * command twice ("insufficient wood") would be silent the second time without
   * a remount.
   */
  seq: number;
}> = ({ message, code, seq }) => {
  const visual = getRejectVisual(code);
  return (
    <div
      key={seq}
      role="status"
      aria-live="polite"
      data-reject-notification
      data-reject-seq={seq}
      className={visual.containerClass}
    >
      <RejectIcon iconKey={visual.iconKey} className={visual.iconClass} />
      <span>{message}</span>
    </div>
  );
};
