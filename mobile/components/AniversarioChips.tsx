import { View, Text, ScrollView, TouchableOpacity } from 'react-native';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/**
 * Seletor de aniversário (só mês e dia, como no web): duas fileiras horizontais
 * de chips. Tocar no chip já selecionado limpa a escolha.
 * `mes` e `dia` são strings ("1".."12" / "1".."31"); vazio = não informado.
 */
export default function AniversarioChips({ mes, dia, onMes, onDia }: {
  mes: string; dia: string;
  onMes: (v: string) => void; onDia: (v: string) => void;
}) {
  const chip = (ativo: boolean) => ({
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8,
    backgroundColor: ativo ? '#2C1654' : '#FFFFFF',
    borderWidth: 1, borderColor: ativo ? '#2C1654' : '#E8E2DC',
  });
  const txt = (ativo: boolean) => ({
    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : '#8878A6',
  });
  const rotulo = { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: '#1A1228', marginBottom: 6 } as const;

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={rotulo}>Aniversário (mês)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 10 }}>
        {MESES.map((nome, i) => {
          const v = String(i + 1);
          const ativo = mes === v;
          return (
            <TouchableOpacity key={v} onPress={() => onMes(ativo ? '' : v)} style={chip(ativo)} activeOpacity={0.8}>
              <Text style={txt(ativo)}>{nome}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <Text style={rotulo}>Aniversário (dia)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((v) => {
          const ativo = dia === v;
          return (
            <TouchableOpacity key={v} onPress={() => onDia(ativo ? '' : v)} style={chip(ativo)} activeOpacity={0.8}>
              <Text style={txt(ativo)}>{v}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
