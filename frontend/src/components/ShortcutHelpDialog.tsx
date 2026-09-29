import { useEffect } from 'react';
import { useI18n } from '../i18n';

export type HelpMode = 'image' | 'video';

interface ShortcutItem {
  keys: string[];
  desc: string;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function buildSections(mode: HelpMode, t: Translate): ShortcutSection[] {
  const viewSection: ShortcutSection = {
    title: t('help.group.view'),
    items: [
      { keys: [t('help.key.wheel')], desc: t('help.wheel') },
      { keys: ['↑', '↓'], desc: t('help.zoom') },
      { keys: [t('help.key.drag')], desc: t('help.drag') },
      { keys: [t('help.key.dblclick')], desc: t('help.dblclick') },
    ],
  };

  const pickerSection: ShortcutSection = {
    title: t('help.group.colorPicker'),
    items: [
      { keys: ['Esc', t('help.key.rightClick')], desc: t('help.cpExit') },
      { keys: [t('help.key.move')], desc: t('help.cpMove') },
    ],
  };

  const thumbnailSection: ShortcutSection = {
    title: t('help.group.preview'),
    items: [
      { keys: ['Ctrl', '⌘'], desc: t('help.previewCtrl') },
      { keys: [t('help.key.click')], desc: t('help.previewClick') },
    ],
  };

  if (mode === 'video') {
    return [
      {
        title: t('help.group.playback'),
        items: [
          { keys: [t('help.key.space')], desc: t('help.space') },
          { keys: ['A', 'D'], desc: t('help.ad') },
        ],
      },
      {
        title: t('help.group.videoSwitch'),
        items: [
          { keys: ['←'], desc: t('help.prevVideo') },
          { keys: ['→'], desc: t('help.nextVideo') },
        ],
      },
      viewSection,
      {
        title: t('help.group.overlay'),
        items: [{ keys: ['1–4'], desc: t('help.overlayVideo') }],
      },
      thumbnailSection,
      pickerSection,
    ];
  }

  return [
    {
      title: t('help.group.imageSwitch'),
      items: [
        { keys: ['←'], desc: t('help.prevImage') },
        { keys: ['→'], desc: t('help.nextImage') },
      ],
    },
    viewSection,
    {
      title: t('help.group.overlay'),
      items: [{ keys: ['1–4'], desc: t('help.overlayImage') }],
    },
    thumbnailSection,
    pickerSection,
  ];
}

interface ShortcutHelpDialogProps {
  mode: HelpMode;
  onClose: () => void;
}

export default function ShortcutHelpDialog({ mode, onClose }: ShortcutHelpDialogProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sections = buildSections(mode, t);
  const title = t(mode === 'video' ? 'help.titleVideo' : 'help.titleImage');
  const tip = t(mode === 'video' ? 'help.noteVideo' : 'help.noteImage');

  const backdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={backdropClick}
    >
      <div className="w-[560px] max-h-[80vh] overflow-auto bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c]">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#4a9eff] text-sm font-bold text-white">
              ?
            </span>
            <span className="text-sm font-bold text-[#e0e0e0]">{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t('help.close')}
            aria-label={t('help.close')}
            className="flex items-center justify-center w-6 h-6 rounded text-[#888888] hover:bg-[#3c3c3c] hover:text-[#e0e0e0]"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-5">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="mb-2 text-xs text-[#888888]">{section.title}</div>
              <div className="space-y-1.5">
                {section.items.map((item) => (
                  <div key={item.desc} className="flex items-center gap-3">
                    <div className="flex w-[136px] shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={`${k}-${i}`} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[10px] text-[#666666]">/</span>}
                          <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded border border-[#3c3c3c] border-b-2 bg-[#1e1e1e] px-1.5 font-mono text-[11px] text-[#e0e0e0]">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </div>
                    <span className="text-sm text-[#c0c0c0]">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#3c3c3c] px-4 py-3 text-xs leading-relaxed text-[#888888]">
          {tip}
        </div>
      </div>
    </div>
  );
}
