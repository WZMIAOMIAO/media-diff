import type { HistogramData, TranscodeStatus, VideoBrowseResult, VideoEntry, VideoInfo } from '../types/video';
import { t } from '../i18n/store';
import { isWithinAnyRoot } from '../utils/path';
import { LruCache } from '../utils/lruCache';

const API_BASE = '/api';

/** Upper bounds for the module-level caches so a long session cannot grow forever. */
export const VIDEO_THUMB_CACHE_MAX = 500;
export const VIDEO_FRAME_HISTOGRAM_CACHE_MAX = 400;

// ---- folder / listing ----

export async function getRoots(): Promise<{ roots: string[] }> {
  const res = await fetch(`${API_BASE}/filesystem/roots`);
  if (!res.ok) throw new Error('Failed to get roots');
  return res.json();
}

export async function browseFolderVideo(path: string): Promise<VideoBrowseResult> {
  const res = await fetch(`${API_BASE}/filesystem/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, include_json: false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || t('api.browseFailed'));
  }
  const data = (await res.json()) as {
    path: string;
    subdirs: { name: string; path: string; has_children: boolean }[];
    images: VideoEntry[];
    videos?: VideoEntry[];
  };
  return {
    path: data.path,
    subdirs: data.subdirs,
    videos: data.videos ?? [],
  };
}

export async function listVideos(
  path: string,
  recursive = false,
): Promise<{ videos: VideoEntry[]; truncated?: boolean }> {
  const res = await fetch(`${API_BASE}/filesystem/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, recursive }),
  });
  if (!res.ok) throw new Error(t('api.videoListFailed'));
  return res.json();
}

// ---- video info ----

export async function getVideoInfo(path: string): Promise<VideoInfo> {
  const res = await fetch(`${API_BASE}/videos/info?path=${encodeURIComponent(path)}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || t('api.videoInfoFailed'));
  }
  return res.json();
}

// ---- stream url ----

export function getVideoStreamUrl(path: string, version?: string | number): string {
  const base = `${API_BASE}/videos/stream?path=${encodeURIComponent(path)}`;
  return version !== undefined && version !== ''
    ? `${base}&v=${encodeURIComponent(String(version))}`
    : base;
}

// ---- transcode (browser-unsupported codecs) ----

export async function startVideoTranscode(path: string): Promise<TranscodeStatus> {
  const res = await fetch(
    `${API_BASE}/videos/transcode?path=${encodeURIComponent(path)}`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(t('api.transcodeStartFailed'));
  return res.json();
}

export async function getVideoTranscodeStatus(path: string): Promise<TranscodeStatus> {
  const res = await fetch(
    `${API_BASE}/videos/transcode-status?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) throw new Error(t('api.transcodeStatusFailed'));
  return res.json();
}

// ---- histogram helpers ----

interface RawHistogram {
  r: number[];
  g: number[];
  b: number[];
  r_mean: number;
  g_mean: number;
  b_mean: number;
}

function normalizeHistogram(raw: RawHistogram): HistogramData {
  return {
    r: raw.r,
    g: raw.g,
    b: raw.b,
    rMean: raw.r_mean,
    gMean: raw.g_mean,
    bMean: raw.b_mean,
  };
}

function parseHistogramHeader(header: string | null): HistogramData | null {
  if (!header) return null;
  try {
    const json = atob(header);
    return normalizeHistogram(JSON.parse(json) as RawHistogram);
  } catch {
    return null;
  }
}

// ---- frame cache (for paused/stepped frame comparison) ----

interface FrameEntry {
  blobUrl: string;
  histogram: HistogramData | null;
}

const _frameCache = new Map<string, FrameEntry>();
const _frameInflight = new Map<string, { promise: Promise<FrameEntry>; controller: AbortController }>();
export const frameHistogramCache = new LruCache<string, HistogramData>(
  VIDEO_FRAME_HISTOGRAM_CACHE_MAX,
);

// Upper bound for cached frames. The "live" working set per window is only
// currentFrame +/- PREFETCH_RANGE, so this is generous. On overflow we evict
// the oldest entries that are NOT currently pinned (pinned = the frames the
// visible windows may display right now), so a displayed frame is never
// revoked.
const FRAME_CACHE_MAX = 200;
const _pinnedFrameKeys = new Set<string>();

export function setPinnedFrames(keys: Set<string>): void {
  _pinnedFrameKeys.clear();
  for (const k of keys) _pinnedFrameKeys.add(k);
}

function putFrameCache(key: string, entry: FrameEntry): void {
  // re-insert to mark as most-recently-used
  _frameCache.delete(key);
  _frameCache.set(key, entry);
  if (_frameCache.size <= FRAME_CACHE_MAX) return;
  for (const k of [..._frameCache.keys()]) {
    if (_frameCache.size <= FRAME_CACHE_MAX) break;
    if (_pinnedFrameKeys.has(k)) continue;
    const e = _frameCache.get(k);
    if (e) URL.revokeObjectURL(e.blobUrl);
    _frameCache.delete(k);
    frameHistogramCache.delete(k);
  }
}

function frameKey(videoPath: string, frame: number): string {
  return `${videoPath}@@${frame}`;
}

