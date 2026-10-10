// Persistence of the global watermark style (color + font size) in localStorage.
//
// Color and font size are shared by all windows; only the per-window text is
// independent and is intentionally not persisted. Old per-window data (v1) is
// ignored, falling back to the default style.

export interface WatermarkStyle {
  color: string;
  fontSize: number;
  outline: boolean;
}

// Version 2 data (no outline field) is still accepted; outline defaults to
// false so previously saved color/size are preserved rather than reset.
const VERSION = 2;

interface StoredStyle {
  v: number;
  color: string;
  fontSize: number;
  outline?: boolean;
}

export function loadWatermarkStyle(key: string): WatermarkStyle | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredStyle;
    if (
      !parsed ||
      parsed.v !== VERSION ||
      typeof parsed.color !== 'string' ||
      typeof parsed.fontSize !== 'number'
    ) {
      return null;
    }
    return {
      color: parsed.color,
      fontSize: parsed.fontSize,
      // Outline defaults to on (incl. old v2 data without the field).
      outline: parsed.outline !== false,
    };
  } catch {
    return null;
  }
}

export function saveWatermarkStyle(key: string, style: WatermarkStyle): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        v: VERSION,
        color: style.color,
        fontSize: style.fontSize,
        outline: style.outline,
      }),
    );
  } catch {
    // ignore quota / private-mode errors
  }
}

export const IMAGE_WATERMARK_KEY = 'media-diff:watermark:image';
export const VIDEO_WATERMARK_KEY = 'media-diff:watermark:video';
