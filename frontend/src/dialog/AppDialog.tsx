import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useI18n } from '../i18n';
import { closeDialog, getCurrentDialog, subscribeDialog } from './store';

function AppDialog() {
  const { t } = useI18n();
  const request = useSyncExternalStore(subscribeDialog, getCurrentDialog);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    okRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeDialog(false);
      } else if (e.key === 'Enter') {
        // Let a focused button handle Enter (so Tab-to-Cancel still cancels).
        if (document.activeElement instanceof HTMLButtonElement) return;
        e.preventDefault();
        e.stopPropagation();
        closeDialog(true);
      } else if (e.key !== 'Tab') {
        // Keep global page shortcuts (space/arrows/etc.) from firing behind the
        // modal while it is open.
        e.stopPropagation();
        if (e.key === ' ') e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [request]);

  if (!request) return null;

  const confirm = request.kind === 'confirm';
  const title =
    request.title ??
    (confirm ? t('dialog.confirmTitle') : t('dialog.notice'));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-message"
        className="w-[460px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-[#3c3c3c] bg-[#2b2b2b] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4">
          <h2
            id="app-dialog-title"
            className="min-w-0 pt-0.5 text-[15px] font-semibold leading-6 text-[#f0f0f0]"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={() => closeDialog(false)}
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#888888] hover:bg-[#3a3a3a] hover:text-[#e0e0e0]"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div
          id="app-dialog-message"
          className="max-h-[55vh] overflow-auto whitespace-pre-wrap px-5 pb-5 text-sm leading-6 text-[#c8c8c8]"
        >
          {request.message}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#3c3c3c] bg-[#272727] px-5 py-3">
          {confirm && (
            <button
              type="button"
              onClick={() => closeDialog(false)}
              className="h-8 min-w-[80px] rounded-md border border-[#3c3c3c] bg-[#333333] px-4 text-sm text-[#c0c0c0] hover:border-[#555555] hover:text-[#e0e0e0]"
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => closeDialog(true)}
            className="h-8 min-w-[80px] rounded-md border border-[#4a9eff] bg-[#4a9eff] px-4 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#4a9eff]/50"
          >
            {confirm ? t('dialog.confirm') : t('dialog.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppDialog;
