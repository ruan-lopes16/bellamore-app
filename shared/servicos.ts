/**
 * Regras de servico compartilhadas entre web e app.
 */
import { parseValorBR } from './comanda-fechamento';

/** Duracoes (minutos) oferecidas como atalho no cadastro de servico. */
export const DURACOES_PADRAO: number[] = [30, 45, 60, 90, 120, 180];

/** Duracao em minutos inteiros, de 5 minutos a 10 horas. */
export function duracaoValida(min: number): boolean {
  return Number.isInteger(min) && min >= 5 && min <= 600;
}

/**
 * Preço digitado no cadastro de serviço → número (formato brasileiro, via `parseValorBR`).
 * Texto sem nenhum dígito vira NaN (a validação mostra "Informe um preço válido.").
 */
export function lerPrecoServico(txt: string): number {
  return /\d/.test(txt) ? parseValorBR(txt) : NaN;
}

/**
 * Valida os campos obrigatorios de um servico.
 * Devolve a mensagem de erro em portugues, ou null se estiver tudo certo.
 * Preco precisa ser maior que zero: a cortesia e dada no atendimento (valor 0 na agenda/comanda),
 * nunca no catalogo — um servico de R$ 0 entraria de graca em todo agendamento novo.
 */
export function validarServico(s: { nome: string; preco: number; duracao: number }): string | null {
  const nome = (s.nome ?? '').trim();
  if (!nome) return 'Informe o nome do serviço.';
  if (nome.length < 2) return 'O nome do serviço precisa ter pelo menos 2 caracteres.';
  if (!Number.isFinite(s.preco) || s.preco < 0) return 'Informe um preço válido.';
  if (s.preco === 0) return 'Informe um preço maior que zero. A cortesia é dada no atendimento.';
  if (!duracaoValida(s.duracao)) return 'A duração deve ficar entre 5 minutos e 10 horas.';
  return null;
}
