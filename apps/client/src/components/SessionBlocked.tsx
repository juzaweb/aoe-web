import React from 'react';
import { LogIn, ShieldAlert, UserPlus } from 'lucide-react';

interface SessionBlockedProps {
  /** Take the account over from the session that currently holds it. */
  onTakeover: () => void;
  /** Forget the stored token and go back to the login/register screen. */
  onUseAnotherAccount: () => void;
}

/**
 * SESS-06: shown when the server refuses this tab because the account is already
 * being played elsewhere, or when another device took the session over.
 *
 * Both escapes are explicit: nothing here retries on its own, so two tabs can
 * never end up fighting over the account.
 */
export const SessionBlocked: React.FC<SessionBlockedProps> = ({
  onTakeover,
  onUseAnotherAccount
}) => {
  return (
    <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="aoe-panel w-full max-w-md p-6 rounded-xl flex flex-col items-center text-center shadow-2xl border-2 border-amber-600 my-auto">
        <div className="p-3 rounded-full bg-amber-950/60 border border-amber-600/50 mb-3 text-amber-400">
          <ShieldAlert size={36} />
        </div>

        <h1 className="font-medieval text-2xl font-bold text-amber-300 tracking-wider mb-2">
          TÀI KHOẢN ĐANG ĐƯỢC ĐĂNG NHẬP
        </h1>
        <p className="text-xs text-slate-300 mb-6 max-w-xs">
          Tài khoản này đang được điều khiển đế chế ở một tab hoặc thiết bị khác. Mỗi tài khoản chỉ
          được có một phiên chơi tại một thời điểm.
        </p>

        <div className="w-full space-y-2.5">
          <button
            type="button"
            onClick={onTakeover}
            className="w-full py-2.5 rounded bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-bold tracking-wider text-sm uppercase shadow-lg transition-all border border-amber-400 cursor-pointer flex items-center justify-center gap-2"
          >
            <LogIn size={16} />
            Đăng xuất thiết bị khác &amp; vào game
          </button>

          <button
            type="button"
            onClick={onUseAnotherAccount}
            className="w-full py-2.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold tracking-wider text-sm uppercase transition-all border border-slate-700 hover:border-amber-600 cursor-pointer flex items-center justify-center gap-2"
          >
            <UserPlus size={16} />
            Đăng nhập tài khoản khác
          </button>
        </div>

        <p className="mt-5 text-[11px] text-slate-500">
          Phiên đang chơi sẽ bị ngắt nếu bạn chọn chiếm quyền.
        </p>
      </div>
    </div>
  );
};
