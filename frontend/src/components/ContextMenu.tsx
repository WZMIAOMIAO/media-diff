import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  children: ReactNode;
}

const MARGIN = 8;

/**
 * Fixed-position context menu that stays inside the viewport.
 *
 * Right-clicking near the bottom/right edge used to place the menu partly
 * off-screen, so the last items could not be reached. The menu renders hidden
 * at the cursor, is measured in a layout effect (before paint), then clamped so
 * its full box fits. Extremely tall content is capped and made scrollable.
 */
function ContextMenu({ x, y, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - MARGIN;
    const maxTop = window.innerHeight - rect.height - MARGIN;
    setPos({
      left: Math.max(MARGIN, Math.min(x, maxLeft)),
      top: Math.max(MARGIN, Math.min(y, maxTop)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[180px] py-1 bg-[#2b2b2b] border border-[#3c3c3c] rounded shadow-lg"
      style={{
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        visibility: pos ? 'visible' : 'hidden',
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
      }}
      onClick={(e: ReactMouseEvent) => e.stopPropagation()}
      onContextMenu={(e: ReactMouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

export default ContextMenu;
