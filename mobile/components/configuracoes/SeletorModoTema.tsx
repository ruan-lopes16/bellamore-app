/** Modo escuro (Configurações → perfil): Claro / Escuro / Sistema, salvo no aparelho na hora. */
import { View, Text, TouchableOpacity } from 'react-native';
import { MODOS_TEMA } from '@shared/tema';
import { usePreferenciaTema, useTema } from '@/lib/tema';

export function SeletorModoTema() {
  const { C } = useTema();
  const { modo, definirModo } = usePreferenciaTema();
  return (
    <View>
      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 }}>
        Aparência
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {MODOS_TEMA.map((m) => {
          const ativo = modo === m.valor;
          return (
            <TouchableOpacity
              key={m.valor}
              onPress={() => void definirModo(m.valor)}
              accessibilityState={{ selected: ativo }}
              style={{
                flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                backgroundColor: ativo ? C.primary : C.surface, borderWidth: 1, borderColor: ativo ? C.primary : C.border,
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text2 }}>{m.rotulo}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 8 }}>
        O modo escuro vale para as telas principais; as demais seguem claras por enquanto.
      </Text>
    </View>
  );
}
