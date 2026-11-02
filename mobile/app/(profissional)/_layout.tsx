import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { BannerConvites } from '@/components/BannerConvites';
import { usePreferenciaTema, PALETA_ESCURA } from '@/lib/tema';

export default function ProfissionalLayout() {
  // Barra de abas no tema da pessoa (modo escuro); as telas não migradas seguem claras.
  const escuro = usePreferenciaTema().esquema === 'escuro';
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: escuro ? PALETA_ESCURA.accent : '#6b21a8',
        tabBarInactiveTintColor: escuro ? PALETA_ESCURA.text3 : '#9ca3af',
        tabBarStyle: escuro
          ? { borderTopColor: PALETA_ESCURA.border, backgroundColor: PALETA_ESCURA.surface }
          : { borderTopColor: '#f3e8ff' },
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
      {/* Exceção à decisão de 02/10 pedida pelo dono (paridade de Notificações): aberta pelo sino do Início. */}
      <Tabs.Screen name="notificacoes" options={{ href: null }} />
    </Tabs>
    <BannerConvites />
    </View>
  );
}
