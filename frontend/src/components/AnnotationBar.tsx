import { useState } from 'react';
import type { AnnotationApi } from '../types';
import { useI18n } from '../i18n';

interface AnnotationBarProps {
  annotation: AnnotationApi;
  onInfo: () => void;
}

function AnnotationBar({ annotation, onInfo }: AnnotationBarProps) {
  const { t } = useI18n();
  const [newText, setNewText] = useState('');
  const noun = t(annotation.media === 'video' ? 'media.video' : 'media.image');

  const addText = () => {
    annotation.addCommonText(newText);
    setNewText('');
  };

  const canSubmit =
    annotation.question.trim() !== '' && annotation.result.trim() !== '';

  return (
    <div className="shrink-0 flex flex-col gap-2 px-3 py-2 bg-[#252525] border-t border-[#3c3c3c] text-sm">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[#4a9eff]">{t('annotation.bar')}</span>
        <span
          className={`shrink-0 px-2 py-0.5 rounded text-xs ${
            annotation.isAnnotated
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {annotation.isAnnotated ? t('annotation.annotated') : t('annotation.unannotated')}
        </span>
        <span className="shrink-0 text-xs text-[#888888]">
          {t('annotation.progress', {
            total: annotation.total,
            done: annotation.annotatedCount,
          })}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onInfo}
          className="shrink-0 px-3 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
        >
          {t('annotation.info')}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[#c0c0c0]">{t('annotation.question')}</span>
        <input
          value={annotation.question}
          onChange={(e) => annotation.setQuestion(e.target.value)}
          placeholder={t('annotation.questionPlaceholder', { noun })}
          title={annotation.question || undefined}
          className="w-[60%] px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] placeholder:text-[#888888] focus:outline-none focus:border-[#555555]"
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[#c0c0c0]">{t('annotation.result')}</span>
        <input
          value={annotation.result}
          onChange={(e) => annotation.setResult(e.target.value)}
          placeholder={t('annotation.resultPlaceholder', { noun })}
          className="w-[60%] px-2 py-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] placeholder:text-[#888888] focus:outline-none focus:border-[#555555]"
        />
        <button
          type="button"
          onClick={() => void annotation.submit()}
          disabled={!canSubmit}
          title={canSubmit ? undefined : t('annotation.submitDisabledHint')}
          className="shrink-0 px-3 py-1 bg-[#4a9eff] border border-[#4a9eff] rounded text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('annotation.submit')}
        </button>
      </div>

      <div className="flex items-center flex-wrap gap-2">
        <span className="shrink-0 text-[#c0c0c0]">{t('annotation.commonTexts')}</span>
        {annotation.commonTexts.map((text) => (
          <span
            key={text}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#333333] border border-[#3c3c3c]"
          >
            <button
              type="button"
              onClick={() => annotation.setResult(text)}
              title={text}
              className="max-w-[160px] truncate text-[#e0e0e0] hover:text-white"
            >
              {text}
            </button>
            <button
              type="button"
              onClick={() => annotation.removeCommonText(text)}
              className="text-[#888888] hover:text-[#ef4444]"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addText();
            }
          }}
          placeholder={t('annotation.addCommonText')}
          className="w-40 px-2 py-0.5 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] placeholder:text-[#888888] focus:outline-none focus:border-[#555555]"
        />
      </div>
    </div>
  );
}

export default AnnotationBar;
