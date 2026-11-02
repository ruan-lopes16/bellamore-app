import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Image,
  Alert, ActivityIndicator, StatusBar, Switch,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import * as ImagePicker from 'expo-image-picker';
import {
  Store, Phone, MapPin, FileText, User, Lock, Target,
  Camera, LogOut, Save, ChevronLeft, Image as ImageIcon, Percent,
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
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/stores/authStore';
import { usePermissoes } from '@/lib/permissions';
import { SmoothTabs } from '@/components/SmoothTabs';
import { PermissoesPanel } from '@/components/PermissoesPanel';
import { supabase } from '@/lib/supabase';
import { comTemaDoUsuario, useTema, TemaClaroFixo, PALETA_CLARA } from '@/lib/tema';
import { validarSenhaOpcionalComConfirmacao } from '@shared/senha';
import { formatValorMonetarioInput, parseValorMonetario } from '@shared/despesas';
import { mensagemErroBanco } from '@shared/erros';
import { maskCNPJ, validaCNPJ, maskCEP, maskPhone, maskMoeda, formatMoeda, parseMoeda, digits } from '@shared/mascaras';
import { lerEnderecoEmpresa, serializarEnderecoEmpresa, type EnderecoEmpresa } from '@shared/endereco';
import {
  SEGMENTOS_EMPRESA, enderecoDoViaCep, dadosDoCnpj, caminhoLogoEmpresa, validarArquivoLogo, montarPayloadEmpresa,
  MENSAGEM_ALTERACOES_NAO_SALVAS, temAlteracoes,
} from '@shared/configuracoes-empresa';
import { salvarPreferenciaAgenda, type PreferenciaAgenda } from '@shared/agenda-consultas';
import { chavePreferenciaAgenda, usePreferenciaAgenda } from '@/hooks/usePreferenciaAgenda';
import { CartoesConfig } from '@/components/configuracoes/CartoesConfig';
import { CampoConfig as Campo } from '@/components/configuracoes/CampoConfig';
import { CardNotificacoesCelular } from '@/components/configuracoes/CardNotificacoesCelular';
import { SeletorModoTema } from '@/components/configuracoes/SeletorModoTema';
import { TrocarEmail } from '@/components/configuracoes/TrocarEmail';

// ── Constantes ───────────────────────────────────────────────

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const;
const DIAS_LABEL: Record<typeof DIAS[number], string> = {
  seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui',
  sex: 'Sex', sab: 'Sáb', dom: 'Dom',
};

type Dia = typeof DIAS[number];

interface HorarioDia {
  aberto: boolean;
  inicio: string;
  fim: string;
}

type Horarios = Record<Dia, HorarioDia>;

const HORARIO_DEFAULT: Horarios = {
  seg: { aberto: true,  inicio: '08:00', fim: '18:00' },
  ter: { aberto: true,  inicio: '08:00', fim: '18:00' },
  qua: { aberto: true,  inicio: '08:00', fim: '18:00' },
  qui: { aberto: true,  inicio: '08:00', fim: '18:00' },
  sex: { aberto: true,  inicio: '08:00', fim: '18:00' },
  sab: { aberto: true,  inicio: '09:00', fim: '14:00' },
  dom: { aberto: false, inicio: '09:00', fim: '13:00' },
};

/** Extensão → tipo, quando o seletor de imagens não informa o `mimeType`. */
const MIME_POR_EXTENSAO: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// ── Helpers ──────────────────────────────────────────────────

function initials(nome: string) {
  return nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

// ── Tela principal ───────────────────────────────────────────

function Configuracoes() {
  const { C } = useTema();
  const insets = useSafeAreaInsets();
  const { empresaAtiva, user, sair, roleAtivo, isOwner: souOwner, selecionarEmpresa } = useAuthStore();
  const qc = useQueryClient();
  const { pode, papel } = usePermissoes();
  const params = useLocalSearchParams<{ aba?: string; membro?: string }>();
  // Dados da empresa (logo, CNPJ, endereço, segmento, meta, horários) só a dona; as taxas seguem a
  // chave config.taxas — quem tem só ela vê só as taxas (decisão de 29/09; trigger da 083).
  const ehDona = pode('dona');
  const podeEditarTaxa = pode('config.taxas');
  // Abas: Empresa (dona ou quem tem config.taxas), Permissões (dona/gestora), Meu perfil (todos).
  const veEmpresa = pode('dona') || pode('config.taxas');
  const vePermissoes = pode('dona') || papel === 'gestor';
  const abasDisponiveis = [
    ...(veEmpresa ? [{ key: 'empresa', label: 'Empresa' }] : []),
    ...(vePermissoes ? [{ key: 'permissoes', label: 'Permissões' }] : []),
    { key: 'perfil', label: 'Meu perfil' },
  ];
  const [abaEscolhida, setAbaEscolhida] = useState<string | null>(null);
  // Aba pedida pela URL só vale se a pessoa tem permissão; senão cai na primeira disponível.
  const abaInicial = abasDisponiveis.some(a => a.key === params.aba) ? (params.aba as string) : abasDisponiveis[0].key;
  const aba = abaEscolhida && abasDisponiveis.some(a => a.key === abaEscolhida) ? abaEscolhida : abaInicial;

  // Dados da empresa
  const [nomeEmpresa,  setNomeEmpresa]  = useState(empresaAtiva?.nome ?? '');
  const [segmento,     setSegmento]     = useState(empresaAtiva?.segmento ?? 'Estúdio');
  const [telefoneEmp,  setTelefoneEmp]  = useState(maskPhone(empresaAtiva?.telefone ?? ''));
  const [cnpj,         setCnpj]         = useState(maskCNPJ(empresaAtiva?.cnpj ?? ''));
  const [metaMensal,   setMetaMensal]   = useState(empresaAtiva?.meta_mensal ? formatMoeda(Number(empresaAtiva.meta_mensal)) : '');
  // Endereço em campos, pela regra única de shared (JSON; lê também o formato antigo e texto livre).
  const [endereco,     setEndereco]     = useState<EnderecoEmpresa>(() => lerEnderecoEmpresa(empresaAtiva?.endereco));
  const [buscandoCep,  setBuscandoCep]  = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [logoUrl,      setLogoUrl]      = useState(empresaAtiva?.logo_url ?? '');
  const [enviandoLogo, setEnviandoLogo] = useState(false);

  function setCampoEndereco(campo: keyof EnderecoEmpresa, valor: string) {
    setEndereco((e) => ({ ...e, [campo]: valor }));
  }

  // Horários — carrega do banco ou usa default
  const horariosRaw = (empresaAtiva?.horario_funcionamento ?? {}) as Partial<Horarios>;
  const [horarios, setHorarios] = useState<Horarios>(() => ({
    ...HORARIO_DEFAULT,
    ...horariosRaw,
  }));

  // Taxa de cancelamento
  const [taxaAtiva, setTaxaAtiva] = useState(empresaAtiva?.taxa_cancelamento_ativa ?? false);
  const [taxaModo, setTaxaModo] = useState<'percentual' | 'fixo'>(
    (empresaAtiva?.taxa_cancelamento_modo as 'percentual' | 'fixo') ?? 'percentual'
  );
  const [taxaValor, setTaxaValor] = useState(
    formatValorMonetarioInput(Number(empresaAtiva?.taxa_cancelamento_valor ?? 0))
  );
  const [taxaAplicaCancelado, setTaxaAplicaCancelado] = useState(empresaAtiva?.taxa_cancelamento_aplica_cancelado ?? true);
  const [taxaAplicaFaltou, setTaxaAplicaFaltou] = useState(empresaAtiva?.taxa_cancelamento_aplica_faltou ?? true);

  // Taxa de reserva
  const [reservaAtiva, setReservaAtiva] = useState(empresaAtiva?.taxa_reserva_ativa ?? false);
  const [reservaModo, setReservaModo] = useState<'percentual' | 'fixo'>(
    (empresaAtiva?.taxa_reserva_modo as 'percentual' | 'fixo') ?? 'percentual'
  );
  const [reservaValor, setReservaValor] = useState(
    formatValorMonetarioInput(Number(empresaAtiva?.taxa_reserva_valor ?? 0))
  );

  // Minha conta (as preferências de notificação ficam no card, salvas na hora)
  const [nomeUser,     setNomeUser]     = useState(user?.nome ?? '');
  const [telefoneUser, setTelefoneUser] = useState(maskPhone(user?.telefone ?? ''));
  const [novaSenha,    setNovaSenha]    = useState('');
  const [confirmaSenha, setConfirmaSenha] = useState('');

  const [salvando, setSalvando] = useState(false);

  // O Salvar grava só a aba aberta: guarda o que foi carregado/salvo de cada aba para avisar
  // antes de trocar com alterações pendentes (senão a pessoa salvaria a outra aba achando que
  // salvou tudo).
  const formEmpresa = {
    nomeEmpresa, segmento, telefoneEmp, cnpj, metaMensal, endereco, horarios,
    taxaAtiva, taxaModo, taxaValor, taxaAplicaCancelado, taxaAplicaFaltou, reservaAtiva, reservaModo, reservaValor,
  };
  const formPerfil = { nomeUser, telefoneUser, novaSenha, confirmaSenha };
  const [salvoEmpresa, setSalvoEmpresa] = useState(() => formEmpresa);
  const [salvoPerfil,  setSalvoPerfil]  = useState(() => formPerfil);

  function restaurarEmpresa(s: typeof formEmpresa) {
    setNomeEmpresa(s.nomeEmpresa); setSegmento(s.segmento); setTelefoneEmp(s.telefoneEmp); setCnpj(s.cnpj);
    setMetaMensal(s.metaMensal); setEndereco(s.endereco); setHorarios(s.horarios);
    setTaxaAtiva(s.taxaAtiva); setTaxaModo(s.taxaModo); setTaxaValor(s.taxaValor);
    setTaxaAplicaCancelado(s.taxaAplicaCancelado); setTaxaAplicaFaltou(s.taxaAplicaFaltou);
    setReservaAtiva(s.reservaAtiva); setReservaModo(s.reservaModo); setReservaValor(s.reservaValor);
  }
  function restaurarPerfil(s: typeof formPerfil) {
    setNomeUser(s.nomeUser); setTelefoneUser(s.telefoneUser); setNovaSenha(s.novaSenha); setConfirmaSenha(s.confirmaSenha);
  }

  function trocarAba(nova: string) {
    if (nova === aba) return;
    const pendente = aba === 'empresa' ? temAlteracoes(salvoEmpresa, formEmpresa)
      : aba === 'perfil' ? temAlteracoes(salvoPerfil, formPerfil) : false;
    if (!pendente) { setAbaEscolhida(nova); return; }
    Alert.alert('Alterações não salvas', MENSAGEM_ALTERACOES_NAO_SALVAS, [
      { text: 'Continuar editando', style: 'cancel' },
      {
        text: 'Descartar', style: 'destructive',
        onPress: () => {
          if (aba === 'empresa') restaurarEmpresa(salvoEmpresa); else restaurarPerfil(salvoPerfil);
          setAbaEscolhida(nova);
        },
      },
    ]);
  }

  // "Minha agenda abre em": salva na hora (não depende do botão Salvar) e mostra o retorno.
  const prefAgenda = usePreferenciaAgenda();
  const [salvandoPref, setSalvandoPref] = useState(false);
  const [msgPref, setMsgPref] = useState<{ ok: boolean; texto: string } | null>(null);
  async function escolherPrefAgenda(novo: PreferenciaAgenda) {
    if (!empresaAtiva || !user || salvandoPref || novo === (prefAgenda.data ?? 'propria')) return;
    setSalvandoPref(true); setMsgPref(null);
    try {
      await salvarPreferenciaAgenda(supabase, empresaAtiva.id, novo);
      qc.setQueryData(chavePreferenciaAgenda(empresaAtiva.id, user.id), novo);
      setMsgPref({ ok: true, texto: 'Preferência salva.' });
    } catch (e) {
      setMsgPref({ ok: false, texto: e instanceof Error ? e.message : 'Não foi possível salvar a preferência.' });
    } finally {
      setSalvandoPref(false);
    }
  }

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  // ── Toggle de dia ─────────────────────────────────────────
  function toggleDia(dia: Dia) {
    if (!ehDona) return;
    setHorarios((h) => ({ ...h, [dia]: { ...h[dia], aberto: !h[dia].aberto } }));
  }

  function setHorarioDia(dia: Dia, campo: 'inicio' | 'fim', val: string) {
    if (!ehDona) return;
    setHorarios((h) => ({ ...h, [dia]: { ...h[dia], [campo]: val } }));
  }

  // ── CEP (ViaCEP) e CNPJ (BrasilAPI), iguais ao web ───────────
  async function mudarCep(valor: string) {
    const mascarado = maskCEP(valor);
    setCampoEndereco('cep', mascarado);
    const d = digits(mascarado);
    if (d.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const achado = enderecoDoViaCep(res.ok ? await res.json() : null);
      if (achado) setEndereco((e) => ({ ...e, ...achado }));
    } catch { /* sem rede: a dona preenche à mão */ }
    finally { setBuscandoCep(false); }
  }

  async function mudarCnpj(valor: string) {
    const mascarado = maskCNPJ(valor);
    setCnpj(mascarado);
    const d = digits(mascarado);
    if (d.length !== 14 || !validaCNPJ(mascarado)) return;
    setBuscandoCnpj(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
      if (!res.ok) return;
      const dados = dadosDoCnpj(await res.json(), { nome: nomeEmpresa, telefone: telefoneEmp });
      if (dados.nome) setNomeEmpresa(dados.nome);
      if (dados.telefone) setTelefoneEmp(dados.telefone);
      if (dados.endereco) setEndereco((e) => ({ ...e, ...dados.endereco }));
    } catch { /* sem rede: a dona preenche à mão */ }
    finally { setBuscandoCnpj(false); }
  }

  // ── Logo (bucket `logos`, mesmo caminho do web; grava logo_url na hora) ──
  async function trocarLogo() {
    if (!ehDona || !empresaAtiva || enviandoLogo) return;
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      Alert.alert('Sem acesso às fotos', 'Permita o acesso às fotos nos ajustes do aparelho para trocar a logo.');
      return;
    }
    const escolha = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (escolha.canceled || !escolha.assets?.[0]) return;
    const foto = escolha.assets[0];
    const ext = (foto.fileName ?? foto.uri).split('.').pop()?.toLowerCase() ?? 'jpg';
    const mime = foto.mimeType ?? MIME_POR_EXTENSAO[ext] ?? null;
    const erroArquivo = validarArquivoLogo(mime, foto.fileSize ?? null);
    if (erroArquivo) { Alert.alert('Logo', erroArquivo); return; }

    setEnviandoLogo(true);
    try {
      const corpo = await (await fetch(foto.uri)).arrayBuffer();
      const caminho = caminhoLogoEmpresa(empresaAtiva.id, ext === 'jpeg' ? 'jpg' : ext);
      const { error: erroUpload } = await supabase.storage.from('logos').upload(caminho, corpo, { contentType: mime ?? 'image/jpeg' });
      if (erroUpload) throw new Error('Não foi possível enviar a logo. Tente de novo.');
      const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(caminho);
      const { data: linhas, error } = await supabase.from('empresas')
        .update({ logo_url: publicUrl }).eq('id', empresaAtiva.id).select('id');
      if (error || !linhas || linhas.length === 0) {
        throw new Error(mensagemErroBanco(error ?? { code: '42501' }, 'salvar a logo'));
      }
      setLogoUrl(publicUrl);
      selecionarEmpresa({ ...useAuthStore.getState().empresaAtiva!, logo_url: publicUrl }, roleAtivo ?? 'gestor', souOwner);
    } catch (e) {
      Alert.alert('Logo', e instanceof Error ? e.message : 'Não foi possível trocar a logo.');
    } finally {
      setEnviandoLogo(false);
    }
  }

  // ── Salvar tudo ───────────────────────────────────────────
  async function salvar() {
    if (!empresaAtiva || !user) return;
    const naAbaEmpresa = aba === 'empresa';
    // Senha (só na aba do perfil): curta ou sem confirmação igual avisa, nunca é ignorada.
    if (aba === 'perfil') {
      const erroSenha = validarSenhaOpcionalComConfirmacao(novaSenha, confirmaSenha);
      if (erroSenha) { Alert.alert('Senha', erroSenha); return; }
    }
    if (naAbaEmpresa && ehDona && cnpj.trim() && !validaCNPJ(cnpj)) {
      Alert.alert('CNPJ', 'CNPJ inválido. Verifique os dígitos.');
      return;
    }
    setSalvando(true);

    // Empresa: dados só a dona; taxas só com config.taxas (o trigger da 083 recusa outras colunas).
    const payloadEmpresa = naAbaEmpresa ? montarPayloadEmpresa({
      ehDona,
      podeTaxas: podeEditarTaxa,
      dados: {
        nome:                  nomeEmpresa.trim(),
        segmento:              segmento || 'Estúdio',
        telefone:              telefoneEmp.trim() || null,
        endereco:              serializarEnderecoEmpresa(endereco),
        cnpj:                  cnpj.trim() || null,
        meta_mensal:           parseMoeda(metaMensal),
        horario_funcionamento: horarios,
      },
      taxas: {
        taxa_cancelamento_ativa:            taxaAtiva,
        taxa_cancelamento_modo:             taxaModo,
        taxa_cancelamento_valor:            parseValorMonetario(taxaValor) ?? 0,
        taxa_cancelamento_aplica_cancelado: taxaAplicaCancelado,
        taxa_cancelamento_aplica_faltou:    taxaAplicaFaltou,
        taxa_reserva_ativa:   reservaAtiva,
        taxa_reserva_modo:    reservaModo,
        taxa_reserva_valor:   parseValorMonetario(reservaValor) ?? 0,
      },
    }) : {};

    try {
      if (Object.keys(payloadEmpresa).length > 0) {
        const { data, error } = await supabase.from('empresas').update(payloadEmpresa).eq('id', empresaAtiva.id).select('id');
        // UPDATE de empresas recusado pelo RLS volta sem erro e sem linha: não finge que salvou.
        if (error || !data || data.length === 0) {
          throw new Error(mensagemErroBanco(error ?? { code: '42501' }, 'salvar as configurações da empresa'));
        }
      }

      if (aba === 'perfil') {
        const { data, error } = await supabase.from('users').update({
          nome:     nomeUser.trim(),
          telefone: telefoneUser.trim() || null,
        }).eq('id', user.id).select('id');
        if (error || !data || data.length === 0) {
          throw new Error(mensagemErroBanco(error ?? { code: '42501' }, 'salvar o perfil'));
        }
        if (novaSenha.length > 0) {
          const { error: erroAuth } = await supabase.auth.updateUser({ password: novaSenha });
          if (erroAuth) {
            throw new Error(/different from the old/i.test(erroAuth.message)
              ? 'A nova senha deve ser diferente da atual.'
              : 'Não foi possível trocar a senha. Tente de novo.');
          }
        }
        const atual = useAuthStore.getState().user;
        if (atual) useAuthStore.setState({ user: { ...atual, nome: nomeUser.trim(), telefone: telefoneUser.trim() || undefined } });
      }
    } catch (e) {
      setSalvando(false);
      Alert.alert('Erro ao salvar', e instanceof Error ? e.message : 'Não foi possível salvar.');
      return;
    }
    setSalvando(false);
    if (naAbaEmpresa) setSalvoEmpresa(formEmpresa);
    if (aba === 'perfil') setSalvoPerfil({ ...formPerfil, novaSenha: '', confirmaSenha: '' });

    // Invalida cache para refletir mudanças
    qc.invalidateQueries({ queryKey: ['empresa'] });
    qc.invalidateQueries({ queryKey: ['user'] });

    // Re-busca a empresa atualizada e atualiza o Zustand authStore — a tela de
    // Novo agendamento lê `empresaAtiva` do authStore (não do React Query),
    // então sem isso a taxa de reserva/cancelamento só apareceria após reabrir o app.
    if (Object.keys(payloadEmpresa).length > 0) {
      const { data: empresaAtualizada } = await supabase
        .from('empresas')
        .select('*')
        .eq('id', empresaAtiva.id)
        .single();
      if (empresaAtualizada) {
        selecionarEmpresa(empresaAtualizada, roleAtivo ?? 'gestor', souOwner);
      }
    }

    Alert.alert('Salvo!', 'Configurações atualizadas com sucesso.');
    setNovaSenha(''); setConfirmaSenha('');
  }

  // ── Logout ────────────────────────────────────────────────
  function handleLogout() {
    Alert.alert(
      'Sair da conta',
      'Tem certeza que deseja sair?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair', style: 'destructive',
          onPress: async () => {
            await sair();
            router.replace('/(auth)/login' as any);
          },
        },
      ]
    );
  }

  const tituloSecao = (texto: string) => (
    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 20, marginBottom: 10, marginHorizontal: 24 }}>
      {texto}
    </Text>
  );
  const cartao = {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 18, marginHorizontal: 24, overflow: 'hidden' as const,
    shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar barStyle="light-content" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Hero ── */}
          <LinearGradient
            colors={['#2C1654', '#3D1F72']}
            style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
          >
            <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350 }}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={{
                  width: 34, height: 34, borderRadius: 10,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                  alignItems: 'center', justifyContent: 'center', marginBottom: 16,
                }}
              >
                <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
              </TouchableOpacity>

              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                Gerenciar
              </Text>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff', marginBottom: 20 }}>
                Configurações
              </Text>

              {/* Logo + nome (trocar a logo: só a dona) */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <TouchableOpacity
                  onPress={() => void trocarLogo()}
                  disabled={!ehDona || enviandoLogo}
                  accessibilityLabel="Logo da empresa"
                  style={{
                    width: 64, height: 64, borderRadius: 18, overflow: 'hidden',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    borderWidth: logoUrl ? 0 : 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.25)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {enviandoLogo
                    ? <ActivityIndicator color="#fff" />
                    : logoUrl
                      ? <Image source={{ uri: logoUrl }} style={{ width: 64, height: 64 }} resizeMode="cover" />
                      : <ImageIcon size={22} color="rgba(255,255,255,0.3)" strokeWidth={1.5} />}
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', marginBottom: 3 }}>
                    {nomeEmpresa || 'Nome do estúdio'}
                  </Text>
                  {ehDona && (
                    <TouchableOpacity onPress={() => void trocarLogo()} disabled={enviandoLogo}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: 'rgba(155,111,232,0.9)' }}>
                        {enviandoLogo ? 'Enviando…' : logoUrl ? 'Alterar logo' : 'Enviar logo'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </MotiView>
          </LinearGradient>

          {/* ── Abas ── */}
          <View style={{ marginHorizontal: 24, marginTop: 16 }}>
            <SmoothTabs tabs={abasDisponiveis} active={aba} onChange={trocarAba} />
          </View>

          {aba === 'permissoes' && vePermissoes && empresaAtiva && user && (
            // Painel ainda sem tema escuro: fica claro (ilha) também no modo escuro.
            <TemaClaroFixo>
              <View style={{ marginHorizontal: 24, marginTop: 16, backgroundColor: PALETA_CLARA.bg, borderRadius: 16, padding: 8 }}>
                <PermissoesPanel empresaId={empresaAtiva.id} meuUserId={user.id} membroInicial={params.membro || undefined} />
              </View>
            </TemaClaroFixo>
          )}

          {aba === 'empresa' && (<>
          {ehDona && (<>
          {/* ── Dados da Empresa (só a dona) ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 60 }}>
            {tituloSecao('Dados da Empresa')}
            <View style={cartao}>
              <Campo label="Nome" icon={<Store size={13} color={C.primary} strokeWidth={1.8} />}
                value={nomeEmpresa} onChange={setNomeEmpresa} placeholder="Nome do estúdio" />
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                  Segmento
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {SEGMENTOS_EMPRESA.map((op) => {
                    const ativo = segmento === op;
                    return (
                      <TouchableOpacity key={op} onPress={() => setSegmento(op)} accessibilityState={{ selected: ativo }}
                        style={{
                          height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center',
                          backgroundColor: ativo ? C.primary : C.bg, borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                        }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text2 }}>{op}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <Campo label="CNPJ" icon={<FileText size={13} color={C.primary} strokeWidth={1.8} />}
                value={cnpj} onChange={(v) => void mudarCnpj(v)} placeholder="00.000.000/0001-00" keyboardType="numeric"
                buscando={buscandoCnpj} maxLength={18} />
              {cnpj.length === 18 && !validaCNPJ(cnpj) && (
                <Text style={{ marginHorizontal: 16, marginTop: -4, marginBottom: 8, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.red }}>
                  CNPJ inválido. Verifique os dígitos.
                </Text>
              )}
              <Campo label="Telefone" icon={<Phone size={13} color={C.primary} strokeWidth={1.8} />}
                value={telefoneEmp} onChange={(v) => setTelefoneEmp(maskPhone(v))} placeholder="(00) 00000-0000" keyboardType="phone-pad" ultimo />
            </View>
          </MotiView>

          {/* ── Endereço (campos, gravado por serializarEnderecoEmpresa) ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 90 }}>
            {tituloSecao('Endereço')}
            <View style={cartao}>
              <Campo label={'CEP'} icon={<MapPin size={13} color={C.primary} strokeWidth={1.8} />}
                value={endereco.cep} onChange={(v) => void mudarCep(v)} placeholder="00000-000" keyboardType="numeric"
                buscando={buscandoCep} maxLength={9} />
              <Campo label={'Rua'} value={endereco.rua} onChange={(v) => setCampoEndereco('rua', v)} placeholder="Rua, avenida…" />
              <Campo label={'Número'} value={endereco.numero} onChange={(v) => setCampoEndereco('numero', v)} placeholder="Nº" />
              <Campo label={'Complemento'} value={endereco.complemento} onChange={(v) => setCampoEndereco('complemento', v)} placeholder="Sala, andar… (opcional)" />
              <Campo label={'Bairro'} value={endereco.bairro} onChange={(v) => setCampoEndereco('bairro', v)} placeholder="Bairro" />
              <Campo label={'Cidade'} value={endereco.cidade} onChange={(v) => setCampoEndereco('cidade', v)} placeholder="Cidade" />
              <Campo label={'UF'} value={endereco.uf} onChange={(v) => setCampoEndereco('uf', v.toUpperCase())} placeholder="UF"
                maxLength={2} autoCapitalize="characters" ultimo />
            </View>
          </MotiView>

          {/* ── Meta mensal ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 100 }}>
            {tituloSecao('Meta mensal de receita')}
            <View style={cartao}>
              <Campo label="Meta de receita bruta (R$)" icon={<Target size={13} color={C.primary} strokeWidth={1.8} />}
                value={metaMensal} onChange={(v) => setMetaMensal(maskMoeda(v))} placeholder="0,00" keyboardType="numeric" ultimo />
            </View>
            <Text style={{ marginHorizontal: 24, marginTop: 6, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
              Aparece como barra de progresso no Dashboard.
            </Text>
          </MotiView>

          {/* ── Horários de Funcionamento ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 120 }}>
            {tituloSecao('Horários de Funcionamento')}
            <View style={cartao}>
              {DIAS.map((dia, i) => {
                const h = horarios[dia];
                return (
                  <View
                    key={dia}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingHorizontal: 16, paddingVertical: 11,
                      borderBottomWidth: i < DIAS.length - 1 ? 1 : 0, borderBottomColor: C.border,
                    }}
                  >
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12,
                      color: h.aberto ? C.text : C.text4, width: 32,
                    }}>
                      {DIAS_LABEL[dia]}
                    </Text>

                    <Switch
                      value={h.aberto}
                      onValueChange={() => toggleDia(dia)}
                      trackColor={{ false: C.border, true: C.green }}
                      thumbColor="#fff"
                      style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                    />

                    {h.aberto ? (
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {(['inicio', 'fim'] as const).map((campo, j) => (
                          <View key={campo} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            {j === 1 && (
                              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>até</Text>
                            )}
                            <TextInput
                              value={h[campo]}
                              onChangeText={(v) => setHorarioDia(dia, campo, v)}
                              style={{
                                backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                                borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
                                fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text,
                                width: 60, textAlign: 'center',
                              }}
                            />
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, fontStyle: 'italic', flex: 1 }}>
                        Fechado
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </MotiView>
          </>)}

          {podeEditarTaxa && (<>
          {/* ── Taxa de Cancelamento ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 150 }}
            style={{ marginHorizontal: 24, marginTop: 20 }}
          >
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18, gap: 14 }}>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 16, color: C.text }}>
                Taxa de cancelamento
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
                Gera uma cobrança pendente no Financeiro ao cancelar um agendamento ou registrar falta.
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Switch value={taxaAtiva} onValueChange={setTaxaAtiva}
                  trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                  Cobrar taxa automaticamente
                </Text>
              </View>
              {taxaAtiva && (
                <>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {([['percentual', '% do serviço'], ['fixo', 'Valor fixo (R$)']] as const).map(([m, rotulo]) => (
                      <TouchableOpacity key={m} onPress={() => setTaxaModo(m)}
                        style={{
                          flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                          borderWidth: 1, borderColor: taxaModo === m ? C.primary : C.border,
                          backgroundColor: taxaModo === m ? C.primarySoft : 'transparent',
                        }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: taxaModo === m ? C.primary : C.text3 }}>
                          {rotulo}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Campo
                    label={taxaModo === 'percentual' ? 'Percentual da taxa' : 'Valor da taxa'}
                    icon={<Percent size={16} color={C.text3} />}
                    value={taxaValor}
                    onChange={setTaxaValor}
                    placeholder="0,00"
                    keyboardType="decimal-pad"
                  />
                  <TouchableOpacity onPress={() => setTaxaAplicaCancelado(v => !v)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Switch value={taxaAplicaCancelado} onValueChange={setTaxaAplicaCancelado}
                      trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text2 }}>
                      Aplicar quando cancelado
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setTaxaAplicaFaltou(v => !v)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Switch value={taxaAplicaFaltou} onValueChange={setTaxaAplicaFaltou}
                      trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text2 }}>
                      Aplicar quando o cliente faltar
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </MotiView>

          {/* ── Taxa de Reserva ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 160 }}
            style={{ marginHorizontal: 24, marginTop: 20 }}
          >
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18, gap: 14 }}>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 16, color: C.text }}>
                Taxa de reserva
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
                Sugere um valor de taxa de reserva (editável) ao criar um novo agendamento.
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Switch value={reservaAtiva} onValueChange={setReservaAtiva}
                  trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                  Sugerir taxa de reserva ao agendar
                </Text>
              </View>
              {reservaAtiva && (
                <>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {([['percentual', '% do serviço'], ['fixo', 'Valor fixo (R$)']] as const).map(([m, rotulo]) => (
                      <TouchableOpacity key={m} onPress={() => setReservaModo(m)}
                        style={{
                          flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                          borderWidth: 1, borderColor: reservaModo === m ? C.primary : C.border,
                          backgroundColor: reservaModo === m ? C.primarySoft : 'transparent',
                        }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: reservaModo === m ? C.primary : C.text3 }}>
                          {rotulo}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Campo
                    label={reservaModo === 'percentual' ? 'Percentual sugerido' : 'Valor sugerido'}
                    icon={<Percent size={16} color={C.text3} />}
                    value={reservaValor}
                    onChange={setReservaValor}
                    placeholder="0,00"
                    keyboardType="decimal-pad"
                  />
                </>
              )}
            </View>
          </MotiView>

          {/* ── Cartões (maquininhas, bandeiras e taxas) — painel ainda sem tema escuro: ilha clara ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 160 }}
            style={{ marginHorizontal: 24, marginTop: 16 }}>
            <TemaClaroFixo>
              <View style={{ backgroundColor: PALETA_CLARA.surface, borderWidth: 1, borderColor: PALETA_CLARA.border, borderRadius: 16, padding: 18, gap: 14 }}>
                <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 16, color: PALETA_CLARA.text }}>
                  Cartões
                </Text>
                {empresaAtiva && <CartoesConfig empresaId={empresaAtiva.id} />}
              </View>
            </TemaClaroFixo>
          </MotiView>
          </>)}

          </>)}

          {aba === 'perfil' && (<>
          {/* ── Minha Conta ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 180 }}>
            {tituloSecao('Minha Conta')}
            <View style={cartao}>
              {/* Avatar */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <View style={{ position: 'relative' }}>
                  <View style={{
                    width: 56, height: 56, borderRadius: 16,
                    backgroundColor: C.primarySoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: C.primary }}>
                      {initials(nomeUser || 'U')}
                    </Text>
                  </View>
                  <View style={{
                    position: 'absolute', bottom: -2, right: -2,
                    width: 20, height: 20, borderRadius: 6,
                    backgroundColor: C.accent, borderWidth: 2, borderColor: C.surface,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Camera size={9} color="#fff" strokeWidth={2} />
                  </View>
                </View>
                <View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text, marginBottom: 2 }}>
                    {nomeUser || 'Usuário'}
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                    {user?.id ? 'Conta conectada' : ''}
                  </Text>
                </View>
              </View>

              <Campo label="Nome" icon={<User size={13} color={C.primary} strokeWidth={1.8} />}
                value={nomeUser} onChange={setNomeUser} placeholder="Seu nome" />
              <Campo label="Telefone" icon={<Phone size={13} color={C.primary} strokeWidth={1.8} />}
                value={telefoneUser} onChange={(v) => setTelefoneUser(maskPhone(v))} placeholder="(00) 00000-0000" keyboardType="phone-pad" />
              <TrocarEmail />
              <Campo label="Nova senha" icon={<Lock size={13} color={C.primary} strokeWidth={1.8} />}
                value={novaSenha} onChange={setNovaSenha} placeholder="Deixe em branco para manter" secureTextEntry />
              <Campo label="Confirmar nova senha" icon={<Lock size={13} color={C.primary} strokeWidth={1.8} />}
                value={confirmaSenha} onChange={setConfirmaSenha} placeholder="Repita a nova senha" secureTextEntry ultimo />
            </View>
          </MotiView>

          {/* ── Notificações no celular (status, Ativar e preferências salvas na hora) ── */}
          <View style={{ marginHorizontal: 24, marginTop: 20 }}>
            <CardNotificacoesCelular />
          </View>

          {/* ── Aparência (modo escuro) ── */}
          <View style={{ marginHorizontal: 24, marginTop: 20 }}>
            <SeletorModoTema />
          </View>

          {pode('agenda.ver_equipe') && prefAgenda.data !== null && (
            <View style={{ marginHorizontal: 24, marginTop: 20 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 }}>
                Minha agenda abre em
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {([['propria', 'Minha agenda'], ['todas', 'Todas as profissionais']] as const).map(([v, label]) => {
                  const ativo = (prefAgenda.data ?? 'propria') === v;
                  return (
                    <TouchableOpacity key={v} onPress={() => escolherPrefAgenda(v)}
                      disabled={salvandoPref || prefAgenda.isPending}
                      accessibilityState={{ selected: ativo }}
                      style={{
                        height: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center',
                        backgroundColor: ativo ? C.primary : C.surface,
                        borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                        opacity: salvandoPref || prefAgenda.isPending ? 0.6 : 1,
                      }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text2 }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {prefAgenda.isError && !msgPref && (
                <Text style={{ marginTop: 8, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.red }}>
                  Não foi possível carregar a preferência.
                </Text>
              )}
              {msgPref && (
                <Text style={{ marginTop: 8, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: msgPref.ok ? C.green : C.red }}>
                  {msgPref.texto}
                </Text>
              )}
            </View>
          )}

          </>)}

          {aba !== 'permissoes' && (<>
          {/* ── Botão Salvar ── */}
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 380, delay: 240 }}
            style={{ marginHorizontal: 24, marginTop: 20 }}
          >
            <TouchableOpacity
              onPress={salvar}
              disabled={salvando}
              style={{
                backgroundColor: C.primary, borderRadius: 14,
                height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: salvando ? 0.7 : 1,
                shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4,
              }}
            >
              {salvando
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Save size={16} color="#fff" strokeWidth={2} />
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                      Salvar alterações
                    </Text>
                  </>
              }
            </TouchableOpacity>
          </MotiView>

          </>)}

          {aba === 'perfil' && (
          <>
          {/* ── Zona de perigo ── */}
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 380, delay: 300 }}
            style={{ marginHorizontal: 24, marginTop: 16 }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.red, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 }}>
              Zona de Perigo
            </Text>
            <TouchableOpacity
              onPress={handleLogout}
              style={{
                backgroundColor: C.redSoft, borderWidth: 1, borderColor: 'rgba(192,57,43,0.15)',
                borderRadius: 14, height: 48,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <LogOut size={15} color={C.red} strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.red }}>
                Sair da conta
              </Text>
            </TouchableOpacity>
          </MotiView>
          </>
          )}

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

export default comTemaDoUsuario(Configuracoes);
