import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList } from 'react-native';
import { Package, Plus, Trash2, X, Search } from 'lucide-react-native';
import type { InsumoItem, ProdutoInsumo } from './servicos-gravacao';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', accent: '#9B6FE8', accentSoft: '#F3EEFD', red: '#C0392B',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

/**
 * Editor de insumos do serviço (mesmo do web): produto, quantidade e unidade; os produtos são
 * debitados do estoque ao concluir um atendimento deste serviço.
 */
export function InsumosEditor({ produtos, insumos, onChange, erroProdutos }: {
  produtos: ProdutoInsumo[];
  insumos: InsumoItem[];
  onChange: (insumos: InsumoItem[]) => void;
  erroProdutos: string | null;
}) {
  const [escolhendo, setEscolhendo] = useState(false);
  const [busca, setBusca] = useState('');

  const disponiveis = produtos
    .filter((p) => !insumos.some((i) => i.produto_id === p.id))
    .filter((p) => p.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  function adicionar(p: ProdutoInsumo) {
    if (insumos.some((i) => i.produto_id === p.id)) return;
    onChange([...insumos, { produto_id: p.id, nome: p.nome, unidade: p.unidade, quantidade: '1' }]);
    setEscolhendo(false);
    setBusca('');
  }

  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Package size={13} color={C.text3} strokeWidth={2} />
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
          Insumos consumidos (opcional)
        </Text>
      </View>
      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 10 }}>
        Produtos debitados do estoque ao concluir um agendamento deste serviço.
      </Text>

      {insumos.map((ins) => (
        <View key={ins.produto_id} style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6,
          backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12,
          paddingHorizontal: 12, paddingVertical: 8,
        }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>
            {ins.nome}
          </Text>
          <TextInput
            value={ins.quantidade}
            onChangeText={(q) => onChange(insumos.map((i) => i.produto_id === ins.produto_id ? { ...i, quantidade: q } : i))}
            keyboardType="decimal-pad"
            accessibilityLabel={`Quantidade de ${ins.nome}`}
            style={{
              width: 60, height: 34, borderRadius: 8, borderWidth: 1, borderColor: C.border,
              backgroundColor: C.bg, textAlign: 'center',
              fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text,
            }}
          />
          <Text style={{ width: 28, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>
            {ins.unidade}
          </Text>
          <TouchableOpacity
            onPress={() => onChange(insumos.filter((i) => i.produto_id !== ins.produto_id))}
            accessibilityLabel={`Remover ${ins.nome}`}
            style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={14} color={C.red} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      ))}

      {erroProdutos ? (
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red }}>{erroProdutos}</Text>
      ) : (
        <TouchableOpacity
          onPress={() => setEscolhendo(true)}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            borderWidth: 1, borderStyle: 'dashed', borderColor: C.accent, borderRadius: 12,
            paddingVertical: 10, backgroundColor: C.accentSoft,
          }}
        >
          <Plus size={14} color={C.primary} strokeWidth={2.5} />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.primary }}>
            Adicionar insumo
          </Text>
        </TouchableOpacity>
      )}

      <Modal visible={escolhendo} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEscolhendo(false)}>
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.text }}>Escolher insumo</Text>
            <TouchableOpacity onPress={() => setEscolhendo(false)} accessibilityLabel="Fechar">
              <X size={18} color={C.text3} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, marginBottom: 0,
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12,
          }}>
            <Search size={14} color={C.text3} strokeWidth={2} />
            <TextInput
              value={busca}
              onChangeText={setBusca}
              placeholder="Buscar produto..."
              placeholderTextColor={C.text4}
              style={{ flex: 1, height: 42, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
            />
          </View>
          <FlatList
            data={disponiveis}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 6 }}
            renderItem={({ item: p }) => (
              <TouchableOpacity
                onPress={() => adicionar(p)}
                style={{
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14,
                  padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
                }}
              >
                <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{p.nome}</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>{p.unidade}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={() => (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Nenhum produto disponível
                </Text>
              </View>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}
