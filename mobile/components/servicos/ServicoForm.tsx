import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, EyeOff, Eye, Trash2 } from 'lucide-react-native';
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
import { supabase } from '@/lib/supabase';
import { CategoriaIcon, CategoriaIconCustom } from '@/components/CategoriaIcon';
import { CategoriaPicker } from '@/components/CategoriaPicker';
import SuccessCheck from '@/components/SuccessCheck';
import { resolverCategoriaServico, type CategoriaCustom } from '@shared/categorias';
import { validarServico } from '@shared/servicos';
import { parseValorBR } from '@shared/comanda-fechamento';
import { mensagemErroBanco } from '@shared/erros';
import { formatarMoeda } from '@shared/moeda';
import { formatarDuracao } from '@shared/dominio';
import { DuracaoSeletor } from './DuracaoSeletor';
import { InsumosEditor } from './InsumosEditor';
import {
  carregarCategorias, carregarProdutosInsumo, carregarServicoComInsumos,
  sincronizarInsumos, definirAtivoServico, excluirServicoConferido, MSG_SERVICO_USADO,
  type InsumoItem, type ProdutoInsumo,
} from './servicos-gravacao';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>{label}</Text>
      {children}
    </View>
  );
}

const inputStyle = {
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  borderRadius: 12, paddingHorizontal: 14, height: 48,
  fontFamily: 'PlusJakartaSans_500Medium', fontSize: 15, color: C.text,
} as const;

/** Preço digitado → número; sem nenhum dígito → NaN (vira "Informe um preço válido."). Zero é cortesia. */
function precoDigitado(txt: string): number {
  return /\d/.test(txt) ? parseValorBR(txt) : NaN;
}

/**
 * Cadastro de serviço do app (criar e editar), igual ao modal do web: nome, descrição, categoria,
 * preço/custo, duração com "Personalizada", insumos e, na edição, Desativar e Excluir.
 * `servicoId` ausente = criar; `categoriaInicial`/`categoriaIdInicial` vêm do "+" de um grupo.
 */
