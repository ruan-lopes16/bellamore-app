/**
 * Gravações de Pacotes pelas funções da migration 096 (web e app usam estas, nunca o banco direto):
 * - `venderPacote` → `vender_pacote(p jsonb)`: venda única de pacote, "Cobrar agora" ou "Cobrar na comanda";
 * - `excluirPacoteCliente` → `excluir_pacote_cliente(p_empresa, p_id)`;
 * - `excluirServico` → `excluir_servico(p_empresa, p_id)`.
 * Contrato: docs/superpowers/notes/2026-10-23-contrato-pacotes.md.
 *
 * Sem a 096 no banco (PostgREST devolve `PGRST202`) as três lançam `SemMigration096`, e a tela decide o
 * caminho antigo. Qualquer outro erro vira `ErroPacote` com a mensagem pronta para a tela.
 */
import { mensagemErroBanco } from './erros';
import { montarPagamentos, type LinhaPagamento, type ResumoComanda, type SplitPagamento } from './comanda-fechamento';
import { dataValidade, quantidadeValida, ratearValorPago } from './pacotes';
import type { ConfigCartoes } from './taxas-cartao';
import { hojeBRT } from './periodos';
import { novoUuid } from './uuid';
import { formatarMoeda } from './moeda';

/** O mínimo do client supabase-js usado aqui: só `rpc`. Estrutural (shared não depende do @supabase/*). */
export interface ClienteDbRpc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

/** A função ainda não existe no banco (a 096 não foi rodada). A tela usa o caminho antigo. */
export class SemMigration096 extends Error {
  constructor() {
    super('A migration 096 ainda não foi aplicada.');
    this.name = 'SemMigration096';
  }
}

/**
 * Erro de uma gravação de Pacotes, com a mensagem pronta para a tela. `semResposta` = a rede caiu na
 * chamada: a venda PODE ter sido gravada (a nova tentativa com a mesma `vendaId` não duplica).
 */
export class ErroPacote extends Error {
  constructor(mensagem: string, readonly semResposta = false) {
    super(mensagem);
    this.name = 'ErroPacote';
  }
}

/**
 * Pagamento da venda "agora", no formato de `registrar_venda_avulsa_v2`. Uma `LinhaPagamento` de
 * `montarPagamentos` (shared/comanda-fechamento.ts) serve como está: as outras chaves são descartadas.
 */
export type PagamentoPacote = Pick<LinhaPagamento, 'valor' | 'metodo' | 'bandeira' | 'parcelas' | 'taxa_perc'>
  & { maquininha_id?: string | null };

/** Entrada de `venderPacote`. `desconto` em R$ (já convertido de %). */
export type EntradaVendaPacote = {
  /** Chave da venda (uuid gerado uma vez por modal): a nova tentativa com a mesma chave não duplica. */
  vendaId: string;
  empresaId: string;
  clienteId: string;
  pacoteId: string;
  /** Unidades (inteiro, 1 a 100): um pacote_clientes por unidade. */
  quantidade: number;
  valorUnit: number;
  desconto: number;
  /** 'agora' = venda e pagamentos já; 'comanda' = pacote "a cobrar", cobrado ao fechar a comanda. */
  cobranca: 'agora' | 'comanda';
  /** Obrigatórios em 'agora'; ignorados (enviados vazios) em 'comanda'. */
  pagamentos: PagamentoPacote[];
};

const centavos = (v: number) => Math.round(v * 100) / 100;

/** O JSON `p` de `vender_pacote` (contrato). Exportado para a tela montar a assinatura da tentativa. */
export function argumentosVendaPacote(e: EntradaVendaPacote): Record<string, unknown> {
  return {
    venda_id: e.vendaId,
    empresa_id: e.empresaId,
    cliente_id: e.clienteId,
    pacote_id: e.pacoteId,
    quantidade: e.quantidade,
    valor_unit: centavos(e.valorUnit),
    desconto: centavos(e.desconto),
    cobranca: e.cobranca,
    pagamentos: e.cobranca === 'agora'
      ? e.pagamentos.map(p => ({
          valor: centavos(p.valor), metodo: p.metodo, bandeira: p.bandeira ?? null, parcelas: p.parcelas ?? 1,
          taxa_perc: p.taxa_perc ?? null, maquininha_id: p.maquininha_id ?? null,
        }))
      : [],
  };
}

