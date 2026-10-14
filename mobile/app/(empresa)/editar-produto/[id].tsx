import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { ChevronLeft, Trash2 } from 'lucide-react-native';
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
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useEstoque } from '@/hooks/useEstoque';
import { mensagemErroBanco } from '@shared/erros';
import { parseValorBR } from '@shared/comanda-fechamento';
import {
  CATEGORIAS_PRODUTO, rotuloCategoriaProduto, rotuloUnidade, unidadesParaSeletor,
  unidadePedeQtdPorUnidade, montarProduto, margemVenda, formatarQuantidadeBR,
  type TipoProduto, type OriginalProduto,
} from '@shared/estoque';

// ── Constantes (iguais ao novo-produto) ────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  red: '#C0392B', green: '#2E7D5B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

// ── Componentes auxiliares (iguais ao novo-produto) ────────────

function Label({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </Text>
  );
}

function Field({
  label, value, onChange, placeholder, keyboardType = 'default', opcional = false, dica,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'decimal-pad' | 'numeric' | 'numbers-and-punctuation';
  opcional?: boolean; dica?: string;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 8 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, letterSpacing: 1, textTransform: 'uppercase' }}>
          {label}
        </Text>
        {opcional && (
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>
            (opcional)
          </Text>
        )}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.text4}
        keyboardType={keyboardType}
        style={{
          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
          borderRadius: 12, padding: 14,
          fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text,
        }}
      />
      {!!dica && (
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, marginTop: 6 }}>{dica}</Text>
      )}
    </View>
  );
}

/**
 * Teclado numérico que deixa digitar o sinal de menos (o saldo pode ser negativo).
 * No iOS o "decimal-pad" não tem "-", então usa "numbers-and-punctuation"; no Android "numeric" é com sinal.
 */
const TECLADO_COM_SINAL = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric';

