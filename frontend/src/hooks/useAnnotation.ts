import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAnnotationPath, saveAnnotations } from '../api';
import type { AnnotationApi, AnnotationEntry, AnnotationMedia } from '../types';
import { t } from '../i18n/store';

/** The compared paths stored in an entry (image or video). */
export function annotationPaths(entry: AnnotationEntry): string[] {
  return entry.image ?? entry.video ?? [];
}

/**
 * Build the list of navigable groups for the annotated/total progress. Each
 * group is the set of media paths (one per folder, window order) shown at that
 * navigation index; missing placeholders are skipped.
 */
export function buildPathGroups(
  folders: { path: string }[],
  lists: Map<string, { path: string; missing?: boolean }[]>,
): string[][] {
  const perFolder = folders.map((f) => lists.get(f.path) ?? []);
  let total = 0;
  for (const list of perFolder) total = Math.max(total, list.length);
  const groups: string[][] = [];
  for (let i = 0; i < total; i++) {
    const group: string[] = [];
    for (const list of perFolder) {
      if (list.length === 0) continue;
      const item = list[Math.min(i, list.length - 1)];
      if (item && !item.missing && item.path) group.push(item.path);
    }
    groups.push(group);
  }
  return groups;
}

function loadCommonTexts(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function persistCommonTexts(key: string, texts: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(texts));
  } catch {
    // ignore quota / private-mode errors
  }
}

interface UseAnnotationOptions {
  media: AnnotationMedia;
  /** Current group media paths in window order (empty placeholders skipped). */
  currentPaths: string[];
  /** All navigable groups' paths, computed lazily for the progress count. */
  getGroups: () => string[][];
  /** localStorage key for the mode's common texts. */
  commonTextsKey: string;
  /** Re-render the owning compare hook after the annotation state changes. */
  forceUpdate: () => void;
}

export interface UseAnnotationReturn {
  annotation: AnnotationApi | null;
  enter: (outputPath: string, entries: AnnotationEntry[]) => void;
  exit: () => void;
}

/**
 * Shared annotation runtime for image and video modes. It owns the question /
 * result buffers, the loaded entries, and the common-text list, and exposes an
 * {@link AnnotationApi} for the panel.
 */
export function useAnnotation({
  media,
  currentPaths,
  getGroups,
  commonTextsKey,
  forceUpdate,
}: UseAnnotationOptions): UseAnnotationReturn {
  const ref = useRef<{ outputPath: string; entries: AnnotationEntry[] } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [question, setQuestionState] = useState('');
  const [result, setResultState] = useState('');
  const [commonTexts, setCommonTexts] = useState<string[]>(() =>
    loadCommonTexts(commonTextsKey),
  );

  const currentPathsRef = useRef(currentPaths);
  currentPathsRef.current = currentPaths;
  const currentKey = currentPaths.join('|');

  // Switching to a group shows its annotation; an unannotated group clears the
  // result box but keeps the (session-level) question text.
  useEffect(() => {
    const rt = ref.current;
    if (!rt) return;
    const entry = [...rt.entries]
      .reverse()
      .find((e) => annotationPaths(e).join('|') === currentKey);
    if (entry) {
      setQuestionState(entry.question ?? '');
      setResultState(entry.answer ?? '');
    } else {
      setResultState('');
    }
  }, [currentKey, enabled]);

  const addCommonText = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setCommonTexts((prev) => {
        if (prev.includes(text)) return prev;
        const next = [...prev, text];
        persistCommonTexts(commonTextsKey, next);
        return next;
      });
    },
    [commonTextsKey],
  );

  const removeCommonText = useCallback(
    (text: string) => {
      setCommonTexts((prev) => {
        const next = prev.filter((x) => x !== text);
        persistCommonTexts(commonTextsKey, next);
        return next;
      });
    },
    [commonTextsKey],
  );

  const submit = useCallback(async () => {
    const rt = ref.current;
    if (!rt) return;
    const paths = currentPathsRef.current;
    if (paths.length === 0) return;
    if (!question.trim()) {
      alert(t('annotation.alert.questionRequired'));
      return;
    }
    if (!result.trim()) {
      alert(t('annotation.alert.resultRequired'));
      return;
    }
    try {
      const check = await checkAnnotationPath(rt.outputPath, media);
      if (!check.writable) {
        alert(t('annotation.alert.pathNotWritable'));
        return;
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : t('annotation.alert.pathFailed'));
      return;
    }
    const payload: AnnotationEntry =
      media === 'video'
        ? { video: paths, question, answer: result }
        : { image: paths, question, answer: result };
    try {
      rt.entries = await saveAnnotations(rt.outputPath, [payload], media);
      forceUpdate();
    } catch (e) {
      alert(e instanceof Error ? e.message : t('annotation.alert.saveFailed'));
    }
  }, [media, question, result, forceUpdate]);

  const enter = useCallback(
    (outputPath: string, entries: AnnotationEntry[]) => {
      ref.current = { outputPath, entries };
      setQuestionState('');
      setResultState('');
      setEnabled(true);
      forceUpdate();
    },
    [forceUpdate],
  );

  const exit = useCallback(() => {
    ref.current = null;
    setEnabled(false);
    forceUpdate();
  }, [forceUpdate]);

  const runtime = ref.current;
  let annotation: AnnotationApi | null = null;
  if (runtime) {
    const entryKeys = new Set(runtime.entries.map((e) => annotationPaths(e).join('|')));
    const groups = getGroups();
    let annotatedCount = 0;
    for (const group of groups) {
      if (group.length > 0 && entryKeys.has(group.join('|'))) annotatedCount++;
    }
    annotation = {
      media,
      outputPath: runtime.outputPath,
      total: groups.length,
      annotatedCount,
      isAnnotated: currentKey !== '' && entryKeys.has(currentKey),
      question,
      setQuestion: setQuestionState,
      result,
      setResult: setResultState,
      commonTexts,
      addCommonText,
      removeCommonText,
      submit,
    };
  }

  return { annotation, enter, exit };
}
