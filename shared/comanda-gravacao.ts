/**
 * @file comanda-gravacao.ts
 * Fechar e editar a comanda "tudo ou nada" pelas funções da migration 090 (`fechar_comanda` e
 * `editar_comanda`), web e app. Contrato campo a campo:
 * docs/superpowers/notes/2026-10-15-contrato-fechar-comanda.md.
 *
 * - `montarPayloadFechamento` / `montarPayloadEdicao` traduzem o estado da tela (itens, vínculos de
 *   pacote, desconto em R$, splits de pagamento) para o JSON da função. Nada que o banco calcula
 *   vai no payload (subtotal, total, desconto da reserva, rateio, valor líquido, datas).
 * - `fecharComandaNoBanco` / `editarComandaNoBanco` chamam a função. Sem a 090 (`PGRST202`, e SÓ
 *   esse código) devolvem `{ via: 'antigo' }` e a tela segue pelo caminho atual em passos (ordem de
 *   deploy livre). Qualquer outro erro vira `ErroGravacaoComanda` com mensagem em português.
 *
 * Idempotência: o `comandaId` só é reaproveitado na nova tentativa depois de "sem resposta" e com o
 * MESMO conteúdo (`assinaturaGravacao`/`chaveDaTentativa`) — se a 1ª chegou a gravar, o banco
 * devolve o id sem duplicar; com conteúdo alterado a tela bloqueia e manda conferir
 * (`tentativaFoiGravada`). O `item_id` de cada extra novo na edição é gerado UMA vez na tela.
 */
import { agruparValoresPorAgendamento } from './comanda';
import { montarPagamentos, type SplitPagamento } from './comanda-fechamento';
import { mensagemErroBanco } from './erros';
import type { ConfigCartoes } from './taxas-cartao';
import { novoUuid } from './uuid';

/** O mínimo do client supabase-js usado aqui (`rpc`). Estrutural, como `ClienteDb`. */
export interface ClienteDbRpc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

/**
 * Item da comanda como as duas telas o têm (`ComandaItem` do web e do app, sem os campos de UI).
 * `agendamento`: uma linha por atendimento, ou uma por `agendamento_servicos` (multi-serviço, com
 * `ag_servico_id`). Extras (`servico`/`produto`/`pacote`): `valor` é o unitário. `item_id` = linha de
 * `comanda_itens` (obrigatório na edição: já gravado, ou gerado na tela para o extra novo).
 */
export type ItemComandaTela = {
  tipo: 'agendamento' | 'servico' | 'produto' | 'pacote';
  descricao: string;
  valor: number;
  quantidade: number;
  agendamento_id?: string;
  ag_servico_id?: string;
  servico_id?: string;
  produto_id?: string;
  pacote_id?: string;
  profissional_id?: string | null;
  item_id?: string;
};

/** Estado da tela no momento de fechar uma comanda nova. */
export type EstadoFechamentoComanda = {
  /** Chave da tentativa (`chaveDaTentativa`): nova, ou a da tentativa sem resposta com o mesmo conteúdo. */
  comandaId: string;
  empresaId: string;
  /** `clientes.id`; `'__sem__'`, `''` ou null = cliente avulso. */
  clienteId: string | null;
  /** Desconto MANUAL em R$ (calcularDesconto já converteu o %). Sem a taxa de reserva. */
  desconto: number;
  itens: ItemComandaTela[];
  /**
   * Vínculos de pacote por atendimento (`pacoteLinks` das telas). Chave ausente = não mexe no
   * vínculo gravado; string = vincula; null = desvincula (mesma regra de agruparValoresPorAgendamento).
   */
  pacoteLinks: Record<string, string | null>;
  /** Splits com valor numérico (parseValorBR). */
  splits: SplitPagamento[];
  config: ConfigCartoes;
};

/** Estado da tela ao salvar a edição de uma comanda fechada (estado completo, não diferença). */
export type EstadoEdicaoComanda = {
  comandaId: string;
  empresaId: string;
  /** Desconto manual em R$ (reaberto como `comandas.desconto − desconto_reserva`). */
  desconto: number;
  /** Todos os atendimentos da comanda e todos os extras (cada extra com `item_id`). */
  itens: ItemComandaTela[];
  /** Splits; o reaberto traz `pagamentoId` e os campos `...Gravado/Gravada`. */
  splits: SplitPagamento[];
  config: ConfigCartoes;
};

