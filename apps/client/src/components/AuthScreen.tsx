import React, { useState } from 'react';
import { AlertCircle, Loader2, Lock, LogIn, Swords, UserPlus } from 'lucide-react';
import { AuthUser, login, register } from '../auth/api.js';
import { useInputMode } from '../device/useInputMode.js';

type AuthMode = 'login' | 'register';

interface AuthScreenProps {
  /** Called once the server accepted the credentials. */
  onAuthenticated: (user: AuthUser) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** MOB-07: the shortcut cheat-sheet has to teach the gesture this device has. */
  const isTouch = useInputMode() === 'touch';

  const switchMode = (next: AuthMode) => {
    if (isSubmitting) return;
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const result =
        mode === 'login'
          ? await login({ username, password })
          : await register({ username, displayName, password });
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đã xảy ra lỗi không xác định.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-md">
      <div className="aoe-panel my-auto flex max-h-[94dvh] w-full max-w-md flex-col items-center overflow-y-auto border-2 border-amber-600 p-4 text-center shadow-2xl sm:p-6">
        <div className="p-3 rounded-full bg-amber-950/60 border border-amber-600/50 mb-3 text-amber-400">
          <Swords size={36} />
        </div>

        <h1 className="font-medieval text-2xl font-bold text-amber-300 tracking-wider mb-1">
          CHIẾN QUỐC MMO RTS
        </h1>
        <p className="text-xs text-slate-300 mb-5 max-w-xs">
          Xây dựng đế chế, khai khoáng và thống nhất thiên hạ trong thế giới 2.5D Isometric.
        </p>

        {/* Mode tabs */}
        <div className="w-full grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`min-h-[44px] rounded border py-2 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              mode === 'login'
                ? 'bg-amber-600 text-slate-950 border-amber-400'
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-600'
            }`}
          >
            Đăng Nhập
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`min-h-[44px] rounded border py-2 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              mode === 'register'
                ? 'bg-amber-600 text-slate-950 border-amber-400'
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-600'
            }`}
          >
            Đăng Ký
          </button>
        </div>

        <form onSubmit={handleSubmit} className="w-full space-y-3 text-left">
          <div>
            <label htmlFor="auth-username" className="block text-xs font-semibold text-slate-300 mb-1">
              Tên đăng nhập
            </label>
            <input
              id="auth-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="vd: dai_viet"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={24}
              className="w-full min-h-[44px] rounded border border-amber-800 bg-slate-900 px-3 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label htmlFor="auth-display" className="block text-xs font-semibold text-slate-300 mb-1">
                Tên lãnh chúa (hiển thị trong game)
              </label>
              <input
                id="auth-display"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="vd: Đại Việt"
                maxLength={24}
                className="w-full min-h-[44px] rounded border border-amber-800 bg-slate-900 px-3 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-300 mb-1">
              Mật khẩu
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Tối thiểu 6 ký tự' : '••••••'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'register' ? 6 : undefined}
              maxLength={128}
              className="w-full min-h-[44px] rounded border border-amber-800 bg-slate-900 px-3 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded bg-red-950/70 border border-red-600/70 px-3 py-2 text-[11px] text-red-200">
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded border border-amber-400 bg-gradient-to-r from-amber-600 to-amber-700 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-950 shadow-lg transition-all hover:from-amber-500 hover:to-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Đang kết nối...
              </>
            ) : mode === 'login' ? (
              <>
                <LogIn size={16} />
                Vào Thế Giới
              </>
            ) : (
              <>
                <UserPlus size={16} />
                Tạo Đế Chế
              </>
            )}
          </button>
        </form>

        <div className="mt-5 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Lock size={12} />
          <span>Mật khẩu được mã hoá bằng scrypt trên máy chủ.</span>
        </div>

        {isTouch ? (
          <div className="mt-4 space-y-1 text-[11px] text-slate-400">
            <div>
              <span className="font-mono text-amber-400">Kéo 1 ngón</span> để di chuyển camera,{' '}
              <span className="font-mono text-amber-400">chụm 2 ngón</span> để phóng to / thu nhỏ
            </div>
            <div>
              <span className="font-mono text-amber-400">Chạm</span> để chọn quân / công trình, chạm
              nền trống để đi tới
            </div>
            <div>
              <span className="font-mono text-amber-400">Giữ lâu</span> vào mục tiêu để đánh / khai
              thác / vào cổng
            </div>
            <div>
              Thanh lệnh dưới màn hình có{' '}
              <span className="font-mono text-amber-400">Ra lệnh</span>,{' '}
              <span className="font-mono text-amber-400">Đánh</span>,{' '}
              <span className="font-mono text-amber-400">Tuần tra</span>,{' '}
              <span className="font-mono text-amber-400">Chọn vùng</span> và zoom
            </div>
            <div>
              Chạm minimap để nhảy camera, giữ lâu trên minimap để điều quân tới đó
            </div>
          </div>
        ) : (
        <div className="mt-4 text-[11px] text-slate-400 space-y-1">
          <div>
            <span className="text-amber-400 font-mono">Phím mũi tên</span> hoặc rê chuột ra{' '}
            <span className="text-amber-400 font-mono">mép màn hình</span> để di chuyển camera
          </div>
          <div>
            Cuộn <span className="text-amber-400 font-mono">Chuột</span> để phóng to/thu nhỏ,{' '}
            <span className="text-amber-400 font-mono">+</span> /{' '}
            <span className="text-amber-400 font-mono">-</span> để zoom từng nấc
          </div>
          <div>
            Giữ <span className="text-amber-400 font-mono">Chuột giữa</span> và kéo để di chuyển
            camera
          </div>
          <div>
            <span className="text-amber-400 font-mono">Ctrl</span> /{' '}
            <span className="text-amber-400 font-mono">Shift</span> +{' '}
            <span className="text-amber-400 font-mono">F2..F4</span> lưu vị trí camera,{' '}
            <span className="text-amber-400 font-mono">F2..F4</span> nhảy về vị trí đã lưu
          </div>
          <div>
            <span className="text-amber-400 font-mono">Chuột trái</span> chọn / quét quân,{' '}
            <span className="text-amber-400 font-mono">Chuột phải</span> điều quân & khai thác
          </div>
          <div>
            <span className="text-amber-400 font-mono">Ctrl + kéo</span> chỉ quét lính,{' '}
            <span className="text-amber-400 font-mono">Alt + kéo</span> chỉ quét nông dân
          </div>
          <div>
            <span className="text-amber-400 font-mono">Shift</span> + click để cộng/bớt quân,{' '}
            <span className="text-amber-400 font-mono">Ctrl</span> + click hoặc double-click chọn
            cùng loại
          </div>
          <div>
            <span className="text-amber-400 font-mono">Shift + Chuột phải</span> xếp nhiều điểm
            đến liên tiếp (giữ Shift để xem đường đi)
          </div>
          <div>
            <span className="text-amber-400 font-mono">Chọn công trình + Chuột phải</span> đặt
            điểm tập kết (rally) cho lính mới
          </div>
          <div>
            <span className="text-amber-400 font-mono">Chuột phải trên minimap</span> ra lệnh di
            chuyển tới đúng chỗ đó (chuột trái để pan camera)
          </div>
          <div>
            <span className="text-amber-400 font-mono">Ctrl + 1..9</span> gán nhóm,{' '}
            <span className="text-amber-400 font-mono">1..9</span> gọi lại nhóm
          </div>
          <div>
            <span className="text-amber-400 font-mono">S</span> dừng quân đang chọn tại chỗ
            (huỷ lệnh hiện tại)
          </div>
          <div>
            <span className="text-amber-400 font-mono">D</span> đổi thế trận: Chủ động → Phòng thủ
            → Cố thủ → Không đánh
          </div>
          <div>
            <span className="text-amber-400 font-mono">.</span> nhảy tới nông dân đang rảnh,{' '}
            <span className="text-amber-400 font-mono">Ctrl + .</span> nhảy tới lính đang rảnh,{' '}
            <span className="text-amber-400 font-mono">H</span> về Town Center
          </div>
          <div>
            <span className="text-amber-400 font-mono">Delete</span> /{' '}
            <span className="text-amber-400 font-mono">Backspace</span> huỷ móng nhà đang chọn (hoàn
            lại tài nguyên), <span className="text-amber-400 font-mono">✕</span> trong bảng chi tiết
            huỷ đơn vị đang huấn luyện
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
