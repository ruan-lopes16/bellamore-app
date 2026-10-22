import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable,
  RefreshControl, StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import {
  Search, Plus, SlidersHorizontal,
  Gift, ChevronRight,
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
import { SmoothTabs } from '@/components/SmoothTabs';
import { BotaoExportar } from '@/components/BotaoExportar';
import { definicaoClientes } from '@shared/exportacao/clientes';
import { SecretText } from '@/components/Secret';
import { useClientes } from '@/hooks/useClientes';
import { formatarMoeda } from '@shared/moeda';
import { chaveDiaBRT, hojeBRT, diasEntre } from '@shared/periodos';
import {
  contarSegmentos, filtrarClientes, segmentosDaCliente, aniversariantesDoMes,
  ROTULO_FILTRO, ROTULO_SEGMENTO,
  type Agregado, type ClienteBase, type FiltroClientes, type Segmento,
} from '@shared/clientes-segmentos';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
];

/** Tags mostradas na linha (a "Nunca atendida" aparece só como filtro/cartão). */
const TAG_CONFIG: Partial<Record<Segmento, { bg: string; color: string }>> = {
  vip:        { bg: C.amberSoft,   color: C.amber },
  nova:       { bg: C.greenSoft,   color: C.green },
  recorrente: { bg: C.primarySoft, color: C.primary },
  em_risco:   { bg: C.amberSoft,   color: C.amber },
  sumida:     { bg: '#FEF2F2',     color: '#C0392B' },
};
const ORDEM_TAGS: Segmento[] = ['vip', 'recorrente', 'em_risco', 'sumida', 'nova'];

const FILTROS: { key: FiltroClientes; label: string }[] = (
  ['todas', 'novas', 'aniversariantes', 'retornos', 'vip', 'recorrente', 'em_risco', 'sumida', 'nunca_atendida', 'arquivadas'] as FiltroClientes[]
).map((key) => ({ key, label: ROTULO_FILTRO[key] }));

/** Cartões de KPI; cada um aplica o filtro correspondente. */
const CARTOES: { filtro: FiltroClientes; label: string; cor: string; valor: (c: ReturnType<typeof contarSegmentos>) => number }[] = [
  { filtro: 'todas',          label: 'Total',           cor: C.text,  valor: (c) => c.total },
  { filtro: 'novas',          label: 'Novas no mês',    cor: C.green, valor: (c) => c.novasMes },
  { filtro: 'vip',            label: 'VIP',             cor: C.amber, valor: (c) => c.vip },
  { filtro: 'em_risco',       label: 'Em risco',        cor: C.amber, valor: (c) => c.em_risco },
  { filtro: 'sumida',         label: 'Sumidas',         cor: C.rose,  valor: (c) => c.sumida },
  { filtro: 'nunca_atendida', label: 'Nunca atendidas', cor: C.text2, valor: (c) => c.nunca_atendida },
];

// ── Helpers ──────────────────────────────────────────────────

function avatarColors(nome: string): [string, string] {
  return AVATAR_COLORS[nome.charCodeAt(0) % AVATAR_COLORS.length];
}

