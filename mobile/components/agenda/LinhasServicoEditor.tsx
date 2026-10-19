/**
 * Linhas de serviço do agendamento (criar e editar), igual ao modal do web:
 * cada linha tem serviço, valor e duração; dá para adicionar e remover.
 * Valor vazio = preço do serviço; "0" = cortesia (regra de `montarAgendamento`).
 */
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList } from 'react-native';
import { Plus, Trash2, ChevronDown, X } from 'lucide-react-native';
import { parseValorBR } from '@shared/comanda-fechamento';
import { valorDigitadoValido } from '@shared/agenda';
import { formatarMoeda } from '@shared/moeda';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8', accent: '#9B6FE8', accentSoft: '#F3EFFE',
  rose: '#B42318',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

/** Uma linha do formulário. `valor` e `duracao` ficam como texto digitado. */
export type LinhaServicoForm = {
  uid: string;
  servico_id: string;
  nome: string;
  /** Preço do serviço (usado quando o valor fica vazio). */
  preco: number;
  valor: string;
  duracao: string;
};

export type ServicoOpcao = { id: string; nome: string; preco: number; duracao_minutos: number; categoriaCor?: string };

let seq = 0;
/** Chave local da linha (só para a lista; nunca vai ao banco). */
export function novaChaveLinha(): string {
  seq += 1;
  return `l${Date.now().toString(36)}${seq}`;
}

export function linhaVazia(): LinhaServicoForm {
  return { uid: novaChaveLinha(), servico_id: '', nome: '', preco: 0, valor: '', duracao: '' };
}

/** Valor em reais no formato do campo ("150,00"). */
export function valorParaCampo(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

/** Duração digitada em minutos inteiros positivos, ou null. */
export function duracaoDigitada(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

type Props = {
  linhas: LinhaServicoForm[];
  servicos: ServicoOpcao[];
  onChange: (linhas: LinhaServicoForm[]) => void;
  desabilitado?: boolean;
};

export default function LinhasServicoEditor({ linhas, servicos, onChange, desabilitado }: Props) {
  const [escolhendoPara, setEscolhendoPara] = useState<string | null>(null);

  function atualizar(uid: string, parcial: Partial<LinhaServicoForm>) {
    onChange(linhas.map((l) => (l.uid === uid ? { ...l, ...parcial } : l)));
  }

  function escolherServico(s: ServicoOpcao) {
    if (!escolhendoPara) return;
    atualizar(escolhendoPara, {
      servico_id: s.id, nome: s.nome, preco: s.preco,
      valor: valorParaCampo(s.preco), duracao: String(s.duracao_minutos),
    });
    setEscolhendoPara(null);
  }

  function remover(uid: string) {
    if (linhas.length <= 1) return;
    onChange(linhas.filter((l) => l.uid !== uid));
  }

  return (
    <View style={{ gap: 10 }}>
      {linhas.map((l, i) => {
        const valorOk = valorDigitadoValido(l.valor);
        const duracaoOk = !l.servico_id || duracaoDigitada(l.duracao) != null;
        return (
          <View key={l.uid} style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 14, padding: 12, gap: 10,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                disabled={desabilitado}
                onPress={() => setEscolhendoPara(l.uid)}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
                  backgroundColor: l.servico_id ? C.primarySoft : C.bg,
                  borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
                }}
              >
                <Text numberOfLines={1} style={{
                  flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13,
                  color: l.servico_id ? C.primary : C.text3,
                }}>
                  {l.servico_id ? l.nome : `Serviço ${i + 1}: escolher…`}
                </Text>
                <ChevronDown size={14} color={C.text3} strokeWidth={2} />
              </TouchableOpacity>
              {linhas.length > 1 && !desabilitado && (
                <TouchableOpacity onPress={() => remover(l.uid)} style={{ padding: 6 }} accessibilityLabel="Remover serviço">
                  <Trash2 size={16} color={C.rose} strokeWidth={2} />
                </TouchableOpacity>
              )}
            </View>

            {!!l.servico_id && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 4 }}>
                    Valor (R$)
                  </Text>
                  <TextInput
                    editable={!desabilitado}
                    value={l.valor}
                    onChangeText={(v) => atualizar(l.uid, { valor: v })}
                    placeholder={valorParaCampo(l.preco)}
                    placeholderTextColor={C.text4}
                    keyboardType="decimal-pad"
                    style={{
                      borderWidth: 1, borderColor: valorOk ? C.border : C.rose, borderRadius: 10,
                      paddingHorizontal: 10, paddingVertical: 8,
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text,
                    }}
                  />
                </View>
                <View style={{ width: 110 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 4 }}>
                    Duração (min)
                  </Text>
                  <TextInput
                    editable={!desabilitado}
                    value={l.duracao}
                    onChangeText={(v) => atualizar(l.uid, { duracao: v.replace(/\D/g, '') })}
                    placeholder="60"
                    placeholderTextColor={C.text4}
                    keyboardType="number-pad"
                    maxLength={4}
                    style={{
                      borderWidth: 1, borderColor: duracaoOk ? C.border : C.rose, borderRadius: 10,
                      paddingHorizontal: 10, paddingVertical: 8,
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text,
                    }}
                  />
                </View>
              </View>
            )}
            {!!l.servico_id && !valorOk && (
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.rose }}>
                Valor inválido. Use, por exemplo, 150,00 (ou 0 para cortesia).
              </Text>
            )}
            {!!l.servico_id && valorOk && l.valor.trim() !== '' && parseValorBR(l.valor) === 0 && (
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.accent }}>
                Cortesia (R$ 0,00)
              </Text>
            )}
          </View>
        );
      })}

      {!desabilitado && (
        <TouchableOpacity
          onPress={() => onChange([...linhas, linhaVazia()])}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            borderWidth: 1, borderStyle: 'dashed', borderColor: C.accent, borderRadius: 12,
            paddingVertical: 10, backgroundColor: C.accentSoft,
          }}
        >
          <Plus size={14} color={C.primary} strokeWidth={2.5} />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.primary }}>
            Adicionar serviço
          </Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={escolhendoPara != null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEscolhendoPara(null)}
      >
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 24,
            borderBottomWidth: 1, borderBottomColor: C.border,
          }}>
            <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.text }}>
              Escolher serviço
            </Text>
            <TouchableOpacity onPress={() => setEscolhendoPara(null)} accessibilityLabel="Fechar">
              <X size={18} color={C.text3} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={servicos}
            keyExtractor={(s) => s.id}
            contentContainerStyle={{ padding: 16, gap: 6 }}
            renderItem={({ item: s }) => (
              <TouchableOpacity
                onPress={() => escolherServico(s)}
                style={{
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
                }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.categoriaCor ?? C.accent }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{s.nome}</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 1 }}>
                    {s.duracao_minutos} min
                  </Text>
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
                  {formatarMoeda(s.preco)}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={() => (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Nenhum serviço ativo cadastrado
                </Text>
              </View>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}
