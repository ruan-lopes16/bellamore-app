import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, Linking, Alert, Modal,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  ChevronLeft, Phone, MessageCircle, CalendarPlus,
  MoreHorizontal, Edit3, AlertTriangle,
  Archive, ArchiveRestore, Trash2, X, MapPin, FileText,
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
import { useClienteDetalhe } from '@/hooks/useClientes';
import { idadeCliente, formatarAniversario, parseEndereco, contatosCliente } from '@shared/clientes';
import { arquivarCliente, reativarCliente, type ItemHistorico } from '@shared/clientes-consultas';
import { tagsDaLinha } from '@shared/clientes-segmentos';
import { PAGAMENTO_METODO_LABEL, type PagamentoMetodo } from '@shared/dominio';
import { chaveDiaBRT, diasEntre, hojeBRT } from '@shared/periodos';
import { mensagemErroBanco } from '@shared/erros';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { SecretText } from '@/components/Secret';
import { usePermissoes } from '@/lib/permissions';
import { podeArquivarCliente, podeEditarAnamnese } from '@shared/permissoes';
import {
  normalizarAnamnese, restricoesAnamnese, anamnesePreenchida, ehRestricao,
  PERGUNTAS_SIM_NAO, PERGUNTAS_OPCOES,
} from '@shared/anamnese';
import { formatarMoeda } from '@shared/moeda';

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

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
];

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  agendado:   { label: 'Agendado',   bg: C.primarySoft, color: C.primary },
  confirmado: { label: 'Confirmado', bg: C.greenSoft,  color: C.green },
  concluido:  { label: 'Concluído',  bg: C.greenSoft,  color: C.green },
  cancelado:  { label: 'Cancelado',  bg: C.redSoft,    color: C.red },
  faltou:     { label: 'Faltou',     bg: C.amberSoft,  color: C.amber },
};

const TAXA_STATUS: Record<string, string> = { pago: 'Paga', pendente: 'Pendente', retida: 'Retida' };

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

type Aba = 'perfil' | 'historico' | 'anamnese';

// ── Helpers ──────────────────────────────────────────────────

/** Dia e mês (Brasília) de um instante, para a coluna de data do histórico. */
function diaMesBRT(instante: string): { dia: string; mes: string; ano: string } {
  const [a, m, d] = chaveDiaBRT(instante).split('-');
  return { dia: d, mes: MESES_ABREV[Number(m) - 1] ?? '', ano: a };
}

/** "Paga · Pix", "Pendente", "Retida": status da taxa com a forma de pagamento quando paga. */
function textoTaxa(status: string, metodo: string | null): string {
  const st = TAXA_STATUS[status] ?? status;
  const met = metodo ? PAGAMENTO_METODO_LABEL[metodo as PagamentoMetodo] ?? metodo : null;
  return status === 'pago' && met ? `${st} · ${met}` : st;
}

/** Última visita no KPI: "hoje", "há Nd" (Brasília) ou "—". */
function textoKpiUltimaVisita(ultimaVisita: string | null): string {
  if (!ultimaVisita) return '—';
  const dias = diasEntre(chaveDiaBRT(ultimaVisita), hojeBRT());
  return dias <= 0 ? 'hoje' : `há ${dias}d`;
}

