import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StatusBar, Alert, Switch, RefreshControl, Modal, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Plus, Edit3, Trash2, X, CalendarPlus } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
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
import { supabase } from '@/lib/supabase';
import {
  usePacotes, usePacotesVendidos,
  type PacoteComServicos, type PacoteVendido,
} from '@/hooks/usePacotes';
import { SmoothTabs } from '@/components/SmoothTabs';
import { CategoriaIcon } from '@/components/CategoriaIcon';
import { resolverCategoria } from '@/hooks/useAgenda';
import type { CategoriaServico } from '@/components/CategoriaIcon';

// ── Constantes ────────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: '#F1EAFB',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const VSTATUS: Record<string, { label: string; bg: string; color: string }> = {
  ativo:     { label: 'Ativo',     bg: C.greenSoft,   color: C.green   },
  concluido: { label: 'Concluído', bg: C.primarySoft, color: C.primary },
  expirado:  { label: 'Expirado',  bg: C.redSoft,     color: C.red     },
  cancelado: { label: 'Cancelado', bg: C.bg,          color: C.text3   },
};

// ── Helpers ──────────────────────────────────────────────────

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}
function fmtData(d: string | null) {
  if (!d) return 'Sem validade';
  try { return format(parseISO(d), 'dd/MM/yyyy'); } catch { return '—'; }
}
function mascaraData(v: string) {
  const n = v.replace(/\D/g, '').slice(0, 8);
  if (n.length <= 2) return n;
  if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
}
function dataParaBanco(v: string): string | null {
  const p = v.split('/');
  if (p.length !== 3 || p[2].length !== 4) return null;
  return `${p[2]}-${p[1]}-${p[0]}`;
}
function hojeMascara() {
  return format(new Date(), 'dd/MM/yyyy');
}

const inputSt = {
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10,
  paddingHorizontal: 12, height: 42, fontFamily: 'PlusJakartaSans_500Medium' as const,
  fontSize: 14, color: C.text,
};

// ── Card de pacote (catálogo) ────────────────────────────────

