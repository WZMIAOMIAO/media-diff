import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listImages, voteBlindEval, type FileEntry } from '../api';
import type {
  AnnotationApi,
  AnnotationEntry,
  BlindEvalApi,
  BlindSetupResult,
  SelectedFolder,
} from '../types';
import { useAnnotation, buildPathGroups } from './useAnnotation';
import { t } from '../i18n/store';

export type { BlindEvalApi } from '../types';

const IMAGE_COMMON_TEXTS_KEY = 'image_viewer_common_texts';

interface BlindRuntime {
  aliases: Record<string, string>;
  order: string[];
  displayOrders: Record<string, number[]>;
  outputPath: string;
  winLists: Record<string, string[]>;
  /** Whether the common file keys are folder-relative paths (recursive). */
  recursive: boolean;
}

/** Pairing key: file name in flat mode, folder-relative path in recursive mode. */
function pairKeyOf(item: { name: string; rel?: string }, recursive: boolean): string {
  return recursive ? item.rel ?? item.name : item.name;
}

function missingEntry(key: string): FileEntry {
  return { name: '', path: '', rel: key, missing: true };
}

export interface UseImageCompareReturn {
  // 文件夹
  selectedFolders: SelectedFolder[];
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => void;
  /** Reorder selected folders; columns/windows follow. Blocked in annotation/blind. */
  moveFolder: (from: number, to: number) => boolean;
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

  // 递归（含子文件夹）
  recursiveMode: boolean;
  setRecursiveMode: (b: boolean) => void;
  /** True when a recursive listing hit the backend entry cap. */
  truncated: boolean;

  // 盲评模式
  blind: BlindEvalApi | null;
  enterBlind: (result: BlindSetupResult) => void;
  exitBlind: () => void;