function ChipSelector({ label, options, value, onChange }: {
  label: string; options: { key: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Label>{label}</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
        {options.map((opt) => {
          const ativo = value === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => onChange(opt.key)}
              style={{
                paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20,
                backgroundColor: ativo ? C.primary : C.surface,
                borderWidth: 1, borderColor: ativo ? C.primary : C.border,
              }}
            >
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13,
                color: ativo ? '#fff' : C.text3,
              }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function TipoSelector({ value, onChange }: { value: TipoProduto; onChange: (v: TipoProduto) => void }) {
  const opcoes: { key: TipoProduto; titulo: string; sub: string; cor: string }[] = [
    { key: 'material', titulo: 'Material / Insumo', sub: 'Usado em atendimentos', cor: C.primary },
    { key: 'venda', titulo: 'Para venda (PDV)', sub: 'Revenda para clientes', cor: C.green },
  ];
  return (
    <View style={{ marginBottom: 20 }}>
      <Label>Tipo de produto</Label>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {opcoes.map((o) => {
          const ativo = value === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              onPress={() => onChange(o.key)}
              style={{
                flex: 1, paddingVertical: 14, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center', gap: 4,
                backgroundColor: ativo ? C.surface : C.bg,
                borderWidth: 2, borderColor: ativo ? o.cor : C.border,
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: ativo ? o.cor : C.text3, textAlign: 'center' }}>
                {o.titulo}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, textAlign: 'center' }}>
                {o.sub}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Invalida tudo que embute dados do produto: lista, movimentos (nome/unidade) e o alerta do Dashboard. */
function invalidarEstoque(qc: QueryClient, empresaId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['estoque', empresaId] }),
    qc.invalidateQueries({ queryKey: ['estoque-movimentos'] }),
    qc.invalidateQueries({ queryKey: ['estoque-baixo'] }),
  ]);
}

// ── Tela ─────────────────────────────────────────────────────

export default function EditarProdutoScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();
  const { unidadesVisiveis, erroUnidades } = useEstoque();
  const salvandoRef = useRef(false);

  const [nome,       setNome]       = useState('');
  const [tipo,       setTipo]       = useState<TipoProduto>('material');
  const [categoria,  setCategoria]  = useState('outros');
  const [unidade,    setUnidade]    = useState('');
  /** Unidade gravada no produto: fica sempre no seletor, mesmo oculta pela empresa e mesmo após trocar de chip. */
  const [unidadeOriginal, setUnidadeOriginal] = useState<string | null>(null);
  const [qtdPorUn,   setQtdPorUn]   = useState('');
  const [estAtual,   setEstAtual]   = useState('0');
  const [estMin,     setEstMin]     = useState('0');
  const [custo,      setCusto]      = useState('');
  const [precoVenda, setPrecoVenda] = useState('');
  /** Valores do produto como vieram do banco (a edição nunca perde saldo, decimais ou categoria legada). */
  const [original,   setOriginal]   = useState<OriginalProduto | null>(null);
  const [erroCarga,  setErroCarga]  = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando,   setSalvando]   = useState(false);
  const [excluindo,  setExcluindo]  = useState(false);

  // A unidade atual do produto sempre aparece, mesmo se a empresa a ocultou.
  const opcoesUnidade = useMemo(
    () => unidadesParaSeletor(unidadesVisiveis, unidadeOriginal).map((u) => ({ key: u, label: rotuloUnidade(u) === u ? u : `${rotuloUnidade(u)} (${u})` })),
    [unidadesVisiveis, unidadeOriginal],
  );
  // Categoria legada (fora do catálogo) vira um chip extra selecionado, para não sumir.
  const opcoesCategoria = useMemo(() => {
    const lista = CATEGORIAS_PRODUTO.map((c) => ({ key: c.key, label: c.label }));
    if (original && original.categoria && !lista.some((c) => c.key === original.categoria)) {
      lista.push({ key: original.categoria, label: rotuloCategoriaProduto(original.categoria) });
    }
    return lista;
  }, [original]);
  const margem = margemVenda(parseValorBR(custo), parseValorBR(precoVenda));

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  // Carrega dados do produto
  useEffect(() => {
    if (!id || !empresaAtiva) return;
    let ativo = true;
    supabase.from('produtos').select('*').eq('id', id).eq('empresa_id', empresaAtiva.id).maybeSingle()
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error || !data) {
          setErroCarga(error ? mensagemErroBanco(error, 'carregar o produto') : 'Produto não encontrado.');
        } else {
          const atual = Number(data.estoque_atual) || 0;
          const minimo = Number(data.estoque_minimo) || 0;
          const qtd = Number(data.qtd_por_unidade) || 1;
          const venda = Number(data.preco_venda) || 0;
          const custoDb = Number(data.preco_custo) || 0;
          setNome(data.nome ?? '');
          setTipo(data.tipo === 'venda' ? 'venda' : 'material');
          setCategoria(data.categoria ?? 'outros');
          setUnidade(data.unidade ?? 'un');
          setUnidadeOriginal(data.unidade ?? 'un');
          setQtdPorUn(qtd > 1 ? formatarQuantidadeBR(qtd) : '');
          setEstAtual(formatarQuantidadeBR(atual));
          setEstMin(formatarQuantidadeBR(minimo));
          setCusto(custoDb > 0 ? custoDb.toFixed(2).replace('.', ',') : '');
          setPrecoVenda(venda > 0 ? venda.toFixed(2).replace('.', ',') : '');
          setOriginal({ estoque_atual: atual, estoque_minimo: minimo, qtd_por_unidade: qtd, categoria: data.categoria ?? '', preco_venda: venda });
        }
        setCarregando(false);
      });
    return () => { ativo = false; };
  }, [id, empresaAtiva]);

  if (!fontsLoaded || carregando) return null;

  if (erroCarga || !original) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text2, textAlign: 'center' }}>
          {erroCarga ?? 'Produto não encontrado.'}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14, backgroundColor: C.primary }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function handleSalvar() {
    if (!empresaAtiva || !id || !original || salvandoRef.current) return;
    const r = montarProduto(
      { nome, tipo, categoria, unidade, qtdPorUnidade: qtdPorUn, estoqueAtual: estAtual, estoqueMinimo: estMin, precoCusto: custo, precoVenda },
      { empresaId: empresaAtiva.id, editando: true, original },
    );
    if ('erro' in r) {
      Alert.alert('Confira os dados', r.erro);
      return;
    }

    salvandoRef.current = true;
    setSalvando(true);
    try {
      const { data, error } = await supabase.from('produtos')
        .update(r.payload).eq('id', id).eq('empresa_id', empresaAtiva.id).select('id');
      if (error) {
        Alert.alert('Não foi possível salvar', mensagemErroBanco(error, 'salvar este produto'));
        return;
      }
      // Zero linhas = o banco recusou em silêncio (sem permissão de estoque).
      if (!data || data.length === 0) {
        Alert.alert('Não foi possível salvar', mensagemErroBanco({ code: '42501' }, 'salvar este produto'));
        return;
      }
      await invalidarEstoque(qc, empresaAtiva.id);
      router.back();
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
  }

  function confirmarExcluir() {
    Alert.alert(
      'Excluir produto',
      `"${nome}" será removido do estoque. Essa ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: excluir },
      ]
    );
  }

  async function excluir() {
    if (!id || !empresaAtiva) return;
    setExcluindo(true);
    try {
      const { data: apagados, error } = await supabase.from('produtos')
        .delete().eq('id', id).eq('empresa_id', empresaAtiva.id).select('id');
      // Erro = produto tem movimentações/vendas/comandas vinculadas (FK). 0 linhas sem erro = só a
      // dona apaga (RLS). Nos dois casos desativa em vez de excluir.
      if (error || !apagados || apagados.length === 0) {
        const { data: desativados, error: errDesativar } = await supabase.from('produtos')
          .update({ ativo: false }).eq('id', id).eq('empresa_id', empresaAtiva.id).select('id');
        if (errDesativar || !desativados || desativados.length === 0) {
          Alert.alert('Não foi possível desativar', mensagemErroBanco(errDesativar ?? { code: '42501' }, 'desativar este produto'));
          return;
        }
      }
      await invalidarEstoque(qc, empresaAtiva.id);
      router.back();
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16,
        flexDirection: 'row', alignItems: 'center', gap: 12,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <ChevronLeft size={22} color={C.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 }}>
            Estoque
          </Text>
          <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 22, color: C.text }} numberOfLines={1}>
            {nome || 'Editar Produto'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={confirmarExcluir}
          disabled={excluindo}
          style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center', opacity: excluindo ? 0.6 : 1 }}
        >
          {excluindo
            ? <ActivityIndicator size="small" color={C.red} />
            : <Trash2 size={16} color={C.red} strokeWidth={2} />
          }
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 100 }} keyboardShouldPersistTaps="handled">
        <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350 }}>

          <TipoSelector value={tipo} onChange={setTipo} />

          <Field
            label="Nome do produto"
            value={nome}
            onChange={setNome}
            placeholder={tipo === 'venda' ? 'Ex: Água de Coco 350ml' : 'Ex: Cola para cílios 5ml'}
          />

          <ChipSelector label="Categoria" options={opcoesCategoria} value={categoria} onChange={setCategoria} />

          {!!erroUnidades && (
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, marginBottom: 12 }}>
              Não foi possível carregar as unidades da empresa; mostrando a lista padrão.
            </Text>
          )}
          <ChipSelector label="Unidade de medida" options={opcoesUnidade} value={unidade} onChange={setUnidade} />

          {unidadePedeQtdPorUnidade(unidade) && (
            <Field
              label={`Quantas unidades vêm dentro ${unidade === 'cx' ? 'da caixa' : 'do pacote'}?`}
              value={qtdPorUn}
              onChange={setQtdPorUn}
              placeholder="Ex: 12"
              keyboardType="decimal-pad"
              opcional
            />
          )}

          <Field
            label="Quantidade atual"
            value={estAtual}
            onChange={setEstAtual}
            placeholder={`Quantidade em ${unidade}`}
            keyboardType={TECLADO_COM_SINAL}
          />

          <Field
            label="Quantidade mínima"
            value={estMin}
            onChange={setEstMin}
            placeholder="Qtd. mínima antes do alerta"
            keyboardType="decimal-pad"
            dica="Abaixo disso → alerta de reposição"
          />

          <Field
            label="Custo unitário (R$)"
            value={custo}
            onChange={setCusto}
            placeholder="0,00"
            keyboardType="decimal-pad"
            opcional
          />

          {tipo === 'venda' && (
            <Field
              label="Preço de venda (R$)"
              value={precoVenda}
              onChange={setPrecoVenda}
              placeholder="0,00"
              keyboardType="decimal-pad"
              dica={margem !== null ? `Margem: ${margem}%` : 'Aparece no PDV'}
            />
          )}

        </MotiView>
      </ScrollView>

      {/* Botão salvar fixo */}
      <View style={{
        position: 'absolute', bottom: insets.bottom + 16, left: 24, right: 24,
      }}>
        <TouchableOpacity
          onPress={handleSalvar}
          disabled={salvando}
          style={{ backgroundColor: C.primary, borderRadius: 16, padding: 17, alignItems: 'center' }}
        >
          {salvando
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                Salvar alterações
              </Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
