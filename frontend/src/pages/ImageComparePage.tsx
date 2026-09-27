import { useEffect, useState } from 'react';
import TopNav from '../components/TopNav';
import Sidebar from '../components/Sidebar';
import ThumbnailPanel from '../components/ThumbnailPanel';
import ImageCompareArea from '../components/ImageCompareArea';
import WatermarkDialog from '../components/WatermarkDialog';
import BlindEvalSetupDialog from '../components/BlindEvalSetupDialog';
import BlindEvalBar from '../components/BlindEvalBar';
import BlindEvalInfoDialog from '../components/BlindEvalInfoDialog';
import BlindEvalResultDialog from '../components/BlindEvalResultDialog';
import { useImageCompare } from '../hooks/useImageCompare';
import { useImagePrefetch } from '../hooks/useImagePrefetch';
import type { WatermarkConfig } from '../types';

export default function ImageComparePage() {
  const compare = useImageCompare();
  const [histogramEnabled, setHistogramEnabled] = useState(false);
  const [colorPickerEnabled, setColorPickerEnabled] = useState(false);
  const [watermarkConfigs, setWatermarkConfigs] = useState<
    Record<number, WatermarkConfig>
  >({});
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);
  const [blindSetupOpen, setBlindSetupOpen] = useState(false);
  const [blindInfoOpen, setBlindInfoOpen] = useState(false);
  const [blindResultOpen, setBlindResultOpen] = useState(false);

  useImagePrefetch(compare);

  useEffect(() => {
    if (!colorPickerEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColorPickerEnabled(false);
    };
    const onContextMenu = () => setColorPickerEnabled(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [colorPickerEnabled]);

  const handleBlindToggle = () => {
    if (compare.blind) {
      if (
        compare.blind.votedCount > 0 &&
        !confirm('确定退出盲评模式吗？已投票结果已保存到文件。')
      ) {
        return;
      }
      compare.exitBlind();
      return;
    }
    if (compare.selectedFolders.length < 2) {
      alert('盲评模式需要至少2个对比文件夹，请先添加');
      return;
    }
    setBlindSetupOpen(true);
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#1e1e1e] text-[#e0e0e0]">
      <TopNav
        histogramEnabled={histogramEnabled}
        onHistogramToggle={() => setHistogramEnabled((v) => !v)}
        colorPickerEnabled={colorPickerEnabled}
        onColorPickerToggle={() => setColorPickerEnabled((v) => !v)}
        onWatermarkClick={() => setWatermarkDialogOpen(true)}
        blindActive={!!compare.blind}
        onBlindToggle={handleBlindToggle}
      />
      <div className="flex-1 flex min-h-0">
        <Sidebar compare={compare} />
        <ThumbnailPanel compare={compare} />
        <ImageCompareArea
          compare={compare}
          histogramEnabled={histogramEnabled}
          colorPickerEnabled={colorPickerEnabled}
          watermarkConfigs={watermarkConfigs}
          onWatermarkConfigsChange={setWatermarkConfigs}
        />
      </div>
      {compare.blind && (
        <BlindEvalBar
          blind={compare.blind}
          onInfo={() => setBlindInfoOpen(true)}
          onResult={() => setBlindResultOpen(true)}
        />
      )}
      {watermarkDialogOpen && (
        <WatermarkDialog
          folders={compare.selectedFolders}
          configs={watermarkConfigs}
          onConfigsChange={setWatermarkConfigs}
          onClose={() => setWatermarkDialogOpen(false)}
        />
      )}
      {blindSetupOpen && (
        <BlindEvalSetupDialog
          folders={compare.selectedFolders}
          filesPerFolder={compare.imagesPerFolder}
          media="image"
          onEnter={(result) => {
            compare.enterBlind(result);
            setBlindSetupOpen(false);
          }}
          onClose={() => setBlindSetupOpen(false)}
        />
      )}
      {blindInfoOpen && compare.blind && (
        <BlindEvalInfoDialog
          outputPath={compare.blind.outputPath}
          onClose={() => setBlindInfoOpen(false)}
        />
      )}
      {blindResultOpen && compare.blind && (
        <BlindEvalResultDialog
          blind={compare.blind}
          onClose={() => setBlindResultOpen(false)}
        />
      )}
    </div>
  );
}
