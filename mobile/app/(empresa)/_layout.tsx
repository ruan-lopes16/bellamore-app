import { Tabs } from 'expo-router';
import { usePermissoes } from '@/lib/permissions';

export default function EmpresaLayout() {
  const { pode } = usePermissoes();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#6b21a8',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { borderTopColor: '#f3e8ff' },
      }}
    >
      <Tabs.Screen name="dashboard"   options={{ title: 'Início',       tabBarIcon: () => null }} />
      <Tabs.Screen name="agenda"      options={{ title: 'Agenda',       tabBarIcon: () => null }} />
      <Tabs.Screen name="clientes"    options={{ title: 'Clientes',     tabBarIcon: () => null }} />
      <Tabs.Screen name="financeiro"  options={{ title: 'Financeiro',   tabBarIcon: () => null,
        href: pode('financeiro.ver') ? undefined : null,
      }} />
      <Tabs.Screen name="mais"        options={{ title: 'Mais',         tabBarIcon: () => null }} />
      {/* Rotas que não são aba: sem isto o expo-router as exibe como abas */}
      {[
        'agendamento/[id]', 'cliente/[id]', 'cliente/[id]/anamnese', 'cliente/[id]/editar',
        'comissoes', 'configuracoes', 'convidar-profissional',
        'editar-pacote/[id]', 'editar-produto/[id]', 'editar-servico/[id]',
        'equipe', 'estoque', 'notificacoes', 'nova-comanda', 'nova-despesa', 'nova-retirada',
        'novo-agendamento', 'novo-cliente', 'novo-pacote', 'novo-produto', 'novo-servico',
        'pacotes', 'relatorios', 'servicos',
      ].map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
