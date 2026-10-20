import { useEffect, useState, useSyncExternalStore } from 'react';
import { useI18n } from '../i18n';
import {
  cancelDownload,
  closeDownload,
  getDownloadState,
  subscribeDownload,
} from '../utils/download';

// Packing is usually near-instant (the zip stores media verbatim), so only show
// the progress dialog if it actually takes a noticeable amount of time. This
// avoids a full-screen flash for fast folder downloads while still keeping the
// user informed (and able to cancel) for slow ones.
const SHOW_DELAY_MS = 300;

function DownloadProgress() {
  const { t } = useI18n();
  const state = useSyncExternalStore(subscribeDownload, getDownloadState);
  const active = state.status === 'preparing' || state.status === 'running';
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    if (!active) {
      setShowProgress(false);
      return;
    }
    const timer = window.setTimeout(() => setShowProgress(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (state.status === 'idle') return null;
  if (active && !showProgress) return null;

  const percent = Math.round((state.progress ?? 0) * 100);

  const handleClose = () => {
    if (active) {
      if (!window.confirm(t('download.closeConfirm'))) return;
      void cancelDownload();
    }
    closeDownload();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-[440px] flex flex-col bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="px-3 py-2 text-sm text-[#e0e0e0] border-b border-[#3c3c3c]">
          {t('download.title')}
        </div>

        <div className="p-3 flex flex-col gap-2 text-sm text-[#e0e0e0]">
          {state.status === 'error' ? (
            <div className="text-[#ef4444]">{state.errorText}</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="truncate" title={state.filename}>
                  {state.status === 'cancelled'
                    ? t('download.cancelled')
                    : state.status === 'preparing'
                      ? t('download.compressing')
                      : t('download.compressingName', {
                          name: state.filename,
                        })}
                </span>
                <span className="text-[#888888]">{percent}%</span>
              </div>
              <div className="h-2 rounded bg-[#3c3c3c] overflow-hidden">
                <div
                  className="h-full bg-[#4a9eff] transition-[width] duration-150"
                  style={{ width: `${percent}%` }}
                />
              </div>
              {state.total > 0 && (
                <div className="text-xs text-[#888888]">
                  {t('download.entries', {
                    done: state.done,
                    total: state.total,
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-2 border-t border-[#3c3c3c]">
          {active && (
            <button
              type="button"
              onClick={() => void cancelDownload()}
              className="px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DownloadProgress;
