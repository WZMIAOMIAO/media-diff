import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { voteBlindEval } from '../../api';
import { getVideoInfo, listVideos } from '../../api/video';
import type { VideoEntry, VideoInfo } from '../../types/video';
import type { BlindEvalApi, BlindSetupResult, SelectedFolder } from '../../types';
import { t } from '../../i18n/store';

export interface UseVideoCompareReturn {
  selectedFolders: SelectedFolder[];
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => void;
  clearFolders: () => void;

  videosPerFolder: Map<string, VideoEntry[]>;
  filteredVideos: Map<string, VideoEntry[]>;
  currentVideoIndices: Map<string, number>;
  setCurrentVideoIndex: (folderPath: string, idx: number) => void;
  nextVideo: () => void;
  prevVideo: () => void;
  alignByName: (folderPath: string, videoName: string) => void;
  alignByIndex: (idx: number) => void;
  selectVideoByPath: (videoPath: string) => boolean;

  currentVideos: Map<string, VideoEntry | null>;
  videoInfos: Map<string, VideoInfo>;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  intersectionMode: boolean;
  setIntersectionMode: (b: boolean) => void;

  blind: BlindEvalApi | null;
  enterBlind: (result: BlindSetupResult) => void;
  exitBlind: () => void;
}

interface BlindRuntime {
  aliases: Record<string, string>;
  order: string[];
  displayOrders: Record<string, number[]>;
  outputPath: string;
  winLists: Record<string, string[]>;
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

function getPathName(path: string): string {
  if (!path) return '';
  if (path === '/') return '/';
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed || trimmed === '/') return '/';
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx === -1) return trimmed;
  return trimmed.substring(idx + 1);
}

function getParentPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed || trimmed === '/') return '/';
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx <= 0) return '/';
  return trimmed.substring(0, idx);
}

function normalizePath(path: string): string {
  // Unify separators (Windows accepts both / and \), strip trailing
  // separators, and lower-case Windows-style paths for case-insensitive
  // comparison. POSIX paths are compared case-sensitively.
  let p = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[a-zA-Z]:/.test(p)) p = p.toLowerCase();
  return p || '/';
}

