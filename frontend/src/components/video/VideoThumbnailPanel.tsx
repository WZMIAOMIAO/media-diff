import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { UseVideoCompareReturn } from '../../hooks/video/useVideoCompare';
import VideoThumbnailColumn from './VideoThumbnailColumn';
import Toggle from '../Toggle';

interface VideoThumbnailPanelProps {
  compare: UseVideoCompareReturn;
}

const MIN_W = 220;
const MAX_W = 800;
const DEFAULT_W = 300;

function VideoThumbnailPanel({ compare }: VideoThumbnailPanelProps) {
  const [width, setWidth] = useState(DEFAULT_W);
  const [collapsed, setCollapsed] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const applySearch = () => compare.setSearchQuery(searchInput.trim());
  const clearSearch = () => {
    setSearchInput('');
    compare.setSearchQuery('');
  };

  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = Math.min(MAX_W, Math.max(MIN_W, startW + dx));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (collapsed) {
    return (
      <aside className="w-7 shrink-0 flex flex-col items-center bg-[#2b2b2b] border-r border-[#3c3c3c]">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="展开预览图面板"
          className="mt-2 text-[#888888] hover:text-[#e0e0e0]"
        >
          →
        </button>
      </aside>
    );
  }

  const showIntersection = compare.selectedFolders.length >= 2;

  return (
    <aside
      style={{ width }}
      className="shrink-0 flex flex-col min-h-0 bg-[#2b2b2b] border-r border-[#3c3c3c] relative"
    >
      <div className="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-[#3c3c3c]">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="折叠预览图面板"
          className="text-[#888888] hover:text-[#e0e0e0] px-1"
        >
          ←
        </button>
        <span className="text-sm text-[#e0e0e0] whitespace-nowrap">视频列表</span>
        {showIntersection && (
          <div className="ml-1">
            <Toggle
              checked={compare.intersectionMode}
              onChange={(v) => compare.setIntersectionMode(v)}
              disabled={!!compare.blind}
              color="#4a9eff"
              label="交集"
            />
          </div>
        )}
        <div className="flex-1" />
      </div>
      <div className="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-[#3c3c3c]">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applySearch();
          }}
          placeholder="搜索视频..."
          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] placeholder:text-[#888888] focus:outline-none focus:border-[#555555]"
        />
        {searchInput && (
          <button
            type="button"
            onClick={clearSearch}
            title="清除搜索"
            className="text-[#888888] hover:text-[#e0e0e0] text-xs shrink-0"
          >
            ×
          </button>
        )}
      </div>

      {compare.searchQuery && (
        <div className="px-2 py-1 text-xs text-[#888888] border-b border-[#3c3c3c]">
          过滤: {compare.searchQuery}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {compare.selectedFolders.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#888888]">
            请通过右键菜单添加对比文件夹
          </div>
        ) : (
          compare.selectedFolders.map((f) => {
            const filtered = compare.filteredVideos.get(f.path) ?? [];
            const original = compare.videosPerFolder.get(f.path)?.length ?? 0;
            return (
              <VideoThumbnailColumn
                key={f.path}
                folder={f}
                videos={filtered}
                originalCount={original}
                currentIndex={compare.currentVideoIndices.get(f.path) ?? 0}
                onSelect={(idx, e) => {
                  if (e.ctrlKey || e.metaKey) {
                    compare.alignByName(f.path, filtered[idx]?.name ?? '');
                  } else {
                    compare.setCurrentVideoIndex(f.path, idx);
                  }
                }}
              />
            );
          })
        )}
      </div>

      <div
        onMouseDown={startResize}
        title="拖拽调整宽度"
        className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-10 cursor-col-resize bg-[#555555] hover:bg-[#777777] rounded-l transition-colors flex items-center justify-center"
      >
        <span className="text-[#888888] text-xs leading-none">⋮</span>
      </div>
    </aside>
  );
}

export default VideoThumbnailPanel;
