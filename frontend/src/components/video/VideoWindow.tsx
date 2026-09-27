import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedZoomApi } from '../../hooks/useSharedZoom';
import type { VideoPlayerApi } from '../../hooks/video/useVideoPlayer';
import type { WatermarkConfig } from '../../types';
import type { VideoEntry, VideoInfo } from '../../types/video';
import { fetchVideoFrame } from '../../api/video';
import { getVideoStreamUrl } from '../../api/video';
import { clientToUV, getContentBox, EYEDROPPER_CURSOR } from '../../utils/colorSample';
import OverlayButtons from '../OverlayButtons';
import ColorReadout, { type SamplePos } from '../ColorReadout';
import VideoHistogramOverlay from './VideoHistogramOverlay';
import CopyableFileName from '../CopyableFileName';

interface WindowInfo {
  index: number;
  video: VideoEntry | null;
}

interface VideoWindowProps {
  index: number;
  folderPath: string;
  video: VideoEntry | null;
  videoInfo: VideoInfo | undefined;
  player: VideoPlayerApi;
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

const PREFETCH_RANGE = 3;

export default function VideoWindow({
  index,
  folderPath,
  video,
  videoInfo,
  player,
  sharedZoom,
  histogramEnabled,
  colorPickerEnabled,
  samplePos,
  onSample,
  watermarkConfig,
  allWindows,
  titlePosition = 'top',
  blindVote,
}: VideoWindowProps) {
  const { isPlaying, currentFrame, muted } = player;
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [overlayVideoPath, setOverlayVideoPath] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);