function avatarColors(nome: string): [string, string] {
  return AVATAR_COLORS[(nome?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}
function iniciaisNome(nome: string) {
  return (nome ?? '').split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}
// ── Seção info ───────────────────────────────────────────────

function InfoRow({ icon, label, value, iconBg, iconColor }: {
  icon: React.ReactNode; label: string; value: string;
  iconBg: string; iconColor: string;
}) {
  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderBottomWidth: 1, borderBottomColor: C.border,
    }}>
      <View style={{
        width: 28, height: 28, borderRadius: 8,
        backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 1 }}>
          {label}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

// ── Anamnese row ─────────────────────────────────────────────

function AnamneseRow({ pergunta, resposta, tipo }: {
  pergunta: string; resposta: string;
  tipo: 'alerta' | 'ok' | 'neutro';
}) {
  const dotColor = tipo === 'alerta' ? '#EF4444' : tipo === 'ok' ? C.green : C.text4;
  const respostaColor = tipo === 'alerta' ? C.red : tipo === 'ok' ? C.green : C.text2;

  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      borderBottomWidth: 1, borderBottomColor: C.border,
    }}>
      <View style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: dotColor, marginTop: 4, flexShrink: 0,
      }} />
      <Text style={{
        fontFamily: 'PlusJakartaSans_500Medium',
        fontSize: 11, color: C.text3, flex: 1, lineHeight: 16,
      }}>
        {pergunta}
      </Text>
      <Text style={{
        fontFamily: 'PlusJakartaSans_600SemiBold',
        fontSize: 12, color: respostaColor, textAlign: 'right', flex: 1, lineHeight: 16,
      }}>
        {resposta}
      </Text>
    </View>
  );
}

// ── Linha do histórico ───────────────────────────────────────

/**
 * Uma linha do histórico único (`ItemHistorico` de shared/clientes-consultas):
 * atendimento e serviço extra abrem o detalhe (o extra pela comanda, `?tipo=comanda`);
 * venda mostra os itens; taxas mostram o status e a forma de pagamento.
 */
