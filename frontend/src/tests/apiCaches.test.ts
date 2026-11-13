import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HIST = {
  r: [1, 2, 3],
  g: [4, 5, 6],
  b: [7, 8, 9],
  r_mean: 2,
  g_mean: 5,
  b_mean: 8,
};
const HIST_HEADER = btoa(JSON.stringify(HIST));

type Api = typeof import('../api');
type VideoApi = typeof import('../api/video');

let api: Api;
let videoApi: VideoApi;
let calls: URL[];
let revokeMock: ReturnType<typeof vi.fn>;
let createObjectUrl: typeof URL.createObjectURL;
let revokeObjectUrl: typeof URL.revokeObjectURL;

function blobResponse(): Response {
  return {
    ok: true,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-histogram' ? HIST_HEADER : null,
    },
    blob: async () => new Blob(['x'], { type: 'image/jpeg' }),
  } as unknown as Response;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  calls.push(url);
  const p = url.pathname;
  if (
    p.endsWith('/images/thumbnail') ||
    p.endsWith('/images/view') ||
    p.endsWith('/videos/thumbnail') ||
    p.endsWith('/videos/frame')
  ) {
    return Promise.resolve(blobResponse());
  }
  if (p.endsWith('/images/histogram') || p.endsWith('/videos/histogram')) {
    return Promise.resolve(jsonResponse(HIST));
  }
  return Promise.reject(new Error(`unexpected fetch: ${url}`));
}

/** How many times ``endpoint`` was requested for ``path`` (optionally a frame). */
function callsFor(endpoint: string, path: string, frame?: number): number {
  return calls.filter((u) => {
    if (!u.pathname.endsWith(endpoint)) return false;
    if (u.searchParams.get('path') !== path) return false;
    return frame === undefined || u.searchParams.get('frame') === String(frame);
  }).length;
}

beforeEach(async () => {
  calls = [];
  createObjectUrl = URL.createObjectURL;
  revokeObjectUrl = URL.revokeObjectURL;
  let seq = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => `blob:mock/${++seq}`),
  });
  revokeMock = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeMock,
  });
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.resetModules();
  api = await import('../api');
  videoApi = await import('../api/video');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectUrl,
  });
});

describe('image thumbnail cache', () => {
  it('deduplicates requests and caps entries with LRU eviction', async () => {
    const first = '/data/A/0.jpg';
    await api.fetchThumbnailBlob(first);
    await api.fetchThumbnailBlob(first);
    expect(callsFor('/images/thumbnail', first)).toBe(1);

    for (let i = 1; i <= api.IMAGE_THUMB_CACHE_MAX; i++) {
      await api.fetchThumbnailBlob(`/data/A/${i}.jpg`);
    }
    // ``first`` was the least recently used entry, so the overflow dropped it.
    await api.fetchThumbnailBlob(first);
    expect(callsFor('/images/thumbnail', first)).toBe(2);
    expect(revokeMock).toHaveBeenCalled();
  });

  it('refreshes recency when an entry is accessed again', async () => {
    const a = '/data/A/a.jpg';
    const b = '/data/A/b.jpg';
    await api.fetchThumbnailBlob(a);
    await api.fetchThumbnailBlob(b);
    for (let i = 0; i < api.IMAGE_THUMB_CACHE_MAX - 2; i++) {
      await api.fetchThumbnailBlob(`/data/A/f${i}.jpg`);
    }

    // Touch ``a`` so ``b`` becomes the oldest entry, then overflow by one.
    await api.fetchThumbnailBlob(a);
    await api.fetchThumbnailBlob('/data/A/overflow.jpg');
    expect(revokeMock).toHaveBeenCalledTimes(1);

    await api.fetchThumbnailBlob(a);
    expect(callsFor('/images/thumbnail', a)).toBe(1);
    await api.fetchThumbnailBlob(b);
    expect(callsFor('/images/thumbnail', b)).toBe(2);
  });

  it('evicts by folder scope, keeping nested paths and histograms', async () => {
    const a = '/data/A/a.jpg';
    const aSub = '/data/A/sub/b.jpg';
    const sibling = '/data/AB/c.jpg';
    const b = '/data/B/d.jpg';
    for (const p of [a, aSub, sibling, b]) await api.fetchThumbnailBlob(p);

    api.evictThumbnailCacheForFolders(['/data/A']);
    expect(revokeMock).toHaveBeenCalledTimes(2);

    // Histograms follow their thumbnail: kept for A, refetched for B.
    await api.fetchHistogram(a);
    expect(callsFor('/images/histogram', a)).toBe(0);
    await api.fetchHistogram(b);
    expect(callsFor('/images/histogram', b)).toBe(1);

    await api.fetchThumbnailBlob(a);
    await api.fetchThumbnailBlob(aSub);
    expect(callsFor('/images/thumbnail', a)).toBe(1);
    expect(callsFor('/images/thumbnail', aSub)).toBe(1);
    // A sibling whose name only shares a prefix must not be kept.
    await api.fetchThumbnailBlob(sibling);
    expect(callsFor('/images/thumbnail', sibling)).toBe(2);
    await api.fetchThumbnailBlob(b);
    expect(callsFor('/images/thumbnail', b)).toBe(2);
  });

  it('supports Windows folder separators', async () => {
    const kept = 'C:\\data\\A\\x.jpg';
    const dropped = 'C:\\data\\B\\y.jpg';
    await api.fetchThumbnailBlob(kept);
    await api.fetchThumbnailBlob(dropped);

    api.evictThumbnailCacheForFolders(['C:\\data\\A']);

    await api.fetchThumbnailBlob(kept);
    expect(callsFor('/images/thumbnail', kept)).toBe(1);
    await api.fetchThumbnailBlob(dropped);
    expect(callsFor('/images/thumbnail', dropped)).toBe(2);
  });

  it('clears everything and revokes all blobs for an empty folder list', async () => {
    const a = '/data/A/a.jpg';
    const b = '/data/B/b.jpg';
    await api.fetchThumbnailBlob(a);
    await api.fetchThumbnailBlob(b);

    api.evictThumbnailCacheForFolders([]);

    expect(revokeMock).toHaveBeenCalledTimes(2);
    // Histograms that came from the cleared thumbnails are gone too.
    await api.fetchHistogram(a);
    expect(callsFor('/images/histogram', a)).toBe(1);

    await api.fetchThumbnailBlob(a);
    await api.fetchThumbnailBlob(b);
    expect(callsFor('/images/thumbnail', a)).toBe(2);
    expect(callsFor('/images/thumbnail', b)).toBe(2);
  });
});

