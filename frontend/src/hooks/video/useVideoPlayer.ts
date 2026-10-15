import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoEntry, VideoInfo } from '../../types/video';
import type { SelectedFolder } from '../../types';

export interface VideoPlayerApi {
  isPlaying: boolean;
  currentFrame: number;
  speed: number;
  loop: boolean;
  autoNext: boolean;
  muted: boolean;
  baseFrameCount: number;
  /** Frame rate of the reference (main) video; the shared frame index is in it. */
  refFps: number;
  registerVideoEl: (folderPath: string, el: HTMLVideoElement | null) => void;
  setSpeed: (s: number) => void;
  setLoop: (b: boolean) => void;
  /** Toggle auto-advance to the next video on end (turns loop off when on). */
  setAutoNext: (b: boolean) => void;
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
// playbackRate (smooth, no hard seek during playback). Small drift is nudged
// back with playbackRate, but once a window falls further behind than
// SYNC_HARD_SEEK_SEC (a stall, a buffer wait, or a restart after rapid
// play/pause toggling) a rate nudge of ±20% can never catch up, so it is
// re-aligned with a hard seek instead.
const SYNC_INTERVAL_MS = 150;
const SYNC_DEADBAND_SEC = 0.03; // ignore drift below ~1 frame
const SYNC_GAIN = 1; // fractional rate change per second of drift
const SYNC_MAX_ADJUST = 0.2; // clamp on the fractional rate change
const SYNC_HARD_SEEK_SEC = 0.12; // beyond this drift a rate nudge cannot recover

interface PlayerDeps {
  selectedFolders: SelectedFolder[];
  currentVideos: Map<string, VideoEntry | null>;
  videoInfos: Map<string, VideoInfo>;
  /** Advance to the next video; returns true if it actually moved. */
  onAutoNext?: () => boolean;
}

export function useVideoPlayer(deps: PlayerDeps): VideoPlayerApi {
  const { selectedFolders, currentVideos, videoInfos, onAutoNext } = deps;
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrameState] = useState(1);
  const [speed, setSpeedState] = useState(1);
  const [loop, setLoopState] = useState(true);
  const [autoNext, setAutoNextState] = useState(false);
  const [muted, setMutedState] = useState(true);

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const autoNextRef = useRef(autoNext);
  autoNextRef.current = autoNext;
  const onAutoNextRef = useRef(onAutoNext);
  onAutoNextRef.current = onAutoNext;
  // Set when a video ends with auto-next on; the switch effect below reads it
  // to start playing the newly selected video instead of pausing.
  const autoPlayPendingRef = useRef(false);
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

  // The shared frame index is expressed in the reference (main) video's frame
  // rate. Videos in a comparison can have different fps (e.g. a 24 fps original
  // vs a 60 fps re-encode of the same clip), so the same frame N maps to a
  // different time in each. Every frame<->time conversion therefore goes
  // through refFps; each window converts to its own frame index for extraction.
  const mainInfo = mainPath ? videoInfos.get(mainPath) : undefined;
  const refFps = mainInfo && mainInfo.fps > 0 ? mainInfo.fps : 30;

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

