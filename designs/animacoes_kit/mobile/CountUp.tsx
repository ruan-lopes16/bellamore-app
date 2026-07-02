// CountUp — número animando de 0 ao valor (900ms ease-out cúbico).
// Colocar em mobile/components/CountUp.tsx
//   <CountUp value={4820} prefix="R$ " style={styles.kpi} />

import React, { useEffect, useRef, useState } from 'react';
import { Text, type TextStyle, type StyleProp } from 'react-native';

type Props = {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  format?: (n: number) => string;
  style?: StyleProp<TextStyle>;
};

export default function CountUp({
  value, prefix = '', suffix = '', duration = 900,
  format = (n) => Math.round(n).toLocaleString('pt-BR'),
  style,
}: Props) {
  const [v, setV] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(value * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return <Text style={style}>{prefix}{format(v)}{suffix}</Text>;
}
