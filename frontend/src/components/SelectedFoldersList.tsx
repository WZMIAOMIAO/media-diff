import { useEffect, useRef, useState } from 'react';
import type { SelectedFolder } from '../types';
import { useI18n } from '../i18n';

interface SelectedFoldersListProps {
  folders: SelectedFolder[];
  onRemove: (path: string) => void;
  onClear: () => void;
  /** Move folder at ``from`` to index ``to``. */
  onMove: (from: number, to: number) => void;
  /** Disable reordering (annotation / blind mode). */
  locked?: boolean;
}

interface DragState {
  index: number;
  pointerY: number;
  grabOffsetY: number;
  height: number;
  left: number;
  width: number;
  /** The list box the card is confined to (viewport coords, captured at start). */
  listTop: number;
  listBottom: number;
  /** Insertion slot among the *remaining* rows (0..n-1). */
  insertPos: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * The "selected compare folders" list. Drag a row by its left handle to reorder
 * it like a card: the row lifts and follows the cursor while the list opens a
 * gap at the drop slot. The card stays inside the list box. Thumbnail columns
 * and compare windows follow the order. Reordering is disabled while a mode
 * locks the folder set (annotation/blind).
 */
function SelectedFoldersList({
  folders,
  onRemove,
  onClear,
  onMove,
  locked = false,
}: SelectedFoldersListProps) {
  const { t } = useI18n();
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rowsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  const update = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const setRowRef = (i: number) => (el: HTMLDivElement | null) => {
    if (el) rowsRef.current.set(i, el);
    else rowsRef.current.delete(i);
  };

  const beginDrag = (index: number, e: React.PointerEvent) => {
    if (locked) return;
    const el = rowsRef.current.get(index);
    const list = listRef.current;
    if (!el || !list) return;
    const rect = el.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    e.preventDefault();
    update({
      index,
      pointerY: e.clientY,
      grabOffsetY: e.clientY - rect.top,
      height: rect.height,
      left: rect.left,
      width: rect.width,
      listTop: listRect.top,
      listBottom: listRect.bottom,
      insertPos: index,
    });
  };

  const dragging = drag !== null;

  useEffect(() => {
    if (!dragging) return;
    // Slot is derived from the *currently rendered* remaining rows each move, so
    // the gap tracks the pointer continuously instead of only at row midpoints
    // captured at drag start.
    const slotAt = (list: HTMLElement, y: number): number => {
      let pos = 0;
      for (const el of list.querySelectorAll<HTMLElement>('[data-slot]')) {
        const r = el.getBoundingClientRect();
        if (y > (r.top + r.bottom) / 2) pos++;
      }
      return pos;
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const list = listRef.current;
      if (!d || !list) return;
      const y = clamp(e.clientY, d.listTop, d.listBottom);
      update({ ...d, pointerY: y, insertPos: slotAt(list, y) });
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      update(null);
      if (d && d.insertPos !== d.index) onMoveRef.current(d.index, d.insertPos);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [dragging]);

  // Build the render list: while dragging, drop the dragged row and insert a
  // gap at the computed slot so the other rows visually make room.
  const rows: Array<{ type: 'folder'; f: SelectedFolder; i: number } | { type: 'gap' }> =
    [];
  if (!drag) {
    folders.forEach((f, i) => rows.push({ type: 'folder', f, i }));
  } else {
    const remaining = folders
      .map((f, i) => ({ f, i }))
      .filter((x) => x.i !== drag.index);
    for (let p = 0; p <= remaining.length; p++) {
      if (p === drag.insertPos) rows.push({ type: 'gap' });
      if (p < remaining.length) {
        const { f, i } = remaining[p];
        rows.push({ type: 'folder', f, i });
      }
    }
  }

  const dragFile = drag ? folders[drag.index] : null;
  const cardTop = drag
    ? clamp(drag.pointerY - drag.grabOffsetY, drag.listTop, drag.listBottom - drag.height)
    : 0;

  return (
    <div className="shrink-0 border-b border-[#3c3c3c] max-h-[40%] flex flex-col min-h-0">
      <div className="px-2 py-1 text-xs text-[#888888] border-b border-[#3c3c3c]">
        {t('sidebar.selectedDirs')}
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-auto">
        {folders.length === 0 ? (
          <div className="px-2 py-1 text-xs text-[#666666]">{t('sidebar.none')}</div>
        ) : (
          rows.map((row) =>
            row.type === 'gap' ? (
              <div
                key="__gap__"
                style={{ height: drag?.height }}
                className="mx-2 my-0.5 rounded border border-dashed border-[#4a9eff]/60 bg-[#4a9eff]/10"
              />
            ) : (
              <div
                key={row.f.path}
                ref={setRowRef(row.i)}
                data-slot=""
                className="flex items-center gap-1 px-2 py-1 hover:bg-[#2b2b2b]"
                title={row.f.path}
              >
                <span
                  onPointerDown={(e) => beginDrag(row.i, e)}
                  title={locked ? t('sidebar.dragReorderLocked') : t('sidebar.dragReorder')}
                  style={{ touchAction: 'none' }}
                  className={`shrink-0 select-none text-base leading-none px-0.5 ${
                    locked
                      ? 'text-[#555555] cursor-not-allowed'
                      : 'text-[#888888] cursor-grab active:cursor-grabbing'
                  }`}
                >
                  ⠿
                </span>
                <div
                  className="flex-1 min-w-0 truncate text-right"
                  style={{ direction: 'rtl' }}
                >
                  <span dir="ltr" className="text-xs text-[#c0c0c0]">
                    {row.f.path}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(row.f.path)}
                  title={t('common.remove')}
                  className="shrink-0 text-[#888888] hover:text-[#ef4444] text-base leading-none px-1"
                >
                  ×
                </button>
              </div>
            ),
          )
        )}
      </div>
      {folders.length > 0 && (
        <div className="px-2 py-1 border-t border-[#3c3c3c]">
          <button
            type="button"
            onClick={onClear}
            className="w-full px-2 py-1 text-xs bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555]"
          >
            {t('common.clear')}
          </button>
        </div>
      )}

      {drag && dragFile && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{
            left: drag.left,
            top: cardTop,
            width: drag.width,
            height: drag.height,
          }}
        >
          <div className="flex h-full items-center gap-1 rounded-md border border-[#4a9eff] bg-[#333333] px-2 shadow-xl">
            <span className="shrink-0 select-none text-base leading-none px-0.5 text-[#888888]">
              ⠿
            </span>
            <div
              className="flex-1 min-w-0 truncate text-right"
              style={{ direction: 'rtl' }}
            >
              <span dir="ltr" className="text-xs text-[#e0e0e0]">
                {dragFile.path}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SelectedFoldersList;
