import { useEffect, useRef, useState } from 'react';
import type { SharedZoomApi } from '../hooks/useSharedZoom';
import type { SelectedFolder, WatermarkConfig } from '../types';
import type { FileEntry } from '../api';
import { fetchImageBlob, fetchHistogram, histogramCache } from '../api';
import { clientToUV, getContentBox, EYEDROPPER_CURSOR } from '../utils/colorSample';
import OverlayButtons from './OverlayButtons';
import HistogramOverlay from './HistogramOverlay';
import ColorReadout, { type SamplePos } from './ColorReadout';

interface WindowInfo {
  index: number;
  folder: SelectedFolder;
  image: FileEntry | null;
}

interface ImageWindowProps {
  index: number;
  folder: SelectedFolder;
  image: FileEntry | null;
  imageIndex: number;
  totalImages: number;
  sharedZoom: SharedZoomApi;
  histogramEnabled: boolean;
  colorPickerEnabled: boolean;
  samplePos: SamplePos | null;
  onSample: (pos: SamplePos | null) => void;
  watermarkConfig?: WatermarkConfig;
  allWindows: WindowInfo[];
}

export default function ImageWindow({
  index,
  image,
  imageIndex,
  totalImages,
  sharedZoom,
  histogramEnabled,
  colorPickerEnabled,
  samplePos,
  onSample,
  watermarkConfig,
  allWindows,
}: ImageWindowProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [resolution, setResolution] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [overlayPath, setOverlayPath] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startY: number; basePanX: number; basePanY: number } | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const zoomByAtRef = useRef(sharedZoom.zoomByAt);
  zoomByAtRef.current = sharedZoom.zoomByAt;

  const { zoom, panX, panY } = sharedZoom;
  const canDrag = zoom > 1;

  useEffect(() => {
    if (!image?.path) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    let retries = 0;
    setLoadError(false);
    setNaturalSize({ w: 0, h: 0 });
    const load = () => {
      if (cancelled) return;
      fetchImageBlob(image.path)
        .then((url) => {
          if (cancelled) return;
          setImageUrl(url);
          setLoadError(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (retries < 3) {
            retries++;
            load();
          } else {
            setLoadError(true);
          }
        });
    };
    load();
    return () => { cancelled = true; };
  }, [image?.path]);

  useEffect(() => {
    if (!overlayPath) {
      setOverlayUrl(null);
      return;
    }
    let cancelled = false;
    fetchImageBlob(overlayPath).then((url) => {
      if (!cancelled) setOverlayUrl(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [overlayPath]);

  useEffect(() => {
    if (!isHovered) {
      setOverlayPath(null);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= allWindows.length && num - 1 !== index) {
        const target = allWindows[num - 1];
        if (target?.image) setOverlayPath(target.image.path);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 4) setOverlayPath(null);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isHovered, allWindows, index]);

  useEffect(() => {
    if (!histogramEnabled) return;
    for (const w of allWindows) {
      if (w.image && w.index !== index) {
        const p = w.image.path;
        if (!histogramCache.has(p)) {
          fetchHistogram(p).catch(() => {});
        }
      }
    }
  }, [histogramEnabled, allWindows, index]);

  useEffect(() => {
    const el = imgContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setContainerSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onWheelRef = useRef((e: WheelEvent) => {
    e.preventDefault();
    const container = imgContainerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    const inBounds =
      e.clientX >= imgRect.left && e.clientX <= imgRect.right &&
      e.clientY >= imgRect.top && e.clientY <= imgRect.bottom;
    const centerX = inBounds ? e.clientX - containerRect.left - containerRect.width / 2 : null;
    const centerY = inBounds ? e.clientY - containerRect.top - containerRect.height / 2 : null;
    zoomByAtRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, centerX, centerY);
  });
  onWheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const container = imgContainerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    const inBounds =
      e.clientX >= imgRect.left && e.clientX <= imgRect.right &&
      e.clientY >= imgRect.top && e.clientY <= imgRect.bottom;
    const centerX = inBounds ? e.clientX - containerRect.left - containerRect.width / 2 : null;
    const centerY = inBounds ? e.clientY - containerRect.top - containerRect.height / 2 : null;
    zoomByAtRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, centerX, centerY);
  };

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => onWheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!canDrag) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, basePanX: panX, basePanY: panY };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    sharedZoom.setPan(dragRef.current.basePanX + dx, dragRef.current.basePanY + dy);
  };

  const onMouseUp = () => {
    dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    sharedZoom.resetFit();
  };

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setResolution(`${img.naturalWidth}×${img.naturalHeight}`);
  };

  const sampleAt = (clientX: number, clientY: number) => {
    if (!colorPickerEnabled) return;
    const container = imgContainerRef.current;
    const el = imgRef.current;
    if (!container || !el) return;
    const box = getContentBox(el, container);
    if (!box) return;
    onSample(clientToUV(box, container, clientX, clientY));
  };

  const srcW = naturalSize.w;
  const srcH = naturalSize.h;
  const fitRatio =
    srcW > 0 && srcH > 0 && containerSize.w > 0 && containerSize.h > 0
      ? Math.min(1, containerSize.w / srcW, containerSize.h / srcH)
      : 0;
  const fitPercent = fitRatio > 0 ? Math.round(fitRatio * zoom * 100) : Math.round(zoom * 100);
  const cursor = canDrag ? (dragRef.current ? 'grabbing' : 'grab') : 'default';

  // Zoom via layout size (not transform: scale) so the overlay's raster is not
  // left stale by the compositor when it is added (see VideoWindow).
  const hasFit = fitRatio > 0;
  const baseW = srcW * fitRatio;
  const baseH = srcH * fitRatio;
  const panTransform = `translate(${panX}px, ${panY}px)`;
  const pickerVersion = `${zoom},${panX},${panY},${imageUrl ?? ''}`;

  return (
    <div
      ref={outerRef}
      className="relative h-full w-full overflow-hidden bg-[#1e1e1e] flex flex-col select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); onMouseUp(); }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor }}
    >
      <div className="flex items-center justify-between h-8 px-2 bg-[#252525] border-b border-[#3c3c3c] shrink-0">
        <span className="text-xs text-[#e0e0e0] truncate" title={image ? `${image.name} ${resolution}` : ''}>
          {image ? `${image.name} ${resolution}` : '无图片'}
        </span>
        <OverlayButtons
          currentIndex={index}
          totalWindows={allWindows.length}
          allImages={allWindows.map((w) => w.image)}
          onOverlayStart={(path) => setOverlayPath(path)}
          onOverlayEnd={() => setOverlayPath(null)}
        />
      </div>

      <div
        ref={imgContainerRef}
        className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden"
        style={{ cursor: colorPickerEnabled ? EYEDROPPER_CURSOR : undefined }}
        onDoubleClick={onDoubleClick}
        onMouseMove={(e) => sampleAt(e.clientX, e.clientY)}
        onMouseLeave={() => {
          if (colorPickerEnabled) onSample(null);
        }}
      >
        {loadError ? (
          <span className="text-sm text-[#ef4444]">图片加载失败</span>
        ) : imageUrl ? (
          <>
            <div
              className={`relative flex items-center justify-center ${hasFit ? 'shrink-0' : 'max-w-full max-h-full'}`}
              style={{
                width: hasFit ? baseW * zoom : undefined,
                height: hasFit ? baseH * zoom : undefined,
                transform: panTransform,
                transformOrigin: 'center center',
              }}
            >
              <img
                ref={imgRef}
                src={imageUrl}
                alt={image?.name ?? ''}
                onLoad={onImgLoad}
                className={`block object-contain ${hasFit ? 'w-full h-full' : 'max-w-full max-h-full'}`}
                draggable={false}
              />
              {overlayUrl && (
                <img
                  src={overlayUrl}
                  alt="overlay"
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  draggable={false}
                />
              )}
            </div>
            {histogramEnabled && image && (
              <div className="absolute top-1 left-1 z-10">
                <HistogramOverlay imagePath={image.path} overlayImagePath={overlayPath ?? undefined} />
              </div>
            )}
            {watermarkConfig?.text && (
              <div
                className="absolute top-1 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
                style={{ color: watermarkConfig.color, fontSize: `${watermarkConfig.fontSize}px`, paddingTop: '4px' }}
              >
                {watermarkConfig.text}
              </div>
            )}
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-[#888888]">
              {imageIndex + 1}/{totalImages}
            </span>
            <span className="absolute bottom-1 right-1 text-xs text-[#888888]">{fitPercent}%</span>
          </>
        ) : (
          <span className="text-sm text-[#888888]">加载中...</span>
        )}

        <ColorReadout
          containerRef={imgContainerRef}
          sourceEl={imgRef.current}
          enabled={colorPickerEnabled}
          samplePos={samplePos}
          version={pickerVersion}
        />
      </div>
    </div>
  );
}
