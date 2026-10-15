import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import TopNav from '../components/TopNav';
import Sidebar from '../components/Sidebar';
import ThumbnailPanel from '../components/ThumbnailPanel';
import ImageCompareArea from '../components/ImageCompareArea';
import WatermarkDialog from '../components/WatermarkDialog';
import BlindEvalSetupDialog from '../components/BlindEvalSetupDialog';
import BlindEvalBar from '../components/BlindEvalBar';
import BlindEvalInfoDialog from '../components/BlindEvalInfoDialog';
import BlindEvalResultDialog from '../components/BlindEvalResultDialog';
import AnnotationSetupDialog from '../components/AnnotationSetupDialog';
import AnnotationBar from '../components/AnnotationBar';
import AnnotationInfoDialog from '../components/AnnotationInfoDialog';
import { useImageCompare } from '../hooks/useImageCompare';
import { useImagePrefetch } from '../hooks/useImagePrefetch';
import { useWatermark } from '../hooks/useWatermark';
import { IMAGE_WATERMARK_KEY } from '../utils/watermarkStorage';

export default function ImageComparePage() {
  const { t, lang } = useI18n();
  const compare = useImageCompare();
  const [histogramEnabled, setHistogramEnabled] = useState(false);
  const [colorPickerEnabled, setColorPickerEnabled] = useState(false);
  const watermark = useWatermark(IMAGE_WATERMARK_KEY);
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);
  const [blindSetupOpen, setBlindSetupOpen] = useState(false);
  const [blindInfoOpen, setBlindInfoOpen] = useState(false);
  const [blindResultOpen, setBlindResultOpen] = useState(false);
  const [annotationSetupOpen, setAnnotationSetupOpen] = useState(false);
  const [annotationInfoOpen, setAnnotationInfoOpen] = useState(false);

  useImagePrefetch(compare);

  useEffect(() => {
    document.title = `${t('brand.name')} · ${t('brand.image')}`;
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

  const handleBlindToggle = () => {
    if (compare.blind) {
      if (
        compare.blind.votedCount > 0 &&
        !confirm(t('blind.exitConfirm'))
      ) {
        return;
      }
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
    setAnnotationSetupOpen(true);
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#1e1e1e] text-[#e0e0e0]">
      <TopNav
        histogramEnabled={histogramEnabled}
        onHistogramToggle={() => setHistogramEnabled((v) => !v)}
        colorPickerEnabled={colorPickerEnabled}
        onColorPickerToggle={() => setColorPickerEnabled((v) => !v)}
        onWatermarkClick={() => setWatermarkDialogOpen(true)}
        annotationActive={!!compare.annotation}
        onAnnotationToggle={handleAnnotationToggle}
        blindActive={!!compare.blind}
        onBlindToggle={handleBlindToggle}
      />
      <div className="flex-1 flex min-h-0">
        <Sidebar compare={compare} />
        <ThumbnailPanel compare={compare} />
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <ImageCompareArea
            compare={compare}
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
          filesPerFolder={compare.imagesPerFolder}
          media="image"
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
          onEnter={(outputPath, entries) => {
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