function LinhaHistorico({ item }: { item: ItemHistorico }) {
  const { dia, mes } = diaMesBRT(item.data);

  let titulo: string;
  let subtitulo: string;
  let badge: { label: string; bg: string; color: string } | null = null;
  let valor: string | null = formatarMoeda(item.valor);
  let destino: string | null = null;

  switch (item.tipo) {
    case 'atendimento':
      titulo = item.servicos || 'Serviço';
      subtitulo = item.profissional ?? 'Profissional';
      badge = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.agendado;
      // Sessão de pacote vale R$ 0 no total gasto: mostra o rótulo em vez do valor.
      if (item.pacote) valor = null;
      destino = `/(empresa)/agendamento/${item.id}`;
      break;
    case 'extra':
      titulo = item.descricao;
      subtitulo = 'Serviço extra da comanda';
      destino = `/(empresa)/agendamento/${item.comandaId}?tipo=comanda`;
      break;
    case 'venda':
      titulo = 'Venda avulsa';
      subtitulo = item.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', ') || 'Sem itens';
      break;
    case 'taxa_reserva':
    case 'taxa_cancelamento':
      titulo = item.tipo === 'taxa_reserva' ? 'Taxa de reserva' : 'Taxa de cancelamento';
      subtitulo = textoTaxa(item.status, item.metodo);
      break;
  }

  const conteudo = (
    <>
      <View style={{ minWidth: 42, alignItems: 'center' }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: C.text, lineHeight: 20 }}>
          {dia}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {mes}
        </Text>
      </View>
      <View style={{ width: 1, height: 32, backgroundColor: C.border }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 2 }}>
          {titulo}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
          {subtitulo}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {valor !== null ? (
          <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, marginBottom: badge ? 4 : 0 }}>
            {valor}
          </SecretText>
        ) : (
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent, marginBottom: badge ? 4 : 0 }}>
            Sessão de pacote
          </Text>
        )}
        {badge && (
          <View style={{ backgroundColor: badge.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: badge.color, textTransform: 'uppercase' }}>
              {badge.label}
            </Text>
          </View>
        )}
      </View>
    </>
  );

  const estilo = {
    backgroundColor: C.surface, borderWidth: 1,
    borderColor: C.border, borderRadius: 14,
    padding: 13, flexDirection: 'row' as const,
    alignItems: 'center' as const, gap: 12,
    shadowColor: C.primary, shadowOpacity: 0.04,
    shadowRadius: 6, elevation: 1,
  };

  if (!destino) return <View style={estilo}>{conteudo}</View>;
  const rota = destino;
  return (
    <TouchableOpacity onPress={() => router.push(rota as any)} style={estilo}>
      {conteudo}
    </TouchableOpacity>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function ClientePerfil() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [aba, setAba] = useState<Aba>('perfil');
  const qc = useQueryClient();
  const { pode } = usePermissoes();
  const empresaId = useAuthStore((s) => s.empresaAtiva?.id);

  const { data: cliente, isLoading, isError, refetch } = useClienteDetalhe(id);

  const [modalRemover, setModalRemover] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [gravandoAtivo, setGravandoAtivo] = useState(false);

  /** Lista (segmentos/arquivadas) e perfil mudam juntos ao arquivar ou reativar. */
  function invalidarClientes() {
    qc.invalidateQueries({ queryKey: ['clientes'] });
    qc.invalidateQueries({ queryKey: ['cliente-detalhe'] });
  }

  async function arquivar() {
    setModalRemover(false);
    if (!empresaId || gravandoAtivo) return;
    setGravandoAtivo(true);
    try {
      await arquivarCliente(supabase as any, empresaId, id);
    } catch (e) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível arquivar a cliente.');
      return;
    } finally {
      setGravandoAtivo(false);
    }
    invalidarClientes();
    router.back();
  }

  async function reativar() {
    setModalRemover(false);
    if (!empresaId || gravandoAtivo) return;
    setGravandoAtivo(true);
    try {
      await reativarCliente(supabase as any, empresaId, id);
    } catch (e) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível reativar a cliente.');
      return;
    } finally {
      setGravandoAtivo(false);
    }
    invalidarClientes();
  }

  async function temHistorico(): Promise<boolean> {
    const [ags, comandas, vendas, pacotes, avals] = await Promise.all([
      supabase.from('agendamentos').select('id', { count: 'exact', head: true }).eq('cliente_id', id),
      supabase.from('comandas').select('id', { count: 'exact', head: true }).eq('clientes_id', id),
      supabase.from('vendas').select('id', { count: 'exact', head: true }).eq('cliente_id', id),
      supabase.from('pacote_clientes').select('id', { count: 'exact', head: true }).eq('cliente_id', id),
      supabase.from('avaliacoes').select('id', { count: 'exact', head: true }).eq('cliente_id', id),
    ]);
    return [ags, comandas, vendas, pacotes, avals].some(r => (r.count ?? 0) > 0);
  }

  async function pedirExclusao() {
    setModalRemover(false);
    if (await temHistorico()) {
      Alert.alert(
        'Não é possível excluir',
        'Esta cliente tem histórico de agendamentos, comandas, vendas, pacotes ou avaliações e não pode ser excluída definitivamente — os registros seriam perdidos. Arquive em vez disso.',
      );
      return;
    }
    Alert.alert(
      'Excluir permanentemente',
      `"${cliente?.nome}" será excluída para sempre — essa ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir para sempre', style: 'destructive', onPress: confirmarExcluir },
      ],
    );
  }

  async function confirmarExcluir() {
    setExcluindo(true);
    const { data, error } = await supabase.from('clientes').delete().eq('id', id).select('id');
    setExcluindo(false);
    if (error) { Alert.alert('Erro', mensagemErroBanco(error, 'excluir a cliente')); return; }
    if (!data || data.length === 0) {
      Alert.alert('Sem permissão', 'Você não tem permissão para excluir clientes definitivamente.');
      return;
    }
    invalidarClientes();
    router.back();
  }

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded || isLoading) return null;

  if (!cliente) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15, color: C.text, textAlign: 'center' }}>
          {isError ? 'Não foi possível carregar a cliente.' : 'Cliente não encontrada.'}
        </Text>
        {isError && (
          <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 16 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.primary }}>Tentar novamente</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.primary }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const [c1, c2] = avatarColors(cliente.nome ?? '');

  const idade = idadeCliente(cliente.data_nascimento);
  const idadeLabel = idade !== null ? `${idade} anos` : null;
  const end = parseEndereco(cliente.endereco);
  const enderecoLinha = [end.logradouro, end.numero].filter(Boolean).join(', ');

  // Ficha no formato canônico (aceita também os formatos antigos) — igual ao web
  const fichaAnamnese = normalizarAnamnese(cliente.anamnese?.respostas);
  const restricoes = restricoesAnamnese(fichaAnamnese);
  const temAnamnese = anamnesePreenchida(fichaAnamnese);

  // Histórico e KPIs: fonte única de shared. Com erro de carga, "—" e aviso (nunca zero).
  const agregado = cliente.agregado;
  const erroHistorico = cliente.erroHistorico;
  const tags = tagsDaLinha(cliente, agregado ?? undefined, hojeBRT());
  const contatos = contatosCliente(cliente.telefone);
  const arquivada = cliente.ativo === false;
  const kpis = [
    { value: agregado ? String(agregado.atendimentos) : '—', label: 'Atendimentos', color: C.primary, secreto: false },
    { value: agregado ? formatarMoeda(agregado.totalGasto) : '—', label: 'Total gasto', color: C.green, secreto: !!agregado },
    { value: agregado ? textoKpiUltimaVisita(agregado.ultimaVisita) : '—', label: 'Última visita', color: C.text, secreto: false },
    { value: agregado ? (agregado.servicoFavorito?.nome ?? '—') : '—', label: 'Serviço favorito', color: C.accent, secreto: false },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Hero ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
        >
          {/* Back */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              width: 34, height: 34,
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
              borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>

          {/* Info */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <LinearGradient
              colors={[c1, c2]}
              style={{
                width: 60, height: 60, borderRadius: 18,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: '#fff' }}>
                {iniciaisNome(cliente.nome ?? '')}
              </Text>
            </LinearGradient>

            <View style={{ flex: 1 }}>
              <Text style={{
                fontFamily: 'Fraunces_600SemiBold',
                fontSize: 22, color: '#fff', lineHeight: 26, marginBottom: 4,
              }}>
                {cliente.nome}
              </Text>
              <Text style={{
                fontFamily: 'PlusJakartaSans_400Regular',
                fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6,
              }}>
                {cliente.telefone ?? 'Sem telefone'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {tags.map((tag) => {
                  return (
                    <View key={tag} style={{
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                      borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
                    }}>
                      <Text style={{
                        fontFamily: 'PlusJakartaSans_700Bold',
                        fontSize: 9, color: '#fff',
                        textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>
                        {tag}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Ações rápidas */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            {[
              // tel: só com os dígitos e wa.me com o DDI, de `contatosCliente` (igual ao web).
              { icon: <Phone size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Ligar', onPress: () => contatos && Linking.openURL(contatos.ligar) },
              { icon: <MessageCircle size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Mensagem', onPress: () => contatos && Linking.openURL(contatos.whatsapp) },
              { icon: <CalendarPlus size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Agendar', onPress: () => router.push(`/(empresa)/novo-agendamento?clienteId=${id}` as any) },
              // "Mais" só abre arquivar/excluir: some se a pessoa não pode nenhum dos dois.
              ...((podeArquivarCliente(pode) || pode('clientes.excluir'))
                ? [{ icon: <MoreHorizontal size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Mais', onPress: () => setModalRemover(true) }]
                : []),
            ].map((a) => (
              <TouchableOpacity
                key={a.label}
                onPress={a.onPress}
                style={{
                  flex: 1,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                  borderRadius: 12, paddingVertical: 10,
                  alignItems: 'center', gap: 5,
                }}
              >
                {a.icon}
                <Text style={{
                  fontFamily: 'PlusJakartaSans_600SemiBold',
                  fontSize: 10, color: 'rgba(255,255,255,0.6)',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </LinearGradient>

        {/* ── KPIs ── */}
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350 }}
          style={{
            marginHorizontal: 24, marginTop: -16,
            flexDirection: 'row', flexWrap: 'wrap', gap: 8,
          }}
        >
          {kpis.map((k) => (
            <View key={k.label} style={{
              flexBasis: '47%', flexGrow: 1, backgroundColor: C.surface,
              borderWidth: 1, borderColor: C.border,
              borderRadius: 14, padding: 12,
              shadowColor: C.primary, shadowOpacity: 0.08, shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 }, elevation: 3,
              alignItems: 'center',
            }}>
              {k.secreto ? (
                <SecretText
                  numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
                  style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: k.color, letterSpacing: -0.5, marginBottom: 2 }}
                >
                  {k.value}
                </SecretText>
              ) : (
                <Text
                  numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
                  style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: k.color, letterSpacing: -0.5, marginBottom: 2 }}
                >
                  {k.value}
                </Text>
              )}
              <Text style={{
                fontFamily: 'PlusJakartaSans_500Medium',
                fontSize: 9, color: C.text3,
                textTransform: 'uppercase', letterSpacing: 0.8,
              }}>
                {k.label}
              </Text>
            </View>
          ))}
        </MotiView>

        {/* ── Aviso de erro do histórico (KPIs mostram "—") ── */}
        {!!erroHistorico && (
          <TouchableOpacity
            onPress={() => refetch()}
            style={{
              marginHorizontal: 24, marginTop: 12,
              backgroundColor: C.redSoft, borderWidth: 1, borderColor: 'rgba(192,57,43,0.15)',
              borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
            }}
          >
            <AlertTriangle size={14} color={C.red} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.red }}>
                Não foi possível carregar o histórico.
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
                {erroHistorico} Toque para tentar novamente.
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Cliente arquivada: Reativar (mesma permissão de arquivar) ── */}
        {arquivada && (
          <View style={{
            marginHorizontal: 24, marginTop: 12,
            backgroundColor: C.amberSoft, borderWidth: 1, borderColor: 'rgba(180,83,9,0.15)',
            borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <Archive size={14} color={C.amber} strokeWidth={2} />
            <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.amber }}>
              Cliente arquivada: fora das listas e dos segmentos.
            </Text>
            {podeArquivarCliente(pode) && (
              <TouchableOpacity
                onPress={reativar}
                disabled={gravandoAtivo}
                style={{ backgroundColor: C.amber, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, opacity: gravandoAtivo ? 0.6 : 1 }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' }}>Reativar</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Tabs internos ── */}
        <View style={{
          marginHorizontal: 24, marginTop: 16, marginBottom: 16,
          backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
          borderRadius: 12, padding: 3, flexDirection: 'row',
          shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
        }}>
          {(['perfil', 'historico', 'anamnese'] as Aba[]).filter((a) => a !== 'anamnese' || pode('anamnese.ver')).map((a) => (
            <TouchableOpacity
              key={a}
              onPress={() => setAba(a)}
              style={{
                flex: 1, paddingVertical: 8,
                borderRadius: 10, alignItems: 'center',
                backgroundColor: aba === a ? C.primary : 'transparent',
              }}
            >
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold',
                fontSize: 11,
                color: aba === a ? '#fff' : C.text3,
                textTransform: 'capitalize',
              }}>
                {a === 'historico' ? 'Histórico' : a.charAt(0).toUpperCase() + a.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Aba: Perfil ── */}
        {aba === 'perfil' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }}>

            {/* Dados pessoais */}
            <View style={{
              marginHorizontal: 24, marginBottom: 14,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <View style={{
                padding: 14, flexDirection: 'row',
                justifyContent: 'space-between', alignItems: 'center',
                borderBottomWidth: 1, borderBottomColor: C.border,
              }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
                  Dados Pessoais
                </Text>
                {pode('clientes.editar') && (
                  <TouchableOpacity onPress={() => router.push(`/(empresa)/cliente/${id}/editar` as any)}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                      Editar
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <InfoRow icon={<Edit3 size={13} color={C.primary} strokeWidth={2} />} label="Nome completo" value={cliente.nome ?? '—'} iconBg={C.primarySoft} iconColor={C.primary} />
              {cliente.telefone && <InfoRow icon={<Phone size={13} color={C.green} strokeWidth={2} />} label="Telefone" value={cliente.telefone} iconBg={C.greenSoft} iconColor={C.green} />}
              {cliente.email && <InfoRow icon={<MessageCircle size={13} color={C.rose} strokeWidth={2} />} label="E-mail" value={cliente.email} iconBg={C.roseSoft} iconColor={C.rose} />}
              {formatarAniversario(cliente.data_nascimento) !== '' && (
                <InfoRow
                  icon={<CalendarPlus size={13} color={C.amber} strokeWidth={2} />}
                  label="Data de nascimento"
                  value={`${formatarAniversario(cliente.data_nascimento)}${idadeLabel ? ` · ${idadeLabel}` : ''}`}
                  iconBg={C.amberSoft} iconColor={C.amber}
                />
              )}
              {/* Remove border from last item */}
              <View style={{ borderBottomWidth: 0 }}>
                {enderecoLinha !== '' && <InfoRow icon={<MapPin size={13} color={C.accent} strokeWidth={2} />} label="Endereço" value={enderecoLinha} iconBg={C.primarySoft} iconColor={C.accent} />}
                {end.bairro !== '' && <InfoRow icon={<MapPin size={13} color={C.accent} strokeWidth={2} />} label="Bairro" value={end.bairro} iconBg={C.primarySoft} iconColor={C.accent} />}
                {end.complemento !== '' && <InfoRow icon={<MapPin size={13} color={C.accent} strokeWidth={2} />} label="Complemento" value={end.complemento} iconBg={C.primarySoft} iconColor={C.accent} />}
                {cliente.observacoes && <InfoRow icon={<FileText size={13} color={C.text3} strokeWidth={2} />} label="Observações internas" value={cliente.observacoes} iconBg={C.primarySoft} iconColor={C.text3} />}
              </View>
            </View>

            {/* Alerta se tiver alertas na anamnese */}
            {restricoes.length > 0 && pode('anamnese.ver') && (
              <TouchableOpacity
                onPress={() => setAba('anamnese')}
                style={{
                  marginHorizontal: 24, marginBottom: 14,
                  backgroundColor: C.amberSoft,
                  borderWidth: 1, borderColor: 'rgba(180,83,9,0.15)',
                  borderRadius: 14, padding: 14,
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                }}
              >
                <View style={{
                  width: 30, height: 30, backgroundColor: 'rgba(180,83,9,0.1)',
                  borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                }}>
                  <AlertTriangle size={14} color={C.amber} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.amber }}>
                    Atenção: restrições na anamnese
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
                    {restricoes.join(' · ')}
                  </Text>
                </View>
                <ChevronLeft size={14} color={C.amber} strokeWidth={2} style={{ transform: [{ rotate: '180deg' }] }} />
              </TouchableOpacity>
            )}
          </MotiView>
        )}

        {/* ── Aba: Histórico (lista única por data, fonte única de shared) ── */}
        {aba === 'historico' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }}>
            <View style={{ paddingHorizontal: 24, gap: 6 }}>
              {erroHistorico ? (
                <View style={{
                  backgroundColor: C.redSoft, borderWidth: 1, borderColor: 'rgba(192,57,43,0.15)',
                  borderRadius: 16, padding: 24, alignItems: 'center', gap: 10,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.red, textAlign: 'center' }}>
                    Não foi possível carregar o histórico.
                  </Text>
                  <TouchableOpacity onPress={() => refetch()}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.primary }}>Tentar novamente</Text>
                  </TouchableOpacity>
                </View>
              ) : cliente.historico.length === 0 ? (
                <View style={{
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  borderRadius: 16, padding: 24, alignItems: 'center',
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                    Nenhum registro no histórico
                  </Text>
                </View>
              ) : (
                cliente.historico.map((item) => <LinhaHistorico key={`${item.tipo}-${item.id}`} item={item} />)
              )}
            </View>
          </MotiView>
        )}

        {/* ── Aba: Anamnese ── */}
        {aba === 'anamnese' && pode('anamnese.ver') && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }}>
            <View style={{ paddingHorizontal: 24 }}>
              {!temAnamnese ? (
                <View style={{
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  borderRadius: 16, padding: 24, alignItems: 'center', gap: 12,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                    Ficha de anamnese não preenchida
                  </Text>
                  {podeEditarAnamnese(pode) && (
                    <TouchableOpacity
                      onPress={() => router.push(`/(empresa)/cliente/${id}/anamnese` as any)}
                      style={{
                        backgroundColor: C.primary, borderRadius: 12,
                        paddingHorizontal: 20, paddingVertical: 10,
                      }}
                    >
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                        Preencher agora
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <>
                  <View style={{
                    flexDirection: 'row', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 10,
                  }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                      Ficha de Anamnese
                    </Text>
                    {podeEditarAnamnese(pode) && (
                      <TouchableOpacity onPress={() => router.push(`/(empresa)/cliente/${id}/anamnese` as any)}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>Editar</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{
                    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                    borderRadius: 18, overflow: 'hidden',
                    shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
                  }}>
                    {PERGUNTAS_SIM_NAO.map((p) => {
                      const r = fichaAnamnese[p.key];
                      const texto = r.resposta === 'sim' ? (r.detalhe ? `Sim — ${r.detalhe}` : 'Sim')
                        : r.resposta === 'nao' ? 'Não' : 'Não respondido';
                      const alerta = r.resposta === 'sim' && ehRestricao(p.key);
                      return (
                        <AnamneseRow
                          key={p.key} pergunta={p.label} resposta={texto}
                          tipo={alerta ? 'alerta' : r.resposta === 'nao' ? 'ok' : 'neutro'}
                        />
                      );
                    })}
                    {PERGUNTAS_OPCOES.map((p) => {
                      const rotulo = p.opcoes.find((o) => o.valor === fichaAnamnese[p.key])?.rotulo;
                      return (
                        <AnamneseRow key={p.key} pergunta={p.label} resposta={rotulo ?? 'Não respondido'} tipo="neutro" />
                      );
                    })}
                    {!!fichaAnamnese.info_adicionais && (
                      <AnamneseRow pergunta="Informações adicionais" resposta={fichaAnamnese.info_adicionais} tipo="neutro" />
                    )}
                    <AnamneseRow
                      pergunta="Declaração"
                      resposta={fichaAnamnese.declaracao_aceita ? 'Declaração aceita' : 'Declaração não aceita'}
                      tipo={fichaAnamnese.declaracao_aceita ? 'ok' : 'neutro'}
                    />
                  </View>
                </>
              )}
            </View>
          </MotiView>
        )}

      </ScrollView>

      {/* Modal de escolha: arquivar ou excluir */}
      <Modal visible={modalRemover} transparent animationType="fade" onRequestClose={() => setModalRemover(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setModalRemover(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}
            style={{ backgroundColor: C.surface, borderRadius: 20, padding: 20, width: '100%', maxWidth: 340 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>Remover cliente</Text>
              <TouchableOpacity onPress={() => setModalRemover(false)}>
                <X size={18} color={C.text4} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, marginBottom: 14 }}>
              O que você deseja fazer com "{cliente?.nome}"?
            </Text>
            {podeArquivarCliente(pode) && (
            <TouchableOpacity onPress={arquivada ? reativar : arquivar} disabled={gravandoAtivo}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 10, opacity: gravandoAtivo ? 0.6 : 1 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: arquivada ? C.greenSoft : C.amberSoft, alignItems: 'center', justifyContent: 'center' }}>
                {arquivada ? <ArchiveRestore size={16} color={C.green} /> : <Archive size={16} color={C.amber} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{arquivada ? 'Reativar' : 'Arquivar'}</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>
                  {arquivada ? 'Volta para as listas e os segmentos' : 'Some das listas, mas o histórico é mantido'}
                </Text>
              </View>
            </TouchableOpacity>
            )}
            {pode('clientes.excluir') && (
            <TouchableOpacity onPress={pedirExclusao} disabled={excluindo}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border, opacity: excluindo ? 0.6 : 1 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.roseSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={16} color={C.rose} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>Excluir permanentemente</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>Apaga para sempre — só é possível sem histórico</Text>
              </View>
            </TouchableOpacity>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
