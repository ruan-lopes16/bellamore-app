/**
 * @file pacotes.tsx
 * Pacotes no app — a mesma tela do web (web/app/(app)/pacotes/page.tsx).
 *
 * ## Abas
 * - Catálogo  : pacotes (Com sessões ou Combo, ∞ por serviço, validade livre ou sem validade) e "Vender"
 * - Vendidos  : filtros Todos, Ativos, Concluídos, Expirados e A cobrar; sessões; excluir venda
 * - Relatório : utilização por pacote (calcularRelatorioUtilizacao), com exportação
 *
 * ## Regras (shared)
 * - saldo e status: saldoSessoes / statusPacoteCliente (hooks/usePacotes.ts), último dia de validade vale
 * - venda: VenderPacoteSheet → venderPacote ("Cobrar agora" ou "Cobrar na comanda", migration 096)
 * - excluir venda: excluirPacoteCliente (sem a 096: caminho antigo, com linhas conferidas)
 * - permissões: cadastrar = pacotes.gerenciar; vender e excluir venda = pacotes.vender
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StatusBar, Alert, Switch, RefreshControl, Modal, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Plus, Edit3, Trash2, X, CalendarPlus, ShoppingBag } from 'lucide-react-native';
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
import { usePermissoes } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import {
  usePacotes, usePacotesVendidos,
  type PacoteCatalogo, type PacoteVendido,
} from '@/hooks/usePacotes';
import { SmoothTabs } from '@/components/SmoothTabs';
import { BotaoExportar } from '@/components/BotaoExportar';
import { VenderPacoteSheet } from '@/components/pacotes/VenderPacoteSheet';
import { definicaoPacotesCatalogo, definicaoPacotesVendidos, definicaoPacotesUtilizacao } from '@shared/exportacao/pacotes';
import { formatarMoeda } from '@shared/moeda';
import { mensagemErroBanco } from '@shared/erros';
import {
  rotuloValidade, totalSessoes, filtrarVendidos, rotuloStatusVendido, estaACobrar, textoExcluirVendido,
  MSG_SESSOES_USADAS, MSG_EXCLUSAO_SEM_096, TITULO_EXCLUIR_VENDIDO, type FiltroVendidos,
} from '@shared/pacotes';
import { excluirPacoteCliente, ErroPacote, SemMigration096 } from '@shared/pacotes-venda';
import {
  desfazerVinculoPacote, erroEscritaPacoteUso, calcularRelatorioUtilizacao, marcarComboUtilizado,
} from '@shared/pacotes-consultas';
import { acoesPacoteVendido, atendimentosVinculaveis } from '@shared/permissoes';

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

function PacoteCard({ pacote, podeGerenciar, podeVender, onToggle, onEdit, onVender }: {
  pacote: PacoteCatalogo;
  podeGerenciar: boolean;
  podeVender: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onVender: () => void;
}) {
  const combo = !pacote.controla_sessoes;
  const total = totalSessoes(pacote.servicos);
  const sessoes = combo
    ? `Combo · ${pacote.servicos.length} ${pacote.servicos.length === 1 ? 'serviço' : 'serviços'}`
    : total == null ? 'Sessões ilimitadas' : `${total} ${total === 1 ? 'sessão' : 'sessões'}`;
  const tagsVisiveis = pacote.servicos.slice(0, 3);
  const overflow = pacote.servicos.length - 3;

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
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 2 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{pacote.nome}</Text>
          {combo && (
            <View style={{ backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: C.accent, textTransform: 'uppercase' }}>Combo</Text>
            </View>
          )}
        </View>
        {podeGerenciar && (
          <Switch
            value={pacote.ativo}
            onValueChange={onToggle}
            trackColor={{ false: '#E5E7EB', true: C.green }}
            thumbColor="#fff"
            style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
          />
        )}
      </View>

      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, marginBottom: 10 }}>
        {sessoes} · {rotuloValidade(pacote.validade_dias)}
      </Text>

      {tagsVisiveis.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {tagsVisiveis.map((s) => (
            <View key={s.servico_id} style={{ backgroundColor: C.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text2 }} numberOfLines={1}>
                {s.nome} ×{s.quantidade ?? '∞'}
              </Text>
            </View>
          ))}
          {overflow > 0 && (
            <View style={{ backgroundColor: C.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>+{overflow}</Text>
            </View>
          )}
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: pacote.ativo ? C.primary : C.text3, letterSpacing: -0.5 }}>
          {formatarMoeda(pacote.preco)}
        </Text>
        {podeVender && pacote.ativo && (
          <TouchableOpacity onPress={onVender} accessibilityLabel={`Vender ${pacote.nome}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 8, backgroundColor: C.primary }}>
            <ShoppingBag size={12} color="#fff" strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Vender</Text>
          </TouchableOpacity>
        )}
        {podeGerenciar && (
          <TouchableOpacity onPress={onEdit} accessibilityLabel="Editar pacote"
            style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
            <Edit3 size={13} color={C.text3} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>
    </MotiView>
  );
}

// ── Card de pacote vendido ──────────────────────────────────

function VendidoCard({ v, podeExcluir, podeMarcarCombo, onGerenciar, onExcluir, onMarcarUtilizado }: {
  v: PacoteVendido;
  podeExcluir: boolean;
  podeMarcarCombo: boolean;
  onGerenciar: () => void;
  onExcluir: () => void;
  onMarcarUtilizado: () => void;
}) {
  const ilimitado = v.total_sessoes === null;
  const pct = v.total_sessoes != null && v.total_sessoes > 0 ? (v.usadas / v.total_sessoes) * 100 : 0;
  const restantes = v.total_sessoes != null ? Math.max(0, v.total_sessoes - v.usadas) : null;
  const corBarra = pct >= 100 ? '#16A34A' : pct >= 70 ? '#D97706' : '#7C3AED';
  const st = VSTATUS[v.statusExibido] ?? VSTATUS.cancelado;
  const aCobrar = estaACobrar(v);

  return (
    <View style={{
      backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
      borderRadius: 14, padding: 14, marginBottom: 10,
      shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>{v.cliente.nome}</Text>
          <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, marginTop: 1 }}>{v.pacote.nome}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {aCobrar && (
            <View style={{ backgroundColor: C.amberSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: C.amber, textTransform: 'uppercase', letterSpacing: 0.4 }}>A cobrar</Text>
            </View>
          )}
          <View style={{ backgroundColor: st.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: st.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{st.label}</Text>
          </View>
          {podeExcluir && (
            <TouchableOpacity onPress={onExcluir} accessibilityLabel="Excluir venda"
              style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
              <Trash2 size={12} color={C.text3} strokeWidth={2} />
            </TouchableOpacity>
          )}
        </View>
      </View>

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
            <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: C.text }}>
              {v.usadas}
              <Text style={{ fontSize: 14, color: C.text3 }}>/{ilimitado ? '∞' : v.total_sessoes}</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3 }}>  sessões</Text>
            </Text>
            {ilimitado && v.statusExibido === 'ativo' ? (
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.primary }}>Ilimitado</Text>
            ) : restantes !== null && restantes > 0 && v.statusExibido === 'ativo' ? (
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

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>Válido até</Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{fmtData(v.data_validade)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>{aCobrar ? 'Valor a cobrar' : 'Valor pago'}</Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{v.valor_pago != null ? formatarMoeda(v.valor_pago) : '—'}</Text>
        </View>
      </View>

      {v.pacote.controla_sessoes ? (
        <>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4, textAlign: 'center', marginBottom: 6 }}>
            Sessões entram sozinhas ao concluir agendamentos.
          </Text>
          <TouchableOpacity onPress={onGerenciar}
            style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Gerenciar sessões</Text>
          </TouchableOpacity>
        </>
      ) : v.statusExibido === 'ativo' && podeMarcarCombo ? (
        <TouchableOpacity onPress={onMarcarUtilizado}
          style={{ height: 38, borderRadius: 10, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
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
  profissional_id: string | null;
  /** Pacote a que o atendimento já estava ligado (ex.: combo); o desfazer volta a ele. */
  pacote_cliente_id: string | null;
  servico?: { nome: string } | null;
};

