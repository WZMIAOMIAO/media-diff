import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UseVideoCompareReturn } from '../../hooks/video/useVideoCompare';
import type { VideoPlayerApi } from '../../hooks/video/useVideoPlayer';
import { useSharedZoom } from '../../hooks/useSharedZoom';
import { clearFramesForOtherPaths, setPinnedFrames } from '../../api/video';
import type { WatermarkConfig } from '../../types';
import type { VideoEntry } from '../../types/video';
import type { SamplePos } from '../ColorReadout';
import VideoWindow from './VideoWindow';
import PlayerBar from './PlayerBar';
import { useI18n } from '../../i18n';

const PREFETCH_RANGE = 3;

interface VideoCompareAreaProps {
  compare: UseVideoCompareReturn;
  player: VideoPlayerApi;
  histogramEnabled: boolean;
  colorPickerEnabled: boolean;
  watermarkConfigs: Record<number, WatermarkConfig>;
}

interface WindowInfo {
  index: number;
  folderPath: string;
  video: VideoEntry | null;
}

function VideoCompareArea({ compare, player, histogramEnabled, colorPickerEnabled, watermarkConfigs }: VideoCompareAreaProps) {
  const { t } = useI18n();
  const sharedZoom = useSharedZoom();
  const { zoomByAt } = sharedZoom;
  const { selectedFolders, filteredVideos, currentVideos, videoInfos, nextVideo, prevVideo, blind } = compare;
  const [samplePos, setSamplePos] = useState<SamplePos | null>(null);

  const handleSample = useCallback((pos: SamplePos | null) => {
    setSamplePos(pos);
  }, []);

  useEffect(() => {
    if (!colorPickerEnabled) setSamplePos(null);
  }, [colorPickerEnabled]);

  const videosKey = useMemo(
    () =>
      selectedFolders
        .map((f) => `${f.path}:${currentVideos.get(f.path)?.path ?? ''}`)
        .join('|'),
    [selectedFolders, currentVideos],
  );

  // keyboard: ←/→ switch video, a/d step frame, space play/pause, ↑/↓ zoom
  // (zoom only while paused; playback resets to fit)
  const { stepFrame, togglePlay, isPlaying } = player;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevVideo();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextVideo();
      } else if (e.key === 'ArrowUp') {
        if (isPlaying) return;
        e.preventDefault();
        zoomByAt(1.15, null, null);
      } else if (e.key === 'ArrowDown') {
        if (isPlaying) return;
        e.preventDefault();
        zoomByAt(1 / 1.15, null, null);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        stepFrame(1);
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextVideo, prevVideo, stepFrame, togglePlay, zoomByAt, isPlaying]);

  // reset fit on video switch
  const { resetFit } = sharedZoom;
  useEffect(() => {
    resetFit();
  }, [videosKey, resetFit]);

  // zoom is not applied while playing, so reset to fit when playback starts:
  // pausing then keeps the fit size instead of jumping back to the old zoom.
  useEffect(() => {
    if (isPlaying) resetFit();
  }, [isPlaying, resetFit]);

  // free frame caches from videos no longer selected (without touching frames
  // of currently displayed videos)
  useEffect(() => {
    const keep = new Set<string>();
    for (const f of selectedFolders) {
      const v = currentVideos.get(f.path);
      if (v) keep.add(v.path);
    }
    clearFramesForOtherPaths(keep);
  }, [videosKey, selectedFolders, currentVideos]);

  // Pin the frames each visible window may currently display (currentFrame
  // +/- prefetch range) so the LRU cap never revokes a displayed frame.
  const { currentFrame } = player;
  useEffect(() => {
    const pinned = new Set<string>();
    for (const f of selectedFolders) {
      const v = currentVideos.get(f.path);
      if (!v) continue;
      for (let d = -PREFETCH_RANGE; d <= PREFETCH_RANGE; d++) {
        const fr = currentFrame + d;
        if (fr >= 1) pinned.add(`${v.path}@@${fr}`);
      }
    }
    setPinnedFrames(pinned);
  }, [selectedFolders, currentVideos, currentFrame]);

  if (selectedFolders.length === 0) {
    return (
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-[#1e1e1e]">
          <span className="text-sm text-[#888888]">{t('compare.emptyVideo')}</span>
        </div>
      </main>
    );
  }

  const blindName = blind ? blind.order[blind.index] : undefined;

  const allWindows: WindowInfo[] = selectedFolders.map((f, i) => {
    if (blind) {
      const order = (blindName && blind.displayOrders[blindName]) || selectedFolders.map((_, k) => k);
      const folder = selectedFolders[order[i] ?? i] ?? f;
      const video =
        (filteredVideos.get(folder.path) ?? []).find((v) => v.name === blindName) ?? null;
      return { index: i, folderPath: folder.path, video };
    }
    return { index: i, folderPath: f.path, video: currentVideos.get(f.path) ?? null };
  });

  const mainFps = videoInfos.get(selectedFolders[0].path)?.fps ?? 30;

  const renderWindow = (i: number) => {
    const w = allWindows[i];
    return (
      <VideoWindow
        // Key by visual position, not folder path: in blind mode the folder
        // shown in a window changes between groups, and re-keying would remount
        // the window (losing hover state, which breaks the numeric-key overlay).
        key={i}
        index={i}
        folderPath={w.folderPath}
        video={w.video}
        videoInfo={videoInfos.get(w.folderPath)}
        player={player}
        sharedZoom={sharedZoom}
        histogramEnabled={histogramEnabled}
        colorPickerEnabled={colorPickerEnabled}
        samplePos={samplePos}
        onSample={handleSample}
        watermarkConfig={watermarkConfigs[i]}
        allWindows={allWindows}
        titlePosition={selectedFolders.length === 4 && i >= 2 ? 'bottom' : 'top'}
        blindVote={
          blind && blindName && w.video
            ? {
                alias: blind.aliases[w.folderPath] ?? '',
                votedAlias: blind.votes.get(blindName) ?? null,
                onVote: () => {
                  const alias = blind.aliases[w.folderPath] ?? '';
                  const current = blind.votes.get(blindName) ?? null;
                  void blind.vote(blindName, current === alias ? null : alias);
                },
              }
            : null
        }
      />
    );
  };

  const windowsArea =
    selectedFolders.length === 4 ? (
      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-px bg-[#3c3c3c]">
        {renderWindow(0)}
        {renderWindow(1)}
        {renderWindow(2)}
        {renderWindow(3)}
      </div>
    ) : (
      <div className="flex-1 min-h-0 flex gap-px bg-[#3c3c3c]">
        {selectedFolders.map((_, i) => (
          <div key={i} className="flex-1 min-w-0">
            {renderWindow(i)}
          </div>
        ))}
      </div>
    );

  return (
    <main className="flex-1 min-w-0 flex flex-col">
      {windowsArea}
      <PlayerBar player={player} mainFps={mainFps} />
    </main>
  );
}

export default VideoCompareArea;