  // Keep non-main videos aligned with the main video during playback. Small
  // drift is corrected smoothly via playbackRate (no visible seek); large drift
  // is corrected with a hard seek so a stalled/restarted window can never stay
  // permanently out of sync. A window left paused mid-playback (its play() was
  // dropped during a rapid play→pause→play toggle) is re-aligned and resumed.
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      const main = mainPathRef.current;
      if (!main) return;
      const mainEl = videoRefs.current.get(main);
      if (!mainEl || mainEl.paused) return;
      const t = mainEl.currentTime;
      for (const [folderPath, el] of videoRefs.current) {
        if (folderPath === main || el.readyState < 2) continue;
        // A window whose play() was dropped/rejected would otherwise sit frozen
        // and drift away during the whole playback. Resume it if it still has
        // runway; leave a shorter video resting on its own last frame.
        if (el.paused) {
          if (el.ended || (el.duration && t >= el.duration)) continue;
          if (Math.abs(el.currentTime - t) > SYNC_DEADBAND_SEC) el.currentTime = t;
          el.playbackRate = speedRef.current;
          void el.play().catch(() => {});
          continue;
        }
        // Wait out an in-flight seek; re-align once it settles.
        if (el.seeking) continue;
        const drift = el.currentTime - t;
        if (Math.abs(drift) > SYNC_HARD_SEEK_SEC) {
          // Too far gone for a rate nudge; jump straight to the reference.
          el.currentTime = t;
          if (el.playbackRate !== speedRef.current) el.playbackRate = speedRef.current;
          continue;
        }
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
    // The slider is in reference frames; use the main video's frame count so it
    // matches the frame index onMainTimeUpdate produces (max across folders
    // would be in the wrong units and leave a dead zone on the slider).
    if (mainInfo && mainInfo.frame_count > 0) return mainInfo.frame_count;
    let m = 0;
    for (const f of selectedFolders) {
      const info = videoInfos.get(f.path);
      if (info && info.frame_count > m) m = info.frame_count;
    }
    return m;
  })();

  const seekAllVideos = useCallback(
    (frame: number) => {
      // frame is in reference frames; seek every window to that wall-clock time
      // (clamped to each video's own duration) so all windows show the same
      // moment regardless of their individual fps.
      const t = (Math.max(1, frame) - 1) / refFps;
      for (const f of selectedFolders) {
        const el = videoRefs.current.get(f.path);
        const info = videoInfos.get(f.path);
        if (!el || !info) continue;
        const dur = el.duration || info.duration || 0;
        const seekT = dur > 0 ? Math.min(t, Math.max(0, dur - 0.02)) : t;
        if (Math.abs(el.currentTime - seekT) > 0.02) {
          el.currentTime = seekT;
        }
      }
    },
    [selectedFolders, videoInfos, refFps],
  );

  const setCurrentFrame = useCallback((frame: number) => {
    const clamped = Math.max(1, frame);
    currentFrameRef.current = clamped;
    setCurrentFrameState(clamped);
  }, []);

  const play = useCallback(() => {
    // The paused view is an ffmpeg-extracted image; stepping while paused no
    // longer seeks the <video> elements, so position them right before playing.
    seekAllVideos(currentFrameRef.current);
    setIsPlaying(true);
    isPlayingRef.current = true;
    for (const el of videoRefs.current.values()) {
      el.playbackRate = speedRef.current;
      void el.play().catch(() => {});
    }
  }, [seekAllVideos]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    for (const el of videoRefs.current.values()) {
      el.pause();
      el.playbackRate = speedRef.current;
    }
    // Record where the main video stopped so the paused view (an ffmpeg frame)
    // and the next play() land on the same frame. Deliberately do NOT seek the
    // <video> elements here: while rapidly toggling, the main element may still
    // be buffering near time 0, and seeking every window to it would yank the
    // windows that are already ahead back to the start. play() repositions them.
    const main = selectedFolders.find((f) => currentVideos.get(f.path));
    if (main) {
      const el = videoRefs.current.get(main.path);
      const info = videoInfos.get(main.path);
      if (el && info && info.fps > 0) {
        const frame = Math.round(el.currentTime * refFps) + 1;
        setCurrentFrame(Math.min(frame, baseFrameCount || frame));
      }
    }
  }, [selectedFolders, currentVideos, videoInfos, refFps, baseFrameCount, setCurrentFrame]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  const seekToFrame = useCallback(
    (frame: number) => {
      // Only move the frame counter here. The paused view is an ffmpeg-extracted
      // image; the <video> elements are positioned by the debounced sync effect
      // below. Seeking every <video> per progress-bar `onChange` (which fires
      // continuously while dragging) was the main cause of drag jank.
      const clamped = Math.max(1, Math.min(frame, baseFrameCount || frame));
      setCurrentFrame(clamped);
      setIsPlaying(false);
      isPlayingRef.current = false;
      for (const el of videoRefs.current.values()) el.pause();
    },
    [baseFrameCount, setCurrentFrame],
  );

  const stepFrame = useCallback(
    (delta: number) => {
      // Only advance the frame counter here. Seeking every <video> on each step
      // is expensive under rapid A/D; the position is synced separately below
      // (debounced) so pressing play starts without a seek stall.
      const max = baseFrameCount > 0 ? baseFrameCount : Number.MAX_SAFE_INTEGER;
      const next = Math.max(1, Math.min(currentFrameRef.current + delta, max));
      setCurrentFrame(next);
      setIsPlaying(false);
      isPlayingRef.current = false;
      for (const el of videoRefs.current.values()) el.pause();
    },
    [baseFrameCount, setCurrentFrame],
  );

  // Position the paused <video> elements at the current frame once stepping /
  // scrubbing settles. Doing it here (debounced, off the interaction path) keeps
  // dragging smooth while ensuring `play()` starts immediately instead of
  // stalling on a seek. During playback this effect does nothing.
  useEffect(() => {
    if (isPlaying) return;
    const frame = currentFrame;
    const timer = window.setTimeout(() => {
      if (!isPlayingRef.current) seekAllVideos(frame);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentFrame, isPlaying, seekAllVideos]);

  const onMainTimeUpdate = useCallback(
    (folderPath: string, time: number) => {
      if (!isPlayingRef.current) return;
      const main = selectedFolders.find((f) => currentVideos.get(f.path));
      if (!main || main.path !== folderPath) return;
      const frame = Math.round(time * refFps) + 1;
      const clamped = Math.max(1, Math.min(frame, baseFrameCount || frame));
      setCurrentFrameState(clamped);
      currentFrameRef.current = clamped;
    },
    [selectedFolders, currentVideos, refFps, baseFrameCount],
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
        return;
      }
      // Auto-advance: only if it actually moves to another video, otherwise
      // fall through to a normal pause (end of the list).
      if (autoNextRef.current && onAutoNextRef.current?.()) {
        autoPlayPendingRef.current = true;
        return;
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
      for (const el of videoRefs.current.values()) el.pause();
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

  // Loop and auto-next are mutually exclusive: the last one switched on wins.
  const setLoop = useCallback((b: boolean) => {
    setLoopState(b);
    loopRef.current = b;
    if (b) {
      setAutoNextState(false);
      autoNextRef.current = false;
    }
  }, []);

  const setAutoNext = useCallback((b: boolean) => {
    setAutoNextState(b);
    autoNextRef.current = b;
    if (b) {
      setLoopState(false);
      loopRef.current = false;
    }
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    mutedRef.current = m;
    for (const [folderPath, el] of videoRefs.current) {
      el.muted = m || folderPath !== mainPathRef.current;
    }
  }, []);

  // when current video changes (switch), reset to frame 1. Normally pause;
  // when the switch was triggered by auto-next, start playing instead.
  const videosKey = selectedFolders
    .map((f) => `${f.path}:${currentVideos.get(f.path)?.path ?? ''}`)
    .join('|');
  useEffect(() => {
    const autoPlay = autoPlayPendingRef.current;
    autoPlayPendingRef.current = false;
    setIsPlaying(false);
    isPlayingRef.current = false;
    setCurrentFrame(1);
    seekAllVideos(1);
    for (const el of videoRefs.current.values()) el.pause();
    if (autoPlay) play();
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
    autoNext,
    muted,
    baseFrameCount,
    refFps,
    registerVideoEl,
    setSpeed,
    setLoop,
    setAutoNext,
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