  // 标注模式
  annotation: AnnotationApi | null;
  enterAnnotation: (outputPath: string, entries: AnnotationEntry[]) => void;
  exitAnnotation: () => void;
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
  const [recursiveMode, setRecursiveModeState] = useState(false);
  const recursiveRef = useRef(recursiveMode);
  const [truncated, setTruncated] = useState(false);

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
        const byKey = new Map(
          imgs.map((i) => [pairKeyOf(i, blind.recursive), i] as const),
        );
        let list = blind.order
          .map((k) => byKey.get(k))
          .filter((x): x is FileEntry => x !== undefined);
        if (q) {
          list = list.filter((i) =>
            pairKeyOf(i, blind.recursive).toLowerCase().includes(q),
          );
        }
        map.set(f.path, list);
      }
      return map;
    }

    if (recursiveRef.current) {
      const folders = foldersRef.current;
      const perFolder = folders.map((f) => {
        const byKey = new Map<string, FileEntry>();
        for (const i of imagesRef.current.get(f.path) ?? []) {
          byKey.set(pairKeyOf(i, true), i);
        }
        return byKey;
      });
      let keys: string[];
      if (folders.length === 0) {
        keys = [];
      } else if (intersectionMode && folders.length >= 2) {
        let common: Set<string> | null = null;
        for (const m of perFolder) {
          const s = new Set(m.keys());
          if (common === null) {
            common = s;
          } else {
            for (const k of [...common]) {
              if (!s.has(k)) common.delete(k);
            }
          }
        }
        keys = [...(common ?? new Set<string>())];
      } else {
        const union = new Set<string>();
        for (const m of perFolder) {
          for (const k of m.keys()) union.add(k);
        }
        keys = [...union];
      }
      keys.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      );
      if (q) keys = keys.filter((k) => k.toLowerCase().includes(q));
      folders.forEach((f, i) => {
        const m = perFolder[i];
        map.set(
          f.path,
          keys.map((k) => m.get(k) ?? missingEntry(k)),
        );
      });
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
      filtered = [...filtered].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
      map.set(f.path, filtered);
    }
    return map;
  }, [tick, searchQuery, intersectionMode, recursiveMode]);

  // 同步最新 filteredImages 给回调使用
  const filteredImagesRef = useRef(filteredImages);
  filteredImagesRef.current = filteredImages;

  // 标注：当前图组（按窗口顺序）的图片绝对路径。缺失占位（递归模式）不参与。
  const annPaths: string[] = [];
  for (const f of foldersRef.current) {
    const list = filteredImages.get(f.path) ?? [];
    if (list.length === 0) continue;
    const idx = Math.min(Math.max(indicesRef.current.get(f.path) ?? 0, 0), list.length - 1);
    const item = list[idx];
    if (item && !item.missing && item.path) annPaths.push(item.path);
  }
  const {
    annotation,
    enter: enterAnnotation,
    exit: exitAnnotation,
  } = useAnnotation({
    media: 'image',
    currentPaths: annPaths,
    getGroups: () =>
      buildPathGroups(foldersRef.current, filteredImagesRef.current),
    commonTextsKey: IMAGE_COMMON_TEXTS_KEY,
    forceUpdate,
  });

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
        alert(t('blind.locked.add'));
        return;
      }
      const trimmed = path.trim();
      if (!trimmed) return;
      if (foldersRef.current.length >= 4) {
        alert(t('limit.folders'));
        return;
      }
      if (foldersRef.current.some((f) => f.path === trimmed)) return;
      let images: FileEntry[] = [];
      try {
        const result = await listImages(trimmed, recursiveRef.current);
        images = result.images;
        if (result.truncated) setTruncated(true);
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
        alert(t('blind.locked.remove'));
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

  const moveFolder = useCallback(
    (from: number, to: number): boolean => {
      if (blindRef.current || annotation) return false;
      const folders = foldersRef.current;
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= folders.length ||
        to >= folders.length
      ) {
        return false;
      }
      const next = folders.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      foldersRef.current = next;
      forceUpdate();
      return true;
    },
    [annotation, forceUpdate],
  );

  const clearFolders = useCallback(() => {
    if (blindRef.current) {
      alert(t('blind.locked.clear'));
      return;
    }
    foldersRef.current = [];
    imagesRef.current = new Map();
    indicesRef.current = new Map();
    setIntersectionModeState(false);
    setSearchQuery('');
    setTruncated(false);
    recursiveRef.current = false;
    setRecursiveModeState(false);
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

  // Ctrl+点击：所有文件夹对齐到相同配对 key 的图片（扁平=文件名，递归=相对路径），
  // 找不到的回退到相同序号。
  const alignByName = useCallback(
    (folderPath: string, key: string) => {
      const list = filteredImagesRef.current.get(folderPath);
      if (!list || !key) return;
      const blind = blindRef.current;
      const recursive = blind ? blind.recursive : recursiveRef.current;
      const keyOf = (i: FileEntry) => pairKeyOf(i, recursive);
      if (blind) {
        const idx = list.findIndex((i) => keyOf(i) === key);
        if (idx >= 0) {
          blindIndexRef.current = idx;
          applyBlindIndex();
          forceUpdate();
        }
        return;
      }
      const srcIdx = list.findIndex((i) => keyOf(i) === key);
      if (srcIdx < 0) return;
      const next = new Map(indicesRef.current);
      for (const f of foldersRef.current) {
        const l = filteredImagesRef.current.get(f.path) ?? [];
        if (l.length === 0) {
          next.set(f.path, 0);
          continue;
        }
        const found = l.findIndex((i) => keyOf(i) === key);
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

  // 递归（含子文件夹）开关：用新标志重列所有已选文件夹，盲评中禁用。
  const setRecursiveMode = useCallback(
    async (b: boolean) => {
      if (blindRef.current) {
        alert(t('blind.locked.recursive'));
        return;
      }
      if (b === recursiveRef.current) return;
      const folders = foldersRef.current;
      const results = await Promise.all(
        folders.map((f) =>
          listImages(f.path, b)
            .then((r) => ({ images: r.images, truncated: !!r.truncated }))
            .catch(() => ({ images: [] as FileEntry[], truncated: false })),
        ),
      );
      const nextImages = new Map<string, FileEntry[]>();
      folders.forEach((f, i) => nextImages.set(f.path, results[i].images));
      setTruncated(results.some((r) => r.truncated));
      imagesRef.current = nextImages;
      recursiveRef.current = b;
      setRecursiveModeState(b);
      const nextIndices = new Map<string, number>();
      for (const f of folders) nextIndices.set(f.path, 0);
      indicesRef.current = nextIndices;
      forceUpdate();
    },
    [forceUpdate],
  );

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
        recursive: recursiveRef.current,
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
        alert(e instanceof Error ? e.message : t('blind.voteFailed'));
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
      recursive: blindRuntime.recursive,
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
    moveFolder,
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
    recursiveMode,
    setRecursiveMode,
    truncated,
    blind,
    enterBlind,
    exitBlind,
    annotation,
    enterAnnotation,
    exitAnnotation,
  };
}
