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
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { addMonths, subMonths, format, isSameMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import {
  useComissoesGestor,
  type ProfissionalComissao,
} from '@/hooks/useComissoesGestor';
import { CategoriaIcon, CATEGORIA_COR, CATEGORIA_BG } from '@/components/CategoriaIcon';
import type { CategoriaServico } from '@/components/CategoriaIcon';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#E879A0'],
  ['#0891B2', '#22D3EE'], ['#0D7E5F', '#10B981'],
  ['#B45309', '#F59E0B'],
];

type Filtro = 'todas' | 'pendentes' | 'pagas';

// ── Helpers ──────────────────────────────────────────────────

function formatBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function initials(nome: string) {
  return nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

// ── Card do profissional ──────────────────────────────────────

function ProfCard({
  item, index, filtro, onPagar,
}: {
  item: ProfissionalComissao;
  index: number;
  filtro: Filtro;
  onPagar: () => void;
}) {
  const [from, to] = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const comissoes = filtro === 'pendentes'
    ? item.comissoes.filter((c) => c.status === 'pendente')
    : filtro === 'pagas'
    ? item.comissoes.filter((c) => c.status === 'pago')
    : item.comissoes;

  if (comissoes.length === 0) return null;

  const temPendente = item.totalPendente > 0;

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
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, marginBottom: 2 }}>
            {item.nome}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
            {item.percentual}% de comissão
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.text, letterSpacing: -0.3 }}>
            {formatBRL(item.total)}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 2 }}>
            {item.totalAtendimentos} atend.
          </Text>
        </View>
      </View>

      {/* Lista de comissões */}
      {comissoes.map((c, i) => {
        const cat = (c.categoria ?? 'outros') as CategoriaServico;
        const cor = CATEGORIA_COR[cat] ?? C.text3;
        const bg  = CATEGORIA_BG[cat]  ?? C.primarySoft;
        return (
          <View
            key={c.id}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingHorizontal: 14, paddingVertical: 11,
              borderBottomWidth: i < comissoes.length - 1 ? 1 : 0, borderBottomColor: C.border,
            }}
          >
            <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <CategoriaIcon categoria={cat} size={16} color={cor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text, marginBottom: 1 }}>
                {c.servico_nome}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
                {formatBRL(c.valor_servico)} × {c.percentual}% = {formatBRL(c.valor_comissao)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>
                {formatBRL(c.valor_comissao)}
              </Text>
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

      {/* Footer com ação */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, backgroundColor: '#FAFAF9', borderTopWidth: 1, borderTopColor: C.border }}>
        <View>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>
            {temPendente ? 'Pendente para repassar' : 'Tudo repassado'}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: temPendente ? C.amber : C.green }}>
            {formatBRL(temPendente ? item.totalPendente : item.totalPago)}
          </Text>
        </View>

        {temPendente ? (
          <TouchableOpacity
            onPress={onPagar}
            style={{ backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 5 }}
          >
            <Banknote size={13} color="#fff" strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Pagar</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ backgroundColor: C.greenSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <CircleCheck size={13} color={C.green} strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.green }}>Pago</Text>
          </View>
        )}
      </View>
    </MotiView>
  );
}

// ── Modal confirmação ─────────────────────────────────────────

function ModalPagamento({
  profissional, onClose, onConfirmar,
}: {
  profissional: ProfissionalComissao | null;
  onClose: () => void;
  onConfirmar: () => void;
}) {
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    setSalvando(true);
    await onConfirmar();
    setSalvando(false);
    onClose();
  }

  return (
    <Modal visible={!!profissional} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', alignItems: 'center' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, width: 390 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>Confirmar pagamento</Text>
            <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 22, color: C.text, marginBottom: 20 }}>
              {profissional?.nome}
            </Text>
            <View style={{ backgroundColor: C.amberSoft, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 24 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.amber, marginBottom: 4 }}>Total a repassar</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 32, color: C.amber, letterSpacing: -1 }}>
                {formatBRL(profissional?.totalPendente ?? 0)}
              </Text>
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
  const [mesRef, setMesRef] = useState(new Date());
  const isHoje = isSameMonth(mesRef, new Date());
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [pagando, setPagando] = useState<ProfissionalComissao | null>(null);

  const { profissionais, resumo, isLoading, refetch, marcarPago } = useComissoesGestor(mesRef);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  const filtros: { key: Filtro; label: string }[] = [
    { key: 'todas',     label: 'Todas'     },
    { key: 'pendentes', label: 'Pendentes' },
    { key: 'pagas',     label: 'Pagas'     },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => refetch()} tintColor={C.accent} />}
      >
        {/* Header */}
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350 }}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16 }}
        >
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Equipe</Text>
          <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 26, color: C.text }}>Comissões</Text>
        </MotiView>

        {/* Seletor de mês */}
        <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ marginHorizontal: 24, marginBottom: 16 }}
        >
          <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
            <TouchableOpacity onPress={() => setMesRef((m) => subMonths(m, 1))} style={{ width: 28, height: 28, borderRadius: 8, border: 1, borderColor: C.border, background: C.bg, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                {format(mesRef, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
              </Text>
            </View>
            <TouchableOpacity onPress={() => !isHoje && setMesRef((m) => addMonths(m, 1))} style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', opacity: isHoje ? 0.3 : 1 }}>
              <ChevronRight size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </MotiView>

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
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.5, lineHeight: 20 }}>
                {formatBRL(s.val)}
              </Text>
            </View>
          ))}
        </MotiView>

        {/* Filtros */}
        <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 24, marginBottom: 16 }}>
          {filtros.map(({ key, label }) => (
            <TouchableOpacity key={key} onPress={() => setFiltro(key)} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: filtro === key ? C.primary : C.surface, borderWidth: 1, borderColor: filtro === key ? C.primary : C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: filtro === key ? '#fff' : C.text3 }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cards */}
        {profissionais.length === 0
          ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 20, color: C.text3 }}>Sem comissões</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, marginTop: 6 }}>Nenhum atendimento concluído no período.</Text>
            </View>
          )
          : profissionais.map((p, i) => (
            <ProfCard
              key={p.profissional_id}
              item={p}
              index={i}
              filtro={filtro}
              onPagar={() => setPagando(p)}
            />
          ))
        }
      </ScrollView>

      <ModalPagamento
        profissional={pagando}
        onClose={() => setPagando(null)}
        onConfirmar={() => {
          if (pagando) return marcarPago(pagando.profissional_id);
          return Promise.resolve();
        }}
      />
    </View>
  );
}
