import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, Modal,
  TextInput, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import {
  Plus, Package, AlertTriangle, CheckCircle2,
  ChevronRight, X, ArrowDownCircle, ArrowUpCircle,
  Search,
} from 'lucide-react-native';
import {
  useFonts,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useEstoque, type Produto, type MovimentoTipo } from '@/hooks/useEstoque';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  red: '#C0392B', redSoft: '#FEF2F2',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

type Filtro = 'todos' | 'critico' | 'baixo' | 'ok';

// ── Modal de movimentação ────────────────────────────────────

interface ModalMovProps {
  produto: Produto | null;
  onClose: () => void;
  onConfirmar: (tipo: MovimentoTipo, quantidade: number, motivo: string) => Promise<void>;
}

function ModalMovimentacao({ produto, onClose, onConfirmar }: ModalMovProps) {
  const [tipo, setTipo] = useState<MovimentoTipo>('entrada');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  if (!produto) return null;

  async function handleConfirmar() {
    const qtd = Number(quantidade.replace(',', '.'));
    if (!qtd || qtd <= 0) {
      Alert.alert('Quantidade inválida', 'Informe uma quantidade maior que zero.');
      return;
    }
    setLoading(true);
    try {
      await onConfirmar(tipo, qtd, motivo);
      onClose();
    } catch {
      Alert.alert('Erro', 'Não foi possível registrar a movimentação.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
        <View style={{
          backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: 24, paddingBottom: 36,
        }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <View>
              <Text style={{ fontFamily: 'CormorantGaramond_700Bold', fontSize: 20, color: C.text }}>
                Movimentação
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginTop: 2 }}>
                {produto.nome}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <X size={20} color={C.text3} />
            </TouchableOpacity>
          </View>

          {/* Tipo */}
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Tipo
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {(['entrada', 'saida'] as MovimentoTipo[]).map((t) => {
              const ativo = tipo === t;
              const isEntrada = t === 'entrada';
              const cor = isEntrada ? C.green : C.red;
              const bgCor = isEntrada ? C.greenSoft : C.redSoft;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTipo(t)}
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 8, paddingVertical: 12, borderRadius: 14,
                    backgroundColor: ativo ? bgCor : C.bg,
                    borderWidth: 1.5,
                    borderColor: ativo ? cor : C.border,
                  }}
                >
                  {isEntrada
                    ? <ArrowDownCircle size={16} color={ativo ? cor : C.text3} strokeWidth={2} />
                    : <ArrowUpCircle size={16} color={ativo ? cor : C.text3} strokeWidth={2} />
                  }
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13,
                    color: ativo ? cor : C.text3,
                  }}>
                    {isEntrada ? 'Entrada' : 'Saída'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Estoque atual */}
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between',
            backgroundColor: C.bg, borderRadius: 12, padding: 12, marginBottom: 20,
          }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
              Estoque atual
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
              {produto.estoque_atual} {produto.unidade}
            </Text>
          </View>

          {/* Quantidade */}
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Quantidade
          </Text>
          <TextInput
            value={quantidade}
            onChangeText={setQuantidade}
            keyboardType="decimal-pad"
            placeholder={`Ex: 5 ${produto.unidade}`}
            placeholderTextColor={C.text4}
            style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, padding: 14, marginBottom: 16,
              fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text,
            }}
          />

          {/* Motivo */}
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Motivo (opcional)
          </Text>
          <TextInput
            value={motivo}
            onChangeText={setMotivo}
            placeholder="Ex: Compra, uso em atendimento..."
            placeholderTextColor={C.text4}
            style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, padding: 14, marginBottom: 24,
              fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text,
            }}
          />

          {/* Botão confirmar */}
          <TouchableOpacity
            onPress={handleConfirmar}
            disabled={loading}
            style={{
              backgroundColor: C.primary, borderRadius: 14,
              padding: 16, alignItems: 'center',
            }}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                  Confirmar
                </Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Card de produto ──────────────────────────────────────────

