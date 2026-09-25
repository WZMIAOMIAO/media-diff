import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listImages, type FileEntry } from '../api';
import type { SelectedFolder } from '../types';

export interface UseImageCompareReturn {
  // 文件夹
  selectedFolders: SelectedFolder[];
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => void;
  clearFolders: () => void;

  // 每文件夹的图片列表（原始）
  imagesPerFolder: Map<string, FileEntry[]>;

  // 过滤后的图片列表（经过搜索 + 交集过滤，并按文件名排序以保证跨列同名对齐）
  filteredImages: Map<string, FileEntry[]>;

  // 导航：每文件夹独立索引
  currentIndices: Map<string, number>;
  setCurrentIndex: (folderPath: string, idx: number) => void;
  nextImage: () => void;
  prevImage: () => void;
  alignByName: (folderPath: string, imageName: string) => void;
  alignByIndex: (idx: number) => void;

  // 搜索
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // 交集模式
  intersectionMode: boolean;
  setIntersectionMode: (b: boolean) => void;
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

export function useImageCompare(): UseImageCompareReturn {
  const foldersRef = useRef<SelectedFolder[]>([]);
  const imagesRef = useRef<Map<string, FileEntry[]>>(new Map());
  const indicesRef = useRef<Map<string, number>>(new Map());
  const [tick, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const [searchQuery, setSearchQuery] = useState('');
  const [intersectionMode, setIntersectionModeState] = useState(false);

  const selectedFolders = foldersRef.current;
  const imagesPerFolder = imagesRef.current;
  const currentIndices = indicesRef.current;

  // 过滤 + 排序。按文件名排序使得 Ctrl+点击同名对齐时，
  // 同名图片在每列的索引可以互相参考。
  const filteredImages = useMemo(() => {
    const map = new Map<string, FileEntry[]>();
    const q = searchQuery.trim().toLowerCase();

    // 交集：所有文件夹文件名交集
    let intersectionNames: Set<string> | null = null;
    if (intersectionMode && foldersRef.current.length >= 2) {
      for (const f of foldersRef.current) {
        const imgs = imagesRef.current.get(f.path) ?? [];
        const names = new Set(imgs.map((i) => i.name));
        if (intersectionNames === null) {
          intersectionNames = names;
        } else {
          for (const n of [...intersectionNames]) {
            if (!names.has(n)) intersectionNames.delete(n);
          }
        }
      }
    }

    for (const f of foldersRef.current) {
      const imgs = imagesRef.current.get(f.path) ?? [];
      let filtered = imgs;
      if (intersectionNames) {
        filtered = filtered.filter((i) => intersectionNames.has(i.name));
      }
      if (q) {
        filtered = filtered.filter((i) => i.name.toLowerCase().includes(q));
      }
      filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      map.set(f.path, filtered);
    }
    return map;
  }, [tick, searchQuery, intersectionMode]);

  // 同步最新 filteredImages 给回调使用
  const filteredImagesRef = useRef(filteredImages);
  filteredImagesRef.current = filteredImages;

  // 索引越界自动归位（每个文件夹独立 clamp）
  useEffect(() => {
    let changed = false;
    const next = new Map(indicesRef.current);
    for (const f of foldersRef.current) {
      const l = filteredImages.get(f.path) ?? [];
      const cur = next.get(f.path) ?? 0;
      if (l.length === 0) {
        if (cur !== 0) {
          next.set(f.path, 0);
          changed = true;
        }
      } else if (cur >= l.length) {
        next.set(f.path, l.length - 1);
        changed = true;
      }
    }
    if (changed) {
      indicesRef.current = next;
      forceUpdate();
    }
  }, [filteredImages, forceUpdate]);

  const addFolder = useCallback(
    async (path: string) => {
      const trimmed = path.trim();
      if (!trimmed) return;
      if (foldersRef.current.length >= 4) {
        alert('不支持超过4张图对比');
        return;
      }
      if (foldersRef.current.some((f) => f.path === trimmed)) return;
      let images: FileEntry[] = [];
      try {
        const result = await listImages(trimmed);
        images = result.images;
      } catch {
        images = [];
      }
      foldersRef.current = [
        ...foldersRef.current,
        { path: trimmed, name: getPathName(trimmed) },
      ];
      const nextImages = new Map(imagesRef.current);
      nextImages.set(trimmed, images);
      imagesRef.current = nextImages;
      const nextIndices = new Map(indicesRef.current);
      nextIndices.set(trimmed, 0);
      indicesRef.current = nextIndices;
      forceUpdate();
    },
    [forceUpdate],
  );

  const removeFolder = useCallback(
    (path: string) => {
      foldersRef.current = foldersRef.current.filter((f) => f.path !== path);
      const nextImages = new Map(imagesRef.current);
      nextImages.delete(path);
      imagesRef.current = nextImages;
      const nextIndices = new Map(indicesRef.current);
      nextIndices.delete(path);
      indicesRef.current = nextIndices;
      if (foldersRef.current.length < 2) {
        setIntersectionModeState(false);
      }
      forceUpdate();
    },
    [forceUpdate],
  );

  const clearFolders = useCallback(() => {
    foldersRef.current = [];
    imagesRef.current = new Map();
    indicesRef.current = new Map();
    setIntersectionModeState(false);
    setSearchQuery('');
    forceUpdate();
  }, [forceUpdate]);

  const setCurrentIndex = useCallback(
    (folderPath: string, idx: number) => {
      const l = filteredImagesRef.current.get(folderPath) ?? [];
      const clamped = l.length === 0 ? 0 : Math.max(0, Math.min(idx, l.length - 1));
      const next = new Map(indicesRef.current);
      next.set(folderPath, clamped);
      indicesRef.current = next;
      forceUpdate();
    },
    [forceUpdate],
  );

  // 键盘方向键：每个文件夹独立循环递增
  const nextImage = useCallback(() => {
    const next = new Map(indicesRef.current);
    for (const f of foldersRef.current) {
      const l = filteredImagesRef.current.get(f.path) ?? [];
      if (l.length === 0) {
        if (next.get(f.path) !== 0) next.set(f.path, 0);
        continue;
      }
      const cur = next.get(f.path) ?? 0;
      next.set(f.path, (cur + 1) % l.length);
    }
    indicesRef.current = next;
    forceUpdate();
  }, [forceUpdate]);

  // 键盘方向键：每个文件夹独立循环递减
  const prevImage = useCallback(() => {
    const next = new Map(indicesRef.current);
    for (const f of foldersRef.current) {
      const l = filteredImagesRef.current.get(f.path) ?? [];
      if (l.length === 0) {
        if (next.get(f.path) !== 0) next.set(f.path, 0);
        continue;
      }
      const cur = next.get(f.path) ?? 0;
      next.set(f.path, (cur - 1 + l.length) % l.length);
    }
    indicesRef.current = next;
    forceUpdate();
  }, [forceUpdate]);

  // Ctrl+点击无同名时的 fallback：所有文件夹对齐到相同序号
  const alignByIndex = useCallback(
    (idx: number) => {
      const next = new Map(indicesRef.current);
      for (const f of foldersRef.current) {
        const l = filteredImagesRef.current.get(f.path) ?? [];
        if (l.length === 0) {
          next.set(f.path, 0);
        } else {
          next.set(f.path, Math.max(0, Math.min(idx, l.length - 1)));
        }
      }
      indicesRef.current = next;
      forceUpdate();
    },
    [forceUpdate],
  );

  // Ctrl+点击：所有文件夹对齐到同名图片，找不到的回退到相同序号
  const alignByName = useCallback(
    (folderPath: string, imageName: string) => {
      const list = filteredImagesRef.current.get(folderPath);
      if (!list || !imageName) return;
      const srcIdx = list.findIndex((i) => i.name === imageName);
      if (srcIdx < 0) return;
      const next = new Map(indicesRef.current);
      for (const f of foldersRef.current) {
        const l = filteredImagesRef.current.get(f.path) ?? [];
        if (l.length === 0) {
          next.set(f.path, 0);
          continue;
        }
        const found = l.findIndex((i) => i.name === imageName);
        const targetIdx = found >= 0 ? found : Math.min(srcIdx, l.length - 1);
        next.set(f.path, Math.max(0, Math.min(targetIdx, l.length - 1)));
      }
      indicesRef.current = next;
      forceUpdate();
    },
    [forceUpdate],
  );

  const setIntersectionMode = useCallback((b: boolean) => {
    if (b && foldersRef.current.length < 2) return;
    setIntersectionModeState(b);
  }, []);

  return {
    selectedFolders,
    addFolder,
    removeFolder,
    clearFolders,
    imagesPerFolder,
    filteredImages,
    currentIndices,
    setCurrentIndex,
    nextImage,
    prevImage,
    alignByName,
    alignByIndex,
    searchQuery,
    setSearchQuery,
    intersectionMode,
    setIntersectionMode,
  };
}
