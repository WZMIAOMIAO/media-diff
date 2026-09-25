import { useEffect, useState } from 'react';
import TopNav from '../components/TopNav';
import Sidebar from '../components/Sidebar';
import ThumbnailPanel from '../components/ThumbnailPanel';
import ImageCompareArea from '../components/ImageCompareArea';
import WatermarkDialog from '../components/WatermarkDialog';
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

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#1e1e1e] text-[#e0e0e0]">
      <TopNav
        histogramEnabled={histogramEnabled}
        onHistogramToggle={() => setHistogramEnabled((v) => !v)}
        colorPickerEnabled={colorPickerEnabled}
        onColorPickerToggle={() => setColorPickerEnabled((v) => !v)}
        onWatermarkClick={() => setWatermarkDialogOpen(true)}
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
      {watermarkDialogOpen && (
        <WatermarkDialog
          folders={compare.selectedFolders}
          configs={watermarkConfigs}
          onConfigsChange={setWatermarkConfigs}
          onClose={() => setWatermarkDialogOpen(false)}
        />
      )}
    </div>
  );
}
