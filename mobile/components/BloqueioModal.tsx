import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { format } from 'date-fns';
import { X } from 'lucide-react-native';
import {
  MOTIVOS_BLOQUEIO, podeSelecionarEscopoGeral,
  type MontarInsertBloqueioInput, type EscopoBloqueio, type MotivoBloqueio,
} from '@shared/bloqueios';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', rose: '#C9527F', text: '#1A1228', text3: '#8878A6',
};

type SubmitInput = Omit<MontarInsertBloqueioInput, 'role' | 'meuUserId' | 'empresaId'>;

/**
 * Modal nativo de criação de bloqueio de agenda para a área `(empresa)`.
 *
 * Dona/gestora (`podeSelecionarEscopoGeral(role) === true`) vê o alternador
 * "Um profissional" / "Toda a agenda" e a lista de membros; profissional vê
 * apenas o aviso de que o pedido vai para aprovação. `onSubmit` recebe o
 * input já sem `role`/`meuUserId`/`empresaId` (o hook os injeta) e resolve
 * com a `situacao` final — "pendente" dispara o alerta de aguardo.
 */
export function BloqueioModal({
  visible, role, meuNome, membros, dataInicial, onClose, onSubmit,
}: {
  visible: boolean;
  role: string;
  meuUserId: string;
  meuNome: string;
  membros: { id: string; nome: string }[];
  dataInicial: Date;
  onClose: () => void;
  onSubmit: (input: SubmitInput) => Promise<{ situacao: 'aprovado' | 'pendente' }>;
}) {
  const ehGestao = podeSelecionarEscopoGeral(role);
  const [escopo, setEscopo] = useState<EscopoBloqueio>('profissional');
  const [profId, setProfId] = useState('');
  const [motivo, setMotivo] = useState<MotivoBloqueio>('folga');
  const [titulo, setTitulo] = useState('');
  const [dataBl, setDataBl] = useState(format(dataInicial, 'yyyy-MM-dd'));
  const [horaIni, setHoraIni] = useState('08:00');
  const [horaFim, setHoraFim] = useState('09:00');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const di = new Date(`${dataBl}T${horaIni}:00`);
    const df = new Date(`${dataBl}T${horaFim}:00`);
    if (Number.isNaN(di.getTime()) || Number.isNaN(df.getTime())) {
      Alert.alert('Data ou hora inválida', 'Use o formato AAAA-MM-DD e HH:MM.'); return;
    }
    if (df <= di) { Alert.alert('Horário inválido', 'O fim deve ser após o início.'); return; }
    if (ehGestao && escopo === 'profissional' && !profId) { Alert.alert('Escolha o profissional'); return; }
    setSalvando(true);
    try {
      const { situacao } = await onSubmit({
        escopo, profissionalId: profId || null, motivo, titulo,
        dataInicio: di.toISOString(), dataFim: df.toISOString(),
      });
      setSalvando(false);
      onClose();
      if (situacao === 'pendente') Alert.alert('Pedido enviado', 'Aguardando aprovação da dona ou gestora.');
    } catch (e: any) {
      setSalvando(false);
      Alert.alert('Erro', e?.message ?? 'Não foi possível salvar.');
    }
  }

  const inputStyle = {
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 12, height: 44, fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 14, color: C.text, backgroundColor: C.bg,
  } as const;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: C.border }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>Bloquear horário</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={C.text3} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            {ehGestao ? (
              <>
                <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 12, overflow: 'hidden' }}>
                  {(['profissional', 'geral'] as EscopoBloqueio[]).map((op) => (
                    <TouchableOpacity key={op} onPress={() => setEscopo(op)}
                      style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: escopo === op ? C.primary : '#fff' }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: escopo === op ? '#fff' : C.text3 }}>
                        {op === 'profissional' ? 'Um profissional' : 'Toda a agenda'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {escopo === 'profissional' && (
                  <View style={{ gap: 6 }}>
                    {membros.map((m) => (
                      <TouchableOpacity key={m.id} onPress={() => setProfId(m.id)}
                        style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: profId === m.id ? C.primary : C.border, backgroundColor: profId === m.id ? '#EEE8F8' : '#fff' }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{m.nome}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={{ padding: 12, borderRadius: 12, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>
                  Bloqueio para <Text style={{ fontFamily: 'PlusJakartaSans_700Bold' }}>{meuNome}</Text>
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 4 }}>
                  Vai para aprovação da dona ou gestora.
                </Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {MOTIVOS_BLOQUEIO.map((m) => (
                <TouchableOpacity key={m.key} onPress={() => setMotivo(m.key)}
                  style={{ paddingHorizontal: 14, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: motivo === m.key ? C.primary : '#fff', borderWidth: 1, borderColor: motivo === m.key ? C.primary : C.border }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: motivo === m.key ? '#fff' : C.text3 }}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput value={titulo} onChangeText={setTitulo} placeholder="Detalhe (opcional)" style={inputStyle} placeholderTextColor={C.text3} />
            <TextInput value={dataBl} onChangeText={setDataBl} placeholder="AAAA-MM-DD" style={inputStyle} placeholderTextColor={C.text3} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TextInput value={horaIni} onChangeText={setHoraIni} placeholder="Início" style={[inputStyle, { flex: 1 }]} placeholderTextColor={C.text3} />
              <TextInput value={horaFim} onChangeText={setHoraFim} placeholder="Fim" style={[inputStyle, { flex: 1 }]} placeholderTextColor={C.text3} />
            </View>

            <TouchableOpacity onPress={salvar} disabled={salvando}
              style={{ height: 48, borderRadius: 14, backgroundColor: C.rose, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.6 : 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>
                {salvando ? 'Salvando...' : ehGestao ? 'Bloquear' : 'Pedir bloqueio'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
