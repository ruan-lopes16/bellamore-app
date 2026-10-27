/**
 * Regras da tela de Pacotes do web (Paridade Serviços e Pacotes, Task 5) que não moram em shared:
 * a chave da venda por tentativa, o caminho antigo sem a migration 096 e as escritas conferidas
 * (sincronização de serviços, combo utilizado). As gravações com a 096 vão por shared/pacotes-venda.ts.
 * Contrato: docs/superpowers/notes/2026-10-23-contrato-pacotes.md.
 */
import { argumentosVendaPacote, ErroPacote, type EntradaVendaPacote } from '@shared/pacotes-venda';
import { montarPagamentos, type SplitPagamento } from '@shared/comanda-fechamento';
import { dataValidade, type StatusPacoteCliente } from '@shared/pacotes';
import type { ConfigCartoes } from '@shared/taxas-cartao';
import { mensagemErroBanco } from '@shared/erros';
import { hojeBRT } from '@shared/periodos';
import { novoUuid } from '@shared/uuid';

/** O mínimo do client supabase-js usado aqui. Estrutural. */
export interface ClienteDbPacotes {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

type Resposta = { data: unknown[] | null; error: { code?: string | null; message?: string | null } | null };

// ── Chave da venda (uma por abertura do modal) ────────────────────────────────────────────────

/** Tentativa anterior de venda dentro do mesmo modal. `semResposta` = a rede caiu: pode ter gravado. */
export type TentativaVendaPacote = { chave: string; assinatura: string; semResposta: boolean };

/** O que a venda enviaria, sem a chave: duas tentativas com a mesma assinatura são a MESMA venda. */
export function assinaturaVendaPacote(e: Omit<EntradaVendaPacote, 'vendaId'>): string {
  const { venda_id: _v, ...resto } = argumentosVendaPacote({ ...e, vendaId: '' });
  return JSON.stringify(resto);
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

export const MSG_ALTERADA_SEM_RESPOSTA =
  'Sem resposta do servidor na tentativa anterior: ela pode ter sido gravada. Toque em Conferir antes de mudar a venda.';
export const MSG_VENDA_JA_GRAVADA = 'Essa venda já tinha sido registrada.';

/**
 * Só leitura: a venda feita com esta chave foi gravada? Com a 096 o 1º pacote vendido recebe
 * `id = venda_id`; no caminho antigo a venda (`vendas`) recebe a chave. Erro de leitura lança.
 */
export async function vendaPacoteFoiGravada(db: ClienteDbPacotes, chave: string): Promise<boolean> {
  for (const tabela of ['pacote_clientes', 'vendas']) {
    const { data, error } = await db.from(tabela).select('id').eq('id', chave).limit(1);
    if (error) throw new Error(mensagemErroBanco(error, 'conferir a venda'));
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return false;
}

// ── Valores ───────────────────────────────────────────────────────────────────────────────────

const emCentavos = (v: number) => Math.round(v * 100);

/**
 * `valor_pago` de cada unidade (mesma regra da `vender_pacote`): o líquido (valorUnit × quantidade −
 * desconto) dividido em centavos; o resto, 1 centavo cada, vai nas primeiras unidades.
 */
export function ratearValorPago(valorUnit: number, quantidade: number, desconto: number): number[] {
  const n = Math.max(1, Math.floor(quantidade));
  const liquido = Math.max(0, emCentavos(valorUnit) * n - emCentavos(desconto));
  const base = Math.floor(liquido / n);
  const resto = liquido - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

/** Quantidade de unidades aceita pela venda: inteiro de 1 a 100 (contrato). */
export function quantidadeValida(q: number): boolean {
  return Number.isInteger(q) && q >= 1 && q <= 100;
}

// ── Detecção da 096 ───────────────────────────────────────────────────────────────────────────

/**
 * A 096 está no banco? Sonda a coluna `pacote_clientes.cobranca` (só leitura, 0 linhas). `false` =
 * coluna inexistente (sem a 096: "Cobrar na comanda" fica escondido); `null` = não deu para saber
 * (erro de rede/permissão): a tela mostra as duas opções e a venda decide por `SemMigration096`.
 */
export async function detectarMigration096(db: ClienteDbPacotes): Promise<boolean | null> {
  try {
    const { error } = await db.from('pacote_clientes').select('id, cobranca').limit(0);
    if (!error) return true;
    return /cobranca/.test(error.message ?? '') ? false : null;
  } catch {
    return null;
  }
}

// ── Caminho antigo (sem a 096) ────────────────────────────────────────────────────────────────

/** Venda "Cobrar agora" pelo caminho antigo (sem a 096). */
export type VendaPacoteSem096 = {
  vendaId: string; empresaId: string; clienteId: string;
  pacote: { id: string; validade_dias: number | null };
  quantidade: number; valorUnit: number; desconto: number;
  /** Pagamentos da tela (valores numéricos). Total zero sem pagamento → cortesia R$ 0 (montarPagamentos). */
  splits: SplitPagamento[]; config: ConfigCartoes;
};

/**
 * Venda de pacote sem a 096 ("Cobrar agora"): a tela antiga só gravava `pacote_clientes`, e a receita
 * sumia do faturamento. Agora grava também a venda: `vendas` (id = a chave, sem RETURNING, `observacao
 * 'Pacote'`) → os `pacote_clientes` (um por unidade, `valor_pago` rateado) → os `pagamentos` da venda.
 * Falha nos pacotes tenta desfazer a venda; falha nos pagamentos devolve `aviso` (venda e pacotes
 * ficaram gravados — conferir no Financeiro). Lança `ErroPacote`.
 */
export async function venderPacoteSem096(db: ClienteDbPacotes, d: VendaPacoteSem096): Promise<{ aviso: string | null }> {
  if (!quantidadeValida(d.quantidade)) throw new ErroPacote('Quantidade de pacotes inválida (de 1 a 100).');
  const subtotal = emCentavos(d.valorUnit) * d.quantidade;
  const desconto = emCentavos(d.desconto);
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
  );
  if (rPacotes.error) {
    const msg = mensagemErroBanco(rPacotes.error, 'vender o pacote');
    const { data: apagadas, error: eDesfaz } = await db.from('vendas').delete()
      .eq('id', d.vendaId).eq('empresa_id', d.empresaId).select('id');
    if (!eDesfaz && (apagadas?.length ?? 0) > 0) throw new ErroPacote(`${msg} Nada foi registrado; tente de novo.`);
    throw new ErroPacote(`${msg} A venda ficou registrada sem o pacote; confira no Financeiro antes de vender de novo.`);
  }

  const linhas = montarPagamentos(d.splits, { empresaId: d.empresaId, vendaId: d.vendaId, config: d.config, total });
  const rPag: Resposta = await db.from('pagamentos').insert(linhas);
  if (rPag.error) {
    return { aviso: `Pacote vendido, mas o pagamento não foi registrado: ${mensagemErroBanco(rPag.error, 'registrar o pagamento')} Confira no Financeiro.` };
  }
  return { aviso: null };
}

/**
 * Exclui um pacote vendido sem a 096 (a tela antiga): desvincula os atendimentos e apaga a linha, as
 * duas conferidas. Desvincular 0 atendimentos é legítimo; apagar 0 linhas é recusa da RLS. Lança `ErroPacote`.
 */
export async function excluirVendidoSem096(db: ClienteDbPacotes, empresaId: string, id: string): Promise<void> {
  const rDesv: Resposta = await db.from('agendamentos').update({ pacote_cliente_id: null })
    .eq('pacote_cliente_id', id).eq('empresa_id', empresaId).select('id');
  if (rDesv.error) throw new ErroPacote(mensagemErroBanco(rDesv.error, 'desvincular os atendimentos do pacote'));
  const rDel: Resposta = await db.from('pacote_clientes').delete().eq('id', id).eq('empresa_id', empresaId).select('id');
  if (rDel.error) throw new ErroPacote(mensagemErroBanco(rDel.error, 'excluir o pacote vendido'));
  if (!rDel.data || rDel.data.length === 0) throw new ErroPacote(mensagemErroBanco({ code: '42501' }, 'excluir o pacote vendido'));
}

// ── Escritas conferidas ───────────────────────────────────────────────────────────────────────

/** Marca um combo vendido como utilizado, conferindo as linhas. `null` = gravou; senão a mensagem. */
export async function marcarComboUtilizado(db: ClienteDbPacotes, empresaId: string, id: string): Promise<string | null> {
  const r: Resposta = await db.from('pacote_clientes').update({ status: 'concluido' })
    .eq('id', id).eq('empresa_id', empresaId).select('id');
  if (r.error) return mensagemErroBanco(r.error, 'marcar o combo como utilizado');
  if (!r.data || r.data.length === 0) return mensagemErroBanco({ code: '42501' }, 'marcar o combo como utilizado');
  return null;
}

/** Serviço na composição do pacote. `quantidade` null = sessões ilimitadas. */
export type ItemComposicao = { servico_id: string; quantidade: number | null };

/**
 * Sincroniza `pacote_servicos` por diferença: apaga só os que saíram e faz upsert do resto, as duas
 * conferidas (a RLS recusa devolvendo 0 linhas). `null` = gravou; senão a mensagem para a tela.
 */
export async function sincronizarServicosPacote(
  db: ClienteDbPacotes, pacoteId: string, idsAntigos: string[], itens: ItemComposicao[],
): Promise<string | null> {
  const novos = new Set(itens.map(i => i.servico_id));
  const aRemover = idsAntigos.filter(id => !novos.has(id));
  if (aRemover.length > 0) {
    const r: Resposta = await db.from('pacote_servicos').delete()
      .eq('pacote_id', pacoteId).in('servico_id', aRemover).select('servico_id');
    if (r.error) return mensagemErroBanco(r.error, 'remover serviços do pacote');
    if (!r.data || r.data.length < aRemover.length) return mensagemErroBanco({ code: '42501' }, 'remover serviços do pacote');
  }
  if (itens.length > 0) {
    const r: Resposta = await db.from('pacote_servicos').upsert(
      itens.map(i => ({ pacote_id: pacoteId, servico_id: i.servico_id, quantidade: i.quantidade })),
      { onConflict: 'pacote_id,servico_id' },
    ).select('servico_id');
    if (r.error) return mensagemErroBanco(r.error, 'salvar os serviços do pacote');
    if (!r.data || r.data.length < itens.length) return mensagemErroBanco({ code: '42501' }, 'salvar os serviços do pacote');
  }
  return null;
}

// ── Vendidos ──────────────────────────────────────────────────────────────────────────────────

export type FiltroVendidos = 'todos' | 'ativo' | 'concluido' | 'expirado' | 'a_cobrar';

/**
 * Filtro da aba Vendidos. "A cobrar" = cobrança pendente (qualquer status, fora cancelado); os demais
 * pelo status exibido. Cancelado só aparece em Todos (contrato).
 */
export function filtrarVendidos<T extends { statusExibido: StatusPacoteCliente; cobranca: 'paga' | 'pendente' }>(
  lista: T[], filtro: FiltroVendidos,
): T[] {
  if (filtro === 'todos') return lista;
  if (filtro === 'a_cobrar') return lista.filter(v => v.cobranca === 'pendente' && v.statusExibido !== 'cancelado');
  return lista.filter(v => v.statusExibido === filtro);
}

/** Validade digitada no cadastro: `semValidade` → null; senão inteiro ≥ 1, ou erro. */
export function lerValidadeDias(texto: string, semValidade: boolean): { valor: number | null; erro: string | null } {
  if (semValidade) return { valor: null, erro: null };
  const n = Number(texto.trim());
  if (!texto.trim() || !Number.isInteger(n) || n < 1) return { valor: null, erro: 'Informe a validade em dias (1 ou mais) ou marque "Sem validade".' };
  return { valor: n, erro: null };
}
