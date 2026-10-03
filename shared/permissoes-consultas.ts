/**
 * Leitura e gravação de permissões no Supabase — usado por web (server e client) e mobile,
 * que passam o próprio client. Regras puras ficam em ./permissoes.
 */
import {
  CHAVES_PERMISSAO, configVazia, ehChavePermissao, permissoesPadrao, resolverPermissao,
  type ConfigPermissoes, type LinhaHistorico, type LinhasPermissao, type MudancaPermissao,
  type Papel, type PermissoesUsuario,
} from './permissoes';

/** O mínimo do client supabase-js usado aqui (web: @supabase/ssr; mobile: @supabase/supabase-js). */
export interface ClienteDbPermissoes {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

/** `empresa_membros.role` → papel configurável (`owner` e desconhecidos viram null). */
export function papelDeRole(role: string | null | undefined): Papel | null {
  return role === 'gestor' || role === 'profissional' ? role : null;
}

/**
 * Permissões efetivas da pessoa logada (RPC `minhas_permissoes`). Nunca lança: se a migration
 * 083 ainda não foi aplicada (ou der qualquer erro), devolve os padrões do papel — que são o
 * comportamento de antes da feature. Isso deixa o deploy seguro em qualquer ordem.
 */
export async function carregarMinhasPermissoes(
  sb: ClienteDbPermissoes, empresaId: string, isOwner: boolean, papel: Papel | null,
): Promise<PermissoesUsuario> {
  if (isOwner) return { isOwner: true, papel, chaves: [...CHAVES_PERMISSAO] };
  const padrao: PermissoesUsuario = { isOwner: false, papel, chaves: permissoesPadrao(papel) };
  try {
    const { data, error } = await sb.rpc('minhas_permissoes', { p_empresa: empresaId });
    if (error || !Array.isArray(data)) return padrao;
    const chaves = (data as { chave: string; permitido: boolean }[])
      .filter(r => r.permitido && ehChavePermissao(r.chave))
      .map(r => r.chave as (typeof CHAVES_PERMISSAO)[number]);
    return { isOwner: false, papel, chaves };
  } catch {
    return padrao;
  }
}

/** Linhas gravadas (sem padrões) para o painel de Configurações. Lança em erro. */
export async function carregarConfigPermissoes(sb: ClienteDbPermissoes, empresaId: string): Promise<ConfigPermissoes> {
  const [rPapel, rMembro] = await Promise.all([
    sb.from('permissoes_papel').select('papel, chave, permitido').eq('empresa_id', empresaId),
    sb.from('permissoes_membro').select('user_id, chave, permitido').eq('empresa_id', empresaId),
  ]);
  if (rPapel.error) throw new Error(rPapel.error.message);
  if (rMembro.error) throw new Error(rMembro.error.message);
  const cfg = configVazia();
  for (const l of (rPapel.data ?? []) as { papel: string; chave: string; permitido: boolean }[]) {
    const papel = papelDeRole(l.papel);
    if (papel && ehChavePermissao(l.chave)) cfg.papel[papel][l.chave] = l.permitido;
  }
  for (const l of (rMembro.data ?? []) as { user_id: string; chave: string; permitido: boolean }[]) {
    if (ehChavePermissao(l.chave)) (cfg.membros[l.user_id] ??= {})[l.chave] = l.permitido;
  }
  return cfg;
}

/** Grava o rascunho via RPC (valida a regra da gestora e grava o histórico no banco). */
export async function salvarPermissoes(
  sb: ClienteDbPermissoes, empresaId: string, mudancas: MudancaPermissao[],
): Promise<{ error: { code?: string; message: string } | null }> {
  const { error } = await sb.rpc('salvar_permissoes', { p_empresa: empresaId, p_mudancas: mudancas });
  return { error: error ?? null };
}

/** Últimas alterações (mais recentes primeiro). Lança em erro. */
export async function carregarHistoricoPermissoes(
  sb: ClienteDbPermissoes, empresaId: string, limite = 50,
): Promise<LinhaHistorico[]> {
  const { data, error } = await sb.from('permissoes_historico')
    .select('id, criado_em, alterado_por, alvo_tipo, alvo, chave, de, para')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as LinhaHistorico[];
}

/**
 * Permissões de um usuário qualquer, para rotas de API que usam service role (sem
 * auth.uid(), então `minhas_permissoes` não serve). Mesma ordem de `tem_permissao`.
 */
export async function carregarPermissoesDoMembro(
  admin: ClienteDbPermissoes, empresaId: string, userId: string,
): Promise<PermissoesUsuario | null> {
  const [rEmp, rMembro] = await Promise.all([
    admin.from('empresas').select('owner_id').eq('id', empresaId).maybeSingle(),
    admin.from('empresa_membros').select('role').eq('empresa_id', empresaId).eq('user_id', userId).eq('ativo', true).maybeSingle(),
  ]);
  const role = (rMembro.data as { role?: string } | null)?.role;
  const isOwner = (rEmp.data as { owner_id?: string } | null)?.owner_id === userId || role === 'owner';
  if (isOwner) return { isOwner: true, papel: null, chaves: [...CHAVES_PERMISSAO] };
  const papel = papelDeRole(role);
  if (!papel) return null;

  const [rPapel, rM] = await Promise.all([
    admin.from('permissoes_papel').select('chave, permitido').eq('empresa_id', empresaId).eq('papel', papel),
    admin.from('permissoes_membro').select('chave, permitido').eq('empresa_id', empresaId).eq('user_id', userId),
  ]);
  const paraLinhas = (rows: unknown): LinhasPermissao => {
    const out: LinhasPermissao = {};
    for (const l of ((rows ?? []) as { chave: string; permitido: boolean }[])) if (ehChavePermissao(l.chave)) out[l.chave] = l.permitido;
    return out;
  };
  // Tabelas ainda inexistentes (migration não aplicada) → erro → linhas vazias → padrões.
  const papelLinhas = rPapel.error ? {} : paraLinhas(rPapel.data);
  const membroLinhas = rM.error ? {} : paraLinhas(rM.data);
  const chaves = CHAVES_PERMISSAO.filter(c => resolverPermissao({ isOwner: false, papel, papelLinhas, membroLinhas }, c));
  return { isOwner: false, papel, chaves };
}
