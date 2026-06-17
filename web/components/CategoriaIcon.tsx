import React from 'react';
import {
  type CategoriaServico,
  type SvgElement,
  CATEGORIA_SVG,
} from '@shared/categorias';

export { type CategoriaServico, CATEGORIA_COR, CATEGORIA_BG } from '@shared/categorias';

type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
};

function renderElements(els: SvgElement[]): React.ReactNode {
  return els.map((el, i) => {
    if (el.type === 'path') return <path key={i} d={el.d} />;
    if (el.type === 'rect')
      return <rect key={i} x={el.x} y={el.y} width={el.width} height={el.height} rx={el.rx} />;
    return (
      <g key={i} transform={el.transform}>
        {renderElements(el.children)}
      </g>
    );
  });
}

function makeIcon(cat: CategoriaServico) {
  const Cmp = ({ size = 24, color = 'currentColor', strokeWidth = 1.8, className, style }: IconProps) => (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style}
    >
      {renderElements(CATEGORIA_SVG[cat])}
    </svg>
  );
  return Cmp;
}

export const IconCilios       = makeIcon('cilios');
export const IconSobrancelhas = makeIcon('sobrancelhas');
export const IconDepilacao    = makeIcon('depilacao');
export const IconUnhas        = makeIcon('unhas');
export const IconPele         = makeIcon('pele');
export const IconDermaplaning = makeIcon('dermaplaning');
export const IconMaquiagem    = makeIcon('maquiagem');
export const IconOutros       = makeIcon('outros');

export const CATEGORIA_ICONS: Record<CategoriaServico, React.ElementType> = {
  cilios:       IconCilios,
  sobrancelhas: IconSobrancelhas,
  depilacao:    IconDepilacao,
  unhas:        IconUnhas,
  pele:         IconPele,
  dermaplaning: IconDermaplaning,
  maquiagem:    IconMaquiagem,
  outros:       IconOutros,
};

export function CategoriaIcon({
  categoria, size = 20, color, strokeWidth = 1.8, className, style,
}: IconProps & { categoria: CategoriaServico }) {
  const Cmp = CATEGORIA_ICONS[categoria] ?? IconOutros;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} className={className} style={style} />;
}
