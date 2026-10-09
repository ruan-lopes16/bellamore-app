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

/**
 * Um pagamento da comanda. `taxaGravada`/`metodoGravado`/`parcelasGravadas`/`criadoEm` só existem
 * num split reaberto na edição de comanda fechada: guardam como ele estava no banco, para que a
 * taxa da maquininha da época continue valendo (spec: "pagamentos já gravados mantêm o taxa_perc").
 */
export type SplitPagamento = {
  metodo: string; valor: number; bandeira?: string | null; parcelas?: number;
  /** `taxa_perc` gravado (null = gravado sem taxa); ausente = split novo. */
  taxaGravada?: number | null;
  metodoGravado?: string;
  parcelasGravadas?: number;
  /** `created_at` original do pagamento — regravado para o pagamento não mudar de data. */
  criadoEm?: string | null;
};

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
  /** Só em pagamento reaberto na edição: mantém a data original. */
  created_at?: string;
};

/**
 * Taxa decimal de um split: a gravada, se ele foi reaberto com o mesmo método e parcelas de
 * quando foi gravado; senão a taxa atual da empresa (calcTaxa). Usada no INSERT e na tela.
 */
export function taxaDoSplit(
  s: Pick<SplitPagamento, 'metodo' | 'parcelas' | 'taxaGravada' | 'metodoGravado' | 'parcelasGravadas'>,
  taxas: TaxasCartao,
): number {
  const parcelas = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
  const inalterado = s.taxaGravada !== undefined && s.metodoGravado === s.metodo && (s.parcelasGravadas ?? 1) === parcelas;
  return inalterado ? (s.taxaGravada ?? 0) : calcTaxa(s.metodo, parcelas, taxas);
}

/**
 * Linhas de `pagamentos`: cartão com bandeira/parcelas/taxa/líquido; total zero sem splits = cortesia R$0.
 * Split reaberto (com `taxaGravada`) e com o mesmo método e parcelas de quando foi gravado mantém a
 * taxa gravada; alterado ou novo usa a taxa atual da empresa. `criadoEm` volta como `created_at`.
 */
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
    const taxa = taxaDoSplit(s, ctx.taxas);
    const linha: LinhaPagamento = {
      empresa_id: ctx.empresaId, comanda_id: ctx.comandaId, valor: centavos(s.valor), metodo: s.metodo,
      bandeira: cartao ? (s.bandeira ?? null) : null, parcelas,
      taxa_perc: taxa > 0 ? taxa : null, valor_liquido: taxa > 0 ? valorLiquido(s.valor, taxa) : null,
      status: 'pago',
    };
    if (s.criadoEm) linha.created_at = s.criadoEm;
    return linha;
  });
}

/** Item extra da comanda como a tela o tem; `item_id` = linha já gravada em `comanda_itens`. */
export type ItemComandaPersistivel = {
  item_id?: string; tipo: 'servico' | 'produto' | 'pacote'; descricao: string;
  servico_id?: string; produto_id?: string; pacote_id?: string; profissional_id?: string | null;
  quantidade: number; valor: number;
};
/** Como o item estava no banco ao reabrir a comanda fechada. */
export type ItemComandaOriginal = { item_id: string; valor: number; quantidade: number; profissional_id: string | null };

/**
 * Edição de comanda fechada por diferença (não apaga e reinsere): a comissão do serviço extra
 * mora no item (migration 085) e recriar o item recriaria a comissão — ou falharia se já paga.
 */
export function diffItensComanda(originais: ItemComandaOriginal[], atuais: ItemComandaPersistivel[]) {
  const porId = new Map(originais.map(o => [o.item_id, o]));
  const mantidos = new Set<string>();
  const inserir: ItemComandaPersistivel[] = [];
  const atualizar: { item_id: string; valor_unit: number; quantidade: number; profissional_id: string | null }[] = [];
  for (const i of atuais) {
    const o = i.item_id ? porId.get(i.item_id) : undefined;
    if (!o) { inserir.push(i); continue; }
    mantidos.add(o.item_id);
    const prof = i.profissional_id ?? null;
    if (centavos(i.valor) !== centavos(o.valor) || i.quantidade !== o.quantidade || prof !== o.profissional_id) {
      atualizar.push({ item_id: o.item_id, valor_unit: centavos(i.valor), quantidade: i.quantidade, profissional_id: prof });
    }
  }
  const apagar = originais.filter(o => !mantidos.has(o.item_id)).map(o => o.item_id);
  return { inserir, atualizar, apagar };
}
