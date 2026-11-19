import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { WipeInfoContext } from './wipeInfoContext';

interface WipeStackProps {
  first: ReactNode;
  second: ReactNode;
}

const DEFAULT_PERCENT = 50;

function getMediaRects(area: HTMLElement): DOMRect[] {
  const rects: DOMRect[] = [];
  for (const side of ['first', 'second'] as const) {
    const root = area.querySelector(`[data-wipe="${side}"]`);
    if (!root) continue;
    const img = root.querySelector('img[src^="blob:"]');
    const video = root.querySelector('video');
    const el =
      img ?? (video && getComputedStyle(video).display !== 'none' ? video : null);
    if (el) rects.push(el.getBoundingClientRect());
  }
  return rects;
}

function horizontalBounds(areaRect: DOMRect, mediaRects: DOMRect[]) {
  let left = areaRect.left;
  let right = areaRect.right;
  if (mediaRects.length > 0) {
    left = Math.max(left, Math.min(...mediaRects.map((r) => r.left)));
    right = Math.min(right, Math.max(...mediaRects.map((r) => r.right)));
  }
  if (right - left < 8) {
    left = areaRect.left;
    right = areaRect.right;
  }
  return { left, right };
}

export default function WipeStack({ first, second }: WipeStackProps) {
  const { t } = useI18n();
  const stackRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const firstInfoRef = useRef<HTMLDivElement>(null);
  const secondInfoRef = useRef<HTMLDivElement>(null);
  const firstHistRef = useRef<HTMLDivElement>(null);
  const secondHistRef = useRef<HTMLDivElement>(null);
  const firstWatermarkRef = useRef<HTMLDivElement>(null);
  const secondWatermarkRef = useRef<HTMLDivElement>(null);
  const colorReadoutRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [infoSlots, setInfoSlots] = useState<{
    header: { first: HTMLElement | null; second: HTMLElement | null };
    histogram: { first: HTMLElement | null; second: HTMLElement | null };
    watermark: { first: HTMLElement | null; second: HTMLElement | null };
    color: HTMLElement | null;
  }>({
    header: { first: null, second: null },
    histogram: { first: null, second: null },
    watermark: { first: null, second: null },
    color: null,
  });

  useLayoutEffect(() => {
    setInfoSlots({
      header: { first: firstInfoRef.current, second: secondInfoRef.current },
      histogram: { first: firstHistRef.current, second: secondHistRef.current },
      watermark: {
        first: firstWatermarkRef.current,
        second: secondWatermarkRef.current,
      },
      color: colorReadoutRef.current,
    });
  }, []);

  // Keep the divider inside the actual media frames (not the letterbox/empty
  // container area). Media rects change with zoom/pan, so poll them while the
  // wipe view is mounted; only touch the DOM when the bounds change.
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      const area = areaRef.current;
      const divider = dividerRef.current;
      if (area && divider) {
        const areaRect = area.getBoundingClientRect();
        const mediaRects = getMediaRects(area);
        let top = areaRect.top;
        let bottom = areaRect.bottom;
        if (mediaRects.length === 1) {
          top = mediaRects[0].top;
          bottom = mediaRects[0].bottom;
        } else if (mediaRects.length > 1) {
          top = Math.max(...mediaRects.map((r) => r.top));
          bottom = Math.min(...mediaRects.map((r) => r.bottom));
        }
        if (bottom - top < 8) {
          top = areaRect.top;
          bottom = areaRect.bottom;
        }
        const visibleTop = Math.max(areaRect.top, top);
        const visibleBottom = Math.min(areaRect.bottom, bottom);
        const topPx = Math.max(0, visibleTop - areaRect.top);
        const height = Math.max(0, visibleBottom - visibleTop);
        const key = `${topPx.toFixed(1)}:${height.toFixed(1)}`;
        if (key !== lastKey) {
          lastKey = key;
          divider.style.top = `${topPx}px`;
          divider.style.height = `${height}px`;
        }
        if (areaRect.width > 0) {
          const stack = stackRef.current;
          const bounds = horizontalBounds(areaRect, mediaRects);
          const raw = parseFloat(stack?.style.getPropertyValue('--wipe') || '50');
          const currentX = areaRect.left + (raw / 100) * areaRect.width;
          const clampedX = Math.max(bounds.left, Math.min(bounds.right, currentX));
          if (Math.abs(clampedX - currentX) > 0.5) {
            const percent = ((clampedX - areaRect.left) / areaRect.width) * 100;
            stack?.style.setProperty('--wipe', `${percent}%`);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const setPercent = (clientX: number) => {
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    if (rect.width <= 0) return;
    const bounds = horizontalBounds(rect, getMediaRects(area));
    const x = Math.max(bounds.left, Math.min(bounds.right, clientX));
    const percent = ((x - rect.left) / rect.width) * 100;
    stackRef.current?.style.setProperty('--wipe', `${percent}%`);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPercent(e.clientX);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    setPercent(e.clientX);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const area = areaRef.current;
    if (area) {
      const rect = area.getBoundingClientRect();
      if (rect.width > 0) {
        setPercent(rect.left + rect.width / 2);
      } else {
        stackRef.current?.style.setProperty('--wipe', `${DEFAULT_PERCENT}%`);
      }
    }
  };

  return (
    <div
      ref={stackRef}
      className="relative flex-1 min-h-0 flex flex-col overflow-hidden bg-[#1e1e1e]"
      data-wipe="stack"
      style={{ '--wipe': `${DEFAULT_PERCENT}%` } as CSSProperties}
    >
      <div className="h-8 shrink-0 flex bg-[#252525] border-b border-[#3c3c3c]">
        <div
          ref={firstInfoRef}
          className="min-w-0 w-1/2 border-r border-[#3c3c3c]"
          data-wipe-info="first"
        />
        <div
          ref={secondInfoRef}
          className="min-w-0 w-1/2"
          data-wipe-info="second"
        />
      </div>

      <div
        ref={areaRef}
        className="relative flex-1 min-h-0 overflow-hidden bg-[#1e1e1e]"
        data-wipe-media=""
      >
        <WipeInfoContext.Provider value={infoSlots}>
          <div className="absolute inset-0 isolate" data-wipe="first">{first}</div>
          <div
            className="absolute inset-0 isolate"
            data-wipe="second"
            style={{ clipPath: 'inset(0 0 0 var(--wipe))' }}
          >
            {second}
          </div>
        </WipeInfoContext.Provider>
        <div
          ref={firstHistRef}
          data-wipe-overlay="histogram-first"
          className="pointer-events-none absolute left-1 top-1 z-40 max-w-[45%]"
        />
        <div
          ref={secondHistRef}
          data-wipe-overlay="histogram-second"
          className="pointer-events-none absolute right-1 top-1 z-40 max-w-[45%]"
        />
        <div
          ref={firstWatermarkRef}
          data-wipe-overlay="watermark-first"
          className="pointer-events-none absolute left-1/4 top-1 z-40 max-w-[45%] -translate-x-1/2"
        />
        <div
          ref={secondWatermarkRef}
          data-wipe-overlay="watermark-second"
          className="pointer-events-none absolute left-3/4 top-1 z-40 max-w-[45%] -translate-x-1/2"
        />
        <div
          ref={colorReadoutRef}
          className="pointer-events-none absolute inset-0 z-50"
        />
        <div
          ref={dividerRef}
          role="separator"
          aria-orientation="vertical"
          title={t('wipe.dividerHint')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          data-wipe="divider"
          className="absolute z-30 w-4 -translate-x-1/2 touch-none cursor-col-resize"
          style={{ left: 'var(--wipe)', top: 0, height: '100%' }}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/80 shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
          <div className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#666666] bg-[#e0e0e0] text-[#333333] shadow-lg">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 4 3 8l3 4" />
              <path d="m10 4 3 4-3 4" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
