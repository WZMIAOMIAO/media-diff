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
  outline: true,
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

  /**
   * Move the text stored at window index ``from`` to ``to``, shifting the
   * in-between entries the same way the folder order is moved. Keeps the
   * watermark text attached to its folder when the compare columns/windows are
   * reordered.
   */
  const reorder = useCallback((from: number, to: number) => {
    if (from === to) return;
    setTextsState((prev) => {
      const next: Record<number, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        const k = Number(key);
        let nk = k;
        if (k === from) nk = to;
        else if (from < to && k > from && k <= to) nk = k - 1;
        else if (from > to && k >= to && k < from) nk = k + 1;
        next[nk] = value;
      }
      return next;
    });
  }, []);

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
      map[index] = {
        text,
        color: style.color,
        fontSize: style.fontSize,
        outline: style.outline,
      };
    }
    return map;
  }, [texts, style]);

  return { style, setStyle, texts, setText, clearTexts, fillFolderNames, reorder, configs };
}
