import React from 'react';
import Svg, { Path, Rect, G } from 'react-native-svg';
import * as LucideRN from 'lucide-react-native';
import {
  type CategoriaServico,
  type SvgElement,
  CATEGORIA_COR,
  CATEGORIA_BG,
  CATEGORIA_SVG,
} from '@shared/categorias';

export { type CategoriaServico, CATEGORIA_COR, CATEGORIA_BG } from '@shared/categorias';

type Props = {
  categoria: CategoriaServico;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

function renderElements(els: SvgElement[]): React.ReactNode {
  return els.map((el, i) => {
    if (el.type === 'path') return <Path key={i} d={el.d} />;
    if (el.type === 'rect')
      return <Rect key={i} x={el.x} y={el.y} width={el.width} height={el.height} rx={el.rx} />;
    return (
      <G key={i} transform={el.transform}>
        {renderElements(el.children)}
      </G>
    );
  });
}

export function CategoriaIcon({ categoria, size = 20, color, strokeWidth = 1.8 }: Props) {
  const stroke = color ?? CATEGORIA_COR[categoria] ?? CATEGORIA_COR.outros;
  return (
    <Svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={stroke} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
    >
      {renderElements(CATEGORIA_SVG[categoria] ?? CATEGORIA_SVG.outros)}
    </Svg>
  );
}

/** Ícone de categoria personalizada por nome lucide (ver CATEGORIA_ICONES no shared). */
export function CategoriaIconCustom({
  name, size = 20, color = '#6B7280', strokeWidth = 1.8,
}: { name: string; size?: number; color?: string; strokeWidth?: number }) {
  const Cmp = (LucideRN as unknown as Record<string, React.ComponentType<any>>)[name] ?? LucideRN.Tag;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} />;
}

export default CategoriaIcon;
