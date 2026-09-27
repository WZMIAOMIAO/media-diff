import { useState } from 'react';
import Toggle from '../Toggle';
import ColorPickerButton from '../ColorPickerButton';
import ModeSwitcher from '../ModeSwitcher';
import HelpButton from '../HelpButton';
import ShortcutHelpDialog from '../ShortcutHelpDialog';

interface VideoTopNavProps {
  histogramEnabled: boolean;
  onHistogramToggle: () => void;
  colorPickerEnabled: boolean;
  colorPickerDisabled: boolean;
  onColorPickerToggle: () => void;
  onWatermarkClick: () => void;
  blindActive: boolean;
  onBlindToggle: () => void;
}

function VideoTopNav({
  histogramEnabled,
  onHistogramToggle,
  colorPickerEnabled,
  colorPickerDisabled,
  onColorPickerToggle,
  onWatermarkClick,
  blindActive,
  onBlindToggle,
}: VideoTopNavProps) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <header className="h-12 shrink-0 flex items-center justify-between px-3 bg-[#252525] border-b border-[#3c3c3c]">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#9a4eff]" />
          <span className="text-base text-[#e0e0e0]">VideoCompare</span>
        </div>
        <div className="w-px h-5 bg-[#3c3c3c]" />
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={onWatermarkClick}
            className="text-sm text-[#888888] hover:text-[#e0e0e0] cursor-pointer select-none px-2 py-1 rounded hover:bg-[#2b2b2b]"
          >
            水印
          </button>
          <Toggle
            checked={histogramEnabled}
            onChange={onHistogramToggle}
            color="#4a9eff"
            label="RGB直方图"
          />
          <Toggle
            checked={blindActive}
            onChange={onBlindToggle}
            color="#ff8c00"
            label="盲评模式"
          />
          <ColorPickerButton
            active={colorPickerEnabled}
            disabled={colorPickerDisabled}
            onClick={onColorPickerToggle}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ModeSwitcher />
        <HelpButton onClick={() => setHelpOpen(true)} />
      </div>
      {helpOpen && (
        <ShortcutHelpDialog mode="video" onClose={() => setHelpOpen(false)} />
      )}
    </header>
  );
}

export default VideoTopNav;
