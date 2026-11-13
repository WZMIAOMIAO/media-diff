import type {
  AnnotationCheckResult,
  AnnotationEntry,
  AnnotationMedia,
  BlindSetupParams,
  BlindSetupResult,
  HistogramData,
} from '../types';
import { t } from '../i18n/store';
import { isWithinAnyRoot } from '../utils/path';
import { LruCache } from '../utils/lruCache';

const API_BASE = '/api';

/** Upper bounds for the module-level caches so a long session cannot grow forever. */
export const IMAGE_THUMB_CACHE_MAX = 1000;
export const IMAGE_HISTOGRAM_CACHE_MAX = 2000;

export interface SubDir {
  name: string;
  path: string;
  has_children: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  /** 递归列出时相对所选根目录的路径（posix 分隔符）；扁平模式为 undefined */
  rel?: string;
  /** 前端注入的对齐占位项：该 key 在本文件夹中不存在 */
  missing?: boolean;
}

export interface BrowseResult {
  path: string;
  subdirs: SubDir[];
  images: FileEntry[];
  json_files?: FileEntry[];
}

export async function getRoots(): Promise<{ roots: string[] }> {
  const res = await fetch(`${API_BASE}/filesystem/roots`);
  if (!res.ok) throw new Error('Failed to get roots');
  return res.json();
}

/**
 * Configured access roots (sandbox), or ``[]`` when unrestricted. Used by the
 * tree to discard persisted roots that fall outside every configured root.
 */
export async function getAccessRoots(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    roots?: string[] | null;
    root?: string | null;
  };
  if (Array.isArray(data.roots)) {
    return data.roots.filter(
      (r): r is string => typeof r === 'string' && r.length > 0,
    );
  }
  // Back-compat with servers that only report a single root.
  return typeof data.root === 'string' && data.root ? [data.root] : [];
}

// Default directory for the folder browser: user home (Linux/macOS) or
// Desktop (Windows).
export async function getDefaultBrowsePath(): Promise<string> {
  const res = await fetch(`${API_BASE}/filesystem/home`);
  if (!res.ok) throw new Error(t('api.defaultDirFailed'));
  const data = (await res.json()) as { path: string };
  return data.path;
}

export async function browseFolder(
  path: string,
  includeJson = false,
): Promise<BrowseResult> {
  const res = await fetch(`${API_BASE}/filesystem/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, include_json: includeJson }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || t('api.browseFailed'));
  }
  return res.json();
}

export async function listImages(
  path: string,
  recursive = false,
): Promise<{ images: FileEntry[]; truncated?: boolean }> {
  const res = await fetch(`${API_BASE}/filesystem/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, recursive }),
  });
  if (!res.ok) throw new Error(t('api.imageListFailed'));
  return res.json();
}

// 图片查看（返回 Object URL，全局缓存）
const _imageCache = new Map<string, string>(); // path → Object URL
const _imageInflight = new Map<string, Promise<string>>();

export async function fetchImageBlob(path: string): Promise<string> {
  const cached = _imageCache.get(path);
  if (cached) return cached;
  const inflight = _imageInflight.get(path);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const res = await fetch(
        `${API_BASE}/images/view?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw new Error(`${t('api.imageLoadFailed')}: ${path}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      _imageCache.set(path, url);
      return url;
    } finally {
      _imageInflight.delete(path);
    }
  })();
  _imageInflight.set(path, promise);
  return promise;
}

// 缩略图（返回 blobUrl + 直方图数据，全局 LRU 缓存 + 请求去重）
const _thumbCache = new LruCache<
  string,
  { blobUrl: string; histogram: HistogramData | null }
>(IMAGE_THUMB_CACHE_MAX);
const _thumbInflight = new Map<
  string,
  Promise<{ blobUrl: string; histogram: HistogramData | null }>
>();

// 直方图 fallback 缓存（缩略图加载时自动填充）
export const histogramCache = new LruCache<string, HistogramData>(
  IMAGE_HISTOGRAM_CACHE_MAX,
);

function trimHistogramCache(): void {
  // No external resources are attached to histogram entries; dropping is enough.
  histogramCache.trim();
}

function putHistogram(path: string, data: HistogramData): void {
  histogramCache.set(path, data);
  trimHistogramCache();
}

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
    const parsed = JSON.parse(json) as RawHistogram;
    return normalizeHistogram(parsed);
  } catch {
    return null;
  }
}