export function useVideoCompare(): UseVideoCompareReturn {
  const foldersRef = useRef<SelectedFolder[]>([]);
  const videosRef = useRef<Map<string, VideoEntry[]>>(new Map());
  const indicesRef = useRef<Map<string, number>>(new Map());
  const infosRef = useRef<Map<string, VideoInfo>>(new Map());
  const [tick, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const [searchQuery, setSearchQuery] = useState('');
  const [intersectionMode, setIntersectionModeState] = useState(false);

  const blindRef = useRef<BlindRuntime | null>(null);
  const blindIndexRef = useRef(0);
  const prevModeRef = useRef<{ intersectionMode: boolean; searchQuery: string } | null>(null);

  const selectedFolders = foldersRef.current;
  const videosPerFolder = videosRef.current;
  const currentVideoIndices = indicesRef.current;
  const videoInfos = infosRef.current;

  const filteredVideos = useMemo(() => {
    const map = new Map<string, VideoEntry[]>();
    const q = searchQuery.trim().toLowerCase();
    const blind = blindRef.current;

    if (blind) {
      for (const f of foldersRef.current) {
        const vids = videosRef.current.get(f.path) ?? [];
        const byName = new Map(vids.map((v) => [v.name, v] as const));
        let list = blind.order
          .map((n) => byName.get(n))
          .filter((x): x is VideoEntry => x !== undefined);
        if (q) list = list.filter((v) => v.name.toLowerCase().includes(q));
        map.set(f.path, list);
      }
      return map;
    }

    let intersectionNames: Set<string> | null = null;
    if (intersectionMode && foldersRef.current.length >= 2) {
      for (const f of foldersRef.current) {
        const vids = videosRef.current.get(f.path) ?? [];
        const names = new Set(vids.map((v) => v.name));
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
      const vids = videosRef.current.get(f.path) ?? [];
      let filtered = vids;
      if (intersectionNames) {
        filtered = filtered.filter((v) => intersectionNames.has(v.name));
      }
      if (q) {
        filtered = filtered.filter((v) => v.name.toLowerCase().includes(q));
      }
      filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      map.set(f.path, filtered);
    }
    return map;
  }, [tick, searchQuery, intersectionMode]);

  const filteredVideosRef = useRef(filteredVideos);
  filteredVideosRef.current = filteredVideos;

  // 将每个文件夹的索引对齐到当前盲评组编号。
  const applyBlindIndex = useCallback(() => {
    const next = new Map<string, number>();
    for (const f of foldersRef.current) {
      const len = filteredVideosRef.current.get(f.path)?.length ?? 0;
      next.set(f.path, len === 0 ? 0 : Math.min(blindIndexRef.current, len - 1));
    }
    indicesRef.current = next;
  }, []);

  useEffect(() => {
    let changed = false;
    const next = new Map(indicesRef.current);
    for (const f of foldersRef.current) {
      const l = filteredVideos.get(f.path) ?? [];
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
  }, [filteredVideos, forceUpdate]);

  const currentVideos = useMemo(() => {
    const map = new Map<string, VideoEntry | null>();
    for (const f of foldersRef.current) {
      const list = filteredVideosRef.current.get(f.path) ?? [];
      const idx = indicesRef.current.get(f.path) ?? 0;
      map.set(f.path, list[idx] ?? null);
    }
    return map;
  }, [filteredVideos, tick]);

  useEffect(() => {
    let cancelled = false;
    for (const f of foldersRef.current) {
      const v = currentVideos.get(f.path);
      if (!v) continue;
      const existing = infosRef.current.get(f.path);
      if (existing && (infosRef.current.get(f.path)?.path === v.path)) continue;
      getVideoInfo(v.path)
        .then((info) => {
          if (cancelled) return;
          const stored = infosRef.current.get(f.path);
          if (stored && stored.path === v.path) return;
          const nextInfos = new Map(infosRef.current);
          nextInfos.set(f.path, { ...info, path: v.path });
          infosRef.current = nextInfos;
          forceUpdate();
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [currentVideos, forceUpdate]);

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
      let videos: VideoEntry[] = [];
      try {
        const result = await listVideos(trimmed);
        videos = result.videos;
      } catch {
        videos = [];
      }
      foldersRef.current = [
        ...foldersRef.current,
        { path: trimmed, name: getPathName(trimmed) },
      ];
      const next = new Map(videosRef.current);
      next.set(trimmed, videos);
      videosRef.current = next;
      const nextIdx = new Map(indicesRef.current);
      nextIdx.set(trimmed, 0);
      indicesRef.current = nextIdx;
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
      const next = new Map(videosRef.current);
      next.delete(path);
      videosRef.current = next;
      const nextIdx = new Map(indicesRef.current);
      nextIdx.delete(path);
      indicesRef.current = nextIdx;
      const nextInfos = new Map(infosRef.current);
      nextInfos.delete(path);
      infosRef.current = nextInfos;
      if (foldersRef.current.length < 2) {
        setIntersectionModeState(false);
      }
      forceUpdate();
    },
    [forceUpdate],
  );

  const clearFolders = useCallback(() => {
    if (blindRef.current) {
      alert(t('blind.locked.clear'));
      return;
    }
    foldersRef.current = [];
    videosRef.current = new Map();
    indicesRef.current = new Map();
    infosRef.current = new Map();
    setIntersectionModeState(false);
    setSearchQuery('');
    forceUpdate();
  }, [forceUpdate]);

  const setCurrentVideoIndex = useCallback(
    (folderPath: string, idx: number) => {
      if (blindRef.current) {
        blindIndexRef.current = idx;
        applyBlindIndex();
        forceUpdate();
        return;
      }
      const l = filteredVideosRef.current.get(folderPath) ?? [];
      const clamped = l.length === 0 ? 0 : Math.max(0, Math.min(idx, l.length - 1));
      const next = new Map(indicesRef.current);
      next.set(folderPath, clamped);
      indicesRef.current = next;
      forceUpdate();
    },
    [applyBlindIndex, forceUpdate],
  );

  const nextVideo = useCallback(() => {
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
      const l = filteredVideosRef.current.get(f.path) ?? [];
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

  const prevVideo = useCallback(() => {
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
      const l = filteredVideosRef.current.get(f.path) ?? [];
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
        const l = filteredVideosRef.current.get(f.path) ?? [];
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

  const alignByName = useCallback(
    (folderPath: string, videoName: string) => {
      const list = filteredVideosRef.current.get(folderPath);
      if (!list || !videoName) return;
      if (blindRef.current) {
        const idx = list.findIndex((v) => v.name === videoName);
        if (idx >= 0) {
          blindIndexRef.current = idx;
          applyBlindIndex();
          forceUpdate();
        }
        return;
      }
      const srcIdx = list.findIndex((v) => v.name === videoName);
      if (srcIdx < 0) return;
      const next = new Map(indicesRef.current);
      for (const f of foldersRef.current) {
        const l = filteredVideosRef.current.get(f.path) ?? [];
        if (l.length === 0) {
          next.set(f.path, 0);
          continue;
        }
        const found = l.findIndex((v) => v.name === videoName);
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

  // Jump the video list to the given video file (used when clicking a video
  // in the folder tree). Only acts if the video's parent folder has already
  // been added to the compare list. Returns true if a jump happened.
  const selectVideoByPath = useCallback(
    (videoPath: string): boolean => {
      if (blindRef.current) return false;
      const parent = normalizePath(getParentPath(videoPath));
      const folder = foldersRef.current.find(
        (f) => normalizePath(f.path) === parent,
      );
      if (!folder) return false;
      const list = filteredVideosRef.current.get(folder.path) ?? [];
      const idx = list.findIndex((v) => v.path === videoPath);
      if (idx < 0) return false;
      const next = new Map(indicesRef.current);
      next.set(folder.path, idx);
      indicesRef.current = next;
      forceUpdate();
      return true;
    },
    [forceUpdate],
  );

  const enterBlind = useCallback(
    (result: BlindSetupResult) => {
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
    videosPerFolder,
    filteredVideos,
    currentVideoIndices,
    setCurrentVideoIndex,
    nextVideo,
    prevVideo,
    alignByName,
    alignByIndex,
    selectVideoByPath,
    currentVideos,
    videoInfos,
    searchQuery,
    setSearchQuery,
    intersectionMode,
    setIntersectionMode,
    blind,
    enterBlind,
    exitBlind,
  };
}