export async function fetchVideoFrame(
  videoPath: string,
  frame: number,
  options?: { signal?: AbortSignal },
): Promise<FrameEntry> {
  const key = frameKey(videoPath, frame);
  const cached = _frameCache.get(key);
  if (cached) {
    // mark as most-recently-used
    _frameCache.delete(key);
    _frameCache.set(key, cached);
    return cached;
  }

  let inflight = _frameInflight.get(key);
  if (!inflight) {
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/videos/frame?path=${encodeURIComponent(videoPath)}&frame=${frame}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`${t('api.frameFailed')}: ${videoPath}#${frame}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const histogram = parseHistogramHeader(res.headers.get('X-Histogram'));
        const entry: FrameEntry = { blobUrl, histogram };
        putFrameCache(key, entry);
        if (histogram) {
          frameHistogramCache.set(key, histogram);
          frameHistogramCache.trim();
        }
        return entry;
      } finally {
        if (_frameInflight.get(key)?.controller === controller) _frameInflight.delete(key);
      }
    })();
    inflight = { promise, controller };
    _frameInflight.set(key, inflight);
  }

  // Link the caller's signal to the shared request: aborting any caller
  // cancels the (now-unwanted) extraction and frees the browser connection.
  const { promise, controller } = inflight;
  const signal = options?.signal;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return promise;
}

export function frameHistogramCacheKey(videoPath: string, frame: number): string {
  return frameKey(videoPath, frame);
}

export async function fetchVideoFrameHistogram(
  videoPath: string,
  frame: number,
): Promise<HistogramData> {
  const key = frameKey(videoPath, frame);
  const cached = frameHistogramCache.get(key);
  if (cached) return cached;
  const res = await fetch(
    `${API_BASE}/videos/histogram?path=${encodeURIComponent(videoPath)}&frame=${frame}`,
  );
  if (!res.ok) throw new Error(t('api.frameHistogramFailed'));
  const parsed = (await res.json()) as RawHistogram;
  const data = normalizeHistogram(parsed);
  frameHistogramCache.set(key, data);
  frameHistogramCache.trim();
  return data;
}

// ---- thumbnail cache (video cover frames) ----

const _thumbCache = new LruCache<string, FrameEntry>(VIDEO_THUMB_CACHE_MAX);
const _thumbInflight = new Map<
  string,
  { promise: Promise<FrameEntry>; controller: AbortController }
>();

export async function fetchVideoThumbnail(
  path: string,
  size = 200,
  options?: { signal?: AbortSignal },
): Promise<FrameEntry> {
  const key = `${path}@${size}`;
  const cached = _thumbCache.get(key);
  if (cached) return cached;
  let inflight = _thumbInflight.get(key);
  if (!inflight) {
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/videos/thumbnail?path=${encodeURIComponent(path)}&size=${size}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`${t('api.videoThumbFailed')}: ${path}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const histogram = parseHistogramHeader(res.headers.get('X-Histogram'));
        const entry: FrameEntry = { blobUrl, histogram };
        const previous = _thumbCache.peek(key);
        if (previous) URL.revokeObjectURL(previous.blobUrl);
        _thumbCache.set(key, entry);
        for (const [, dropped] of _thumbCache.trim()) {
          URL.revokeObjectURL(dropped.blobUrl);
        }
        return entry;
      } finally {
        if (_thumbInflight.get(key)?.controller === controller) {
          _thumbInflight.delete(key);
        }
      }
    })();
    inflight = { promise, controller };
    _thumbInflight.set(key, inflight);
  }

  // A caller that unmounts (fast scroll) cancels the shared request, freeing
  // the browser connection instead of leaving it queued behind hundreds of
  // other thumbnails that are no longer visible.
  const { promise, controller } = inflight;
  const signal = options?.signal;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return promise;
}

/**
 * Drop video cover thumbnails that no longer belong to any of ``folders``
 * (empty list = clear all), revoking their object URLs.
 */
export function evictVideoThumbnailCacheForFolders(folders: string[]): void {
  const at = (key: string) => {
    const idx = key.lastIndexOf('@');
    return idx === -1 ? key : key.slice(0, idx);
  };
  for (const [key, entry] of [..._thumbCache]) {
    if (isWithinAnyRoot(at(key), folders)) continue;
    URL.revokeObjectURL(entry.blobUrl);
    _thumbCache.delete(key);
  }
}

// evict frame cache entries outside the keep set (by videoPath+frame key)
export function evictFrameCache(keysToKeep: Set<string>): void {
  for (const [key, entry] of _frameCache) {
    if (!keysToKeep.has(key)) {
      URL.revokeObjectURL(entry.blobUrl);
      _frameCache.delete(key);
      frameHistogramCache.delete(key);
    }
  }
}

// Clear all cached frames whose video path is NOT in keepPaths.
// Called when the set of current videos changes (video switch / folder
// change), so frames from deselected videos are freed without ever revoking
// a frame that is still displayed by another window.
export function clearFramesForOtherPaths(keepPaths: Set<string>): void {
  for (const [key, entry] of _frameCache) {
    const path = key.split('@@')[0];
    if (!keepPaths.has(path)) {
      URL.revokeObjectURL(entry.blobUrl);
      _frameCache.delete(key);
      frameHistogramCache.delete(key);
    }
  }
}
