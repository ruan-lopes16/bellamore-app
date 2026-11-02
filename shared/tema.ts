/**
 * @file tema.ts
 * Modo de tema do app (Claro / Escuro / Sistema). Regras puras: o provider do app
 * (`mobile/lib/tema.tsx`) guarda a escolha no AsyncStorage com `CHAVE_TEMA_APP` e resolve o
 * esquema com o do aparelho. Sem dependência de React Native.
 */

export type ModoTema = 'claro' | 'escuro' | 'sistema';
export type EsquemaTema = 'claro' | 'escuro';

/** Chave do AsyncStorage onde o app guarda o modo escolhido. */
export const CHAVE_TEMA_APP = 'bm_tema';

/** Opções na ordem em que aparecem em Configurações. */
export const MODOS_TEMA: readonly { valor: ModoTema; rotulo: string }[] = [
  { valor: 'claro', rotulo: 'Claro' },
  { valor: 'escuro', rotulo: 'Escuro' },
  { valor: 'sistema', rotulo: 'Sistema' },
];

/** Lê o valor guardado; qualquer coisa fora dos 3 modos (ou nada) vira `'sistema'`. */
export function lerModoTema(raw: string | null | undefined): ModoTema {
  return raw === 'claro' || raw === 'escuro' || raw === 'sistema' ? raw : 'sistema';
}

/**
 * Esquema aplicado: o modo escolhido, ou o do aparelho no modo Sistema
 * (`useColorScheme()` do React Native: `'light' | 'dark' | null`). Sem informação → claro.
 */
export function resolverEsquemaTema(modo: ModoTema, sistema: string | null | undefined): EsquemaTema {
  if (modo === 'claro' || modo === 'escuro') return modo;
  return sistema === 'dark' ? 'escuro' : 'claro';
}

/**
 * Fundo de um cartão pintado pela cor da categoria do serviço. No claro, o pastel de sempre (texto
 * escuro por cima); no escuro, a própria cor com ~15% de opacidade sobre o fundo escuro, para o texto
 * claro do tema continuar legível. `null` no escuro quando a cor não é `#RRGGBB`: quem chama usa a
 * superfície do tema.
 */
export function fundoCategoriaNoTema(cor: string, bgClaro: string, escuro: boolean): string | null {
  if (!escuro) return bgClaro;
  return /^#[0-9A-Fa-f]{6}$/.test(cor) ? `${cor}26` : null;
}
