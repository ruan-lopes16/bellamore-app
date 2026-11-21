/**
 * @file paleta-tema.ts
 * Paletas clara e escura do app nativo. Ficam em shared/ (sem React Native) para o teste de
 * contraste poder lê-las; `mobile/lib/tema.tsx` reexporta e entrega pelo `useTema()`.
 *
 * `primary`, `green`, `amber` e `red` são cores de FUNDO (texto branco por cima).
 * `primaryTexto`, `greenTexto`, `amberTexto` e `redTexto` são para TEXTO e ÍCONE sobre `surface`/`bg`.
 * No claro, as chaves `*Texto` repetem os valores de sempre, então nada muda no tema claro.
 */

/** Paleta clara: a mesma que as telas do app usavam, uma por arquivo. */
export const PALETA_CLARA = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primaryTexto: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: 'rgba(155,111,232,0.06)',
  green: '#0D7E5F', greenTexto: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberTexto: '#B45309', amberSoft: '#FEF3E2',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  red: '#C0392B', redTexto: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
  linha: '#D8D0C8',
};

export type Paleta = { [K in keyof typeof PALETA_CLARA]: string };

/** Paleta escura, com as mesmas chaves. Valores confirmados por `contraste.test.ts`. */
export const PALETA_ESCURA: Paleta = {
  bg: '#121017', surface: '#1C1824', border: '#2E2838',
  primary: '#6A45C8', primaryTexto: '#B497F5', primarySoft: '#2A2140',
  accent: '#B497F5', accentSoft: 'rgba(180,151,245,0.10)',
  green: '#17795A', greenTexto: '#3CC995', greenSoft: '#12302A',
  amber: '#A8570F', amberTexto: '#E9A23B', amberSoft: '#33260F',
  rose: '#E07AA0', roseSoft: '#3A1E2C',
  red: '#C23B30', redTexto: '#F07A70', redSoft: '#3A1A1A',
  text: '#F2EEF8', text2: '#CFC6DE', text3: '#A094B8', text4: '#6E6482',
  linha: '#3A3346',
};
