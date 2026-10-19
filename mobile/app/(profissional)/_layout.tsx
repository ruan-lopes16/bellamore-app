import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { BannerConvites } from '@/components/BannerConvites';

export default function ProfissionalLayout() {
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#6b21a8',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { borderTopColor: '#f3e8ff' },
      }}
    >
      <Tabs.Screen name="inicio"        options={{ title: 'Início',       tabBarIcon: () => null }} />
      <Tabs.Screen name="agenda"        options={{ title: 'Minha Agenda', tabBarIcon: () => null }} />
      <Tabs.Screen name="servicos"      options={{ title: 'Serviços',     tabBarIcon: () => null }} />
      <Tabs.Screen name="pacotes"       options={{ title: 'Pacotes',      tabBarIcon: () => null }} />
      <Tabs.Screen name="comissoes"     options={{ title: 'Comissões',    tabBarIcon: () => null }} />
      <Tabs.Screen name="configuracoes" options={{ title: 'Ajustes',      tabBarIcon: () => null }} />
      {/* Rota que não é aba */}
      <Tabs.Screen name="agendamento/[id]" options={{ href: null }} />
      {/* Exceção à decisão de 02/10 (sem telas novas aqui): só o botão do horário vazio e o "Editar" chegam nela. */}
      <Tabs.Screen name="novo-agendamento" options={{ href: null }} />
    </Tabs>
    <BannerConvites />
    </View>
  );
}