export type PayloadLinha = { ag_servico_id: string; valor: number };
export type PayloadAtendimento = {
  agendamento_id: string; valor?: number; linhas?: PayloadLinha[]; pacote_cliente_id?: string | null;
};
export type PayloadItem = {
  item_id?: string; tipo: 'servico' | 'produto' | 'pacote'; descricao: string; quantidade: number; valor_unit: number;
  servico_id: string | null; profissional_id: string | null; produto_id: string | null; pacote_id: string | null;
};
export type PayloadPagamento = {
  pagamento_id?: string | null; valor: number; metodo: string; parcelas: number;
  bandeira: string | null; maquininha_id: string | null; taxa_perc: number | null;
};
export type PayloadFechamento = {
  comanda_id: string; empresa_id: string; cliente_id: string | null; desconto: number;
  atendimentos: PayloadAtendimento[]; itens: PayloadItem[]; pagamentos: PayloadPagamento[];
};
export type PayloadEdicao = {
  comanda_id: string; empresa_id: string; desconto: number;
  atendimentos: PayloadAtendimento[]; itens: PayloadItem[]; pagamentos: PayloadPagamento[];
};

const centavos = (v: number) => Math.round(v * 100) / 100;
const uuidOuNull = (v: string | null | undefined) => (v ? v : null);

/** Atendimentos: com linhas (multi-serviço) só as linhas; sem linhas o valor cobrado. */
function montarAtendimentos(itens: ItemComandaTela[], pacoteLinks: Record<string, string | null> | null): PayloadAtendimento[] {
  return agruparValoresPorAgendamento(itens, pacoteLinks ?? {}).map(g => {
    const a: PayloadAtendimento = { agendamento_id: g.agendamentoId };
    if (g.linhasServico.length > 0) {
      a.linhas = g.linhasServico.map(l => ({ ag_servico_id: l.agServicoId, valor: centavos(l.valor) }));
    } else {
      a.valor = centavos(g.novoValorTotal);
    }
    // Presença da chave importa (ausente = não mexe; null = desvincula). Na edição o vínculo é ignorado.
    if (pacoteLinks && 'pacoteClienteId' in g) a.pacote_cliente_id = g.pacoteClienteId ?? null;
    return a;
  });
}

function montarItem(i: ItemComandaTela): PayloadItem {
  const tipo = i.tipo as PayloadItem['tipo'];
  return {
    tipo,
    descricao: i.descricao,
    // Pacote é vendido por unidade: arredonda como o caminho antigo (Math.max(1, Math.round(q))).
    quantidade: tipo === 'pacote' ? Math.max(1, Math.round(i.quantidade)) : i.quantidade,
    valor_unit: centavos(i.valor),
    servico_id: tipo === 'servico' ? uuidOuNull(i.servico_id) : null,
    profissional_id: tipo === 'servico' ? uuidOuNull(i.profissional_id) : null,
    produto_id: tipo === 'produto' ? uuidOuNull(i.produto_id) : null,
    pacote_id: tipo === 'pacote' ? uuidOuNull(i.pacote_id) : null,
  };
}

/**
 * Pagamentos com valor (> 0): método, parcelas, bandeira e maquininha do cartão, taxa da
 * configuração (taxaDoSplit via montarPagamentos; reaberto inalterado mantém a gravada). Sem
 * nenhum, a lista vai vazia e o banco grava a Cortesia R$ 0 quando o total for zero.
 */
function montarPagamentosPayload(splits: SplitPagamento[], config: ConfigCartoes, comId: boolean): PayloadPagamento[] {
  const validos = splits.filter(s => centavos(s.valor) > 0);
  if (validos.length === 0) return [];
  // Uma linha por split válido, na mesma ordem (o `total` só decide a cortesia automática, que
  // não acontece com split válido — essa o banco cria sozinho).
  const linhas = montarPagamentos(validos, { empresaId: '', config, total: 0 });
  return linhas.map((l, idx) => {
    const p: PayloadPagamento = {
      valor: l.valor, metodo: l.metodo, parcelas: l.parcelas, bandeira: l.bandeira,
      maquininha_id: l.maquininha_id ?? null, taxa_perc: l.taxa_perc,
    };
    return comId ? { pagamento_id: validos[idx].pagamentoId ?? null, ...p } : p;
  });
}

