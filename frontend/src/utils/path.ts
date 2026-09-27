export interface PathRoot {
  path: string;
}

function getPathName(path: string): string {
  if (!path) return '';
  if (path === '/') return '/';
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed || trimmed === '/') return '/';
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx === -1) return trimmed;
  return trimmed.substring(idx + 1);
}

/**
 * Return ``fullPath`` relative to the longest matching tree root, keeping the
 * root directory name as the first path segment.
 *
 * e.g. root ``/data/dataset`` + path ``/data/dataset/cat/1.png`` ->
 * ``dataset/cat/1.png``. The original path separators are preserved. Volume
 * roots (``/`` or a Windows drive root) have no folder name to prepend, so the
 * path below them is returned as-is.
 */
export function getRelativePath(fullPath: string, roots: PathRoot[]): string {
  let best: string | null = null;
  for (const r of roots) {
    const root = r.path.replace(/[/\\]+$/, '') || r.path;
    const prefix = root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`;
    const prefixAlt = `${root}\\`;
    const matches =
      fullPath === root ||
      fullPath.startsWith(prefix) ||
      fullPath.startsWith(prefixAlt);
    if (matches && (best === null || root.length > best.length)) {
      best = root;
    }
  }
  if (best === null) return fullPath;

  if (best === '/' || /^[a-zA-Z]:$/.test(best)) {
    const rel = fullPath.slice(best.length).replace(/^[/\\]+/, '');
    return rel || fullPath;
  }

  const rootName = getPathName(best);
  const suffix =
    fullPath === best ? '' : fullPath.slice(best.length).replace(/^[/\\]+/, '');
  if (!suffix) return rootName;
  const sep = fullPath.includes('\\') ? '\\' : '/';
  return `${rootName}${sep}${suffix}`;
}
