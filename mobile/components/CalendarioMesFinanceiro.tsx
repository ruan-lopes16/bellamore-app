/**
 * @file CalendarioMesFinanceiro.tsx
 * Seletor de mês do Financeiro com o calendário do mês — equivalente RN do
 * FinanceMonthCalendar do web, com a MESMA grade (6 semanas, domingo primeiro),
 * rótulos e destaque (@shared/periodos). Só visual: a tela filtra o mês inteiro.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react-native';
import {
  chaveDoMesExibido, chaveDiaExibido, gradeCalendarioMes, rotuloIntervaloMes, rotuloMesAno, rotuloDiaExtenso,
  DIAS_SEMANA_ABREV,
} from '@shared/periodos';

const C = {
  surface: '#FFFFFF', border: '#E8E2DC', bg: '#F4F1EE', primary: '#2C1654',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

export type CalendarioMesFinanceiroProps = {
  mes: Date;
  aberto: boolean;
  proximoDesabilitado: boolean;
  onAlternar: () => void;
  onMesAnterior: () => void;
  onProximoMes: () => void;
};

const botaoSeta = {
  width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border,
  alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: C.bg,
};

export function CalendarioMesFinanceiro({
  mes, aberto, proximoDesabilitado, onAlternar, onMesAnterior, onProximoMes,
}: CalendarioMesFinanceiroProps) {
  const chave = chaveDoMesExibido(mes);
  const titulo = rotuloMesAno(chave);
  const grade = gradeCalendarioMes(chave, chaveDiaExibido(mes));

  return (
    <View style={{ marginHorizontal: 24, marginBottom: 16 }}>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14,
        padding: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}>
        <TouchableOpacity onPress={onMesAnterior} accessibilityLabel="Mês anterior" style={botaoSeta}>
          <ChevronLeft size={14} color={C.text2} strokeWidth={2.5} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onAlternar}
          accessibilityLabel={`${aberto ? 'Fechar' : 'Abrir'} calendário de ${titulo}`}
          accessibilityState={{ expanded: aberto }}
          style={{ alignItems: 'center', minWidth: 160 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{titulo}</Text>
            <View style={{ transform: [{ rotate: aberto ? '180deg' : '0deg' }] }}>
              <ChevronDown size={13} color={C.text4} />
            </View>
          </View>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
            {rotuloIntervaloMes(chave)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onProximoMes} disabled={proximoDesabilitado} accessibilityLabel="Próximo mês"
          style={[botaoSeta, { opacity: proximoDesabilitado ? 0.3 : 1 }]}
        >
          <ChevronRight size={14} color={C.text2} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {aberto && (
        <View style={{ marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12 }}>
          <View style={{ flexDirection: 'row' }}>
            {DIAS_SEMANA_ABREV.map(d => (
              <Text key={d} style={{ width: `${100 / 7}%`, textAlign: 'center', fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text4, paddingVertical: 6 }}>
                {d}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {grade.map(c => (
              <View key={c.dia} accessibilityLabel={rotuloDiaExtenso(c.dia)} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                <View style={{ flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.destacado ? C.primary : 'transparent' }}>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13,
                    color: c.destacado ? '#fff' : c.foraDoMes ? C.text4 : C.text2,
                    opacity: c.foraDoMes && !c.destacado ? 0.6 : 1,
                  }}>
                    {c.numero}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