/** Payload de `fechar_comanda(p)` a partir do estado da tela. */
export function montarPayloadFechamento(e: EstadoFechamentoComanda): PayloadFechamento {
  return {
    comanda_id: e.comandaId,
    empresa_id: e.empresaId,
    cliente_id: e.clienteId && e.clienteId !== '__sem__' ? e.clienteId : null,
    desconto: centavos(e.desconto),
    atendimentos: montarAtendimentos(e.itens, e.pacoteLinks),
    itens: e.itens.filter(i => i.tipo !== 'agendamento').map(montarItem),
    pagamentos: montarPagamentosPayload(e.splits, e.config, false),
  };
}

/**
 * Payload de `editar_comanda(p)`: o estado COMPLETO depois da edição (o banco compara com o gravado).
 * Vínculo de pacote e cliente não vão (a função ignora). Todo extra precisa de `item_id`: o já
 * gravado, ou um gerado na tela para o novo (reaproveitado na nova tentativa) — sem ele, lança.
 */
export function montarPayloadEdicao(e: EstadoEdicaoComanda): PayloadEdicao {
  const itens = e.itens.filter(i => i.tipo !== 'agendamento').map(i => {
    if (!i.item_id) throw new Error(`Item da comanda sem identificador: ${i.descricao}.`);
    return { item_id: i.item_id, ...montarItem(i) };
  });
  return {
    comanda_id: e.comandaId,
    empresa_id: e.empresaId,
    desconto: centavos(e.desconto),
    atendimentos: montarAtendimentos(e.itens, null),
    itens,
    pagamentos: montarPagamentosPayload(e.splits, e.config, true),
  };
}

/** Erro de `fechar_comanda`/`editar_comanda`. `semResposta` = a rede caiu: pode ter gravado. */
export class ErroGravacaoComanda extends Error {
  constructor(mensagem: string, readonly code: string | null, readonly semResposta: boolean) {
    super(mensagem);
    this.name = 'ErroGravacaoComanda';
  }
}

export type ResultadoGravacaoComanda = { via: 'funcao' } | { via: 'antigo' };

type ErroRpc = { code?: string | null; message?: string | null } | null | undefined;

/**
 * Converte o erro da função: as mensagens de regra (P0001) e de permissão (42501) da 090 já vêm em
 * português, prontas para a tela; uma recusa de RLS em inglês vira o aviso padrão de permissão.
 * Qualquer outro código passa por `mensagemErroBanco`: tradução fixa (PGRST301 = sessão expirada,
 * 22P02, 23505, 57014...) ou mensagem genérica em português (o texto técnico fica no console).
 */
function erroDaFuncao(e: NonNullable<ErroRpc>, acao: string, semRespostaMsg: string): ErroGravacaoComanda {
  if (!e.code) return new ErroGravacaoComanda(semRespostaMsg, null, true);
  const msg = e.message ?? '';
  const daFuncao = (e.code === 'P0001' || e.code === '42501') && !!msg && !/row-level security/i.test(msg);
  return new ErroGravacaoComanda(daFuncao ? msg : mensagemErroBanco(e, acao), e.code, false);
}

/** Recusa da função porque outra aba/aparelho já fechou a comanda do atendimento. */
export function ehComandaJaFechada(e: unknown): boolean {
  return e instanceof ErroGravacaoComanda && e.message.includes('já teve a comanda fechada');
}

/** Mesmo texto no web e no app quando o atendimento já tem comanda (função ou caminho antigo). */
export const AVISO_COMANDA_JA_FECHADA = 'Este atendimento já teve a comanda fechada. Recarregue o dia para ver a comanda existente.';

/**
 * Mensagem de erro de `fechar_comanda`/`editar_comanda` para a tela (web e app, mesmo texto). As
 * mensagens da função já vêm em português; "já teve a comanda fechada" ganha a orientação de recarregar.
 */
export function mensagemFalhaGravacao(e: unknown, acao: string): string {
  if (ehComandaJaFechada(e)) return AVISO_COMANDA_JA_FECHADA;
  return e instanceof Error && e.message ? e.message : `Não foi possível ${acao}.`;
}

// ── Nova tentativa depois de "sem resposta" (comanda e venda, web e app) ───────────────────────
//
// A chave (`comanda_id` de fechar_comanda, `p_venda_id` da registrar_venda_avulsa_v2) só é
// reaproveitada quando a tentativa anterior ficou SEM RESPOSTA (pode ter gravado) e o conteúdo é o
// MESMO: aí o banco devolve a gravação antiga sem duplicar, e ela é igual ao que a tela mostra. Com
// conteúdo diferente, a mesma chave devolveria a gravação antiga como sucesso — a tela mostraria e
// recibaria o estado novo sem ele ter sido gravado. Então bloqueia e manda conferir (Recarregar).
// Sem pendente, cada tentativa usa chave nova (erro definitivo = nada gravado).

