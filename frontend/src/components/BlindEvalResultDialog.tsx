import type { MouseEvent as ReactMouseEvent } from 'react';
import type { BlindEvalApi } from '../types';

interface BlindEvalResultDialogProps {
  blind: BlindEvalApi;
  onClose: () => void;
}

function BlindEvalResultDialog({ blind, onClose }: BlindEvalResultDialogProps) {
  const counts = new Map<string, number>();
  for (const alias of Object.values(blind.aliases)) counts.set(alias, 0);
  for (const alias of blind.votes.values()) {
    counts.set(alias, (counts.get(alias) ?? 0) + 1);
  }
  const totalWin = [...counts.values()].reduce((a, b) => a + b, 0);

  const rows = Object.entries(blind.aliases).map(([path, alias]) => {
    const win = counts.get(alias) ?? 0;
    const loss = totalWin - win;
    const tie = blind.total - win - loss;
    return { path, alias, win, tie, loss };
  });

  const handleBackdropClick = (e: ReactMouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-[560px] max-h-[80vh] flex flex-col bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="flex items-center justify-between p-2 border-b border-[#3c3c3c]">
          <span className="text-sm text-[#e0e0e0]">评测结果（当前份共 {blind.total} 项）</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[#888888] hover:text-[#e0e0e0] px-1"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2">
          {rows.map(({ path, alias, win, tie, loss }) => (
            <div key={path} className="flex items-center gap-2 text-sm">
              <span className="shrink-0 text-[#888888]">{alias}</span>
              <span
                className="flex-1 min-w-0 truncate text-right"
                style={{ direction: 'rtl' }}
                title={path}
              >
                <span dir="ltr" className="text-[#c0c0c0]">
                  {path}
                </span>
              </span>
              <span className="shrink-0 font-mono">
                <span className="text-[#4ade80]">win[{win}]</span>
                <span className="text-[#e0e0e0]">-tie[{tie}]-</span>
                <span className="text-[#facc15]">loss[{loss}]</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BlindEvalResultDialog;
