import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { avisoTaxaPagaAoExcluir as avisoTaxaPagaAoExcluirShared } from '@shared/agenda-consultas';

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
 * Antes de excluir um atendimento: trecho do aviso de taxa paga, pela mesma função do web
 * (`avisoTaxaPagaAoExcluir` de shared). Lança se a consulta falhar, para a tela não excluir
 * sem conseguir avisar.
 */
export function avisoTaxaPagaAoExcluir(agendamentoId: string): Promise<string> {
  return avisoTaxaPagaAoExcluirShared(supabase, agendamentoId);
}
