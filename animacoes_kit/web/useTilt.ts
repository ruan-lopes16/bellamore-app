'use client';
// useTilt — inclinação 3D sutil que segue o ponteiro.
// Usar APENAS no card-herói do dashboard.
//
//   const tilt = useTilt(6);
//   <div ref={tilt.ref} onPointerMove={tilt.onPointerMove}
//        onPointerLeave={tilt.onPointerLeave} style={tilt.style}>...</div>

import { useRef, useCallback, type CSSProperties, type PointerEvent } from 'react';

export function useTilt(maxDeg = 6) {
  const ref = useRef<HTMLDivElement>(null);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    // respeita reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform =
      `perspective(700px) rotateX(${(-py * maxDeg).toFixed(2)}deg) rotateY(${(px * maxDeg).toFixed(2)}deg) scale(1.012)`;
  }, [maxDeg]);

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (el) el.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg) scale(1)';
  }, []);

  const style: CSSProperties = {
    transition: 'transform .4s cubic-bezier(.2,.9,.3,1)',
    willChange: 'transform',
  };

  return { ref, onPointerMove, onPointerLeave, style };
}
