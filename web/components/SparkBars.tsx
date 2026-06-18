'use client';

import { useEffect, useState } from 'react';

export function SparkBars({
  data = [],
  width = 200,
  height = 80,
}: {
  data?: number[];
  width?: number;
  height?: number;
}) {
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

  const padL = 8, padR = 10, padT = 12, padB = 6;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const baseline = padT + plotH;

  const maxVal = Math.max(...data, 1);
  const allZero = data.every(v => v === 0);
  const n = data.length;

  // Monta pontos: sempre começa na origem (0, baseline)
  const pts: { x: number; y: number }[] = [{ x: padL, y: baseline }];

  if (!allZero && n > 0) {
    data.forEach((v, i) => {
      const x = padL + ((i + 1) / n) * plotW;
      // Interpola de baseline para o valor real conforme o progresso
      const targetY = baseline - (v / maxVal) * plotH;
      const y = baseline + (targetY - baseline) * progress;
      pts.push({ x, y });
    });
  } else {
    // Linha flat no fundo quando não há dados
    pts.push({ x: padL + plotW, y: baseline });
  }

  const pathD   = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last    = pts[pts.length - 1];
  const areaD   = `${pathD} L${last.x.toFixed(1)},${baseline} L${padL},${baseline} Z`;
  const showDot = progress > 0.05 && !allZero;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(180,160,240,0.22)" />
          <stop offset="100%" stopColor="rgba(180,160,240,0)"    />
        </linearGradient>
      </defs>

      <path d={areaD} fill="url(#sg)" />
      <path
        d={pathD}
        fill="none"
        stroke="rgba(210,190,255,0.55)"
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
