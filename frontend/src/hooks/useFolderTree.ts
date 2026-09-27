import { useCallback, useEffect, useRef, useState } from 'react';
import { browseFolder, type BrowseResult } from '../api';
import { loadTreeRoots, saveTreeRoots } from '../utils/treeStorage';
import type { TreeNode } from '../types';

export type AddRootResult = 'ok' | 'not_exist' | 'exists';

export interface FolderTreeApi {
  roots: TreeNode[];
  addRoot: (path: string) => Promise<AddRootResult>;
  removeRoot: (path: string) => void;
  toggleExpand: (path: string) => Promise<void>;
  loadChildren: (path: string) => Promise<void>;
  refreshNode: (path: string) => Promise<void>;
  hasRoot: (path: string) => boolean;
}

function getPathName(path: string): string {
  if (!path) return '';
  if (path === '/') return '/';
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed || trimmed === '/') return '/';
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx === -1) return trimmed;
  return trimmed.substring(idx + 1);
}

function buildChildren(result: BrowseResult): TreeNode[] {
  return [
    ...result.subdirs.map((s) => ({
      name: s.name,
      path: s.path,
      isDir: true,
      hasChildren: s.has_children,
      loaded: false,
      expanded: false,
      children: [] as TreeNode[],
    })),
    ...result.images.map((img) => ({
      name: img.name,
      path: img.path,
      isDir: false,
      isImage: true,
      loaded: false,
      expanded: false,
    })),
  ];
}

export function useFolderTree(storageKey: string): FolderTreeApi {
  const treeRef = useRef<Map<string, TreeNode>>(new Map());
  const rootsRef = useRef<string[]>([]);
  const hydratedRef = useRef(false);
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const persistRoots = useCallback(() => {
    if (!hydratedRef.current) return;
    saveTreeRoots(storageKey, rootsRef.current);
  }, [storageKey]);

  // Restore previously opened root folders as collapsed nodes. No backend
  // request is made here: children are loaded lazily on first expand.
  useEffect(() => {
    const saved = loadTreeRoots(storageKey);
    let changed = false;
    for (const path of saved) {
      if (rootsRef.current.includes(path)) continue;
      const node: TreeNode = {
        name: getPathName(path),
        path,
        isDir: true,
        hasChildren: true,
        loaded: false,
        expanded: false,
        children: [],
      };
      treeRef.current.set(path, node);
      rootsRef.current.push(path);
      changed = true;
    }
    hydratedRef.current = true;
    if (changed) forceUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const hasRoot = useCallback(
    (path: string) => rootsRef.current.includes(path),
    [],
  );

  const addRoot = useCallback(
    async (path: string): Promise<AddRootResult> => {
      const trimmed = path.trim();
      if (!trimmed) return 'not_exist';
      let result;
      try {
        result = await browseFolder(trimmed);
      } catch {
        return 'not_exist';
      }
      const normalized = result.path;
      if (rootsRef.current.includes(normalized)) return 'exists';
      // Populate the immediate children and expand one level by default,
      // reusing the browse result we already fetched (no extra request).
      const children = buildChildren(result);
      const node: TreeNode = {
        name: getPathName(normalized),
        path: normalized,
        isDir: true,
        hasChildren: result.subdirs.length > 0 || result.images.length > 0,
        loaded: true,
        expanded: true,
        children,
      };
      treeRef.current.set(normalized, node);
      for (const child of children) {
        if (child.isDir) treeRef.current.set(child.path, child);
      }
      rootsRef.current.push(normalized);
      persistRoots();
      forceUpdate();
      return 'ok';
    },
    [forceUpdate, persistRoots],
  );

  const loadChildren = useCallback(
    async (path: string) => {
      const node = treeRef.current.get(path);
      if (!node || node.loaded) return;
      try {
        const result = await browseFolder(path);
        const children = buildChildren(result);
        const current = treeRef.current.get(path);
        if (current) {
          current.children = children;
          current.loaded = true;
          current.hasChildren =
            result.subdirs.length > 0 || result.images.length > 0;
        }
        // Register child directory nodes in treeRef so that their own
        // toggleExpand/refreshNode can find them (otherwise only roots are
        // resolvable and nested folders cannot be expanded).
        for (const child of children) {
          if (child.isDir) treeRef.current.set(child.path, child);
        }
        forceUpdate();
      } catch {
        // ignore load failures; node remains unloaded
      }
    },
    [forceUpdate],
  );

  const toggleExpand = useCallback(
    async (path: string) => {
      const node = treeRef.current.get(path);
      if (!node) return;
      if (!node.loaded) {
        await loadChildren(path);
        const loaded = treeRef.current.get(path);
        if (loaded) {
          loaded.expanded = true;
          forceUpdate();
        }
        return;
      }
      node.expanded = !node.expanded;
      forceUpdate();
    },
    [forceUpdate, loadChildren],
  );

  const refreshNode = useCallback(
    async (path: string) => {
      const node = treeRef.current.get(path);
      if (!node) return;
      node.loaded = false;
      node.children = [];
      forceUpdate();
      if (node.expanded) {
        await loadChildren(path);
      }
    },
    [forceUpdate, loadChildren],
  );

  const removeRoot = useCallback(
    (path: string) => {
      treeRef.current.delete(path);
      rootsRef.current = rootsRef.current.filter((p) => p !== path);
      persistRoots();
      forceUpdate();
    },
    [forceUpdate, persistRoots],
  );

  const roots = rootsRef.current
    .map((p) => treeRef.current.get(p))
    .filter((n): n is TreeNode => !!n);

  return {
    roots,
    addRoot,
    removeRoot,
    toggleExpand,
    loadChildren,
    refreshNode,
    hasRoot,
  };
}
