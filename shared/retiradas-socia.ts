import { parseValorMonetario, dividirValorCompra } from './despesas';

export type MetodoPagamentoRetirada = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
export type RetiradaSociaTipo = 'emprestimo' | 'retirada';

export interface RetiradaSociaRow {
  id: string;
  tipo: RetiradaSociaTipo;
  valor: number;
  data: string;                       // YYYY-MM-DD
  descricao: string | null;
  metodo: MetodoPagamentoRetirada | null;
  parcelado: boolean;
  total_parcelas: number | null;
  valor_parcela: number | null;
  primeira_parcela_em: string | null; // YYYY-MM-DD
  convertido_em: string | null;       // YYYY-MM-DD
  created_at?: string;
}

export interface RetiradaSociaDevolucaoRow {
  id: string;
  retirada_id: string;
  valor: number;
  data: string;
  metodo: MetodoPagamentoRetirada | null;
}

export interface RetiradaSociaInsert {
  empresa_id: string;
  tipo: RetiradaSociaTipo;
  valor: number;
  data: string;
  descricao: string | null;
  metodo: MetodoPagamentoRetirada | null;
  parcelado: boolean;
  total_parcelas: number | null;
  valor_parcela: number | null;
  primeira_parcela_em: string | null;
  criado_por: string | null;
}

export interface DevolucaoInsert {
  retirada_id: string;
  empresa_id: string;
  valor: number;
  data: string;
  metodo: MetodoPagamentoRetirada | null;
}

export type RetiradaFormInput = {
  empresaId: string;
  tipo: RetiradaSociaTipo;
  valorInput: string;
  data: string;
  descricao: string;
  metodo: MetodoPagamentoRetirada | null;
  parcelado: boolean;
  totalParcelasInput: string;
  valorParcelaInput: string;
  primeiraParcelaEm: string;
};

const cent = (v: number) => Math.round(v * 100) / 100;

/** Soma as devoluções por retirada_id. */
export function somaDevolucoesPorRetirada(
  devs: { retirada_id: string; valor: number }[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const d of devs) map[d.retirada_id] = cent((map[d.retirada_id] ?? 0) + d.valor);
  return map;
}

/** Saldo de um empréstimo: valor − devolvido, nunca negativo. */
export function saldoEmprestimo(valor: number, devolvido: number): number {
  return Math.max(0, cent(valor - devolvido));
}

/**
 * Total que conta como "retirada da dona" no período:
 *   - retiradas definitivas com `data` no período;
 *   - empréstimos convertidos em retirada (`convertido_em` no período): entra o
 *     saldo em aberto no momento da conversão (valor − devolvido).
 * Empréstimos ainda abertos NÃO entram aqui (ver saldoDevedorTotal).
 */
export function retiradasNoPeriodo(
  rows: Pick<RetiradaSociaRow, 'id' | 'tipo' | 'valor' | 'data' | 'convertido_em'>[],
  devolvidoPorRetirada: Record<string, number>,
  inicioIso: string,
  fimIso: string,
): number {
  let total = 0;
  for (const r of rows) {
    if (r.tipo === 'retirada') {
      if (r.data >= inicioIso && r.data <= fimIso) total += r.valor;
    } else if (r.convertido_em && r.convertido_em >= inicioIso && r.convertido_em <= fimIso) {
      total += Math.max(0, r.valor - (devolvidoPorRetirada[r.id] ?? 0));
    }
  }
  return cent(total);
}

/**
 * Saldo devedor total da dona: soma dos empréstimos ainda abertos (não
 * convertidos) líquidos das devoluções. Não é preso a período — é um saldo.
 */
export function saldoDevedorTotal(
  rows: Pick<RetiradaSociaRow, 'id' | 'tipo' | 'valor' | 'convertido_em'>[],
  devolvidoPorRetirada: Record<string, number>,
): number {
  let total = 0;
  for (const r of rows) {
    if (r.tipo === 'emprestimo' && !r.convertido_em) {
      total += Math.max(0, r.valor - (devolvidoPorRetirada[r.id] ?? 0));
    }
  }
  return cent(total);
}

/**
 * Soma `meses` a uma data YYYY-MM-DD, mantendo o dia e fazendo clamp quando o
 * mês alvo é mais curto (31/01 + 1 mês → 28/02). Mesma lógica de clamp de
 * `calcularRecorrenciaAtePorParcelas` em shared/despesas.ts — mantida aqui
 * para não acoplar os dois módulos por um primitivo de data de 5 linhas.
 */
