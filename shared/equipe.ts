/** Regras puras da Equipe (web, app e rotas de API). */

export type TipoContrato = 'pj' | 'clt';

/** Rótulo do tipo de contrato (vazio = sem contrato informado). */
export function rotuloContrato(t: TipoContrato | null): string {
  return t === 'pj' ? 'PJ / Comissionada' : t === 'clt' ? 'CLT' : '';
}

/**
 * Comissão do corpo: `undefined` ou `null` = não veio (nunca zera); texto vazio = 0; número ou texto
 * (aceita "45,5") de 0 a 100; qualquer outra coisa = `null` (inválida).
 */
export function normalizarComissao(v: unknown): number | null | undefined {
  if (v === undefined || v === null) return undefined;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return 0;
    if (!/^\d+([.,]\d+)?$/.test(t)) return null;
    n = Number(t.replace(',', '.'));
  } else return null;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100 + 0;
}

/** Tipo de contrato do corpo: `undefined` = não veio; `null` = sem contrato; `'invalido'` = valor desconhecido. */
export function normalizarTipoContrato(v: unknown): TipoContrato | null | undefined | 'invalido' {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return v === 'pj' || v === 'clt' ? v : 'invalido';
}

/** E-mail com formato mínimo (algo@algo.algo). */
export function emailValido(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

const ERRO_COMISSAO = 'A comissão deve ficar entre 0 e 100%.';
const ERRO_CONTRATO = 'Tipo de contrato inválido.';

/** PATCH do vínculo: só os campos que vieram no corpo. */
export function montarPatchVinculo(corpo: { percentual_comissao?: unknown; tipo_contrato?: unknown }):
  { patch: { percentual_comissao?: number; tipo_contrato?: TipoContrato | null } } | { erro: string } {
  const patch: { percentual_comissao?: number; tipo_contrato?: TipoContrato | null } = {};
  const c = normalizarComissao(corpo.percentual_comissao);
  if (c === null) return { erro: ERRO_COMISSAO };
  if (c !== undefined) patch.percentual_comissao = c;
  const t = normalizarTipoContrato(corpo.tipo_contrato);
  if (t === 'invalido') return { erro: ERRO_CONTRATO };
  if (t !== undefined) patch.tipo_contrato = t;
  return { patch };
}

/**
 * Comissão e contrato a gravar ao adicionar/convidar. Vínculo novo: o que veio (senão 0 e sem contrato).
 * Vínculo existente: só troca o que veio — reenviar convite nunca zera a comissão.
 */
export function vinculoParaGravar(
  existente: { percentual_comissao: number; tipo_contrato: TipoContrato | null } | null,
  corpo: { percentual_comissao?: unknown; tipo_contrato?: unknown },
): { valores: { percentual_comissao: number; tipo_contrato: TipoContrato | null } } | { erro: string } {
  const r = montarPatchVinculo(corpo);
  if ('erro' in r) return r;
  return { valores: {
    percentual_comissao: r.patch.percentual_comissao ?? Number(existente?.percentual_comissao ?? 0),
    tipo_contrato: r.patch.tipo_contrato !== undefined ? r.patch.tipo_contrato : (existente?.tipo_contrato ?? null),
  } };
}

/**
 * Faturado e atendimentos do mês por profissional (decisão do dono 2026-10-14): faturado = atendimentos
 * concluídos SEM pacote + serviços extras (`extrasPorProf`); atendimentos = todos os concluídos.
 * Atendimento entra com `valor − desconto_rateado` (parte do desconto da comanda, migration 090;
 * ausente = 0), igual à receita de shared/kpis-financeiros.ts.
 */
export function estatisticasDoMes(
  ags: { profissional_id: string | null; valor: number | string | null; desconto_rateado?: number | string | null; pacote_cliente_id: string | null }[],
  extrasPorProf: Record<string, number>,
): Record<string, { total: number; atendimentos: number }> {
  const centavos: Record<string, number> = {};
  const atend: Record<string, number> = {};
  for (const a of ags) {
    if (!a.profissional_id) continue;
    atend[a.profissional_id] = (atend[a.profissional_id] ?? 0) + 1;
    centavos[a.profissional_id] ??= 0;
    if (!a.pacote_cliente_id) {
      const v = Number(a.valor ?? 0);
      const d = Number(a.desconto_rateado ?? 0);
      const cent = (Number.isFinite(v) ? Math.round(v * 100) : 0) - (Number.isFinite(d) ? Math.round(d * 100) : 0);
      centavos[a.profissional_id] += Math.max(cent, 0);
    }
  }
  for (const [id, v] of Object.entries(extrasPorProf)) {
    centavos[id] = (centavos[id] ?? 0) + Math.round(v * 100);
  }
  const out: Record<string, { total: number; atendimentos: number }> = {};
  for (const id of new Set([...Object.keys(centavos), ...Object.keys(atend)])) {
    out[id] = { total: (centavos[id] ?? 0) / 100, atendimentos: atend[id] ?? 0 };
  }
  return out;
}

/**
 * Quais números de um membro a pessoa logada pode ver na Equipe (web e app). A tela pede só
 * `equipe.gerenciar`, mas a RLS só entrega os atendimentos das colegas com `agenda.ver_equipe` e as
 * comissões delas com `comissoes.ver_todas` — sem a chave, os números viriam zerados e seriam falsos.
 * Os números da própria pessoa sempre aparecem (a RLS mostra o que é dela). A dona tem todas as chaves.
 *
 * - `producao`: faturado e atendimentos do mês;
 * - `comissao`: comissão pendente, "Pagar" e "Comissão em dia".
 */
export function numerosVisiveis(
  meuUserId: string | null | undefined,
  alvoUserId: string,
  pode: (chave: 'agenda.ver_equipe' | 'comissoes.ver_todas') => boolean,
): { producao: boolean; comissao: boolean } {
  const euMesma = !!meuUserId && meuUserId === alvoUserId;
  return {
    producao: euMesma || pode('agenda.ver_equipe'),
    comissao: euMesma || pode('comissoes.ver_todas'),
  };
}

// ── Histórico da Equipe (migration 092) ─────────────────────────────────────

/** Ações gravadas em `equipe_historico` (mesma lista do CHECK da 092). */
export const ACOES_HISTORICO_EQUIPE = [
  'convite_enviado', 'convite_aceito', 'convite_recusado', 'convite_cancelado',
  'login_trocado', 'desativado', 'reativado', 'papel_trocado', 'comissao_trocada', 'contrato_trocado',
] as const;
export type AcaoHistoricoEquipe = typeof ACOES_HISTORICO_EQUIPE[number];

/** Linha de `listar_historico_equipe` (e-mails já mascarados pelo banco para quem não é a dona). */
export type LinhaHistoricoEquipe = {
  id: string;
  empresa_id?: string;
  alvo_user_id: string | null;
  acao: AcaoHistoricoEquipe | string;
  detalhe: Record<string, unknown> | null;
  feito_por: string | null;
  criado_em: string;
  alvo_nome?: string | null;
  feito_por_nome?: string | null;
};

/** Rótulo do papel na Equipe: Dona, Gestora ou Profissional (desconhecido = como veio). */
export function rotuloPapelEquipe(p: unknown): string {
  return p === 'owner' ? 'Dona' : p === 'gestor' ? 'Gestora' : p === 'profissional' ? 'Profissional' : String(p ?? '');
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "45,5%" / "40%" (sem Intl: o Hermes do app não tem locale pt-BR completo). */
function percentual(v: unknown): string {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return '—';
  return `${String(Math.round(n * 100) / 100).replace('.', ',')}%`;
}

const contrato = (v: unknown) => rotuloContrato(v === 'pj' || v === 'clt' ? v : null) || 'sem contrato';

/**
 * Frase em português de uma linha do histórico da Equipe (web e app). Nomes: primeiro o mapa
 * `nomes` (user_id → nome) da tela, depois o nome que o banco devolveu; quem fez a mudança pela
 * rota do servidor (`feito_por` nulo) aparece como "Alguém".
 */
export function descreverHistoricoEquipe(linha: LinhaHistoricoEquipe, nomes: Record<string, string> = {}): string {
  const d = linha.detalhe ?? {};
  const autor = (linha.feito_por && nomes[linha.feito_por]) || texto(linha.feito_por_nome) || 'Alguém';
  const alvo = (linha.alvo_user_id && nomes[linha.alvo_user_id]) || texto(linha.alvo_nome)
    || texto(d.nome) || texto(d.email) || 'uma pessoa';
  const papel = rotuloPapelEquipe(d.role);
  switch (linha.acao) {
    case 'convite_enviado': return `${autor} convidou ${alvo} para a equipe como ${papel}.`;
    case 'convite_aceito': return `${alvo} aceitou o convite e entrou na equipe como ${papel}.`;
    case 'convite_recusado': return `${alvo} recusou o convite para a equipe.`;
    case 'convite_cancelado': return `${autor} cancelou o convite de ${alvo}.`;
    case 'login_trocado': return `${autor} trocou o e-mail de login de ${alvo} de ${texto(d.de) ?? '—'} para ${texto(d.para) ?? '—'}.`;
    case 'desativado': return `${autor} desativou ${alvo}.`;
    case 'reativado': return `${autor} reativou ${alvo}.`;
    case 'papel_trocado': return `${autor} mudou o papel de ${alvo} de ${rotuloPapelEquipe(d.de)} para ${rotuloPapelEquipe(d.para)}.`;
    case 'comissao_trocada': return `${autor} mudou a comissão de ${alvo} de ${percentual(d.de)} para ${percentual(d.para)}.`;
    case 'contrato_trocado': return `${autor} mudou o contrato de ${alvo} de ${contrato(d.de)} para ${contrato(d.para)}.`;
    default: return `${autor} alterou ${alvo}.`;
  }
}

const dois = (n: number) => String(n).padStart(2, '0');

/** "16/10/2026 14:30" em Brasília (UTC−3 fixo, mesma regra de shared/periodos), sem Intl. */
export function quandoHistoricoEquipe(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 3 * 3600_000);
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
}
