/** Acesso ao banco da Equipe (web e app). Toda consulta lança erro em vez de devolver lista vazia. */
import { buscarTodasOuLancar, carregarComissoesPendentes, carregarServicosExtras, type ClienteDb } from './kpis-financeiros-consultas';
import { receitaExtrasPorProfissional } from './kpis-financeiros';
import { pendentesPorProfissional } from './comissoes';
import { limitesMes } from './periodos';
import { mensagemErroBanco } from './erros';
import { estatisticasDoMes, type TipoContrato } from './equipe';

export type MembroEquipe = {
  id: string; user_id: string; role: 'owner' | 'gestor' | 'profissional'; percentual_comissao: number;
  tipo_contrato: TipoContrato | null; ativo: boolean; created_at: string;
  user: { id: string; nome: string; telefone: string | null; email: string | null; foto_url: string | null };
  total_mes: number; atendimentos_mes: number;
  comissao_pendente: number; comissao_pendente_anterior: number; ids_pendentes_mes: string[];
};

const COLUNAS_MEMBRO = 'id, user_id, role, percentual_comissao, tipo_contrato, ativo, created_at, user:users(id, nome, telefone, email, foto_url)';

/**
 * Equipe da empresa (dona, gestoras e profissionais; ativas primeiro) com o mês 'yyyy-MM' em Brasília:
 * faturado (sem pacote + extras), atendimentos (todos os concluídos) e comissões pendentes do mês/anteriores.
 */
export async function carregarEquipe(db: ClienteDb, empresaId: string, mesChave: string): Promise<MembroEquipe[]> {
  const mes = limitesMes(mesChave);
  let resultado;
  try {
    resultado = await Promise.all([
      db.from('empresa_membros').select(COLUNAS_MEMBRO)
        .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional'])
        .order('ativo', { ascending: false }).order('created_at').order('id'),
      buscarTodasOuLancar<{ profissional_id: string | null; valor: number | string | null; pacote_cliente_id: string | null }>((de, ate) =>
        db.from('agendamentos').select('id, profissional_id, valor, pacote_cliente_id')
          .eq('empresa_id', empresaId).eq('status', 'concluido')
          .gte('data_hora_inicio', mes.startIso).lte('data_hora_inicio', mes.endIso)
          .order('id').range(de, ate)),
      carregarServicosExtras(db, empresaId, mes),
      carregarComissoesPendentes(db, empresaId),
    ]);
  } catch (e) {
    throw new Error(mensagemErroBanco({ message: e instanceof Error ? e.message : String(e) }, 'carregar a equipe'));
  }
  const [rMembros, ags, extras, pendentes] = resultado;
  if (rMembros.error) throw new Error(mensagemErroBanco(rMembros.error, 'carregar a equipe'));
  const stats = estatisticasDoMes(ags, receitaExtrasPorProfissional(extras));
  const pend = pendentesPorProfissional(pendentes, mes);
  return ((rMembros.data ?? []) as Record<string, unknown>[]).map(m => {
    const uid = m.user_id as string;
    return {
      ...(m as unknown as MembroEquipe),
      percentual_comissao: Number(m.percentual_comissao ?? 0),
      tipo_contrato: (m.tipo_contrato === 'pj' || m.tipo_contrato === 'clt') ? m.tipo_contrato : null,
      total_mes: stats[uid]?.total ?? 0,
      atendimentos_mes: stats[uid]?.atendimentos ?? 0,
      comissao_pendente: pend[uid]?.valorDoPeriodo ?? 0,
      comissao_pendente_anterior: pend[uid]?.valorAnterior ?? 0,
      ids_pendentes_mes: pend[uid]?.idsDoPeriodo ?? [],
    };
  });
}

async function atualizarMembro(db: ClienteDb, empresaId: string, membroId: string, valores: Record<string, unknown>, acao: string) {
  const { data, error } = await db.from('empresa_membros').update(valores)
    .eq('id', membroId).eq('empresa_id', empresaId).select('id');
  if (error || !data || data.length === 0) throw new Error(mensagemErroBanco(error ?? { code: '42501' }, acao));
}

/** Desativa/reativa a pessoa (0 linhas = sem permissão). */
export function alterarAtivo(db: ClienteDb, empresaId: string, membroId: string, ativo: boolean): Promise<void> {
  return atualizarMembro(db, empresaId, membroId, { ativo }, ativo ? 'reativar esta pessoa' : 'desativar esta pessoa');
}

/** Troca o papel gestora ↔ profissional (o banco só deixa a dona; 0 linhas = sem permissão). */
export function alterarPapel(db: ClienteDb, empresaId: string, membroId: string, papel: 'gestor' | 'profissional'): Promise<void> {
  return atualizarMembro(db, empresaId, membroId, { role: papel }, 'trocar o papel desta pessoa');
}