function ProdutoRow({ produto, onPress }: { produto: Produto; onPress: () => void }) {
  const pct = produto.estoque_minimo > 0
    ? Math.min(produto.estoque_atual / produto.estoque_minimo, 1)
    : 1;

  const statusColor =
    produto.status === 'critico' ? C.red :
    produto.status === 'baixo'   ? C.amber : C.green;

  const statusBg =
    produto.status === 'critico' ? C.redSoft :
    produto.status === 'baixo'   ? C.amberSoft : C.greenSoft;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 14, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}
    >
      {/* Ícone status */}
      <View style={{
        width: 38, height: 38, borderRadius: 12,
        backgroundColor: statusBg,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {produto.status === 'ok'
          ? <CheckCircle2 size={17} color={statusColor} strokeWidth={2} />
          : <AlertTriangle size={17} color={statusColor} strokeWidth={2} />
        }
      </View>

      {/* Info */}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 2 }}>
          {produto.nome}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 6 }}>
          {produto.categoria}
        </Text>
        {/* Barra de progresso */}
        <View style={{ height: 3, backgroundColor: C.border, borderRadius: 2 }}>
          <View style={{ width: `${pct * 100}%`, height: 3, backgroundColor: statusColor, borderRadius: 2 }} />
        </View>
      </View>

      {/* Saldo */}
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.text }}>
          {produto.estoque_atual}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
          {produto.unidade}
        </Text>
      </View>

      <ChevronRight size={14} color={C.text4} strokeWidth={2} />
    </TouchableOpacity>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function EstoqueScreen() {
  const insets = useSafeAreaInsets();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null);

  const { produtos, criticos, baixos, normais, totalCriticos, totalAtencao, isLoading, refetch, registrarMovimento } = useEstoque();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  if (!fontsLoaded) return null;

  // Filtra por status e busca
  const listaFiltrada = (
    filtro === 'todos'   ? produtos :
    filtro === 'critico' ? criticos  :
    filtro === 'baixo'   ? baixos    : normais
  ).filter((p) =>
    busca.length === 0 ||
    p.nome.toLowerCase().includes(busca.toLowerCase()) ||
    p.categoria.toLowerCase().includes(busca.toLowerCase())
  );

  const FILTROS: { key: Filtro; label: string }[] = [
    { key: 'todos',   label: 'Todos'    },
    { key: 'critico', label: 'Crítico'  },
    { key: 'baixo',   label: 'Atenção'  },
    { key: 'ok',      label: 'OK'       },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 24, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              Estoque
            </Text>
            <Text style={{ fontFamily: 'CormorantGaramond_700Bold', fontSize: 26, color: C.text }}>
              Produtos
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(empresa)/novo-produto')}
            style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Plus size={18} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      </View>

      {/* KPIs */}
      <MotiView
        from={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 350 }}
        style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginBottom: 16 }}
      >
        {[
          { label: 'Total', value: String(produtos.length), bg: C.surface, color: C.text },
          { label: 'Crítico', value: String(totalCriticos), bg: C.redSoft, color: C.red },
          { label: 'Atenção', value: String(totalAtencao), bg: C.amberSoft, color: C.amber },
        ].map((k) => (
          <View key={k.label} style={{
            flex: 1, backgroundColor: k.bg, borderRadius: 14, padding: 12,
            alignItems: 'center', borderWidth: 1, borderColor: C.border,
          }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: k.color, lineHeight: 26 }}>
              {k.value}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 3 }}>
              {k.label}
            </Text>
          </View>
        ))}
      </MotiView>

      {/* Busca */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        marginHorizontal: 24, marginBottom: 12,
        backgroundColor: C.surface, borderRadius: 12,
        borderWidth: 1, borderColor: C.border,
        paddingHorizontal: 12, paddingVertical: 10,
      }}>
        <Search size={15} color={C.text3} strokeWidth={2} />
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar produto..."
          placeholderTextColor={C.text4}
          style={{ flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text }}
        />
      </View>

      {/* Filtros */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 24, marginBottom: 12 }}>
        {FILTROS.map((f) => {
          const ativo = filtro === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFiltro(f.key)}
              style={{
                paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20,
                backgroundColor: ativo ? C.primary : C.surface,
                borderWidth: 1, borderColor: ativo ? C.primary : C.border,
              }}
            >
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12,
                color: ativo ? '#fff' : C.text3,
              }}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Lista */}
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
      >
        {isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
        ) : listaFiltrada.length === 0 ? (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ alignItems: 'center', marginTop: 60 }}>
            <Package size={40} color={C.text4} strokeWidth={1.5} />
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text3, marginTop: 12 }}>
              Nenhum produto encontrado
            </Text>
          </MotiView>
        ) : (
          <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
            {listaFiltrada.map((produto, i) => (
              <MotiView
                key={produto.id}
                from={{ opacity: 0, translateX: -8 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={{ type: 'timing', duration: 300, delay: i * 40 }}
              >
                <ProdutoRow
                  produto={produto}
                  onPress={() => setProdutoSelecionado(produto)}
                />
              </MotiView>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Modal de movimentação */}
      <ModalMovimentacao
        produto={produtoSelecionado}
        onClose={() => setProdutoSelecionado(null)}
        onConfirmar={(tipo, quantidade, motivo) =>
          registrarMovimento(produtoSelecionado!.id, tipo, quantidade, motivo)
        }
      />
    </View>
  );
}
