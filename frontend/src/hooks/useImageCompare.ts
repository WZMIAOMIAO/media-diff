import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listImages, voteBlindEval, type FileEntry } from '../api';
import type { BlindEvalApi, BlindSetupResult, SelectedFolder } from '../types';

export type { BlindEvalApi } from '../types';

interface BlindRuntime {
  aliases: Record<string, string>;
  order: string[];
  displayOrders: Record<string, number[]>;
  outputPath: string;
  winLists: Record<string, string[]>;
}

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

  // 盲评模式
  blind: BlindEvalApi | null;
  enterBlind: (result: BlindSetupResult) => void;
  exitBlind: () => void;
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

function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return unified || '/';
}

function winListsFromData(
  data: Record<string, unknown>,
  aliases: Record<string, string>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const alias of new Set(Object.values(aliases))) {
    const value = data[`${alias}_win_list`];
    result[alias] = Array.isArray(value) ? (value as string[]) : [];
  }
  return result;
}

export function useImageCompare(): UseImageCompareReturn {
  const foldersRef = useRef<SelectedFolder[]>([]);
  const imagesRef = useRef<Map<string, FileEntry[]>>(new Map());
  const indicesRef = useRef<Map<string, number>>(new Map());
  const [tick, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const [searchQuery, setSearchQuery] = useState('');
  const [intersectionMode, setIntersectionModeState] = useState(false);

  const blindRef = useRef<BlindRuntime | null>(null);
  const blindIndexRef = useRef(0);
  const prevModeRef = useRef<{ intersectionMode: boolean; searchQuery: string } | null>(null);

  const selectedFolders = foldersRef.current;
  const imagesPerFolder = imagesRef.current;
  const currentIndices = indicesRef.current;

  // 过滤 + 排序。按文件名排序使得 Ctrl+点击同名对齐时，
  // 同名图片在每列的索引可以互相参考。
  const filteredImages = useMemo(() => {
    const map = new Map<string, FileEntry[]>();
    const q = searchQuery.trim().toLowerCase();
    const blind = blindRef.current;

    if (blind) {
      // 盲评模式：所有文件夹按当前份的 shuffle 顺序对齐同名图片。
      for (const f of foldersRef.current) {
        const imgs = imagesRef.current.get(f.path) ?? [];
        const byName = new Map(imgs.map((i) => [i.name, i] as const));
        let list = blind.order
          .map((n) => byName.get(n))
          .filter((x): x is FileEntry => x !== undefined);
        if (q) list = list.filter((i) => i.name.toLowerCase().includes(q));
        map.set(f.path, list);
      }
      return map;
    }

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

  // 将每个文件夹的索引对齐到当前盲评组编号。
  const applyBlindIndex = useCallback(() => {
    const next = new Map<string, number>();
    for (const f of foldersRef.current) {
      const len = filteredImagesRef.current.get(f.path)?.length ?? 0;
      next.set(f.path, len === 0 ? 0 : Math.min(blindIndexRef.current, len - 1));
    }
    indicesRef.current = next;
  }, []);

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
      if (blindRef.current) {
        alert('盲评模式下请先退出盲评再添加对比目录');
        return;
      }
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
      if (blindRef.current) {
        alert('盲评模式下请先退出盲评再删除对比目录');
        return;
      }
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
    if (blindRef.current) {
      alert('盲评模式下请先退出盲评再清除对比目录');
      return;
    }
    foldersRef.current = [];
    imagesRef.current = new Map();
    indicesRef.current = new Map();
    setIntersectionModeState(false);
    setSearchQuery('');
    forceUpdate();
  }, [forceUpdate]);

  const setCurrentIndex = useCallback(
    (folderPath: string, idx: number) => {
      if (blindRef.current) {
        blindIndexRef.current = idx;
        applyBlindIndex();
        forceUpdate();
        return;
      }
      const l = filteredImagesRef.current.get(folderPath) ?? [];
      const clamped = l.length === 0 ? 0 : Math.max(0, Math.min(idx, l.length - 1));
      const next = new Map(indicesRef.current);
      next.set(folderPath, clamped);
      indicesRef.current = next;
      forceUpdate();
    },
    [applyBlindIndex, forceUpdate],
  );

  // 键盘方向键：每个文件夹独立递增，到达末尾后不再动作
  const nextImage = useCallback(() => {
    if (blindRef.current) {
      const total = blindRef.current.order.length;
      if (blindIndexRef.current >= total - 1) return;
      blindIndexRef.current += 1;
      applyBlindIndex();
      forceUpdate();
      return;
    }
    let changed = false;
    const next = new Map(indicesRef.current);
    for (const f of foldersRef.current) {
      const l = filteredImagesRef.current.get(f.path) ?? [];
      if (l.length === 0) continue;
      const cur = next.get(f.path) ?? 0;
      const target = Math.min(cur + 1, l.length - 1);
      if (target !== cur) {
        next.set(f.path, target);
        changed = true;
      }
    }
    if (!changed) return;
    indicesRef.current = next;
    forceUpdate();
  }, [applyBlindIndex, forceUpdate]);

  // 键盘方向键：每个文件夹独立递减，到达开头后不再动作
  const prevImage = useCallback(() => {
    if (blindRef.current) {
      if (blindIndexRef.current <= 0) return;
      blindIndexRef.current -= 1;
      applyBlindIndex();
      forceUpdate();
      return;
    }
    let changed = false;
    const next = new Map(indicesRef.current);
    for (const f of foldersRef.current) {
      const l = filteredImagesRef.current.get(f.path) ?? [];
      if (l.length === 0) continue;
      const cur = next.get(f.path) ?? 0;
      const target = Math.max(cur - 1, 0);
      if (target !== cur) {
        next.set(f.path, target);
        changed = true;
      }
    }
    if (!changed) return;
    indicesRef.current = next;
    forceUpdate();
  }, [applyBlindIndex, forceUpdate]);

  // Ctrl+点击无同名时的 fallback：所有文件夹对齐到相同序号
  const alignByIndex = useCallback(
    (idx: number) => {
      if (blindRef.current) {
        blindIndexRef.current = Math.max(
          0,
          Math.min(idx, blindRef.current.order.length - 1),
        );
        applyBlindIndex();
        forceUpdate();
        return;
      }
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
    [applyBlindIndex, forceUpdate],
  );

  // Ctrl+点击：所有文件夹对齐到同名图片，找不到的回退到相同序号
  const alignByName = useCallback(
    (folderPath: string, imageName: string) => {
      const list = filteredImagesRef.current.get(folderPath);
      if (!list || !imageName) return;
      if (blindRef.current) {
        const idx = list.findIndex((i) => i.name === imageName);
        if (idx >= 0) {
          blindIndexRef.current = idx;
          applyBlindIndex();
          forceUpdate();
        }
        return;
      }
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
    [applyBlindIndex, forceUpdate],
  );

  const setIntersectionMode = useCallback((b: boolean) => {
    if (blindRef.current) return;
    if (b && foldersRef.current.length < 2) return;
    setIntersectionModeState(b);
  }, []);

  const enterBlind = useCallback(
    (result: BlindSetupResult) => {
      // Backend aliases are keyed by normalized paths; remap them onto the
      // exact folder paths currently held by the compare state.
      const aliasByNorm = new Map(
        Object.entries(result.aliases).map(([k, v]) => [normalizePath(k), v]),
      );
      const aliases: Record<string, string> = {};
      for (const f of foldersRef.current) {
        aliases[f.path] =
          aliasByNorm.get(normalizePath(f.path)) ?? result.aliases[f.path] ?? '';
      }
      blindRef.current = {
        aliases,
        order: result.common_files,
        displayOrders: result.display_orders,
        outputPath: result.output_path,
        winLists: result.win_lists,
      };
      prevModeRef.current = { intersectionMode, searchQuery };
      setIntersectionModeState(false);
      setSearchQuery('');
      blindIndexRef.current = 0;
      applyBlindIndex();
      forceUpdate();
    },
    [applyBlindIndex, forceUpdate, intersectionMode, searchQuery],
  );

  const exitBlind = useCallback(() => {
    if (!blindRef.current) return;
    blindRef.current = null;
    const prev = prevModeRef.current;
    if (prev) {
      setIntersectionModeState(prev.intersectionMode);
      setSearchQuery(prev.searchQuery);
    }
    prevModeRef.current = null;
    blindIndexRef.current = 0;
    const next = new Map<string, number>();
    for (const f of foldersRef.current) next.set(f.path, 0);
    indicesRef.current = next;
    forceUpdate();
  }, [forceUpdate]);

  const vote = useCallback(
    async (name: string, alias: string | null) => {
      const blind = blindRef.current;
      if (!blind) return;
      try {
        const data = await voteBlindEval(blind.outputPath, name, alias);
        blind.winLists = winListsFromData(data, blind.aliases);
        forceUpdate();
      } catch (e) {
        alert(e instanceof Error ? e.message : '保存投票失败');
      }
    },
    [forceUpdate],
  );

  const blindSetIndex = useCallback(
    (index: number) => {
      const total = blindRef.current?.order.length ?? 0;
      if (total === 0) return;
      blindIndexRef.current = Math.max(0, Math.min(index, total - 1));
      applyBlindIndex();
      forceUpdate();
    },
    [applyBlindIndex, forceUpdate],
  );

  const blindRuntime = blindRef.current;
  let blind: BlindEvalApi | null = null;
  if (blindRuntime) {
    const votes = new Map<string, string>();
    for (const [alias, names] of Object.entries(blindRuntime.winLists)) {
      for (const n of names) votes.set(n, alias);
    }
    blind = {
      aliases: blindRuntime.aliases,
      order: blindRuntime.order,
      displayOrders: blindRuntime.displayOrders,
      outputPath: blindRuntime.outputPath,
      index: blindIndexRef.current,
      total: blindRuntime.order.length,
      votes,
      votedCount: blindRuntime.order.filter((n) => votes.has(n)).length,
      setIndex: blindSetIndex,
      vote,
    };
  }

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
    blind,
    enterBlind,
    exitBlind,
  };
}
