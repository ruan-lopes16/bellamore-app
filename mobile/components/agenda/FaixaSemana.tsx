/**
 * Faixa da semana da agenda do app (domingo a sábado, em Brasília). As setas mudam a semana de
 * verdade (`semanaVizinha`) e levam o dia selecionado junto; o rótulo mostra o mês do dia.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { diasDaSemana, semanaVizinha } from '@shared/agenda';
import { rotuloMesAno } from '@shared/periodos';

const C = {
  surface: '#FFFFFF', border: '#E8E2DC', primary: '#2C1654', accent: '#9B6FE8',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6',
};

const NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function FaixaSemana({ dia, hoje, contagem, onSelecionar }: {
  /** Dia selecionado, "AAAA-MM-DD". */
  dia: string;
  /** Hoje em Brasília, para destacar. */
  hoje: string;
  /** Atendimentos por dia (pontinho quando > 0). */
  contagem?: Map<string, number>;
  onSelecionar: (dia: string) => void;
}) {
  const semana = diasDaSemana(dia);
  const botao = {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface, alignItems: 'center' as const, justifyContent: 'center' as const,
  };

  return (
    <View style={{ marginHorizontal: 24, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <TouchableOpacity onPress={() => onSelecionar(semanaVizinha(dia, -1))} style={botao} accessibilityLabel="Semana anterior">
          <ChevronLeft size={13} color={C.text2} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
          {rotuloMesAno(dia)}
        </Text>
        <TouchableOpacity onPress={() => onSelecionar(semanaVizinha(dia, 1))} style={botao} accessibilityLabel="Próxima semana">
          <ChevronRight size={13} color={C.text2} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', gap: 4 }}>
        {semana.map((d, i) => {
          const ativo = d === dia;
          const temAg = (contagem?.get(d) ?? 0) > 0;
          const ehHoje = d === hoje;
          return (
            <TouchableOpacity
              key={d}
              onPress={() => onSelecionar(d)}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 14, gap: 4,
                backgroundColor: ativo ? C.primary : temAg ? C.surface : 'transparent',
                borderWidth: ativo || temAg || ehHoje ? 1 : 0,
                borderColor: ativo ? C.primary : ehHoje ? C.accent : C.border,
              }}
            >
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5,
                color: ativo ? 'rgba(255,255,255,0.6)' : C.text3,
              }}>
                {NOMES[i]}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, lineHeight: 18, color: ativo ? '#fff' : C.text }}>
                {Number(d.slice(8, 10))}
              </Text>
              <View style={{
                width: 4, height: 4, borderRadius: 2,
                backgroundColor: ativo ? 'rgba(255,255,255,0.5)' : temAg ? C.accent : 'transparent',
              }} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
