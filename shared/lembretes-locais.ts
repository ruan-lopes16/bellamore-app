/**
 * @file lembretes-locais.ts
 * Regra única de quando o app agenda o lembrete LOCAL de atendimento (30 min antes).
 *
 * Com o aparelho registrado em `push_dispositivos` (migration 097), o lembrete chega pelo servidor
 * (cron de lembretes): agendar o local também faria a notificação chegar dobrada. O lembrete local
 * só existe no caminho antigo, quando a 097 ainda não foi rodada (`users.push_token`).
 * Sem permissão, sem suporte (simulador) ou antes do registro terminar: nenhum lembrete local.
 */

/** Resultado da sincronização do aparelho no app. */
export type ResultadoRegistroPush = 'registrado' | 'sem_migration' | 'sem_permissao' | 'sem_suporte';

/**
 * `true` só quando o registro devolveu `'sem_migration'` (caminho antigo: lembrete local).
 * Qualquer outro valor (inclusive `null` = registro ainda não feito) → `false`.
 */
export function usarLembreteLocal(resultado: ResultadoRegistroPush | null | undefined): boolean {
  return resultado === 'sem_migration';
}
