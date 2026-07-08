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
