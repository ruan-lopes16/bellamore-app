import { TelaNotificacoes } from '@/components/TelaNotificacoes';
import { comTemaDoUsuario } from '@/lib/tema';

/** Notificações da dona/gestora: Alertas + Avisos (componente único com a área da profissional). */
function Notificacoes() {
  return <TelaNotificacoes area="empresa" />;
}

export default comTemaDoUsuario(Notificacoes);