/** Tentativa que ficou sem resposta: a chave usada, o que foi enviado e de qual cartão/carrinho. */
export type TentativaSemResposta = { chave: string; assinatura: string; cartao: string };

/** Ordena as chaves dos objetos (recursivo) e descarta `undefined`: mesmo conteúdo = mesmo texto. */
function formaEstavel(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(formaEstavel);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => [k, formaEstavel(o[k])]));
  }
  return v;
}

/** O que foi enviado, sem a chave, em forma estável: a nova tentativa só reaproveita a chave com o MESMO conteúdo. */
export function assinaturaGravacao(payload: object): string {
  const { comanda_id: _c, p_venda_id: _v, ...resto } = payload as Record<string, unknown>;
  return JSON.stringify(formaEstavel(resto));
}

/**
 * Chave da próxima tentativa: sem pendente (ou pendente de outro cartão) → chave nova; pendente do
 * mesmo cartão com a mesma assinatura → a chave dele; assinatura diferente → `null` (bloquear e
 * mostrar `AVISO_REPETIR_ALTERADO` com o botão Recarregar, sem chamar o banco).
 */
export function chaveDaTentativa(pendente: TentativaSemResposta | null, cartao: string, assinatura: string): string | null {
  if (!pendente || pendente.cartao !== cartao) return novoUuid();
  return pendente.assinatura === assinatura ? pendente.chave : null;
}

/** O mínimo do client supabase-js para a conferência (só leitura). Estrutural. */
export interface ClienteDbLeitura {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

/**
 * Só leitura: a comanda/venda gravada com esta chave existe? Quem fechou enxerga a comanda
 * (`profissional_id = auth.uid()`, 089) e quem vendeu enxerga a venda (086). Erro de leitura lança
 * (a tela mantém a pendência e mostra a mensagem).
 */
export async function tentativaFoiGravada(db: ClienteDbLeitura, tabela: 'comandas' | 'vendas', chave: string): Promise<boolean> {
  const { data, error } = await db.from(tabela).select('id').eq('id', chave).limit(1);
  if (error) throw new Error(mensagemErroBanco(error, tabela === 'comandas' ? 'conferir a comanda' : 'conferir a venda'));
  return Array.isArray(data) && data.length > 0;
}

export const AVISO_REPETIR_ALTERADO =
  'Sem resposta do servidor na tentativa anterior: ela pode ter sido gravada como estava. ' +
  'Confira antes de repetir — toque em Recarregar.';
export const AVISO_COMANDA_JA_GRAVADA = 'Essa comanda já tinha sido fechada.';
export const AVISO_VENDA_JA_GRAVADA = 'Essa venda já tinha sido registrada.';

const SEM_RESPOSTA_FECHAR = 'Sem resposta do servidor: a comanda pode ter sido fechada. Confira antes de repetir.';
const SEM_RESPOSTA_EDITAR = 'Sem resposta do servidor: a alteração da comanda pode ter sido salva. Confira antes de repetir.';

/**
 * Fecha a comanda numa transação (`fechar_comanda`, 090). `{ via: 'antigo' }` = a função não existe
 * (PGRST202): a tela grava pelo caminho atual. Lança `ErroGravacaoComanda` em qualquer outro erro.
 */
export async function fecharComandaNoBanco(db: ClienteDbRpc, payload: PayloadFechamento): Promise<ResultadoGravacaoComanda> {
  const { data, error } = await db.rpc('fechar_comanda', { p: payload });
  if (error?.code === 'PGRST202') return { via: 'antigo' };
  if (error) throw erroDaFuncao(error, 'fechar a comanda', SEM_RESPOSTA_FECHAR);
  if (typeof data !== 'string' || !data) throw new ErroGravacaoComanda('Não foi possível fechar a comanda.', null, false);
  return { via: 'funcao' };
}

/** Salva a edição de comanda fechada numa transação (`editar_comanda`, 090). Mesmo tratamento. */
export async function editarComandaNoBanco(db: ClienteDbRpc, payload: PayloadEdicao): Promise<ResultadoGravacaoComanda> {
  const { error } = await db.rpc('editar_comanda', { p: payload });
  if (error?.code === 'PGRST202') return { via: 'antigo' };
  if (error) throw erroDaFuncao(error, 'editar a comanda', SEM_RESPOSTA_EDITAR);
  return { via: 'funcao' };
}