  const outerRef = useRef<HTMLDivElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; basePanX: number; basePanY: number } | null>(null);
  const zoomByAtRef = useRef(sharedZoom.zoomByAt);
  zoomByAtRef.current = sharedZoom.zoomByAt;

  // Stable ref callback: registerVideoEl is stable, so the callback identity
  // does not change on every render (avoids ref(null)/ref(el) churn).
  const registerVideoEl = player.registerVideoEl;
  const setVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      videoElRef.current = el;
      registerVideoEl(folderPath, el);
    },
    [registerVideoEl, folderPath],
  );

  const resolution =
    videoInfo && videoInfo.width > 0 ? `${videoInfo.width}×${videoInfo.height}` : '';
  const { zoom, panX, panY } = sharedZoom;
  const canDrag = zoom > 1 && !isPlaying;

  // load current frame when paused
  // Clamp currentFrame to this window's own frame_count so that when videos
  // have different lengths, the shorter one shows its last frame instead of
  // failing the extraction request.
  const effFrame =
    videoInfo?.frame_count && videoInfo.frame_count > 0
      ? Math.min(currentFrame, videoInfo.frame_count)
      : currentFrame;
  const loadedVideoPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (isPlaying || !video) {
      setFrameUrl(null);
      loadedVideoPathRef.current = null;
      return;
    }
    // When the video itself changes, clear the old frame immediately so the
    // (already-revoked) previous blob URL is never rendered as a broken image.
    if (loadedVideoPathRef.current !== video.path) {
      setFrameUrl(null);
      loadedVideoPathRef.current = video.path;
    }
    let cancelled = false;
    let retries = 0;
    setLoadError(false);
    setNaturalSize({ w: 0, h: 0 });
    const load = () => {
      if (cancelled) return;
      fetchVideoFrame(video.path, effFrame)
        .then(({ blobUrl }) => {
          if (cancelled) return;
          setFrameUrl(blobUrl);
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
    return () => {
      cancelled = true;
    };
  }, [video, effFrame, isPlaying]);

  // prefetch neighbor frames (paused only)
  useEffect(() => {
    if (isPlaying || !video) return;
    const maxFrame = videoInfo?.frame_count ?? 0;
    const toFetch: Array<{ path: string; frame: number }> = [];
    for (let d = -PREFETCH_RANGE; d <= PREFETCH_RANGE; d++) {
      let f = effFrame + d;
      if (f < 1) continue;
      if (maxFrame > 0 && f > maxFrame) f = maxFrame;
      toFetch.push({ path: video.path, frame: f });
    }
    for (const item of toFetch) {
      void fetchVideoFrame(item.path, item.frame).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.path, effFrame, isPlaying]);

  // overlay frame load
  useEffect(() => {
    if (!overlayVideoPath || isPlaying) {
      setOverlayUrl(null);
      return;
    }
    let cancelled = false;
    fetchVideoFrame(overlayVideoPath, effFrame)
      .then(({ blobUrl }) => {
        if (!cancelled) setOverlayUrl(blobUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [overlayVideoPath, effFrame, isPlaying]);

  // keyboard overlay (paused only)
  useEffect(() => {
    if (!isHovered || isPlaying) {
      setOverlayVideoPath(null);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= allWindows.length && num - 1 !== index) {
        const target = allWindows[num - 1];
        if (target?.video) setOverlayVideoPath(target.video.path);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 4) setOverlayVideoPath(null);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isHovered, allWindows, index, isPlaying]);

  // container size
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

  // wheel zoom (paused only)
  useEffect(() => {
    const el = outerRef.current;
    if (!el || isPlaying) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const container = imgContainerRef.current;
      const img = imgRef.current;
      if (!container || !img) return;
      const containerRect = container.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();
      const inBounds =
        e.clientX >= imgRect.left &&
        e.clientX <= imgRect.right &&
        e.clientY >= imgRect.top &&
        e.clientY <= imgRect.bottom;
      const centerX = inBounds ? e.clientX - containerRect.left - containerRect.width / 2 : null;
      const centerY = inBounds ? e.clientY - containerRect.top - containerRect.height / 2 : null;
      zoomByAtRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, centerX, centerY);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [isPlaying]);

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
    if (isPlaying) return;
    e.preventDefault();
    sharedZoom.resetFit();
  };
  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const sampleAt = (clientX: number, clientY: number) => {
    if (!colorPickerEnabled) return;
    const container = imgContainerRef.current;
    const el = isPlaying ? videoElRef.current : imgRef.current;
    if (!container || !el) return;
    const box = getContentBox(el, container);
    if (!box) return;
    onSample(clientToUV(box, container, clientX, clientY));
  };

  const srcW = naturalSize.w || videoInfo?.width || 0;
  const srcH = naturalSize.h || videoInfo?.height || 0;
  const fitRatio =
    srcW > 0 && srcH > 0 && containerSize.w > 0 && containerSize.h > 0
      ? Math.min(1, containerSize.w / srcW, containerSize.h / srcH)
      : 0;
  const fitPercent = fitRatio > 0 ? Math.round(fitRatio * zoom * 100) : Math.round(zoom * 100);
  const cursor = canDrag ? (dragRef.current ? 'grabbing' : 'grab') : 'default';
  const frameCount = videoInfo?.frame_count ?? 0;
  const mainVideoPath = allWindows.find((w) => w.video)?.video?.path ?? null;
  const isMainVideo = video != null && video.path === mainVideoPath;

  const pickerSource = isPlaying ? videoElRef.current : imgRef.current;
  const pickerVersion = `${zoom},${panX},${panY},${isPlaying},${frameUrl ?? ''}`;

  // Zoom is applied via layout size (width/height), NOT transform: scale().
  // A composited scale transform left the freshly-added overlay's raster stale
  // on some GPUs until the next repaint (visible as a mismatch only when
  // zoomed). Resizing the box forces a normal relayout/repaint instead.
  const hasFit = fitRatio > 0;
  const baseW = srcW * fitRatio;
  const baseH = srcH * fitRatio;
  const panTransform = `translate(${panX}px, ${panY}px)`;

  // In the 2x2 grid the bottom row renders its title bar below the image so
  // the labels sit at the outer edges instead of crowding the middle.
  const header = (
    <div
      className={`flex items-center justify-between h-8 px-2 bg-[#252525] shrink-0 border-[#3c3c3c] ${
        titlePosition === 'bottom' ? 'border-t' : 'border-b'
      }`}
    >
      <span className="flex items-center gap-1 min-w-0 flex-1 mr-1">
        {video ? (
          <>
            <CopyableFileName name={video.name} className="text-xs text-[#e0e0e0]" />
            <span className="shrink-0 text-xs text-[#888888]" title={resolution}>
              {resolution}
            </span>
          </>
        ) : (
          <span className="text-xs text-[#e0e0e0] truncate">无视频</span>
        )}
      </span>
      {!isPlaying && video && (
        <OverlayButtons
          currentIndex={index}
          totalWindows={allWindows.length}
          allImages={allWindows.map((w) => w.video)}
          onOverlayStart={(p) => setOverlayVideoPath(p)}
          onOverlayEnd={() => setOverlayVideoPath(null)}
        />
      )}
    </div>
  );

  return (
    <div
      ref={outerRef}
      className="relative h-full w-full overflow-hidden bg-[#1e1e1e] flex flex-col select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        onMouseUp();
      }}
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
        {/* video element: always mounted, visible only when playing */}
        {video && (
          <video
            src={getVideoStreamUrl(video.path)}
            ref={setVideoEl}
            onTimeUpdate={(e) => {
              player.onMainTimeUpdate(folderPath, e.currentTarget.currentTime);
            }}
            onEnded={() => player.onVideoEnded(folderPath)}
            playsInline
            muted={muted || !isMainVideo}
            className="max-w-full max-h-full object-contain"
            style={{ display: isPlaying ? 'block' : 'none' }}
          />
        )}

        {!isPlaying && video && (
          <>
            {loadError ? (
              <span className="text-sm text-[#ef4444]">抽帧失败</span>
            ) : frameUrl ? (
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
                    src={frameUrl}
                    alt={video.name}
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
                {histogramEnabled && (
                  <div className="absolute top-1 left-1 z-10">
                    <VideoHistogramOverlay
                      videoPath={video.path}
                      frame={effFrame}
                      overlayVideoPath={overlayVideoPath ?? undefined}
                      overlayFrame={overlayVideoPath ? effFrame : undefined}
                    />
                  </div>
                )}
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-[#888888]">
                  {effFrame}/{frameCount || effFrame}
                </span>
                {!blindVote && (
                  <span className="absolute bottom-1 right-1 text-xs text-[#888888]">{fitPercent}%</span>
                )}
              </>
            ) : (
              <span className="text-sm text-[#888888]">抽帧中...</span>
            )}
          </>
        )}

        {video && watermarkConfig?.text && (
          <div
            className="absolute top-1 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
            style={{
              color: watermarkConfig.color,
              fontSize: `${watermarkConfig.fontSize}px`,
              paddingTop: '4px',
            }}
          >
            {watermarkConfig.text}
          </div>
        )}

        {blindVote && video && (
          <button
            type="button"
            title="点赞（每组只能选一个）"
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

        <ColorReadout
          containerRef={imgContainerRef}
          sourceEl={pickerSource}
          enabled={colorPickerEnabled}
          samplePos={samplePos}
          version={pickerVersion}
        />
      </div>

      {titlePosition === 'bottom' && header}
    </div>
  );
}
