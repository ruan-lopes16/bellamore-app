/**
 * @file PacoteForm.tsx
 * Cadastro e edição de pacote do app (novo-pacote.tsx e editar-pacote/[id].tsx), com as mesmas regras do web:
 * - tipo "Com sessões" ou "Combo" (`controla_sessoes`);
 * - serviços, cada um com quantidade ou ∞ (ilimitado; combo sempre com quantidade);
 * - preço; validade em dias livres ou "Sem validade" (a tela sempre envia o valor explícito:
 *   editar um pacote sem validade mantém sem validade);
 * - composição sincronizada por diferença (upsert pela chave (pacote_id, servico_id) e só depois o
 *   delete do que saiu, os dois com `.select` e linhas conferidas);
 * - pacote já vendido: tipo, serviços e quantidades travados. Se a contagem de "já vendido" der erro,
 *   a composição também fica travada até recarregar (nunca é tratada como "não vendido").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StatusBar, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Trash2, AlertCircle } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useFonts, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
import { parseValorBR } from '@shared/comanda-fechamento';
import { mensagemErroBanco } from '@shared/erros';
import { formatarMoeda } from '@shared/moeda';
import { rotuloValidade } from '@shared/pacotes';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', red: '#C0392B', redSoft: '#FEF2F2',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

/** Atalhos de validade (dias); qualquer número inteiro positivo vale. */
const ATALHOS_VALIDADE = [30, 90, 180, 365];

/** Aviso quando a contagem de vendas falhou (composição travada até recarregar). */
export const MSG_VENDIDO_ERRO = 'Não foi possível conferir se este pacote já foi vendido. Os serviços ficam travados até recarregar.';

/** Serviço dentro do pacote na tela. `quantidade` null = sessões ilimitadas. */
type Item = { servico_id: string; nome: string; quantidade: number | null };
type ServicoOpcao = { id: string; nome: string; preco: number };

const inputStyle = {
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  borderRadius: 12, paddingHorizontal: 14, height: 48,
  fontFamily: 'PlusJakartaSans_500Medium', fontSize: 15, color: C.text,
} as const;

function Campo({ label, children, dica }: { label: string; children: React.ReactNode; dica?: string }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>{label}</Text>
      {children}
      {dica ? <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, marginTop: 6 }}>{dica}</Text> : null}
    </View>
  );
}

/**
 * Valida o cadastro do pacote. Devolve a mensagem em português, ou null.
 * Nome ≥ 2 caracteres, preço > 0, validade inteira ≥ 1 (ou sem validade) e ao menos 1 serviço.
 */
function validarPacote(d: { nome: string; preco: number; semValidade: boolean; validade: number; itens: Item[] }): string | null {
  if (d.nome.trim().length < 2) return 'Informe o nome do pacote (pelo menos 2 letras).';
  if (!Number.isFinite(d.preco) || d.preco <= 0) return 'Informe um preço maior que zero.';
  if (!d.semValidade && (!Number.isInteger(d.validade) || d.validade < 1)) return 'Informe a validade em dias (1 ou mais) ou marque "Sem validade".';
  if (d.itens.length === 0) return 'Adicione pelo menos um serviço ao pacote.';
  return null;
}

