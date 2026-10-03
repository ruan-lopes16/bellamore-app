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

/** Pode excluir quem tem a permissão `agenda.excluir`, nunca um atendimento concluído. */
export function podeExcluirAgendamento(status: string, podeExcluir: boolean): boolean {
  return podeExcluir && !(STATUS_NAO_EXCLUIVEL as readonly string[]).includes(status);
}

/** Texto do porquê a exclusão está bloqueada por status, ou null se o status permite. */
export function motivoExclusaoBloqueada(status: string): string | null {
  if ((STATUS_NAO_EXCLUIVEL as readonly string[]).includes(status)) {
    return 'Atendimento concluído tem comissão e financeiro vinculados. Reverta o status antes de excluir.';
  }
  return null;
}

/**
 * Pode alterar (editar, mudar status, fechar comanda de) este agendamento?
 * Espelha a policy "agendamentos: equipe atualiza" (migration 083): a própria agenda é
 * sempre liberada; a de outra profissional exige `agenda.gerenciar_outras`.
 *
 * @param profissionalId  dona do agendamento (`agendamentos.profissional_id`)
 * @param meuUserId       quem está logado (vazio enquanto carrega = nunca libera por igualdade)
 * @param podeGerenciarOutras  `pode('agenda.gerenciar_outras')`
 */
export function podeMexerNoAgendamento(
  profissionalId: string | null | undefined,
  meuUserId: string,
  podeGerenciarOutras: boolean,
): boolean {
  if (podeGerenciarOutras) return true;
  return !!profissionalId && !!meuUserId && profissionalId === meuUserId;
}
