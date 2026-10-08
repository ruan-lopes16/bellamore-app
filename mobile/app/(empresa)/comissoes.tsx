import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, Alert, Modal,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, ChevronRight, Banknote, CircleCheck } from 'lucide-react-native';
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

import { router } from 'expo-router';
import { usePermissoes } from '@/lib/permissions';
import { useComissoesGestor } from '@/hooks/useComissoesGestor';
import { CategoriaIcon, CategoriaIconCustom } from '@/components/CategoriaIcon';
import { SmoothTabs } from '@/components/SmoothTabs';
import { PERIODOS_COMISSAO, rotuloPeriodoComissao, horaBRT, chaveDiaBRT, type PeriodoComissao } from '@shared/periodos';
import {
  FILTROS_COMISSAO, filtrarComissoes, agruparComissoesPorData, rotuloPercentualComissao,
  type ComissoesDaProfissional, type FiltroComissao,
} from '@shared/comissoes';
import { resolverCategoriaServico, type CategoriaCustom, type CategoriaServico } from '@shared/categorias';
import { SecretText, PrivacyToggle } from '@/components/Secret';
import { BotaoExportar } from '@/components/BotaoExportar';
import { definicaoComissoes } from '@shared/exportacao/comissoes';
import { formatarMoeda } from '@shared/moeda';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#E879A0'],
  ['#0891B2', '#22D3EE'], ['#0D7E5F', '#10B981'],
  ['#B45309', '#F59E0B'],
];

// ── Helpers ──────────────────────────────────────────────────

function initials(nome: string) {
  return nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

// ── Card do profissional ──────────────────────────────────────

function ProfCard({
  item, index, filtro, periodo, categorias, onPagar, podePagar,
}: {
  item: ComissoesDaProfissional;
  index: number;
  filtro: FiltroComissao;
  periodo: PeriodoComissao;
  categorias: CategoriaCustom[];
  onPagar: () => void;
  /** `comissoes.pagar` — o banco exige essa chave no UPDATE de `comissoes`. */
  podePagar: boolean;
}) {
  const [from, to] = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const grupos = agruparComissoesPorData(filtrarComissoes(item.itens, filtro), periodo);

  if (grupos.length === 0) return null;

  const temPendente = item.pendente > 0;

  return (
    <MotiView
      from={{ opacity: 0, translateY: 6 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 380, delay: index * 60 }}
      style={{
        backgroundColor: C.surface,
        borderWidth: 1, borderColor: C.border, borderRadius: 18,
        marginHorizontal: 24, marginBottom: 12, overflow: 'hidden',
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}
    >
      {/* Header do profissional */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <LinearGradient colors={[from, to]} style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
            {initials(item.nome)}
          </Text>
        </LinearGradient>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, marginBottom: 2 }} numberOfLines={1}>
            {item.nome}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }} numberOfLines={1}>
            {`${rotuloPercentualComissao(item.percentual)} de comissão · ${item.atendimentos} atend.`}
          </Text>
        </View>

        {/* Pagar — visível direto no cabeçalho, sem precisar rolar até o rodapé */}
        {temPendente ? (podePagar ? (
          <TouchableOpacity
            onPress={onPagar}
            style={{ backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}
          >
            <Banknote size={12} color="#fff" strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' }}>Pagar</Text>
          </TouchableOpacity>
        ) : null) : (
          <View style={{ backgroundColor: C.greenSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <CircleCheck size={12} color={C.green} strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.green }}>Pago</Text>
          </View>
        )}
      </View>

      {/* Lista de comissões, agrupada por data */}
      {grupos.map((g) => (
        <View key={g.chave}>
          {periodo !== 'dia' && (
            <View style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: '#FAFAF9', borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: C.text3, letterSpacing: 1, textTransform: 'uppercase' }}>
                {g.rotulo}
              </Text>
            </View>
          )}
          {g.itens.map((c, i) => {
            const r = resolverCategoriaServico(c.servicoCategoria, c.servicoCategoriaId, categorias);
            return (
              <View
                key={c.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingHorizontal: 14, paddingVertical: 11,
                  borderBottomWidth: i < g.itens.length - 1 ? 1 : 0, borderBottomColor: C.border,
                }}
              >
                <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: r.bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {r.iconeCustom
                    ? <CategoriaIconCustom name={r.iconeCustom} size={16} color={r.cor} />
                    : <CategoriaIcon categoria={(r.iconeBuiltin ?? 'outros') as CategoriaServico} size={16} color={r.cor} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text, marginBottom: 1 }}>
                    {c.servicoNome}
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
                    <SecretText>{formatarMoeda(c.valorServico)} × {c.percentual}% = {formatarMoeda(c.valorComissao)}</SecretText>
                    {c.dataAtendimento ? ' · ' + horaBRT(c.dataAtendimento) : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>
                    {formatarMoeda(c.valorComissao)}
                  </SecretText>
                  <View style={{
                    marginTop: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                    backgroundColor: c.status === 'pago' ? C.greenSoft : C.amberSoft,
                  }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 8, textTransform: 'uppercase', color: c.status === 'pago' ? C.green : C.amber }}>
                      {c.status === 'pago' ? 'Pago' : 'Pendente'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ))}

      {/* Footer com ação */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, backgroundColor: '#FAFAF9', borderTopWidth: 1, borderTopColor: C.border }}>
        <View>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>
            {temPendente ? 'Pendente para repassar' : 'Tudo repassado'}
          </Text>
          <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: temPendente ? C.amber : C.green }}>
            {formatarMoeda(temPendente ? item.pendente : item.pago)}
          </SecretText>
        </View>
      </View>
    </MotiView>
  );
}

