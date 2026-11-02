/**
 * @file sino.ts
 * Badges da Sidebar do web a partir dos mesmos dados e regras da tela de Notificações:
 * - sino: `contagemSino(alertasCalculados(...), naoLidas)` (shared/notificacoes);
 * - Comissões: comissões pendentes que a pessoa vê (todas com `comissoes.ver_todas`, senão as próprias);
 * - Comanda: comandas não fechadas que ela pode fechar (`comanda.fechar`; sem
 *   `agenda.gerenciar_outras`, só as próprias — mesma regra do alerta).
 * `null` = carga com erro: a Sidebar mantém o número anterior, nunca mostra um falso.
 */
import { alertasCalculados, contagemSino } from '@shared/notificacoes';
import type { DadosAlertas } from '@shared/notificacoes-consultas';
import { pode, type PermissoesUsuario } from '@shared/permissoes';

/** Evento disparado pela tela de Notificações para a Sidebar recarregar o sino. */
export const EVENTO_SINO = 'bm:sino-atualizar';

export type BadgesSidebar = { sino: number | null; comissoes: number | null; comandas: number | null };

export function badgesSidebar(
  dados: DadosAlertas | null,
  permissoes: PermissoesUsuario | null,
  userId: string,
  naoLidas: number | null,
  agora: Date = new Date(),
): BadgesSidebar {
  if (!dados || !permissoes) return { sino: null, comissoes: null, comandas: null };
  const proprio = (id: string | null | undefined) => !!id && id === userId;
  const sino = contagemSino(alertasCalculados(dados, permissoes, { userId, agora }), naoLidas);
  const todas = pode(permissoes, 'comissoes.ver_todas');
  const comissoes = dados.comissoesPendentes.filter(c => todas || proprio(c.profissional_id)).length;
  const outras = pode(permissoes, 'agenda.gerenciar_outras');
  const comandas = pode(permissoes, 'comanda.fechar') && dados.comandasNaoFechadas
    ? dados.comandasNaoFechadas.filter(c => outras || proprio(c.profissional_id)).length
    : 0;
  return { sino, comissoes, comandas };
}