export async function fetchThumbnailBlob(
  path: string,
  size = 200,
): Promise<{ blobUrl: string; histogram: HistogramData | null }> {
  const key = `${path}@${size}`;
  const cached = _thumbCache.get(key);
  if (cached) return cached;
  const inflight = _thumbInflight.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const res = await fetch(
        `${API_BASE}/images/thumbnail?path=${encodeURIComponent(path)}&size=${size}`,
      );
      if (!res.ok) throw new Error(`${t('api.thumbFailed')}: ${path}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const histogram = parseHistogramHeader(res.headers.get('X-Histogram'));
      const result = { blobUrl, histogram };
      const previous = _thumbCache.peek(key);
      if (previous) URL.revokeObjectURL(previous.blobUrl);
      _thumbCache.set(key, result);
      for (const [droppedKey, dropped] of _thumbCache.trim()) {
        URL.revokeObjectURL(dropped.blobUrl);
        const droppedPath = thumbKeyPath(droppedKey);
        if (!hasThumbForPath(droppedPath)) histogramCache.delete(droppedPath);
      }
      if (histogram) putHistogram(path, histogram);
      return result;
    } finally {
      _thumbInflight.delete(key);
    }
  })();
  _thumbInflight.set(key, promise);
  return promise;
}

// 直方图 fallback（缓存未命中时单独请求）
export async function fetchHistogram(path: string): Promise<HistogramData> {
  const cached = histogramCache.get(path);
  if (cached) return cached;
  const res = await fetch(
    `${API_BASE}/images/histogram?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) throw new Error(`${t('api.histogramFailed')}: ${path}`);
  const parsed = (await res.json()) as RawHistogram;
  const data = normalizeHistogram(parsed);
  putHistogram(path, data);
  return data;
}

/** The path part of a thumbnail cache key (``${path}@${size}``). */
function thumbKeyPath(key: string): string {
  const at = key.lastIndexOf('@');
  return at === -1 ? key : key.slice(0, at);
}

function hasThumbForPath(path: string): boolean {
  const prefix = `${path}@`;
  for (const key of _thumbCache.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

// 缓存淘汰：保留 pathsToKeep 中的条目，其余 revokeObjectURL 并删除
export function evictImageCache(pathsToKeep: Set<string>): void {
  for (const [path, url] of _imageCache) {
    if (!pathsToKeep.has(path)) {
      URL.revokeObjectURL(url);
      _imageCache.delete(path);
    }
  }
}

/**
 * Drop full-size image blobs that no longer belong to any of ``folders``.
 * An empty list clears everything (the user cleared the compare pane). Keeping
 * paths under the remaining folders avoids revoking images still on screen.
 */
export function evictImageCacheForFolders(folders: string[]): void {
  for (const [path, url] of [..._imageCache]) {
    if (isWithinAnyRoot(path, folders)) continue;
    URL.revokeObjectURL(url);
    _imageCache.delete(path);
  }
}

/**
 * Drop thumbnail blobs + histograms that no longer belong to any of
 * ``folders`` (empty list = clear all). The backend keeps its own bounded LRU,
 * so a later re-selection is a cheap HTTP hit rather than a re-decode.
 */
export function evictThumbnailCacheForFolders(folders: string[]): void {
  if (folders.length === 0) {
    for (const entry of _thumbCache.values()) {
      URL.revokeObjectURL(entry.blobUrl);
    }
    _thumbCache.clear();
    histogramCache.clear();
    return;
  }
  const droppedPaths = new Set<string>();
  for (const [key, entry] of [..._thumbCache]) {
    const path = thumbKeyPath(key);
    if (isWithinAnyRoot(path, folders)) continue;
    URL.revokeObjectURL(entry.blobUrl);
    _thumbCache.delete(key);
    droppedPaths.add(path);
  }
  for (const path of droppedPaths) {
    if (!hasThumbForPath(path)) histogramCache.delete(path);
  }
}

// ---- 盲评模式 ----

async function postBlind<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/blind-eval/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.detail || t('api.blindFailed'));
  }
  return payload as T;
}

export function setupBlindEval(
  params: BlindSetupParams,
): Promise<BlindSetupResult> {
  return postBlind<BlindSetupResult>('setup', {
    load_existing: false,
    ...params,
  });
}

export async function voteBlindEval(
  outputPath: string,
  imageName: string,
  alias: string | null,
): Promise<Record<string, unknown>> {
  const res = await postBlind<{ data: Record<string, unknown> }>('vote', {
    output_path: outputPath,
    image_name: imageName,
    alias,
  });
  return res.data;
}

export async function loadBlindEval(
  outputPath: string,
): Promise<Record<string, unknown>> {
  const res = await postBlind<{ data: Record<string, unknown> }>('load', {
    output_path: outputPath,
  });
  return res.data;
}

export async function saveBlindEval(
  outputPath: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await postBlind<{ data: Record<string, unknown> }>('save', {
    output_path: outputPath,
    data,
  });
  return res.data;
}

// ---- 标注模式 ----

async function postAnnotation<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/annotations/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.detail || t('api.annotationFailed'));
  }
  return payload as T;
}

export function checkAnnotationPath(
  path: string,
  media: AnnotationMedia = 'image',
): Promise<AnnotationCheckResult> {
  return postAnnotation<AnnotationCheckResult>('check-path', { path, media });
}

export async function loadAnnotations(
  savePath: string,
  media: AnnotationMedia = 'image',
): Promise<AnnotationEntry[]> {
  const res = await postAnnotation<{ data: AnnotationEntry[] }>('load', {
    save_path: savePath,
    media,
  });
  return res.data;
}

export async function saveAnnotations(
  savePath: string,
  annotations: AnnotationEntry[],
  media: AnnotationMedia = 'image',
): Promise<AnnotationEntry[]> {
  const res = await postAnnotation<{ data: AnnotationEntry[] }>('save', {
    save_path: savePath,
    annotations,
    media,
  });
  return res.data;
}