// ── Modal confirmação ─────────────────────────────────────────

function ModalPagamento({
  profissional, rotuloPeriodo, onClose, onConfirmar,
}: {
  profissional: ComissoesDaProfissional | null;
  rotuloPeriodo: string;
  onClose: () => void;
  onConfirmar: () => Promise<unknown>;
}) {
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    setSalvando(true);
    try {
      await onConfirmar();
      onClose();
    } catch (e) {
      Alert.alert('Não foi possível registrar o pagamento', (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal visible={!!profissional} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', alignItems: 'center' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, width: 390 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>Confirmar pagamento</Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text, marginBottom: 20 }}>
              {profissional?.nome}
            </Text>
            <View style={{ backgroundColor: C.amberSoft, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 24 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.amber, marginBottom: 4 }}>Pendentes de {rotuloPeriodo}</Text>
              <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 32, color: C.amber, letterSpacing: -1 }}>
                {formatarMoeda(profissional?.pendente ?? 0)}
              </SecretText>
            </View>
            <TouchableOpacity onPress={confirmar} disabled={salvando} style={{ backgroundColor: C.green, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.7 : 1 }}>
              {salvando
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>Confirmar pagamento</Text>
              }
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Comissoes() {
  const insets = useSafeAreaInsets();
  const [periodo, setPeriodo] = useState<PeriodoComissao>('mes');
  const [deslocamento, setDeslocamento] = useState(0);
  const [filtro, setFiltro] = useState<FiltroComissao>('todas');
  const [pagandoId, setPagandoId] = useState<string | null>(null);

  // Trava de permissão dentro da tela (a rota também é alcançável pela Equipe ou por deep link).
  const { pode } = usePermissoes();
  const podeVer = pode('comissoes.ver_todas');
  const podePagar = pode('comissoes.pagar');

  const { limites, profissionais, resumo, categorias, pronto, isFetching, isError, erro, refetch, pagar } =
    useComissoesGestor(periodo, deslocamento, podeVer);
  // Modal derivado da lista atual: reflete o valor depois do refetch.
  const pagando = profissionais.find((x) => x.profissionalId === pagandoId && x.pendente > 0) ?? null;
  const setPagando = (x: ComissoesDaProfissional | null) => setPagandoId(x?.profissionalId ?? null);
  const rotulo = rotuloPeriodoComissao(periodo, limites);
  const podeAvancar = deslocamento < 0;

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  if (!podeVer) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text3, textAlign: 'center' }}>
          Sem permissão para ver as comissões da equipe
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => refetch()} tintColor={C.accent} />}
      >
        {/* Header */}
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350 }}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16 }}
        >
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Equipe</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text }}>Comissões</Text><PrivacyToggle color={C.text2} bg={C.surface} borderColor={C.border} size={34} /><BotaoExportar
            definicao={pronto && !isError ? definicaoComissoes(rotulo) : null}
            getLinhas={() => profissionais.flatMap((p) => p.itens).map((c) => ({ profissional: c.profissionalNome, dia: chaveDiaBRT(c.dataAtendimento ?? c.criadaEm), servico: c.servicoNome, valorServico: c.valorServico, percentual: c.percentual, comissao: c.valorComissao, pago: c.status === 'pago' }))}
            cor={C.text2}
          /></View>
        </MotiView>

        {/* Período */}
        <SmoothTabs
          tabs={PERIODOS_COMISSAO}
          active={periodo}
          onChange={(k) => { setPeriodo(k as PeriodoComissao); setDeslocamento(0); }}
          activeColor={C.primary} trackBg={C.surface} trackBorder={C.border} inactiveTextColor={C.text3}
          style={{ marginHorizontal: 24, marginBottom: 12 }}
        />

        {/* Navegação do período (nunca o futuro) */}
        <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ marginHorizontal: 24, marginBottom: 16 }}
        >
          <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
            <TouchableOpacity onPress={() => setDeslocamento((d) => d - 1)} style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                {rotulo}
              </Text>
            </View>
            <TouchableOpacity onPress={() => podeAvancar && setDeslocamento((d) => d + 1)} disabled={!podeAvancar} style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', opacity: podeAvancar ? 1 : 0.3 }}>
              <ChevronRight size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </MotiView>

        {/* Erro ao carregar: nunca mostrar zeros no lugar dos números */}
        {isError && (
          <TouchableOpacity
            onPress={() => refetch()}
            activeOpacity={0.8}
            style={{ marginHorizontal: 24, marginBottom: 12, backgroundColor: C.roseSoft, borderWidth: 1, borderColor: C.rose, borderRadius: 14, padding: 12 }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.rose, marginBottom: 2 }}>
              Não foi possível carregar as comissões
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text2 }}>
              {erro?.message ?? 'Falha ao buscar os dados'} · Toque para tentar de novo
            </Text>
          </TouchableOpacity>
        )}

        {/* Resumo */}
        <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 80 }}
          style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginBottom: 16 }}
        >
          {[
            { label: 'Total', val: resumo.total,    color: C.primary },
            { label: 'Pendente', val: resumo.pendente, color: C.amber   },
            { label: 'Pago',    val: resumo.pago,    color: C.green   },
          ].map((s) => (
            <View key={s.label} style={{ flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</Text>
              <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.5, lineHeight: 20 }}>
                {pronto ? formatarMoeda(s.val) : '—'}
              </SecretText>
            </View>
          ))}
        </MotiView>

        {/* Filtros */}
        <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 24, marginBottom: 16 }}>
          {FILTROS_COMISSAO.map(({ key, label }) => (
            <TouchableOpacity key={key} onPress={() => setFiltro(key)} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: filtro === key ? C.primary : C.surface, borderWidth: 1, borderColor: filtro === key ? C.primary : C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: filtro === key ? '#fff' : C.text3 }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cards */}
        {pronto && profissionais.length === 0
          ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text3 }}>Sem comissões</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, marginTop: 6 }}>Nenhuma comissão neste período.</Text>
            </View>
          )
          : !pronto ? null : profissionais.map((p, i) => (
            <ProfCard
              key={p.profissionalId}
              item={p}
              index={i}
              filtro={filtro}
              periodo={periodo}
              categorias={categorias}
              onPagar={() => setPagando(p)}
              podePagar={podePagar}
            />
          ))
        }
      </ScrollView>

      <ModalPagamento
        profissional={pagando}
        rotuloPeriodo={rotulo}
        onClose={() => setPagando(null)}
        onConfirmar={async () => {
          if (!pagando) return;
          await pagar(pagando);
          Alert.alert('Comissões pagas', 'O pagamento foi registrado.');
        }}
      />
    </View>
  );
}