export function somarMesesIso(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const anoAlvo = ano + Math.floor((mes - 1 + meses) / 12);
  const mesAlvo = (((mes - 1 + meses) % 12) + 12) % 12;
  const ultimoDia = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  const diaAlvo = Math.min(dia, ultimoDia);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${anoAlvo}-${pad(mesAlvo + 1)}-${pad(diaAlvo)}`;
}

/**
 * Estado do cronograma de um empréstimo parcelado, derivado do total devolvido.
 * `parcelasQuitadas = floor(devolvido / valorParcela)` (com epsilon p/ float),
 * limitado a `totalParcelas`. A próxima parcela vence `parcelasQuitadas` meses
 * depois da 1ª (robusto a meses pulados — conta pelo que foi devolvido, não
 * incrementa fixo). `atrasada` quando hoje já passou dessa data.
 */
export function statusParcela(
  valorParcela: number,
  primeiraParcelaEm: string,
  totalParcelas: number,
  devolvido: number,
  hojeIso: string,
): { parcelasQuitadas: number; proximaParcelaEm: string | null; atrasada: boolean } {
  const quitadas = Math.min(
    Math.floor(devolvido / valorParcela + 1e-6),
    totalParcelas,
  );
  if (quitadas >= totalParcelas) {
    return { parcelasQuitadas: totalParcelas, proximaParcelaEm: null, atrasada: false };
  }
  const proximaParcelaEm = somarMesesIso(primeiraParcelaEm, quitadas);
  return {
    parcelasQuitadas: quitadas,
    proximaParcelaEm,
    atrasada: hojeIso > proximaParcelaEm,
  };
}

/**
 * Valida e monta o payload de insert de retiradas_socia a partir do formulário.
 * Retorna `{ ok: false, erro }` com mensagem em pt-BR quando algo impede o
 * registro — a UI mostra `erro` e não salva (mesmo padrão das validações de
 * despesas parceladas). Campos de parcela só valem para tipo='emprestimo'
 * com `parcelado = true`; em qualquer outro caso vão zerados.
 */
export function montarRetiradaSociaInsert(
  form: RetiradaFormInput,
  criadoPor: string | null,
): { ok: true; payload: RetiradaSociaInsert } | { ok: false; erro: string } {
  const valor = parseValorMonetario(form.valorInput);
  if (valor === null) return { ok: false, erro: 'Informe um valor maior que zero.' };
  if (!form.data) return { ok: false, erro: 'Informe a data.' };

  const ehEmprestimoParcelado = form.tipo === 'emprestimo' && form.parcelado;

  let total_parcelas: number | null = null;
  let valor_parcela: number | null = null;
  let primeira_parcela_em: string | null = null;

  if (ehEmprestimoParcelado) {
    const n = Number(form.totalParcelasInput);
    if (!Number.isInteger(n) || n < 2) {
      return { ok: false, erro: 'O número de parcelas deve ser 2 ou mais.' };
    }
    if (!form.primeiraParcelaEm) {
      return { ok: false, erro: 'Informe a data da primeira parcela.' };
    }
    total_parcelas = n;
    primeira_parcela_em = form.primeiraParcelaEm;
    const informado = parseValorMonetario(form.valorParcelaInput);
    valor_parcela = informado ?? dividirValorCompra(valor, n).valorBase;
  }

  return {
    ok: true,
    payload: {
      empresa_id: form.empresaId,
      tipo: form.tipo,
      valor,
      data: form.data,
      descricao: form.descricao.trim() || null,
      metodo: form.metodo,
      parcelado: ehEmprestimoParcelado,
      total_parcelas,
      valor_parcela,
      primeira_parcela_em,
      criado_por: criadoPor,
    },
  };
}

/** Valida e monta o payload de uma devolução de empréstimo. */
export function montarDevolucaoInsert(
  retiradaId: string,
  empresaId: string,
  valorInput: string,
  data: string,
  metodo: MetodoPagamentoRetirada | null,
): { ok: true; payload: DevolucaoInsert } | { ok: false; erro: string } {
  const valor = parseValorMonetario(valorInput);
  if (valor === null) return { ok: false, erro: 'Informe um valor maior que zero.' };
  if (!data) return { ok: false, erro: 'Informe a data.' };
  return { ok: true, payload: { retirada_id: retiradaId, empresa_id: empresaId, valor, data, metodo } };
}
