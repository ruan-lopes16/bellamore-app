/**
 * Regra única de fechamento da comanda (web e app) — spec
 * docs/superpowers/specs/2026-10-08-comanda-a-fechamento-correto-design.md.
 * O valor cobrado por atendimento continua em shared/comanda.ts (agruparValoresPorAgendamento).
 */
import { formatarMoeda } from './moeda';
import { calcTaxa, valorLiquido, type TaxasCartao } from './taxas-cartao';

export type ModoDesconto = 'percentual' | 'valor';

/** Bandeiras de cartão oferecidas no pagamento (crédito/débito) — mesma lista no web e no app. */
export const BANDEIRAS_CARTAO = [
  { key: 'visa',       label: 'Visa'      },
  { key: 'mastercard', label: 'Master'    },
  { key: 'elo',        label: 'Elo'       },
  { key: 'amex',       label: 'Amex'      },
  { key: 'hipercard',  label: 'Hipercard' },
] as const;

/** Rótulo de exibição por chave de bandeira (recibo, tela de sucesso). */
export const ROTULOS_BANDEIRA: Record<string, string> = Object.fromEntries(
  BANDEIRAS_CARTAO.map(b => [b.key, b.label]),
);

const centavos = (v: number) => Math.round(v * 100) / 100;
const ERRO_DESCONTO = 'O desconto não pode ser maior que o subtotal';

/**
 * Valor digitado → número. Aceita '1.234,56', '12,5', 'R$ 10,00' e também ponto como
 * decimal ('10.50' → 10.5; o input de valor é texto livre). Ponto só é milhar quando
 * todos os grupos depois dele têm 3 dígitos e não há vírgula ('1.234' → 1234).
 * Vazio, inválido ou negativo → 0.
 */
export function parseValorBR(s: string): number {
  const limpo = s.replace(/R\$/gi, '').replace(/\s/g, '');
  let normal: string;
  if (limpo.includes(',')) normal = limpo.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) normal = limpo.replace(/\./g, '');
  else normal = limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Desconto em reais a partir do que a pessoa digitou (% ou R$). Acima do subtotal → erro e valor limitado. */
export function calcularDesconto(subtotal: number, entrada: number, modo: ModoDesconto): { valor: number; erro: string | null } {
  const bruto = Math.max(0, modo === 'percentual' ? centavos((subtotal * entrada) / 100) : centavos(entrada));
  if (bruto > subtotal + 0.001) return { valor: centavos(subtotal), erro: ERRO_DESCONTO };
  return { valor: bruto, erro: null };
}

export type SplitPagamento = { metodo: string; valor: number; bandeira?: string | null; parcelas?: number };

export type ResumoComanda = {
  subtotal: number; desconto: number; descontoReserva: number; total: number;
  recebido: number; falta: number; troco: number;
  cortesiaAutomatica: boolean; podeFechar: boolean; motivo: string | null;
};

/** Totais da comanda e se ela pode fechar (total coberto; troco permitido; total zero = cortesia). */
export function resumoComanda(e: {
  subtotal: number; desconto: number; erroDesconto?: string | null; descontoReserva: number; splits: SplitPagamento[];
}): ResumoComanda {
  const total = centavos(Math.max(e.subtotal - e.desconto - e.descontoReserva, 0));
  const recebido = centavos(e.splits.reduce((s, x) => s + (x.valor > 0 ? x.valor : 0), 0));
  const falta = centavos(Math.max(total - recebido, 0));
  const troco = centavos(Math.max(recebido - total, 0));
  const cortesiaAutomatica = total < 0.01;
  // Tolerância de meio centavo (só ruído de ponto flutuante): total de R$ 0,01 exige pagamento.
  const coberto = cortesiaAutomatica || recebido >= total - 0.005;
  const motivo = e.erroDesconto ?? (coberto ? null : `Ainda faltam ${formatarMoeda(falta)} para cobrir o total`);
  return {
    subtotal: e.subtotal, desconto: e.desconto, descontoReserva: e.descontoReserva,
    total, recebido, falta, troco, cortesiaAutomatica, podeFechar: !e.erroDesconto && coberto, motivo,
  };
}

export type LinhaPagamento = {
  empresa_id: string; comanda_id: string; valor: number; metodo: string;
  bandeira: string | null; parcelas: number; taxa_perc: number | null; valor_liquido: number | null; status: 'pago';
};

/** Linhas de `pagamentos`: cartão com bandeira/parcelas/taxa/líquido; total zero sem splits = cortesia R$0. */
export function montarPagamentos(
  splits: SplitPagamento[],
  ctx: { empresaId: string; comandaId: string; taxas: TaxasCartao; total: number },
): LinhaPagamento[] {
  const validos = splits.filter(s => s.valor > 0);
  if (validos.length === 0 && ctx.total < 0.01) {
    return [{ empresa_id: ctx.empresaId, comanda_id: ctx.comandaId, valor: 0, metodo: 'cortesia', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null, status: 'pago' }];
  }
  return validos.map(s => {
    const cartao = s.metodo === 'credito' || s.metodo === 'debito';
    const parcelas = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
    const taxa = calcTaxa(s.metodo, parcelas, ctx.taxas);
    return {
      empresa_id: ctx.empresaId, comanda_id: ctx.comandaId, valor: centavos(s.valor), metodo: s.metodo,
      bandeira: cartao ? (s.bandeira ?? null) : null, parcelas,
      taxa_perc: taxa > 0 ? taxa : null, valor_liquido: taxa > 0 ? valorLiquido(s.valor, taxa) : null,
      status: 'pago',
    };
  });
}
