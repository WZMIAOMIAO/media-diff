import { useEffect, useState } from 'react';
import BrowseFolderDialog from '../BrowseFolderDialog';
import { getDefaultBrowsePath } from '../../api';
import type { AddRootResult } from '../../types/video';
import { useI18n } from '../../i18n';

interface VideoFolderInputProps {
  onAddRoot: (path: string) => Promise<AddRootResult>;
}

function VideoFolderInput({ onAddRoot }: VideoFolderInputProps) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultPath, setDefaultPath] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getDefaultBrowsePath()
      .then((p) => {
        if (!cancelled) setDefaultPath(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const addPath = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const result = await onAddRoot(trimmed);
    if (result === 'not_exist') {
      alert(t('folderInput.notExist'));
    } else if (result === 'exists') {
      alert(t('folderInput.exists'));
    } else {
      setValue('');
    }
  };

  const submit = () => void addPath(value);

  return (
    <div className="p-2 border-b border-[#3c3c3c]">
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder={t('folderInput.placeholder')}
          className="flex-1 min-w-0 px-2 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] placeholder:text-[#888888] focus:outline-none focus:border-[#555555]"
        />
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          title={t('folderInput.browse')}
          className="shrink-0 px-2 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
        >
          📁
        </button>
      </div>
      {dialogOpen && (
        <BrowseFolderDialog
          defaultPath={defaultPath}
          onClose={() => setDialogOpen(false)}
          onSelect={async (path) => {
            setDialogOpen(false);
            await addPath(path);
          }}
        />
      )}
    </div>
  );
}

export default VideoFolderInput;
