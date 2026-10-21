/**
 * Horários do dia (de `horariosDoDia(janelaDoDia(...))`, de 15 em 15 min) mais o campo
 * "Outro horário" para digitar um horário exato (HH:MM), igual ao web.
 */
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';

const C = {
  surface: '#FFFFFF', border: '#E8E2DC', primary: '#2C1654', rose: '#B42318',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

/** "HH:MM" de 00:00 a 23:59. */
export function horaValida(h: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
}

/** Máscara HH:MM enquanto digita. */
function mascaraHora(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

type Props = {
  horarios: string[];
  hora: string | null;
  onChange: (hora: string | null) => void;
  desabilitado?: boolean;
};

export default function SeletorHorario({ horarios, hora, onChange, desabilitado }: Props) {
  const foraDaLista = !!hora && !horarios.includes(hora);
  const [outro, setOutro] = useState(foraDaLista ? hora! : '');

  // Hora que chega de fora (edição, ?hora=) e não está na grade aparece no campo livre.
  useEffect(() => {
    if (hora && !horarios.includes(hora)) setOutro(hora);
  }, [hora, horarios]);

  const outroInvalido = outro.length > 0 && !horaValida(outro);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 2, paddingVertical: 2 }}>
          {horarios.map((h) => {
            const ativo = hora === h;
            return (
              <TouchableOpacity
                key={h}
                disabled={desabilitado}
                onPress={() => { setOutro(''); onChange(h); }}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                  backgroundColor: ativo ? C.primary : C.surface,
                  borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: ativo ? '#fff' : C.text2 }}>
                  {h}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text3 }}>
          Outro horário
        </Text>
        <TextInput
          editable={!desabilitado}
          value={outro}
          onChangeText={(v) => {
            const m = mascaraHora(v);
            setOutro(m);
            if (horaValida(m)) onChange(m);
            else if (foraDaLista) onChange(null);
          }}
          placeholder="HH:MM"
          placeholderTextColor={C.text4}
          keyboardType="number-pad"
          maxLength={5}
          style={{
            width: 90, borderWidth: 1, borderColor: outroInvalido ? C.rose : (foraDaLista ? C.primary : C.border),
            borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.surface,
            fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text,
          }}
        />
        {outroInvalido && (
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.rose }}>Horário inválido</Text>
        )}
      </View>
    </View>
  );
}
