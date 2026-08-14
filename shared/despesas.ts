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

export type RecorrenteTemplateHistorico = {
  descricao: string;
  categoria?: string;
  valor: number;
  periodicidade?: string;
  data_vencimento?: string;
  recorrencia_ate?: string;
};

/**
 * A partir do historico de despesas recorrentes mensais (mais recente primeiro),
 * retorna o template mais recente de cada chave composta (descricao+categoria)
 * cuja recorrencia ainda esta ativa no mes visualizado, excluindo os que ja
 * existem no mes atual.
 *
 * A ordem importa: primeiro agrupamos por chave (mantendo a linha mais recente
 * de cada uma), so depois filtramos por recorrencia encerrada. Filtrar antes de
 * agrupar deixaria uma linha antiga sem `recorrencia_ate` "reviver" uma
 * recorrencia que uma linha mais recente ja tinha encerrado.
 */
export function templatesRecorrentesParaLancar(
  historico: RecorrenteTemplateHistorico[],
  chavesMesAtual: Set<string>,
  periodoInicioIso: string,
): RecorrenteTemplateHistorico[] {
  const porChave: Record<string, RecorrenteTemplateHistorico> = {};
  for (const r of historico) {
    const chave = `${r.descricao}||${r.categoria ?? ''}`;
    if (!porChave[chave]) porChave[chave] = r;   // primeiro = mais recente
  }
  return Object.values(porChave)
    .filter(r => recorrenciaAindaAtiva(r.recorrencia_ate, periodoInicioIso))
    .filter(r => !chavesMesAtual.has(`${r.descricao}||${r.categoria ?? ''}`));
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

/**
 * Calcula a data de vencimento da ultima parcela a partir da data de
 * vencimento da parcela sendo cadastrada agora, do total de parcelas do
 * contrato e de qual parcela essa e (1 = primeira). Usado para preencher
 * `recorrencia_ate` automaticamente quando o usuario escolhe informar
 * quantidade de parcelas em vez de digitar uma data.
 * `parcelaAtual` fora do intervalo `[1, totalParcelas]` e ajustado (clamp)
 * para dentro do intervalo em vez de gerar uma data invalida.
 */
export function calcularRecorrenciaAtePorParcelas(
  dataVencimento: string,
  totalParcelas: number,
  parcelaAtual: number,
): string {
  const parcelaAtualClamped = Math.min(Math.max(parcelaAtual, 1), totalParcelas);
  const mesesRestantes = totalParcelas - parcelaAtualClamped;
  const [ano, mes, dia] = dataVencimento.split('-').map(Number);
  const anoAlvo = ano + Math.floor((mes - 1 + mesesRestantes) / 12);
  const mesAlvo = (mes - 1 + mesesRestantes) % 12;
  const ultimoDia = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  const diaAlvo = Math.min(dia, ultimoDia);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${anoAlvo}-${pad(mesAlvo + 1)}-${pad(diaAlvo)}`;
}
