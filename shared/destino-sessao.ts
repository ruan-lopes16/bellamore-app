/**
 * @file destino-sessao.ts
 * Decisão única (web e app) de para onde vai quem abre a área logada, a partir do que se sabe da
 * sessão e dos vínculos com empresas. `/login` é só para quem NÃO tem sessão e `/criar-empresa`
 * só para quem teve os vínculos lidos com sucesso e não tem nenhum: erro ao ler os vínculos é um
 * estado próprio ("erro-vinculos"), nunca um desses dois.
 */

export type DestinoSessao = 'login' | 'erro-vinculos' | 'criar-empresa' | 'app';

export interface EntradaDestinoSessao {
  temSessao: boolean;
  /** A leitura de `empresa_membros` (e empresas da dona) falhou. */
  erroVinculos: boolean;
  /** Há ao menos um vínculo ativo (só vale com `erroVinculos` falso). */
  temVinculo: boolean;
}

/** Texto único do estado de erro de vínculos (web e app). */
export const TITULO_ERRO_VINCULOS = 'Não foi possível carregar suas empresas';

/** @returns o destino da pessoa; o erro de leitura nunca cai em login nem em criar-empresa. */
export function decidirDestinoSessao(e: EntradaDestinoSessao): DestinoSessao {
  if (!e.temSessao) return 'login';
  if (e.erroVinculos) return 'erro-vinculos';
  return e.temVinculo ? 'app' : 'criar-empresa';
}
