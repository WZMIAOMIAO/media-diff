import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import type { VideoEntry } from '../../types/video';
import type { SelectedFolder } from '../../types';
import VideoThumbnailItem from './VideoThumbnailItem';
import { useI18n } from '../../i18n';

interface VideoThumbnailColumnProps {
  folder: SelectedFolder;
  videos: VideoEntry[];
  originalCount: number;
  currentIndex: number;
  /** Changes on each align action; forces the column to line up the aligned row. */
  alignNonce: number;
  /** The column the align originated from (keeps its position). */
  alignSourcePath: string | null;
  /** Viewport-top offset of the source column's aligned video. */
  alignOffset: number;
  onSelect: (
    index: number,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    topInViewport: number,
  ) => void;
}

const ITEM_HEIGHT = 220;
const BUFFER = 3;

function VideoThumbnailColumn({
  folder,
  videos,
  originalCount,
  currentIndex,
  alignNonce,
  alignSourcePath,
  alignOffset,
  onSelect,
}: VideoThumbnailColumnProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  // Intended scroll offset; lets us repair the browser resetting scrollTop to 0
  // when React moves this column's DOM node on reorder (no scroll event fires).
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

  // Auto-scroll to the selected item; on an align action pin it to the TOP so
  // the same video lines up across columns.
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
        // Source column keeps its position; the others line up to it.
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
    desiredScrollRef.current = el.scrollTop;
    setScrollTop(el.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, alignNonce]);

  // Repair the scroll position after React moves the column's DOM node.
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

  const total = videos.length;
  const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + viewportH) / ITEM_HEIGHT) + BUFFER,
  );
  const visible = videos.slice(start, end);

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
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto">
        {total === 0 ? (
          <div className="flex items-center justify-center h-full px-3 text-center text-xs text-[#888888]">
            {originalCount === 0 ? t('column.emptyVideo') : t('column.noMatch')}
          </div>
        ) : (
          <div style={{ height: total * ITEM_HEIGHT, position: 'relative' }}>
            {visible.map((vid, i) => {
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
                  <VideoThumbnailItem
                    video={vid}
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

export default VideoThumbnailColumn;
