import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  Download, TrendingUp, TrendingDown,
  CalendarCheck2, Receipt, UserPlus, RefreshCw,
  Users, UserCheck, Clock, ChevronLeft, ChevronRight,
} from 'lucide-react-native';
import {
  format, startOfWeek, endOfWeek, addWeeks, subWeeks, isSameWeek, startOfMonth,
  addYears, subYears, isSameYear,
} from 'date-fns';
import {
  useFonts,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import {
  useRelatorios, type Periodo,
  type ServicoRelatorio, type ProfissionalRelatorio,
} from '@/hooks/useRelatorios';
import { CategoriaIcon } from '@/components/CategoriaIcon';
import { SmoothTabs } from '@/components/SmoothTabs';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  red: '#C0392B', redSoft: '#FEF2F2',
  amber: '#B45309', amberSoft: '#FEF3E2',
  indigo: '#4F46E5', indigoSoft: '#EEF2FF',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: '7d',     label: 'Semana'       },
  { key: '30d',    label: 'Mês'          },
  { key: '90d',    label: 'Trimestre'    },
  { key: '1y',     label: 'Ano'          },
  { key: 'custom', label: 'Personalizado' },
];

const PERIODO_LABEL: Record<Periodo, string> = {
  '7d':     'vs semana anterior',
  '30d':    'vs mês anterior',
  '90d':    'vs trimestre anterior',
  '1y':     'vs ano anterior',
  'custom': 'vs período anterior',
};

/** Máscara DD/MM/AAAA aplicada ao digitar — mesmo padrão usado em nova-despesa.tsx */
function mascaraData(v: string) {
  const n = v.replace(/\D/g, '').slice(0, 8);
  if (n.length <= 2) return n;
  if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
}

/** Converte "DD/MM/AAAA" em Date; retorna null enquanto a digitação estiver incompleta */
function parseDataBR(v: string): Date | null {
  const p = v.split('/');
  if (p.length !== 3 || p[2].length !== 4) return null;
  const d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Helpers ──────────────────────────────────────────────────

function formatBRL(value: number) {
  if (value >= 1000) return `R$${(value / 1000).toFixed(1).replace('.', ',')}k`;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function delta(atual: number, anterior: number) {
  if (anterior === 0) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

function initials(nome: string) {
  return nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

// ── Avatar colorido ───────────────────────────────────────────

const AVATAR_COLORS = [
  ['#7C3AED', '#A855F7'],
  ['#D4608A', '#E879A0'],
  ['#0891B2', '#22D3EE'],
  ['#0D7E5F', '#10B981'],
  ['#B45309', '#F59E0B'],
];

function Avatar({ nome, index }: { nome: string; index: number }) {
  const [from, to] = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    <LinearGradient
      colors={[from, to]}
      style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>
        {initials(nome)}
      </Text>
    </LinearGradient>
  );
}

// ── KPI card ─────────────────────────────────────────────────

function KpiCard({
  icon, label, valor, deltaVal, invertDelta = false,
}: {
  icon: React.ReactNode;
  label: string;
  valor: string;
  deltaVal: number | null;
  invertDelta?: boolean;
}) {
  const positivo = deltaVal !== null
    ? (invertDelta ? deltaVal < 0 : deltaVal >= 0)
    : true;

  return (
    <View style={{
      flex: 1, backgroundColor: C.surface,
      borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14,
      shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {icon}
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>
          {label}
        </Text>
      </View>
      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: C.text, letterSpacing: -0.5, lineHeight: 24, marginBottom: 4 }}>
        {valor}
      </Text>
      {deltaVal !== null && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          {positivo
            ? <TrendingUp size={9} color={C.green} strokeWidth={2.5} />
            : <TrendingDown size={9} color={C.red} strokeWidth={2.5} />
          }
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: positivo ? C.green : C.red }}>
            {deltaVal >= 0 ? '+' : ''}{deltaVal}%
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Serviço row ───────────────────────────────────────────────

function ServicoRow({ item, isLast }: { item: ServicoRelatorio; isLast: boolean }) {
  return (
    <View style={{
      paddingVertical: 12, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
    }}>
      <CategoriaIcon categoria={item.nome} size={32} iconSize={13} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 2 }}>
          {item.nome}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginBottom: 5 }}>
          {item.quantidade} atendimentos
        </Text>
        <View style={{ height: 3, backgroundColor: C.border, borderRadius: 2 }}>
          <View style={{
            height: 3, borderRadius: 2, backgroundColor: C.accent,
            width: `${item.percentual}%`, opacity: 0.5 + item.percentual / 200,
          }} />
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
          {formatBRL(item.receita)}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, marginTop: 2 }}>
          {item.percentual}%
        </Text>
      </View>
    </View>
  );
}

