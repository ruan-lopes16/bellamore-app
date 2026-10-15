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
 */
export function estatisticasDoMes(
  ags: { profissional_id: string | null; valor: number | string | null; pacote_cliente_id: string | null }[],
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
      centavos[a.profissional_id] += Number.isFinite(v) ? Math.round(v * 100) : 0;
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
