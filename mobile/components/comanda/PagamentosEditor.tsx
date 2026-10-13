/**
 * @file PagamentosEditor.tsx
 * Bloco "Pagamento" do app, compartilhado pela Comanda (nova-comanda.tsx) e pelas Vendas avulsas
 * (vendas.tsx): chips de método (cada toque adiciona um pagamento — métodos podem se repetir),
 * valor de cada pagamento, maquininha (chips quando há 2+ ativas), bandeira, parcelas, taxa/líquido
 * da configuração de cartões e o quadro Recebido / Falta / Troco.
 *
 * Regras (as mesmas do web):
 * - taxa pela configuração (`taxaDoSplit`); combinação sem taxa → aviso, nunca taxa inventada;
 * - pagamento reaberto (comanda fechada) mantém maquininha/bandeira gravadas mesmo desativadas;
 * - falta/troco vêm de `resumoComanda` (quem chama passa o resumo pronto).
 */
import type { Dispatch, SetStateAction } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { parseValorBR, taxaDoSplit, type SplitPagamento } from '@shared/comanda-fechamento';
import {
  fmtTaxa, valorLiquido, maquininhasAtivas, maquininhaPadrao, bandeirasAtivas, nomeBandeira, parcelasDisponiveis,
  type ConfigCartoes,
} from '@shared/taxas-cartao';
import { formatarMoeda } from '@shared/moeda';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

/** Métodos de pagamento do app (rótulo e cores do chip). */
export const METODOS_PAGAMENTO = [
  { key: 'dinheiro', label: 'Dinheiro', bg: '#F0FDF4', cor: '#16A34A' },
  { key: 'pix',      label: 'PIX',      bg: '#EEF2FF', cor: '#4F46E5' },
  { key: 'credito',  label: 'Crédito',  bg: '#FEF3C7', cor: '#D97706' },
  { key: 'debito',   label: 'Débito',   bg: '#FDF2F8', cor: '#9D174D' },
  { key: 'cortesia', label: 'Cortesia', bg: '#F9FAFB', cor: '#6B7280' },
] as const;

/**
 * Pagamento na tela (valor como texto, convertido com parseValorBR). Os campos `*Gravad*`/`criadoEm`
 * só existem num pagamento reaberto da comanda fechada.
 */
export type SplitEditavel = Omit<SplitPagamento, 'valor'> & { valor: string };

type Props<S extends SplitEditavel> = {
  splits: S[];
  setSplits: Dispatch<SetStateAction<S[]>>;
  config: ConfigCartoes;
  /** Recebido/falta/troco de resumoComanda. */
  resumo: { recebido: number; falta: number; troco: number };
  /** Mostra o chip "Cortesia" (a comanda esconde sem `comanda.desconto`; a venda mostra sempre, igual ao web). */
  permitirCortesia: boolean;
  /** Trava a edição (ex.: venda já gravada pela metade). */
  desabilitado?: boolean;
};