export function ServicoForm({ servicoId, categoriaInicial, categoriaIdInicial }: {
  servicoId?: string;
  categoriaInicial?: string | null;
  categoriaIdInicial?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();

  // Depois de criar, a tela passa a editar o mesmo serviço (nova tentativa não duplica).
  const [idAtual, setIdAtual] = useState<string | undefined>(servicoId);
  const editando = !!servicoId;

  const [nome,        setNome]        = useState('');
  const [descricao,   setDescricao]   = useState('');
  const [categoria,   setCategoria]   = useState<string | null>(categoriaIdInicial ? null : (categoriaInicial ?? 'outros'));
  const [categoriaId, setCategoriaId] = useState<string | null>(categoriaIdInicial ?? null);
  const [customs,     setCustoms]     = useState<CategoriaCustom[]>([]);
  const [preco,       setPreco]       = useState('');
  const [custo,       setCusto]       = useState('');
  const [duracao,     setDuracao]     = useState(60);
  const [ativo,       setAtivo]       = useState(true);
  const [insumos,     setInsumos]     = useState<InsumoItem[]>([]);
  const [produtos,    setProdutos]    = useState<ProdutoInsumo[]>([]);

  const [carregando,   setCarregando]   = useState(true);
  const [erroCarga,    setErroCarga]    = useState<string | null>(null);
  const [erroCat,      setErroCatTela]  = useState<string | null>(null);
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const [erro,         setErro]         = useState('');
  const [salvando,     setSalvando]     = useState(false);
  const [ocupado,      setOcupado]      = useState(false);
  const [sucesso,      setSucesso]      = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  const carregar = useCallback(async () => {
    if (!empresaId) return;
    setCarregando(true); setErroCarga(null);
    const [rCat, rProd, rServ] = await Promise.all([
      carregarCategorias(empresaId),
      carregarProdutosInsumo(empresaId),
      servicoId ? carregarServicoComInsumos(empresaId, servicoId) : Promise.resolve(null),
    ]);
    setErroCatTela(rCat.erro);
    if (rCat.dados) setCustoms(rCat.dados);
    setErroProdutos(rProd.erro);
    if (rProd.dados) setProdutos(rProd.dados);
    if (rServ) {
      if (rServ.erro !== null) { setErroCarga(rServ.erro); setCarregando(false); return; }
      const { servico: s, insumos: ins } = rServ.dados;
      setNome(s.nome ?? '');
      setDescricao(s.descricao ?? '');
      setCategoriaId(s.categoria_id ?? null);
      setCategoria(s.categoria_id ? null : (s.categoria ?? 'outros'));
      setPreco(String(s.preco ?? ''));
      setCusto(s.custo ? String(s.custo) : '');
      setDuracao(s.duracao_minutos ?? 60);
      setAtivo(s.ativo);
      setInsumos(ins);
    }
    setCarregando(false);
  }, [empresaId, servicoId]);

  useEffect(() => { carregar(); }, [carregar]);

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['servicos-gestao'] });
    qc.invalidateQueries({ queryKey: ['servicos-empresa'] });
  }

  async function salvar() {
    if (!empresaId || salvando) return;
    const precoNum = precoDigitado(preco);
    const msg = validarServico({ nome, preco: precoNum, duracao });
    if (msg) { setErro(msg); return; }
    setErro(''); setSalvando(true);

    const payload = {
      empresa_id:      empresaId,
      nome:            nome.trim(),
      descricao:       descricao.trim() || null,
      categoria:       categoriaId ? null : categoria,
      categoria_id:    categoriaId,
      preco:           precoNum,
      custo:           parseValorBR(custo),
      duracao_minutos: duracao,
    };

    let id = idAtual;
    if (id) {
      const { data: salvos, error } = await supabase.from('servicos').update(payload)
        .eq('id', id).eq('empresa_id', empresaId).select('id');
      if (error || !salvos || salvos.length === 0) {
        setSalvando(false);
        setErro(mensagemErroBanco(error ?? { code: '42501' }, 'salvar o serviço'));
        return;
      }
    } else {
      const { data: criado, error } = await supabase.from('servicos')
        .insert({ ...payload, ativo: true }).select('id').single();
      if (error || !criado) {
        setSalvando(false);
        setErro(mensagemErroBanco(error ?? { code: '42501' }, 'criar o serviço'));
        return;
      }
      id = (criado as { id: string }).id;
      setIdAtual(id);
    }

    const errIns = await sincronizarInsumos(id, insumos);
    setSalvando(false);
    invalidar();
    if (errIns) {
      setErro(`${editando ? 'Serviço salvo' : 'Serviço criado'}, mas os insumos não: ${errIns}`);
      return;
    }
    setSucesso(true);
    setTimeout(() => router.back(), 1300);
  }

  async function alternarAtivo(novo: boolean) {
    if (!idAtual) return;
    setOcupado(true);
    const err = await definirAtivoServico(idAtual, novo);
    setOcupado(false);
    if (err) { Alert.alert('Erro', err); return; }
    invalidar();
    if (!novo) router.back(); else setAtivo(true);
  }

  function confirmarDesativar() {
    Alert.alert(
      'Desativar serviço',
      `"${nome}" não aparecerá em novos agendamentos, mas o histórico fica intacto.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Desativar', style: 'destructive', onPress: () => alternarAtivo(false) },
      ],
    );
  }

  function confirmarExcluir() {
    if (!empresaId || !idAtual) return;
    Alert.alert(
      'Excluir serviço',
      `Excluir "${nome}" para sempre? Só é possível se o serviço nunca foi usado.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir', style: 'destructive',
          onPress: async () => {
            setOcupado(true);
            const err = await excluirServicoConferido(empresaId, idAtual);
            setOcupado(false);
            if (err === MSG_SERVICO_USADO && ativo) {
              Alert.alert('Não foi possível excluir', err, [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Desativar', style: 'destructive', onPress: () => alternarAtivo(false) },
              ]);
              return;
            }
            if (err) { Alert.alert('Não foi possível excluir', err); return; }
            invalidar();
            router.back();
          },
        },
      ],
    );
  }

  if (!fontsLoaded) return null;

  if (carregando) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  if (erroCarga) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.red, textAlign: 'center' }}>{erroCarga}</Text>
        <TouchableOpacity onPress={carregar} style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>Tentar de novo</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (sucesso) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        <SuccessCheck size={72} />
        <MotiView from={{ translateY: 12, opacity: 0 }} animate={{ translateY: 0, opacity: 1 }}
          transition={{ type: 'timing', duration: 350, delay: 150 }}
          style={{ alignItems: 'center', marginTop: 16 }}>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text, textAlign: 'center' }}>
            {editando ? 'Serviço atualizado!' : 'Serviço criado!'}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text3, textAlign: 'center', marginTop: 6 }}>
            {nome}
          </Text>
        </MotiView>
      </View>
    );
  }

  const catRes = resolverCategoriaServico(categoria, categoriaId, customs);
  const precoPreview = precoDigitado(preco);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Voltar" style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {editando ? 'Editar' : empresaAtiva?.nome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            {editando ? (nome || 'Serviço') : 'Novo Serviço'}
          </Text>
        </LinearGradient>

        <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350, delay: 60 }} style={{ padding: 24 }}>

          <Campo label="Nome do serviço *">
            <TextInput value={nome} onChangeText={setNome} placeholder="Ex: Design de Sobrancelha" placeholderTextColor={C.text4} style={inputStyle} />
          </Campo>

          <Campo label="Descrição (opcional)">
            <TextInput value={descricao} onChangeText={setDescricao} placeholder="Detalhes do serviço..." placeholderTextColor={C.text4} multiline numberOfLines={3} style={[inputStyle, { height: 80, paddingTop: 12, textAlignVertical: 'top' }]} />
          </Campo>

          <Campo label="Categoria">
            {erroCat ? (
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red, marginBottom: 8 }}>{erroCat}</Text>
            ) : null}
            <CategoriaPicker
              empresaId={empresaId ?? ''}
              customs={customs}
              categoria={categoria}
              categoriaId={categoriaId}
              onSelect={(c, cid) => { setCategoria(c); setCategoriaId(cid); }}
              onCustomCriada={(c) => setCustoms((prev) => [...prev, c])}
            />
          </Campo>

          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>Preço cobrado *</Text>
              <View style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3 }}>R$</Text>
                <TextInput value={preco} onChangeText={setPreco} placeholder="0,00" placeholderTextColor={C.text4} keyboardType="decimal-pad" style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, color: C.text }} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>Custo (opcional)</Text>
              <View style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3 }}>R$</Text>
                <TextInput value={custo} onChangeText={setCusto} placeholder="0,00" placeholderTextColor={C.text4} keyboardType="decimal-pad" style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, color: C.text }} />
              </View>
            </View>
          </View>

          <Campo label="Duração">
            <DuracaoSeletor duracao={duracao} onChange={setDuracao} />
          </Campo>

          {/* Preview do card */}
          <View style={{ backgroundColor: catRes.bg, borderWidth: 1, borderColor: `${catRes.cor}30`, borderRadius: 14, padding: 14, marginBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {catRes.iconeCustom
              ? <CategoriaIconCustom name={catRes.iconeCustom} size={36} color={catRes.cor} />
              : <CategoriaIcon categoria={catRes.iconeBuiltin ?? 'outros'} size={36} color={catRes.cor} />}
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>
                {nome || 'Nome do serviço'}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                {formatarDuracao(duracao)} · {Number.isFinite(precoPreview) ? formatarMoeda(precoPreview) : 'Preço não definido'}
              </Text>
            </View>
          </View>

          <InsumosEditor produtos={produtos} insumos={insumos} onChange={setInsumos} erroProdutos={erroProdutos} />

          {erro ? (
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.red, marginBottom: 12 }}>{erro}</Text>
          ) : null}

          <TouchableOpacity onPress={salvar} disabled={salvando || ocupado} style={{ backgroundColor: C.primary, borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.7 : 1 }}>
            {salvando
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: '#fff' }}>
                  {editando ? 'Salvar alterações' : 'Criar serviço'}
                </Text>}
          </TouchableOpacity>

          {editando && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                onPress={() => (ativo ? confirmarDesativar() : alternarAtivo(true))}
                disabled={ocupado || salvando}
                style={{ flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: ocupado ? 0.6 : 1 }}
              >
                {ativo ? <EyeOff size={14} color={C.text3} strokeWidth={2} /> : <Eye size={14} color={C.text3} strokeWidth={2} />}
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>
                  {ativo ? 'Desativar' : 'Ativar'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmarExcluir}
                disabled={ocupado || salvando}
                accessibilityLabel="Excluir serviço"
                style={{ flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: `${C.red}40`, backgroundColor: C.redSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: ocupado ? 0.6 : 1 }}
              >
                <Trash2 size={14} color={C.red} strokeWidth={2} />
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.red }}>Excluir serviço</Text>
              </TouchableOpacity>
            </View>
          )}

        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
