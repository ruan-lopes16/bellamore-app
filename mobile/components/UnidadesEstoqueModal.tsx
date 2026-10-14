import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { X } from 'lucide-react-native';
import {
  GRUPOS_UNIDADE, UNIDADES_PRODUTO, UNIDADES_PADRAO, normalizarUnidadesVisiveis,
} from '@shared/estoque';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

/**
 * Ajuste das unidades de medida que aparecem no cadastro de produto (mesma tela do web,
 * `estoque/UnidadesModal.tsx`). Grava pela função `onSalvar` (o `salvarUnidades` do
 * `useEstoque`, que usa `salvarUnidadesVisiveis` de shared). Produtos já cadastrados nunca mudam.
 * Não fecha durante o salvamento; Salvar fica desabilitado com nenhuma unidade ligada.
 */
export function UnidadesEstoqueModal({ visiveis, onClose, onSalvar, onSalvo }: {
  /** Unidades visíveis hoje (null = padrão). */
  visiveis: string[] | null;
  onClose: () => void;
  /** Grava e devolve a lista gravada; lança `Error` com mensagem em português. */
  onSalvar: (lista: string[]) => Promise<string[]>;
  onSalvo: (lista: string[]) => void;
}) {
  const [ligadas, setLigadas] = useState<string[]>(() => normalizarUnidadesVisiveis(visiveis ?? UNIDADES_PADRAO));
  const [salvando, setSalvando] = useState(false);
  const salvandoRef = useRef(false);

  function alternar(chave: string) {
    if (salvandoRef.current) return;
    setLigadas(prev => prev.includes(chave) ? prev.filter(c => c !== chave) : [...prev, chave]);
  }

  function fechar() {
    if (salvandoRef.current) return;
    onClose();
  }

  async function salvar() {
    if (salvandoRef.current || ligadas.length === 0) return;
    salvandoRef.current = true;
    setSalvando(true);
    try {
      const lista = await onSalvar(ligadas);
      salvandoRef.current = false;
      setSalvando(false);
      onSalvo(lista);
    } catch (e) {
      salvandoRef.current = false;
      setSalvando(false);
      Alert.alert('Não foi possível ajustar as unidades', e instanceof Error ? e.message : 'Tente novamente.');
    }
  }

  const podeSalvar = ligadas.length > 0 && !salvando;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={fechar}>
      <View style={{ flex: 1 }}>
        <TouchableOpacity activeOpacity={1} onPress={fechar} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
        <View style={{
          backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingTop: 24, paddingHorizontal: 24, paddingBottom: 36, maxHeight: '85%',
        }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 20, color: C.text }}>Unidades de medida</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginTop: 2 }}>
                Escolha as que aparecem ao cadastrar um produto.
              </Text>
            </View>
            <TouchableOpacity onPress={fechar} disabled={salvando} accessibilityLabel="Fechar" style={{ padding: 4, opacity: salvando ? 0.4 : 1 }}>
              <X size={20} color={C.text3} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 18, paddingBottom: 8 }}>
            {GRUPOS_UNIDADE.map(g => (
              <View key={g.key}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                  {g.label}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {UNIDADES_PRODUTO.filter(u => u.grupo === g.key).map(u => {
                    const ativo = ligadas.includes(u.key);
                    return (
                      <TouchableOpacity
                        key={u.key}
                        onPress={() => alternar(u.key)}
                        accessibilityState={{ selected: ativo }}
                        style={{
                          paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1,
                          backgroundColor: ativo ? C.primarySoft : C.bg,
                          borderColor: ativo ? C.primary : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? C.primary : C.text3 }}>
                          {u.label} ({u.key})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Rodapé */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <TouchableOpacity
              onPress={() => { if (!salvandoRef.current) setLigadas(normalizarUnidadesVisiveis(UNIDADES_PADRAO)); }}
              disabled={salvando}
              style={{ paddingHorizontal: 12, height: 44, borderRadius: 14, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.5 : 1 }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3 }}>Restaurar padrão</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={fechar}
              disabled={salvando}
              style={{ flex: 1, height: 44, borderRadius: 14, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.5 : 1 }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={salvar}
              disabled={!podeSalvar}
              style={{ flex: 1, height: 44, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: podeSalvar ? 1 : 0.5 }}
            >
              {salvando
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>Salvar</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
