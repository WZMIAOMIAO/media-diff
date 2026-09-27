import { useEffect, useRef, useState } from 'react';
import { copyText } from '../utils/clipboard';

interface CopyableFileNameProps {
  name: string;
  className?: string;
}

/**
 * Truncated file name that can be copied in full even when it does not fit.
 *
 * The visible text is selectable, and a dedicated copy button copies the
 * complete name (the visible ellipsis would otherwise make plain selection
 * unreliable for very long names).
 */
export default function CopyableFileName({ name, className = '' }: CopyableFileNameProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    void copyText(name).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <span className={`group flex items-center gap-1 min-w-0 ${className}`}>
      <span className="truncate select-text cursor-text min-w-0" title={name}>
        {name}
      </span>
      <button
        type="button"
        title="复制文件名"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleCopy}
        className="shrink-0 text-[#888888] hover:text-[#e0e0e0] opacity-60 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </span>
  );
}
