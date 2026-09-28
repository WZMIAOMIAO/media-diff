import { useState } from 'react';
import type { SelectedFolder } from '../types';
import type { WatermarkStyle } from '../utils/watermarkStorage';

interface WatermarkDialogProps {
  folders: SelectedFolder[];
  style: WatermarkStyle;
  onStyleChange: (patch: Partial<WatermarkStyle>) => void;
  texts: Record<number, string>;
  onTextChange: (index: number, text: string) => void;
  onFillFolderNames: () => void;
  onClearTexts: () => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#ff0000', '#ff8800', '#ffff00', '#00ff00',
  '#0088ff', '#aa00ff', '#ffffff', '#000000',
];

const LABELS = ['窗口一', '窗口二', '窗口三', '窗口四'];

function clampFontSize(value: number): number {
  return Math.max(8, Math.min(72, value));
}

export default function WatermarkDialog({
  folders,
  style,
  onStyleChange,
  texts,
  onTextChange,
  onFillFolderNames,
  onClearTexts,
  onClose,
}: WatermarkDialogProps) {
  // Font size is edited as a free-form string so partial input (e.g. "1" on the
  // way to "18") is not clamped mid-typing. The style only updates once the
  // value is valid, and it is clamped when the field loses focus.
  const [fontDraft, setFontDraft] = useState<string | null>(null);
  const fontSizeValue = fontDraft ?? String(style.fontSize);

  const changeFontSize = (raw: string) => {
    setFontDraft(raw);
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 8 && n <= 72) onStyleChange({ fontSize: n });
  };

  const commitFontSize = () => {
    if (fontDraft === null) return;
    const n = parseInt(fontDraft, 10);
    if (Number.isNaN(n)) {
      setFontDraft(null);
      return;
    }
    const clamped = clampFontSize(n);
    onStyleChange({ fontSize: clamped });
    setFontDraft(String(clamped));
  };

  const backdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={backdropClick}
    >
      <div className="w-[440px] max-h-[82vh] flex flex-col bg-[#2b2b2b] border border-[#3c3c3c] rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center px-4 h-11 shrink-0 border-b border-[#3c3c3c]">
          <span className="text-sm font-medium text-[#e8e8e8]">水印设置</span>
        </div>

        {/* 全局样式：颜色与字号对所有窗口统一生效 */}
        <div className="p-3 border-b border-[#3c3c3c]">
          <div className="rounded-lg bg-[#313131] border border-[#3c3c3c] p-3">
            <div className="flex items-baseline gap-2 mb-2.5">
              <span className="text-xs text-[#e0e0e0]">统一样式</span>
              <span className="text-[11px] text-[#777777]">应用到所有窗口</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="shrink-0 w-8 text-xs text-[#888888]">颜色</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => onStyleChange({ color: c })}
                    className={`w-5 h-5 rounded border transition-transform hover:scale-110 ${
                      style.color.toLowerCase() === c ? 'border-[#4a9eff]' : 'border-[#555555]'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <label
                  title="自定义颜色"
                  className="relative w-5 h-5 rounded border border-[#555555] overflow-hidden cursor-pointer hover:scale-110 transition-transform"
                  style={{
                    background:
                      'conic-gradient(#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)',
                  }}
                >
                  <input
                    type="color"
                    value={style.color}
                    onChange={(e) => onStyleChange({ color: e.target.value })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </label>
              </div>
              <span className="ml-1 text-[11px] font-mono text-[#c0c0c0] tracking-wide">
                {style.color}
              </span>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <span className="shrink-0 w-8 text-xs text-[#888888]">字号</span>
              <input
                type="number"
                min={8}
                max={72}
                value={fontSizeValue}
                onChange={(e) => changeFontSize(e.target.value)}
                onBlur={commitFontSize}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="w-20 pl-3 pr-8 py-1 text-sm text-right bg-[#1e1e1e] border border-[#3c3c3c] rounded-md text-[#e0e0e0] focus:outline-none focus:border-[#4a9eff] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-xs text-[#888888]">px</span>
            </div>
          </div>
        </div>

        {/* 各窗口文字 */}
        <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2.5">
          {folders.map((f, i) => (
            <div
              key={f.path}
              className="rounded-lg bg-[#313131] border border-[#3c3c3c] p-3 transition-colors hover:border-[#4a4a4a]"
            >
              <div className="flex items-baseline gap-2 mb-2">
                <span className="shrink-0 text-xs text-[#e0e0e0]">
                  {LABELS[i] ?? `窗口${i + 1}`}
                </span>
                <span className="min-w-0 truncate text-xs text-[#777777]" title={f.name}>
                  {f.name}
                </span>
              </div>
              <input
                type="text"
                value={texts[i] ?? ''}
                onChange={(e) => onTextChange(i, e.target.value)}
                placeholder="输入水印文字"
                className="w-full px-2.5 py-1.5 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded-md text-[#e0e0e0] placeholder:text-[#666666] focus:outline-none focus:border-[#4a9eff] transition-colors"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#3c3c3c]">
          <button
            type="button"
            onClick={onFillFolderNames}
            className="px-3 py-1.5 text-xs bg-[#333333] border border-[#3c3c3c] rounded-md text-[#c0c0c0] hover:border-[#555555] hover:text-[#e0e0e0] transition-colors"
          >
            填充文件夹名
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClearTexts}
              className="px-3 py-1.5 text-xs bg-[#333333] border border-[#3c3c3c] rounded-md text-[#c0c0c0] hover:border-[#555555] hover:text-[#e0e0e0] transition-colors"
            >
              清除全部
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-[#4a9eff] border border-[#4a9eff] rounded-md text-white hover:opacity-90 transition-opacity"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
