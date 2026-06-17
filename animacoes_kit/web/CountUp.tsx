'use client';
// CountUp — número que anima de 0 ao valor final (900ms, ease-out cúbico).
//   <CountUp value={4820} prefix="R$ " />

import { useEffect, useRef, useState } from 'react';

type Props = {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
};

export default function CountUp({
  value, prefix = '', suffix = '', duration = 900,
  format = (n) => Math.round(n).toLocaleString('pt-BR'),
  className,
}: Props) {
  const [v, setV] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setV(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(value * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return <span className={className}>{prefix}{format(v)}{suffix}</span>;
}