type ErroRpc = { code?: string | null; message?: string | null } | null | undefined;

/** Chama a função; PGRST202 → SemMigration096; sem código (rede) → semResposta; resto → ErroPacote. */
async function chamar(db: ClienteDbRpc, fn: string, args: Record<string, unknown>, acao: string): Promise<void> {
  let error: ErroRpc;
  try {
    ({ error } = await db.rpc(fn, args));
  } catch {
    throw new ErroPacote(`Sem resposta do servidor ao ${acao}. Confira antes de tentar de novo.`, true);
  }
  if (!error) return;
  if (error.code === 'PGRST202') throw new SemMigration096();
  if (!error.code) throw new ErroPacote(`Sem resposta do servidor ao ${acao}. Confira antes de tentar de novo.`, true);
  throw new ErroPacote(mensagemErroBanco(error, acao));
}

/**
 * Vende um pacote (`vender_pacote`, 096) numa transação só: em 'agora' grava venda, pacotes e
 * pagamentos; em 'comanda' grava os pacotes "a cobrar". Lança `SemMigration096` ou `ErroPacote`.
 */
export async function venderPacote(db: ClienteDbRpc, entrada: EntradaVendaPacote): Promise<void> {
  if (entrada.cobranca === 'agora' && entrada.pagamentos.length === 0) {
    throw new ErroPacote('Pagamento não informado.');
  }
  await chamar(db, 'vender_pacote', { p: argumentosVendaPacote(entrada) }, 'vender o pacote');
}

/**
 * Exclui um pacote vendido sem sessão usada e acerta a venda ligada (`excluir_pacote_cliente`, 096).
 * Lança `SemMigration096` ou `ErroPacote` (ex.: "Este pacote já tem sessões usadas...").
 */
export async function excluirPacoteCliente(db: ClienteDbRpc, empresaId: string, id: string): Promise<void> {
  await chamar(db, 'excluir_pacote_cliente', { p_empresa: empresaId, p_id: id }, 'excluir o pacote vendido');
}

/**
 * Exclui um serviço que nunca foi usado (`excluir_servico`, 096). Usado → `ErroPacote` com
 * "Este serviço já foi usado. Desative em vez de excluir.". Lança `SemMigration096` sem a 096.
 */
export async function excluirServico(db: ClienteDbRpc, empresaId: string, id: string): Promise<void> {
  await chamar(db, 'excluir_servico', { p_empresa: empresaId, p_id: id }, 'excluir o serviço');
}

// ── Textos únicos da venda (web e app) ──────────────────────────────────────────────────────

/** Explicação da cobrança escolhida, embaixo dos botões "Cobrar agora" / "Cobrar na comanda". */
export const TEXTO_COBRANCA: Record<'agora' | 'comanda', string> = {
  agora: 'O pagamento é registrado agora e entra no faturamento de hoje.',
  comanda: 'O pacote fica "A cobrar" e entra na próxima comanda da cliente. A cliente já pode usar as sessões.',
};
export const MSG_COMANDA_INDISPONIVEL =
  '"Cobrar na comanda" ainda não está disponível. Escolha a forma de pagamento para cobrar agora.';
export const MSG_AGUARDE_CARTOES = 'Aguarde: carregando as taxas dos cartões.';
export const MSG_ALTERADA_SEM_RESPOSTA =
  'Sem resposta do servidor na tentativa anterior: ela pode ter sido gravada. Toque em Conferir antes de mudar a venda.';
