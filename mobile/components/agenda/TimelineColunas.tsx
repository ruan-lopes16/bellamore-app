/**
 * Timeline em "Todas": uma coluna por profissional (de `colunasPorProfissional`), com o nome no
 * topo e rolagem horizontal. Cada linha é uma hora da janela do dia; a altura acompanha a célula
 * mais alta, então as colunas ficam alinhadas. O conteúdo de cada célula vem de `renderCelula`.
 */
import type { ReactNode } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { agruparPorHora, continuacoesPorHora } from '@shared/agenda-grade';
import { useTema } from '@/lib/tema';


const LARGURA_HORA = 48;

export function TimelineColunas<T extends { data_hora_inicio: string; data_hora_fim: string; status?: string | null }>({
  colunas, horas, dia, renderCelula, larguraColuna = 210,
}: {
  colunas: { profissional: { id: string; nome: string }; itens: T[] }[];
  horas: number[];
  /** Dia exibido (aaaa-mm-dd, Brasília): base para achar os atendimentos que continuam em cada hora. */
  dia: string;
  /**
   * Conteúdo da célula (profissional × hora): os atendimentos que começam nessa hora e, em
   * `continuacoes`, os que começaram antes e ainda estão em andamento nela.
   */
  renderCelula: (profissionalId: string, itensDaHora: T[], hora: number, continuacoes: T[]) => ReactNode;
  larguraColuna?: number;
}) {
  const { C } = useTema();
  const porHora = colunas.map((c) => agruparPorHora(c.itens));
  const contsPorColuna = colunas.map((c) => continuacoesPorHora(c.itens, dia, horas));

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
                {renderCelula(c.profissional.id, porHora[i][hora] ?? [], hora, contsPorColuna[i][hora] ?? [])}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
