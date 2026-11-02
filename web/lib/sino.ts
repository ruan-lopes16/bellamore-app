/**
 * @file sino.ts
 * Badges da Sidebar do web pela regra única de shared (`badgesDoMenu`, a mesma do app), com as
 * contagens leves de `carregarContagensSino`:
 * - sino: o mesmo número de `contagemSino(alertasCalculados(...))` da tela de Notificações;
 * - Comissões: pendentes que a pessoa vê (todas com `comissoes.ver_todas`, senão as próprias);
 * - Comanda: comandas não fechadas que ela pode fechar (`comanda.fechar`; sem
 *   `agenda.gerenciar_outras`, só as próprias — mesma regra do alerta).
 * `null` = carga com erro: a Sidebar mantém o número anterior, nunca mostra um falso.
 */
export { badgesDoMenu, type BadgesMenu } from '@shared/notificacoes';

/** Evento disparado pela tela de Notificações para a Sidebar recarregar o sino. */
export const EVENTO_SINO = 'bm:sino-atualizar';