function PacoteCard({ pacote, onToggle, onEdit }: {
  pacote: PacoteComServicos;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const totalSessoes = pacote.pacote_servicos.reduce((s, ps) => s + ps.quantidade, 0);
  const subtitle = `${totalSessoes} ${totalSessoes === 1 ? 'aplicação' : 'aplicações'} · válido por ${pacote.validade_dias} dias`;
  const tagsVisiveis = pacote.pacote_servicos.slice(0, 3);
  const overflow = pacote.pacote_servicos.length - 3;

  return (
    <MotiView
      from={{ opacity: 0, translateY: 4 }}
      animate={{ opacity: pacote.ativo ? 1 : 0.55, translateY: 0 }}
      transition={{ type: 'timing', duration: 280 }}
      style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 14, padding: 14, marginBottom: 8,
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}
    >
      {/* Nome + toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 2 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
            {pacote.nome}
          </Text>
        </View>
        <Switch
          value={pacote.ativo}
          onValueChange={onToggle}
          trackColor={{ false: '#E5E7EB', true: C.green }}
          thumbColor="#fff"
          style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
        />
      </View>

      {/* Validade / sessões */}
      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, marginBottom: 10 }}>
        {subtitle}
      </Text>

      {/* Tags de serviços */}
      {tagsVisiveis.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {tagsVisiveis.map(({ servico }) => {
            const cat = resolverCategoria(servico.categoria ?? 'outros') as CategoriaServico;
            return (
              <View
                key={servico.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: C.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
                }}
              >
                <CategoriaIcon categoria={cat} size={10} color={C.accent} />
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text2 }} numberOfLines={1}>
                  {servico.nome}
                </Text>
              </View>
            );
          })}
          {overflow > 0 && (
            <View style={{ backgroundColor: C.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>
                +{overflow}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Preço + editar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{
          fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18,
          color: pacote.ativo ? C.primary : C.text3, letterSpacing: -0.5,
        }}>
          {fmtBRL(pacote.preco)}
        </Text>
        <TouchableOpacity
          onPress={onEdit}
          style={{
            width: 30, height: 30, borderRadius: 8,
            backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Edit3 size={13} color={C.text3} strokeWidth={2} />
        </TouchableOpacity>
      </View>
    </MotiView>
  );
}

// ── Card de pacote vendido ──────────────────────────────────

function VendidoCard({ v, onGerenciar, onExcluir, onMarcarUtilizado }: {
  v: PacoteVendido;
  onGerenciar: () => void;
  onExcluir: () => void;
  onMarcarUtilizado: () => void;
}) {
  const ilimitado = v.total_sessoes === null;
  const pct = v.total_sessoes != null && v.total_sessoes > 0 ? (v.usadas / v.total_sessoes) * 100 : 0;
  const restantes = v.total_sessoes != null ? v.total_sessoes - v.usadas : null;
  const corBarra = pct >= 100 ? '#16A34A' : pct >= 70 ? '#D97706' : '#7C3AED';
  const st = VSTATUS[v.status] ?? VSTATUS.cancelado;

  return (
    <View style={{
      backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
      borderRadius: 14, padding: 14, marginBottom: 10,
      shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>
            {v.cliente.nome}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, marginTop: 1 }}>
            {v.pacote.nome}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ backgroundColor: st.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: st.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {st.label}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onExcluir}
            style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={12} color={C.text3} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Combo: lista de serviços · Sessões: progresso */}
      {!v.pacote.controla_sessoes ? (
        <View style={{ marginBottom: 12 }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 6 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: C.accent, textTransform: 'uppercase' }}>Combo</Text>
          </View>
          {v.pacote.servicos.length === 0 ? (
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>Nenhum serviço vinculado</Text>
          ) : v.pacote.servicos.map((s) => (
            <View key={s.servico_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent }} />
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text2 }}>{s.nome}</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text4 }}>{s.quantidade ?? '∞'}×</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: C.text }}>
              {v.usadas}
              <Text style={{ fontSize: 14, color: C.text3 }}>/{ilimitado ? '∞' : v.total_sessoes}</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3 }}>  sessões</Text>
            </Text>
            {ilimitado && v.status === 'ativo' ? (
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.primary }}>Ilimitado</Text>
            ) : restantes !== null && restantes > 0 && v.status === 'ativo' ? (
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3 }}>
                {restantes} restante{restantes !== 1 ? 's' : ''}
              </Text>
            ) : !ilimitado && pct >= 100 ? (
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.green }}>Concluído</Text>
            ) : null}
          </View>
          {ilimitado ? (
            <View style={{ height: 8, borderRadius: 999, backgroundColor: C.primarySoft }} />
          ) : (
            <View style={{ height: 8, borderRadius: 999, backgroundColor: C.bg, overflow: 'hidden' }}>
              <View style={{ height: 8, borderRadius: 999, width: `${Math.min(pct, 100)}%`, backgroundColor: corBarra }} />
            </View>
          )}
        </View>
      )}

      {/* Datas + valor */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>Válido até</Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{fmtData(v.data_validade)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>Valor pago</Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{v.valor_pago ? fmtBRL(v.valor_pago) : '—'}</Text>
        </View>
      </View>

      {/* Ações */}
      {v.pacote.controla_sessoes ? (
        <>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4, textAlign: 'center', marginBottom: 6 }}>
            Sessões entram sozinhas ao concluir agendamentos.
          </Text>
          <TouchableOpacity
            onPress={onGerenciar}
            style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Gerenciar sessões</Text>
          </TouchableOpacity>
        </>
      ) : v.status === 'ativo' ? (
        <TouchableOpacity
          onPress={onMarcarUtilizado}
          style={{ height: 38, borderRadius: 10, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Marcar como utilizado</Text>
        </TouchableOpacity>
      ) : null}

      {v.observacao ? (
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, fontStyle: 'italic', marginTop: 8 }}>
          "{v.observacao}"
        </Text>
      ) : null}
    </View>
  );
}

// ── Modal: gerenciar sessões de um pacote vendido ───────────

type UsoRow = {
  id: string;
  servico_id: string | null;
  agendamento_id: string | null;
  observacao: string | null;
  created_at: string;
  servico?: { nome: string } | null;
};
type AgConcluido = {
  id: string;
  data_hora_inicio: string;
  servico_id: string | null;
  servico?: { nome: string } | null;
};

