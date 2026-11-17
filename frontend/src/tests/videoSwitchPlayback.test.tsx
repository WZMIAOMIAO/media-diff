import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useVideoPlayer } from '../hooks/video/useVideoPlayer';
import type { SelectedFolder } from '../types';
import type { VideoEntry, VideoInfo } from '../types/video';

const folder: SelectedFolder = { path: '/v', name: 'v' };
const otherFolder: SelectedFolder = { path: '/w', name: 'w' };

const info: VideoInfo = {
  width: 1920,
  height: 1080,
  fps: 30,
  frame_count: 300,
  duration: 10,
  codec: 'h264',
  format: 'mp4',
};

function entry(name: string): VideoEntry {
  return { name, path: `/v/${name}`, rel: name };
}

function makeVideoEl() {
  return {
    currentTime: 0,
    duration: 10,
    paused: false,
    ended: false,
    seeking: false,
    readyState: 4,
    playbackRate: 1,
    muted: true,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  } as unknown as HTMLVideoElement;
}

function renderPlayer(
  initialVideos: Map<string, VideoEntry | null>,
  initialFolders: SelectedFolder[] = [folder],
) {
  const infos = new Map([
    [folder.path, info],
    [otherFolder.path, info],
  ]);
  return renderHook(
    ({
      folders,
      videos,
    }: {
      folders: SelectedFolder[];
      videos: Map<string, VideoEntry | null>;
    }) =>
      useVideoPlayer({
        selectedFolders: folders,
        currentVideos: videos,
        videoInfos: infos,
        canPlay: true,
      }),
    {
      initialProps: {
        folders: initialFolders,
        videos: initialVideos,
      },
    },
  );
}

describe('video switch playback intent', () => {
  it('keeps playing when switching to the next video while playing', () => {
    const el = makeVideoEl();
    const first = new Map([[folder.path, entry('a.mp4')]]);
    const second = new Map([[folder.path, entry('b.mp4')]]);
    const { result, rerender } = renderPlayer(first);
    act(() => result.current.registerVideoEl(folder.path, el));
    act(() => result.current.play());
    expect(result.current.isPlaying).toBe(true);

    act(() => rerender({ folders: [folder], videos: second }));

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.currentFrame).toBe(1);
    expect(el.pause).toHaveBeenCalled();
    expect(el.play).toHaveBeenCalledTimes(2);
  });

  it('stays paused when switching videos while paused', () => {
    const el = makeVideoEl();
    const first = new Map([[folder.path, entry('a.mp4')]]);
    const second = new Map([[folder.path, entry('b.mp4')]]);
    const { result, rerender } = renderPlayer(first);
    act(() => result.current.registerVideoEl(folder.path, el));

    act(() => rerender({ folders: [folder], videos: second }));

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentFrame).toBe(1);
    expect(el.play).not.toHaveBeenCalled();
  });


  it('resumes after a playing switch once a transcoding video becomes ready', () => {
    const el = makeVideoEl();
    const first = new Map([[folder.path, entry('a.mp4')]]);
    const second = new Map([[folder.path, entry('b.mp4')]]);
    const infos = new Map([[folder.path, info]]);
    const { result, rerender } = renderHook(
      ({
        videos,
        canPlay,
      }: {
        videos: Map<string, VideoEntry | null>;
        canPlay: boolean;
      }) =>
        useVideoPlayer({
          selectedFolders: [folder],
          currentVideos: videos,
          videoInfos: infos,
          canPlay,
        }),
      { initialProps: { videos: first, canPlay: true } },
    );
    act(() => result.current.registerVideoEl(folder.path, el));
    act(() => result.current.play());
    expect(result.current.isPlaying).toBe(true);

    act(() => rerender({ videos: second, canPlay: false }));
    expect(result.current.isPlaying).toBe(false);

    act(() => rerender({ videos: second, canPlay: true }));
    expect(result.current.isPlaying).toBe(true);
  });

  it('does not resume when the folder set changes during playback', () => {
    const el = makeVideoEl();
    const first = new Map([[folder.path, entry('a.mp4')]]);
    const expanded = new Map([
      [folder.path, entry('a.mp4')],
      [otherFolder.path, { name: 'c.mp4', path: '/w/c.mp4', rel: 'c.mp4' }],
    ]);
    const { result, rerender } = renderPlayer(first);
    act(() => result.current.registerVideoEl(folder.path, el));
    act(() => result.current.play());
    expect(result.current.isPlaying).toBe(true);

    act(() =>
      rerender({
        folders: [folder, otherFolder],
        videos: expanded,
      }),
    );

    expect(result.current.isPlaying).toBe(false);
  });
});
