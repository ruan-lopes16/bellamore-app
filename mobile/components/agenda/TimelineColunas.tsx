/**
 * Timeline em "Todas": uma coluna por profissional (de `colunasPorProfissional`), com o nome no
 * topo e rolagem horizontal. Cada linha é uma hora da janela do dia; a altura acompanha a célula
 * mais alta, então as colunas ficam alinhadas. O conteúdo de cada célula vem de `renderCelula`.
 */
import type { ReactNode } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { agruparPorHora } from './grade';

const C = { surface: '#FFFFFF', border: '#E8E2DC', primary: '#2C1654', text2: '#4A3F5C', linha: '#D8D0C8' };

const LARGURA_HORA = 48;

export function TimelineColunas<T extends { data_hora_inicio: string }>({
  colunas, horas, renderCelula, larguraColuna = 210,
}: {
  colunas: { profissional: { id: string; nome: string }; itens: T[] }[];
  horas: number[];
  /** Conteúdo da célula (profissional × hora), com os atendimentos que começam nessa hora. */
  renderCelula: (profissionalId: string, itensDaHora: T[], hora: number) => ReactNode;
  larguraColuna?: number;
}) {
  const porHora = colunas.map((c) => agruparPorHora(c.itens));

  if (colunas.length === 0) {
    return (
      <Text style={{ marginHorizontal: 24, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text2 }}>
        Nenhuma profissional ativa.
      </Text>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingHorizontal: 24 }}>
      <View>
        {/* Nomes no topo */}
        <View style={{ flexDirection: 'row', marginBottom: 10 }}>
          <View style={{ width: LARGURA_HORA }} />
          {colunas.map((c) => (
            <View key={c.profissional.id} style={{
              width: larguraColuna, marginLeft: 8, paddingVertical: 6, borderRadius: 10,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center',
            }}>
              <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.primary }}>
                {c.profissional.nome}
              </Text>
            </View>
          ))}
        </View>

        {horas.map((hora) => (
          <View key={hora} style={{ flexDirection: 'row', minHeight: 64 }}>
            <View style={{ width: LARGURA_HORA, alignItems: 'flex-end', paddingRight: 4 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text2, letterSpacing: -0.3, marginTop: -6 }}>
                {String(hora).padStart(2, '0')}:00
              </Text>
            </View>
            {colunas.map((c, i) => (
              <View key={c.profissional.id} style={{ width: larguraColuna, marginLeft: 8 }}>
                <View style={{ height: 1, backgroundColor: C.linha, marginBottom: 6 }} />
                {renderCelula(c.profissional.id, porHora[i][hora] ?? [], hora)}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
