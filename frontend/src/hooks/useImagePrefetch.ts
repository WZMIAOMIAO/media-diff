import { useEffect } from 'react';
import { evictImageCache, fetchImageBlob } from '../api';
import type { UseImageCompareReturn } from './useImageCompare';

const PREFETCH_RANGE = 3;

// 监听每文件夹 currentIndices 变化，预取各列当前图片前后各 PREFETCH_RANGE 张，
// 并通过 evictImageCache 淘汰范围外的缓存条目。
export function useImagePrefetch(compare: UseImageCompareReturn): void {
  const { filteredImages, selectedFolders, currentIndices } = compare;

  const indicesKey = selectedFolders
    .map((f) => `${f.path}:${currentIndices.get(f.path) ?? 0}`)
    .join('|');

  useEffect(() => {
    if (selectedFolders.length === 0) return;
    const toFetch = new Set<string>();
    for (const folder of selectedFolders) {
      const list = filteredImages.get(folder.path);
      if (!list || list.length === 0) continue;
      const idx = currentIndices.get(folder.path) ?? 0;
      const start = Math.max(0, idx - PREFETCH_RANGE);
      const end = Math.min(list.length, idx + PREFETCH_RANGE + 1);
      for (let i = start; i < end; i++) {
        toFetch.add(list[i].path);
      }
    }
    if (toFetch.size === 0) return;
    for (const p of toFetch) {
      void fetchImageBlob(p).catch(() => {});
    }
    evictImageCache(toFetch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicesKey, filteredImages, selectedFolders]);
}
