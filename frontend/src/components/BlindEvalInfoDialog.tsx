import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { loadBlindEval } from '../api';

interface BlindEvalInfoDialogProps {
  outputPath: string;
  onClose: () => void;
}

function BlindEvalInfoDialog({ outputPath, onClose }: BlindEvalInfoDialogProps) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadBlindEval(outputPath)
      .then((data) => {
        if (!cancelled) setContent(JSON.stringify(data, null, 4));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [outputPath]);

  const handleBackdropClick = (e: ReactMouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-[560px] max-h-[80vh] flex flex-col bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="flex items-center gap-2 p-2 border-b border-[#3c3c3c]">
          <span className="flex-1 min-w-0 truncate text-xs text-[#888888]" title={outputPath}>
            {outputPath}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[#888888] hover:text-[#e0e0e0] px-1"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-2">
          {loading && <span className="text-sm text-[#888888]">加载中...</span>}
          {error && <span className="text-sm text-[#ef4444]">{error}</span>}
          {!loading && !error && (
            <pre className="text-xs text-[#e0e0e0] whitespace-pre-wrap break-all font-mono">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default BlindEvalInfoDialog;
