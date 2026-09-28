import type { FileEntry } from '../api';
import { useI18n } from '../i18n';

interface OverlayButtonsProps {
  currentIndex: number;
  totalWindows: number;
  allImages: (FileEntry | null)[];
  onOverlayStart: (imagePath: string) => void;
  onOverlayEnd: () => void;
}

export default function OverlayButtons({
  currentIndex,
  totalWindows,
  allImages,
  onOverlayStart,
  onOverlayEnd,
}: OverlayButtonsProps) {
  const { t } = useI18n();
  const others: number[] = [];
  for (let i = 0; i < totalWindows; i++) {
    if (i !== currentIndex) others.push(i);
  }

  const handleDown = (targetIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const img = allImages[targetIdx];
    if (img) onOverlayStart(img.path);
  };

  return (
    <div className="flex items-center gap-1">
      {others.map((targetIdx) => (
        <button
          key={targetIdx}
          type="button"
          title={t('overlay.layer', { n: targetIdx + 1 })}
          onMouseDown={handleDown(targetIdx)}
          onMouseUp={onOverlayEnd}
          onMouseLeave={onOverlayEnd}
          className="px-1.5 py-0.5 text-xs bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] hover:border-[#555555] select-none"
        >
          {t('overlay.layer', { n: targetIdx + 1 })}
        </button>
      ))}
    </div>
  );
}
