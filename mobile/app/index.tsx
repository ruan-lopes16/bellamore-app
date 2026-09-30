import { View, ActivityIndicator } from 'react-native';

/**
 * Rota raiz: só mostra um loader. O redirecionamento para login, dashboard
 * ou criar-empresa é feito pelo _layout raiz assim que a sessão carrega —
 * sem este arquivo o expo-router abre "rota não encontrada" antes do redirect.
 */
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F1EE' }}>
      <ActivityIndicator color="#2C1654" />
    </View>
  );
}