describe('image histogram cache', () => {
  it('caps entries with LRU eviction', async () => {
    const first = '/data/A/hist.jpg';
    await api.fetchHistogram(first);
    for (let i = 1; i <= api.IMAGE_HISTOGRAM_CACHE_MAX; i++) {
      await api.fetchHistogram(`/data/A/h${i}.jpg`);
    }
    await api.fetchHistogram(first);
    expect(callsFor('/images/histogram', first)).toBe(2);
  });
});

describe('full-size image cache', () => {
  it('evicts blobs outside the remaining folders', async () => {
    const a = '/data/A/a.jpg';
    const b = '/data/B/b.jpg';
    await api.fetchImageBlob(a);
    await api.fetchImageBlob(b);

    api.evictImageCacheForFolders(['/data/A']);

    await api.fetchImageBlob(a);
    expect(callsFor('/images/view', a)).toBe(1);
    await api.fetchImageBlob(b);
    expect(callsFor('/images/view', b)).toBe(2);
    expect(revokeMock).toHaveBeenCalledTimes(1);
  });

  it('clears everything for an empty folder list', async () => {
    const a = '/data/A/a.jpg';
    await api.fetchImageBlob(a);
    api.evictImageCacheForFolders([]);
    expect(revokeMock).toHaveBeenCalledTimes(1);
    await api.fetchImageBlob(a);
    expect(callsFor('/images/view', a)).toBe(2);
  });
});

describe('video thumbnail cache', () => {
  it('caps entries with LRU eviction', async () => {
    const first = '/v/A/0.mp4';
    await videoApi.fetchVideoThumbnail(first);
    for (let i = 1; i <= videoApi.VIDEO_THUMB_CACHE_MAX; i++) {
      await videoApi.fetchVideoThumbnail(`/v/A/${i}.mp4`);
    }
    await videoApi.fetchVideoThumbnail(first);
    expect(callsFor('/videos/thumbnail', first)).toBe(2);
    expect(revokeMock).toHaveBeenCalled();
  });

  it('evicts by folder scope and clears all for an empty list', async () => {
    const a = '/v/A/a.mp4';
    const b = '/v/B/b.mp4';
    await videoApi.fetchVideoThumbnail(a);
    await videoApi.fetchVideoThumbnail(b);

    videoApi.evictVideoThumbnailCacheForFolders(['/v/A']);
    await videoApi.fetchVideoThumbnail(a);
    expect(callsFor('/videos/thumbnail', a)).toBe(1);
    await videoApi.fetchVideoThumbnail(b);
    expect(callsFor('/videos/thumbnail', b)).toBe(2);
    expect(revokeMock).toHaveBeenCalledTimes(1);

    videoApi.evictVideoThumbnailCacheForFolders([]);
    // ``b`` was already revoked above; the clear drops the remaining ``a`` too.
    expect(revokeMock).toHaveBeenCalledTimes(3);
    await videoApi.fetchVideoThumbnail(a);
    expect(callsFor('/videos/thumbnail', a)).toBe(2);
  });
});

describe('video frame histogram cache', () => {
  it('caps entries with LRU eviction', async () => {
    const video = '/v/A/a.mp4';
    await videoApi.fetchVideoFrameHistogram(video, 0);
    for (let f = 1; f <= videoApi.VIDEO_FRAME_HISTOGRAM_CACHE_MAX; f++) {
      await videoApi.fetchVideoFrameHistogram(video, f);
    }
    await videoApi.fetchVideoFrameHistogram(video, 0);
    expect(callsFor('/videos/histogram', video, 0)).toBe(2);
  });
});
