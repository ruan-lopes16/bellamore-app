import type { DespesaStatus } from './dominio';

export type DespesaPagamentoUpdate = {
  status: Extract<DespesaStatus, 'pago'>;
  data_pagamento: string;
  valor: number;
};

/**
 * Converte entradas comuns de moeda BRL para numero positivo com 2 casas.
 */
export function parseValorMonetario(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned) return null;

  const commaIndex = cleaned.lastIndexOf(',');
  const dotIndex = cleaned.lastIndexOf('.');
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  let normalized = cleaned;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = cleaned.replace(',', '.');
  } else if (dotIndex >= 0) {
    const digitsAfterDot = cleaned.length - dotIndex - 1;
    if (dotCount > 1 || digitsAfterDot === 3) {
      normalized = cleaned.replace(/\./g, '');
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;

  return Math.round(value * 100) / 100;
}

/**
 * Formata um numero para edicao em input monetario simples, sem simbolo R$.
 */
export function formatValorMonetarioInput(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/**
 * Monta o payload da confirmacao de pagamento sem alterar dados de recorrencia.
 */
export function buildDespesaPagamentoUpdate(
  dataPagamento: string,
  valorInput: string,
): DespesaPagamentoUpdate | null {
  const valor = parseValorMonetario(valorInput);
  if (valor === null) return null;

  return {
    status: 'pago',
    data_pagamento: dataPagamento,
    valor,
  };
}

/**
 * Indica se uma recorrencia mensal ainda deve ser sugerida para o mes
 * cujo inicio (YYYY-MM-DD) e `periodoInicioIso`. Sem data de termino,
 * a recorrencia nunca encerra.
 */
export function recorrenciaAindaAtiva(
  recorrenciaAte: string | null | undefined,
  periodoInicioIso: string,
): boolean {
  if (!recorrenciaAte) return true;
  return recorrenciaAte >= periodoInicioIso;
}

/**
 * Dias entre hoje e o vencimento (YYYY-MM-DD). Negativo quando ja atrasada.
 */
export function diasParaVencimento(
  dataVencimento: string,
  hojeIso: string,
): number {
  const venc = new Date(dataVencimento + 'T00:00:00');
  const hoje = new Date(hojeIso + 'T00:00:00');
  return Math.round((venc.getTime() - hoje.getTime()) / 86_400_000);
}

/**
 * Fracao (0 a 1) do caminho percorrido entre a criacao e o vencimento de uma
 * despesa. Usada para preencher a barra de progresso na listagem.
 */
export function progressoVencimento(
  criadaEmIso: string,
  dataVencimento: string,
  hojeIso: string,
): number {
  const inicio = new Date(criadaEmIso.slice(0, 10) + 'T00:00:00').getTime();
  const fim    = new Date(dataVencimento + 'T00:00:00').getTime();
  const hoje   = new Date(hojeIso + 'T00:00:00').getTime();
  if (fim <= inicio) return 1;
  const fracao = (hoje - inicio) / (fim - inicio);
  return Math.min(1, Math.max(0, fracao));
}
