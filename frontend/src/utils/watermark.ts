import type { CSSProperties } from 'react';

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Pick a black or white outline that contrasts with the fill color. */
export function contrastOutlineColor(color: string): string {
  const rgb = hexToRgb(color);
  if (!rgb) return '#000000';
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.6 ? '#000000' : '#ffffff';
}

/**
 * Build the inline style for a watermark. When ``outline`` is enabled a solid
 * ring of text-shadows is drawn around the glyphs (a shadow does not eat into
 * the fill, unlike a centered text-stroke), so the text stays legible over
 * busy backgrounds.
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
    const w = Math.max(1, Math.round(fontSize / 20));
    const c = contrastOutlineColor(color);
    style.textShadow = [
      `-${w}px -${w}px 0 ${c}`,
      `${w}px -${w}px 0 ${c}`,
      `-${w}px ${w}px 0 ${c}`,
      `${w}px ${w}px 0 ${c}`,
      `0 ${w}px 0 ${c}`,
      `0 -${w}px 0 ${c}`,
      `${w}px 0 0 ${c}`,
      `-${w}px 0 0 ${c}`,
    ].join(', ');
  }
  return style;
}
