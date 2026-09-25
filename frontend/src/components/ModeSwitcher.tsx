import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type Mode = 'image' | 'video';

const MODES: { key: Mode; label: string; path: string }[] = [
  { key: 'image', label: '图像模式', path: '/image' },
  { key: 'video', label: '视频模式', path: '/video' },
];

function ModeSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current: Mode = location.pathname.startsWith('/video') ? 'video' : 'image';
  const currentLabel = MODES.find((m) => m.key === current)?.label ?? '图像模式';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (mode: (typeof MODES)[number]) => {
    setOpen(false);
    if (mode.key !== current) navigate(mode.path);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="切换模式"
        className="flex items-center gap-1.5 px-2 py-1 text-sm text-[#e0e0e0] bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
      >
        <span>{currentLabel}</span>
        <span className={`text-[10px] text-[#888888] transition-transform ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-50 min-w-[130px] py-1 bg-[#2b2b2b] border border-[#3c3c3c] rounded shadow-lg">
          {MODES.map((mode) => {
            const active = mode.key === current;
            return (
              <button
                key={mode.key}
                type="button"
                onClick={() => select(mode)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-sm text-left ${
                  active
                    ? 'text-[#4a9eff]'
                    : 'text-[#e0e0e0] hover:bg-[#3c3c3c]'
                }`}
              >
                <span>{mode.label}</span>
                {active && <span className="text-xs">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ModeSwitcher;