export default function PagamentosEditor<S extends SplitEditavel>({
  splits, setSplits, config, resumo, permitirCortesia, desabilitado = false,
}: Props<S>) {
  const { recebido, falta, troco } = resumo;

  function adicionarSplit(metodo: string) {
    const cartao = metodo === 'credito' || metodo === 'debito';
    setSplits(prev => [...prev, {
      metodo,
      valor: falta > 0 ? falta.toFixed(2).replace('.', ',') : '',
      ...(cartao ? { maquininhaId: maquininhaPadrao(config)?.id ?? null } : {}),
    } as S]);
  }
  function removerSplit(idx: number) { setSplits(prev => prev.filter((_, i) => i !== idx)); }
  function atualizarSplitBandeira(idx: number, bandeira: string) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, bandeira } : s));
  }
  function atualizarSplitParcelas(idx: number, parcelas: number) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, parcelas } : s));
  }
  /** Troca a maquininha; se ela aceita menos parcelas que as escolhidas, ajusta para o máximo dela. */
  function atualizarSplitMaquininha(idx: number, maquininhaId: string) {
    const maq = config.maquininhas.find(m => m.id === maquininhaId);
    setSplits(prev => prev.map((s, i) => {
      if (i !== idx) return s;
      const parcelas = maq && (s.parcelas ?? 1) > maq.maxParcelas ? maq.maxParcelas : s.parcelas;
      return { ...s, maquininhaId, parcelas };
    }));
  }

  return (
    <View pointerEvents={desabilitado ? 'none' : 'auto'} style={{ opacity: desabilitado ? 0.5 : 1 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Pagamento</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
        {METODOS_PAGAMENTO.filter(m => permitirCortesia || m.key !== 'cortesia').map(m => (
          <TouchableOpacity key={m.key} onPress={() => adicionarSplit(m.key)}
            activeOpacity={0.7} disabled={desabilitado}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: m.bg, borderWidth: 1, borderColor: C.border }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: m.cor }}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {splits.length > 0 && (
        <View style={{ marginTop: 10, gap: 8 }}>
          {splits.map((s, i) => {
            const m = METODOS_PAGAMENTO.find(x => x.key === s.metodo) ?? METODOS_PAGAMENTO[0];
            const isCard = s.metodo === 'credito' || s.metodo === 'debito';
            const valorN = parseValorBR(s.valor);
            // Pagamento reaberto e não alterado mostra a taxa gravada (a mesma que será salva)
            const taxa = taxaDoSplit(s, config);
            // Maquininha efetiva: a escolhida (ou gravada no reaberto) ou a padrão
            const maq = config.maquininhas.find(x => x.id === s.maquininhaId) ?? maquininhaPadrao(config);
            const opcoesParcelas = maq ? parcelasDisponiveis(maq) : [1];
            if (!opcoesParcelas.includes(s.parcelas ?? 1)) opcoesParcelas.push(s.parcelas ?? 1);
            const ativasB = bandeirasAtivas(config);
            const bandeiras = s.bandeira && !ativasB.some(b => b.chave === s.bandeira)
              ? [...ativasB, { chave: s.bandeira, nome: nomeBandeira(config, s.bandeira) }] : ativasB;
            return (
              <View key={i} style={{ backgroundColor: m.bg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.border, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', height: 32, gap: 8 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: m.cor, flex: 1 }}>{m.label}</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>R$</Text>
                  <TextInput
                    value={s.valor}
                    onChangeText={v => setSplits(prev => prev.map((x, j) => j === i ? { ...x, valor: v } : x))}
                    keyboardType="decimal-pad" placeholder="0,00"
                    placeholderTextColor={C.text4} editable={!desabilitado}
                    style={{ width: 80, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text, textAlign: 'right' }}
                  />
                  <TouchableOpacity onPress={() => removerSplit(i)}
                    style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                    <X size={14} color={C.text4} />
                  </TouchableOpacity>
                </View>
                {isCard && maquininhasAtivas(config).length >= 2 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>Maquininha:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {(() => {
                        // Maquininha gravada que foi desativada continua visível no pagamento reaberto
                        const ativas = maquininhasAtivas(config);
                        const lista = maq && !ativas.some(x => x.id === maq.id) ? [...ativas, maq] : ativas;
                        return lista.map(mq => {
                          const ativa = maq?.id === mq.id;
                          return (
                            <TouchableOpacity key={mq.id} onPress={() => atualizarSplitMaquininha(i, mq.id)}
                              accessibilityRole="button" accessibilityState={{ selected: ativa }}
                              style={{
                                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
                                borderColor: ativa ? m.cor : C.border, backgroundColor: ativa ? C.surface : 'transparent',
                              }}>
                              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: m.cor }}>{mq.nome}</Text>
                            </TouchableOpacity>
                          );
                        });
                      })()}
                    </ScrollView>
                  </View>
                )}
                {isCard && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {bandeiras.map(b => {
                      const ativa = s.bandeira === b.chave;
                      return (
                        <TouchableOpacity key={b.chave} onPress={() => atualizarSplitBandeira(i, b.chave)}
                          accessibilityRole="button" accessibilityState={{ selected: ativa }}
                          style={{
                            paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
                            borderColor: ativa ? m.cor : C.border, backgroundColor: ativa ? 'rgba(255,255,255,0.6)' : 'transparent',
                            opacity: ativa ? 1 : 0.6,
                          }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: m.cor }}>{b.nome}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                {s.metodo === 'credito' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>Parcelas:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {opcoesParcelas.map(n => {
                        const ativa = (s.parcelas ?? 1) === n;
                        return (
                          <TouchableOpacity key={n} onPress={() => atualizarSplitParcelas(i, n)}
                            accessibilityRole="button" accessibilityState={{ selected: ativa }}
                            style={{
                              paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1,
                              borderColor: ativa ? m.cor : C.border, backgroundColor: ativa ? C.surface : 'transparent',
                            }}>
                            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: m.cor }}>
                              {n}x{n === 1 ? ' (à vista)' : ''}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
                {isCard && taxa === null && (
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.amber }}>
                    Taxa não cadastrada para esta combinação
                  </Text>
                )}
                {isCard && taxa !== null && valorN > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', opacity: 0.75 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: m.cor }}>Taxa {fmtTaxa(taxa)}</Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: m.cor }}>Líquido {formatarMoeda(valorLiquido(valorN, taxa))}</Text>
                  </View>
                )}
              </View>
            );
          })}

          {/* Status pagamento — falta/troco vêm de resumoComanda (regra única) */}
          <View style={{
            borderRadius: 14, padding: 14, borderWidth: 1,
            backgroundColor: falta <= 0.01 && troco <= 0.01 ? C.greenSoft : falta > 0.01 ? C.amberSoft : C.primarySoft,
            borderColor: falta <= 0.01 && troco <= 0.01 ? '#0D7E5F33' : falta > 0.01 ? '#B4530933' : '#2C165433',
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Recebido</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>{formatarMoeda(recebido)}</Text>
            </View>
            {falta > 0.01 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.amber }}>Falta</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.amber }}>{formatarMoeda(falta)}</Text>
              </View>
            )}
            {troco > 0.01 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.primary }}>Troco</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary }}>{formatarMoeda(troco)}</Text>
              </View>
            )}
            {falta <= 0.01 && troco <= 0.01 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6 }}>
                <Check size={14} color={C.green} strokeWidth={3} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.green }}>Valor quitado</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
