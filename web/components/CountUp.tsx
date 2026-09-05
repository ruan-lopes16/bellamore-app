'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Número que anima de 0 (ou do valor anterior) até `value`.
 *
 * @param decimals casas decimais exibidas (default 0). O valor é **truncado**
 *   para esse número de casas, nunca arredondado para cima — `2159,87` continua
 *   `2159,87`, não vira `2160`.
 */
export function CountUp({
  value,
  duration = 900,
  decimals = 0,
}: {
  value: number;
  duration?: number;
  decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    const factor = 10 ** decimals;
    // Trunca para `decimals` casas (o +1e-6 absorve ruído de ponto flutuante
    // como 215986.9999997 sem nunca empurrar um valor real para cima).
    const trunc = (n: number) => Math.floor(n * factor + 1e-6) / factor;

    const target = trunc(value);
    const start = performance.now();
    const from = ref.current;
    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = trunc(from + (target - from) * eased);
      setDisplay(current);
      if (t < 1) requestAnimationFrame(tick);
      else ref.current = target;
    }
    requestAnimationFrame(tick);
  }, [value, duration, decimals]);

  return <>{display.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}</>;
}
