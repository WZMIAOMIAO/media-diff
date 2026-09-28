import type { MouseEvent as ReactMouseEvent } from 'react';
import type { TreeNode } from '../types';

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onContextMenu: (e: ReactMouseEvent, node: TreeNode) => void;
  onRemoveRoot?: (path: string) => void;
}

function TreeNodeItem({ node, depth, onToggle, onContextMenu, onRemoveRoot }: TreeNodeItemProps) {
  const isDir = node.isDir;
  const isRoot = depth === 0;
  const showArrow = isDir && node.hasChildren === true;
  const isLeafDir = isDir && node.hasChildren === false;
  const indent = depth * 14;

  const handleContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, node);
  };

  return (
    <div>
      <div
        onContextMenu={handleContextMenu}
        title={node.path}
        className="flex items-center gap-1 h-7 pr-1 hover:bg-[#2b2b2b] cursor-default select-none"
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
            <span className={`text-sm ${isLeafDir ? 'opacity-60' : ''}`}>
              📁
            </span>
          </>
        ) : (
          <>
            <span className="w-4" />
            <span className="text-sm opacity-90">🖼️</span>
          </>
        )}
        <span
          className={`flex-1 min-w-0 truncate text-sm ${
            isDir ? 'text-[#e0e0e0]' : 'text-[#888888]'
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
            className="shrink-0 text-[#888888] hover:text-[#ef4444] text-base leading-none px-1"
          >
            ×
          </button>
        )}
      </div>
      {isDir &&
        node.expanded &&
        node.children &&
        node.children.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            onToggle={onToggle}
            onContextMenu={onContextMenu}
            onRemoveRoot={onRemoveRoot}
          />
        ))}
    </div>
  );
}

export default TreeNodeItem;