export const MSG_VENDA_JA_GRAVADA = 'Essa venda já tinha sido registrada.';

/** Rótulo do botão de vender (web e app): com o total em "Cobrar agora". */
export function textoBotaoVenderPacote(cobranca: 'agora' | 'comanda', total: number): string {
  return cobranca === 'agora' ? `Vender · ${formatarMoeda(total)}` : 'Vender e cobrar na comanda';
}

/**
 * O que a venda gravou, para a tela que abriu o modal (web `VenderPacoteModal`, app `VenderPacoteSheet`).
 * Tipo único das duas plataformas.
 */
export type ResultadoVendaPacote = {
  cobranca: 'agora' | 'comanda';
  vendaId: string;
  clienteId: string;
  pacoteId: string;
  quantidade: number;
  /**
   * Id do 1º pacote vendido (com a 096 é a própria `vendaId`): a Agenda vincula o atendimento a ele.
   * `null` no caminho antigo (sem a 096) ou na venda conferida depois de "sem resposta".
   */
  pacoteClienteId: string | null;
  /** Gravou, mas algo ficou para conferir (caminho antigo: pagamento não registrado). */
  aviso: string | null;
};

/** Venda "Cobrar na comanda" pela Agenda: o pacote já está gravado, salvando ou não o agendamento. */
export const AVISO_PACOTE_A_COBRAR_AGENDA = 'O pacote foi vendido e fica a cobrar na próxima comanda.';
/** Venda sem o id do pacote de volta (caminho antigo): a pessoa vincula pela lista. */
export const AVISO_ESCOLHER_PACOTE_VENDIDO = 'Pacote vendido. Escolha-o em "Pacote do cliente" para usar neste atendimento.';

/**
 * Aviso que a Agenda (web e app) mostra depois de vender um pacote pelo modal único. A venda grava na
 * hora: com "Cobrar na comanda" o pacote fica a cobrar mesmo que o agendamento não seja salvo (aparece
 * na próxima comanda da cliente e pode ser excluído em Pacotes). O `aviso` da venda vem na frente.
 */
export function avisoVendaPacoteAgenda(r: Pick<ResultadoVendaPacote, 'cobranca' | 'pacoteClienteId' | 'aviso'>): string {
  const partes: string[] = [];
  if (r.aviso) partes.push(r.aviso);
  if (!r.pacoteClienteId) partes.push(AVISO_ESCOLHER_PACOTE_VENDIDO);
  else if (r.cobranca === 'comanda') partes.push(AVISO_PACOTE_A_COBRAR_AGENDA);
  return partes.join(' ');
}

/** Mesma mensagem da `vender_pacote` (096) para valor diferente do preço sem `comanda.desconto`. */
export const MSG_SEM_PERMISSAO_VALOR_PACOTE = 'Você não tem permissão para mudar o valor do pacote.';

/**
 * O campo "Valor (cada)" da venda de pacote pode ser editado? Só com `comanda.desconto`: valor
 * diferente do preço do catálogo é um desconto, e o banco o recusa sem a permissão.
 */
export function valorPacoteEditavel(podeDesconto: boolean): boolean {
  return podeDesconto;
}
/** Dica do campo de valor travado (title no web, accessibilityHint no app). */
export const DICA_VALOR_PACOTE_CATALOGO = 'Preço do catálogo. Para mudar o valor, é preciso a permissão de desconto.';

/**
 * Por que a venda ainda não pode ser gravada (regra única de web e app), ou null. `valorTxt` sem
 * dígito é inválido (campo apagado nunca vira R$ 0); valor 0 digitado é aceito, como na função.
 * Sem `comanda.desconto` (`podeDesconto`), o valor tem de ser o preço do catálogo (`precoCatalogo`,
 * comparado em centavos), como confere a `vender_pacote`.
 * Em "Cobrar agora" espera a configuração dos cartões (taxa nunca inventada) e o total coberto.
 */
