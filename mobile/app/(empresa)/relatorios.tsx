import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, TextInput, useWindowDimensions, Alert,
} from 'react-native';
import Svg, { Rect, G, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight, ChevronDown, Star,
} from 'lucide-react-native';
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

import { useRelatorios } from '@/hooks/useRelatorios';
import { usePermissoes } from '@/lib/permissions';
import {
  PERIODOS_RELATORIO, ROTULO_COMPARACAO, rotuloDoPeriodo, hojeBRT, rotuloDataBR, chaveDiaBRT, type PeriodoRelatorio,
} from '@shared/periodos';
import {
  ABAS_RELATORIO, cartoesKpiRelatorio, linhasResumoFinanceiro, type AbaRelatorio, type CartaoKpiRelatorio,
} from '@shared/relatorios';
import { textoConfirmarPagamento, type ComissoesDaProfissional } from '@shared/comissoes';
import { variacaoPercentual } from '@shared/kpis-financeiros';
import { SecretText, PrivacyToggle } from '@/components/Secret';
import { SmoothTabs } from '@/components/SmoothTabs';
import { BotaoExportar } from '@/components/BotaoExportar';
import { definicaoRelatorio } from '@shared/exportacao/relatorios';
import { formatarMoeda } from '@shared/moeda';

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

/** Máscara DD/MM/AAAA aplicada ao digitar — mesmo padrão usado em nova-despesa.tsx */
function mascaraData(v: string) {
  const n = v.replace(/\D/g, '').slice(0, 8);
  if (n.length <= 2) return n;
  if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
}

/** 'DD/MM/AAAA' → 'yyyy-MM-dd'; null enquanto a digitação estiver incompleta ou se a data não existe (ex.: 31/02). */
function paraIsoBR(v: string): string | null {
  const p = v.split('/');
  if (p.length !== 3 || p[0].length !== 2 || p[1].length !== 2 || p[2].length !== 4) return null;
  const iso = `${p[2]}-${p[1]}-${p[0]}`;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Data impossível (31/02) não pode rolar para o mês seguinte: confere ida e volta.
  const [y, m, dia] = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  if (y !== Number(p[2]) || m !== Number(p[1]) || dia !== Number(p[0])) return null;
  return iso;
}

// ── Helpers ──────────────────────────────────────────────────

/** Moeda completa (sem abreviar "k"), igual ao web. */
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

// ── Blocos reutilizáveis ─────────────────────────────────────

function Secao({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ marginHorizontal: 24, marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>{titulo}</Text>
        {extra}
      </View>
      <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <View style={{ padding: 20, alignItems: 'center' }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, textAlign: 'center' }}>{texto}</Text>
    </View>
  );
}

function CartaoKpi({ c }: { c: CartaoKpiRelatorio }) {
  return (
    <View style={{ width: '48%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 6 }}>{c.rotulo}</Text>
      <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: c.negativo ? C.red : C.text, letterSpacing: -0.5 }}>{c.valor}</SecretText>
      {c.sub && <SecretText style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginTop: 2 }}>{c.sub}</SecretText>}
      {c.delta !== null && (
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: c.delta >= 0 ? C.green : C.red, marginTop: 4 }}>
          {c.delta >= 0 ? '+' : ''}{c.delta}% {c.rotuloDelta}
        </Text>
      )}
    </View>
  );
}

/** Cartão simples (rótulo + valor) usado nas abas Clientes, Comissões e Avaliações. */
function CartaoSimples({ rotulo, valor, cor = C.text, secreto = true }: { rotulo: string; valor: string; cor?: string; secreto?: boolean }) {
  const estilo = { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: cor, letterSpacing: -0.5 } as const;
  return (
    <View style={{ width: '48%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 6 }}>{rotulo}</Text>
      {secreto ? <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={estilo}>{valor}</SecretText> : <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={estilo}>{valor}</Text>}
    </View>
  );
}

function LinhaRanking({ pos, nome, valor, detalhe, pct, extra, cor = C.accent, ultimo }: {
  pos: number; nome: string; valor: string; detalhe: string; pct: number; extra?: string; cor?: string; ultimo: boolean;
}) {
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: ultimo ? 0 : 1, borderBottomColor: C.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: pos <= 3 ? C.primary : C.text4, minWidth: 18 }}>{pos}</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>{nome}</Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>{detalhe}</Text>
        <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>{valor}</SecretText>
      </View>
      <View style={{ height: 3, backgroundColor: C.border, borderRadius: 2, marginTop: 6, marginLeft: 28 }}>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: cor, width: `${Math.min(pct, 100)}%` }} />
      </View>
      {extra && <SecretText style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 3, marginLeft: 28 }}>{extra}</SecretText>}
    </View>
  );
}

