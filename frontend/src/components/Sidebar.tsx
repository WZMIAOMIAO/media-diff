import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import FolderInput from './FolderInput';
import FolderTree from './FolderTree';
import { useFolderTree } from '../hooks/useFolderTree';
import { IMAGE_TREE_KEY } from '../utils/treeStorage';
import { useI18n } from '../i18n';
import type { UseImageCompareReturn } from '../hooks/useImageCompare';

interface SidebarProps {
  compare: UseImageCompareReturn;
}

const MIN_W = 180;
const MAX_W = 500;
const DEFAULT_W = 250;

function Sidebar({ compare }: SidebarProps) {
  const { t } = useI18n();
  const tree = useFolderTree(IMAGE_TREE_KEY);
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
      <FolderInput onAddRoot={tree.addRoot} />
      <div className="shrink-0 border-b border-[#3c3c3c] max-h-[40%] flex flex-col min-h-0">
        <div className="px-2 py-1 text-xs text-[#888888] border-b border-[#3c3c3c]">
          {t('sidebar.selectedDirs')}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {compare.selectedFolders.length === 0 ? (
            <div className="px-2 py-1 text-xs text-[#666666]">{t('sidebar.none')}</div>
          ) : (
            compare.selectedFolders.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-1 px-2 py-1 hover:bg-[#2b2b2b]"
              >
                <div
                  className="flex-1 min-w-0 truncate text-right"
                  style={{ direction: 'rtl' }}
                  title={f.path}
                >
                  <span dir="ltr" className="text-xs text-[#c0c0c0]">
                    {f.path}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => compare.removeFolder(f.path)}
                  title={t('common.remove')}
                  className="shrink-0 text-[#888888] hover:text-[#ef4444] text-base leading-none px-1"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        {compare.selectedFolders.length > 0 && (
          <div className="px-2 py-1 border-t border-[#3c3c3c]">
            <button
              type="button"
              onClick={() => compare.clearFolders()}
              className="w-full px-2 py-1 text-xs bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
            >
              {t('common.clear')}
            </button>
          </div>
        )}
      </div>
      <FolderTree tree={tree} onAddToCompare={compare.addFolder} />

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

export default Sidebar;
