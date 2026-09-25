import { useCallback, useRef, useState } from 'react';

export interface SharedZoomApi {
  zoom: number;
  panX: number;
  panY: number;
  zoomByAt: (factor: number, centerX: number | null, centerY: number | null) => void;
  setPan: (x: number, y: number) => void;
  resetFit: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

export function useSharedZoom(): SharedZoomApi {
  const ref = useRef({ zoom: 1, panX: 0, panY: 0 });
  const [, setTick] = useState(0);
  const force = useCallback(() => setTick((t) => t + 1), []);

  const zoomByAt = useCallback(
    (factor: number, centerX: number | null, centerY: number | null) => {
      const s = ref.current;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom * factor));
      if (z === s.zoom) return;

      if (z <= 1) {
        ref.current = { zoom: z, panX: 0, panY: 0 };
      } else if (factor < 1) {
        const ratio = z / s.zoom;
        ref.current = { zoom: z, panX: s.panX * ratio, panY: s.panY * ratio };
      } else if (centerX === null || centerY === null) {
        ref.current = { zoom: z, panX: s.panX, panY: s.panY };
      } else {
        const f = z / s.zoom;
        ref.current = {
          zoom: z,
          panX: centerX - (centerX - s.panX) * f,
          panY: centerY - (centerY - s.panY) * f,
        };
      }
      force();
    },
    [force],
  );

  const setPan = useCallback(
    (x: number, y: number) => {
      const s = ref.current;
      if (s.zoom <= 1) return;
      ref.current = { ...s, panX: x, panY: y };
      force();
    },
    [force],
  );

  const resetFit = useCallback(() => {
    ref.current = { zoom: 1, panX: 0, panY: 0 };
    force();
  }, [force]);

  return {
    zoom: ref.current.zoom,
    panX: ref.current.panX,
    panY: ref.current.panY,
    zoomByAt,
    setPan,
    resetFit,
  };
}
