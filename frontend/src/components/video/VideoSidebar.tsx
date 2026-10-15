import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import VideoFolderInput from './VideoFolderInput';
import VideoFolderTree from './VideoFolderTree';
import SelectedFoldersList from '../SelectedFoldersList';
import { useVideoFolderTree } from '../../hooks/video/useVideoFolderTree';
import { VIDEO_TREE_KEY } from '../../utils/treeStorage';
import { useI18n } from '../../i18n';
import type { UseVideoCompareReturn } from '../../hooks/video/useVideoCompare';

interface VideoSidebarProps {
  compare: UseVideoCompareReturn;
  onMoveFolder: (from: number, to: number) => void;
}

const MIN_W = 180;
const MAX_W = 500;
const DEFAULT_W = 250;

function VideoSidebar({ compare, onMoveFolder }: VideoSidebarProps) {
  const { t } = useI18n();
  const tree = useVideoFolderTree(VIDEO_TREE_KEY);
  const [width, setWidth] = useState(DEFAULT_W);
  const [collapsed, setCollapsed] = useState(false);

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
      <aside className="w-7 shrink-0 flex flex-col items-center bg-[#252525] border-r border-[#3c3c3c]">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title={t('sidebar.expandFolder')}
          className="mt-2 text-[#888888] hover:text-[#e0e0e0]"
        >
          →
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{ width }}
      className="shrink-0 flex flex-col min-h-0 bg-[#252525] border-r border-[#3c3c3c] relative"
    >
      <div className="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-[#3c3c3c]">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title={t('sidebar.collapseFolder')}
          className="text-[#888888] hover:text-[#e0e0e0] px-1"
        >
          ←
        </button>
        <span className="text-sm text-[#e0e0e0]">{t('sidebar.folders')}</span>
      </div>
      <VideoFolderInput onAddRoot={tree.addRoot} />
      <SelectedFoldersList
        folders={compare.selectedFolders}
        onRemove={compare.removeFolder}
        onClear={compare.clearFolders}
        onMove={onMoveFolder}
        locked={!!compare.blind || !!compare.annotation}
      />
      <VideoFolderTree
        tree={tree}
        onAddToCompare={compare.addFolder}
        onSelectVideo={compare.selectVideoByPath}
      />

      <div
        onMouseDown={startResize}
        title={t('common.dragResize')}
        className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-10 cursor-col-resize bg-[#555555] hover:bg-[#777777] rounded-l transition-colors flex items-center justify-center"
      >
        <span className="text-[#888888] text-xs leading-none">⋮</span>
      </div>
    </aside>
  );
}

export default VideoSidebar;
