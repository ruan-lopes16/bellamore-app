/** Alternância Dia / Mês da agenda do app, na mesma tela. */
import { View, Text, TouchableOpacity } from 'react-native';

export type VisaoAgenda = 'dia' | 'mes';

const C = { surface: '#FFFFFF', border: '#E8E2DC', primary: '#2C1654', text3: '#8878A6' };

const OPCOES: { valor: VisaoAgenda; rotulo: string }[] = [
  { valor: 'dia', rotulo: 'Dia' },
  { valor: 'mes', rotulo: 'Mês' },
];

export function AlternarVisao({ visao, onMudar }: { visao: VisaoAgenda; onMudar: (v: VisaoAgenda) => void }) {
  return (
    <View style={{
      flexDirection: 'row', marginHorizontal: 24, marginBottom: 12, padding: 3, borderRadius: 12,
      backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    }}>
      {OPCOES.map((o) => {
        const ativo = o.valor === visao;
        return (
          <TouchableOpacity
            key={o.valor}
            onPress={() => onMudar(o.valor)}
            accessibilityState={{ selected: ativo }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 9, backgroundColor: ativo ? C.primary : 'transparent' }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text3 }}>
              {o.rotulo}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
