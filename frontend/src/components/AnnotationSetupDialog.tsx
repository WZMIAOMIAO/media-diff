import { useState } from 'react';
import { checkAnnotationPath, loadAnnotations } from '../api';
import type { AnnotationEntry, AnnotationMedia, SelectedFolder } from '../types';
import BrowseFolderDialog from './BrowseFolderDialog';
import { useI18n } from '../i18n';

interface AnnotationSetupDialogProps {
  folders: SelectedFolder[];
  media?: AnnotationMedia;
  onEnter: (outputPath: string, entries: AnnotationEntry[]) => void;
  onClose: () => void;
}

const DEFAULT_FILENAMES: Record<AnnotationMedia, string> = {
  image: 'annotation_results.json',
  video: 'video_annotation_results.json',
};

/** Show the final JSON file path: append the default name when a folder is chosen. */
function resolveDisplayPath(raw: string, filename: string): string {
  const path = raw.trim();
  if (!path) return path;
  const withoutSep = path.replace(/[/\\]+$/, '');
  if (withoutSep.toLowerCase().endsWith('.json')) return withoutSep;
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  if (!withoutSep) return `${sep}${filename}`;
  return `${withoutSep}${sep}${filename}`;
}

function AnnotationSetupDialog({
  folders,
  media = 'image',
  onEnter,
  onClose,
}: AnnotationSetupDialogProps) {
  const { t } = useI18n();
  const [outputPath, setOutputPath] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const defaultFilename = DEFAULT_FILENAMES[media];

  const handleSubmit = async () => {
    const raw = outputPath.trim();
    if (!raw) {
      alert(t('annotation.alert.outputRequired'));
      return;
    }
    const resolved = resolveDisplayPath(raw, defaultFilename);
    setLoading(true);
    try {
      const check = await checkAnnotationPath(resolved, media);
      if (!check.writable) {
        alert(t('annotation.alert.pathNotWritable'));
        return;
      }
      let entries: AnnotationEntry[] = [];
      if (check.exists) {
        if (!window.confirm(t('annotation.confirm.loadExisting'))) return;
        entries = await loadAnnotations(check.path, media);
      }
      onEnter(check.path, entries);
    } catch (e) {
      alert(e instanceof Error ? e.message : t('annotation.alert.pathFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[460px] flex flex-col bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="px-3 py-2 text-sm text-[#e0e0e0] border-b border-[#3c3c3c]">
          {t('annotation.setupTitle')}
        </div>

        <div className="p-3 flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-32 shrink-0 whitespace-nowrap text-[#c0c0c0]">
              {t('annotation.outputPath')}
            </span>
            <input
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              onBlur={() => setOutputPath((v) => (v.trim() ? resolveDisplayPath(v, defaultFilename) : v))}
              placeholder={t('annotation.outputPlaceholder')}
              title={outputPath || undefined}
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
            onClick={() => void handleSubmit()}
            disabled={loading}
            className="px-3 py-1 text-sm bg-[#4a9eff] border border-[#4a9eff] rounded text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? t('blind.processing') : t('annotation.enter')}
          </button>
        </div>
      </div>

      {browseOpen && (
        <BrowseFolderDialog
          includeJson
          defaultPath={folders[0]?.path}
          onSelect={(path) => {
            setOutputPath(resolveDisplayPath(path, defaultFilename));
            setBrowseOpen(false);
          }}
          onClose={() => setBrowseOpen(false)}
        />
      )}
    </div>
  );
}

export default AnnotationSetupDialog;
