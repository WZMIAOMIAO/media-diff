import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedZoomApi } from '../../hooks/useSharedZoom';
import type { VideoPlayerApi } from '../../hooks/video/useVideoPlayer';
import type { WatermarkConfig } from '../../types';
import type { TranscodeStatus, VideoEntry, VideoInfo } from '../../types/video';
import { fetchVideoFrame } from '../../api/video';
import { getVideoStreamUrl } from '../../api/video';
import { getVideoTranscodeStatus, startVideoTranscode } from '../../api/video';
import { clientToUV, getContentBox, EYEDROPPER_CURSOR } from '../../utils/colorSample';
import { isPointerInside } from '../../utils/pointer';
import OverlayButtons from '../OverlayButtons';
import ColorReadout, { type SamplePos } from '../ColorReadout';
import VideoHistogramOverlay from './VideoHistogramOverlay';
import CopyableFileName from '../CopyableFileName';
import { useI18n } from '../../i18n';

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

// Minimum gap between rendering two *stale* (superseded) frames while the user
// holds A/D. Fresh target frames always render immediately; this only throttles
// the steady stream of intermediate frames so a long hold keeps advancing at a
// bounded lag instead of showing every (increasingly old) result or freezing.
const STALE_RENDER_INTERVAL_MS = 150;

/** Render fps without trailing zeros, e.g. 29.97 -> "29.97", 30 -> "30". */
function formatFps(fps: number): string {
  return String(parseFloat(fps.toFixed(2)));
}

