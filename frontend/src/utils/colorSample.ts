export type RGB = [number, number, number];

/**
 * Custom eyedropper cursor (pipette). The hotspot (2 22) sits on the pipette
 * tip, so the native pointer position is exactly the pixel being sampled.
 * A white halo is drawn behind the black outline so the tip stays visible on
 * both dark and light areas.
 */
const PIPETTE_PATHS =
  '<path d="m2 22 1-1h3l9-9"/>' +
  '<path d="M3 21v-3l9-9"/>' +
  '<path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.5.5a1 1 0 0 1 0 1.4l-2 2a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4l2-2a1 1 0 0 1 1.4 0z" fill="#fff"/>';

const EYEDROPPER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  `<g stroke="#fff" stroke-width="4">${PIPETTE_PATHS}</g>` +
  `<g stroke="#000" stroke-width="1.4">${PIPETTE_PATHS}</g>` +
  '</svg>';

export const EYEDROPPER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  EYEDROPPER_SVG,
)}") 2 22, crosshair`;

type ColorSource = HTMLImageElement | HTMLVideoElement;

export interface ContentBox {
  left: number;
  top: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

function sourceSize(el: ColorSource): { w: number; h: number } {
  if (el instanceof HTMLVideoElement) {
    return { w: el.videoWidth, h: el.videoHeight };
  }
  return { w: el.naturalWidth, h: el.naturalHeight };
}

/**
 * Content box (the actual picture, accounting for object-fit: contain
 * letterboxing) of an image/video, expressed relative to the container.
 */
export function getContentBox(
  el: ColorSource,
  container: HTMLElement,
): ContentBox | null {
  const { w: nw, h: nh } = sourceSize(el);
  if (!nw || !nh) return null;
  const r = el.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;

  const boxAspect = r.width / r.height;
  const imgAspect = nw / nh;
  let cw: number;
  let ch: number;
  let ox: number;
  let oy: number;
  if (boxAspect > imgAspect) {
    ch = r.height;
    cw = ch * imgAspect;
    ox = (r.width - cw) / 2;
    oy = 0;
  } else {
    cw = r.width;
    ch = cw / imgAspect;
    ox = 0;
    oy = (r.height - ch) / 2;
  }

  return {
    left: r.left + ox - cr.left,
    top: r.top + oy - cr.top,
    width: cw,
    height: ch,
    naturalWidth: nw,
    naturalHeight: nh,
  };
}

export function clientToUV(
  box: ContentBox,
  container: HTMLElement,
  clientX: number,
  clientY: number,
): { u: number; v: number } | null {
  const cr = container.getBoundingClientRect();
  const u = (clientX - cr.left - box.left) / box.width;
  const v = (clientY - cr.top - box.top) / box.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

export function boxToPoint(
  box: ContentBox,
  u: number,
  v: number,
): { left: number; top: number } {
  return { left: box.left + u * box.width, top: box.top + v * box.height };
}

let _canvas: HTMLCanvasElement | null = null;

function getContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _canvas.width = 1;
    _canvas.height = 1;
  }
  return _canvas.getContext('2d', { willReadFrequently: true });
}

export function samplePixel(
  el: ColorSource,
  box: ContentBox,
  u: number,
  v: number,
): RGB | null {
  const ctx = getContext();
  if (!ctx) return null;
  const x = Math.min(
    box.naturalWidth - 1,
    Math.max(0, Math.floor(u * box.naturalWidth)),
  );
  const y = Math.min(
    box.naturalHeight - 1,
    Math.max(0, Math.floor(v * box.naturalHeight)),
  );
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(el, x, y, 1, 1, 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    return null;
  }
}
