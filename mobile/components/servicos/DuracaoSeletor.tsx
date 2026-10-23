import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Clock } from 'lucide-react-native';
import { DURACOES_PADRAO } from '@shared/servicos';
import { formatarDuracao } from '@shared/dominio';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

/**
 * Duração do serviço: atalhos de `DURACOES_PADRAO` mais "Personalizada" em horas e minutos
 * (mesma regra do web: minutos limitados a 59, total só muda quando > 0).
 */
export function DuracaoSeletor({ duracao, onChange }: { duracao: number; onChange: (min: number) => void }) {
  const [personal, setPersonal] = useState(!DURACOES_PADRAO.includes(duracao));
  const [horas, setHoras] = useState(String(Math.floor(duracao / 60)));
  const [minutos, setMinutos] = useState(String(duracao % 60));

  function chip(ativo: boolean, label: string, onPress: () => void, key: string) {
    return (
      <TouchableOpacity
        key={key}
        onPress={onPress}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 5,
          paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
          backgroundColor: ativo ? C.primarySoft : C.surface,
          borderWidth: 1, borderColor: ativo ? C.primary : C.border,
        }}
      >
        <Clock size={12} color={ativo ? C.primary : C.text3} strokeWidth={2} />
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? C.primary : C.text3 }}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  }

  function aoMudarHoras(txt: string) {
    const limpo = txt.replace(/\D/g, '').slice(0, 2);
    setHoras(limpo);
    const total = (parseInt(limpo, 10) || 0) * 60 + Math.min(parseInt(minutos, 10) || 0, 59);
    if (total > 0) onChange(total);
  }

  function aoMudarMinutos(txt: string) {
    const limpo = txt.replace(/\D/g, '').slice(0, 2);
    setMinutos(limpo);
    const total = (parseInt(horas, 10) || 0) * 60 + Math.min(parseInt(limpo, 10) || 0, 59);
    if (total > 0) onChange(total);
  }

  const campo = {
    width: 56, height: 42, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface, textAlign: 'center' as const,
    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15, color: C.text,
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {DURACOES_PADRAO.map((valor) => chip(!personal && duracao === valor, formatarDuracao(valor), () => {
          setPersonal(false);
          setHoras(String(Math.floor(valor / 60)));
          setMinutos(String(valor % 60));
          onChange(valor);
        }, String(valor)))}
        {chip(personal, 'Personalizada', () => setPersonal(true), 'personalizada')}
      </View>
      {personal && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10,
        }}>
          <TextInput
            value={horas}
            onChangeText={aoMudarHoras}
            onBlur={() => { if (horas === '') setHoras('0'); }}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={C.text4}
            accessibilityLabel="Horas"
            style={campo}
          />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3 }}>h</Text>
          <TextInput
            value={minutos}
            onChangeText={aoMudarMinutos}
            onBlur={() => {
              const m = parseInt(minutos, 10);
              setMinutos(Number.isNaN(m) ? '0' : String(Math.min(Math.max(m, 0), 59)));
            }}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={C.text4}
            accessibilityLabel="Minutos"
            style={campo}
          />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3 }}>min</Text>
          <Text style={{ marginLeft: 'auto', fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text3 }}>
            = {formatarDuracao(duracao)}
          </Text>
        </View>
      )}
    </View>
  );
}
