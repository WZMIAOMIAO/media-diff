import { useMemo, useState } from 'react';
import { setupBlindEval } from '../api';
import type { BlindMedia, BlindSetupResult, SelectedFolder } from '../types';
import BrowseFolderDialog from './BrowseFolderDialog';
import { useI18n } from '../i18n';

interface BlindEvalSetupDialogProps {
  folders: SelectedFolder[];
  filesPerFolder: Map<string, { name: string }[]>;
  media: BlindMedia;
  onEnter: (result: BlindSetupResult) => void;
  onClose: () => void;
}

function intersectionCount(folders: SelectedFolder[], filesPerFolder: Map<string, { name: string }[]>): number {
  if (folders.length < 2) return 0;
  let common: Set<string> | null = null;
  for (const f of folders) {
    const names = new Set((filesPerFolder.get(f.path) ?? []).map((i) => i.name));
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

function BlindEvalSetupDialog({ folders, filesPerFolder, media, onEnter, onClose }: BlindEvalSetupDialogProps) {
  const { t } = useI18n();
  const [totalParts, setTotalParts] = useState('1');
  const [currentPart, setCurrentPart] = useState('1');
  const [seed, setSeed] = useState('1234');
  const [outputPath, setOutputPath] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const total = useMemo(
    () => intersectionCount(folders, filesPerFolder),
    [folders, filesPerFolder],
  );
  const noun = t(media === 'video' ? 'media.video' : 'media.image');

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
        media,
      });
      if (result.existing_file_matched && !loadExisting) {
        const load = window.confirm(
          t('blind.confirm.loadExisting'),
        );
        if (!load) return;
        await runSetup(true);
        return;
      }
      onEnter(result);
    } catch (e) {
      alert(e instanceof Error ? e.message : t('blind.alert.enterFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (!outputPath.trim()) {
      alert(t('blind.alert.outputRequired'));
      return;
    }
    const parts = Number(totalParts);
    const part = Number(currentPart);
    if (!Number.isInteger(parts) || parts < 1) {
      alert(t('blind.alert.partsMin'));
      return;
    }
    if (!Number.isInteger(part) || part < 1 || part > parts) {
      alert(t('blind.alert.partRange'));
      return;
    }
    if (parts > total) {
      alert(t('blind.alert.partsTooMany', { noun, total }));
      return;
    }
    void runSetup(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[460px] flex flex-col bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="px-3 py-2 text-sm text-[#e0e0e0] border-b border-[#3c3c3c]">
          {t('blind.setupTitle', { noun, total })}
        </div>

        <div className="p-3 flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-32 shrink-0 whitespace-nowrap text-[#c0c0c0]">{t('blind.parts')}</span>
            <input
              type="number"
              min={1}
              value={totalParts}
              onChange={(e) => setTotalParts(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] focus:outline-none focus:border-[#555555]"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-32 shrink-0 whitespace-nowrap text-[#c0c0c0]">{t('blind.currentPart')}</span>
            <input
              type="number"
              min={1}
              value={currentPart}
              onChange={(e) => setCurrentPart(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] focus:outline-none focus:border-[#555555]"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-32 shrink-0 whitespace-nowrap text-[#c0c0c0]">{t('blind.seed')}</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] focus:outline-none focus:border-[#555555]"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-32 shrink-0 whitespace-nowrap text-[#c0c0c0]">{t('blind.outputPath')}</span>
            <input
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              placeholder={t('blind.outputPlaceholder')}
              className="flex-1 min-w-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] placeholder:text-[#888888] focus:outline-none focus:border-[#555555]"
            />
            <button
              type="button"
              onClick={() => setBrowseOpen(true)}
              className="shrink-0 px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
            >
              {t('common.browse')}
            </button>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 p-2 border-t border-[#3c3c3c]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="px-3 py-1 text-sm bg-[#ff8c00] border border-[#ff8c00] rounded text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? t('blind.processing') : t('blind.enter')}
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
