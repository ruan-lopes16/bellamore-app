/**
 * @file shared/lembretes.ts
 * Funções puras do motor de lembretes de atendimento. Sem I/O — o chamador
 * (a rota /api/cron/lembretes) faz as queries e os envios de push.
 *
 * Cadência: 1 push único, 30 min antes de cada atendimento.
 * O resumo diário (nº de agendamentos, despesas, estoque) é de outra rota
 * (/api/cron/resumo-diario) e não usa este módulo.
 */

export type AgLembrete = {
  id: string;
  profissional_id: string;
  /** ISO com offset — ex.: "2026-09-04T17:30:00-03:00" */
  data_hora_inicio: string;
  cliente_nome: string | null;
  /** Serviço(s) do atendimento OU nome do pacote, já resolvido pelo chamador. */
  descricao_servico: string | null;
  lembrete_30min_em: string | null;
};

/** Quantos minutos antes do atendimento o push dispara. */
export const ALVO_MIN = 30;
/** Folga pra cada lado do alvo (cobre o cron rodando a cada 5 min). */
export const FOLGA_MIN = 5;

/** HH:mm de um ISO com offset, sem depender do timezone da máquina. */
function hhmm(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '--:--';
}

/**
 * Atendimentos que devem receber o push agora:
 * - ainda não avisados (`lembrete_30min_em` nulo)
 * - `data_hora_inicio` cai na faixa [30 - folga, 30 + folga] minutos à frente
 * - nunca depois do horário de início
 * O chamador já filtrou por status (agendado/confirmado) e empresa.
 */
export function selecionarLembrete(ags: AgLembrete[], agora: Date): AgLembrete[] {
  const nowMs = agora.getTime();
  const minMs = nowMs + (ALVO_MIN - FOLGA_MIN) * 60_000;
  const maxMs = nowMs + (ALVO_MIN + FOLGA_MIN) * 60_000;
  return ags.filter(a => {
    if (a.lembrete_30min_em) return false;
    const t = new Date(a.data_hora_inicio).getTime();
    if (Number.isNaN(t)) return false;
    if (t < nowMs) return false; // já começou
    return t >= minMs && t <= maxMs;
  });
}

/** Corpo do push de um lembrete de atendimento. Ex.: "Lazara · Design com tintura · 17:30" */
export function corpoLembrete(ag: AgLembrete): string {
  const cli = ag.cliente_nome ?? 'Cliente';
  const serv = ag.descricao_servico ?? 'Atendimento';
  return `${cli} · ${serv} · ${hhmm(ag.data_hora_inicio)}`;
}

/** Título do push de lembrete de atendimento. */
export function tituloLembrete(): string {
  return 'Atendimento em 30 minutos';
}

/** IDs de usuário que recebem o push de um agendamento: o profissional + owners/gestores. */
export function destinatarios(
  profissionalIdDoAg: string,
  membros: { user_id: string; role: string }[],
): string[] {
  const set = new Set<string>([profissionalIdDoAg]);
  for (const m of membros) {
    if (m.role === 'owner' || m.role === 'gestor') set.add(m.user_id);
  }
  return [...set];
}

/**
 * Corpo do resumo diário (dono/gestor) — visão da empresa toda. Só entra
 * linha com contagem > 0; se tudo zero, retorna string vazia (o chamador
 * não envia nada).
 */
export function corpoResumoDiario(n: { agendamentos: number; despesasVencendo: number; estoqueBaixo: number }): string {
  const linhas: string[] = [];
  if (n.agendamentos > 0)     linhas.push(`📅 ${n.agendamentos} atendimento${n.agendamentos === 1 ? '' : 's'} hoje`);
  if (n.despesasVencendo > 0) linhas.push(`💰 ${n.despesasVencendo} despesa${n.despesasVencendo === 1 ? '' : 's'} vencendo hoje`);
  if (n.estoqueBaixo > 0)     linhas.push(`📦 ${n.estoqueBaixo} produto${n.estoqueBaixo === 1 ? '' : 's'} com estoque baixo`);
  return linhas.join('\n');
}

/**
 * Corpo do resumo diário para profissional (não dona/gestora) — visão
 * pessoal, não da empresa: quantos atendimentos ela tem hoje e quanto já
 * comissionou hoje (soma de `comissoes` dos atendimentos dela já
 * concluídos, não uma projeção do dia inteiro). Sem atendimento hoje,
 * retorna string vazia (o chamador não envia nada).
 */
export function corpoResumoDiarioProfissional(n: { atendimentos: number; comissao: number }): string {
  if (n.atendimentos === 0) return '';
  const valor = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n.comissao);
  return `📅 ${n.atendimentos} atendimento${n.atendimentos === 1 ? '' : 's'} hoje\n💰 ${valor} em comissão hoje`;
}
