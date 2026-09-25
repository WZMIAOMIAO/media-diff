import { useEffect, useState } from 'react';
import VideoTopNav from '../components/video/VideoTopNav';
import VideoSidebar from '../components/video/VideoSidebar';
import VideoThumbnailPanel from '../components/video/VideoThumbnailPanel';
import VideoCompareArea from '../components/video/VideoCompareArea';
import WatermarkDialog from '../components/WatermarkDialog';
import { useVideoCompare } from '../hooks/video/useVideoCompare';
import { useVideoPlayer } from '../hooks/video/useVideoPlayer';
import type { WatermarkConfig } from '../types';

export default function VideoComparePage() {
  const compare = useVideoCompare();
  const player = useVideoPlayer({
    selectedFolders: compare.selectedFolders,
    currentVideos: compare.currentVideos,
    videoInfos: compare.videoInfos,
  });
  const [histogramEnabled, setHistogramEnabled] = useState(false);
  const [colorPickerEnabled, setColorPickerEnabled] = useState(false);
  const [watermarkConfigs, setWatermarkConfigs] = useState<
    Record<number, WatermarkConfig>
  >({});
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);

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

  // Sampling a playing video would require a synchronous GPU readback on every
  // frame (heavy with up to 4 windows), so the picker is disabled while playing.
  useEffect(() => {
    if (player.isPlaying && colorPickerEnabled) setColorPickerEnabled(false);
  }, [player.isPlaying, colorPickerEnabled]);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#1e1e1e] text-[#e0e0e0]">
      <VideoTopNav
        histogramEnabled={histogramEnabled}
        onHistogramToggle={() => setHistogramEnabled((v) => !v)}
        colorPickerEnabled={colorPickerEnabled}
        colorPickerDisabled={player.isPlaying}
        onColorPickerToggle={() => setColorPickerEnabled((v) => !v)}
        onWatermarkClick={() => setWatermarkDialogOpen(true)}
      />
      <div className="flex-1 flex min-h-0">
        <VideoSidebar compare={compare} />
        <VideoThumbnailPanel compare={compare} />
        <VideoCompareArea
          compare={compare}
          player={player}
          histogramEnabled={histogramEnabled}
          colorPickerEnabled={colorPickerEnabled}
          watermarkConfigs={watermarkConfigs}
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
