import { useEffect, useRef, useState, type UIEvent } from 'react';
import type { FileEntry } from '../api';
import type { SelectedFolder } from '../types';
import ThumbnailItem from './ThumbnailItem';

interface ThumbnailColumnProps {
  folder: SelectedFolder;
  images: FileEntry[];
  originalCount: number;
  currentIndex: number;
  onSelect: (
    index: number,
    e: { ctrlKey: boolean; metaKey: boolean },
  ) => void;
}

const ITEM_HEIGHT = 220;
const BUFFER = 3;

function ThumbnailColumn({
  folder,
  images,
  originalCount,
  currentIndex,
  onSelect,
}: ThumbnailColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

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

  // 切换图片时自动滚动到当前选中项
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetTop = currentIndex * ITEM_HEIGHT;
    const targetBottom = targetTop + ITEM_HEIGHT;
    if (targetTop < el.scrollTop) {
      el.scrollTop = targetTop;
    } else if (targetBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = targetBottom - el.clientHeight;
    }
  }, [currentIndex]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
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
          originalCount === 0 ? null : (
            <div className="flex items-center justify-center h-full text-xs text-[#888888]">
              无匹配结果
            </div>
          )
        ) : (
          <div style={{ height: total * ITEM_HEIGHT, position: 'relative' }}>
            {visible.map((img, i) => {
              const idx = start + i;
              return (
                <div
                  key={img.path}
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
                    onClick={(e) => onSelect(idx, e)}
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
