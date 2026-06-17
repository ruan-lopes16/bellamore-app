'use client';

import { useEffect, useState } from 'react';

export function SparkBars({
  width = 180,
  height = 100,
  duration = 1200,
}: {
  width?: number;
  height?: number;
  duration?: number;
}) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [duration]);

  const x0 = 8;
  const y0 = height - 8;
  const x3 = width - 10;
  const y3Target = 14;

  const cp1x = width * 0.55;
  const cp1yTarget = height - 10;
  const cp2x = width * 0.78;
  const cp2yTarget = height * 0.22;

  const cp1y = y0 + (cp1yTarget - y0) * progress;
  const cp2y = y0 + (cp2yTarget - y0) * progress;
  const y3 = y0 + (y3Target - y0) * progress;

  const d = `M ${x0} ${y0} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x3} ${y3}`;
  const areaD = d + ` L ${x3} ${y0} L ${x0} ${y0} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="sf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(180,160,240,0.2)" />
          <stop offset="100%" stopColor="rgba(180,160,240,0)" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sf)" />
      <path d={d} fill="none" stroke="rgba(200,185,255,0.45)" strokeWidth={1.6} strokeLinecap="round" />
      {progress > 0.05 && (
        <>
          <circle cx={x3} cy={y3} r={6} fill="rgba(180,160,240,0.2)" />
          <circle cx={x3} cy={y3} r={3.5} fill="#fff" />
        </>
      )}
    </svg>
  );
}