/** Render seconds as m:ss, or h:mm:ss for videos of an hour or longer. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

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
  const { t } = useI18n();
  const { isPlaying, currentFrame, muted } = player;
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [overlayVideoPath, setOverlayVideoPath] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [transcode, setTranscode] = useState<TranscodeStatus | null>(null);
  const [frameTick, setFrameTick] = useState(0);

  const outerRef = useRef<HTMLDivElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; basePanX: number; basePanY: number } | null>(null);
  const zoomByAtRef = useRef(sharedZoom.zoomByAt);
  zoomByAtRef.current = sharedZoom.zoomByAt;

  // Frame loading is coalesced to one in-flight request per window: while a
  // request is running, newer steps just update `pendingFrameRef`, and the
  // latest frame is fetched when the current one finishes. This bounds ffmpeg
  // concurrency and always converges to the frame the user is on.
  const frameAbortRef = useRef<AbortController | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const frameLoadingRef = useRef(false);
  const frameRetriesRef = useRef(0);
  const inflightFrameRef = useRef<number | null>(null);
  const effFrameRef = useRef(0);
  const lastRenderRef = useRef(0);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const pumpFrameRef = useRef<() => void>(() => {});

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
  const fpsLabel = videoInfo && videoInfo.fps > 0 ? `${formatFps(videoInfo.fps)} fps` : '';
  const codecLabel = videoInfo?.codec ? videoInfo.codec : '';
  const durationLabel =
    videoInfo && videoInfo.duration > 0 ? formatDuration(videoInfo.duration) : '';
  const metaParts = [resolution, fpsLabel, codecLabel, durationLabel].filter(Boolean);
  const metaShort = metaParts.join(' · ');
  const metaTooltip =
    [
      resolution && `${t('videoMeta.resolution')} ${resolution}`,
      fpsLabel && `${t('videoMeta.fps')} ${fpsLabel}`,
      codecLabel && `${t('videoMeta.codec')} ${codecLabel}`,
      durationLabel && `${t('videoMeta.duration')} ${durationLabel}`,
      videoInfo && videoInfo.frame_count > 0
        ? `${t('videoMeta.frames')} ${videoInfo.frame_count}`
        : '',
      videoInfo?.format ? `${t('videoMeta.format')} ${videoInfo.format}` : '',
    ]
      .filter(Boolean)
      .join(' · ') || t('videoMeta.unavailable');
  const { zoom, panX, panY } = sharedZoom;
  const canDrag = zoom > 1 && !isPlaying;

  // The browser cannot decode this codec, so the backend transcodes it first.
  const needsTranscode = !!video && videoInfo?.browser_playable === false;
  const transcodeDone = !needsTranscode || transcode?.state === 'done';
  const transcodeFailed = needsTranscode && transcode?.state === 'error';
  const videoPath = video?.path ?? null;

  // Kick off / join the background transcode and poll its progress so the user
  // sees "正在转码 x%" instead of a silently hanging player.
  useEffect(() => {
    if (!videoPath || !needsTranscode) {
      setTranscode(null);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const status = await getVideoTranscodeStatus(videoPath);
        if (cancelled) return;
        setTranscode(status);
        if (status.state !== 'done' && status.state !== 'error') {
          timer = window.setTimeout(poll, 500);
        }
      } catch {
        if (cancelled) return;
        timer = window.setTimeout(poll, 1000);
      }
    };
    void startVideoTranscode(videoPath).catch(() => {});
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [videoPath, needsTranscode]);

  // load current frame when paused
  // Clamp currentFrame to this window's own frame_count so that when videos
  // have different lengths, the shorter one shows its last frame instead of
  // failing the extraction request.
  const effFrame =
    videoInfo?.frame_count && videoInfo.frame_count > 0
      ? Math.min(currentFrame, videoInfo.frame_count)
      : currentFrame;
  effFrameRef.current = effFrame;
  const loadedVideoPathRef = useRef<string | null>(null);

  // Assign the pump on every render so its async callbacks always see the
  // latest props/state (video, isPlaying, ...).
  pumpFrameRef.current = () => {
    if (isPlaying || !video) return;
    if (frameLoadingRef.current) return; // coalesce: latest pending wins
    const frame = pendingFrameRef.current;
    if (frame === null) return;
    pendingFrameRef.current = null;
    frameLoadingRef.current = true;
    inflightFrameRef.current = frame;
    const controller = new AbortController();
    frameAbortRef.current = controller;
    void fetchVideoFrame(video.path, frame, { signal: controller.signal })
      .then(({ blobUrl }) => {
        frameLoadingRef.current = false;
        inflightFrameRef.current = null;
        if (controller.signal.aborted) return;
        // While holding A/D the user keeps moving on, so most results arrive
        // "stale". Rendering every one makes the picture lag; rendering none
        // freezes it. Render the current target immediately, and stale results
        // only every STALE_RENDER_INTERVAL_MS so a long hold keeps updating at a
        // coarse, lag-bounded rate instead of getting stuck on one frame.
        const now = performance.now();
        const isCurrent = frame === effFrameRef.current;
        if (!isCurrent && now - lastRenderRef.current < STALE_RENDER_INTERVAL_MS) {
          pumpFrameRef.current();
          return;
        }
        lastRenderRef.current = now;
        frameRetriesRef.current = 0;
        setFrameUrl(blobUrl);
        setLoadError(false);
        setFrameTick((t) => t + 1);
        pumpFrameRef.current();
      })
      .catch(() => {
        frameLoadingRef.current = false;
        inflightFrameRef.current = null;
        if (controller.signal.aborted) {
          // Cancelled because it was superseded; continue with the target.
          pumpFrameRef.current();
          return;
        }
        if (frameRetriesRef.current < 3) {
          frameRetriesRef.current += 1;
          if (pendingFrameRef.current === null) pendingFrameRef.current = frame;
          pumpFrameRef.current();
        } else {
          setLoadError(true);
        }
      });
  };

  // Reset when the video changes or playback starts/stops: cancel any in-flight
  // extraction (its blob would be for the wrong video / play state).
  useEffect(() => {
    frameAbortRef.current?.abort();
    frameAbortRef.current = null;
    frameLoadingRef.current = false;
    inflightFrameRef.current = null;
    pendingFrameRef.current = null;
    frameRetriesRef.current = 0;
    if (!video || isPlaying) {
      setFrameUrl(null);
      loadedVideoPathRef.current = null;
      return;
    }
    if (loadedVideoPathRef.current !== video.path) {
      loadedVideoPathRef.current = video.path;
      setFrameUrl(null);
      setNaturalSize({ w: 0, h: 0 });
    }
    setLoadError(false);
  }, [video, isPlaying]);

  // Queue the current frame. Consecutive steps while a fetch is in flight are
  // coalesced by the pump.
  useEffect(() => {
    if (isPlaying || !video) return;
    pendingFrameRef.current = effFrame;
    pumpFrameRef.current();
  }, [video, effFrame, isPlaying]);

  // Once stepping stops (short idle), cancel any in-flight extraction that is
  // still on an older frame and fetch the final target immediately. Without
  // this the user waits for the stale request to finish *and* another one,
  // which is what made holding A/D feel stuck on intermediate frames.
  useEffect(() => {
    if (isPlaying || !video) return;
    const timer = window.setTimeout(() => {
      if (!frameLoadingRef.current) return;
      if (inflightFrameRef.current === null) return;
      if (inflightFrameRef.current === effFrame) return;
      pendingFrameRef.current = effFrame;
      frameAbortRef.current?.abort();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [video, effFrame, isPlaying]);

  // Prefetch neighbor frames, but only after the current frame has settled and
  // after a short idle delay, so it never competes with the frame being viewed.
  useEffect(() => {
    if (isPlaying || !video) return;
    const maxFrame = videoInfo?.frame_count ?? 0;
    const videoPath = video.path;
    const timer = window.setTimeout(() => {
      if (frameLoadingRef.current || pendingFrameRef.current !== null) return;
      const controller = new AbortController();
      prefetchAbortRef.current = controller;
      for (let d = -PREFETCH_RANGE; d <= PREFETCH_RANGE; d++) {
        if (d === 0) continue;
        let f = effFrame + d;
        if (f < 1) continue;
        if (maxFrame > 0 && f > maxFrame) f = maxFrame;
        void fetchVideoFrame(videoPath, f, { signal: controller.signal }).catch(() => {});
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      prefetchAbortRef.current?.abort();
      prefetchAbortRef.current = null;
    };
  }, [video, effFrame, isPlaying, videoInfo?.frame_count, frameTick]);

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

  // keyboard overlay (paused only). Always registered; the target window is
  // decided at key press time from the actual pointer position (falling back
  // to React hover), so it survives windows re-rendering after group switches.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isPlaying) return;
      const num = parseInt(e.key, 10);
      if (!(num >= 1 && num <= allWindows.length && num - 1 !== index)) return;
      if (!isHovered && !isPointerInside(outerRef.current?.getBoundingClientRect())) return;
      const target = allWindows[num - 1];
      if (target?.video) setOverlayVideoPath(target.video.path);
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
            <span
              className="shrink min-w-0 truncate text-xs text-[#888888]"
              title={metaTooltip}
            >
              {metaShort || '—'}
            </span>
            {needsTranscode && (
              <span
                className={`shrink-0 rounded px-1 text-[10px] leading-4 ${
                  transcodeFailed
                    ? 'bg-[#7f1d1d] text-[#fca5a5]'
                    : 'bg-[#78350f] text-[#fbbf24]'
                }`}
                title={
                  transcodeFailed
                    ? t('window.transcodeFailed')
                    : t('window.codecUnsupported')
                }
              >
                {transcodeFailed
                  ? t('window.transcodeFailed')
                  : t('window.codecUnsupported')}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-[#e0e0e0] truncate">{t('window.noVideo')}</span>
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
        setOverlayVideoPath(null);
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
            src={transcodeDone ? getVideoStreamUrl(video.path) : undefined}
            ref={setVideoEl}
            onTimeUpdate={(e) => {
              player.onMainTimeUpdate(folderPath, e.currentTarget.currentTime);
            }}
            onCanPlay={(e) => {
              // Only needed when the user already pressed play while the video
              // was still loading (e.g. waiting for a transcode). If it is
              // already playing, doing anything here would re-issue play() and
              // (via the player) re-seek all windows mid-playback, causing
              // stutter whenever the browser fires `canplay` after buffering.
              if (isPlaying && e.currentTarget.paused) {
                e.currentTarget.playbackRate = player.speed;
                void e.currentTarget.play().catch(() => {});
              }
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
              <span className="text-sm text-[#ef4444]">{t('window.frameExtractFailed')}</span>
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
              <span className="text-sm text-[#888888]">{t('window.frameExtracting')}</span>
            )}
          </>
        )}

        {needsTranscode && !transcodeDone && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/50 px-4 text-center">
            {transcodeFailed ? (
              <span className="text-sm text-[#ef4444]">
                {t('window.transcodeFailed')}
              </span>
            ) : (
              <>
                <span className="text-sm text-[#e0e0e0]">
                  {t('window.transcodeProgress', {
                    percent: Math.round((transcode?.progress ?? 0) * 100),
                  })}
                </span>
                <div className="h-1 w-40 max-w-full overflow-hidden rounded-full bg-[#3c3c3c]">
                  <div
                    className="h-full bg-[#ff8c00] transition-[width] duration-200"
                    style={{ width: `${Math.round((transcode?.progress ?? 0) * 100)}%` }}
                  />
                </div>
              </>
            )}
          </div>
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