export function motivoBloqueioVendaPacote(d: {
  temPacote: boolean; temCliente: boolean; quantidade: number; valorTxt: string; valorUnit: number;
  erroDesconto: string | null; cobranca: 'agora' | 'comanda'; resumo: Pick<ResumoComanda, 'podeFechar' | 'motivo'>;
  configPronta: boolean; precoCatalogo: number | null; podeDesconto: boolean;
}): string | null {
  if (!d.temPacote) return 'Escolha o pacote.';
  if (!d.temCliente) return 'Para vender pacote, escolha uma cliente cadastrada.';
  if (!quantidadeValida(d.quantidade)) return 'Quantidade de pacotes inválida (de 1 a 100).';
  if (!/\d/.test(d.valorTxt) || !(d.valorUnit >= 0)) return 'Valor do pacote inválido.';
  if (!d.podeDesconto && d.precoCatalogo != null
      && Math.round(d.valorUnit * 100) !== Math.round(d.precoCatalogo * 100)) {
    return MSG_SEM_PERMISSAO_VALOR_PACOTE;
  }
  if (d.erroDesconto) return d.erroDesconto;
  if (d.cobranca === 'agora' && !d.configPronta) return MSG_AGUARDE_CARTOES;
  if (d.cobranca === 'agora' && !d.resumo.podeFechar) return d.resumo.motivo ?? 'O pagamento não cobre o total da venda.';
  return null;
}

// ── Chave da venda (uma por abertura do modal) ──────────────────────────────────────────────

/** Tentativa anterior de venda dentro do mesmo modal. `semResposta` = a rede caiu: pode ter gravado. */
export type TentativaVendaPacote = { chave: string; assinatura: string; semResposta: boolean };

/** O que a venda enviaria, sem a chave: duas tentativas com a mesma assinatura são a MESMA venda. */
export function assinaturaVendaPacote(e: Omit<EntradaVendaPacote, 'vendaId'>): string {
  const args = argumentosVendaPacote({ ...e, vendaId: '' });
  delete args.venda_id;
  return JSON.stringify(args);
}

/**
 * Chave da próxima tentativa. Sem tentativa anterior → a chave gerada na abertura do modal; mesma
 * assinatura → a mesma chave (a função não duplica); assinatura diferente depois de um erro
 * definitivo (nada foi gravado) → chave nova (o banco recusaria a mesma chave noutro modo); depois de
 * "sem resposta" com a venda alterada → `null`: a tela bloqueia até conferir (`MSG_ALTERADA_SEM_RESPOSTA`).
 */
export function chaveVendaPacote(
  tentativa: TentativaVendaPacote | null, chaveAbertura: string, assinatura: string, gerar: () => string = novoUuid,
): string | null {
  if (!tentativa) return chaveAbertura;
  if (tentativa.assinatura === assinatura) return tentativa.chave;
  return tentativa.semResposta ? null : gerar();
}

