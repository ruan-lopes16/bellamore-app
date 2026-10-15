import { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, Alert, RefreshControl, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Phone, Edit3, Plus, RotateCcw, Percent, PowerOff, UserCog, CheckCircle2,
} from 'lucide-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { chaveMesBRT, rotuloMesAno } from '@shared/periodos';
import { carregarEquipe, alterarAtivo, alterarPapel, type MembroEquipe } from '@shared/equipe-consultas';
import { rotuloContrato, numerosVisiveis } from '@shared/equipe';
import { pagarComissoes } from '@shared/comissoes-consultas';
import { MENSAGEM_PAGAMENTO_PARCIAL } from '@shared/comissoes';

import { useAuthStore } from '@/stores/authStore';
import { usePermissoes, podeAtribuirRole } from '@/lib/permissions';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import { SecretText, PrivacyToggle } from '@/components/Secret';
import { BotaoExportar } from '@/components/BotaoExportar';
import { definicaoEquipe } from '@shared/exportacao/equipe';
import { supabase } from '@/lib/supabase';
import { configVazia, contarExcecoes, podeGerenciarMembro } from '@shared/permissoes';
import { carregarConfigPermissoes } from '@shared/permissoes-consultas';
import { formatarMoeda } from '@shared/moeda';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  blue: '#3B82F6', blueSoft: '#EAF2FE',
  rose: '#C9527F', roseSoft: '#FCEEF3',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
];

// ── Helpers ──────────────────────────────────────────────────

