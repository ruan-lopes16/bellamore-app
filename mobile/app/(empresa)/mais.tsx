import {
  View, Text, TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import {
  Scissors, Users, DollarSign, Settings, LogOut,
  ChevronRight, Package, BarChart2, Bell, Gift, ShoppingCart, Receipt,
} from 'lucide-react-native';
import {
  useFonts,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useAuthStore } from '@/stores/authStore';
import { usePermissoes } from '@/lib/permissions';
import { SeletorEmpresa } from '@/components/SeletorEmpresa';
import { useBadgesMenu } from '@/hooks/useNotificacoes';
import { BarraDeStatus, comTemaDoUsuario, useTema } from '@/lib/tema';

// ── Constantes ───────────────────────────────────────────────


// ── Item de menu ─────────────────────────────────────────────

function MenuItem({
  icon, label, sublabel, iconBg, iconColor, onPress, danger = false, badge,
}: {
  badge?: number;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  iconBg: string;
  iconColor: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { C } = useTema();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 13, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}
    >
      <View style={{
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: iconBg,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{
          fontFamily: 'PlusJakartaSans_600SemiBold',
          fontSize: 14, color: danger ? C.red : C.text,
        }}>
          {label}
        </Text>
        {sublabel && (
          <Text style={{
            fontFamily: 'PlusJakartaSans_400Regular',
            fontSize: 11, color: C.text3, marginTop: 1,
          }}>
            {sublabel}
          </Text>
        )}
      </View>
      {!!badge && badge > 0 && (
        <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: '#fff' }}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
      <ChevronRight size={16} color={C.text4} strokeWidth={2} />
    </TouchableOpacity>
  );
}

// ── Tela principal ───────────────────────────────────────────

function Mais() {
  const { C } = useTema();
  const insets = useSafeAreaInsets();
  const { user, empresaAtiva, roleAtivo, isOwner, sair } = useAuthStore();
  // Sem fallback de papel: indefinido = ainda carregando (o rótulo fica vazio até chegar).
  const role = isOwner ? 'owner' : roleAtivo;
  const { pode } = usePermissoes();

  // Sino e badges Comissões/Comanda pela regra única da Sidebar web (`badgesDoMenu`): comissões
  // todas com `comissoes.ver_todas` (senão as próprias); comandas com `comanda.fechar`, só as
  // próprias sem `agenda.gerenciar_outras`. Erro na 1ª carga (isError) → sem número, nunca um falso.
  const { sino, comissoes: pendentes, comandas: comandasAbertas } = useBadgesMenu();

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  function confirmarSaida() {
    Alert.alert('Sair', 'Deseja encerrar a sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: sair },
    ]);
  }

  const iniciais = (user?.nome ?? '')
    .split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BarraDeStatus comFundo />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* ── Header ── */}
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380 }}
          style={{
            paddingTop: insets.top + 12,
            paddingHorizontal: 24,
            paddingBottom: 20,
          }}
        >
          <Text style={{
            fontFamily: 'PlusJakartaSans_500Medium',
            fontSize: 11, color: C.text3,
            letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4,
          }}>
            {empresaAtiva?.nome}
          </Text>
          <Text style={{
            fontFamily: 'Fraunces_600SemiBold',
            fontSize: 26, color: C.text,
          }}>
            Mais
          </Text>
        </MotiView>

        {/* ── Perfil do usuário ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ marginHorizontal: 24, marginBottom: 20 }}
        >
          <TouchableOpacity
            style={{
              backgroundColor: C.surface,
              borderWidth: 1, borderColor: C.border,
              borderRadius: 18, padding: 16,
              flexDirection: 'row', alignItems: 'center', gap: 14,
              shadowColor: C.primary, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
            }}
          >
            <View style={{
              width: 52, height: 52, borderRadius: 16,
              backgroundColor: C.primary,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{
                fontFamily: 'PlusJakartaSans_700Bold',
                fontSize: 18, color: '#fff',
              }}>
                {iniciais}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{
                fontFamily: 'PlusJakartaSans_700Bold',
                fontSize: 15, color: C.text, marginBottom: 2,
              }}>
                {user?.nome}
              </Text>
              <Text style={{
                fontFamily: 'PlusJakartaSans_400Regular',
                fontSize: 12, color: C.text3,
              }}>
                {isOwner ? 'Proprietário' : role === 'gestor' ? 'Gestor' : role === 'profissional' ? 'Profissional' : ''}
                {' · '}{empresaAtiva?.nome}
              </Text>
            </View>
            <ChevronRight size={16} color={C.text4} strokeWidth={2} />
          </TouchableOpacity>
        </MotiView>

        {/* ── Trocar empresa (só com 2+ vínculos) ── */}
        <SeletorEmpresa style={{ marginHorizontal: 24, marginBottom: 16 }} />

        {/* ── Gestão ── */}
        {/* Serviços e Pacotes são sempre visíveis; os demais itens seguem as chaves de permissão. */}
        <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350, delay: 100 }}
            style={{ marginHorizontal: 24, marginBottom: 16 }}
          >
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              fontSize: 11, color: C.text3,
              textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
            }}>
              Gestão
            </Text>
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <MenuItem
                icon={<Scissors size={16} color={C.primary} strokeWidth={2} />}
                label="Serviços"
                sublabel="Gerencie preços e duração"
                iconBg={C.primarySoft} iconColor={C.primary}
                onPress={() => router.push('/(empresa)/servicos' as any)}
              />
              <MenuItem
                icon={<Gift size={16} color={C.accent} strokeWidth={2} />}
                label="Pacotes"
                sublabel="Combinações de serviços"
                iconBg={C.primarySoft} iconColor={C.accent}
                onPress={() => router.push('/(empresa)/pacotes' as any)}
              />
              {pode('comanda.fechar') && (
                <MenuItem
                  icon={<Receipt size={16} color={C.rose} strokeWidth={2} />}
                  label="Comanda"
                  sublabel={(comandasAbertas ?? 0) > 0 ? 'Comandas não fechadas' : 'Fechar atendimentos'}
                  iconBg={C.roseSoft} iconColor={C.rose}
                  badge={comandasAbertas ?? 0}
                  onPress={() => router.push('/(empresa)/nova-comanda' as any)}
                />
              )}
              {pode('equipe.gerenciar') && (
                <MenuItem
                  icon={<Users size={16} color={C.accent} strokeWidth={2} />}
                  label="Equipe"
                  sublabel="Profissionais e comissões"
                  iconBg={C.primarySoft} iconColor={C.accent}
                  onPress={() => router.push('/(empresa)/equipe' as any)}
                />
              )}
              {pode('comissoes.ver_todas') && (
                <MenuItem
                  icon={<DollarSign size={16} color={C.amber} strokeWidth={2} />}
                  label="Comissões"
                  sublabel="Repasses da equipe"
                  iconBg={C.amberSoft} iconColor={C.amber}
                  badge={pendentes ?? 0}
                  onPress={() => router.push('/(empresa)/comissoes' as any)}
                />
              )}
              {pode('estoque.acessar') && (
                <MenuItem
                  icon={<Package size={16} color={C.amber} strokeWidth={2} />}
                  label="Produtos & Estoque"
                  sublabel="Controle de insumos"
                  iconBg={C.amberSoft} iconColor={C.amber}
                  onPress={() => router.push('/(empresa)/estoque' as any)}
                />
              )}
              {pode('vendas.acessar') && (
                <MenuItem
                  icon={<ShoppingCart size={16} color={C.green} strokeWidth={2} />}
                  label="Vendas"
                  sublabel="Vendas avulsas de produtos"
                  iconBg={C.greenSoft} iconColor={C.green}
                  onPress={() => router.push('/(empresa)/vendas' as any)}
                />
              )}
              {pode('financeiro.ver') && (
                <MenuItem
                  icon={<BarChart2 size={16} color={C.green} strokeWidth={2} />}
                  label="Relatórios"
                  sublabel="Desempenho e faturamento"
                  iconBg={C.greenSoft} iconColor={C.green}
                  onPress={() => router.push('/(empresa)/relatorios' as any)}
                />
              )}
            </View>
        </MotiView>

        {/* ── Configurações ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 140 }}
          style={{ marginHorizontal: 24, marginBottom: 16 }}
        >
          <Text style={{
            fontFamily: 'PlusJakartaSans_700Bold',
            fontSize: 11, color: C.text3,
            textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
          }}>
            Configurações
          </Text>
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <MenuItem
              icon={<Bell size={16} color={C.rose} strokeWidth={2} />}
              label="Notificações"
              sublabel="Alertas e lembretes"
              iconBg={C.roseSoft} iconColor={C.rose}
              badge={sino ?? 0}
              onPress={() => router.push('/(empresa)/notificacoes' as any)}
            />
            <View style={{ borderBottomWidth: 0 }}>
              <MenuItem
                icon={<Settings size={16} color={C.text2} strokeWidth={2} />}
                label="Configurações da empresa"
                sublabel="Horários, dados e integrações"
                iconBg="#F3F4F6" iconColor={C.text2}
                onPress={() => router.push('/(empresa)/configuracoes' as any)}
              />
            </View>
          </View>
        </MotiView>

        {/* ── Sair ── */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 350, delay: 180 }}
          style={{ marginHorizontal: 24 }}
        >
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <View style={{ borderBottomWidth: 0 }}>
              <MenuItem
                icon={<LogOut size={16} color={C.red} strokeWidth={2} />}
                label="Sair"
                iconBg={C.redSoft} iconColor={C.red}
                onPress={confirmarSaida}
                danger
              />
            </View>
          </View>
        </MotiView>

        {/* Versão */}
        <Text style={{
          fontFamily: 'PlusJakartaSans_400Regular',
          fontSize: 11, color: C.text4,
          textAlign: 'center', marginTop: 32,
        }}>
          versão 0.1.0
        </Text>
      </ScrollView>
    </View>
  );
}

export default comTemaDoUsuario(Mais);
