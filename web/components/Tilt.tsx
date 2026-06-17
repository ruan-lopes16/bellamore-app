'use client';

import { useRef } from 'react';

/**
 * Tilt — rotação 3D sutil que segue o ponteiro (máx 6° por eixo).
 * Aplicar SOMENTE em cards hero, não em cards de lista.
 * Desativado via .bm-tilt quando prefers-reduced-motion: reduce.
 */
export default function Tilt({ children, max = 6, className = '', style = {} }: {
  children: React.ReactNode;
  max?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onPointerMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) scale(1.012)`;
  }

  function onPointerLeave() {
    const el = ref.current;
    if (el) el.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg) scale(1)';
  }

  return (
    <div
      ref={ref}
      className={`bm-tilt ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={{ transition: 'transform .4s cubic-bezier(.2,.9,.3,1)', willChange: 'transform', ...style }}
    >
      {children}
    </div>
  );
}
