import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoEntry, VideoInfo } from '../../types/video';
import type { SelectedFolder } from '../../types';

export interface VideoPlayerApi {
  isPlaying: boolean;
  currentFrame: number;
  speed: number;
  loop: boolean;
  muted: boolean;
  baseFrameCount: number;
  registerVideoEl: (folderPath: string, el: HTMLVideoElement | null) => void;
  setSpeed: (s: number) => void;
  setLoop: (b: boolean) => void;
  setMuted: (m: boolean) => void;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  stepFrame: (delta: number) => void;
  seekToFrame: (frame: number) => void;
  setCurrentFrame: (frame: number) => void;
  onMainTimeUpdate: (folderPath: string, time: number) => void;
  onVideoEnded: (folderPath: string) => void;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];

// Cross-window playback sync. Each window has its own <video> element, so they
// decode independently and slowly drift apart. The main video is the time
// reference; the others are steered by a proportional controller on
// playbackRate (smooth, no hard seek during playback).
const SYNC_INTERVAL_MS = 150;
const SYNC_DEADBAND_SEC = 0.03; // ignore drift below ~1 frame
const SYNC_GAIN = 1; // fractional rate change per second of drift
const SYNC_MAX_ADJUST = 0.2; // clamp on the fractional rate change

interface PlayerDeps {
  selectedFolders: SelectedFolder[];
  currentVideos: Map<string, VideoEntry | null>;
  videoInfos: Map<string, VideoInfo>;
}

