import { useEffect, useState } from 'react';
import { fetchVideoThumbnail } from '../../api/video';
import { useI18n } from '../../i18n';
import type { VideoEntry } from '../../types/video';

interface VideoThumbnailItemProps {
  video: VideoEntry;
  selected: boolean;
  onClick: (e: { ctrlKey: boolean; metaKey: boolean }) => void;
}

function VideoThumbnailItem({ video, selected, onClick }: VideoThumbnailItemProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (video.missing) {
      setUrl(null);
      return;
    }
    setUrl(null);
    fetchVideoThumbnail(video.path)
      .then(({ blobUrl }) => {
        if (!cancelled) setUrl(blobUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [video.path, video.missing]);

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
      onClick={(e) => onClick({ ctrlKey: e.ctrlKey, metaKey: e.metaKey })}
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