function avatarColors(nome: string): [string, string] {
  return AVATAR_COLORS[(nome?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}
function iniciaisNome(nome: string) {
  return (nome ?? '').split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}
function roleBadge(role: MembroEquipe['role']) {
  if (role === 'owner')  return { label: 'Dono(a)',      bg: C.primarySoft, color: C.primary };
  if (role === 'gestor') return { label: 'Gestor(a)',    bg: C.blueSoft,    color: C.blue };
  return                        { label: 'Profissional', bg: '#F3F4F6',     color: C.text3 };
}

// ── Hook ─────────────────────────────────────────────────────

/** Equipe do mês atual (Brasília) pela mesma função do web; a dona aparece na lista. */
function useEquipe(habilitado: boolean) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const mes = chaveMesBRT(new Date());

  return useQuery({
    queryKey: ['equipe', empresaId, mes],
    enabled: !!empresaId && habilitado,
    // Sempre refaz ao voltar à tela: pagamentos, comandas e status mudam os números em outras telas.
    staleTime: 0,
    queryFn: () => carregarEquipe(supabase, empresaId!, mes),
  });
}

// ── Card de profissional ──────────────────────────────────────

function ProfCard({ membro, visiveis, podeAlterarRole, podeGerenciar, podePagar, pagando, excecoes, onVerExcecoes, onEditar, onToggle, onPagar, onAlterarRole }: {
  membro: MembroEquipe;
  /** Números que a pessoa logada pode ver (`numerosVisiveis`): sem a chave, "—" em vez de zeros falsos. */
  visiveis: { producao: boolean; comissao: boolean };
  /** Quantidade de exceções individuais de permissão (0 = sem selo). */
  excecoes: number;
  onVerExcecoes: () => void;
  /** Editar, ativar/desativar — mesma regra do web (`podeGerenciarMembro`). */
  podeGerenciar: boolean;
  podeAlterarRole: boolean;
  /** `comissoes.pagar` — o banco exige essa chave no UPDATE de `comissoes`. */
  podePagar: boolean;
  pagando: boolean;
  onEditar: () => void;
  onToggle: () => void;
  onPagar: () => void;
  onAlterarRole: () => void;
}) {
  const [c1, c2] = membro.ativo ? avatarColors(membro.user.nome) : ['#9CA3AF', '#6B7280'];
  const badge = roleBadge(membro.role);
  const temPendente = visiveis.comissao && membro.comissao_pendente > 0;

  function ligar() {
    if (membro.user.telefone) Linking.openURL(`tel:${membro.user.telefone}`);
  }
  function whatsapp() {
    if (membro.user.telefone) Linking.openURL(`https://wa.me/55${membro.user.telefone.replace(/\D/g, '')}`);
  }

  return (
    <MotiView
      from={{ opacity: 0, translateY: 6 }}
      animate={{ opacity: membro.ativo ? 1 : 0.55, translateY: 0 }}
      transition={{ type: 'timing', duration: 320 }}
      style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 18, padding: 16, marginBottom: 12,
        shadowColor: C.primary, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
      }}
    >
      {/* Topo: avatar + info + editar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <LinearGradient
          colors={[c1, c2]}
          style={{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: '#fff' }}>
            {iniciaisNome(membro.user.nome)}
          </Text>
        </LinearGradient>

        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.text, marginBottom: 2 }}>
            {membro.user.nome}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
            {membro.user.telefone ?? 'Sem telefone'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            <View style={{ backgroundColor: membro.ativo ? C.greenSoft : '#F3F4F6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: membro.ativo ? C.green : C.text4, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                {membro.ativo ? 'Ativa' : 'Inativa'}
              </Text>
            </View>
            <View style={{ backgroundColor: badge.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: badge.color, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                {badge.label}
              </Text>
            </View>
            {membro.role !== 'owner' && excecoes > 0 && (
              <TouchableOpacity
                onPress={onVerExcecoes}
                style={{ backgroundColor: C.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: C.primary, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {excecoes} {excecoes === 1 ? 'exceção' : 'exceções'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {podeGerenciar && (
          <TouchableOpacity onPress={onEditar} hitSlop={10}>
            <Edit3 size={16} color={C.text4} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>

      {/* Stats do mês */}
      {membro.ativo && (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {[
            { value: visiveis.producao ? String(membro.atendimentos_mes) : '—', label: 'Atendimentos', color: C.primary },
            { value: visiveis.producao ? formatarMoeda(membro.total_mes) : '—',  label: 'Faturado no mês', color: C.green },
          ].map((s) => (
            <View key={s.label} style={{
              flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 10, alignItems: 'center',
            }}>
              <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.3, marginBottom: 2 }}>
                {s.value}
              </SecretText>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center' }}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Comissão % (editar abre a tela de edição — uma única forma de gravar) */}
      {membro.ativo && (
        <TouchableOpacity
          onPress={onEditar}
          disabled={!podeGerenciar}
          style={{
            backgroundColor: C.primarySoft,
            borderRadius: 12, padding: 12, paddingHorizontal: 14,
            flexDirection: 'row', alignItems: 'center', gap: 10,
            marginBottom: 12,
          }}
        >
          <Percent size={14} color={C.primary} strokeWidth={2} />
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, flex: 1 }}>
            Comissão por atendimento
          </Text>
          <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: C.primary, letterSpacing: -0.5 }}>
            {`${membro.percentual_comissao}%`}
          </SecretText>
          {podeGerenciar && <Edit3 size={13} color={C.text3} strokeWidth={2} />}
        </TouchableOpacity>
      )}

      {/* Tipo de contrato */}
      {membro.tipo_contrato && (
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text4, marginBottom: 12 }}>
          {rotuloContrato(membro.tipo_contrato)}
        </Text>
      )}

      {/* Pagar comissão do mês */}
      {membro.ativo && temPendente && podePagar && (
        <TouchableOpacity
          onPress={onPagar}
          disabled={pagando}
          style={{
            height: 42, borderRadius: 12, marginBottom: 10,
            backgroundColor: pagando ? '#F3F4F6' : C.amber,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
            opacity: pagando ? 0.7 : 1,
          }}
        >
          <CheckCircle2 size={14} color={pagando ? C.text4 : '#fff'} strokeWidth={2.5} />
          {pagando ? (
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text4 }}>Registrando...</Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Pagar </Text>
              <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>
                {formatarMoeda(membro.comissao_pendente)}
              </SecretText>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}> do mês</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Pendente do mês sem permissão de pagar: só informa */}
      {membro.ativo && temPendente && !podePagar && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.amberSoft, borderRadius: 12, padding: 10, marginBottom: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.amber }}>Comissão pendente do mês: </Text>
          <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.amber }}>
            {formatarMoeda(membro.comissao_pendente)}
          </SecretText>
        </View>
      )}

      {membro.ativo && visiveis.comissao && membro.comissao_pendente_anterior > 0 && (
        <TouchableOpacity onPress={() => router.push('/(empresa)/comissoes' as any)} style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.amber }}>+ </Text>
          <SecretText style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.amber }}>
            {formatarMoeda(membro.comissao_pendente_anterior)}
          </SecretText>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.amber }}> de meses anteriores — pague em Comissões</Text>
        </TouchableOpacity>
      )}

      {/* Sem comissoes.ver_todas a RLS esconde as comissões da colega: nunca "Comissão em dia" falso. */}
      {membro.ativo && !visiveis.comissao && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 12, padding: 10, marginBottom: 12 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3 }}>Comissão pendente: —</Text>
        </View>
      )}

      {membro.ativo && visiveis.comissao && !temPendente && membro.comissao_pendente_anterior === 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.greenSoft, borderRadius: 12, padding: 10, marginBottom: 12 }}>
          <CheckCircle2 size={13} color={C.green} strokeWidth={2.5} />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.green }}>Comissão em dia</Text>
        </View>
      )}

      {podeAlterarRole && (
        <TouchableOpacity
          onPress={onAlterarRole}
          style={{
            padding: 10, borderRadius: 10, marginBottom: 8,
            borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <UserCog size={13} color={C.text2} strokeWidth={2} />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>
            {membro.role === 'gestor' ? 'Rebaixar para profissional' : 'Promover a gestora'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Ações */}
      {membro.ativo ? (
        <>
          {membro.user.telefone ? (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: podeGerenciar ? 8 : 0 }}>
              {[
                { icon: <Phone size={13} color={C.text2} strokeWidth={2} />, label: 'Ligar', onPress: ligar },
                { icon: <MaterialCommunityIcons name="whatsapp" size={15} color={C.green} />, label: 'WhatsApp', onPress: whatsapp },
              ].map((a) => (
                <TouchableOpacity
                  key={a.label}
                  onPress={a.onPress}
                  style={{
                    flex: 1, padding: 10, borderRadius: 10,
                    borderWidth: 1, borderColor: C.border,
                    backgroundColor: C.bg,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}
                >
                  {a.icon}
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text2 }}>
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {podeGerenciar && (
            <TouchableOpacity
              onPress={onToggle}
              style={{
                padding: 10, borderRadius: 10,
                borderWidth: 1, borderColor: 'rgba(201,82,127,0.3)',
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <PowerOff size={13} color={C.rose} strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.rose }}>
                Desativar profissional
              </Text>
            </TouchableOpacity>
          )}
        </>
      ) : podeGerenciar && (
        <TouchableOpacity
          onPress={onToggle}
          style={{
            padding: 10, borderRadius: 10,
            borderWidth: 1, borderColor: C.border,
            backgroundColor: C.bg,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <RotateCcw size={14} color={C.primary} strokeWidth={2} />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.primary }}>
            Reativar profissional
          </Text>
        </TouchableOpacity>
      )}
    </MotiView>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Equipe() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva, isOwner, user, roleAtivo } = useAuthStore();
  const { pode, papel, permissoesCarregadas } = usePermissoes();
  // O selo leva à aba Permissões, que só dona/gestora enxergam.
  const veSeloExcecoes = isOwner || papel === 'gestor';
  const podeGerenciarEquipe = pode('equipe.gerenciar');
  const podePagar = pode('comissoes.pagar');
  const qc = useQueryClient();

  const { data: membros = [], isLoading, isFetching, isError, error, refetch } = useEquipe(podeGerenciarEquipe);
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const pagandoRef = useRef(false);

  const { data: cfgPermissoes } = useQuery({
    queryKey: ['equipe-permissoes', empresaAtiva?.id],
    enabled: !!empresaAtiva?.id && veSeloExcecoes && podeGerenciarEquipe,
    staleTime: 1000 * 60,
    queryFn: () => carregarConfigPermissoes(supabase, empresaAtiva!.id).catch(() => configVazia()),
  });

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  if (permissoesCarregadas && !podeGerenciarEquipe) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text3, textAlign: 'center' }}>
          Sem permissão para gerenciar a equipe
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const empresaId = empresaAtiva?.id;
  const meuRole = isOwner ? 'owner' : (roleAtivo ?? 'profissional');
  const ativos   = membros.filter((m) => m.ativo).length;
  const inativos = membros.length - ativos;
  const mesChave = chaveMesBRT(new Date());
  const mesNome  = rotuloMesAno(mesChave);
  // Sem permissões ou empresa ainda: só carregamento — nunca zeros, "Nenhuma profissional" nem o botão de adicionar.
  const carregando = !permissoesCarregadas || !empresaAtiva || isLoading;
  // Em erro sem dados: só o banner — nunca "nenhuma profissional" com zeros.
  const semDados = isError && membros.length === 0;
  const erroCarga = isError ? (error instanceof Error ? error.message : 'Não foi possível carregar a equipe.') : '';

  /** Recarrega a equipe (aguardável) e invalida profissionais e os números financeiros. */
  function invalidarTudo() {
    qc.invalidateQueries({ queryKey: ['profissionais'] });
    invalidarFinanceiro(qc);
    return qc.invalidateQueries({ queryKey: ['equipe'] });
  }

  async function gravarAtivo(m: MembroEquipe, ativo: boolean) {
    if (!empresaId) return;
    try {
      await alterarAtivo(supabase, empresaId, m.id, ativo);
    } catch (e) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível salvar.');
      return;
    }
    invalidarTudo();
  }

  function toggleAtivo(m: MembroEquipe) {
    if (!m.ativo) { gravarAtivo(m, true); return; }
    Alert.alert(
      'Desativar profissional',
      `"${m.user.nome}" não aparecerá em novos agendamentos. Esta ação pode ser desfeita reativando o perfil.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Desativar', style: 'destructive', onPress: () => { gravarAtivo(m, false); } },
      ],
    );
  }

  async function trocarPapel(m: MembroEquipe) {
    if (!empresaId || m.role === 'owner') return;
    const novoRole = m.role === 'gestor' ? 'profissional' : 'gestor';
    try {
      await alterarPapel(supabase, empresaId, m.id, novoRole);
    } catch (e) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível trocar o papel.');
      return;
    }
    invalidarTudo();
  }

  /** Pagar = só as pendentes do MÊS ATUAL (decisão do dono); as anteriores ficam para a tela Comissões. Sem otimismo. */
  async function pagarDoMes(m: MembroEquipe) {
    if (!empresaId || pagandoRef.current || m.ids_pendentes_mes.length === 0) return;
    pagandoRef.current = true;
    setPagandoId(m.id);
    try {
      const r = await pagarComissoes(supabase, empresaId, m.ids_pendentes_mes);
      if (r.naoConfirmados.length > 0) {
        Alert.alert('Erro', r.erro ? `Erro ao registrar o pagamento: ${r.erro}` : MENSAGEM_PAGAMENTO_PARCIAL);
      }
      await invalidarTudo();
    } finally {
      pagandoRef.current = false;
      setPagandoId(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {/* ── Header ── */}
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
                Equipe
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <PrivacyToggle />
            <BotaoExportar
              definicao={definicaoEquipe(mesChave)}
              getLinhas={() => membros.map((m) => {
                const v = numerosVisiveis(user?.id, m.user_id, pode);
                return { nome: m.user.nome, telefone: m.user.telefone ?? null, percentual: m.percentual_comissao,
                  atendimentosMes: v.producao ? m.atendimentos_mes : null, totalMes: v.producao ? m.total_mes : null, ativo: m.ativo };
              })}
              cor="#fff"
            />
            {!carregando && (
            <TouchableOpacity
              onPress={() => router.push('/(empresa)/convidar-profissional' as any)}
              style={{
                width: 38, height: 38,
                backgroundColor: 'rgba(255,255,255,0.15)',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
                borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Plus size={18} color="#fff" strokeWidth={2.5} />
            </TouchableOpacity>
            )}
            </View>
          </View>
        </LinearGradient>

        {/* ── Erro de carga ── */}
        {erroCarga ? (
          <View style={{ marginHorizontal: 24, marginTop: 16, backgroundColor: C.roseSoft, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.rose, lineHeight: 18 }}>
              {erroCarga}
            </Text>
            <TouchableOpacity onPress={() => refetch()}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.rose, textDecorationLine: 'underline' }}>
                Tentar de novo
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Stats ── */}
        {!semDados && !carregando && (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350, delay: 60 }}
            style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16, marginBottom: 20 }}
          >
            {[
              { value: membros.length, label: 'Total',    color: C.primary },
              { value: ativos,         label: 'Ativas',   color: C.green },
              { value: inativos,       label: 'Inativas', color: C.text3 },
            ].map((s) => (
              <View key={s.label} style={{
                flex: 1, backgroundColor: C.surface,
                borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12,
                shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
                alignItems: 'center',
              }}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: s.color, letterSpacing: -0.5, lineHeight: 24, marginBottom: 3 }}>
                  {s.value}
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {s.label}
                </Text>
              </View>
            ))}
          </MotiView>
        )}

        {carregando && (
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text3, textAlign: 'center', marginTop: 32 }}>
            Carregando a equipe...
          </Text>
        )}

        {/* ── Lista ── */}
        {!semDados && !carregando && (
          <>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginHorizontal: 24, marginBottom: 12 }}>
              {mesNome} · {ativos} {ativos === 1 ? 'profissional ativa' : 'profissionais ativas'}
            </Text>

            <View style={{ paddingHorizontal: 24 }}>
              {membros.map((m) => (
                <ProfCard
                  key={m.id}
                  membro={m}
                  visiveis={numerosVisiveis(user?.id, m.user_id, pode)}
                  podeAlterarRole={podeAtribuirRole(meuRole, 'gestor') && m.role !== 'owner' && m.user_id !== user?.id}
                  podeGerenciar={podeGerenciarMembro({ isOwner, userId: user?.id ?? '' }, podeGerenciarEquipe, { role: m.role, userId: m.user_id })}
                  podePagar={podePagar}
                  pagando={pagandoId === m.id}
                  excecoes={veSeloExcecoes && cfgPermissoes ? contarExcecoes(cfgPermissoes, m.user_id) : 0}
                  onVerExcecoes={() => router.push(`/(empresa)/configuracoes?aba=permissoes&membro=${m.user_id}` as any)}
                  onEditar={() => router.push(`/(empresa)/editar-profissional/${m.id}` as any)}
                  onToggle={() => toggleAtivo(m)}
                  onPagar={() => pagarDoMes(m)}
                  onAlterarRole={() => trocarPapel(m)}
                />
              ))}

              {membros.length === 0 && (
                <View style={{
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  borderRadius: 16, padding: 32, alignItems: 'center', gap: 12,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                    Nenhuma profissional na equipe ainda.
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push('/(empresa)/convidar-profissional' as any)}
                    style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                      Adicionar profissional
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