export function useVideoPlayer(deps: PlayerDeps): VideoPlayerApi {
  const { selectedFolders, currentVideos, videoInfos } = deps;
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrameState] = useState(1);
  const [speed, setSpeedState] = useState(1);
  const [loop, setLoopState] = useState(true);
  const [muted, setMutedState] = useState(true);

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;

  // Only the main video (first folder that has a video) is allowed to produce
  // sound; every other window stays muted to avoid overlapping audio.
  const mainPath =
    selectedFolders.find((f) => currentVideos.get(f.path))?.path ?? null;
  const mainPathRef = useRef<string | null>(mainPath);
  mainPathRef.current = mainPath;

  const applyMuted = useCallback(() => {
    for (const [folderPath, el] of videoRefs.current) {
      el.muted = mutedRef.current || folderPath !== mainPathRef.current;
    }
  }, []);

  const registerVideoEl = useCallback(
    (folderPath: string, el: HTMLVideoElement | null) => {
      if (el) {
        videoRefs.current.set(folderPath, el);
        el.playbackRate = speedRef.current;
        el.muted = mutedRef.current || folderPath !== mainPathRef.current;
      } else {
        videoRefs.current.delete(folderPath);
      }
    },
    [],
  );

  // keep every video element's muted flag in sync with the toggle / main video
  useEffect(() => {
    applyMuted();
  }, [muted, mainPath, applyMuted]);

  // Keep non-main videos aligned with the main video during playback via a
  // proportional controller on playbackRate: the correction is proportional to
  // the drift, so it converges smoothly without toggling and never seeks
  // (a seek during playback would visibly freeze that window).
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      const main = mainPathRef.current;
      if (!main) return;
      const mainEl = videoRefs.current.get(main);
      if (!mainEl || mainEl.paused) return;
      const t = mainEl.currentTime;
      for (const [folderPath, el] of videoRefs.current) {
        // Skip a window that is already seeking or still buffering; it will be
        // caught up once it resumes.
        if (folderPath === main || el.paused || el.seeking || el.readyState < 2) {
          continue;
        }
        const drift = el.currentTime - t;
        let rate = speedRef.current;
        if (Math.abs(drift) > SYNC_DEADBAND_SEC) {
          // Behind (drift < 0) -> speed up; ahead (drift > 0) -> slow down.
          const adjust = Math.max(
            -SYNC_MAX_ADJUST,
            Math.min(SYNC_MAX_ADJUST, -SYNC_GAIN * drift),
          );
          rate = speedRef.current * (1 + adjust);
        }
        if (el.playbackRate !== rate) el.playbackRate = rate;
      }
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  const baseFrameCount = (() => {
    let m = 0;
    for (const f of selectedFolders) {
      const info = videoInfos.get(f.path);
      if (info && info.frame_count > m) m = info.frame_count;
    }
    return m;
  })();

  const seekAllVideos = useCallback(
    (frame: number) => {
      for (const f of selectedFolders) {
        const el = videoRefs.current.get(f.path);
        const info = videoInfos.get(f.path);
        if (!el || !info || info.fps <= 0) continue;
        const maxFrame = info.frame_count;
        const clampedFrame = Math.max(1, Math.min(frame, maxFrame));
        const t = (clampedFrame - 1) / info.fps;
        if (Math.abs(el.currentTime - t) > 0.02) {
          el.currentTime = t;
        }
      }
    },
    [selectedFolders, videoInfos],
  );

  const setCurrentFrame = useCallback((frame: number) => {
    const clamped = Math.max(1, frame);
    currentFrameRef.current = clamped;
    setCurrentFrameState(clamped);
  }, []);

  const play = useCallback(() => {
    setIsPlaying(true);
    isPlayingRef.current = true;
    for (const el of videoRefs.current.values()) {
      el.playbackRate = speedRef.current;
      void el.play().catch(() => {});
    }
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    for (const el of videoRefs.current.values()) {
      el.pause();
      el.playbackRate = speedRef.current;
    }
    const main = selectedFolders.find((f) => currentVideos.get(f.path));
    if (main) {
      const el = videoRefs.current.get(main.path);
      const info = videoInfos.get(main.path);
      if (el && info && info.fps > 0) {
        const frame = Math.round(el.currentTime * info.fps) + 1;
        setCurrentFrame(Math.min(frame, info.frame_count || frame));
        seekAllVideos(frame);
      }
    }
  }, [selectedFolders, currentVideos, videoInfos, setCurrentFrame, seekAllVideos]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  const seekToFrame = useCallback(
    (frame: number) => {
      const clamped = Math.max(1, Math.min(frame, baseFrameCount || frame));
      setCurrentFrame(clamped);
      seekAllVideos(clamped);
      setIsPlaying(false);
      isPlayingRef.current = false;
      for (const el of videoRefs.current.values()) el.pause();
    },
    [baseFrameCount, setCurrentFrame, seekAllVideos],
  );

  const stepFrame = useCallback(
    (delta: number) => {
      const next = Math.max(1, currentFrameRef.current + delta);
      seekToFrame(next);
    },
    [seekToFrame],
  );

  const onMainTimeUpdate = useCallback(
    (folderPath: string, time: number) => {
      if (!isPlayingRef.current) return;
      const main = selectedFolders.find((f) => currentVideos.get(f.path));
      if (!main || main.path !== folderPath) return;
      const info = videoInfos.get(main.path);
      if (!info || info.fps <= 0) return;
      const frame = Math.round(time * info.fps) + 1;
      const clamped = Math.max(1, Math.min(frame, info.frame_count || frame));
      setCurrentFrameState(clamped);
      currentFrameRef.current = clamped;
    },
    [selectedFolders, currentVideos, videoInfos],
  );

  const onVideoEnded = useCallback(
    (folderPath: string) => {
      const main = selectedFolders.find((f) => currentVideos.get(f.path));
      if (!main || main.path !== folderPath) return;
      if (loopRef.current) {
        for (const el of videoRefs.current.values()) {
          el.currentTime = 0;
          void el.play().catch(() => {});
        }
      } else {
        setIsPlaying(false);
        isPlayingRef.current = false;
        for (const el of videoRefs.current.values()) el.pause();
      }
    },
    [selectedFolders, currentVideos],
  );

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
    speedRef.current = s;
    for (const el of videoRefs.current.values()) {
      el.playbackRate = s;
    }
  }, []);

  const setLoop = useCallback((b: boolean) => {
    setLoopState(b);
    loopRef.current = b;
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    mutedRef.current = m;
    for (const [folderPath, el] of videoRefs.current) {
      el.muted = m || folderPath !== mainPathRef.current;
    }
  }, []);

  // when current video changes (switch), reset to frame 1 and pause
  const videosKey = selectedFolders
    .map((f) => `${f.path}:${currentVideos.get(f.path)?.path ?? ''}`)
    .join('|');
  useEffect(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    setCurrentFrame(1);
    seekAllVideos(1);
    for (const el of videoRefs.current.values()) el.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videosKey]);

  // clamp current frame when base frame count shrinks
  useEffect(() => {
    if (currentFrame > baseFrameCount && baseFrameCount > 0) {
      setCurrentFrame(baseFrameCount);
    }
  }, [baseFrameCount, currentFrame, setCurrentFrame]);

  return {
    isPlaying,
    currentFrame,
    speed,
    loop,
    muted,
    baseFrameCount,
    registerVideoEl,
    setSpeed,
    setLoop,
    setMuted,
    togglePlay,
    play,
    pause,
    stepFrame,
    seekToFrame,
    setCurrentFrame,
    onMainTimeUpdate,
    onVideoEnded,
  };
}

export { SPEEDS };
