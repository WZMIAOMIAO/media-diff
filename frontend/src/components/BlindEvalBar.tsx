import type { BlindEvalApi } from '../types';
import { useI18n } from '../i18n';

interface BlindEvalBarProps {
  blind: BlindEvalApi;
  onInfo: () => void;
  onResult: () => void;
}

function BlindEvalBar({ blind, onInfo, onResult }: BlindEvalBarProps) {
  const { t } = useI18n();
  const percent = blind.total > 0 ? (blind.votedCount / blind.total) * 100 : 0;

  return (
    <div className="h-12 shrink-0 flex items-center gap-4 px-3 bg-[#252525] border-t border-[#3c3c3c]">
      <span className="shrink-0 text-sm text-[#ff8c00]">{t('blind.bar')}</span>
      <div className="flex items-center gap-2 min-w-0 flex-1 max-w-md">
        <div className="relative flex-1 h-2 min-w-0 rounded-full bg-[#3c3c3c] overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#ff8c00] transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-[#888888]">
          {blind.votedCount}/{blind.total}
        </span>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onInfo}
        className="px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
      >
        {t('blind.info')}
      </button>
      <button
        type="button"
        onClick={onResult}
        className="px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
      >
        {t('blind.result')}
      </button>
    </div>
  );
}

export default BlindEvalBar;
