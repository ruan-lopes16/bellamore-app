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
 * Idempotência: a tela gera `comandaId` (e o `item_id` de cada extra novo na edição) UMA vez e
 * reaproveita na nova tentativa depois de "sem resposta" — se a 1ª chegou a gravar, o banco
 * devolve o id sem duplicar.
 */
import { agruparValoresPorAgendamento } from './comanda';
import { montarPagamentos, type SplitPagamento } from './comanda-fechamento';
import { mensagemErroBanco } from './erros';
import type { ConfigCartoes } from './taxas-cartao';

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
  /** Gerado na tela uma vez por tentativa de fechar (novoUuid) e reaproveitado na nova tentativa. */
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

/** Erros do Postgres que chegam em inglês: tradução fixa (a mensagem original não vai para a tela). */
const MENSAGENS_CODIGO: Record<string, string> = {
  '22P02': 'Dado inválido enviado ao banco.',
  '23505': 'Registro duplicado.',
  '57014': 'O banco demorou demais para responder. Confira antes de repetir.',
};

/**
 * Converte o erro da função: as mensagens de regra (P0001) e de permissão (42501) da 090 já vêm em
 * português, prontas para a tela; uma recusa de RLS em inglês vira o aviso padrão de permissão.
 */
function erroDaFuncao(e: NonNullable<ErroRpc>, acao: string, semRespostaMsg: string): ErroGravacaoComanda {
  if (!e.code) return new ErroGravacaoComanda(semRespostaMsg, null, true);
  const traduzida = MENSAGENS_CODIGO[e.code];
  if (traduzida) return new ErroGravacaoComanda(traduzida, e.code, false);
  const msg = e.message ?? '';
  const texto = /row-level security/i.test(msg) || !msg ? mensagemErroBanco(e, acao) : msg;
  return new ErroGravacaoComanda(texto, e.code, false);
}

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
