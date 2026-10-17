import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import type { FileEntry } from '../api';
import type { SelectedFolder } from '../types';
import ThumbnailItem from './ThumbnailItem';
import { useI18n } from '../i18n';

interface ThumbnailColumnProps {
  folder: SelectedFolder;
  images: FileEntry[];
  originalCount: number;
  currentIndex: number;
  /** Changes on each align action; forces the column to line up the aligned row. */
  alignNonce: number;
  /** The column the align originated from (keeps its position). */
  alignSourcePath: string | null;
  /** Viewport-top offset of the source column's aligned image. */
  alignOffset: number;
  onSelect: (
    index: number,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    topInViewport: number,
  ) => void;
}

const ITEM_HEIGHT = 220;
const BUFFER = 3;

function ThumbnailColumn({
  folder,
  images,
  originalCount,
  currentIndex,
  alignNonce,
  alignSourcePath,
  alignOffset,
  onSelect,
}: ThumbnailColumnProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  // The scroll offset we intend the element to have. Kept in sync on every
  // user scroll / auto-scroll, and used to detect (and repair) the browser
  // resetting scrollTop to 0 when the column's DOM node is moved on reorder.
  const desiredScrollRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 切换图片时自动滚动到当前选中项. useLayoutEffect so it runs before paint
  // and before the scroll-repair effect below. On an align action the selected
  // row is pinned to the TOP of every column so the same image lines up across
  // columns (indices differ because folders sort differently).
  const alignNonceRef = useRef(alignNonce);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const alignRequested = alignNonceRef.current !== alignNonce;
    alignNonceRef.current = alignNonce;
    const targetTop = currentIndex * ITEM_HEIGHT;
    const targetBottom = targetTop + ITEM_HEIGHT;
    let next = el.scrollTop;
    if (alignRequested) {
      if (folder.path === alignSourcePath) {
        // The column the user clicked keeps its position; the others line up
        // to it.
        next = el.scrollTop;
      } else {
        next = targetTop - alignOffset;
      }
    } else if (targetTop < el.scrollTop) {
      next = targetTop;
    } else if (targetBottom > el.scrollTop + el.clientHeight) {
      next = targetBottom - el.clientHeight;
    }
    if (next !== el.scrollTop) el.scrollTop = next;
    // Read back the (browser-clamped) value so the repair effect below agrees.
    desiredScrollRef.current = el.scrollTop;
    setScrollTop(el.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, alignNonce]);

  // Reordering the selected folders makes React MOVE this column's DOM node,
  // which resets the element's scrollTop to 0 WITHOUT firing a scroll event.
  // The virtualization below is driven by our scrollTop state, so it would keep
  // rendering the slice for the old offset - positioned offscreen, leaving the
  // column visibly blank/gray. Detect the mismatch and restore the position.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop !== desiredScrollRef.current) {
      el.scrollTop = desiredScrollRef.current;
    }
  });

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    desiredScrollRef.current = e.currentTarget.scrollTop;
    setScrollTop(e.currentTarget.scrollTop);
  };

  const total = images.length;
  const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + viewportH) / ITEM_HEIGHT) + BUFFER,
  );
  const visible = images.slice(start, end);

  return (
    <div className="flex-1 min-w-0 flex flex-col border-r border-[#3c3c3c] last:border-r-0">
      <div
        className="h-9 shrink-0 flex items-center px-2 border-b border-[#3c3c3c]"
        title={folder.path}
      >
        <div className="w-full truncate text-right" style={{ direction: 'rtl' }}>
          <span dir="ltr" className="text-xs text-[#e0e0e0]">
            {folder.path}
          </span>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {total === 0 ? (
          <div className="flex items-center justify-center h-full px-3 text-center text-xs text-[#888888]">
            {originalCount === 0 ? t('column.emptyImage') : t('column.noMatch')}
          </div>
        ) : (
          <div style={{ height: total * ITEM_HEIGHT, position: 'relative' }}>
            {visible.map((img, i) => {
              const idx = start + i;
              return (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    top: idx * ITEM_HEIGHT,
                    height: ITEM_HEIGHT,
                    left: 0,
                    right: 0,
                  }}
                >
                  <ThumbnailItem
                    image={img}
                    selected={idx === currentIndex}
                    onClick={(e) => onSelect(idx, e, idx * ITEM_HEIGHT - scrollTop)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ThumbnailColumn;
