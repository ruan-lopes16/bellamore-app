import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { format } from 'date-fns';
import { motivoBloqueioLabel } from '@shared/bloqueios';
import type { BloqueioAgenda } from '@/hooks/useAgenda';
import { useTema } from '@/lib/tema';

/**
 * Diálogo nativo centralizado de confirmação para remover um bloqueio
 * de agenda — equivalente ao ConfirmDialog usado no web. Mostra escopo
 * ("Toda a agenda" ou o nome do profissional), motivo e intervalo, e um
 * aviso extra quando o bloqueio ainda está pendente de aprovação.
 */
export function ConfirmarRemoverBloqueio({
  visible, bloqueio, profNome, removendo = false, onCancelar, onConfirmar,
}: {
  visible: boolean;
  bloqueio: BloqueioAgenda | null;
  profNome: string | null;
  removendo?: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const { C } = useTema();
  if (!bloqueio) return null;

  const alvo = bloqueio.escopo === 'geral' ? 'Toda a agenda' : (profNome ?? 'Profissional');
  const intervalo =
    `${format(new Date(bloqueio.data_inicio), "dd/MM 'às' HH:mm")}–${format(new Date(bloqueio.data_fim), 'HH:mm')}`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 360, backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 20 }}>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 17, color: C.text }}>
            Remover bloqueio?
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text2, marginTop: 8 }}>
            {alvo} · {motivoBloqueioLabel(bloqueio.motivo)} · {intervalo}.
          </Text>
          {bloqueio.situacao === 'pendente' && (
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginTop: 6 }}>
              Este pedido ainda aguarda aprovação.
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
            <TouchableOpacity onPress={onCancelar} disabled={removendo}
              style={{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', opacity: removendo ? 0.5 : 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirmar} disabled={removendo}
              style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: C.rose, alignItems: 'center', justifyContent: 'center', opacity: removendo ? 0.5 : 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>
                {removendo ? 'Removendo...' : 'Remover'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