function iniciaisNome(nome: string) {
  return nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

function formatUltimaVisita(ultimaVisita: string | null | undefined, hoje: string): string {
  if (!ultimaVisita) return 'Sem visita';
  const dias = diasEntre(chaveDiaBRT(ultimaVisita), hoje);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  if (dias < 60) return 'há 1 mês';
  return `há ${Math.floor(dias / 30)} meses`;
}

// ── Componente de item ───────────────────────────────────────

function ClienteItem({ item, agregado, hoje, index }: { item: ClienteBase; agregado: Agregado | undefined; hoje: string; index: number }) {
  const [c1, c2] = avatarColors(item.nome);
  const segmentos = segmentosDaCliente(item, agregado, hoje);
  const tags = ORDEM_TAGS.filter((t) => segmentos.has(t));

  return (
    <MotiView
      from={{ opacity: 0, translateX: -6 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: 'timing', duration: 300, delay: index * 40 }}
    >
      <TouchableOpacity
        onPress={() => router.push(`/(empresa)/cliente/${item.id}` as any)}
        style={{
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 16,
          padding: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          shadowColor: C.primary,
          shadowOpacity: 0.04,
          shadowRadius: 6,
          elevation: 1,
          opacity: item.ativo === false ? 0.6 : segmentos.has('sumida') ? 0.75 : 1,
        }}
      >
        {/* Avatar */}
        <View style={{
          width: 44, height: 44, borderRadius: 14,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: c1,
        }}>
          <Text style={{
            fontFamily: 'PlusJakartaSans_700Bold',
            fontSize: 15, color: '#fff',
          }}>
            {iniciaisNome(item.nome)}
          </Text>
        </View>

        {/* Info */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'PlusJakartaSans_600SemiBold',
              fontSize: 14, color: C.text, marginBottom: 2,
            }}
          >
            {item.nome}
          </Text>
          <Text style={{
            fontFamily: 'PlusJakartaSans_400Regular',
            fontSize: 11, color: C.text3, marginBottom: 5,
          }}>
            {item.telefone ?? 'Sem telefone'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
            {tags.map((tag) => {
              const cfg = TAG_CONFIG[tag]!;
              return (
                <View key={tag} style={{
                  backgroundColor: cfg.bg, borderRadius: 6,
                  paddingHorizontal: 7, paddingVertical: 2,
                }}>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    fontSize: 9, color: cfg.color,
                    textTransform: 'uppercase', letterSpacing: 0.3,
                  }}>
                    {ROTULO_SEGMENTO[tag]}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Direita */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{
            fontFamily: 'PlusJakartaSans_400Regular',
            fontSize: 11, color: C.text3, marginBottom: 3,
          }}>
            {formatUltimaVisita(agregado?.ultimaVisita, hoje)}
          </Text>
          <SecretText style={{
            fontFamily: 'PlusJakartaSans_700Bold',
            fontSize: 13, color: C.text,
          }}>
            {formatarMoeda(agregado?.totalGasto ?? 0)}
          </SecretText>
        </View>
      </TouchableOpacity>
    </MotiView>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Clientes() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();

  const [filtro, setFiltro] = useState<FiltroClientes>('todas');
  const [busca, setBusca] = useState('');

  const { data: base, isLoading, isError, refetch } = useClientes();
  const hoje = hojeBRT();
  const todas = base?.clientes;
  const agregados = base?.agregados;
  const contagem = useMemo(
    () => (todas && agregados ? contarSegmentos(todas, agregados, hoje) : null),
    [todas, agregados, hoje],
  );
  const clientes = useMemo(
    () => (todas && agregados ? filtrarClientes(todas, agregados, filtro, busca, hoje) : []),
    [todas, agregados, filtro, busca, hoje],
  );
  const aniversariantes = useMemo(() => (todas ? aniversariantesDoMes(todas, hoje) : []), [todas, hoje]);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => { refetch(); }, [refetch]);

  if (!fontsLoaded) return null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <FlashList
        data={clientes}
        keyExtractor={(item) => item.id}
        estimatedItemSize={88}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor={C.accent} />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
        ListHeaderComponent={() => (
          <>
            {/* Header */}
            <MotiView
              from={{ opacity: 0, translateY: -8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 380 }}
              style={{
                paddingTop: insets.top + 12,
                paddingHorizontal: 24,
                paddingBottom: 16,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <View>
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
                  Clientes
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
                <BotaoExportar
                  definicao={definicaoClientes()}
                  getLinhas={() => clientes.map((c) => ({ nome: c.nome, telefone: c.telefone ?? null, email: c.email ?? null, dataNascimento: c.data_nascimento ?? null, criadoEm: c.created_at }))}
                  cor={C.text2}
                />
                <TouchableOpacity style={{
                  width: 38, height: 38, borderRadius: 12,
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
                }}>
                  <SlidersHorizontal size={16} color={C.text2} strokeWidth={1.8} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/(empresa)/novo-cliente' as any)}
                  style={{
                    width: 38, height: 38, borderRadius: 12,
                    backgroundColor: C.primary,
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: C.primary, shadowOpacity: 0.3,
                    shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
                  }}
                >
                  <Plus size={18} color="#fff" strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            </MotiView>

            {/* Busca */}
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 350, delay: 60 }}
              style={{ marginHorizontal: 24, marginBottom: 14 }}
            >
              <View style={{ position: 'relative' }}>
                <View style={{
                  position: 'absolute', left: 14, top: 0, bottom: 0,
                  justifyContent: 'center', zIndex: 1,
                }}>
                  <Search size={16} color={C.text4} strokeWidth={1.8} />
                </View>
                <TextInput
                  value={busca}
                  onChangeText={setBusca}
                  placeholder="Buscar por nome, telefone ou e-mail"
                  placeholderTextColor={C.text4}
                  style={{
                    backgroundColor: C.surface,
                    borderWidth: 1, borderColor: C.border,
                    borderRadius: 14, paddingVertical: 12,
                    paddingLeft: 42, paddingRight: 14,
                    fontFamily: 'PlusJakartaSans_400Regular',
                    fontSize: 13, color: C.text,
                    shadowColor: C.primary, shadowOpacity: 0.04,
                    shadowRadius: 6, elevation: 1,
                  }}
                />
              </View>
            </MotiView>

            {/* Tabs */}
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 350, delay: 80 }}
              style={{ marginHorizontal: 24, marginBottom: 16 }}
            >
              <SmoothTabs
                tabs={FILTROS}
                active={filtro}
                onChange={key => setFiltro(key as FiltroClientes)}
                activeColor={C.primary}
                trackBg={C.surface}
                trackBorder={C.border}
                inactiveTextColor={C.text3}
              />
            </MotiView>

            {/* Aviso de erro de carga */}
            {isError && (
              <View
                accessibilityRole="alert"
                style={{
                  marginHorizontal: 24, marginBottom: 16, padding: 12, borderRadius: 14,
                  backgroundColor: C.roseSoft, borderWidth: 1, borderColor: 'rgba(212,96,138,0.25)',
                }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.rose }}>
                  Não foi possível carregar os clientes. Puxe para atualizar.
                </Text>
              </View>
            )}

            {/* Cartões de KPI (clicáveis: aplicam o filtro) */}
            <MotiView
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 380, delay: 100 }}
              style={{
                marginHorizontal: 24, marginBottom: 16,
                flexDirection: 'row', flexWrap: 'wrap', gap: 8,
              }}
            >
              {CARTOES.map((k) => {
                const ativo = filtro === k.filtro;
                return (
                  <Pressable
                    key={k.label}
                    onPress={() => setFiltro(k.filtro)}
                    accessibilityRole="button"
                    accessibilityLabel={`Filtrar: ${k.label}`}
                    style={({ pressed }) => ({
                      flexBasis: '31%', flexGrow: 1,
                      backgroundColor: ativo ? C.primarySoft : C.surface,
                      borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                      borderRadius: 14, padding: 12,
                      opacity: pressed ? 0.7 : 1,
                      shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
                    })}
                  >
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_700Bold',
                      fontSize: 22, color: k.cor,
                      letterSpacing: -0.5, lineHeight: 24, marginBottom: 3,
                    }}>
                      {contagem ? k.valor(contagem) : '—'}
                    </Text>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_500Medium',
                      fontSize: 9, color: C.text3,
                      textTransform: 'uppercase', letterSpacing: 0.8,
                    }}>
                      {k.label}
                    </Text>
                  </Pressable>
                );
              })}
            </MotiView>

            {/* Banner aniversariantes */}
            {aniversariantes.length > 0 && (
              <MotiView
                from={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'timing', duration: 350, delay: 120 }}
                style={{ marginHorizontal: 24, marginBottom: 16 }}
              >
                <TouchableOpacity
                  onPress={() => setFiltro('aniversariantes')}
                  style={{
                    backgroundColor: C.roseSoft,
                    borderWidth: 1, borderColor: 'rgba(212,96,138,0.15)',
                    borderRadius: 14, padding: 12,
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}
                >
                  <View style={{
                    width: 36, height: 36, backgroundColor: 'rgba(212,96,138,0.1)',
                    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: 'rgba(212,96,138,0.15)',
                  }}>
                    <Gift size={16} color={C.rose} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_700Bold',
                      fontSize: 12, color: C.rose,
                    }}>
                      {aniversariantes.length === 1
                        ? '1 aniversariante neste mês'
                        : `${aniversariantes.length} aniversariantes neste mês`}
                    </Text>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_400Regular',
                      fontSize: 10, color: C.text3, marginTop: 1,
                    }}>
                      {aniversariantes.slice(0, 4).map((c) => c.nome.split(' ')[0]).join(', ')}{aniversariantes.length > 4 ? '…' : ''}
                    </Text>
                  </View>
                  <ChevronRight size={14} color={C.rose} strokeWidth={2} />
                </TouchableOpacity>
              </MotiView>
            )}

            {/* Label da lista */}
            <View style={{
              flexDirection: 'row', justifyContent: 'space-between',
              alignItems: 'center', marginHorizontal: 24, marginBottom: 10,
            }}>
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold',
                fontSize: 11, color: C.text3,
                textTransform: 'uppercase', letterSpacing: 1.5,
              }}>
                {isError ? '—' : clientes.length} {filtro === 'todas' ? 'clientes' : ROTULO_FILTRO[filtro].toLowerCase()}
              </Text>
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold',
                fontSize: 11, color: C.accent,
              }}>
                A–Z
              </Text>
            </View>
          </>
        )}
        renderItem={({ item, index }) => (
          <View style={{ paddingHorizontal: 24, marginBottom: 6 }}>
            <ClienteItem item={item} agregado={agregados?.get(item.id)} hoje={hoje} index={index} />
          </View>
        )}
        ListEmptyComponent={() => (isError || isLoading) ? null : (
          <View style={{
            marginHorizontal: 24, backgroundColor: C.surface,
            borderWidth: 1, borderColor: C.border,
            borderRadius: 16, padding: 32, alignItems: 'center',
          }}>
            <Search size={28} color={C.text4} strokeWidth={1.5} />
            <Text style={{
              fontFamily: 'PlusJakartaSans_400Regular',
              fontSize: 14, color: C.text3, marginTop: 10,
            }}>
              Nenhuma cliente encontrada
            </Text>
          </View>
        )}
      />
    </View>
  );
}
