import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { VideoFolderTreeApi } from '../../hooks/video/useVideoFolderTree';
import type { VideoTreeNode } from '../../types/video';
import { getRelativePath } from '../../utils/path';
import { copyText } from '../../utils/clipboard';
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

const MENU_ITEMS = ['添加到多目录对比', '刷新', '复制绝对路径', '复制相对路径'] as const;

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

  const handleMenuClick = (item: string) => {
    if (!contextMenu) return;
    const node = contextMenu.node;
    setContextMenu(null);
    // For video file nodes, folder-level actions target the containing folder.
    const folderPath = node.isDir ? node.path : getParentPath(node.path);
    if (item === '添加到多目录对比') {
      void onAddToCompare(folderPath);
    } else if (item === '刷新') {
      void tree.refreshNode(folderPath);
    } else if (item === '复制绝对路径') {
      void copyText(node.path);
    } else if (item === '复制相对路径') {
      void copyText(getRelativePath(node.path, tree.roots));
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto py-1">
      {tree.roots.length === 0 ? (
        <div className="px-3 py-2 text-sm text-[#888888]">
          请输入文件夹路径添加根目录
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
                item === '复制绝对路径'
                  ? contextMenu.node.path
                  : item === '复制相对路径'
                    ? getRelativePath(contextMenu.node.path, tree.roots)
                    : undefined
              }
              className="px-3 py-1.5 text-sm text-[#e0e0e0] hover:bg-[#3c3c3c] cursor-default"
              onClick={() => handleMenuClick(item)}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default VideoFolderTree;
