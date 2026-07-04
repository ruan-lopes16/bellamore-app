import {
  View, Text, TouchableOpacity, ScrollView, StatusBar, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import {
  Scissors, Users, DollarSign, Settings, LogOut,
  ChevronRight, Package, BarChart2, Bell, Gift, CheckCircle,
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
import { temPermissao, rotaInicial } from '@/lib/permissions';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

// ── Item de menu ─────────────────────────────────────────────

function MenuItem({
  icon, label, sublabel, iconBg, iconColor, onPress, danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  iconBg: string;
  iconColor: string;
  onPress: () => void;
  danger?: boolean;
}) {
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
      <ChevronRight size={16} color={C.text4} strokeWidth={2} />
    </TouchableOpacity>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Mais() {
  const insets = useSafeAreaInsets();
  const { user, empresaAtiva, roleAtivo, isOwner, sair, selecionarEmpresa, empresasDisponiveis } = useAuthStore();
  const role = isOwner ? 'owner' : (roleAtivo ?? 'gestor');

  const AVATAR_BG = ['#2C1654', '#0D7E5F', '#B45309', '#7C3AED', '#C0392B'];

  function trocarEmpresa(empresa: typeof empresasDisponiveis[0]) {
    selecionarEmpresa(empresa.empresa, empresa.isOwner ? 'gestor' : empresa.role, empresa.isOwner);
    const r = empresa.isOwner ? 'owner' : empresa.role;
    router.replace(rotaInicial(r) as any);
  }

  function roleLabelText(r: string, owner: boolean) {
    if (owner) return 'Proprietário(a)';
    if (r === 'gestor') return 'Gestor(a)';
    if (r === 'profissional') return 'Profissional';
    return 'Cliente';
  }

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
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

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
                {isOwner ? 'Proprietário' : role === 'gestor' ? 'Gestor' : 'Profissional'}
                {' · '}{empresaAtiva?.nome}
              </Text>
            </View>
            <ChevronRight size={16} color={C.text4} strokeWidth={2} />
          </TouchableOpacity>
        </MotiView>

        {/* ── Trocar empresa ── */}
        {empresasDisponiveis.length > 1 && (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350, delay: 80 }}
            style={{ marginHorizontal: 24, marginBottom: 16 }}
          >
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              fontSize: 11, color: C.text3,
              textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
            }}>
              Empresas
            </Text>
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              {empresasDisponiveis.map(({ empresa, role: empRole, isOwner: empOwner }, idx) => {
                const isAtiva = empresa.id === empresaAtiva?.id;
                const iniciais = empresa.nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
                const avatarBg = AVATAR_BG[idx % AVATAR_BG.length];
                const isLast = idx === empresasDisponiveis.length - 1;
                return (
                  <TouchableOpacity
                    key={empresa.id}
                    onPress={() => !isAtiva && trocarEmpresa({ empresa, role: empRole, isOwner: empOwner })}
                    activeOpacity={isAtiva ? 1 : 0.7}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 14,
                      paddingVertical: 13, paddingHorizontal: 16,
                      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
                      backgroundColor: isAtiva ? C.primarySoft : C.surface,
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: avatarBg,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>
                        {iniciais}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                        {empresa.nome}
                      </Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 1 }}>
                        {roleLabelText(empRole, empOwner)}
                      </Text>
                    </View>
                    {isAtiva
                      ? <CheckCircle size={18} color={C.accent} strokeWidth={2} />
                      : <ChevronRight size={16} color={C.text4} strokeWidth={2} />
                    }
                  </TouchableOpacity>
                );
              })}
            </View>
          </MotiView>
        )}

        {/* ── Gestão ── */}
        {temPermissao(role, 'ver_resumo_financeiro') && (
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
              <MenuItem
                icon={<Users size={16} color={C.accent} strokeWidth={2} />}
                label="Equipe"
                sublabel="Profissionais e comissões"
                iconBg={C.primarySoft} iconColor={C.accent}
                onPress={() => router.push('/(empresa)/equipe' as any)}
              />
              <MenuItem
                icon={<Package size={16} color={C.amber} strokeWidth={2} />}
                label="Produtos & Estoque"
                sublabel="Controle de insumos"
                iconBg={C.amberSoft} iconColor={C.amber}
                onPress={() => router.push('/(empresa)/estoque' as any)}
              />
              <View style={{ borderBottomWidth: 0 }}>
                <MenuItem
                  icon={<BarChart2 size={16} color={C.green} strokeWidth={2} />}
                  label="Relatórios"
                  sublabel="Desempenho e faturamento"
                  iconBg={C.greenSoft} iconColor={C.green}
                  onPress={() => router.push('/(empresa)/relatorios' as any)}
                />
              </View>
            </View>
          </MotiView>
        )}

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
