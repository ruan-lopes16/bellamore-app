import type { TipoContrato } from '@shared/equipe';

/**
 * Convite pendente para conta que JÁ EXISTE (migration 092). Usado pelas rotas POST de
 * `/api/profissionais` e `/api/convites` com o client de service role. Conta existente nunca é
 * vinculada sem aceite: este módulo só grava em `convites_equipe` — nunca em `empresa_membros`.
 * Contrato: docs/superpowers/notes/2026-10-16-contrato-convites.md.
 */

export const ERRO_SEM_MIGRATION_092 = 'Atualização do banco pendente: peça para rodar a migration 092.';
export const ERRO_CONVITE_GESTORA = 'Só a dona pode alterar o convite de uma gestora.';
export const ERRO_CONVITE_CONCORRENTE = 'O convite desta pessoa mudou enquanto você salvava. Recarregue a Equipe e tente de novo.';

type ErroDb = { code?: string | null; message?: string | null } | null | undefined;

/**
 * A 092 não foi rodada: tabela ou função inexistente. Só pelo código do erro (PostgREST
 * `PGRST205`/`PGRST202`, Postgres `42P01`) — nunca por texto da mensagem, nem `42883`.
 */
export function faltaMigration092(e: ErroDb): boolean {
  return !!e && (e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42P01');
}

/** Colunas devolvidas à tela (mesmo formato de `ConvitePendente` em shared/convites-consultas.ts). */
export const COLUNAS_CONVITE = 'id, user_id, email, nome, role, percentual_comissao, tipo_contrato, convidado_por, criado_em';

export type ConviteGravado = {
  id: string;
  user_id: string;
  email: string;
  nome: string | null;
  role: 'gestor' | 'profissional';
  percentual_comissao: number;
  tipo_contrato: TipoContrato | null;
  convidado_por: string | null;
  criado_em: string;
};

/** O mínimo do client supabase-js (service role) usado aqui. */
export interface ClienteDbConvitePendente {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

export type ResultadoConvitePendente =
  | { ok: true; convite: ConviteGravado }
  | { ok: false; status: number; error: string };

/**
 * Grava (ou atualiza) o convite pendente de uma conta existente. Os valores já são os FINAIS:
 * papel do vínculo inativo quando existe, comissão/contrato de `vinculoParaGravar(vinculoInativo, corpo)`.
 *
 * - Já existe pendente para (empresa, conta) → atualiza essa linha (o índice único parcial daria 23505);
 *   a atualização não gera histórico (só INSERT e mudança de status geram, pelos triggers da 092).
 *   Pendente de gestora só a dona altera (alterar = substituir o convite que a dona fez).
 * - Senão → insere (o trigger grava `convite_enviado` com `feito_por = convidado_por`).
 * - Sem a 092 → 503 com a mensagem de migration pendente.
 */
export async function gravarConvitePendente(db: ClienteDbConvitePendente, dados: {
  empresaId: string;
  userId: string;
  email: string;
  nome: string;
  role: 'gestor' | 'profissional';
  percentual_comissao: number;
  tipo_contrato: TipoContrato | null;
  convidadoPor: string;
  quemConvidaEhDona: boolean;
}): Promise<ResultadoConvitePendente> {
  const erroInterno = { ok: false as const, status: 500, error: 'Não foi possível gravar o convite. Tente de novo.' };

  const { data: pendente, error: errPendente } = await db
    .from('convites_equipe')
    .select('id, role')
    .eq('empresa_id', dados.empresaId)
    .eq('user_id', dados.userId)
    .eq('status', 'pendente')
    .maybeSingle();
  if (errPendente) {
    if (faltaMigration092(errPendente)) return { ok: false, status: 503, error: ERRO_SEM_MIGRATION_092 };
    return erroInterno;
  }

  const valores = {
    email:               dados.email,
    nome:                dados.nome,
    role:                dados.role,
    percentual_comissao: dados.percentual_comissao,
    tipo_contrato:       dados.tipo_contrato,
    convidado_por:       dados.convidadoPor,
  };

  if (pendente) {
    if ((pendente as { role: string }).role === 'gestor' && !dados.quemConvidaEhDona) {
      return { ok: false, status: 403, error: ERRO_CONVITE_GESTORA };
    }
    const { data, error } = await db
      .from('convites_equipe')
      .update(valores)
      .eq('id', (pendente as { id: string }).id)
      .eq('status', 'pendente')
      .select(COLUNAS_CONVITE)
      .maybeSingle();
    if (error) {
      if (faltaMigration092(error)) return { ok: false, status: 503, error: ERRO_SEM_MIGRATION_092 };
      return erroInterno;
    }
    // Aceito/recusado/cancelado entre a leitura e a gravação.
    if (!data) return { ok: false, status: 409, error: ERRO_CONVITE_CONCORRENTE };
    return { ok: true, convite: normalizar(data) };
  }

  const { data, error } = await db
    .from('convites_equipe')
    .insert({ empresa_id: dados.empresaId, user_id: dados.userId, status: 'pendente', ...valores })
    .select(COLUNAS_CONVITE)
    .single();
  if (error) {
    if (faltaMigration092(error)) return { ok: false, status: 503, error: ERRO_SEM_MIGRATION_092 };
    // Outro pedido gravou o pendente ao mesmo tempo (índice único parcial).
    if (error.code === '23505') return { ok: false, status: 409, error: ERRO_CONVITE_CONCORRENTE };
    return erroInterno;
  }
  return { ok: true, convite: normalizar(data) };
}

function normalizar(c: Record<string, unknown>): ConviteGravado {
  return {
    id: String(c.id),
    user_id: String(c.user_id),
    email: String(c.email ?? ''),
    nome: typeof c.nome === 'string' ? c.nome : null,
    role: c.role === 'gestor' ? 'gestor' : 'profissional',
    percentual_comissao: Number(c.percentual_comissao ?? 0),
    tipo_contrato: c.tipo_contrato === 'pj' || c.tipo_contrato === 'clt' ? c.tipo_contrato : null,
    convidado_por: typeof c.convidado_por === 'string' ? c.convidado_por : null,
    criado_em: String(c.criado_em ?? ''),
  };
}
