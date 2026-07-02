// CategoriaIcon.tsx — Ícones autorais de procedimentos (Bellamore)
// MOBILE (Expo / React Native) — substitui o MaterialCommunityIcons genérico.
// Requer: npx expo install react-native-svg
//
// Drop-in replacement para mobile/components/CategoriaIcon.tsx:
// mantém a mesma API (categoria, size, color) e os mesmos exports
// CATEGORIA_COR / CATEGORIA_BG já usados no app.

import React from 'react';
import Svg, { Path, Rect, G } from 'react-native-svg';

export type CategoriaServico =
  | 'cilios' | 'sobrancelhas' | 'depilacao' | 'unhas'
  | 'pele' | 'dermaplaning' | 'maquiagem' | 'outros';

export const CATEGORIA_COR: Record<CategoriaServico, string> = {
  cilios:       '#4F46E5',
  sobrancelhas: '#7C3AED',
  depilacao:    '#D4608A',
  unhas:        '#B45309',
  pele:         '#0D7E5F',
  dermaplaning: '#0891B2',
  maquiagem:    '#C026D3',
  outros:       '#6B7280',
};

export const CATEGORIA_BG: Record<CategoriaServico, string> = {
  cilios:       '#EEF2FF',
  sobrancelhas: '#F3EFFE',
  depilacao:    '#FDF0F5',
  unhas:        '#FEF3E2',
  pele:         '#EAFAF5',
  dermaplaning: '#ECFEFF',
  maquiagem:    '#FDF4FF',
  outros:       '#F3F4F6',
};

type Props = {
  categoria: CategoriaServico;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

const PATHS: Record<CategoriaServico, React.ReactNode> = {
  cilios: (
    <>
      <Path d="M3.5 9.5C6 13.2 9 15 12 15s6-1.8 8.5-5.5" />
      <Path d="M5.6 12.8L4 14.6" /><Path d="M8.6 14.7l-1 2.2" />
      <Path d="M12 15.2v2.4" />
      <Path d="M15.4 14.7l1 2.2" /><Path d="M18.4 12.8l1.6 1.8" />
    </>
  ),
  sobrancelhas: (
    <>
      <Path d="M4 10.8C5.8 6.9 9.6 5.4 13 6.1c2.6.5 5 2.1 7 4.6" />
      <Path d="M7.5 15c1.4 1.7 2.9 2.5 4.5 2.5s3.1-.8 4.5-2.5" />
    </>
  ),
  depilacao: (
    <>
      <Path d="M12 3.5c3.2 4.2 5.2 7 5.2 9.7a5.2 5.2 0 1 1-10.4 0C6.8 10.5 8.8 7.7 12 3.5z" />
      <Path d="M9.6 13.4a2.7 2.7 0 0 0 1.9 2.5" />
    </>
  ),
  unhas: (
    <>
      <Rect x="9.8" y="2.6" width="4.4" height="3.4" rx="1.1" />
      <Path d="M10.6 6v2.5M13.4 6v2.5" />
      <Path d="M8.2 12.4a3.8 3.8 0 0 1 7.6 0v4.2a3.4 3.4 0 0 1-3.4 3.4h-.8a3.4 3.4 0 0 1-3.4-3.4z" />
      <Path d="M8.2 14.8h7.6" />
    </>
  ),
  pele: (
    <>
      <Path d="M12 4.8c1.6 2 2.4 3.9 2.4 5.5 0 1.9-1 3.2-2.4 3.2s-2.4-1.3-2.4-3.2c0-1.6.8-3.5 2.4-5.5z" />
      <Path d="M4.8 9.2c2.6.5 4.4 1.9 5.3 4" /><Path d="M19.2 9.2c-2.6.5-4.4 1.9-5.3 4" />
      <Path d="M4.2 14.4c1.6 3.1 4.3 4.7 7.8 4.7s6.2-1.6 7.8-4.7" />
    </>
  ),
  dermaplaning: (
    <>
      <G transform="rotate(-30 11.5 13)">
        <Rect x="4" y="9.2" width="15" height="7.6" rx="2.2" />
        <Path d="M10 13h3" />
      </G>
      <Path d="M18.6 3.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
    </>
  ),
  maquiagem: (
    <>
      <Path d="M9.8 9.3V6.6c0-1.7.9-3 2.2-3.6 1.3.6 2.2 1.9 2.2 3.6v2.7" />
      <Rect x="8.6" y="9.3" width="6.8" height="3.2" rx="0.9" />
      <Path d="M9.8 12.5h4.4v7.6a.9.9 0 0 1-.9.9h-2.6a.9.9 0 0 1-.9-.9z" />
    </>
  ),
  outros: (
    <>
      <Path d="M12 3.4l1.8 5.2 5.2 1.8-5.2 1.8-1.8 5.2-1.8-5.2-5.2-1.8 5.2-1.8z" />
      <Path d="M18.8 17l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
    </>
  ),
};

export function CategoriaIcon({ categoria, size = 20, color, strokeWidth = 1.8 }: Props) {
  const stroke = color ?? CATEGORIA_COR[categoria] ?? CATEGORIA_COR.outros;
  return (
    <Svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={stroke} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
    >
      {PATHS[categoria] ?? PATHS.outros}
    </Svg>
  );
}

export default CategoriaIcon;
