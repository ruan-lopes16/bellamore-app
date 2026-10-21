/**
 * Visão Mês da agenda do app: grade de 6 semanas (domingo primeiro, `gradeCalendarioMes`) com a
 * contagem de atendimentos de cada dia. Tocar num dia abre a visão Dia nele.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { gradeCalendarioMes, rotuloMesAno, somarMeses } from '@shared/periodos';

const C = {
  surface: '#FFFFFF', border: '#E8E2DC', primary: '#2C1654', primarySoft: '#EEE8F8', accent: '#9B6FE8',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const CABECALHO = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function VisaoMes({ mes, diaSelecionado, hoje, contagem, carregando, erro, onMudarMes, onAbrirDia }: {
  /** Mês exibido, "AAAA-MM". */
  mes: string;
  diaSelecionado: string;
  hoje: string;
  /** Atendimentos por dia (sem cancelados). */
  contagem?: Map<string, number>;
  carregando?: boolean;
  erro?: boolean;
  onMudarMes: (mes: string) => void;
  onAbrirDia: (dia: string) => void;
}) {
  const grade = gradeCalendarioMes(mes, diaSelecionado);
  const semanas = Array.from({ length: 6 }, (_, i) => grade.slice(i * 7, i * 7 + 7));
  const botao = {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface, alignItems: 'center' as const, justifyContent: 'center' as const,
  };

  return (
    <View style={{ marginHorizontal: 24, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <TouchableOpacity onPress={() => onMudarMes(somarMeses(mes, -1))} style={botao} accessibilityLabel="Mês anterior">
          <ChevronLeft size={13} color={C.text2} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
          {rotuloMesAno(mes)}
        </Text>
        <TouchableOpacity onPress={() => onMudarMes(somarMeses(mes, 1))} style={botao} accessibilityLabel="Próximo mês">
          <ChevronRight size={13} color={C.text2} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 8 }}>
        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {CABECALHO.map((d, i) => (
            <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3 }}>
              {d}
            </Text>
          ))}
        </View>
        {semanas.map((sem) => (
          <View key={sem[0].dia} style={{ flexDirection: 'row' }}>
            {sem.map((cel) => {
              const n = contagem?.get(cel.dia) ?? 0;
              const ehHoje = cel.dia === hoje;
              return (
                <TouchableOpacity
                  key={cel.dia}
                  onPress={() => onAbrirDia(cel.dia)}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 6, margin: 1, borderRadius: 10, minHeight: 48,
                    backgroundColor: cel.destacado ? C.primary : n > 0 && !cel.foraDoMes ? C.primarySoft : 'transparent',
                    borderWidth: ehHoje && !cel.destacado ? 1 : 0, borderColor: C.accent,
                  }}
                >
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13,
                    color: cel.destacado ? '#fff' : cel.foraDoMes ? C.text4 : C.text,
                  }}>
                    {cel.numero}
                  </Text>
                  {erro ? (
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: C.text4 }}>—</Text>
                  ) : n > 0 && !carregando ? (
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9,
                      color: cel.destacado ? 'rgba(255,255,255,0.8)' : cel.foraDoMes ? C.text4 : C.primary,
                    }}>
                      {n} {n === 1 ? 'atend.' : 'atends.'}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
      {erro && (
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: '#C0392B', marginTop: 8 }}>
          Não foi possível carregar a contagem do mês. Puxe para atualizar.
        </Text>
      )}
    </View>
  );
}
