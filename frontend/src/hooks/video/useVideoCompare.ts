import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getVideoInfo, listVideos } from '../../api/video';
import type { VideoEntry, VideoInfo } from '../../types/video';
import type { SelectedFolder } from '../../types';

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

  const selectedFolders = foldersRef.current;
  const videosPerFolder = videosRef.current;
  const currentVideoIndices = indicesRef.current;
  const videoInfos = infosRef.current;

  const filteredVideos = useMemo(() => {
    const map = new Map<string, VideoEntry[]>();
    const q = searchQuery.trim().toLowerCase();
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
      const trimmed = path.trim();
      if (!trimmed) return;
      if (foldersRef.current.length >= 4) {
        alert('不支持超过4个视频对比');
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
      const l = filteredVideosRef.current.get(folderPath) ?? [];
      const clamped = l.length === 0 ? 0 : Math.max(0, Math.min(idx, l.length - 1));
      const next = new Map(indicesRef.current);
      next.set(folderPath, clamped);
      indicesRef.current = next;
      forceUpdate();
    },
    [forceUpdate],
  );

  const nextVideo = useCallback(() => {
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
  }, [forceUpdate]);

  const prevVideo = useCallback(() => {
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
  }, [forceUpdate]);

  const alignByIndex = useCallback(
    (idx: number) => {
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
    [forceUpdate],
  );

  const alignByName = useCallback(
    (folderPath: string, videoName: string) => {
      const list = filteredVideosRef.current.get(folderPath);
      if (!list || !videoName) return;
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
    [forceUpdate],
  );

  const setIntersectionMode = useCallback((b: boolean) => {
    if (b && foldersRef.current.length < 2) return;
    setIntersectionModeState(b);
  }, []);

  // Jump the video list to the given video file (used when clicking a video
  // in the folder tree). Only acts if the video's parent folder has already
  // been added to the compare list. Returns true if a jump happened.
  const selectVideoByPath = useCallback(
    (videoPath: string): boolean => {
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
  };
}
