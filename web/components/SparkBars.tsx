'use client';

import { useEffect, useId, useState } from 'react';
import { geometriaSparkline } from '@shared/dashboard';

export function SparkBars({
  data = [],
  width = 200,
  height = 80,
}: {
  data?: number[];
  width?: number;
  height?: number;
}) {
  const gradId = useId();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min((now - start) / 1400, 1);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, []);

  const { linha: pathD, area: areaD, ultimo: last, vazio } = geometriaSparkline(data, width, height, progress);
  const showDot = progress > 0.05 && !vazio;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`${gradId}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(180,160,240,0.22)" />
          <stop offset="100%" stopColor="rgba(180,160,240,0)"    />
        </linearGradient>
        {/* Esmaece o início da linha (esquerda) para não brigar com o texto sobreposto no card */}
        <linearGradient id={`${gradId}-stroke`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"  stopColor="rgba(210,190,255,0)" />
          <stop offset="55%" stopColor="rgba(210,190,255,0)" />
          <stop offset="100%" stopColor="rgba(210,190,255,0.55)" />
        </linearGradient>
      </defs>

      <path d={areaD} fill={`url(#${gradId}-fill)`} />
      <path
        d={pathD}
        fill="none"
        stroke={`url(#${gradId}-stroke)`}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {showDot && (
        <>
          <circle cx={last.x} cy={last.y} r={6}   fill="rgba(180,160,240,0.25)" />
          <circle cx={last.x} cy={last.y} r={3.5}  fill="#fff" />
        </>
      )}
    </svg>
  );
}
