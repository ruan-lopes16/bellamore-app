// ── Tipos de entrada (linhas cruas vindas do Supabase) ────────

export type ServicoDoAgendamento = {
  ordem: number;
  servico: { nome: string } | null;
};

export type AgendamentoComServicos = {
  /** Servico legado (agendamentos.servico_id) — usado como fallback. */
  servico?: { nome: string } | null;
  agendamento_servicos?: ServicoDoAgendamento[] | null;
};

/**
 * Nome legivel dos servicos de um agendamento: junta as linhas de
 * agendamento_servicos por `ordem` com " + ".
 *
 * Existe porque a Agenda grava so o PRIMEIRO servico em agendamentos.servico_id
 * e a SOMA de todos em agendamentos.valor. Ler apenas o servico legado exibe o
 * nome de um servico ao lado do preco de varios.
 *
 * Cai no servico legado quando nao ha linhas em agendamento_servicos — o caso
 * da maioria dos agendamentos anteriores a migration 020. Retorna null quando
 * nao ha nome nenhum, para a tela decidir o placeholder.
 */
export function descreverServicos(ag: AgendamentoComServicos): string | null {
  const nomes = (ag.agendamento_servicos ?? [])
    .slice()                                   // nao mutar o array do chamador
    .sort((a, b) => a.ordem - b.ordem)
    .map((linha) => linha.servico?.nome)
    .filter((nome): nome is string => !!nome);

  if (nomes.length > 0) return nomes.join(' + ');
  return ag.servico?.nome ?? null;
}
