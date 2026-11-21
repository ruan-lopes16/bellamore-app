import { View, ActivityIndicator } from 'react-native';
import { BarraDeStatus, comTemaDoUsuario, useTema } from '@/lib/tema';

/**
 * Rota raiz: só mostra um loader. O redirecionamento para login, dashboard
 * ou criar-empresa é feito pelo _layout raiz assim que a sessão carrega —
 * sem este arquivo o expo-router abre "rota não encontrada" antes do redirect.
 */
function Index() {
  const { C } = useTema();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
      <BarraDeStatus />
      <ActivityIndicator color={C.primaryTexto} />
    </View>
  );
}

export default comTemaDoUsuario(Index);
