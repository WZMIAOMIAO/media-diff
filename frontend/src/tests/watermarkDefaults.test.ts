import { describe, expect, it } from 'vitest';
import { loadWatermarkStyle } from '../utils/watermarkStorage';
import { useWatermark } from '../hooks/useWatermark';
import { renderHook } from '@testing-library/react';

describe('watermark outline defaults', () => {
  it('uses the mode default when no style has been saved', () => {
    localStorage.clear();
    const image = renderHook(() => useWatermark('test:watermark:image', false));
    const video = renderHook(() => useWatermark('test:watermark:video', false));
    expect(image.result.current.style.outline).toBe(false);
    expect(video.result.current.style.outline).toBe(false);
  });

  it('uses the mode default for old data without an outline field', () => {
    localStorage.setItem(
      'test:watermark:old',
      JSON.stringify({ v: 2, color: '#ff0000', fontSize: 24 }),
    );
    expect(loadWatermarkStyle('test:watermark:old', false)?.outline).toBe(false);
    expect(loadWatermarkStyle('test:watermark:old', true)?.outline).toBe(true);
  });

  it('keeps an explicitly saved outline choice', () => {
    localStorage.setItem(
      'test:watermark:explicit',
      JSON.stringify({ v: 2, color: '#ff0000', fontSize: 24, outline: true }),
    );
    expect(loadWatermarkStyle('test:watermark:explicit', false)?.outline).toBe(true);
  });
});
