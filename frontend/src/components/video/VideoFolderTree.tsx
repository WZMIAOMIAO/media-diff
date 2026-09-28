import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { VideoFolderTreeApi } from '../../hooks/video/useVideoFolderTree';
import type { VideoTreeNode } from '../../types/video';
import { getRelativePath, toForwardSlashes } from '../../utils/path';
import { copyText } from '../../utils/clipboard';
import { useI18n } from '../../i18n';
import VideoTreeNodeItem from './VideoTreeNodeItem';

interface VideoFolderTreeProps {
  tree: VideoFolderTreeApi;
  onAddToCompare: (path: string) => void;
  onSelectVideo?: (videoPath: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: VideoTreeNode;
}

type MenuItem = 'add' | 'refresh' | 'copyAbs' | 'copyRel';

const MENU_ITEMS: MenuItem[] = ['add', 'refresh', 'copyAbs', 'copyRel'];

const MENU_LABEL: Record<MenuItem, string> = {
  add: 'tree.menu.add',
  refresh: 'tree.menu.refresh',
  copyAbs: 'tree.menu.copyAbs',
  copyRel: 'tree.menu.copyRel',
};

function getParentPath(path: string): string {
  if (!path) return path;
  if (path === '/') return '/';
  if (/^[a-zA-Z]:[\\/]?$/.test(path)) return path;
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed) return path;
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) return trimmed;
  if (idx === 0) return '/';
  return trimmed.substring(0, idx);
}

function VideoFolderTree({ tree, onAddToCompare, onSelectVideo }: VideoFolderTreeProps) {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: ReactMouseEvent, node: VideoTreeNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleMenuClick = (item: MenuItem) => {
    if (!contextMenu) return;
    const node = contextMenu.node;
    setContextMenu(null);
    // For video file nodes, folder-level actions target the containing folder.
    const folderPath = node.isDir ? node.path : getParentPath(node.path);
    if (item === 'add') {
      void onAddToCompare(folderPath);
    } else if (item === 'refresh') {
      void tree.refreshNode(folderPath);
    } else if (item === 'copyAbs') {
      void copyText(toForwardSlashes(node.path));
    } else if (item === 'copyRel') {
      void copyText(getRelativePath(node.path, tree.roots));
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto py-1">
      {tree.roots.length === 0 ? (
        <div className="px-3 py-2 text-sm text-[#888888]">
          {t('tree.empty')}
        </div>
      ) : (
        tree.roots.map((node) => (
          <VideoTreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            onToggle={tree.toggleExpand}
            onContextMenu={handleContextMenu}
            onRemoveRoot={tree.removeRoot}
            onSelectVideo={onSelectVideo}
          />
        ))
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] py-1 bg-[#2b2b2b] border border-[#3c3c3c] rounded shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {MENU_ITEMS.map((item) => (
            <div
              key={item}
              title={
                item === 'copyAbs'
                  ? toForwardSlashes(contextMenu.node.path)
                  : item === 'copyRel'
                    ? getRelativePath(contextMenu.node.path, tree.roots)
                    : undefined
              }
              className="px-3 py-1.5 text-sm text-[#e0e0e0] hover:bg-[#3c3c3c] cursor-default"
              onClick={() => handleMenuClick(item)}
            >
              {t(MENU_LABEL[item])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default VideoFolderTree;