function GraficoBarras({ pontos }: { pontos: { rotulo: string; valor: number }[] }) {
  const { width } = useWindowDimensions();
  const W = width - 48 - 32;
  const H = 140, BASE = 18, TOPO = 8;
  const max = Math.max(...pontos.map(p => p.valor), 1);
  const passo = W / Math.max(pontos.length, 1);
  const barra = Math.max(passo * 0.6, 2);
  return (
    <Svg width={W} height={H}>
      {pontos.map((p, i) => {
        const h = (p.valor / max) * (H - BASE - TOPO);
        const x = i * passo + (passo - barra) / 2;
        return (
          <G key={`${p.rotulo}-${i}`}>
            <Rect x={x} y={H - BASE - h} width={barra} height={p.valor > 0 ? Math.max(h, 2) : 0} rx={3} fill={C.accent} />
            <SvgText x={x + barra / 2} y={H - 4} fontSize={9} fill={C.text3} textAnchor="middle">{p.rotulo}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

function CartaoComissoes({ p, rotuloPeriodo, onPagar, pagando, podePagar }: {
  p: ComissoesDaProfissional; rotuloPeriodo: string; onPagar: (p: ComissoesDaProfissional) => Promise<unknown>; pagando: boolean; podePagar: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  function confirmar() {
    Alert.alert('Confirmar pagamento', textoConfirmarPagamento(p.nome, formatarMoeda(p.pendente), rotuloPeriodo), [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Pagar', onPress: async () => {
        try {
          await onPagar(p);
          Alert.alert('Pronto', 'Comissões marcadas como pagas.');
        } catch (e) { Alert.alert('Não foi possível registrar o pagamento', (e as Error).message); }
      } },
    ]);
  }
  return (
    <View style={{ marginHorizontal: 24, marginBottom: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>{p.nome}</Text>
          <SecretText style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginTop: 2 }}>
            {formatarMoeda(p.pendente)} pendente · {formatarMoeda(p.pago)} pago
          </SecretText>
        </View>
        {podePagar && p.pendente > 0 && (
          <TouchableOpacity onPress={confirmar} disabled={pagando} style={{ backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, opacity: pagando ? 0.6 : 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' }}>Pagar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setAberto(a => !a)} accessibilityLabel={aberto ? 'Ocultar' : 'Detalhar'}>
          <View style={{ transform: [{ rotate: aberto ? '180deg' : '0deg' }] }}><ChevronDown size={16} color={C.text4} /></View>
        </TouchableOpacity>
      </View>
      {aberto && p.itens.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text }}>{c.clienteNome} · {c.servicoNome}</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
              {rotuloDataBR(chaveDiaBRT(c.dataAtendimento ?? c.criadaEm))} · {c.percentual}%
            </Text>
          </View>
          <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>{formatarMoeda(c.valorComissao)}</SecretText>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 8, textTransform: 'uppercase', color: c.status === 'pago' ? C.green : C.amber }}>
            {c.status === 'pago' ? 'Pago' : 'Pendente'}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Relatorios() {
  const insets = useSafeAreaInsets();
  const [periodo, setPeriodo] = useState<PeriodoRelatorio>('mes');
  const [semanaOffset, setSemanaOffset] = useState(0);   // só em 'semana'
  const [anoOffset, setAnoOffset] = useState(0);         // só em 'ano'
  const hoje = hojeBRT();
  const [customIniStr, setCustomIniStr] = useState(() => `01/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`);
  const [customFimStr, setCustomFimStr] = useState(() => `${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`);
  const opcoes = useMemo(() => ({
    semanaOffset,
    anoOffset,
    custom: { ini: paraIsoBR(customIniStr) ?? `${hoje.slice(0, 7)}-01`, fim: paraIsoBR(customFimStr) ?? hoje },
  }), [semanaOffset, anoOffset, customIniStr, customFimStr, hoje]);

  // Data completa (10 caracteres) mas inexistente: avisa e mantém o último intervalo válido.
  const dataCustomInvalida = periodo === 'custom'
    && ((customIniStr.length === 10 && !paraIsoBR(customIniStr)) || (customFimStr.length === 10 && !paraIsoBR(customFimStr)));

  const [aba, setAba] = useState<AbaRelatorio>('financeiro');
  const r = useRelatorios(periodo, opcoes, aba);
  const { resumo, clientes, servicos, profissionais, mesesComFechamento, atual, isLoading, isError, refetch } = r;
  const { pode } = usePermissoes();
  const podePagar = pode('comissoes.pagar');
  const rotuloAtual = rotuloDoPeriodo(periodo, atual);

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

  const notaFechamento = mesesComFechamento.length > 0 ? (
    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, padding: 12 }}>
      Período inclui mês com fechamento importado — detalhamentos mostram só os lançamentos ao vivo.
    </Text>
  ) : null;

  // Exportação: linha padrão da aba exibida (mesmos arrays que alimentam a tela; mesmas colunas do web).
  // Avaliações não exporta (web também não); some enquanto a aba carrega ou falha.
  const abaPronta = !isError && (aba === 'comissoes' ? r.comissoes.pronto : aba === 'estoque' ? r.insumosPronto && !!r.kpis : !!r.kpis);
  const definicaoExp = aba !== 'avaliacoes' && abaPronta
    ? definicaoRelatorio(aba, ABAS_RELATORIO.find(a => a.key === aba)?.label ?? '', rotuloAtual)
    : null;
  const linhasExportacao = (): unknown[] =>
    aba === 'servicos' ? servicos.map(s => ({ nome: s.nome, quantidade: s.quantidade, valor: s.receita })) :
    aba === 'equipe' ? profissionais.map(p => ({ nome: p.nome, quantidade: p.atendimentos, valor: p.faturamento, comissao: p.comissao })) :
    aba === 'clientes' ? r.topClientes.map(c => ({ nome: c.nome, quantidade: c.visitas, valor: c.total })) :
    aba === 'estoque' ? r.insumos.ranking.map(e => ({ nome: e.nome, quantidade: e.qtd, custo: e.custo })) :
    aba === 'comissoes' ? r.comissoes.porProfissional.flatMap(p => p.itens).map(c => ({ profissional: c.profissionalNome, dia: chaveDiaBRT(c.dataAtendimento ?? c.criadaEm), cliente: c.clienteNome, servico: c.servicoNome, valorAtendimento: c.valorAtendimento, percentual: c.percentual, comissao: c.valorComissao, pago: c.status === 'pago' })) :
    r.concluidos;

  const dFat    = resumo ? variacaoPercentual(resumo.faturamento, resumo.faturamentoAnterior) : null;

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
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <PrivacyToggle />
              {definicaoExp && (
              <View style={{
                width: 38, height: 38,
                backgroundColor: 'rgba(255,255,255,0.12)',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
                borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              }}>
                <BotaoExportar definicao={definicaoExp} getLinhas={linhasExportacao} cor="rgba(255,255,255,0.7)" />
              </View>
              )}
              </View>
            </View>

            {/* Seletor de período */}
            <SmoothTabs
              variant="pill"
              tabs={PERIODOS_RELATORIO}
              active={periodo}
              onChange={key => {
                setPeriodo(key as PeriodoRelatorio);
                if (key === 'semana') setSemanaOffset(0);
                if (key === 'ano') setAnoOffset(0);
              }}
              activeColor="#fff"
              activeTextColor={C.primary}
              inactiveTextColor="rgba(255,255,255,0.5)"
              trackBg="rgba(255,255,255,0.1)"
              trackBorder="rgba(255,255,255,0.1)"
              style={{ marginBottom: periodo === 'semana' || periodo === 'custom' || periodo === 'ano' ? 12 : 20 }}
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
            {dataCustomInvalida && (
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.rose, textAlign: 'center', marginTop: -12, marginBottom: 14 }}>
                Data inválida. Use uma data que exista (DD/MM/AAAA).
              </Text>
            )}

            {/* Navegação entre semanas — só no período "Semana" */}
            {periodo === 'semana' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 20 }}>
                <TouchableOpacity
                  onPress={() => setSemanaOffset(o => o - 1)}
                  style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <ChevronLeft size={14} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
                  {rotuloAtual}
                </Text>
                <TouchableOpacity
                  onPress={() => semanaOffset < 0 && setSemanaOffset(o => o + 1)}
                  disabled={semanaOffset >= 0}
                  style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', opacity: semanaOffset >= 0 ? 0.3 : 1 }}>
                  <ChevronRight size={14} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
              </View>
            )}

            {/* Navegação entre anos — só no período "Ano" */}
            {periodo === 'ano' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 20 }}>
                <TouchableOpacity
                  onPress={() => setAnoOffset(o => o - 1)}
                  style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <ChevronLeft size={14} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
                  {rotuloAtual}
                </Text>
                <TouchableOpacity
                  onPress={() => anoOffset < 0 && setAnoOffset(o => o + 1)}
                  disabled={anoOffset >= 0}
                  style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', opacity: anoOffset >= 0 ? 0.3 : 1 }}>
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
              <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 38, color: '#fff', letterSpacing: -1, lineHeight: 42, marginBottom: 8 }}>
                {resumo && !isError ? formatarMoeda(resumo.faturamento) : '—'}
              </SecretText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {dFat !== null && !isError && (<View style={{
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
                </View>)}
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                  {ROTULO_COMPARACAO[periodo]}
                </Text>
              </View>
            </View>
          </MotiView>
        </LinearGradient>

        {isError && (
          <View style={{ marginHorizontal: 24, marginTop: 16, backgroundColor: C.redSoft, borderWidth: 1, borderColor: C.red, borderRadius: 14, padding: 14 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.red, marginBottom: 6 }}>
              Não foi possível carregar os relatórios.
            </Text>
            <TouchableOpacity onPress={onRefresh}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.red, textDecorationLine: 'underline' }}>Tentar de novo</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Abas ── */}
        <SmoothTabs
          tabs={ABAS_RELATORIO}
          active={aba}
          onChange={k => setAba(k as AbaRelatorio)}
          activeColor={C.primary}
          trackBg={C.surface}
          trackBorder={C.border}
          inactiveTextColor={C.text3}
          style={{ marginHorizontal: 24, marginTop: 16, marginBottom: 16 }}
        />

        {/* Abas calculadas da carga principal: nada é desenhado com erro ou sem dados. */}
        {(aba === 'financeiro' || aba === 'servicos' || aba === 'equipe' || aba === 'clientes') && (!r.kpis || isError) && (
          <Vazio texto={isError ? 'Não foi possível carregar os dados desta aba.' : 'Carregando…'} />
        )}

        {/* ── Financeiro ── */}
        {aba === 'financeiro' && r.kpis && r.kpisAnt && !isError && (
          <>
            <View style={{ marginHorizontal: 24, marginBottom: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {cartoesKpiRelatorio(r.kpis, r.kpisAnt, { periodo, isOwner: r.isOwner, retiradasPeriodo: r.retiradasPeriodo, fmt: formatarMoeda })
                .filter(c => c.id !== 'bruto')
                .map(c => <CartaoKpi key={c.id} c={c} />)}
            </View>

            <Secao titulo="Evolução de faturamento">
              {r.serie.length === 0 || r.serie.every(p => p.valor === 0)
                ? <Vazio texto="Sem faturamento no período" />
                : <View style={{ padding: 16 }}><GraficoBarras pontos={r.serie} /></View>}
              {notaFechamento}
            </Secao>

            <Secao titulo="Resumo financeiro">
              <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                {linhasResumoFinanceiro(r.kpis, { isOwner: r.isOwner, retiradasPeriodo: r.retiradasPeriodo }).map(l => (
                  <View key={l.id}>
                    <View style={{
                      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      paddingVertical: 10, borderBottomWidth: l.tipo === 'resultado' ? 0 : 1, borderBottomColor: C.border,
                    }}>
                      <Text style={{
                        fontFamily: l.tipo === 'resultado' || l.tipo === 'total' ? 'PlusJakartaSans_700Bold' : 'PlusJakartaSans_500Medium',
                        fontSize: 12, color: l.tipo === 'resultado' || l.tipo === 'total' ? C.text : C.text2,
                      }}>{l.rotulo}</Text>
                      <SecretText style={{
                        fontFamily: l.tipo === 'resultado' ? 'PlusJakartaSans_700Bold' : 'PlusJakartaSans_600SemiBold',
                        fontSize: l.tipo === 'resultado' ? 15 : 12,
                        color: l.tipo === 'resultado' ? (l.valor >= 0 ? C.green : C.red) : l.tipo === 'saida' ? C.red : C.accent,
                      }}>{l.tipo === 'saida' && l.valor > 0 ? '− ' : ''}{formatarMoeda(l.valor)}</SecretText>
                    </View>
                    {l.id === 'bruto' && mesesComFechamento.length > 0 && (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, paddingVertical: 6 }}>
                        Inclui fechamento importado de {mesesComFechamento.join(', ')}.
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </Secao>

            <Secao titulo="Despesas por categoria">
              {r.despesasPorCategoria.length === 0
                ? <Vazio texto="Sem despesas no período" />
                : r.despesasPorCategoria.slice(0, 6).map((d, i, arr) => (
                  <LinhaRanking key={`${d.nome}-${i}`} pos={i + 1} nome={d.nome} valor={formatarMoeda(d.valor)} detalhe=""
                    pct={d.pct} cor={C.red} ultimo={i === arr.length - 1} />
                ))}
            </Secao>
          </>
        )}

        {/* ── Serviços ── */}
        {aba === 'servicos' && r.kpis && !isError && (
          <Secao titulo="Serviços por receita">
            {servicos.length === 0
              ? <Vazio texto="Sem atendimentos no período" />
              : servicos.map((s, i) => (
                <LinhaRanking key={s.servico_id} pos={i + 1} nome={s.nome} valor={formatarMoeda(s.receita)}
                  detalhe={`${s.quantidade} atend.`} pct={s.percentual}
                  extra={`Ticket médio: ${formatarMoeda(s.quantidade > 0 ? s.receita / s.quantidade : 0)}`}
                  ultimo={i === servicos.length - 1} />
              ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderTopWidth: 1, borderTopColor: C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>Total</Text>
              <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>
                {resumo ? formatarMoeda(resumo.faturamento) : '—'}
              </SecretText>
            </View>
            {notaFechamento}
          </Secao>
        )}

        {/* ── Equipe ── */}
        {aba === 'equipe' && r.kpis && !isError && (
          <Secao titulo="Equipe">
            {profissionais.length === 0
              ? <Vazio texto="Sem dados no período" />
              : profissionais.map((p, i) => (
                <View key={p.profissional_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16 }}>
                  <Avatar nome={p.nome} index={i} />
                  <View style={{ flex: 1 }}>
                    <LinhaRanking pos={i + 1} nome={p.nome} valor={formatarMoeda(p.faturamento)}
                      detalhe={`${p.atendimentos} atend.`} pct={p.percentual}
                      extra={p.comissao > 0 ? `Comissão ${formatarMoeda(p.comissao)}` : undefined}
                      ultimo={i === profissionais.length - 1} />
                  </View>
                </View>
              ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderTopWidth: 1, borderTopColor: C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>Total comissões no período</Text>
              <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>{formatarMoeda(r.kpis.comissoes)}</SecretText>
            </View>
            {notaFechamento}
          </Secao>
        )}

        {/* ── Clientes ── */}
        {aba === 'clientes' && r.kpis && !isError && (
          <>
            <View style={{ marginHorizontal: 24, marginBottom: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <CartaoSimples rotulo="Novas" valor={String(clientes?.novos ?? 0)} secreto={false} />
              <CartaoSimples rotulo="Retornaram" valor={String(clientes?.retornaram ?? 0)} secreto={false} />
              <CartaoSimples rotulo="Sumidas +60d" valor={clientes?.sumidos == null ? '—' : String(clientes.sumidos)} secreto={false} />
              <CartaoSimples rotulo="Total atendidas" valor={String(clientes?.totalAtendidas ?? 0)} secreto={false} />
              <CartaoSimples rotulo="Taxa retorno" valor={clientes && clientes.totalAtendidas > 0 ? `${clientes.pctRetorno}%` : '—'} secreto={false} />
            </View>
            <Secao titulo="Top clientes">
              {r.topClientes.length === 0
                ? <Vazio texto="Sem atendimentos no período" />
                : r.topClientes.map((c, i) => (
                  <LinhaRanking key={c.cliente_id} pos={i + 1} nome={c.nome} valor={formatarMoeda(c.total)}
                    detalhe={`${c.visitas} ${c.visitas === 1 ? 'visita' : 'visitas'}`} pct={c.percentual} cor={C.rose}
                    ultimo={i === r.topClientes.length - 1} />
                ))}
            </Secao>
          </>
        )}

        {/* ── Estoque ── */}
        {aba === 'estoque' && (
          r.insumosErro || isError
            ? <Vazio texto="Não foi possível carregar o estoque." />
            : !r.insumosPronto || !r.kpis
              ? <Vazio texto="Carregando…" />
              : r.insumos.ranking.length === 0
                ? <Vazio texto="Sem saídas de estoque registradas no período" />
                : (
                  <Secao titulo="Insumos consumidos"
                    extra={<SecretText style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3 }}>Custo total: {formatarMoeda(r.insumos.custoTotal)}</SecretText>}>
                    {r.insumos.ranking.map((e, i) => (
                      <LinhaRanking key={e.produtoId} pos={i + 1} nome={e.nome} valor={formatarMoeda(e.custo)}
                        detalhe={`${e.qtd % 1 === 0 ? e.qtd : e.qtd.toFixed(2)} un.`} pct={e.pct} cor={C.green}
                        ultimo={i === r.insumos.ranking.length - 1} />
                    ))}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderTopWidth: 1, borderTopColor: C.border }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>Custo médio / atendimento</Text>
                      <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>
                        {r.insumos.custoMedioPorAtendimento == null ? '—' : formatarMoeda(r.insumos.custoMedioPorAtendimento)}
                      </SecretText>
                    </View>
                  </Secao>
                )
        )}

        {/* ── Comissões ── */}
        {aba === 'comissoes' && (
          r.comissoes.isError || isError
            ? <Vazio texto="Não foi possível carregar as comissões." />
            : !r.comissoes.pronto
              ? <Vazio texto="Carregando…" />
              : (
                <>
                  <View style={{ marginHorizontal: 24, marginBottom: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <CartaoSimples rotulo="A pagar" valor={formatarMoeda(r.comissoes.resumo.pendente)} cor={C.amber} />
                    <CartaoSimples rotulo="Já pago" valor={formatarMoeda(r.comissoes.resumo.pago)} cor={C.green} />
                    <CartaoSimples rotulo="Comissões no período" valor={String(r.comissoes.resumo.quantidade)} secreto={false} />
                  </View>
                  {r.comissoes.porProfissional.length === 0
                    ? <Vazio texto="Sem comissões no período" />
                    : r.comissoes.porProfissional.map(p => (
                      <CartaoComissoes key={p.profissionalId} p={p} rotuloPeriodo={rotuloAtual} podePagar={podePagar}
                        onPagar={x => r.pagarComissoes(x.idsPendentes)} pagando={r.pagando} />
                    ))}
                </>
              )
        )}

        {/* ── Avaliações ── */}
        {aba === 'avaliacoes' && (
          r.avaliacoesErro || isError
            ? <Vazio texto="Não foi possível carregar as avaliações." />
            : !r.avaliacoesPronto
              ? <Vazio texto="Carregando…" />
              : r.avaliacoes.total === 0
                ? <Vazio texto="Nenhuma avaliação registrada neste período." />
                : (
                  <>
                    <View style={{ marginHorizontal: 24, marginBottom: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <CartaoSimples rotulo="Nota média" valor={r.avaliacoes.notaMedia != null ? r.avaliacoes.notaMedia.toFixed(1) : '—'} secreto={false} />
                      <CartaoSimples rotulo="Profissionais avaliados" valor={String(r.avaliacoes.ranking.length)} secreto={false} />
                      <CartaoSimples rotulo="Com nota 5" valor={r.avaliacoes.pctNota5 != null ? `${r.avaliacoes.pctNota5}%` : '—'} secreto={false} />
                    </View>
                    <Secao titulo="Nota média por profissional">
                      {r.avaliacoes.ranking.map((p, i, arr) => (
                        <View key={`${p.nome}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: C.border }}>
                          <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>{p.nome}</Text>
                          <Star size={12} color={C.amber} fill={C.amber} />
                          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>{p.media.toFixed(1)}</Text>
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>({p.qtd})</Text>
                        </View>
                      ))}
                    </Secao>
                    <Secao titulo="Avaliações recentes">
                      {r.avaliacoesRecentes.map((av, i, arr) => (
                        <View key={i} style={{ padding: 14, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: C.border }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
                              {av.cliente?.nome ?? 'Cliente'}{av.profissional?.user?.nome ? ` · ${av.profissional.user.nome}` : ''}
                            </Text>
                            <Star size={11} color={C.amber} fill={C.amber} />
                            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>{av.nota}</Text>
                          </View>
                          {av.comentario ? (
                            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text2, marginTop: 4 }}>“{av.comentario}”</Text>
                          ) : null}
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 4 }}>
                            {rotuloDataBR(chaveDiaBRT(av.created_at))}
                          </Text>
                        </View>
                      ))}
                    </Secao>
                  </>
                )
        )}

      </ScrollView>
    </View>
  );
}
