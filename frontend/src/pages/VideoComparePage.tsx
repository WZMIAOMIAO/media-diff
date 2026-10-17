import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import VideoTopNav from '../components/video/VideoTopNav';
import VideoSidebar from '../components/video/VideoSidebar';
import VideoThumbnailPanel from '../components/video/VideoThumbnailPanel';
import VideoCompareArea from '../components/video/VideoCompareArea';
import WatermarkDialog from '../components/WatermarkDialog';
import BlindEvalSetupDialog from '../components/BlindEvalSetupDialog';
import BlindEvalBar from '../components/BlindEvalBar';
import BlindEvalInfoDialog from '../components/BlindEvalInfoDialog';
import BlindEvalResultDialog from '../components/BlindEvalResultDialog';
import AnnotationSetupDialog from '../components/AnnotationSetupDialog';
import AnnotationBar from '../components/AnnotationBar';
import AnnotationInfoDialog from '../components/AnnotationInfoDialog';
import { useVideoCompare } from '../hooks/video/useVideoCompare';
import { useVideoPlayer } from '../hooks/video/useVideoPlayer';
import { useWatermark } from '../hooks/useWatermark';
import { VIDEO_WATERMARK_KEY } from '../utils/watermarkStorage';

export default function VideoComparePage() {
  const { t, lang } = useI18n();
  const compare = useVideoCompare();
  const player = useVideoPlayer({
    selectedFolders: compare.selectedFolders,
    currentVideos: compare.currentVideos,
    videoInfos: compare.videoInfos,
    onAutoNext: compare.nextVideo,
    canPlay: compare.allVideosReady,
  });
  const [histogramEnabled, setHistogramEnabled] = useState(false);
  const [colorPickerEnabled, setColorPickerEnabled] = useState(false);
  const watermark = useWatermark(VIDEO_WATERMARK_KEY);
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);
  const [blindSetupOpen, setBlindSetupOpen] = useState(false);
  const [blindInfoOpen, setBlindInfoOpen] = useState(false);
  const [blindResultOpen, setBlindResultOpen] = useState(false);
  const [annotationSetupOpen, setAnnotationSetupOpen] = useState(false);
  const [annotationInfoOpen, setAnnotationInfoOpen] = useState(false);

  useEffect(() => {
    document.title = `${t('brand.name')} · ${t('brand.video')}`;
  }, [t, lang]);

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

  const handleBlindToggle = () => {
    if (compare.blind) {
      if (
        compare.blind.votedCount > 0 &&
        !confirm(t('blind.exitConfirm'))
      ) {
        return;
      }
      player.pause();
      compare.exitBlind();
      return;
    }
    if (compare.annotation) {
      alert(t('nav.alert.annotationBlindConflict'));
      return;
    }
    if (compare.selectedFolders.length < 2) {
      alert(t('blind.needFolders'));
      return;
    }
    setBlindSetupOpen(true);
  };

  const handleAnnotationToggle = () => {
    if (compare.annotation) {
      compare.exitAnnotation();
      return;
    }
    if (compare.blind) {
      alert(t('nav.alert.annotationBlindConflict'));
      return;
    }
    const count = compare.selectedFolders.length;
    if (count === 0) {
      alert(t('annotation.needFolders'));
      return;
    }
    if (count > 3) {
      alert(t('annotation.tooManyFolders'));
      return;
    }
    player.pause();
    setAnnotationSetupOpen(true);
  };

  const handleMoveFolder = (from: number, to: number) => {
    if (compare.moveFolder(from, to)) watermark.reorder(from, to);
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#1e1e1e] text-[#e0e0e0]">
      <VideoTopNav
        histogramEnabled={histogramEnabled}
        onHistogramToggle={() => setHistogramEnabled((v) => !v)}
        colorPickerEnabled={colorPickerEnabled}
        colorPickerDisabled={player.isPlaying}
        onColorPickerToggle={() => setColorPickerEnabled((v) => !v)}
        onWatermarkClick={() => setWatermarkDialogOpen(true)}
        annotationActive={!!compare.annotation}
        onAnnotationToggle={handleAnnotationToggle}
        blindActive={!!compare.blind}
        onBlindToggle={handleBlindToggle}
      />
      <div className="flex-1 flex min-h-0">
        <VideoSidebar compare={compare} onMoveFolder={handleMoveFolder} />
        <VideoThumbnailPanel compare={compare} />
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <VideoCompareArea
            compare={compare}
            player={player}
            histogramEnabled={histogramEnabled}
            colorPickerEnabled={colorPickerEnabled}
            watermarkConfigs={watermark.configs}
          />
          {compare.annotation && (
            <AnnotationBar
              annotation={compare.annotation}
              onInfo={() => setAnnotationInfoOpen(true)}
            />
          )}
        </div>
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
          style={watermark.style}
          onStyleChange={watermark.setStyle}
          texts={watermark.texts}
          onTextChange={watermark.setText}
          onFillFolderNames={() => watermark.fillFolderNames(compare.selectedFolders)}
          onClearTexts={watermark.clearTexts}
          onClose={() => setWatermarkDialogOpen(false)}
        />
      )}
      {blindSetupOpen && (
        <BlindEvalSetupDialog
          folders={compare.selectedFolders}
          filesPerFolder={compare.videosPerFolder}
          media="video"
          recursive={compare.recursiveMode}
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
      {annotationSetupOpen && (
        <AnnotationSetupDialog
          folders={compare.selectedFolders}
          media="video"
          onEnter={(outputPath, entries) => {
            player.pause();
            compare.enterAnnotation(outputPath, entries);
            setAnnotationSetupOpen(false);
          }}
          onClose={() => setAnnotationSetupOpen(false)}
        />
      )}
      {annotationInfoOpen && compare.annotation && (
        <AnnotationInfoDialog
          outputPath={compare.annotation.outputPath}
          onClose={() => setAnnotationInfoOpen(false)}
        />
      )}
    </div>
  );
}
