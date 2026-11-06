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
  return <Icon size={16} className={className} />;
}

/**
 * The red banner that explains a refused command or a failed action.
 *
 * Kept out of `App` so the component tree stays readable: this is presentation
 * only, driven by the code the server sends with the message.
 */
export const RejectNotification: React.FC<{ message: string; code: RejectCode | null }> = ({
  message,
  code
}) => {
  const visual = getRejectVisual(code);
  return (
    <div className={visual.containerClass}>
      <RejectIcon iconKey={visual.iconKey} className={visual.iconClass} />
      <span>{message}</span>
    </div>
  );
};
