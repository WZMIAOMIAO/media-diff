import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  boxToPoint,
  getContentBox,
  samplePixel,
  type RGB,
} from '../utils/colorSample';

type ColorSource = HTMLImageElement | HTMLVideoElement;

export interface SamplePos {
  u: number;
  v: number;
}

interface ColorReadoutProps {
  containerRef: RefObject<HTMLElement | null>;
  sourceEl: ColorSource | null;
  enabled: boolean;
  samplePos: SamplePos | null;
  /** Changes whenever the displayed view changes, to force a resample. */
  version: string;
}

interface Info {
  rgb: RGB;
  point: { left: number; top: number };
  containerW: number;
  containerH: number;
}

const MARGIN = 6;
const GAP = 14;

export default function ColorReadout({
  containerRef,
  sourceEl,
  enabled,
  samplePos,
  version,
}: ColorReadoutProps) {
  const [info, setInfo] = useState<Info | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!enabled || !samplePos || !sourceEl || !container) {
      setInfo(null);
      return;
    }
    const box = getContentBox(sourceEl, container);
    if (!box) {
      setInfo(null);
      return;
    }
    const rgb = samplePixel(sourceEl, box, samplePos.u, samplePos.v);
    if (!rgb) {
      setInfo(null);
      return;
    }
    const point = boxToPoint(box, samplePos.u, samplePos.v);
    const cr = container.getBoundingClientRect();
    setInfo({ rgb, point, containerW: cr.width, containerH: cr.height });
  }, [enabled, samplePos, sourceEl, containerRef, version]);

  // Keep the readout inside the container: clamp horizontally and flip above
  // the sample point when there is no room below.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!info || !el) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const halfW = w / 2;
    const minX = halfW + MARGIN;
    const maxX = info.containerW - halfW - MARGIN;
    const x = Math.min(Math.max(info.point.left, minX), Math.max(minX, maxX));

    let y = info.point.top + GAP;
    if (y + h + MARGIN > info.containerH) {
      y = info.point.top - GAP - h;
    }
    y = Math.min(Math.max(y, MARGIN), Math.max(MARGIN, info.containerH - h - MARGIN));

    setPos((prev) =>
      prev && prev.left === x && prev.top === y ? prev : { left: x, top: y },
    );
  }, [info]);

  if (!info) return null;
  const [r, g, b] = info.rgb;

  return (
    <div
      ref={boxRef}
      className="absolute z-30 pointer-events-none"
      style={{
        left: pos ? pos.left : 0,
        top: pos ? pos.top : 0,
        transform: 'translateX(-50%)',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-black/85 border border-[#555555] text-[10px] text-[#e0e0e0] whitespace-nowrap">
        <span
          className="inline-block w-3 h-3 rounded-sm border border-[#888888]"
          style={{ backgroundColor: `rgb(${r},${g},${b})` }}
        />
        <span className="tabular-nums">
          R {r} G {g} B {b}
        </span>
      </div>
    </div>
  );
}
