import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { formatarMoeda } from '@shared/moeda';

/**
 * Pergunta sim/não com `Alert`. Resolve `true` só no botão de confirmar; "Voltar" ou fechar o
 * alerta (Android) resolvem `false`.
 */
export function confirmarAlerta(titulo: string, mensagem: string, textoConfirmar = 'Confirmar'): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      titulo,
      mensagem,
      [
        { text: 'Voltar', style: 'cancel', onPress: () => resolve(false) },
        { text: textoConfirmar, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Antes de excluir um atendimento: soma as taxas de reserva e de cancelamento já pagas dele
 * (somem junto, por cascata, e saem do faturamento) e devolve o trecho do aviso — mesmo texto do
 * web (`web/app/(app)/agenda/page.tsx`, `abrirConfirmExcluir`). Sem taxa paga devolve ''.
 * Lança se a consulta falhar, para a tela não excluir sem conseguir avisar.
 */
export async function avisoTaxaPagaAoExcluir(agendamentoId: string): Promise<string> {
  const [rTr, rTc] = await Promise.all([
    supabase.from('taxas_reserva').select('valor, status, paga_em').eq('agendamento_id', agendamentoId),
    supabase.from('taxas_cancelamento').select('valor, status, paga_em').eq('agendamento_id', agendamentoId),
  ]);
  if (rTr.error || rTc.error) throw new Error('Não foi possível conferir as taxas deste atendimento. Tente novamente.');
  const pagas = [...(rTr.data ?? []), ...(rTc.data ?? [])].filter(
    (t: any) => t.paga_em != null || t.status === 'pago' || t.status === 'paga',
  );
  const totalPago = pagas.reduce((s: number, t: any) => s + Number(t.valor || 0), 0);
  if (totalPago <= 0) return '';
  return ` A taxa de ${formatarMoeda(totalPago)} (paga) também será removida e sai do faturamento daquele período.`;
}
