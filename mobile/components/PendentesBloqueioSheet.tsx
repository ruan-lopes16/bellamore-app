import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { format } from 'date-fns';
import { X } from 'lucide-react-native';
import { motivoBloqueioLabel } from '@shared/bloqueios';
import type { BloqueioAgenda } from '@/hooks/useAgenda';

const C = { surface: '#FFFFFF', border: '#E8E2DC', text: '#1A1228', text3: '#8878A6', green: '#0D7E5F', red: '#C0392B' };

/**
 * Folha nativa com os bloqueios pendentes de aprovação da empresa ativa.
 * Cada item mostra quem pediu, quando e o motivo, com botões Aprovar /
 * Recusar. `onAprovar`/`onRecusar` recebem só o id — o disparo da mutação
 * (e o `Alert` de falha) fica com a tela que monta esta folha.
 *
 * Guarda de duplo-tap: enquanto uma linha está em `busyId`, seus dois
 * botões ficam `disabled` e esmaecidos, então um segundo toque não dispara
 * uma segunda mutação (que acertaria zero linhas e mostraria um "Sem
 * permissão" enganoso). `busyId` limpa quando `pendentes` muda de
 * identidade — o pai remove a linha / refaz a busca no sucesso — e tem um
 * fallback de 4s para o caso de erro (a linha continua e o `Alert` aparece).
 */
export function PendentesBloqueioSheet({
  visible, pendentes, onClose, onAprovar, onRecusar,
}: {
  visible: boolean;
  pendentes: (BloqueioAgenda & { autorNome: string })[];
  onClose: () => void;
  onAprovar: (id: string) => void;
  onRecusar: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { setBusyId(null); }, [pendentes]);

  function disparar(id: string, fn: (id: string) => void) {
    if (busyId === id) return;
    setBusyId(id);
    fn(id);
    setTimeout(() => setBusyId((atual) => (atual === id ? null : atual)), 4000);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: C.border }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>Bloqueios pendentes</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={C.text3} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {pendentes.length === 0 && (
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, textAlign: 'center', paddingVertical: 20 }}>
                Nada pendente.
              </Text>
            )}
            {pendentes.map((b) => {
              const ocupado = busyId === b.id;
              return (
                <View key={b.id} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>{b.autorNome}</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                    {format(new Date(b.data_inicio), 'dd/MM HH:mm')}–{format(new Date(b.data_fim), 'HH:mm')} · {motivoBloqueioLabel(b.motivo)}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <TouchableOpacity onPress={() => disparar(b.id, onAprovar)} disabled={ocupado}
                      style={{ flex: 1, height: 34, borderRadius: 8, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', opacity: ocupado ? 0.5 : 1 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Aprovar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => disparar(b.id, onRecusar)} disabled={ocupado}
                      style={{ flex: 1, height: 34, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: ocupado ? 0.5 : 1 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.red }}>Recusar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
