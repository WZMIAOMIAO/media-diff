import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { browseFolder, getRoots, type FileEntry, type SubDir } from '../api';

interface BrowseFolderDialogProps {
  onClose: () => void;
  onSelect: (path: string) => void;
  includeJson?: boolean;
  /** Initial directory to open. Falls back to the first OS root when absent. */
  defaultPath?: string;
}

function isWindowsDriveRoot(path: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(path);
}

function getParentPath(path: string): string {
  if (!path) return path;
  if (path === '/') return '/';
  if (isWindowsDriveRoot(path)) return path;
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed) return path;
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) return trimmed;
  if (idx === 0) return '/';
  return trimmed.substring(0, idx);
}

function BrowseFolderDialog({
  onClose,
  onSelect,
  includeJson = false,
  defaultPath,
}: BrowseFolderDialogProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [inputPath, setInputPath] = useState('');
  const [subdirs, setSubdirs] = useState<SubDir[]>([]);
  const [jsonFiles, setJsonFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const navigateTo = useCallback(
    async (path: string) => {
      setLoading(true);
      setError('');
      try {
        const result = await browseFolder(path, includeJson);
        setCurrentPath(result.path);
        setInputPath(result.path);
        setSubdirs(result.subdirs);
        setJsonFiles(result.json_files ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : '浏览失败');
        setSubdirs([]);
        setJsonFiles([]);
      } finally {
        setLoading(false);
      }
    },
    [includeJson],
  );

  const defaultPathRef = useRef(defaultPath);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const preferred = defaultPathRef.current;
      if (preferred) {
        await navigateTo(preferred);
        return;
      }
      try {
        const { roots } = await getRoots();
        if (cancelled || roots.length === 0) return;
        await navigateTo(roots[0]);
      } catch {
        if (!cancelled) setError('获取根目录失败');
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [navigateTo]);

  const atTop = !currentPath || currentPath === '/' || isWindowsDriveRoot(currentPath);

  const goUp = () => {
    const parent = getParentPath(currentPath);
    if (parent !== currentPath) void navigateTo(parent);
  };

  const onInputEnter = () => {
    const trimmed = inputPath.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const matches = subdirs.filter((s) =>
      s.name.toLowerCase().includes(lower),
    );
    if (matches.length === 1) {
      void navigateTo(matches[0].path);
    } else if (matches.length > 1) {
      setSubdirs(matches);
    } else {
      void navigateTo(trimmed);
    }
  };

  const selectFolder = async () => {
    const trimmed = inputPath.trim();
    if (!trimmed) {
      if (currentPath) onSelect(currentPath);
      return;
    }
    if (trimmed === currentPath) {
      onSelect(currentPath);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await browseFolder(trimmed, includeJson);
      setCurrentPath(result.path);
      setInputPath(result.path);
      setSubdirs(result.subdirs);
      onSelect(result.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : '浏览失败');
      setSubdirs([]);
      setJsonFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e: ReactMouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-[560px] h-[420px] flex flex-col bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="flex items-center gap-2 p-2 border-b border-[#3c3c3c]">
          <button
            type="button"
            onClick={goUp}
            disabled={atTop}
            title="返回上级"
            className="px-2 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ←
          </button>
          <input
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onInputEnter();
            }}
            placeholder="输入路径或关键词后回车..."
            className="flex-1 min-w-0 px-2 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] placeholder:text-[#888888] focus:outline-none focus:border-[#555555]"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-1">
          {loading && (
            <div className="px-2 py-2 text-sm text-[#888888]">加载中...</div>
          )}
          {error && (
            <div className="px-2 py-2 text-sm text-[#ef4444]">{error}</div>
          )}
          {!loading && !error && subdirs.length === 0 && jsonFiles.length === 0 && (
            <div className="px-2 py-2 text-sm text-[#888888]">无子目录</div>
          )}
          {!loading &&
            !error &&
            subdirs.map((s) => (
              <div
                key={s.path}
                onClick={() => void navigateTo(s.path)}
                title={s.path}
                className="flex items-center gap-2 px-2 py-1.5 text-sm text-[#e0e0e0] hover:bg-[#3c3c3c] cursor-pointer rounded"
              >
                <span>📁</span>
                <span className="truncate">{s.name}</span>
              </div>
            ))}
          {!loading &&
            !error &&
            jsonFiles.map((f) => (
              <div
                key={f.path}
                onClick={() => onSelect(f.path)}
                title={f.path}
                className="flex items-center gap-2 px-2 py-1.5 text-sm text-[#ff8c00] hover:bg-[#3c3c3c] cursor-pointer rounded"
              >
                <span>📄</span>
                <span className="truncate">{f.name}</span>
              </div>
            ))}
        </div>

        <div className="flex items-center justify-end gap-2 p-2 border-t border-[#3c3c3c]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={selectFolder}
            disabled={!currentPath}
            className="px-3 py-1 text-sm bg-[#4a9eff] border border-[#4a9eff] rounded text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            选择此文件夹
          </button>
        </div>
      </div>
    </div>
  );
}

export default BrowseFolderDialog;
