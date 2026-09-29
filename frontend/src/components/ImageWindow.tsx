import { useEffect, useRef, useState } from 'react';
import type { SharedZoomApi } from '../hooks/useSharedZoom';
import type { SelectedFolder, WatermarkConfig } from '../types';
import type { FileEntry } from '../api';
import { fetchImageBlob, fetchHistogram, histogramCache } from '../api';
import { clientToUV, getContentBox, EYEDROPPER_CURSOR } from '../utils/colorSample';
import { isPointerInside } from '../utils/pointer';
import OverlayButtons from './OverlayButtons';
import HistogramOverlay from './HistogramOverlay';
import ColorReadout, { type SamplePos } from './ColorReadout';
import CopyableFileName from './CopyableFileName';
import { useI18n } from '../i18n';

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
  titlePosition?: 'top' | 'bottom';
  blindVote?: { alias: string; votedAlias: string | null; onVote: () => void } | null;
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
  titlePosition = 'top',
  blindVote,
}: ImageWindowProps) {
  const { t } = useI18n();
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
    // The handler is always registered; the target window is decided at key
    // press time from the actual pointer position (falling back to React's
    // hover state). This keeps the numeric-key overlay working even when
    // mouseenter/mouseleave did not fire (e.g. a modal closed under a
    // stationary cursor, or windows re-render after switching groups).
    const onKeyDown = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (!(num >= 1 && num <= allWindows.length && num - 1 !== index)) return;
      if (!isHovered && !isPointerInside(outerRef.current?.getBoundingClientRect())) return;
      const target = allWindows[num - 1];
      if (target?.image) setOverlayPath(target.image.path);
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

  // In the 2x2 grid the bottom row renders its title bar below the image so
  // the labels sit at the outer edges instead of crowding the middle.
  const header = (
    <div
      className={`flex items-center justify-between h-8 px-2 bg-[#252525] shrink-0 border-[#3c3c3c] ${
        titlePosition === 'bottom' ? 'border-t' : 'border-b'
      }`}
    >
      <span className="flex items-center gap-1 min-w-0 flex-1 mr-1">
        {image ? (
          <>
            <CopyableFileName name={image.name} className="text-xs text-[#e0e0e0]" />
            <span className="shrink-0 text-xs text-[#888888]" title={resolution}>
              {resolution}
            </span>
          </>
        ) : (
          <span className="text-xs text-[#e0e0e0] truncate">{t('window.noImage')}</span>
        )}
      </span>
      <OverlayButtons
        currentIndex={index}
        totalWindows={allWindows.length}
        allImages={allWindows.map((w) => w.image)}
        onOverlayStart={(path) => setOverlayPath(path)}
        onOverlayEnd={() => setOverlayPath(null)}
      />
    </div>
  );

  return (
    <div
      ref={outerRef}
      className="relative h-full w-full overflow-hidden bg-[#1e1e1e] flex flex-col select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); onMouseUp(); setOverlayPath(null); }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor }}
    >
      {titlePosition === 'top' && header}

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
          <span className="text-sm text-[#ef4444]">{t('window.imageLoadFailed')}</span>
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
            {!blindVote && (
              <span className="absolute bottom-1 right-1 text-xs text-[#888888]">{fitPercent}%</span>
            )}
            {blindVote && (
              <button
                type="button"
                title={t('window.vote')}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  blindVote.onVote();
                }}
                className={`absolute bottom-1 right-1 z-20 p-2 rounded-full transition-colors ${
                  blindVote.votedAlias === blindVote.alias
                    ? 'bg-[#ff8c00] text-white'
                    : 'text-[#e0e0e0] opacity-50 hover:opacity-100'
                }`}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill={blindVote.votedAlias === blindVote.alias ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 10v12" />
                  <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                </svg>
              </button>
            )}
          </>
        ) : (
          <span className="text-sm text-[#888888]">{t('common.loading')}</span>
        )}

        <ColorReadout
          containerRef={imgContainerRef}
          sourceEl={imgRef.current}
          enabled={colorPickerEnabled}
          samplePos={samplePos}
          version={pickerVersion}
        />
      </div>

      {titlePosition === 'bottom' && header}
    </div>
  );
}
