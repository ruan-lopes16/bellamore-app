/**
 * @file shared/lembretes.ts
 * Funções puras do motor de lembretes de atendimento. Sem I/O — o chamador
 * (a rota /api/cron/lembretes) faz as queries e os envios de push.
 *
 * Cadência: 1 push 1h antes + 1 push 15 min antes de cada atendimento.
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
  lembrete_1h_em: string | null;
  lembrete_15min_em: string | null;
};

export type JanelaLembrete = '1h' | '15min';

/** Configuração de cada janela: quantos minutos antes, com que folga, e qual coluna marca o envio. */
const JANELAS: Record<JanelaLembrete, { alvoMin: number; folgaMin: number; campo: 'lembrete_1h_em' | 'lembrete_15min_em' }> = {
  // 1h antes: pega quem começa entre 45 e 75 min (folga de 15 pra cada lado do cron de 5 min).
  '1h':    { alvoMin: 60, folgaMin: 15, campo: 'lembrete_1h_em' },
  // 15 min antes: pega quem começa entre agora e 20 min. Nunca depois do início.
  '15min': { alvoMin: 15, folgaMin: 5,  campo: 'lembrete_15min_em' },
};

/** HH:mm de um ISO com offset, sem depender do timezone da máquina. */
function hhmm(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '--:--';
}

/**
 * Atendimentos que devem receber o push de uma janela agora:
 * - ainda não avisados nessa janela (`campo` nulo)
 * - `data_hora_inicio` cai na faixa [alvo - folga, alvo + folga] minutos à frente
 * - para a janela de 15 min, nunca depois do horário de início
 * O chamador já filtrou por status (agendado/confirmado) e empresa.
 */
export function selecionarLembrete(ags: AgLembrete[], agora: Date, janela: JanelaLembrete): AgLembrete[] {
  const { alvoMin, folgaMin, campo } = JANELAS[janela];
  const nowMs = agora.getTime();
  const minMs = nowMs + (alvoMin - folgaMin) * 60_000;
  const maxMs = nowMs + (alvoMin + folgaMin) * 60_000;
  return ags.filter(a => {
    if (a[campo]) return false;
    const t = new Date(a.data_hora_inicio).getTime();
    if (Number.isNaN(t)) return false;
    if (janela === '15min' && t < nowMs) return false; // já começou
    return t >= minMs && t <= maxMs;
  });
}

/** Corpo do push de um lembrete de atendimento. Ex.: "Lazara · Design com tintura · 17:30" */
export function corpoLembrete(ag: AgLembrete): string {
  const cli = ag.cliente_nome ?? 'Cliente';
  const serv = ag.descricao_servico ?? 'Atendimento';
  return `${cli} · ${serv} · ${hhmm(ag.data_hora_inicio)}`;
}

/** Título do push conforme a antecedência. */
export function tituloLembrete(janela: JanelaLembrete): string {
  return janela === '1h' ? 'Atendimento em 1 hora' : 'Atendimento em 15 minutos';
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
 * Corpo do resumo diário. Só entra linha com contagem > 0; se tudo zero,
 * retorna string vazia (o chamador não envia nada).
 */
export function corpoResumoDiario(n: { agendamentos: number; despesasVencendo: number; estoqueBaixo: number }): string {
  const linhas: string[] = [];
  if (n.agendamentos > 0)     linhas.push(`📅 ${n.agendamentos} atendimento${n.agendamentos === 1 ? '' : 's'} hoje`);
  if (n.despesasVencendo > 0) linhas.push(`💰 ${n.despesasVencendo} despesa${n.despesasVencendo === 1 ? '' : 's'} vencendo hoje`);
  if (n.estoqueBaixo > 0)     linhas.push(`📦 ${n.estoqueBaixo} produto${n.estoqueBaixo === 1 ? '' : 's'} com estoque baixo`);
  return linhas.join('\n');
}
