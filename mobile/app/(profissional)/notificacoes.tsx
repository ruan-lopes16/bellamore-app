import { TelaNotificacoes } from '@/components/TelaNotificacoes';

/**
 * Notificações da profissional (exceção à decisão de 02/10, pedida pelo dono na fase de paridade de
 * Configurações/Notificações): mesma tela da empresa, com os alertas que a permissão dela deixa ver.
 * Aberta pelo sino do Início e pelo toque na notificação push (rotaDoAviso).
 */
export default function Notificacoes() {
  return <TelaNotificacoes area="profissional" />;
}
