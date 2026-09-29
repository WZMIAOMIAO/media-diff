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
  const { zoomByAt, resetFit } = sharedZoom;
  const { selectedFolders, filteredImages, currentIndices, nextImage, prevImage, blind } = compare;
  const [samplePos, setSamplePos] = useState<SamplePos | null>(null);

  const handleSample = useCallback((pos: SamplePos | null) => {
    setSamplePos(pos);
  }, []);

  useEffect(() => {
    if (!colorPickerEnabled) setSamplePos(null);
  }, [colorPickerEnabled]);

  // keyboard: ←/→ switch image, ↑/↓ zoom (synced, centred)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        prevImage();
      } else if (e.key === 'ArrowRight') {
        nextImage();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        zoomByAt(1.15, null, null);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        zoomByAt(1 / 1.15, null, null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextImage, prevImage, zoomByAt]);

  const indicesKey = selectedFolders.map((f) => currentIndices.get(f.path) ?? 0).join(',');

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
        // Key by visual position, not folder path: in blind mode the folder
        // shown in a window changes between groups, and re-keying would remount
        // the window (losing hover state, which breaks the numeric-key overlay).
        key={i}
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
