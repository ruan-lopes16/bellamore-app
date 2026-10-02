/**
 * @file SparkLinha.tsx
 * Sparkline da receita acumulada do mês (card hero do Dashboard) — mesma
 * geometria do SparkBars web (@shared/dashboard › geometriaSparkline).
 */
import { useEffect, useState } from 'react';
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { geometriaSparkline } from '@shared/dashboard';

export function SparkLinha({ dados, largura = 200, altura = 80 }: { dados: number[]; largura?: number; altura?: number }) {
  const [progresso, setProgresso] = useState(0);
  useEffect(() => {
    let raf = 0;
    const inicio = Date.now();
    const passo = () => {
      const t = Math.min((Date.now() - inicio) / 1400, 1);
      setProgresso(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [dados.length]);

  const g = geometriaSparkline(dados, largura, altura, progresso);
  return (
    <Svg width={largura} height={altura}>
      <Defs>
        <LinearGradient id="sparkPreench" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="rgb(180,160,240)" stopOpacity={0.22} />
          <Stop offset="1" stopColor="rgb(180,160,240)" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="sparkTraco" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="rgb(210,190,255)" stopOpacity={0} />
          <Stop offset="0.55" stopColor="rgb(210,190,255)" stopOpacity={0} />
          <Stop offset="1" stopColor="rgb(210,190,255)" stopOpacity={0.55} />
        </LinearGradient>
      </Defs>
      <Path d={g.area} fill="url(#sparkPreench)" />
      <Path d={g.linha} fill="none" stroke="url(#sparkTraco)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {progresso > 0.05 && !g.vazio && (
        <>
          <Circle cx={g.ultimo.x} cy={g.ultimo.y} r={6} fill="rgba(180,160,240,0.25)" />
          <Circle cx={g.ultimo.x} cy={g.ultimo.y} r={3.5} fill="#fff" />
        </>
      )}
    </Svg>
  );
}
