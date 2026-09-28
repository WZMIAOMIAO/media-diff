import type { FileEntry } from '../api';
import { useI18n } from '../i18n';

interface OverlayButtonsProps {
  currentIndex: number;
  totalWindows: number;
  allImages: (FileEntry | null)[];
  onOverlayStart: (imagePath: string) => void;
  onOverlayEnd: () => void;
}

type Dir =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'up-left'
  | 'up-right'
  | 'down-left'
  | 'down-right';

type IconSpec =
  | { kind: 'straight'; dir: Dir }
  | { kind: 'span'; dir: 'left' | 'right' };

const DIR_VECTOR: Record<Dir, [number, number]> = {
  right: [1, 0],
  left: [-1, 0],
  up: [0, -1],
  down: [0, 1],
  'up-right': [Math.SQRT1_2, -Math.SQRT1_2],
  'up-left': [-Math.SQRT1_2, -Math.SQRT1_2],
  'down-right': [Math.SQRT1_2, Math.SQRT1_2],
  'down-left': [-Math.SQRT1_2, Math.SQRT1_2],
};

// Four windows are laid out as a 2x2 grid (0=TL, 1=TR, 2=BL, 3=BR); every
// other window then has a unique 2D direction, so no distance encoding is
// needed. Two/three windows sit in one row, where a source two positions away
// is drawn as a "spanning" (up-then-down) arrow.
// Arrow ordering in the 2x2 grid. Left-column windows list the same-column
// neighbour first, right-column windows list the same-row neighbour first; the
// diagonal neighbour is always in the middle:
//   top-left     -> up,    diagonal-up,      left
//   bottom-left  -> down,  diagonal-down,    left
//   top-right    -> right, diagonal-up,      up
//   bottom-right -> right, diagonal-down,    down
function gridCategory(current: number, source: number): number {
  const sameRow = Math.floor(current / 2) === Math.floor(source / 2);
  const sameCol = current % 2 === source % 2;
  const primary = current % 2 === 0 ? sameCol : sameRow;
  const secondary = current % 2 === 0 ? sameRow : sameCol;
  if (primary) return 0;
  if (secondary) return 2;
  return 1;
}

function iconFor(current: number, source: number, total: number): IconSpec {
  if (total === 4) {
    const dc = (current % 2) - (source % 2);
    const dr = Math.floor(current / 2) - Math.floor(source / 2);
    const horizontal = dc > 0 ? 'right' : dc < 0 ? 'left' : '';
    const vertical = dr > 0 ? 'down' : dr < 0 ? 'up' : '';
    const dir = (horizontal && vertical ? `${vertical}-${horizontal}` : horizontal || vertical) as Dir;
    return { kind: 'straight', dir };
  }
  const dc = current - source;
  const dir: 'left' | 'right' = dc < 0 ? 'left' : 'right';
  return Math.abs(dc) > 1 ? { kind: 'span', dir } : { kind: 'straight', dir };
}

function headPath(tipX: number, tipY: number, ux: number, uy: number): string {
  const size = 4;
  const baseX = tipX - ux * size;
  const baseY = tipY - uy * size;
  const perpX = -uy;
  const perpY = ux;
  const w = 2.2;
  return `M${baseX + perpX * w} ${baseY + perpY * w} L${tipX} ${tipY} L${baseX - perpX * w} ${baseY - perpY * w}`;
}

function straightPath(dir: Dir): string {
  const [ux, uy] = DIR_VECTOR[dir];
  const len = 5.5;
  const sx = 8 - ux * len;
  const sy = 8 - uy * len;
  const tx = 8 + ux * len;
  const ty = 8 + uy * len;
  return `M${sx} ${sy} L${tx} ${ty} ${headPath(tx, ty, ux, uy)}`;
}

function spanPath(dir: 'left' | 'right'): string {
  const s = dir === 'right' ? 1 : -1;
  const startX = 8 - s * 6;
  const startY = 11.5;
  const peakX = 8;
  const peakY = 4;
  const endX = 8 + s * 6;
  const endY = 11.5;
  const dx = endX - peakX;
  const dy = endY - peakY;
  const norm = Math.hypot(dx, dy);
  return `M${startX} ${startY} L${peakX} ${peakY} L${endX} ${endY} ${headPath(endX, endY, dx / norm, dy / norm)}`;
}

function ArrowIcon({ spec }: { spec: IconSpec }) {
  const d = spec.kind === 'span' ? spanPath(spec.dir) : straightPath(spec.dir);
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
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
  // In the 2x2 grid, order the arrows as: same-row neighbour, diagonal,
  // same-column neighbour (e.g. bottom-right -> right, diagonal-down, down).
  if (totalWindows === 4) {
    others.sort((a, b) => gridCategory(currentIndex, a) - gridCategory(currentIndex, b));
  }

  const handleDown = (targetIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const img = allImages[targetIdx];
    if (img) onOverlayStart(img.path);
  };

  return (
    <div className="flex items-center gap-1">
      {others.map((targetIdx) => {
        const spec = iconFor(currentIndex, targetIdx, totalWindows);
        const label = t('overlay.fromWindow', { n: targetIdx + 1 });
        return (
          <button
            key={targetIdx}
            type="button"
            title={label}
            aria-label={label}
            onMouseDown={handleDown(targetIdx)}
            onMouseUp={onOverlayEnd}
            onMouseLeave={onOverlayEnd}
            className="flex items-center justify-center p-1 bg-[#333333] border border-[#3c3c3c] rounded text-[#e0e0e0] hover:border-[#555555] select-none"
          >
            <ArrowIcon spec={spec} />
          </button>
        );
      })}
    </div>
  );
}