function SessoesModal({ pc, empresaId, podeLancarAvulsa, vincularDeOutras, onClose, onChanged }: {
  pc: PacoteVendido;
  empresaId: string;
  /** Sessão sem atendimento só com "pacotes.vender" (acoesPacoteVendido, igual à RLS da 093). */
  podeLancarAvulsa: boolean;
  /** Sem "agenda.gerenciar_outras" só os atendimentos da própria pessoa podem ser vinculados. */
  vincularDeOutras: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore(s => s.user?.id ?? null);
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
    const [rUso, rAg] = await Promise.all([
      supabase.from('pacote_uso')
        .select('id, servico_id, agendamento_id, observacao, created_at, servico:servicos(nome)')
        .eq('pacote_cliente_id', pc.id).order('created_at', { ascending: false }),
      supabase.from('agendamentos')
        // pacote_cliente_id: o desfazer do vínculo volta ao valor anterior (atendimento de combo segue no combo).
        .select('id, data_hora_inicio, servico_id, pacote_cliente_id, profissional_id, servico:servicos(nome)')
        .eq('empresa_id', empresaId).eq('cliente_id', pc.cliente.id).eq('status', 'concluido')
        .order('data_hora_inicio', { ascending: false }).limit(100),
    ]);
    if (rUso.error || rAg.error) {
      setErro(mensagemErroBanco(rUso.error ?? rAg.error, 'carregar as sessões'));
      setLoading(false);
      return;
    }
    const ags = (rAg.data ?? []) as unknown as AgConcluido[];
    // Só os candidatos deste cliente: atendimento que já lançou sessão em qualquer pacote fica de fora.
    const rLink = ags.length > 0
      ? await supabase.from('pacote_uso').select('agendamento_id')
        .eq('empresa_id', empresaId).in('agendamento_id', ags.map((a) => a.id))
      : { data: [], error: null };
    if (rLink.error) { setErro(mensagemErroBanco(rLink.error, 'carregar os atendimentos')); setLoading(false); return; }
    setSessoes((rUso.data ?? []) as unknown as UsoRow[]);
    const linkados = new Set(((rLink.data ?? []) as { agendamento_id: string }[]).map((x) => x.agendamento_id));
    setCandidatos(atendimentosVinculaveis(ags.filter((a) => !linkados.has(a.id)), userId, vincularDeOutras));
    setLoading(false);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  const refresh = async () => { await carregar(); onChanged(); };

  async function addAvulsa() {
    if (multi && !novoServ) { setErro('Escolha o serviço da sessão.'); return; }
    const iso = dataParaBanco(novaData);
    if (!iso) { setErro('Data inválida. Use DD/MM/AAAA.'); return; }
    setBusy(true); setErro('');
    const rAvulsa = await supabase.from('pacote_uso').insert({
      empresa_id: empresaId,
      pacote_cliente_id: pc.id,
      servico_id: novoServ || servUnicoId || null,
      observacao: novaObs.trim() || null,
      created_at: `${iso}T12:00:00`,
    }).select('id');
    setBusy(false);
    const falhaAvulsa = erroEscritaPacoteUso(rAvulsa, 'lançar a sessão');
    if (falhaAvulsa) { setErro(falhaAvulsa); return; }
    setAddOpen(false); setNovaObs(''); setNovoServ(servUnicoId); setNovaData(hojeMascara());
    refresh();
  }

  async function vincularAtendimento() {
    if (!vincAg) { setErro('Escolha o atendimento.'); return; }
    const ag = candidatos.find((a) => a.id === vincAg);
    if (!ag) return;
    setBusy(true); setErro('');
    // 1º o vínculo no atendimento, com .select: a policy de UPDATE de agendamentos só deixa a
    // própria agenda (ou a de outra com "agenda.gerenciar_outras"). Antes o UPDATE vinha depois
    // e sem conferência: a sessão era lançada e o atendimento seguia contando como faturamento.
    const { data: vinculados, error: e0 } = await supabase.from('agendamentos')
      .update({ pacote_cliente_id: pc.id }).eq('id', ag.id).eq('empresa_id', empresaId).select('id');
    if (e0) { setBusy(false); setErro(mensagemErroBanco(e0, 'alterar o atendimento')); return; }
    if (!vinculados || vinculados.length === 0) { setBusy(false); setErro('Você não tem permissão para alterar este atendimento.'); return; }
    const rSessao = await supabase.from('pacote_uso').insert({
      empresa_id:        empresaId,
      pacote_cliente_id: pc.id,
      servico_id:        ag.servico_id,
      agendamento_id:    ag.id,
      created_at:        ag.data_hora_inicio,
    }).select('id');
    const falhaSessao = erroEscritaPacoteUso(rSessao, 'lançar a sessão');
    if (falhaSessao) {
      // Desfaz o vínculo voltando ao pacote ANTERIOR (null tiraria um atendimento de combo do combo e o
      // faria contar como faturamento); se nem o desfazer passar, avisa para conferir o atendimento.
      const falhaDesfazer = await desfazerVinculoPacote(supabase, empresaId, ag.id, ag.pacote_cliente_id ?? null);
      setBusy(false); setErro(falhaDesfazer ?? falhaSessao);
      return;
    }
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
    const rEdicao = await supabase.from('pacote_uso').update({
      servico_id: edServ || null,
      observacao: edObs.trim() || null,
      created_at: `${iso}T12:00:00`,
    }).eq('id', editId).select('id');
    setBusy(false);
    const falhaEdicao = erroEscritaPacoteUso(rEdicao, 'editar a sessão');
    if (falhaEdicao) { setErro(falhaEdicao); return; }
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
            const rExclusao = await supabase.from('pacote_uso').delete().eq('id', id).select('id');
            setBusy(false);
            const falhaExclusao = erroEscritaPacoteUso(rExclusao, 'excluir a sessão');
            if (falhaExclusao) { setErro(falhaExclusao); return; }
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
            ) : podeLancarAvulsa && (
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
  const { pode } = usePermissoes();
  const empresaId = empresaAtiva?.id;
  const podeGerenciarCatalogo = pode('pacotes.gerenciar');
  const podeVender = pode('pacotes.vender');
  // Pacote vendido (excluir, combo, sessões): regra única de shared, igual à RLS (093/096).
  const acoesVendido = acoesPacoteVendido(pode);
  const qc = useQueryClient();

  const [aba, setAba] = useState<'catalogo' | 'vendidos' | 'relatorio'>('catalogo');
  const [filtro, setFiltro] = useState<FiltroVendidos>('todos');
  const [modalSessao, setModalSessao] = useState<PacoteVendido | null>(null);
  const [vendendo, setVendendo] = useState<PacoteCatalogo | null>(null);

  const catalogo = usePacotes();
  const vend = usePacotesVendidos();
  const pacotes = catalogo.data ?? [];
  const vendidos = vend.data ?? [];
  const onRefresh = useCallback(() => { catalogo.refetch(); vend.refetch(); }, [catalogo, vend]);

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
  const conta = (f: FiltroVendidos) => filtrarVendidos(vendidos, f).length;
  const vendidosFiltrados = filtrarVendidos(vendidos, filtro);
  const relatorio = calcularRelatorioUtilizacao(vendidos);
  // Número só com a carga certa: carregando ou com erro mostra '—', nunca zero.
  const num = (ok: boolean, n: number) => (ok ? String(n) : '—');
  const invalidarVendidos = () => qc.invalidateQueries({ queryKey: ['pacotes-vendidos'] });

  async function togglePacote(p: PacoteCatalogo) {
    if (!empresaId) return;
    const { data: alterados, error } = await supabase
      .from('pacotes')
      .update({ ativo: !p.ativo })
      .eq('id', p.id).eq('empresa_id', empresaId)
      .select('id');
    if (error || !alterados || alterados.length === 0) {
      Alert.alert('Não foi possível alterar', mensagemErroBanco(error ?? { code: '42501' }, 'alterar o pacote'));
      return;
    }
    qc.invalidateQueries({ queryKey: ['pacotes'] });
  }

  function excluirVenda(v: PacoteVendido) {
    if (!empresaId) return;
    if (v.usadas > 0) { Alert.alert('Não foi possível excluir', MSG_SESSOES_USADAS); return; }
    Alert.alert(
      TITULO_EXCLUIR_VENDIDO,
      textoExcluirVendido({ pacote: v.pacote.nome, cliente: v.cliente.nome, aCobrar: estaACobrar(v) }),
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir', style: 'destructive', onPress: async () => {
            let falha: string | null = null;
            try {
              await excluirPacoteCliente(supabase, empresaId, v.id);
            } catch (e) {
              // Sem a 096 a exclusão fica indisponível: o caminho antigo deixava a venda no faturamento.
              if (e instanceof SemMigration096) falha = MSG_EXCLUSAO_SEM_096;
              else falha = e instanceof ErroPacote ? e.message : mensagemErroBanco(null, 'excluir o pacote vendido');
            }
            invalidarVendidos();
            invalidarFinanceiro(qc);
            if (falha) Alert.alert('Não foi possível excluir', falha);
          },
        },
      ],
    );
  }

  async function marcarCombo(pcId: string) {
    if (!empresaId) return;
    const falha = await marcarComboUtilizado(supabase, empresaId, pcId);
    if (falha) { Alert.alert('Não foi possível marcar', falha); return; }
    invalidarVendidos();
  }

  function renderSection(lista: PacoteCatalogo[], titulo: string, delay: number) {
    if (lista.length === 0) return null;
    return (
      <MotiView
        from={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 320, delay }}
        style={{ marginHorizontal: 24, marginBottom: 20 }}
      >
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          {titulo}
        </Text>
        {lista.map((p) => (
          <PacoteCard
            key={p.id}
            pacote={p}
            podeGerenciar={podeGerenciarCatalogo}
            podeVender={podeVender}
            onToggle={() => togglePacote(p)}
            onEdit={() => router.push(`/(empresa)/editar-pacote/${p.id}` as any)}
            onVender={() => setVendendo(p)}
          />
        ))}
      </MotiView>
    );
  }

  function Aviso({ texto, onTentar }: { texto: string; onTentar: () => void }) {
    return (
      <View style={{ marginHorizontal: 24, marginBottom: 16, backgroundColor: C.redSoft, borderRadius: 14, padding: 14, gap: 8 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.red }}>{texto}</Text>
        <TouchableOpacity onPress={onTentar} style={{ alignSelf: 'flex-start', backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Tentar de novo</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const erroCatalogo = catalogo.isError ? mensagemErroBanco(catalogo.error as { code?: string; message?: string }, 'carregar o catálogo de pacotes') : null;
  const erroVendidos = vend.isError ? mensagemErroBanco(vend.error as { code?: string; message?: string }, 'carregar os pacotes vendidos') : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={catalogo.isFetching || vend.isFetching} onRefresh={onRefresh} tintColor="#fff" />}
      >
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                {empresaAtiva?.nome}
              </Text>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>Pacotes</Text>
            </View>
            {aba === 'catalogo' && catalogo.isSuccess ? (
              <BotaoExportar
                definicao={definicaoPacotesCatalogo()}
                getLinhas={() => pacotes.map((p) => ({ nome: p.nome, preco: p.preco, validadeDias: p.validade_dias, servicos: p.servicos.map((s) => ({ nome: s.nome, quantidade: s.quantidade })), ativo: p.ativo }))}
                cor="#fff"
              />
            ) : aba === 'vendidos' && vend.isSuccess ? (
              <BotaoExportar
                definicao={definicaoPacotesVendidos()}
                getLinhas={() => vendidosFiltrados.map((v) => ({ cliente: v.cliente.nome, pacote: v.pacote.nome, usadas: v.usadas, totalSessoes: v.total_sessoes, valorPago: v.valor_pago, inicio: v.data_inicio, validade: v.data_validade, status: rotuloStatusVendido(v) }))}
                cor="#fff"
              />
            ) : aba === 'relatorio' && vend.isSuccess ? (
              <BotaoExportar
                definicao={definicaoPacotesUtilizacao()}
                getLinhas={() => relatorio.porPacote.map((l) => ({ nome: l.nome, vendas: l.vendas, totalSessoes: l.totalSessoes, sessoesUsadas: l.sessoesUsadas, receita: l.receita }))}
                cor="#fff"
              />
            ) : null}
          </View>
        </LinearGradient>

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16, marginBottom: 16 }}>
          {[
            { value: num(catalogo.isSuccess, ativos.length), label: 'Ativos', color: C.primary },
            { value: num(vend.isSuccess, vendidos.length), label: 'Vendas', color: C.green },
            { value: num(vend.isSuccess, conta('ativo')), label: 'Em uso', color: C.accent },
            { value: num(vend.isSuccess, conta('a_cobrar')), label: 'A cobrar', color: C.amber },
          ].map((s) => (
            <View key={s.label} style={{ flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, alignItems: 'center' }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: s.color, letterSpacing: -0.5, lineHeight: 24, marginBottom: 3 }}>
                {s.value}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 }}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginHorizontal: 24, marginBottom: 16 }}>
          <SmoothTabs
            variant="segmented"
            tabs={[
              { key: 'catalogo', label: 'Catálogo' },
              { key: 'vendidos', label: `Vendidos (${num(vend.isSuccess, vendidos.length)})` },
              { key: 'relatorio', label: 'Relatório' },
            ]}
            active={aba}
            onChange={(k) => setAba(k as typeof aba)}
          />
        </View>

        {/* ══ CATÁLOGO ══ */}
        {aba === 'catalogo' && (
          erroCatalogo ? <Aviso texto={erroCatalogo} onTentar={() => catalogo.refetch()} /> : catalogo.isPending ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
          ) : (
            <>
              {renderSection(ativos,   'Pacotes ativos', 100)}
              {renderSection(inativos, 'Inativos',       160)}
              {pacotes.length === 0 && (
                <View style={{ marginHorizontal: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 32, alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>Nenhum pacote cadastrado ainda.</Text>
                  {podeGerenciarCatalogo && (
                    <TouchableOpacity onPress={() => router.push('/(empresa)/novo-pacote' as any)}
                      style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>Criar primeiro pacote</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </>
          )
        )}

        {/* ══ VENDIDOS ══ */}
        {aba === 'vendidos' && (
          erroVendidos ? <Aviso texto={erroVendidos} onTentar={() => vend.refetch()} /> : (
            <View style={{ marginHorizontal: 24 }}>
              <View style={{ marginBottom: 14, marginHorizontal: -4 }}>
                <SmoothTabs
                  variant="pill"
                  tabs={[
                    { key: 'todos',     label: `Todos (${num(vend.isSuccess, conta('todos'))})` },
                    { key: 'ativo',     label: `Ativos (${num(vend.isSuccess, conta('ativo'))})` },
                    { key: 'concluido', label: `Concluídos (${num(vend.isSuccess, conta('concluido'))})` },
                    { key: 'expirado',  label: `Expirados (${num(vend.isSuccess, conta('expirado'))})` },
                    { key: 'a_cobrar',  label: `A cobrar (${num(vend.isSuccess, conta('a_cobrar'))})` },
                  ]}
                  active={filtro}
                  onChange={(k) => setFiltro(k as FiltroVendidos)}
                />
              </View>

              {vend.isPending ? (
                <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
              ) : vendidosFiltrados.length === 0 ? (
                <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 28, alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, textAlign: 'center' }}>
                    {filtro === 'a_cobrar' ? 'Nenhum pacote a cobrar.' : filtro !== 'todos' ? `Nenhuma venda "${VSTATUS[filtro]?.label ?? filtro}"` : 'Nenhuma venda registrada ainda.'}
                  </Text>
                </View>
              ) : (
                vendidosFiltrados.map((v) => (
                  <VendidoCard
                    key={v.id}
                    v={v}
                    podeExcluir={acoesVendido.excluir}
                    podeMarcarCombo={acoesVendido.marcarCombo}
                    onGerenciar={() => setModalSessao(v)}
                    onExcluir={() => excluirVenda(v)}
                    onMarcarUtilizado={() => marcarCombo(v.id)}
                  />
                ))
              )}
            </View>
          )
        )}

        {/* ══ RELATÓRIO ══ */}
        {aba === 'relatorio' && (
          erroVendidos ? <Aviso texto={erroVendidos} onTentar={() => vend.refetch()} /> : vend.isPending ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
          ) : (
            <View style={{ marginHorizontal: 24, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[
                  { label: 'Receita', value: formatarMoeda(relatorio.receitaTotal) },
                  { label: 'Sessões usadas', value: `${relatorio.sessoesUsadas}/${relatorio.totalSessoes}` },
                  { label: 'Aproveitamento', value: `${relatorio.aproveitamento}%` },
                ].map((k) => (
                  <View key={k.label} style={{ flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 }}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.primary }}>{k.value}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 }}>{k.label}</Text>
                  </View>
                ))}
              </View>
              {relatorio.aCobrar > 0 && (
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.amber }}>
                  {relatorio.aCobrar} {relatorio.aCobrar === 1 ? 'pacote a cobrar ainda não entrou' : 'pacotes a cobrar ainda não entraram'} na receita.
                </Text>
              )}
              {relatorio.porPacote.length === 0 ? (
                <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 28, alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>Nenhuma venda registrada ainda.</Text>
                </View>
              ) : relatorio.porPacote.map((p) => {
                const pct = p.totalSessoes > 0 ? Math.round((p.sessoesUsadas / p.totalSessoes) * 100) : 0;
                return (
                  <View key={p.pacote_id || p.nome} style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, gap: 6 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>{p.nome}</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary }}>{formatarMoeda(p.receita)}</Text>
                    </View>
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3 }}>
                      {p.vendas} {p.vendas === 1 ? 'venda' : 'vendas'}{p.aCobrar > 0 ? ` · ${p.aCobrar} a cobrar` : ''} · {p.combo ? 'Combo · sem controle de sessões' : `${p.sessoesUsadas}/${p.totalSessoes} sessões · ${pct}% aproveitamento`}
                    </Text>
                    {!p.combo && (
                      <View style={{ height: 6, borderRadius: 999, backgroundColor: C.bg, overflow: 'hidden' }}>
                        <View style={{ height: 6, width: `${Math.min(pct, 100)}%`, backgroundColor: C.accent }} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )
        )}
      </ScrollView>

      {podeGerenciarCatalogo && (
        <TouchableOpacity
          onPress={() => router.push('/(empresa)/novo-pacote' as any)}
          accessibilityLabel="Novo pacote"
          style={{
            position: 'absolute', bottom: insets.bottom + 24, right: 24,
            width: 52, height: 52, borderRadius: 16, backgroundColor: C.primary,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
          }}
        >
          <Plus size={22} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
      )}

      {modalSessao && empresaId && (
        <SessoesModal
          pc={modalSessao}
          empresaId={empresaId}
          podeLancarAvulsa={acoesVendido.lancarAvulsa}
          vincularDeOutras={acoesVendido.vincularDeOutras}
          onClose={() => setModalSessao(null)}
          onChanged={invalidarVendidos}
        />
      )}

      {empresaId && (
        <VenderPacoteSheet
          visible={!!vendendo}
          empresaId={empresaId}
          pacotes={pacotes}
          pacoteId={vendendo?.id ?? null}
          padraoCobranca="agora"
          onClose={() => setVendendo(null)}
          onVendido={(r) => {
            setVendendo(null);
            setAba('vendidos');
            setFiltro(r.cobranca === 'comanda' ? 'a_cobrar' : 'todos');
            Alert.alert('Pacote vendido', r.cobranca === 'comanda'
              ? 'O pacote fica "A cobrar" e entra na próxima comanda da cliente.'
              : 'Venda registrada.');
          }}
        />
      )}
    </View>
  );
}
