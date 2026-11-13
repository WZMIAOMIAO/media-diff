import { useEffect, useRef, useState } from 'react';
import { fetchVideoThumbnail } from '../../api/video';
import { useI18n } from '../../i18n';
import type { VideoEntry } from '../../types/video';

interface VideoThumbnailItemProps {
  video: VideoEntry;
  selected: boolean;
  /** True while the column is scrolling: defer expensive extraction until idle. */
  loadPaused?: boolean;
  onClick: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
}

function VideoThumbnailItem({ video, selected, loadPaused = false, onClick }: VideoThumbnailItemProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  // Path whose blob URL is currently in ``url`` (null when not loaded). Letting
  // a paused render keep the existing picture avoids flicker when scrolling
  // stops over an already-loaded row.
  const loadedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (video.missing) {
      loadedPathRef.current = null;
      setUrl(null);
      return;
    }
    if (loadedPathRef.current !== video.path) {
      loadedPathRef.current = null;
      setUrl(null);
    }
    // While the user is scrolling, don't start (or keep) extraction work: a
    // fast drag mounts and unmounts hundreds of rows, and each request would
    // otherwise queue behind the others. Load after the scroll goes idle.
    if (loadPaused || loadedPathRef.current === video.path) return;

    let cancelled = false;
    const controller = new AbortController();
    fetchVideoThumbnail(video.path, 200, { signal: controller.signal })
      .then(({ blobUrl }) => {
        if (cancelled) return;
        loadedPathRef.current = video.path;
        setUrl(blobUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [video.path, video.missing, loadPaused]);

  if (video.missing) {
    return (
      <div
        title={video.rel}
        className={`flex flex-col h-full px-1 pt-1 pb-0.5 border-b border-[#333333] border-l-2 ${
          selected ? 'bg-[#1f3a5f] border-l-[#4a9eff]' : 'border-l-transparent'
        }`}
      >
        <div className="flex-1 flex items-center justify-center min-h-0 m-1 border border-dashed border-[#3c3c3c] rounded">
          <span className="text-xs text-[#666666]">{t('item.noCounterpart')}</span>
        </div>
        <div className="truncate text-xs text-[#666666] mt-0.5" title={video.rel}>
          {video.rel}
        </div>
      </div>
    );
  }

  const showRel = !!video.rel && video.rel !== video.name;

  return (
    <div
      onClick={(e) =>
        onClick({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey })
      }
      title={video.rel ?? video.name}
      className={`flex flex-col h-full px-1 pt-1 pb-0.5 cursor-default border-b border-[#333333] ${
        selected
          ? 'bg-[#1f3a5f] border-l-2 border-l-[#4a9eff]'
          : 'hover:bg-[#333333] border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex-1 flex items-center justify-center min-h-0">
        {url ? (
          <img
            src={url}
            alt={video.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="w-full h-full bg-[#2a2a2a] flex items-center justify-center text-2xl opacity-40">
            🎬
          </div>
        )}
      </div>
      {showRel ? (
        <>
          <div className="truncate text-xs text-[#c0c0c0] mt-0.5" title={video.rel}>
            {video.name}
          </div>
          <div className="truncate text-[10px] text-[#888888]" title={video.rel}>
            {video.rel}
          </div>
        </>
      ) : (
        <div className="truncate text-xs text-[#c0c0c0] mt-0.5" title={video.name}>
          {video.name}
        </div>
      )}
    </div>
  );
}

export default VideoThumbnailItem;
