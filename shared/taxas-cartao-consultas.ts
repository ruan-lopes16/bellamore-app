/**
 * Consulta e gravação da configuração de cartões (migration 086): maquininhas, bandeiras e
 * taxas por parcela. Funciona antes da 086: sem as tabelas, devolve `configLegada` (somente leitura).
 * Gravações conferem as linhas afetadas (RLS recusa em silêncio) e lançam Error em português.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { mensagemErroBanco } from './erros';
import {
  chaveBandeira, configLegada, validarTabela,
  type BandeiraCartao, type ConfigCartoes, type Maquininha, type Modalidade, type TaxaLinha,
} from './taxas-cartao';

type BandeiraRow = { id: string; chave: string; nome: string; ativa: boolean; ordem: number };
type MaquininhaRow = { id: string; nome: string; max_parcelas: number; ativa: boolean; padrao: boolean; ordem: number };
type TaxaRow = { id: string; maquininha_id: string; bandeira_id: string | null; modalidade: Modalidade; parcelas: number; taxa: number | string };

/** Tabela da 086 ainda não existe (migration não aplicada). */
function tabelaAusente(msg: string): boolean {
  return msg.includes('cartao_') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

/** Recusa silenciosa (RLS): o UPDATE/DELETE não afetou a quantidade esperada de linhas. */
function recusado(acao: string): Error {
  return new Error(mensagemErroBanco({ code: '42501' }, acao));
}

/**
 * Carrega maquininhas, bandeiras e taxas da empresa numa consulta paralela.
 * Sem a migration 086 → configuração legada (baseada nas colunas da 084 de `empresas`).
 */
export async function carregarConfigCartoes(db: ClienteDb, empresaId: string): Promise<ConfigCartoes> {
  try {
    const [bandeiras, maquininhas, taxas] = await Promise.all([
      buscarTodasOuLancar<BandeiraRow>((de, ate) => db.from('cartao_bandeiras')
        .select('id, chave, nome, ativa, ordem').eq('empresa_id', empresaId)
        .order('ordem').order('nome').order('id').range(de, ate)),
      buscarTodasOuLancar<MaquininhaRow>((de, ate) => db.from('cartao_maquininhas')
        .select('id, nome, max_parcelas, ativa, padrao, ordem').eq('empresa_id', empresaId)
        .order('ordem').order('nome').order('id').range(de, ate)),
      buscarTodasOuLancar<TaxaRow>((de, ate) => db.from('cartao_taxas')
        .select('id, maquininha_id, bandeira_id, modalidade, parcelas, taxa').eq('empresa_id', empresaId)
        .order('id').range(de, ate)),
    ]);
    return {
      legado: false,
      bandeiras: bandeiras.map<BandeiraCartao>(b => ({ id: b.id, chave: b.chave, nome: b.nome, ativa: b.ativa, ordem: b.ordem })),
      maquininhas: maquininhas.map<Maquininha>(m => ({
        id: m.id, nome: m.nome, maxParcelas: m.max_parcelas, ativa: m.ativa, padrao: m.padrao, ordem: m.ordem,
        taxas: taxas.filter(t => t.maquininha_id === m.id).map<TaxaLinha>(t => ({
          id: t.id, bandeiraId: t.bandeira_id, modalidade: t.modalidade, parcelas: t.parcelas, taxa: Number(t.taxa),
        })),
      })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!tabelaAusente(msg)) throw e;
    const { data, error } = await db.from('empresas').select('*').eq('id', empresaId).single();
    if (error) throw new Error(mensagemErroBanco(error, 'carregar as taxas de cartão'));
    return configLegada(data);
  }
}

const chaveLinha = (t: Pick<TaxaLinha, 'bandeiraId' | 'modalidade' | 'parcelas'>) => `${t.bandeiraId ?? ''}|${t.modalidade}|${t.parcelas}`;

/**
 * Grava a maquininha (nova ou existente) e a diferença de taxas contra `originais`:
 * apaga as que sumiram (ou passaram do máximo), atualiza as alteradas e insere as novas,
 * nessa ordem (respeita o índice único). `padrao` não é gravado aqui — use `definirPadrao`.
 * Lança Error em português se a tabela for inválida ou o banco recusar.
 * A gravação não é transacional: após QUALQUER erro, quem chama deve recarregar a configuração
 * (`carregarConfigCartoes`) antes de tentar de novo. O delete é idempotente (linhas que já sumiram
 * não são erro), então um retry com `originais` desatualizado não vira falso "sem permissão".
 */
export async function salvarMaquininha(
  db: ClienteDb, empresaId: string, m: Omit<Maquininha, 'id'> & { id?: string }, originais: TaxaLinha[],
): Promise<{ id: string }> {
  const nome = m.nome.trim();
  if (!nome) throw new Error('Informe o nome da maquininha');
  const invalida = validarTabela(m);
  if (invalida) throw new Error(invalida);

  const campos = { nome, max_parcelas: m.maxParcelas, ativa: m.ativa, ordem: m.ordem };
  let id = m.id;
  if (id) {
    const { data, error } = await db.from('cartao_maquininhas').update(campos).eq('id', id).eq('empresa_id', empresaId).select('id');
    if (error) throw new Error(mensagemErroBanco(error, 'salvar a maquininha'));
    if (!data || data.length !== 1) throw recusado('salvar a maquininha');
  } else {
    const { data, error } = await db.from('cartao_maquininhas').insert({ ...campos, empresa_id: empresaId }).select('id').single();
    if (error || !data) throw new Error(mensagemErroBanco(error, 'salvar a maquininha'));
    id = (data as { id: string }).id;
  }

  const novas = m.taxas.filter(t => t.parcelas <= m.maxParcelas);
  const novasPorChave = new Map(novas.map(t => [chaveLinha(t), t]));
  const originaisPorChave = new Map(originais.filter(t => t.id).map(t => [chaveLinha(t), t]));

  const apagar = originais
    .filter(o => o.id && (o.parcelas > m.maxParcelas || !novasPorChave.has(chaveLinha(o))))
    .map(o => o.id as string);
  if (apagar.length) {
    const { data, error } = await db.from('cartao_taxas').delete().in('id', apagar).select('id');
    if (error) throw new Error(mensagemErroBanco(error, 'salvar as taxas'));
    void data; // idempotente: menos linhas que o esperado = já apagadas (retry após falha parcial)
  }
  for (const t of novas) {
    const o = originaisPorChave.get(chaveLinha(t));
    if (!o || o.taxa === t.taxa) continue;
    const { data, error } = await db.from('cartao_taxas').update({ taxa: t.taxa }).eq('id', o.id as string).select('id');
    if (error) throw new Error(mensagemErroBanco(error, 'salvar as taxas'));
    if (!data || data.length !== 1) throw recusado('salvar as taxas');
  }
  const inserir = novas.filter(t => !originaisPorChave.has(chaveLinha(t))).map(t => ({
    empresa_id: empresaId, maquininha_id: id, bandeira_id: t.bandeiraId, modalidade: t.modalidade, parcelas: t.parcelas, taxa: t.taxa,
  }));
  if (inserir.length) {
    const { error } = await db.from('cartao_taxas').insert(inserir);
    if (error) throw new Error(mensagemErroBanco(error, 'salvar as taxas'));
  }
  return { id: id as string };
}

/**
 * Torna a maquininha a padrão da empresa: primeiro desmarca as demais, depois marca esta
 * (a ordem evita violar o índice único de padrão ativa).
 */
export async function definirPadrao(db: ClienteDb, empresaId: string, maquininhaId: string): Promise<void> {
  const acao = 'definir a maquininha padrão';
  const alvo = await db.from('cartao_maquininhas').select('id, ativa').eq('id', maquininhaId).eq('empresa_id', empresaId);
  if (alvo.error) throw new Error(mensagemErroBanco(alvo.error, acao));
  const linhaAlvo = (alvo.data as { id: string; ativa: boolean }[] | null)?.[0];
  if (!linhaAlvo) throw new Error('Maquininha não encontrada');
  if (!linhaAlvo.ativa) throw new Error('Ative a maquininha antes de torná-la padrão');
  const r1 = await db.from('cartao_maquininhas').update({ padrao: false }).eq('empresa_id', empresaId).eq('padrao', true).select('id');
  if (r1.error) throw new Error(mensagemErroBanco(r1.error, acao));
  const anteriores = ((r1.data ?? []) as { id: string }[]).map(x => x.id);
  const r2 = await db.from('cartao_maquininhas').update({ padrao: true }).eq('id', maquininhaId).eq('empresa_id', empresaId).select('id');
  if (r2.error || !r2.data || r2.data.length !== 1) {
    // Não deixa a empresa sem padrão: tenta devolver a marca à anterior (melhor esforço).
    if (anteriores.length) {
      await db.from('cartao_maquininhas').update({ padrao: true }).in('id', anteriores).eq('empresa_id', empresaId).select('id');
    }
    throw r2.error ? new Error(mensagemErroBanco(r2.error, acao)) : recusado(acao);
  }
}

/**
 * Cria ou edita uma bandeira. Nova → chave gerada de `nome` (única entre `chavesExistentes`);
 * existente → só nome/ativa/ordem (a chave nunca muda: pagamentos antigos usam ela).
 */
export async function salvarBandeira(
  db: ClienteDb, empresaId: string, b: { id?: string; nome: string; ativa: boolean; ordem?: number }, chavesExistentes: string[],
): Promise<void> {
  const nome = b.nome.trim();
  if (!nome) throw new Error('Informe o nome da bandeira');
  if (b.id) {
    const campos: Record<string, unknown> = { nome, ativa: b.ativa };
    if (b.ordem !== undefined) campos.ordem = b.ordem;
    const { data, error } = await db.from('cartao_bandeiras').update(campos).eq('id', b.id).eq('empresa_id', empresaId).select('id');
    if (error) throw new Error(mensagemErroBanco(error, 'salvar a bandeira'));
    if (!data || data.length !== 1) throw recusado('salvar a bandeira');
    return;
  }
  const { error } = await db.from('cartao_bandeiras').insert({
    empresa_id: empresaId, nome, chave: chaveBandeira(nome, chavesExistentes), ativa: b.ativa, ordem: b.ordem ?? 0,
  });
  if (error) throw new Error(mensagemErroBanco(error, 'salvar a bandeira'));
}
