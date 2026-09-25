import type { MouseEvent as ReactMouseEvent } from 'react';
import type { VideoTreeNode } from '../../types/video';

interface VideoTreeNodeItemProps {
  node: VideoTreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onContextMenu: (e: ReactMouseEvent, node: VideoTreeNode) => void;
  onRemoveRoot?: (path: string) => void;
  onSelectVideo?: (videoPath: string) => void;
}

function VideoTreeNodeItem({
  node,
  depth,
  onToggle,
  onContextMenu,
  onRemoveRoot,
  onSelectVideo,
}: VideoTreeNodeItemProps) {
  const isDir = node.isDir;
  const isRoot = depth === 0;
  // Show the expand arrow for directories that have children OR are not yet
  // loaded. The backend's has_children only counts subdirectories, so a
  // folder containing only video files would otherwise be unexpandable.
  const showArrow = isDir && (node.hasChildren === true || !node.loaded);
  const isLeafDir = isDir && node.hasChildren === false && node.loaded;
  const indent = depth * 14;

  const handleContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, node);
  };

  const handleVideoClick = () => {
    if (!isDir && onSelectVideo) onSelectVideo(node.path);
  };

  return (
    <div>
      <div
        onContextMenu={handleContextMenu}
        onClick={isDir ? undefined : handleVideoClick}
        title={node.path}
        className={`flex items-center gap-1 h-7 pr-1 hover:bg-[#2b2b2b] select-none ${
          isDir ? 'cursor-default' : 'cursor-pointer'
        }`}
        style={{ paddingLeft: `${indent + 4}px` }}
      >
        {isDir ? (
          <>
            <span
              onClick={() => {
                if (showArrow) onToggle(node.path);
              }}
              className={`w-4 text-xs text-[#888888] ${
                showArrow ? 'cursor-pointer hover:text-[#e0e0e0]' : ''
              }`}
            >
              {showArrow ? (node.expanded ? '▼' : '▶') : ''}
            </span>
            <span className={`text-sm ${isLeafDir ? 'opacity-60' : ''}`}>📁</span>
          </>
        ) : (
          <>
            <span className="w-4" />
            <span className="text-sm opacity-90">🎬</span>
          </>
        )}
        <span
          className={`flex-1 min-w-0 truncate text-sm ${
            isDir ? 'text-[#e0e0e0]' : 'text-[#c0c0c0] hover:text-[#e0e0e0]'
          }`}
        >
          {node.name}
        </span>
        {isRoot && onRemoveRoot && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveRoot(node.path);
            }}
            title="移除根目录"
            className="shrink-0 text-[#888888] hover:text-[#ef4444] text-xs"
          >
            ×
          </button>
        )}
      </div>
      {isDir &&
        node.expanded &&
        node.children &&
        node.children.map((child) => (
          <VideoTreeNodeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            onToggle={onToggle}
            onContextMenu={onContextMenu}
            onRemoveRoot={onRemoveRoot}
            onSelectVideo={onSelectVideo}
          />
        ))}
    </div>
  );
}

export default VideoTreeNodeItem;