// ── Profissional row ──────────────────────────────────────────

function ProfissionalRow({ item, index, isLast }: { item: ProfissionalRelatorio; index: number; isLast: boolean }) {
  return (
    <View style={{
      paddingVertical: 12, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
    }}>
      <Text style={{
        fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20,
        color: index < 2 ? C.primary : C.text4, minWidth: 22,
      }}>
        {index + 1}
      </Text>
      <Avatar nome={item.nome} index={index} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 2 }}>
          {item.nome}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
          {item.especialidades}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
          {formatBRL(item.faturamento)}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 2 }}>
          {item.atendimentos} atend.
        </Text>
      </View>
    </View>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Relatorios() {
  const insets = useSafeAreaInsets();
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  // Data de referência da semana visualizada — só usada quando periodo === '7d'
  const [semanaRef, setSemanaRef] = useState(new Date());
  const semanaIni = startOfWeek(semanaRef, { weekStartsOn: 1 });
  const semanaFim = endOfWeek(semanaRef, { weekStartsOn: 1 });
  const semanaAtual = isSameWeek(semanaRef, new Date(), { weekStartsOn: 1 });

  // Data de referência do ano visualizado — só usada quando periodo === '1y'
  const [anoRef, setAnoRef] = useState(new Date());
  const anoAtual = isSameYear(anoRef, new Date());

  const refAtivo = periodo === '7d' ? semanaRef : periodo === '1y' ? anoRef : new Date();

  // Intervalo personalizado (texto digitado com máscara) — só usado quando periodo === 'custom'
  const [customIniStr, setCustomIniStr] = useState(() => format(startOfMonth(new Date()), 'dd/MM/yyyy'));
  const [customFimStr, setCustomFimStr] = useState(() => format(new Date(), 'dd/MM/yyyy'));
  const hoje = new Date();
  let customFimEfetivo = parseDataBR(customFimStr) ?? hoje;
  if (customFimEfetivo > hoje) customFimEfetivo = hoje;
  let customIniEfetivo = parseDataBR(customIniStr) ?? startOfMonth(hoje);
  if (customIniEfetivo > customFimEfetivo) customIniEfetivo = customFimEfetivo;

  const { resumo, clientes, servicos, profissionais, isLoading, refetch } = useRelatorios(
    periodo, refAtivo, { ini: customIniEfetivo, fim: customFimEfetivo },
  );

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  const dFat   = resumo ? delta(resumo.faturamento, resumo.faturamentoAnterior) : null;
  const dAtend = resumo ? delta(resumo.atendimentos, resumo.atendimentosAnterior) : null;
  const dTicket = resumo ? delta(resumo.ticketMedio, resumo.ticketMedioAnterior) : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {/* ── Hero ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
        >
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350 }}
          >
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <View>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                  Análise
                </Text>
                <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
                  Relatórios
                </Text>
              </View>
              <TouchableOpacity style={{
                width: 38, height: 38,
                backgroundColor: 'rgba(255,255,255,0.12)',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
                borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                marginTop: 4,
              }}>
                <Download size={15} color="rgba(255,255,255,0.7)" strokeWidth={1.8} />
              </TouchableOpacity>
            </View>

            {/* Seletor de período */}
            <SmoothTabs
              variant="segmented"
              tabs={PERIODOS}
              active={periodo}
              onChange={key => {
                setPeriodo(key as Periodo);
                if (key === '7d') setSemanaRef(new Date());
                if (key === '1y') setAnoRef(new Date());
              }}
              activeColor="#fff"
              activeTextColor={C.primary}
              inactiveTextColor="rgba(255,255,255,0.5)"
              trackBg="rgba(255,255,255,0.1)"
              trackBorder="rgba(255,255,255,0.1)"
              style={{ marginBottom: periodo === '7d' || periodo === 'custom' || periodo === '1y' ? 12 : 20 }}
            />

            {/* Datas personalizadas — só no período "Personalizado" */}
            {periodo === 'custom' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 10, height: 34, justifyContent: 'center' }}>
                  <TextInput
                    value={customIniStr}
                    onChangeText={v => setCustomIniStr(mascaraData(v))}
                    placeholder="DD/MM/AAAA"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    keyboardType="numeric"
                    maxLength={10}
                    style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: '#fff', width: 82 }}
                  />
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>até</Text>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 10, height: 34, justifyContent: 'center' }}>
                  <TextInput
                    value={customFimStr}
                    onChangeText={v => setCustomFimStr(mascaraData(v))}
                    placeholder="DD/MM/AAAA"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    keyboardType="numeric"
                    maxLength={10}
                    style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: '#fff', width: 82 }}
                  />
                </View>
              </View>
            )}

            {/* Navegação entre semanas — só no período "Semana" */}
            {periodo === '7d' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 20 }}>
                <TouchableOpacity
                  onPress={() => setSemanaRef(d => subWeeks(d, 1))}
                  style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <ChevronLeft size={14} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
                  {format(semanaIni, 'dd/MM')} – {format(semanaFim, 'dd/MM')}
                </Text>
                <TouchableOpacity
                  onPress={() => !semanaAtual && setSemanaRef(d => addWeeks(d, 1))}
                  disabled={semanaAtual}
                  style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', opacity: semanaAtual ? 0.3 : 1 }}>
                  <ChevronRight size={14} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
              </View>
            )}

            {/* Navegação entre anos — só no período "Ano" */}
            {periodo === '1y' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 20 }}>
                <TouchableOpacity
                  onPress={() => setAnoRef(d => subYears(d, 1))}
                  style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <ChevronLeft size={14} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
                  {format(anoRef, 'yyyy')}
                </Text>
                <TouchableOpacity
                  onPress={() => !anoAtual && setAnoRef(d => addYears(d, 1))}
                  disabled={anoAtual}
                  style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', opacity: anoAtual ? 0.3 : 1 }}>
                  <ChevronRight size={14} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
              </View>
            )}

            {/* Faturamento */}
            <View style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
              borderRadius: 16, padding: 18,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Faturamento no período
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 38, color: '#fff', letterSpacing: -1, lineHeight: 42, marginBottom: 8 }}>
                {formatBRL(resumo?.faturamento ?? 0)}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{
                  backgroundColor: 'rgba(110,231,183,0.2)', borderRadius: 6,
                  paddingHorizontal: 8, paddingVertical: 3,
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                }}>
                  {(dFat ?? 0) >= 0
                    ? <TrendingUp size={9} color="#6EE7B7" strokeWidth={2.5} />
                    : <TrendingDown size={9} color="#FCA5A5" strokeWidth={2.5} />
                  }
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: (dFat ?? 0) >= 0 ? '#6EE7B7' : '#FCA5A5' }}>
                    {dFat !== null ? `${dFat >= 0 ? '+' : ''}${dFat}%` : '—'}
                  </Text>
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                  {PERIODO_LABEL[periodo]}
                </Text>
              </View>
            </View>
          </MotiView>
        </LinearGradient>

        {/* ── KPIs ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 80 }}
          style={{ marginHorizontal: 24, marginTop: 16, marginBottom: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
            <KpiCard
              icon={<View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}><CalendarCheck2 size={13} color={C.primary} strokeWidth={1.8} /></View>}
              label="Atendimentos"
              valor={String(resumo?.atendimentos ?? 0)}
              deltaVal={dAtend}
            />
            <KpiCard
              icon={<View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: C.greenSoft, alignItems: 'center', justifyContent: 'center' }}><Receipt size={13} color={C.green} strokeWidth={1.8} /></View>}
              label="Ticket médio"
              valor={formatBRL(resumo?.ticketMedio ?? 0)}
              deltaVal={dTicket}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
            <KpiCard
              icon={<View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: C.indigoSoft, alignItems: 'center', justifyContent: 'center' }}><UserPlus size={13} color={C.indigo} strokeWidth={1.8} /></View>}
              label="Novos clientes"
              valor={String(clientes?.novos ?? 0)}
              deltaVal={null}
            />
            <KpiCard
              icon={<View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: C.roseSoft, alignItems: 'center', justifyContent: 'center' }}><RefreshCw size={13} color={C.rose} strokeWidth={1.8} /></View>}
              label="Taxa retorno"
              valor={clientes && clientes.totalAtendidas > 0
                ? `${Math.round((clientes.retornaram / clientes.totalAtendidas) * 100)}%`
                : '—'
              }
              deltaVal={null}
            />
          </View>
        </MotiView>

        {/* ── Por serviço ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 140 }}
          style={{ marginHorizontal: 24, marginBottom: 20 }}
        >
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text, marginBottom: 12 }}>
            Por Serviço
          </Text>
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {servicos.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Sem atendimentos no período
                </Text>
              </View>
            ) : (
              servicos.map((s, i) => (
                <ServicoRow key={s.servico_id} item={s} isLast={i === servicos.length - 1} />
              ))
            )}
          </View>
        </MotiView>

        {/* ── Por profissional ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 200 }}
          style={{ marginHorizontal: 24, marginBottom: 20 }}
        >
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text, marginBottom: 12 }}>
            Por Profissional
          </Text>
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {profissionais.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Sem dados no período
                </Text>
              </View>
            ) : (
              profissionais.map((p, i) => (
                <ProfissionalRow key={p.profissional_id} item={p} index={i} isLast={i === profissionais.length - 1} />
              ))
            )}
          </View>
        </MotiView>

        {/* ── Clientes ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 260 }}
          style={{ marginHorizontal: 24 }}
        >
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text, marginBottom: 12 }}>
            Clientes
          </Text>
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {/* Grid 2×2 */}
            {[
              [
                { icon: <UserPlus size={12} color={C.indigo} strokeWidth={1.8} />, bg: C.indigoSoft, val: String(clientes?.novos ?? 0), label: 'Novos' },
                { icon: <RefreshCw size={12} color={C.green} strokeWidth={1.8} />,  bg: C.greenSoft,  val: String(clientes?.retornaram ?? 0), label: 'Retornaram' },
              ],
              [
                { icon: <Clock size={12} color={C.amber} strokeWidth={1.8} />,     bg: C.amberSoft,  val: String(clientes?.sumidos ?? 0), label: 'Sumidas +60d' },
                { icon: <Users size={12} color={C.primary} strokeWidth={1.8} />,   bg: C.primarySoft,val: String(clientes?.totalAtendidas ?? 0), label: 'Total atendidas' },
              ],
            ].map((linha, li) => (
              <View key={li} style={{ flexDirection: 'row', borderBottomWidth: li === 0 ? 1 : 0, borderBottomColor: C.border }}>
                {linha.map((m, mi) => (
                  <View
                    key={mi}
                    style={{
                      flex: 1, padding: 14,
                      borderRightWidth: mi === 0 ? 1 : 0, borderRightColor: C.border,
                    }}
                  >
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: m.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                      {m.icon}
                    </View>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: C.text, letterSpacing: -0.5, lineHeight: 22, marginBottom: 2 }}>
                      {m.val}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                      {m.label}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </MotiView>

      </ScrollView>
    </View>
  );
}
