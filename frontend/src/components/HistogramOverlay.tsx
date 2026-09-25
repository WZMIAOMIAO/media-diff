import { useEffect, useState } from 'react';
import { fetchHistogram, histogramCache } from '../api';
import type { HistogramData } from '../types';

interface HistogramOverlayProps {
  imagePath: string;
  overlayImagePath?: string;
}

const W = 200;
const H = 60;

function buildPath(data: number[], max: number): string {
  if (max <= 0) return '';
  const step = W / data.length;
  let d = '';
  for (let i = 0; i < data.length; i++) {
    const x = i * step;
    const y = H - (data[i] / max) * H;
    d += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
  }
  return d;
}

function Chart({ data }: { data: HistogramData }) {
  const maxR = Math.max(...data.r, 1);
  const maxG = Math.max(...data.g, 1);
  const maxB = Math.max(...data.b, 1);
  const maxAll = Math.max(maxR, maxG, maxB);

  return (
    <svg width={W} height={H} className="block">
      <path d={buildPath(data.r, maxAll)} fill="none" stroke="#ff4444" strokeWidth="1" />
      <path d={buildPath(data.g, maxAll)} fill="none" stroke="#44ff44" strokeWidth="1" />
      <path d={buildPath(data.b, maxAll)} fill="none" stroke="#4488ff" strokeWidth="1" />
    </svg>
  );
}

export default function HistogramOverlay({ imagePath, overlayImagePath }: HistogramOverlayProps) {
  const effectivePath = overlayImagePath ?? imagePath;
  const [data, setData] = useState<HistogramData | null>(null);

  useEffect(() => {
    const cached = histogramCache.get(effectivePath);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    fetchHistogram(effectivePath)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [effectivePath]);

  if (!data) return null;

  return (
    <div className="bg-black/60 backdrop-blur-sm rounded px-1 py-0.5">
      <Chart data={data} />
      <div className="flex gap-2 text-[10px] text-[#e0e0e0] px-1">
        <span className="text-[#ff4444]">R: {Math.round(data.rMean)}</span>
        <span className="text-[#44ff44]">G: {Math.round(data.gMean)}</span>
        <span className="text-[#4488ff]">B: {Math.round(data.bMean)}</span>
      </div>
    </div>
  );
}
