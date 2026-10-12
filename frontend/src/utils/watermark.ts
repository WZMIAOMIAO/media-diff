import type { CSSProperties } from 'react';

/**
 * Build the inline style for a watermark. When ``outline`` is enabled a **soft
 * glow** is drawn around the glyphs using layered blurred shadows (no hard
 * ring).
 *
 * The glow layers **both a light and a dark halo**. A single-colour glow keyed
 * to the fill (dark glow for bright text, light glow for dark text) disappears
 * whenever it matches the unknown background — e.g. an orange/yellow watermark
 * with a dark glow over a dark video looked like it had no effect. Having both
 * colours guaranteed that one of them is always visible, while the blur keeps
 * the edge soft. The light halo is listed first so it paints on top.
 */
export function watermarkTextStyle(
  color: string,
  fontSize: number,
  outline?: boolean,
): CSSProperties {
  const style: CSSProperties = {
    color,
    fontSize: `${fontSize}px`,
    paddingTop: '4px',
  };
  if (outline) {
    const w = Math.max(1, Math.round(fontSize / 28));
    style.textShadow = [
      `0 0 ${w}px rgba(255,255,255,0.85)`,
      `0 0 ${w}px rgba(0,0,0,0.75)`,
      `0 0 ${w * 2}px rgba(255,255,255,0.35)`,
      `0 0 ${w * 2}px rgba(0,0,0,0.4)`,
    ].join(', ');
  }
  return style;
}
