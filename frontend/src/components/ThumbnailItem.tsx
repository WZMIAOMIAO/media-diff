import { useEffect, useState } from 'react';
import { fetchThumbnailBlob } from '../api';
import type { FileEntry } from '../api';
import { useI18n } from '../i18n';

interface ThumbnailItemProps {
  image: FileEntry;
  selected: boolean;
  onClick: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
}

function ThumbnailItem({ image, selected, onClick }: ThumbnailItemProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (image.missing) {
      setUrl(null);
      return;
    }
    setUrl(null);
    fetchThumbnailBlob(image.path)
      .then(({ blobUrl }) => {
        if (!cancelled) setUrl(blobUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [image.path, image.missing]);

  if (image.missing) {
    return (
      <div
        title={image.rel}
        className={`flex flex-col h-full px-1 pt-1 pb-0.5 border-b border-[#333333] border-l-2 ${
          selected ? 'bg-[#1f3a5f] border-l-[#4a9eff]' : 'border-l-transparent'
        }`}
      >
        <div className="flex-1 flex items-center justify-center min-h-0 m-1 border border-dashed border-[#3c3c3c] rounded">
          <span className="text-xs text-[#666666]">{t('item.noCounterpart')}</span>
        </div>
        <div className="truncate text-xs text-[#666666] mt-0.5" title={image.rel}>
          {image.rel}
        </div>
      </div>
    );
  }

  const showRel = !!image.rel && image.rel !== image.name;

  return (
    <div
      onClick={(e) =>
        onClick({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey })
      }
      title={image.rel ?? image.name}
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
            alt={image.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="w-full h-full bg-[#2a2a2a]" />
        )}
      </div>
      {showRel ? (
        <>
          <div className="truncate text-xs text-[#c0c0c0] mt-0.5" title={image.rel}>
            {image.name}
          </div>
          <div className="truncate text-[10px] text-[#888888]" title={image.rel}>
            {image.rel}
          </div>
        </>
      ) : (
        <div className="truncate text-xs text-[#c0c0c0] mt-0.5" title={image.name}>
          {image.name}
        </div>
      )}
    </div>
  );
}

export default ThumbnailItem;
