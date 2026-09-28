import { useState } from 'react';
import Toggle from './Toggle';
import ColorPickerButton from './ColorPickerButton';
import ModeSwitcher from './ModeSwitcher';
import HelpButton from './HelpButton';
import ShortcutHelpDialog from './ShortcutHelpDialog';
import LanguageSwitcher from './LanguageSwitcher';
import { useI18n } from '../i18n';

interface TopNavProps {
  histogramEnabled: boolean;
  onHistogramToggle: () => void;
  colorPickerEnabled: boolean;
  onColorPickerToggle: () => void;
  onWatermarkClick: () => void;
  blindActive: boolean;
  onBlindToggle: () => void;
}

function TopNav({
  histogramEnabled,
  onHistogramToggle,
  colorPickerEnabled,
  onColorPickerToggle,
  onWatermarkClick,
  blindActive,
  onBlindToggle,
}: TopNavProps) {
  const { t } = useI18n();
  const [annotation, setAnnotation] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <header className="h-12 shrink-0 flex items-center justify-between px-3 bg-[#252525] border-b border-[#3c3c3c]">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#4a9eff]" />
          <span className="text-base text-[#e0e0e0]">ImageCompare</span>
        </div>
        <div className="w-px h-5 bg-[#3c3c3c]" />
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={onWatermarkClick}
            className="text-sm text-[#888888] hover:text-[#e0e0e0] cursor-pointer select-none px-2 py-1 rounded hover:bg-[#2b2b2b]"
          >
            {t('nav.watermark')}
          </button>
          <Toggle checked={histogramEnabled} onChange={onHistogramToggle} color="#4a9eff" label={t('nav.histogram')} />
          <Toggle
            checked={annotation}
            onChange={() => {
              if (blindActive) {
                alert(t('nav.alert.annotationBlindConflict'));
                return;
              }
              setAnnotation(false);
              alert(t('nav.alert.comingSoon'));
            }}
            color="#4a9eff"
            label={t('nav.annotation')}
          />
          <Toggle
            checked={blindActive}
            onChange={onBlindToggle}
            color="#ff8c00"
            label={t('nav.blind')}
          />
          <ColorPickerButton
            active={colorPickerEnabled}
            onClick={onColorPickerToggle}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <ModeSwitcher />
        <HelpButton onClick={() => setHelpOpen(true)} />
      </div>
      {helpOpen && (
        <ShortcutHelpDialog mode="image" onClose={() => setHelpOpen(false)} />
      )}
    </header>
  );
}

export default TopNav;
