import { View, ActivityIndicator } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { BannerConvites } from '@/components/BannerConvites';
import { SemAcesso } from '@/components/SemAcesso';
import { usePermissoes } from '@/lib/permissions';
import { permissaoDaRota } from '@shared/permissoes';

export default function EmpresaLayout() {
  const { pode, permissoesCarregadas, permissoesErro } = usePermissoes();
  // Guarda por rota, com o mesmo mapa do `exigirAcesso` do web: protege também o deep link.
  const segments = useSegments();
  const acesso = permissaoDaRota(segments);
  // Permissões ainda chegando: a tela protegida espera (nunca abre nem expulsa antes da hora).
  // Com erro, o _layout raiz já cobre tudo com "Tentar de novo".
  const esperando = !!acesso && !permissoesCarregadas && !permissoesErro;
  const semAcesso = !!acesso && permissoesCarregadas && !pode(acesso);

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
        'editar-pacote/[id]', 'editar-produto/[id]', 'editar-profissional/[id]', 'editar-servico/[id]',
        'equipe', 'estoque', 'notificacoes', 'nova-comanda', 'nova-despesa', 'nova-retirada',
        'novo-agendamento', 'novo-cliente', 'novo-pacote', 'novo-produto', 'novo-servico',
        'pacotes', 'relatorios', 'servicos', 'vendas',
      ].map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
    <BannerConvites />
    {esperando && (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F4F1EE', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#2C1654" />
      </View>
    )}
    {semAcesso && <SemAcesso />}
    </View>
  );
}