function SessoesModal({ pc, empresaId, onClose, onChanged }: {
  pc: PacoteVendido;
  empresaId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const insets = useSafeAreaInsets();
  const servicosPac = pc.pacote.servicos;
  const servUnicoId = servicosPac.length === 1 ? servicosPac[0].servico_id : '';
  const multi = servicosPac.length > 1;

  const [sessoes, setSessoes] = useState<UsoRow[]>([]);
  const [candidatos, setCandidatos] = useState<AgConcluido[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);

  // adicionar avulsa
  const [addOpen, setAddOpen] = useState(false);
  const [novoServ, setNovoServ] = useState(servUnicoId);
  const [novaData, setNovaData] = useState(hojeMascara());
  const [novaObs, setNovaObs] = useState('');

  // vincular atendimento
  const [vincOpen, setVincOpen] = useState(false);
  const [vincAg, setVincAg] = useState('');

  // edição de sessão
  const [editId, setEditId] = useState<string | null>(null);
  const [edServ, setEdServ] = useState('');
  const [edData, setEdData] = useState('');
  const [edObs, setEdObs] = useState('');

  async function carregar() {
    setLoading(true); setErro('');
    const [rUso, rAg, rLink] = await Promise.all([
      supabase.from('pacote_uso')
        .select('id, servico_id, agendamento_id, observacao, created_at, servico:servicos(nome)')
        .eq('pacote_cliente_id', pc.id).order('created_at', { ascending: false }),
      supabase.from('agendamentos')
        .select('id, data_hora_inicio, servico_id, servico:servicos(nome)')
        .eq('empresa_id', empresaId).eq('cliente_id', pc.cliente.id).eq('status', 'concluido')
        .order('data_hora_inicio', { ascending: false }).limit(100),
      supabase.from('pacote_uso').select('agendamento_id')
        .eq('empresa_id', empresaId).not('agendamento_id', 'is', null),
    ]);
    setSessoes((rUso.data ?? []) as unknown as UsoRow[]);
    const linkados = new Set(((rLink.data ?? []) as { agendamento_id: string }[]).map((x) => x.agendamento_id));
    setCandidatos(((rAg.data ?? []) as unknown as AgConcluido[]).filter((a) => !linkados.has(a.id)));
    setLoading(false);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  const refresh = async () => { await carregar(); onChanged(); };

  async function addAvulsa() {
    if (multi && !novoServ) { setErro('Escolha o serviço da sessão.'); return; }
    const iso = dataParaBanco(novaData);
    if (!iso) { setErro('Data inválida. Use DD/MM/AAAA.'); return; }
    setBusy(true); setErro('');
    const { error } = await supabase.from('pacote_uso').insert({
      empresa_id: empresaId,
      pacote_cliente_id: pc.id,
      servico_id: novoServ || servUnicoId || null,
      observacao: novaObs.trim() || null,
      created_at: `${iso}T12:00:00`,
    });
    setBusy(false);
    if (error) { setErro(error.message); return; }
    setAddOpen(false); setNovaObs(''); setNovoServ(servUnicoId); setNovaData(hojeMascara());
    refresh();
  }

  async function vincularAtendimento() {
    if (!vincAg) { setErro('Escolha o atendimento.'); return; }
    const ag = candidatos.find((a) => a.id === vincAg);
    if (!ag) return;
    setBusy(true); setErro('');
    const { error: e1 } = await supabase.from('pacote_uso').insert({
      empresa_id: empresaId,
      pacote_cliente_id: pc.id,
      servico_id: ag.servico_id,
      agendamento_id: ag.id,
      created_at: ag.data_hora_inicio,
    });
    if (e1) { setBusy(false); setErro(e1.message); return; }
    // Vincula o agendamento ao pacote (para de contar como faturamento, igual às automáticas)
    await supabase.from('agendamentos').update({ pacote_cliente_id: pc.id }).eq('id', ag.id).eq('empresa_id', empresaId);
    setBusy(false); setVincOpen(false); setVincAg('');
    refresh();
  }

  function abrirEdicao(s: UsoRow) {
    setErro('');
    setEditId(s.id);
    setEdServ(s.servico_id ?? '');
    setEdData(format(parseISO(s.created_at), 'dd/MM/yyyy'));
    setEdObs(s.observacao ?? '');
  }
  async function salvarEdicao() {
    if (!editId) return;
    const iso = dataParaBanco(edData);
    if (!iso) { setErro('Data inválida. Use DD/MM/AAAA.'); return; }
    setBusy(true); setErro('');
    const { error } = await supabase.from('pacote_uso').update({
      servico_id: edServ || null,
      observacao: edObs.trim() || null,
      created_at: `${iso}T12:00:00`,
    }).eq('id', editId);
    setBusy(false);
    if (error) { setErro(error.message); return; }
    setEditId(null);
    refresh();
  }
  function excluirSessao(id: string) {
    Alert.alert(
      'Excluir sessão?',
      'A sessão é removida da contagem do pacote. O agendamento vinculado (se houver) não é apagado.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir', style: 'destructive', onPress: async () => {
            setBusy(true); setErro('');
            const { error } = await supabase.from('pacote_uso').delete().eq('id', id);
            setBusy(false);
            if (error) { setErro(error.message); return; }
            refresh();
          },
        },
      ],
    );
  }

  const total = pc.total_sessoes;
  const usadas = sessoes.length;
  const esgotado = total != null && usadas >= total;

  function ServChips({ value, onChange }: { value: string; onChange: (id: string) => void }) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {servicosPac.map((s) => {
          const ativo = value === s.servico_id;
          return (
            <TouchableOpacity
              key={s.servico_id}
              onPress={() => onChange(s.servico_id)}
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
                borderColor: ativo ? C.primary : C.border, backgroundColor: ativo ? C.primary : C.surface,
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: ativo ? '#fff' : C.text2 }}>
                {s.nome}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '92%', paddingBottom: insets.bottom + 8,
        }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            padding: 18, borderBottomWidth: 1, borderBottomColor: C.border,
          }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 19, color: C.text }}>Sessões</Text>
              <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, marginTop: 2 }}>
                {pc.cliente.nome} · {pc.pacote.nome}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
              <X size={20} color={C.text3} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }} keyboardShouldPersistTaps="handled">
            {/* Resumo */}
            <View style={{
              backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
              padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text2 }}>Usadas</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: C.text }}>
                {usadas}{total != null ? ` / ${total}` : ' (ilimitado)'}
              </Text>
            </View>

            {/* Lista de sessões */}
            {loading ? (
              <ActivityIndicator color={C.primary} style={{ marginVertical: 12 }} />
            ) : sessoes.length === 0 ? (
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text4, textAlign: 'center', paddingVertical: 4 }}>
                Nenhuma sessão registrada.
              </Text>
            ) : (
              sessoes.map((s) => editId === s.id ? (
                <View key={s.id} style={{ backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.primary, padding: 12, gap: 8 }}>
                  {multi && <ServChips value={edServ} onChange={setEdServ} />}
                  <TextInput value={edData} onChangeText={(v) => setEdData(mascaraData(v))} keyboardType="numeric" placeholder="DD/MM/AAAA" placeholderTextColor={C.text4} style={inputSt} />
                  <TextInput value={edObs} onChangeText={setEdObs} placeholder="Observação" placeholderTextColor={C.text4} style={inputSt} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={() => setEditId(null)} style={{ flex: 1, height: 36, borderRadius: 9, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={salvarEdicao} disabled={busy} style={{ flex: 1, height: 36, borderRadius: 9, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Salvar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View key={s.id} style={{ backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                      {s.servico?.nome ?? 'Sem serviço'}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4, marginTop: 1 }}>
                      {format(parseISO(s.created_at), 'dd/MM/yyyy')}
                      {' · '}{s.agendamento_id ? 'via agendamento' : 'avulsa'}
                      {s.observacao ? ` · ${s.observacao}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => abrirEdicao(s)} style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                    <Edit3 size={14} color={C.text3} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => excluirSessao(s.id)} disabled={busy} style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                    <Trash2 size={14} color={C.text3} />
                  </TouchableOpacity>
                </View>
              ))
            )}

            {erro ? <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red }}>{erro}</Text> : null}

            {/* Adicionar avulsa */}
            {addOpen ? (
              <View style={{ backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Nova sessão avulsa</Text>
                {multi && <ServChips value={novoServ} onChange={setNovoServ} />}
                <TextInput value={novaData} onChangeText={(v) => setNovaData(mascaraData(v))} keyboardType="numeric" placeholder="DD/MM/AAAA" placeholderTextColor={C.text4} style={inputSt} />
                <TextInput value={novaObs} onChangeText={setNovaObs} placeholder="Observação (opcional)" placeholderTextColor={C.text4} style={inputSt} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={() => setAddOpen(false)} style={{ flex: 1, height: 36, borderRadius: 9, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={addAvulsa} disabled={busy} style={{ flex: 1, height: 36, borderRadius: 9, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Adicionar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => { setErro(''); setAddOpen(true); setVincOpen(false); setEditId(null); }}
                style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
              >
                <Plus size={14} color={C.text3} />
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3 }}>
                  Sessão avulsa{esgotado ? ' (pacote já esgotado)' : ''}
                </Text>
              </TouchableOpacity>
            )}

            {/* Vincular atendimento já realizado */}
            {vincOpen ? (
              <View style={{ backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Vincular atendimento concluído</Text>
                {candidatos.length === 0 ? (
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>
                    Nenhum atendimento concluído do cliente sem vínculo.
                  </Text>
                ) : (
                  <View style={{ gap: 6, maxHeight: 220 }}>
                    <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
                      {candidatos.map((a) => {
                        const ativo = vincAg === a.id;
                        return (
                          <TouchableOpacity
                            key={a.id}
                            onPress={() => setVincAg(ativo ? '' : a.id)}
                            style={{
                              padding: 10, borderRadius: 9, borderWidth: 1, marginBottom: 6,
                              borderColor: ativo ? C.primary : C.border,
                              backgroundColor: ativo ? C.primarySoft : C.bg,
                            }}
                          >
                            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
                              {a.servico?.nome ?? 'Serviço'}
                            </Text>
                            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4, marginTop: 1 }}>
                              {format(parseISO(a.data_hora_inicio), 'dd/MM/yyyy')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={() => { setVincOpen(false); setVincAg(''); }} style={{ flex: 1, height: 36, borderRadius: 9, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={vincularAtendimento}
                    disabled={busy || candidatos.length === 0 || !vincAg}
                    style={{ flex: 1, height: 36, borderRadius: 9, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: (busy || candidatos.length === 0 || !vincAg) ? 0.5 : 1 }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Vincular</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => { setErro(''); setVincOpen(true); setAddOpen(false); setEditId(null); }}
                style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
              >
                <CalendarPlus size={14} color={C.text3} />
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3 }}>Vincular atendimento já realizado</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function Pacotes() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();

  const [aba, setAba] = useState<'catalogo' | 'vendidos'>('catalogo');
  const [filtro, setFiltro] = useState<'todos' | 'ativo' | 'concluido' | 'expirado'>('todos');
  const [modalSessao, setModalSessao] = useState<PacoteVendido | null>(null);

  const { data: pacotes = [], isLoading, refetch } = usePacotes();
  const { data: vendidos = [], isLoading: loadingVend, refetch: refetchVend } = usePacotesVendidos();
  const onRefresh = useCallback(() => { refetch(); refetchVend(); }, [refetch, refetchVend]);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  const ativos   = pacotes.filter((p) => p.ativo);
  const inativos = pacotes.filter((p) => !p.ativo);
  const vendAtivos = vendidos.filter((v) => v.status === 'ativo').length;
  const vendidosFiltrados = filtro === 'todos' ? vendidos : vendidos.filter((v) => v.status === filtro);

  async function togglePacote(p: PacoteComServicos) {
    const { error } = await supabase
      .from('pacotes')
      .update({ ativo: !p.ativo })
      .eq('id', p.id);
    if (error) { Alert.alert('Erro', error.message); return; }
    qc.invalidateQueries({ queryKey: ['pacotes'] });
  }

  function excluirVenda(v: PacoteVendido) {
    if (!empresaId) return;
    Alert.alert(
      'Excluir venda?',
      `A venda de "${v.pacote.nome}" para ${v.cliente.nome} será apagada, junto com as sessões registradas. Agendamentos vinculados serão desvinculados. Sem volta.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir venda', style: 'destructive', onPress: async () => {
            // Desvincula agendamentos que apontam para esta venda (FK sem ON DELETE)
            await supabase.from('agendamentos').update({ pacote_cliente_id: null })
              .eq('pacote_cliente_id', v.id).eq('empresa_id', empresaId);
            const { error } = await supabase.from('pacote_clientes')
              .delete().eq('id', v.id).eq('empresa_id', empresaId);
            if (error) { Alert.alert('Erro', error.message); return; }
            qc.invalidateQueries({ queryKey: ['pacotes-vendidos'] });
          },
        },
      ],
    );
  }

  async function marcarComboUtilizado(pcId: string) {
    if (!empresaId) return;
    const { error } = await supabase.from('pacote_clientes')
      .update({ status: 'concluido' }).eq('id', pcId).eq('empresa_id', empresaId);
    if (error) { Alert.alert('Erro', error.message); return; }
    qc.invalidateQueries({ queryKey: ['pacotes-vendidos'] });
  }

  function renderSection(lista: PacoteComServicos[], titulo: string, delay: number) {
    if (lista.length === 0) return null;
    return (
      <MotiView
        from={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 320, delay }}
        style={{ marginHorizontal: 24, marginBottom: 20 }}
      >
        <Text style={{
          fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3,
          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
        }}>
          {titulo}
        </Text>
        {lista.map((p) => (
          <PacoteCard
            key={p.id}
            pacote={p}
            onToggle={() => togglePacote(p)}
            onEdit={() => router.push(`/(empresa)/editar-pacote/${p.id}` as any)}
          />
        ))}
      </MotiView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isLoading || loadingVend} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {/* Header */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 20 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                {empresaAtiva?.nome}
              </Text>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
                Pacotes
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* Stats */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16, marginBottom: 16 }}
        >
          {[
            { value: ativos.length,     label: 'Ativos',      color: C.primary },
            { value: vendidos.length,   label: 'Vendas',      color: C.green   },
            { value: vendAtivos,        label: 'Em uso',      color: C.accent  },
          ].map((s) => (
            <View key={s.label} style={{
              flex: 1, backgroundColor: C.surface,
              borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12,
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
              alignItems: 'center',
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: s.color, letterSpacing: -0.5, lineHeight: 24, marginBottom: 3 }}>
                {s.value}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {s.label}
              </Text>
            </View>
          ))}
        </MotiView>

        {/* Abas */}
        <View style={{ marginHorizontal: 24, marginBottom: 16 }}>
          <SmoothTabs
            variant="segmented"
            tabs={[
              { key: 'catalogo', label: 'Catálogo' },
              { key: 'vendidos', label: `Vendidos (${vendidos.length})` },
            ]}
            active={aba}
            onChange={(k) => setAba(k as typeof aba)}
          />
        </View>

        {/* ══ CATÁLOGO ══ */}
        {aba === 'catalogo' && (
          <>
            {renderSection(ativos,   'Pacotes ativos', 100)}
            {renderSection(inativos, 'Inativos',       160)}

            {pacotes.length === 0 && !isLoading && (
              <View style={{ marginHorizontal: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 32, alignItems: 'center', gap: 12 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Nenhum pacote cadastrado ainda.
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(empresa)/novo-pacote' as any)}
                  style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
                >
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                    Criar primeiro pacote
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* ══ VENDIDOS ══ */}
        {aba === 'vendidos' && (
          <View style={{ marginHorizontal: 24 }}>
            <View style={{ marginBottom: 14, marginHorizontal: -4 }}>
              <SmoothTabs
                variant="pill"
                tabs={[
                  { key: 'todos',     label: `Todos (${vendidos.length})` },
                  { key: 'ativo',     label: `Ativos (${vendidos.filter((v) => v.status === 'ativo').length})` },
                  { key: 'concluido', label: `Concluídos (${vendidos.filter((v) => v.status === 'concluido').length})` },
                  { key: 'expirado',  label: `Expirados (${vendidos.filter((v) => v.status === 'expirado').length})` },
                ]}
                active={filtro}
                onChange={(k) => setFiltro(k as typeof filtro)}
              />
            </View>

            {loadingVend ? (
              <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
            ) : vendidosFiltrados.length === 0 ? (
              <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 28, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, textAlign: 'center' }}>
                  {filtro !== 'todos' ? `Nenhuma venda "${VSTATUS[filtro]?.label ?? filtro}"` : 'Nenhuma venda registrada ainda.'}
                </Text>
              </View>
            ) : (
              vendidosFiltrados.map((v) => (
                <VendidoCard
                  key={v.id}
                  v={v}
                  onGerenciar={() => setModalSessao(v)}
                  onExcluir={() => excluirVenda(v)}
                  onMarcarUtilizado={() => marcarComboUtilizado(v.id)}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push('/(empresa)/novo-pacote' as any)}
        style={{
          position: 'absolute', bottom: insets.bottom + 24, right: 24,
          width: 52, height: 52, borderRadius: 16,
          backgroundColor: C.primary,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: C.primary, shadowOpacity: 0.35,
          shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
        }}
      >
        <Plus size={22} color="#fff" strokeWidth={2.5} />
      </TouchableOpacity>

      {modalSessao && empresaId && (
        <SessoesModal
          pc={modalSessao}
          empresaId={empresaId}
          onClose={() => setModalSessao(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ['pacotes-vendidos'] })}
        />
      )}
    </View>
  );
}
