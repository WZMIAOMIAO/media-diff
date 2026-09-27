import type { BlindSetupParams, BlindSetupResult, HistogramData } from '../types';

const API_BASE = '/api';

export interface SubDir {
  name: string;
  path: string;
  has_children: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
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

// Default directory for the folder browser: user home (Linux/macOS) or
// Desktop (Windows).
export async function getDefaultBrowsePath(): Promise<string> {
  const res = await fetch(`${API_BASE}/filesystem/home`);
  if (!res.ok) throw new Error('获取默认目录失败');
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
    throw new Error(err.detail || '浏览文件夹失败');
  }
  return res.json();
}

export async function listImages(
  path: string,
): Promise<{ images: FileEntry[] }> {
  const res = await fetch(`${API_BASE}/filesystem/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error('获取图片列表失败');
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
      if (!res.ok) throw new Error(`图片加载失败: ${path}`);
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

// 缩略图（返回 blobUrl + 直方图数据，全局缓存 + 请求去重）
const _thumbCache = new Map<
  string,
  { blobUrl: string; histogram: HistogramData | null }
>();
const _thumbInflight = new Map<
  string,
  Promise<{ blobUrl: string; histogram: HistogramData | null }>
>();

// 直方图 fallback 缓存（缩略图加载时自动填充）
export const histogramCache = new Map<string, HistogramData>();

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
      if (!res.ok) throw new Error(`缩略图加载失败: ${path}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const histogram = parseHistogramHeader(res.headers.get('X-Histogram'));
      const result = { blobUrl, histogram };
      _thumbCache.set(key, result);
      if (histogram) histogramCache.set(path, histogram);
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
  if (!res.ok) throw new Error(`直方图加载失败: ${path}`);
  const parsed = (await res.json()) as RawHistogram;
  const data = normalizeHistogram(parsed);
  histogramCache.set(path, data);
  return data;
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

// ---- 盲评模式 ----

async function postBlind<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/blind-eval/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.detail || '盲评请求失败');
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
