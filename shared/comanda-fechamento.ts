/**
 * Regra única de fechamento da comanda (web e app) — spec
 * docs/superpowers/specs/2026-10-08-comanda-a-fechamento-correto-design.md.
 * O valor cobrado por atendimento continua em shared/comanda.ts (agruparValoresPorAgendamento).
 */
import { formatarMoeda } from './moeda';
import { maquininhaPadrao, taxaDoCartao, valorLiquido, type ConfigCartoes } from './taxas-cartao';

export type ModoDesconto = 'percentual' | 'valor';

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
  /** Maquininha escolhida (cartão). Ausente/null = a padrão da empresa. */
  maquininhaId?: string | null;
  /** `maquininha_id` gravado no split reaberto (null = gravado antes da migration 086). */
  maquininhaGravada?: string | null;
  /** `bandeira` gravada no split reaberto. */
  bandeiraGravada?: string | null;
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
  empresa_id: string; comanda_id?: string; venda_id?: string; valor: number; metodo: string;
  bandeira: string | null; parcelas: number; taxa_perc: number | null; valor_liquido: number | null;
  /** Maquininha usada (só cartão; null fora do cartão ou sem a migration 086). */
  maquininha_id: string | null;
  status: 'pago';
  /** Só em pagamento reaberto na edição: mantém a data original. */
  created_at?: string;
};

/**
 * Split reaberto sem nenhuma mudança que afete a taxa: mesmo método, parcelas, maquininha e
 * bandeira de quando foi gravado. Pagamento antigo (antes da 086) tem `maquininhaGravada` null:
 * continua "a mesma maquininha" enquanto ninguém escolher uma (maquininhaId null/ausente).
 */
function reabertoInalterado(s: SplitPagamento, parcelas: number): boolean {
  if (s.taxaGravada === undefined) return false;
  if (s.metodoGravado !== s.metodo || (s.parcelasGravadas ?? 1) !== parcelas) return false;
  if (s.maquininhaGravada !== undefined && (s.maquininhaId ?? null) !== (s.maquininhaGravada ?? null)) return false;
  if (s.bandeiraGravada !== undefined && (s.bandeira ?? null) !== (s.bandeiraGravada ?? null)) return false;
  return true;
}

/**
 * Taxa decimal de um split: a gravada, se ele foi reaberto sem mudar método, parcelas, maquininha
 * e bandeira; senão a da tabela configurada (`taxaDoCartao`). `null` = combinação sem taxa
 * cadastrada (a tela avisa e o pagamento é gravado sem taxa). Pix/dinheiro/cortesia → 0.
 */
export function taxaDoSplit(
  s: Pick<SplitPagamento, 'metodo' | 'parcelas' | 'bandeira' | 'taxaGravada' | 'metodoGravado' | 'parcelasGravadas' | 'maquininhaId' | 'maquininhaGravada' | 'bandeiraGravada'>,
  config: ConfigCartoes,
): number | null {
  const parcelas = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
  if (reabertoInalterado(s as SplitPagamento, parcelas)) return s.taxaGravada ?? 0;
  return taxaDoCartao(config, { maquininhaId: s.maquininhaId, bandeiraChave: s.bandeira, metodo: s.metodo, parcelas });
}

/**
 * Linhas de `pagamentos`: cartão com maquininha/bandeira/parcelas/taxa/líquido; total zero sem
 * splits = cortesia R$0. Taxa por `taxaDoSplit` (null ou 0 → grava sem taxa). `maquininha_id` só
 * no cartão e fora do legado (sem a 086 a coluna não existe): a escolhida ou a padrão.
 * Grava só `comanda_id` (comanda) ou só `venda_id` (venda avulsa), conforme o ctx.
 * `criadoEm` volta como `created_at`.
 */
export function montarPagamentos(
  splits: SplitPagamento[],
  ctx: { empresaId: string; comandaId?: string; vendaId?: string; config: ConfigCartoes; total: number },
): LinhaPagamento[] {
  const vinculo = (): Pick<LinhaPagamento, 'comanda_id' | 'venda_id'> =>
    ctx.comandaId ? { comanda_id: ctx.comandaId } : ctx.vendaId ? { venda_id: ctx.vendaId } : {};
  const validos = splits.filter(s => s.valor > 0);
  if (validos.length === 0 && ctx.total < 0.01) {
    return [{ empresa_id: ctx.empresaId, ...vinculo(), valor: 0, metodo: 'cortesia', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null, maquininha_id: null, status: 'pago' }];
  }
  const padraoId = maquininhaPadrao(ctx.config)?.id ?? null;
  // Reaberto inalterado mantém a maquininha gravada (inclusive null de antes da 086, sem atribuir
  // à padrão um pagamento antigo). Id fora da configuração (ex.: 'legado' escolhido antes de a
  // configuração carregar) → a padrão.
  const maquininhaDaLinha = (s: SplitPagamento, parcelas: number): string | null => {
    if (s.maquininhaGravada !== undefined && reabertoInalterado(s, parcelas)) return s.maquininhaGravada;
    return ctx.config.maquininhas.some(m => m.id === s.maquininhaId) ? (s.maquininhaId as string) : padraoId;
  };
  return validos.map(s => {
    const cartao = s.metodo === 'credito' || s.metodo === 'debito';
    const parcelas = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
    const taxa = taxaDoSplit(s, ctx.config);
    const comTaxa = taxa !== null && taxa > 0;
    const linha: LinhaPagamento = {
      empresa_id: ctx.empresaId, ...vinculo(), valor: centavos(s.valor), metodo: s.metodo,
      bandeira: cartao ? (s.bandeira ?? null) : null, parcelas,
      taxa_perc: comTaxa ? taxa : null, valor_liquido: comTaxa ? valorLiquido(s.valor, taxa) : null,
      maquininha_id: cartao && !ctx.config.legado ? maquininhaDaLinha(s, parcelas) : null,
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
