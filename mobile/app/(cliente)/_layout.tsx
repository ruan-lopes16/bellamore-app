import { Tabs } from 'expo-router';

export default function ClienteLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#6b21a8',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { borderTopColor: '#f3e8ff' },
      }}
    >
      <Tabs.Screen name="inicio"    options={{ title: 'Início',    tabBarIcon: () => null }} />
      <Tabs.Screen name="historico" options={{ title: 'Histórico', tabBarIcon: () => null }} />
      <Tabs.Screen name="perfil"    options={{ title: 'Perfil',    tabBarIcon: () => null }} />
    </Tabs>
  );
}
