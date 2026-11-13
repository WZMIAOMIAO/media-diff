import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoThumbnailColumn from '../components/video/VideoThumbnailColumn';
import type { VideoEntry } from '../types/video';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../api/video', () => ({
  fetchVideoThumbnail: fetchMock,
}));

const originalClientHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientHeight',
);

const videos: VideoEntry[] = Array.from({ length: 100 }, (_, i) => ({
  name: `v${String(i).padStart(3, '0')}.mp4`,
  path: `/v/v${String(i).padStart(3, '0')}.mp4`,
  rel: `v${String(i).padStart(3, '0')}.mp4`,
}));

function renderColumn() {
  return render(
    <VideoThumbnailColumn
      folder={{ path: '/v', name: 'v' }}
      videos={videos}
      originalCount={videos.length}
      currentIndex={0}
      alignNonce={0}
      alignSourcePath={null}
      alignOffset={0}
      onSelect={() => {}}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalClientHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientHeight',
      originalClientHeight,
    );
  } else {
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  }
});

describe('video thumbnail scroll gating', () => {
  it('loads initial visible thumbnails but defers new ones while scrolling', () => {
    vi.useFakeTimers();
    const { container } = renderColumn();
    expect(fetchMock).toHaveBeenCalledTimes(6);

    fetchMock.mockClear();
    const el = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 10000,
    });
    act(() => {
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('aborts in-flight thumbnail requests when rows unmount', () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(
      (_path: string, _size?: number, options?: { signal?: AbortSignal }) => {
        if (options?.signal) signals.push(options.signal);
        return new Promise(() => {});
      },
    );
    const { unmount } = renderColumn();
    expect(signals).toHaveLength(6);
    expect(signals.every((s) => !s.aborted)).toBe(true);

    unmount();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});
