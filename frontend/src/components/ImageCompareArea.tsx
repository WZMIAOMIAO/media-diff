import { useCallback, useEffect, useState } from 'react';
import type { UseImageCompareReturn } from '../hooks/useImageCompare';
import { useSharedZoom } from '../hooks/useSharedZoom';
import type { WatermarkConfig, SelectedFolder } from '../types';
import type { FileEntry } from '../api';
import type { SamplePos } from './ColorReadout';
import ImageWindow from './ImageWindow';
import { useI18n } from '../i18n';

interface ImageCompareAreaProps {
  compare: UseImageCompareReturn;
  histogramEnabled: boolean;
  colorPickerEnabled: boolean;
  watermarkConfigs: Record<number, WatermarkConfig>;
}

interface WindowInfo {
  index: number;
  folder: SelectedFolder;
  image: FileEntry | null;
}

function ImageCompareArea({ compare, histogramEnabled, colorPickerEnabled, watermarkConfigs }: ImageCompareAreaProps) {
  const { t } = useI18n();
  const sharedZoom = useSharedZoom();
  const { selectedFolders, filteredImages, currentIndices, nextImage, prevImage, blind } = compare;
  const [samplePos, setSamplePos] = useState<SamplePos | null>(null);

  const handleSample = useCallback((pos: SamplePos | null) => {
    setSamplePos(pos);
  }, []);

  useEffect(() => {
    if (!colorPickerEnabled) setSamplePos(null);
  }, [colorPickerEnabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevImage();
      else if (e.key === 'ArrowRight') nextImage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextImage, prevImage]);

  const indicesKey = selectedFolders.map((f) => currentIndices.get(f.path) ?? 0).join(',');

  const { resetFit } = sharedZoom;
  useEffect(() => {
    resetFit();
  }, [indicesKey, resetFit]);

  if (selectedFolders.length === 0) {
    return (
      <main className="flex-1 min-w-0 flex items-center justify-center bg-[#1e1e1e]">
        <span className="text-sm text-[#888888]">{t('compare.emptyImage')}</span>
      </main>
    );
  }

  const allWindows: WindowInfo[] = selectedFolders.map((f, i) => {
    if (blind) {
      const name = blind.order[blind.index];
      const order = (name && blind.displayOrders[name]) || selectedFolders.map((_, k) => k);
      const folder = selectedFolders[order[i] ?? i] ?? f;
      const image =
        (filteredImages.get(folder.path) ?? []).find((e) => e.name === name) ?? null;
      return { index: i, folder, image };
    }
    const idx = currentIndices.get(f.path) ?? 0;
    return {
      index: i,
      folder: f,
      image: filteredImages.get(f.path)?.[idx] ?? null,
    };
  });

  const blindName = blind ? blind.order[blind.index] : undefined;

  const renderWindow = (i: number) => {
    const w = allWindows[i];
    const idx = blind ? blind.index : currentIndices.get(w.folder.path) ?? 0;
    return (
      <ImageWindow
        key={w.folder.path}
        index={i}
        folder={w.folder}
        image={w.image}
        imageIndex={idx}
        totalImages={blind ? blind.total : filteredImages.get(w.folder.path)?.length ?? 0}
        sharedZoom={sharedZoom}
        histogramEnabled={histogramEnabled}
        colorPickerEnabled={colorPickerEnabled}
        samplePos={samplePos}
        onSample={handleSample}
        watermarkConfig={watermarkConfigs[i]}
        allWindows={allWindows}
        titlePosition={selectedFolders.length === 4 && i >= 2 ? 'bottom' : 'top'}
        blindVote={
          blind && blindName
            ? {
                alias: blind.aliases[w.folder.path] ?? '',
                votedAlias: blind.votes.get(blindName) ?? null,
                onVote: () => {
                  const alias = blind.aliases[w.folder.path] ?? '';
                  const current = blind.votes.get(blindName) ?? null;
                  void blind.vote(blindName, current === alias ? null : alias);
                },
              }
            : null
        }
      />
    );
  };

  if (selectedFolders.length === 4) {
    return (
      <main className="flex-1 min-w-0 grid grid-cols-2 grid-rows-2 gap-px bg-[#3c3c3c]">
        {renderWindow(0)}
        {renderWindow(1)}
        {renderWindow(2)}
        {renderWindow(3)}
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 flex gap-px bg-[#3c3c3c]">
      {selectedFolders.map((_, i) => (
        <div key={i} className="flex-1 min-w-0">
          {renderWindow(i)}
        </div>
      ))}
    </main>
  );
}

export default ImageCompareArea;