/** O mínimo do client supabase-js usado nas leituras/escritas diretas. Estrutural. */
export interface ClienteDbTabelas {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

type Resposta = { data: unknown[] | null; error: { code?: string | null; message?: string | null } | null };

/**
 * Só leitura: a venda feita com esta chave foi gravada? Com a 096 o 1º pacote vendido recebe
 * `id = venda_id`; no caminho antigo a venda (`vendas`) recebe a chave. Erro de leitura lança.
 */
export async function vendaPacoteFoiGravada(db: ClienteDbTabelas, chave: string): Promise<boolean> {
  for (const tabela of ['pacote_clientes', 'vendas']) {
    const { data, error } = await db.from(tabela).select('id').eq('id', chave).limit(1);
    if (error) throw new Error(mensagemErroBanco(error, 'conferir a venda'));
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return false;
}

// ── Caminho antigo (sem a 096) ──────────────────────────────────────────────────────────────

/** Venda "Cobrar agora" pelo caminho antigo (sem a 096). */
export type VendaPacoteSem096 = {
  vendaId: string; empresaId: string; clienteId: string;
  pacote: { id: string; validade_dias: number | null };
  quantidade: number; valorUnit: number; desconto: number;
  /** Pagamentos da tela (valores numéricos). Total zero sem pagamento → cortesia R$ 0 (montarPagamentos). */
  splits: SplitPagamento[]; config: ConfigCartoes;
};

/**
 * Venda de pacote sem a 096 ("Cobrar agora"), igual em web e app: grava a venda (`vendas`, id = a chave,
 * sem RETURNING — a policy de SELECT de vendas não vale para todo papel —, `observacao 'Pacote'`) → os
 * `pacote_clientes` (um por unidade, `valor_pago` por `ratearValorPago`, a regra do contrato) → os
 * `pagamentos` da venda. Falha nos pacotes tenta desfazer a venda; falha nos pagamentos devolve `aviso`
 * (venda e pacotes ficaram gravados). `pacoteClienteId` = o 1º pacote (a Agenda vincula). Lança `ErroPacote`.
 */
export async function venderPacoteSem096(
  db: ClienteDbTabelas, d: VendaPacoteSem096,
): Promise<{ pacoteClienteId: string | null; aviso: string | null }> {
  if (!quantidadeValida(d.quantidade)) throw new ErroPacote('Quantidade de pacotes inválida (de 1 a 100).');
  const subtotal = Math.round(d.valorUnit * 100) * d.quantidade;
  const desconto = Math.round(d.desconto * 100);
  if (desconto < 0 || desconto > subtotal) throw new ErroPacote('O desconto não pode ser maior que o subtotal.');
  const total = (subtotal - desconto) / 100;

  const rVenda: Resposta = await db.from('vendas').insert({
    id: d.vendaId, empresa_id: d.empresaId, cliente_id: d.clienteId,
    valor_total: subtotal / 100, desconto: desconto / 100, observacao: 'Pacote',
  });
  if (rVenda.error) {
    if (rVenda.error.code === '23505') throw new ErroPacote(`${MSG_VENDA_JA_GRAVADA} Confira em Vendidos.`);
    throw new ErroPacote(mensagemErroBanco(rVenda.error, 'registrar a venda do pacote'), !rVenda.error.code);
  }

  const hoje = hojeBRT();
  const validade = dataValidade(d.pacote.validade_dias, hoje);
  const rPacotes: Resposta = await db.from('pacote_clientes').insert(
    ratearValorPago(d.valorUnit, d.quantidade, d.desconto).map(valor => ({
      empresa_id: d.empresaId, pacote_id: d.pacote.id, cliente_id: d.clienteId,
      data_inicio: hoje, data_validade: validade, valor_pago: valor, status: 'ativo',
    })),
  ).select('id');
  if (rPacotes.error) {
    const msg = mensagemErroBanco(rPacotes.error, 'vender o pacote');
    const { data: apagadas, error: eDesfaz } = await db.from('vendas').delete()
      .eq('id', d.vendaId).eq('empresa_id', d.empresaId).select('id');
    if (!eDesfaz && (apagadas?.length ?? 0) > 0) throw new ErroPacote(`${msg} Nada foi registrado; tente de novo.`);
    throw new ErroPacote(`${msg} A venda ficou registrada sem o pacote; confira no Financeiro antes de vender de novo.`);
  }
  const pacoteClienteId = (rPacotes.data?.[0] as { id?: string } | undefined)?.id ?? null;

  const linhas = montarPagamentos(d.splits, { empresaId: d.empresaId, vendaId: d.vendaId, config: d.config, total });
  const rPag: Resposta = await db.from('pagamentos').insert(linhas);
  if (rPag.error) {
    return {
      pacoteClienteId,
      aviso: `Pacote vendido, mas o pagamento não foi registrado: ${mensagemErroBanco(rPag.error, 'registrar o pagamento')} Confira no Financeiro.`,
    };
  }
  return { pacoteClienteId, aviso: null };
}
