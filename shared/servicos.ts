/**
 * Regras de servico compartilhadas entre web e app.
 */

/** Duracoes (minutos) oferecidas como atalho no cadastro de servico. */
export const DURACOES_PADRAO: number[] = [30, 45, 60, 90, 120, 180];

/** Duracao em minutos inteiros, de 5 minutos a 10 horas. */
export function duracaoValida(min: number): boolean {
  return Number.isInteger(min) && min >= 5 && min <= 600;
}

/**
 * Valida os campos obrigatorios de um servico.
 * Devolve a mensagem de erro em portugues, ou null se estiver tudo certo.
 * Preco zero e permitido (cortesia).
 */
export function validarServico(s: { nome: string; preco: number; duracao: number }): string | null {
  if (!s.nome || !s.nome.trim()) return 'Informe o nome do serviço.';
  if (!Number.isFinite(s.preco) || s.preco < 0) return 'Informe um preço válido.';
  if (!duracaoValida(s.duracao)) return 'A duração deve ficar entre 5 minutos e 10 horas.';
  return null;
}
