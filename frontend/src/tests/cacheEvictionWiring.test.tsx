import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageCompare } from '../hooks/useImageCompare';
import { useVideoCompare } from '../hooks/video/useVideoCompare';

const spies = vi.hoisted(() => ({
  imageForFolders: vi.fn(),
  thumbForFolders: vi.fn(),
  videoThumbForFolders: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    listImages: vi.fn(async () => ({ images: [] })),
    evictImageCacheForFolders: (folders: string[]) =>
      spies.imageForFolders(folders),
    evictThumbnailCacheForFolders: (folders: string[]) =>
      spies.thumbForFolders(folders),
  };
});

vi.mock('../api/video', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/video')>();
  return {
    ...actual,
    listVideos: vi.fn(async () => ({ videos: [] })),
    evictVideoThumbnailCacheForFolders: (folders: string[]) =>
      spies.videoThumbForFolders(folders),
  };
});

describe('cache eviction wiring', () => {
  beforeEach(() => {
    spies.imageForFolders.mockClear();
    spies.thumbForFolders.mockClear();
    spies.videoThumbForFolders.mockClear();
  });

  it('clears both image caches when all folders are cleared', () => {
    const { result } = renderHook(() => useImageCompare());
    act(() => result.current.clearFolders());

    expect(spies.imageForFolders).toHaveBeenCalledWith([]);
    expect(spies.thumbForFolders).toHaveBeenCalledWith([]);
  });

  it('keeps only the remaining folders when one image folder is removed', async () => {
    const { result } = renderHook(() => useImageCompare());
    await act(async () => {
      await result.current.addFolder('/data/A');
    });
    await act(async () => {
      await result.current.addFolder('/data/B');
    });
    spies.imageForFolders.mockClear();
    spies.thumbForFolders.mockClear();

    act(() => result.current.removeFolder('/data/A'));

    expect(spies.imageForFolders).toHaveBeenCalledWith(['/data/B']);
    expect(spies.thumbForFolders).toHaveBeenCalledWith(['/data/B']);
  });

  it('scopes video thumbnail eviction and clears on clearFolders', async () => {
    const { result } = renderHook(() => useVideoCompare());
    await act(async () => {
      await result.current.addFolder('/v/A');
    });
    await act(async () => {
      await result.current.addFolder('/v/B');
    });
    spies.videoThumbForFolders.mockClear();

    act(() => result.current.removeFolder('/v/A'));
    expect(spies.videoThumbForFolders).toHaveBeenCalledWith(['/v/B']);

    act(() => result.current.clearFolders());
    expect(spies.videoThumbForFolders).toHaveBeenLastCalledWith([]);
  });
});