export function PacoteForm({ pacoteId }: { pacoteId?: string }) {
  const insets = useSafeAreaInsets();
  const empresaId = useAuthStore(s => s.empresaAtiva?.id ?? null);
  const empresaNome = useAuthStore(s => s.empresaAtiva?.nome ?? '');
  const qc = useQueryClient();
  const editando = !!pacoteId;

  const [idAtual, setIdAtual] = useState<string | null>(pacoteId ?? null);
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [semValidade, setSemValidade] = useState(false);
  const [validade, setValidade] = useState('90');
  const [controlaSessoes, setControlaSessoes] = useState(true);
  const [itens, setItens] = useState<Item[]>([]);
  /** Serviços gravados no banco (para a sincronização por diferença). */
  const [originais, setOriginais] = useState<string[]>([]);
  const [servicos, setServicos] = useState<ServicoOpcao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [jaVendido, setJaVendido] = useState(false);
  const [erroVendido, setErroVendido] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [buscaServico, setBuscaServico] = useState('');
  const reqRef = useRef(0);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  // Tipo, serviços e quantidades travados: pacote já vendido, ou não deu para conferir.
  const composicaoTravada = jaVendido || !!erroVendido;

  const carregar = useCallback(async () => {
    if (!empresaId) return;
    const req = ++reqRef.current;
    setCarregando(true); setErroCarga(null); setErroVendido(null);
    try {
      const listaServicos = await buscarTodasOuLancar<ServicoOpcao>((de, ate) => supabase.from('servicos')
        .select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true)
        .order('nome').order('id').range(de, ate));
      if (req !== reqRef.current) return;
      setServicos(listaServicos.map(s => ({ ...s, preco: Number(s.preco ?? 0) })));

      if (pacoteId) {
        const { data, error } = await supabase.from('pacotes')
          .select('id, nome, preco, validade_dias, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade, servico:servicos(nome))')
          .eq('id', pacoteId).eq('empresa_id', empresaId).maybeSingle();
        if (req !== reqRef.current) return;
        if (error) throw error;
        if (!data) { setErroCarga('Pacote não encontrado.'); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = data as any;
        setNome(p.nome ?? '');
        setPreco(Number(p.preco ?? 0).toFixed(2).replace('.', ','));
        setSemValidade(p.validade_dias == null);
        setValidade(p.validade_dias != null ? String(p.validade_dias) : '');
        setControlaSessoes(p.controla_sessoes ?? true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lista: Item[] = (p.servicos ?? []).map((s: any) => ({
          servico_id: s.servico_id, nome: s.servico?.nome ?? 'Serviço', quantidade: s.quantidade ?? null,
        }));
        setItens(lista);
        setOriginais(lista.map(i => i.servico_id));

        // Já foi vendido a alguma cliente? Trava a composição. Erro na contagem também trava.
        const { count, error: eCount } = await supabase.from('pacote_clientes')
          .select('id', { count: 'exact', head: true })
          .eq('pacote_id', pacoteId).eq('empresa_id', empresaId);
        if (req !== reqRef.current) return;
        if (eCount) { setErroVendido(MSG_VENDIDO_ERRO); setJaVendido(false); }
        else setJaVendido((count ?? 0) > 0);
      }
    } catch (e) {
      if (req !== reqRef.current) return;
      setErroCarga(mensagemErroBanco(e as { code?: string; message?: string }, 'carregar o pacote'));
    } finally {
      if (req === reqRef.current) setCarregando(false);
    }
  }, [empresaId, pacoteId]);

  useEffect(() => { carregar(); }, [carregar]);

  if (!fontsLoaded) return null;

  function adicionarServico(s: ServicoOpcao) {
    if (composicaoTravada || itens.some(i => i.servico_id === s.id)) return;
    setItens(prev => [...prev, { servico_id: s.id, nome: s.nome, quantidade: 1 }]);
    setBuscaServico('');
  }
  function mudarQtd(id: string, delta: number) {
    if (composicaoTravada) return;
    setItens(prev => prev.map(i => i.servico_id === id ? { ...i, quantidade: Math.max(1, (i.quantidade ?? 1) + delta) } : i));
  }
  function alternarIlimitado(id: string) {
    if (composicaoTravada) return;
    setItens(prev => prev.map(i => i.servico_id === id ? { ...i, quantidade: i.quantidade == null ? 1 : null } : i));
  }
  function remover(id: string) {
    if (composicaoTravada) return;
    setItens(prev => prev.filter(i => i.servico_id !== id));
  }

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['pacotes'] });
    qc.invalidateQueries({ queryKey: ['pacotes-vendidos'] });
  }

  /** Composição por diferença: upsert do que ficou e, só depois, delete do que saiu. Devolve o erro ou null. */
  async function sincronizarComposicao(id: string): Promise<string | null> {
    // Combo não tem sessão ilimitada: grava quantidade concreta.
    const gravar = itens.map(i => ({
      pacote_id: id, servico_id: i.servico_id, quantidade: controlaSessoes ? i.quantidade : (i.quantidade ?? 1),
    }));
    if (gravar.length > 0) {
      const { data, error } = await supabase.from('pacote_servicos')
        .upsert(gravar, { onConflict: 'pacote_id,servico_id' })
        .select('servico_id');
      if (error) return mensagemErroBanco(error, 'salvar os serviços do pacote');
      if (!data || data.length !== gravar.length) return mensagemErroBanco({ code: '42501' }, 'salvar os serviços do pacote');
    }
    const ficam = new Set(itens.map(i => i.servico_id));
    const aRemover = originais.filter(s => !ficam.has(s));
    if (aRemover.length > 0) {
      const { data, error } = await supabase.from('pacote_servicos')
        .delete()
        .eq('pacote_id', id).in('servico_id', aRemover)
        .select('servico_id');
      if (error) return mensagemErroBanco(error, 'remover serviços do pacote');
      if (!data || data.length !== aRemover.length) return mensagemErroBanco({ code: '42501' }, 'remover serviços do pacote');
    }
    setOriginais(itens.map(i => i.servico_id));
    return null;
  }

  async function salvar() {
    if (!empresaId || salvando || carregando || erroCarga) return;
    const precoN = /\d/.test(preco) ? parseValorBR(preco) : NaN;
    const validadeNum = Number(validade.trim());
    const msg = validarPacote({ nome, preco: precoN, semValidade, validade: validadeNum, itens });
    if (msg) { setErro(msg); return; }
    setErro(''); setSalvando(true);
    // Sempre explícita: null = sem validade (o default da coluna nunca é usado pela tela).
    const validadeN = semValidade ? null : validadeNum;

    let id = idAtual;
    if (id) {
      const dados = composicaoTravada
        ? { nome: nome.trim(), preco: precoN, validade_dias: validadeN }
        : { nome: nome.trim(), preco: precoN, validade_dias: validadeN, controla_sessoes: controlaSessoes };
      const { data: salvos, error } = await supabase.from('pacotes').update(dados)
        .eq('id', id).eq('empresa_id', empresaId).select('id');
      if (error || !salvos || salvos.length === 0) {
        setSalvando(false);
        setErro(mensagemErroBanco(error ?? { code: '42501' }, 'salvar o pacote'));
        return;
      }
    } else {
      const { data: criado, error } = await supabase.from('pacotes').insert({
        empresa_id: empresaId, nome: nome.trim(), preco: precoN, validade_dias: validadeN,
        controla_sessoes: controlaSessoes, ativo: true,
      }).select('id').single();
      if (error || !criado) {
        setSalvando(false);
        setErro(mensagemErroBanco(error ?? { code: '42501' }, 'criar o pacote'));
        return;
      }
      id = (criado as { id: string }).id;
      // Nova tentativa depois de falhar nos serviços atualiza este pacote (não cria outro).
      setIdAtual(id);
    }

    const errComp = composicaoTravada ? null : await sincronizarComposicao(id);
    setSalvando(false);
    invalidar();
    if (errComp) {
      setErro(`${idAtual || editando ? 'Pacote salvo' : 'Pacote criado'}, mas os serviços não: ${errComp}`);
      return;
    }
    Alert.alert(editando ? 'Pacote atualizado!' : 'Pacote criado!', nome.trim(), [{ text: 'OK', onPress: () => router.back() }]);
  }

  function desativar() {
    if (!idAtual || !empresaId) return;
    Alert.alert(
      'Desativar pacote',
      `"${nome}" não aparecerá para novas vendas, mas o histórico fica intacto.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desativar', style: 'destructive',
          onPress: async () => {
            const { data: alterados, error } = await supabase.from('pacotes').update({ ativo: false })
              .eq('id', idAtual).eq('empresa_id', empresaId).select('id');
            if (error || !alterados || alterados.length === 0) {
              Alert.alert('Não foi possível desativar', mensagemErroBanco(error ?? { code: '42501' }, 'desativar o pacote'));
              return;
            }
            invalidar();
            router.back();
          },
        },
      ],
    );
  }

  const q = buscaServico.trim().toLowerCase();
  const disponiveis = servicos
    .filter(s => !itens.some(i => i.servico_id === s.id))
    .filter(s => !q || s.nome.toLowerCase().includes(q))
    .slice(0, q ? 20 : 8);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Voltar"
              style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
            </TouchableOpacity>
            {editando && !carregando && !erroCarga && (
              <TouchableOpacity onPress={desativar} accessibilityLabel="Desativar pacote"
                style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={15} color="rgba(255,100,100,0.8)" strokeWidth={2} />
              </TouchableOpacity>
            )}
          </View>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {editando ? 'Editar' : empresaNome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            {editando ? (nome || 'Pacote') : 'Novo Pacote'}
          </Text>
        </LinearGradient>

        {carregando ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : erroCarga ? (
          <View style={{ margin: 24, backgroundColor: C.redSoft, borderRadius: 14, padding: 16, gap: 10 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.red }}>{erroCarga}</Text>
            <TouchableOpacity onPress={carregar} style={{ alignSelf: 'flex-start', backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Recarregar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ padding: 24 }}>
            <Campo label="Nome do pacote *">
              <TextInput value={nome} onChangeText={setNome} placeholder="Ex: Pacote Escova Mensal" placeholderTextColor={C.text4} style={inputStyle} />
            </Campo>

            {jaVendido && (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.amberSoft, borderRadius: 12, padding: 12, marginBottom: 20 }}>
                <AlertCircle size={14} color={C.amber} />
                <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.amber }}>
                  Pacote já vendido — o tipo, os serviços e as quantidades não podem ser alterados.
                </Text>
              </View>
            )}
            {erroVendido && (
              <View style={{ backgroundColor: C.redSoft, borderRadius: 12, padding: 12, marginBottom: 20, gap: 8 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red }}>{erroVendido}</Text>
                <TouchableOpacity onPress={carregar} style={{ alignSelf: 'flex-start', backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Recarregar</Text>
                </TouchableOpacity>
              </View>
            )}

            <Campo
              label="Tipo de pacote"
              dica={controlaSessoes
                ? 'Rastreia sessões restantes por atendimento (ex: 10 sessões de manicure)'
                : 'Só agrupa serviços para um mesmo atendimento, sem controle de sessões (ex: spa dos lábios + design + buço)'}
            >
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([['Com sessões', true], ['Combo', false]] as const).map(([rotulo, valor]) => {
                  const ativo = controlaSessoes === valor;
                  return (
                    <TouchableOpacity key={rotulo} disabled={composicaoTravada} onPress={() => setControlaSessoes(valor)}
                      style={{
                        flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
                        backgroundColor: ativo ? C.primary : C.surface, borderColor: ativo ? C.primary : C.border,
                        opacity: composicaoTravada ? 0.5 : 1,
                      }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: ativo ? '#fff' : C.text3 }}>{rotulo}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Campo>

            <Campo label="Preço *">
              <View style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3 }}>R$</Text>
                <TextInput value={preco} onChangeText={setPreco} placeholder="0,00" placeholderTextColor={C.text4}
                  keyboardType="decimal-pad" accessibilityLabel="Preço"
                  style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, color: C.text }} />
              </View>
            </Campo>

            <Campo label="Validade" dica={semValidade ? 'Vale enquanto houver sessões.' : rotuloValidade(Number(validade) || null)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text2 }}>Sem validade</Text>
                <Switch value={semValidade} onValueChange={setSemValidade} trackColor={{ false: '#E5E7EB', true: C.primary }} thumbColor="#fff" />
              </View>
              {!semValidade && (
                <>
                  <TextInput value={validade} onChangeText={v => setValidade(v.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="number-pad" placeholder="Dias" placeholderTextColor={C.text4}
                    accessibilityLabel="Validade em dias" style={inputStyle} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {ATALHOS_VALIDADE.map(d => {
                      const ativo = validade === String(d);
                      return (
                        <TouchableOpacity key={d} onPress={() => setValidade(String(d))}
                          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, backgroundColor: ativo ? C.primarySoft : C.surface, borderColor: ativo ? C.primary : C.border }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? C.primary : C.text3 }}>{d} dias</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </Campo>

            <Campo label="Serviços incluídos *">
              <View style={{ gap: 6 }}>
                {itens.map(item => (
                  <View key={item.servico_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10 }}>
                    <Text numberOfLines={2} style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{item.nome}</Text>
                    {controlaSessoes && item.quantidade == null ? (
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.primary }}>Ilimitado</Text>
                    ) : composicaoTravada ? (
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
                        {item.quantidade ?? 1} {controlaSessoes ? 'sessões' : '×'}
                      </Text>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <TouchableOpacity onPress={() => mudarQtd(item.servico_id, -1)} accessibilityLabel="Diminuir"
                          style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary }}>−</Text>
                        </TouchableOpacity>
                        <Text style={{ minWidth: 22, textAlign: 'center', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.primary }}>{item.quantidade ?? 1}</Text>
                        <TouchableOpacity onPress={() => mudarQtd(item.servico_id, 1)} accessibilityLabel="Aumentar"
                          style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary }}>+</Text>
                        </TouchableOpacity>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text4 }}>{controlaSessoes ? 'sessões' : '×'}</Text>
                      </View>
                    )}
                    {controlaSessoes && !composicaoTravada && (
                      <TouchableOpacity onPress={() => alternarIlimitado(item.servico_id)}
                        accessibilityLabel={item.quantidade == null ? 'Definir quantidade' : 'Tornar ilimitado'}
                        style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: item.quantidade == null ? C.primarySoft : C.bg }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: item.quantidade == null ? C.primary : C.text4 }}>∞</Text>
                      </TouchableOpacity>
                    )}
                    {!composicaoTravada && (
                      <TouchableOpacity onPress={() => remover(item.servico_id)} accessibilityLabel="Remover serviço"
                        style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                        <Trash2 size={13} color={C.text4} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {itens.length === 0 && (
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4 }}>Nenhum serviço adicionado.</Text>
                )}
              </View>

              {!composicaoTravada && (
                <View style={{ marginTop: 12 }}>
                  <TextInput value={buscaServico} onChangeText={setBuscaServico} placeholder="+ Adicionar serviço..."
                    placeholderTextColor={C.text4} style={inputStyle} />
                  <View style={{ marginTop: 6, gap: 4 }}>
                    {disponiveis.map(s => (
                      <TouchableOpacity key={s.id} onPress={() => adicionarServico(s)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
                        <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>{s.nome}</Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text3 }}>{formatarMoeda(s.preco)}</Text>
                      </TouchableOpacity>
                    ))}
                    {servicos.length === 0 && (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4 }}>Nenhum serviço ativo cadastrado.</Text>
                    )}
                  </View>
                </View>
              )}
            </Campo>

            {erro ? (
              <View style={{ backgroundColor: C.redSoft, borderRadius: 12, padding: 12, marginBottom: 16 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.red }}>{erro}</Text>
              </View>
            ) : null}

            <TouchableOpacity onPress={salvar} disabled={salvando}
              style={{ backgroundColor: C.primary, borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.7 : 1 }}>
              {salvando
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: '#fff' }}>{editando ? 'Salvar alterações' : 'Criar pacote'}</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
