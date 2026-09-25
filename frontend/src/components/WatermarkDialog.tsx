import type { SelectedFolder, WatermarkConfig } from '../types';

interface WatermarkDialogProps {
  folders: SelectedFolder[];
  configs: Record<number, WatermarkConfig>;
  onConfigsChange: (configs: Record<number, WatermarkConfig>) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#ff0000', '#ff8800', '#ffff00', '#00ff00',
  '#0088ff', '#aa00ff', '#ffffff', '#000000',
];

const LABELS = ['窗口一', '窗口二', '窗口三', '窗口四'];

const DEFAULT: WatermarkConfig = { text: '', color: '#ff0000', fontSize: 24 };

export default function WatermarkDialog({
  folders,
  configs,
  onConfigsChange,
  onClose,
}: WatermarkDialogProps) {
  const update = (i: number, patch: Partial<WatermarkConfig>) => {
    const cur = configs[i] ?? DEFAULT;
    onConfigsChange({ ...configs, [i]: { ...cur, ...patch } });
  };

  const clearAll = () => {
    onConfigsChange({});
  };

  const fillFolderNames = () => {
    const next: Record<number, WatermarkConfig> = { ...configs };
    folders.forEach((f, i) => {
      const cur = next[i] ?? DEFAULT;
      next[i] = { ...cur, text: f.name };
    });
    onConfigsChange(next);
  };

  const backdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={backdropClick}
    >
      <div className="w-[480px] max-h-[80vh] overflow-auto bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="px-4 py-2 border-b border-[#3c3c3c] text-sm text-[#e0e0e0] font-bold">
          水印设置
        </div>

        <div className="p-3 space-y-3">
          {folders.map((f, i) => {
            const cfg = configs[i] ?? DEFAULT;
            return (
              <div key={f.path} className="p-2 bg-[#333333] rounded border border-[#3c3c3c]">
                <div className="text-xs text-[#888888] mb-1">
                  {LABELS[i] ?? `窗口${i + 1}`} — {f.name}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="text"
                    value={cfg.text}
                    onChange={(e) => update(i, { text: e.target.value })}
                    placeholder="水印文字"
                    className="flex-1 min-w-0 px-2 py-1 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded text-[#e0e0e0] focus:outline-none focus:border-[#555555]"
                  />
                  <input
                    type="number"
                    min={8}
                    max={72}
                    value={cfg.fontSize}
                    onChange={(e) => update(i, { fontSize: Math.max(8, Math.min(72, parseInt(e.target.value) || 24)) })}
                    className="w-14 px-1 py-1 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded text-[#e0e0e0]"
                  />
                  <span className="text-xs text-[#888888]">px</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => update(i, { color: c })}
                      className={`w-5 h-5 rounded border-2 ${cfg.color === c ? 'border-[#4a9eff]' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={cfg.color}
                    onChange={(e) => update(i, { color: e.target.value })}
                    className="w-6 h-6 bg-transparent border border-[#3c3c3c] rounded cursor-pointer"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-[#3c3c3c]">
          <button
            type="button"
            onClick={fillFolderNames}
            className="px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] hover:border-[#555555]"
          >
            填充文件夹名
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearAll}
              className="px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] hover:border-[#555555]"
            >
              清除全部
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-sm bg-[#4a9eff] border border-[#4a9eff] rounded text-white hover:opacity-90"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
