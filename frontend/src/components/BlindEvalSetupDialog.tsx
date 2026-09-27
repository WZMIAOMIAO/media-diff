import { useMemo, useState } from 'react';
import { setupBlindEval, type FileEntry } from '../api';
import type { BlindSetupResult, SelectedFolder } from '../types';
import BrowseFolderDialog from './BrowseFolderDialog';

interface BlindEvalSetupDialogProps {
  folders: SelectedFolder[];
  imagesPerFolder: Map<string, FileEntry[]>;
  onEnter: (result: BlindSetupResult) => void;
  onClose: () => void;
}

function intersectionCount(folders: SelectedFolder[], imagesPerFolder: Map<string, FileEntry[]>): number {
  if (folders.length < 2) return 0;
  let common: Set<string> | null = null;
  for (const f of folders) {
    const names = new Set((imagesPerFolder.get(f.path) ?? []).map((i) => i.name));
    if (common === null) {
      common = names;
    } else {
      for (const n of [...common]) {
        if (!names.has(n)) common.delete(n);
      }
    }
  }
  return common ? common.size : 0;
}

function BlindEvalSetupDialog({ folders, imagesPerFolder, onEnter, onClose }: BlindEvalSetupDialogProps) {
  const [totalParts, setTotalParts] = useState('1');
  const [currentPart, setCurrentPart] = useState('1');
  const [seed, setSeed] = useState('1234');
  const [outputPath, setOutputPath] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const total = useMemo(
    () => intersectionCount(folders, imagesPerFolder),
    [folders, imagesPerFolder],
  );

  const runSetup = async (loadExisting: boolean) => {
    setLoading(true);
    try {
      const result = await setupBlindEval({
        paths: folders.map((f) => f.path),
        total_parts: Number(totalParts),
        current_part: Number(currentPart),
        seed: Number(seed),
        output_path: outputPath.trim(),
        load_existing: loadExisting,
      });
      if (result.existing_file_matched && !loadExisting) {
        const load = window.confirm(
          '输出文件已存在且与当前对比项匹配，是否加载已有的盲评数据？\n点"取消"将退回设置窗口。',
        );
        if (!load) return;
        await runSetup(true);
        return;
      }
      onEnter(result);
    } catch (e) {
      alert(e instanceof Error ? e.message : '进入盲评模式失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (!outputPath.trim()) {
      alert('请填写输出文件路径');
      return;
    }
    const parts = Number(totalParts);
    const part = Number(currentPart);
    if (!Number.isInteger(parts) || parts < 1) {
      alert('划分份数至少为1');
      return;
    }
    if (!Number.isInteger(part) || part < 1 || part > parts) {
      alert('当前评测份数需在 1 到总份数之间');
      return;
    }
    if (parts > total) {
      alert(`划分份数不能大于图片总数（当前共 ${total} 张）`);
      return;
    }
    void runSetup(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[460px] flex flex-col bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="px-3 py-2 text-sm text-[#e0e0e0] border-b border-[#3c3c3c]">
          盲评参数设置（共有同名图片 {total} 张）
        </div>

        <div className="p-3 flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[#c0c0c0]">划分份数</span>
            <input
              type="number"
              min={1}
              value={totalParts}
              onChange={(e) => setTotalParts(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] focus:outline-none focus:border-[#555555]"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[#c0c0c0]">当前第几份</span>
            <input
              type="number"
              min={1}
              value={currentPart}
              onChange={(e) => setCurrentPart(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] focus:outline-none focus:border-[#555555]"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[#c0c0c0]">随机种子</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] focus:outline-none focus:border-[#555555]"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[#c0c0c0]">输出文件路径</span>
            <input
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              placeholder="目录或 .json 文件路径"
              className="flex-1 min-w-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] placeholder:text-[#888888] focus:outline-none focus:border-[#555555]"
            />
            <button
              type="button"
              onClick={() => setBrowseOpen(true)}
              className="shrink-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
            >
              浏览
            </button>
          </label>
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
            onClick={handleSubmit}
            disabled={loading}
            className="px-3 py-1 text-sm bg-[#ff8c00] border border-[#ff8c00] rounded text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? '处理中...' : '进入盲评'}
          </button>
        </div>
      </div>

      {browseOpen && (
        <BrowseFolderDialog
          includeJson
          defaultPath={folders[0]?.path}
          onSelect={(path) => {
            setOutputPath(path);
            setBrowseOpen(false);
          }}
          onClose={() => setBrowseOpen(false)}
        />
      )}
    </div>
  );
}

export default BlindEvalSetupDialog;
