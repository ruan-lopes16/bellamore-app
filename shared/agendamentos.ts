/**
 * Regras de exclusão física de agendamentos.
 *
 * Um agendamento `concluido` tem comissão, uso de pacote e movimento
 * de estoque amarrados sem `ON DELETE CASCADE` — apagar dá erro de FK
 * e mexeria em faturamento. Fica sempre fora. Os demais status
 * (agendado/confirmado/cancelado/faltou) podem ser apagados por
 * dona/gestora quando foram lançados ou cancelados por engano; as
 * taxas de reserva/cancelamento vinculadas somem por cascata.
 */

/** Status cujo agendamento NÃO pode ser apagado (tem financeiro vinculado). */
export const STATUS_NAO_EXCLUIVEL = ['concluido'] as const;

/** true se este papel pode apagar de vez um agendamento neste status. */
export function podeExcluirAgendamento(status: string, role: string): boolean {
  const ehGestao = role === 'owner' || role === 'gestor';
  return ehGestao && !(STATUS_NAO_EXCLUIVEL as readonly string[]).includes(status);
}

/** Texto do porquê a exclusão está bloqueada por status, ou null se o status permite. */
export function motivoExclusaoBloqueada(status: string): string | null {
  if ((STATUS_NAO_EXCLUIVEL as readonly string[]).includes(status)) {
    return 'Atendimento concluído tem comissão e financeiro vinculados. Reverta o status antes de excluir.';
  }
  return null;
}
