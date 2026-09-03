/**
 * @file shared/lembretes.ts
 * Funções puras do motor de lembretes de atendimento. Sem I/O — o chamador
 * (a rota /api/cron/lembretes) faz as queries e os envios de push.
 *
 * Cadência: 1 resumo na véspera (a partir das 18:00, fuso America/Sao_Paulo)
 * + 1 push individual 30 min antes de cada atendimento.
 */

export type AgLembrete = {
  id: string;
  profissional_id: string;
  /** ISO com offset — ex.: "2026-09-04T17:30:00-03:00" */
  data_hora_inicio: string;
  cliente_nome: string | null;
  servico_nome: string | null;
  lembrete_vespera_em: string | null;
  lembrete_30min_em: string | null;
};

/** Hora local (0–23) em America/Sao_Paulo para um instante qualquer. */
function horaSaoPaulo(agora: Date): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false,
  }).format(agora);
  // "24" aparece em alguns motores para meia-noite; normaliza para 0.
  const h = parseInt(s, 10);
  return h === 24 ? 0 : h;
}

/** HH:mm de um ISO com offset, sem depender do timezone da máquina. */
function hhmm(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '--:--';
}

/** true quando já passou das 18:00 no fuso de São Paulo — hora de mandar a véspera. */
export function ehHoraDaVespera(agora: Date): boolean {
  return horaSaoPaulo(agora) >= 18;
}

/**
 * Atendimentos que devem receber o push de "30 min antes" agora:
 * começam na janela [agora, agora + 35 min] e ainda não foram avisados.
 * A janela de 35 min cobre o intervalo de 5 min do cron com folga.
 */
export function selecionar30min(ags: AgLembrete[], agora: Date): AgLembrete[] {
  const ini = agora.getTime();
  const fim = ini + 35 * 60_000;
  return ags.filter(a => {
    if (a.lembrete_30min_em) return false;
    const t = new Date(a.data_hora_inicio).getTime();
    return t >= ini && t <= fim;
  });
}

/** Dos agendamentos de amanhã (o chamador já filtrou por data), os sem véspera enviada. */
export function selecionarVespera(ags: AgLembrete[]): AgLembrete[] {
  return ags.filter(a => !a.lembrete_vespera_em);
}

/** Corpo do push individual de 30 min. */
export function corpo30min(ag: AgLembrete): string {
  const serv = ag.servico_nome ?? 'Atendimento';
  const cli = ag.cliente_nome ?? 'Cliente';
  return `Em 30 min: ${cli} — ${serv} · ${hhmm(ag.data_hora_inicio)}`;
}

/**
 * Um resumo de véspera por profissional que tem atendimento amanhã.
 * Ordena por horário; o corpo cita a contagem e o 1º atendimento.
 * A ordem dos profissionais segue a 1ª aparição no array de entrada.
 */
export function resumosVespera(ags: AgLembrete[]): { profissionalId: string; corpo: string }[] {
  const porProf = new Map<string, AgLembrete[]>();
  for (const a of ags) {
    const arr = porProf.get(a.profissional_id) ?? [];
    arr.push(a);
    porProf.set(a.profissional_id, arr);
  }
  const out: { profissionalId: string; corpo: string }[] = [];
  for (const [profissionalId, lista] of porProf) {
    const ordenada = [...lista].sort((x, y) => x.data_hora_inicio.localeCompare(y.data_hora_inicio));
    const n = ordenada.length;
    const primeiro = ordenada[0];
    const plural = n === 1 ? 'atendimento' : 'atendimentos';
    out.push({
      profissionalId,
      corpo: `Amanhã: ${n} ${plural} · 1º às ${hhmm(primeiro.data_hora_inicio)} — ${primeiro.cliente_nome ?? 'Cliente'}`,
    });
  }
  return out;
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
