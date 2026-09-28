import { useCallback, useMemo, useState } from 'react';
import type { SelectedFolder, WatermarkConfig } from '../types';
import {
  loadWatermarkStyle,
  saveWatermarkStyle,
  type WatermarkStyle,
} from '../utils/watermarkStorage';

export const DEFAULT_WATERMARK_STYLE: WatermarkStyle = {
  color: '#ff0000',
  fontSize: 24,
};

/**
 * Watermark state. Color and font size are a single global style shared by all
 * windows (persisted per mode); each window only owns its text.
 */
export function useWatermark(storageKey: string) {
  const [style, setStyleState] = useState<WatermarkStyle>(
    () => loadWatermarkStyle(storageKey) ?? DEFAULT_WATERMARK_STYLE,
  );
  const [texts, setTextsState] = useState<Record<number, string>>({});

  const setStyle = useCallback(
    (patch: Partial<WatermarkStyle>) => {
      setStyleState((prev) => {
        const next = { ...prev, ...patch };
        saveWatermarkStyle(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const setText = useCallback((index: number, text: string) => {
    setTextsState((prev) => ({ ...prev, [index]: text }));
  }, []);

  const clearTexts = useCallback(() => setTextsState({}), []);

  const fillFolderNames = useCallback((folders: SelectedFolder[]) => {
    const next: Record<number, string> = {};
    folders.forEach((folder, i) => {
      next[i] = folder.name;
    });
    setTextsState(next);
  }, []);

  // Merge the global style into each window that has text, for the compare area.
  const configs = useMemo(() => {
    const map: Record<number, WatermarkConfig> = {};
    for (const [key, text] of Object.entries(texts)) {
      const index = Number(key);
      map[index] = { text, color: style.color, fontSize: style.fontSize };
    }
    return map;
  }, [texts, style]);

  return { style, setStyle, texts, setText, clearTexts, fillFolderNames, configs };
}
