import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { X, Pencil, Trash2, Check } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { CategoriaIconCustom } from '@/components/CategoriaIcon';
import {
  CATEGORIA_PALETA, CATEGORIA_ICONES, bgDaCor, type CategoriaCustom,
} from '@shared/categorias';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
  red: '#DC2626',
};

type Props = {
  visible: boolean;
  customs: CategoriaCustom[];
  contarUso: (categoriaId: string) => number;
  onClose: () => void;
  onAtualizada: (c: CategoriaCustom) => void;
  onExcluida: (id: string) => void;
};

export function CategoriasManagerModal({ visible, customs, contarUso, onClose, onAtualizada, onExcluida }: Props) {
  const [editId, setEditId]   = useState<string | null>(null);
  const [nome, setNome]       = useState('');
  const [cor, setCor]         = useState('');
  const [icone, setIcone]     = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);

  function abrirEdicao(c: CategoriaCustom) {
    setEditId(c.id); setNome(c.nome); setCor(c.cor); setIcone(c.icone);
  }

  async function salvar(id: string) {
    const limpo = nome.trim();
    if (!limpo) { Alert.alert('Nome obrigatório'); return; }
    setBusy(true);
    const { data, error } = await supabase
      .from('categorias_servico')
      .update({ nome: limpo, cor, icone })
      .eq('id', id).select('*').single();
    setBusy(false);
    if (error) {
      Alert.alert('Não deu', error.message.includes('uniq') ? 'Já existe categoria com esse nome.' : 'Sem permissão (só gestor/dono).');
      return;
    }
    onAtualizada(data as CategoriaCustom);
    setEditId(null);
  }

  async function excluir(id: string) {
    setBusy(true);
    const { error } = await supabase.from('categorias_servico').delete().eq('id', id).select('id');
    setBusy(false);
    if (error) { Alert.alert('Não deu', 'Sem permissão para excluir (só gestor/dono).'); return; }
    onExcluida(id);
    setConfirmDel(null);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', paddingBottom: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text }}>Categorias personalizadas</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={C.text3} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
            {customs.length === 0 && (
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text4, textAlign: 'center', paddingVertical: 24 }}>
                Nenhuma categoria personalizada. Crie uma ao cadastrar um serviço.
              </Text>
            )}
            {customs.map((c) => {
              const emEdicao = editId === c.id;
              const usos = contarUso(c.id);
              return (
                <View key={c.id} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 }}>
                  {!emEdicao ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: bgDaCor(c.cor), alignItems: 'center', justifyContent: 'center' }}>
                        <CategoriaIconCustom name={c.icone} size={16} color={c.cor} />
                      </View>
                      <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{c.nome}</Text>
                      {confirmDel === c.id ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 11, color: C.red, fontFamily: 'PlusJakartaSans_500Medium' }}>
                            {usos > 0 ? `${usos} serviço(s) usam` : 'Confirmar?'}
                          </Text>
                          <TouchableOpacity onPress={() => excluir(c.id)} disabled={busy}
                            style={{ paddingHorizontal: 10, height: 30, borderRadius: 8, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'PlusJakartaSans_700Bold' }}>Excluir</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setConfirmDel(null)}
                            style={{ paddingHorizontal: 10, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: C.text2, fontSize: 12, fontFamily: 'PlusJakartaSans_500Medium' }}>Cancelar</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity onPress={() => abrirEdicao(c)}
                            style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                            <Pencil size={13} color={C.text4} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setConfirmDel(c.id)}
                            style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                            <Trash2 size={13} color={C.text4} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={{ gap: 10 }}>
                      <TextInput value={nome} onChangeText={setNome} placeholderTextColor={C.text4}
                        style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, height: 42, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }} />
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {CATEGORIA_PALETA.map((p) => (
                          <TouchableOpacity key={p.cor} onPress={() => setCor(p.cor)}
                            style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.bg, borderWidth: 2, borderColor: cor === p.cor ? p.cor : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                            <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: p.cor }} />
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {CATEGORIA_ICONES.map((n) => (
                          <TouchableOpacity key={n} onPress={() => setIcone(n)}
                            style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: icone === n ? cor : C.border, alignItems: 'center', justifyContent: 'center' }}>
                            <CategoriaIconCustom name={n} size={16} color={icone === n ? cor : C.text3} />
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity onPress={() => setEditId(null)}
                          style={{ flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => salvar(c.id)} disabled={busy}
                          style={{ flex: 1, height: 40, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, opacity: busy ? 0.5 : 1 }}>
                          <Check size={14} color="#fff" />
                          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>Salvar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
