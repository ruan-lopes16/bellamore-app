import { Tabs } from 'expo-router';

export default function ProfissionalLayout() {
  return (
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
    </Tabs>
  );
}
