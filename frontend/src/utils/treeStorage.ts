// Persistence of the folder-tree root paths in localStorage.
//
// Only the root paths are stored (not the expanded state or children), so the
// tree can be restored collapsed without any backend request. Each mode keeps
// its own key so image and video trees stay independent.

const VERSION = 1;

interface StoredRoots {
  v: number;
  roots: string[];
}

export function loadTreeRoots(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredRoots;
    if (!parsed || parsed.v !== VERSION || !Array.isArray(parsed.roots)) {
      return [];
    }
    return parsed.roots.filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
  } catch {
    return [];
  }
}

export function saveTreeRoots(key: string, roots: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: VERSION, roots }));
  } catch {
    // ignore quota / private-mode errors
  }
}

export const IMAGE_TREE_KEY = 'media-diff:tree:image';
export const VIDEO_TREE_KEY = 'media-diff:tree:video';
