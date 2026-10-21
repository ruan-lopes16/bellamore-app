import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MotiView } from 'moti';
import { Check, X, AlertTriangle, RotateCcw, Calendar } from 'lucide-react-native';
import { statusPermitidos, MSG_CONCLUIDO_COM_COMANDA, type StatusAg } from '@shared/agenda';

const C = {
  primary: '#2C1654', primarySoft: '#EEE8F8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#C0392B', redSoft: '#FEF2F2',
  border: '#E8E2DC', surface: '#FFFFFF',
  text3: '#8878A6',
};

/** Aparência de cada destino. O rótulo de "agendado"/"confirmado" muda quando é reabertura. */
function aparencia(novo: StatusAg, atual: StatusAg) {
  const reabrindo = atual === 'cancelado' || atual === 'faltou' || atual === 'concluido';
  switch (novo) {
    case 'agendado':
      return { label: reabrindo ? 'Voltar para agendado' : 'Marcar como agendado', cor: C.primary, fundo: C.primarySoft, borda: 'rgba(44,22,84,0.15)', icone: (c: string) => <RotateCcw size={16} color={c} strokeWidth={2.5} /> };
    case 'confirmado':
      return { label: reabrindo ? 'Reabrir como confirmado' : 'Confirmar agendamento', cor: C.green, fundo: C.greenSoft, borda: 'rgba(13,126,95,0.2)', icone: (c: string) => <Check size={16} color={c} strokeWidth={2.5} /> };
    case 'concluido':
      return { label: 'Marcar como concluído', cor: C.primary, fundo: C.primarySoft, borda: 'rgba(44,22,84,0.15)', icone: (c: string) => <Calendar size={16} color={c} strokeWidth={2.5} /> };
    case 'faltou':
      return { label: 'Cliente faltou', cor: C.amber, fundo: C.amberSoft, borda: 'rgba(180,83,9,0.15)', icone: (c: string) => <AlertTriangle size={16} color={c} strokeWidth={2} /> };
    case 'cancelado':
      return { label: 'Cancelar agendamento', cor: C.red, fundo: C.redSoft, borda: 'rgba(192,57,43,0.15)', icone: (c: string) => <X size={16} color={c} strokeWidth={2.5} /> };
  }
}

/**
 * Botões de troca de status do detalhe do atendimento (app), pela regra única
 * `statusPermitidos` de `shared/agenda` — a mesma do web. Concluído com comanda fechada não tem
 * botões: mostra `MSG_CONCLUIDO_COM_COMANDA` (muda-se pela comanda). As confirmações ficam com a
 * tela, em `onEscolher`.
 */
export function BotoesStatus({ status, comandaFechada, atualizando, onEscolher }: {
  status: StatusAg;
  comandaFechada: boolean;
  atualizando: boolean;
  onEscolher: (novo: StatusAg) => void;
}) {
  const destinos = statusPermitidos(status, comandaFechada);

  return (
    <MotiView
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 350, delay: 120 }}
      style={{ marginHorizontal: 24, marginTop: 16, marginBottom: 14 }}
    >
      <Text style={{
        fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11,
        color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
      }}>
        Atualizar status
      </Text>

      {destinos.length === 0 ? (
        <View style={{
          backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
          borderRadius: 14, padding: 14,
        }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text3 }}>
            {status === 'concluido' && comandaFechada ? MSG_CONCLUIDO_COM_COMANDA : 'Nenhuma mudança de status disponível.'}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {destinos.map((novo) => {
            const a = aparencia(novo, status);
            return (
              <TouchableOpacity
                key={novo}
                onPress={() => onEscolher(novo)}
                disabled={atualizando}
                style={{
                  backgroundColor: a.fundo, borderWidth: 1, borderColor: a.borda,
                  borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
                  opacity: atualizando ? 0.6 : 1,
                }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                  {a.icone(a.cor)}
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: a.cor, flex: 1 }}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {atualizando && <ActivityIndicator color={C.primary} size="small" style={{ marginTop: 4 }} />}
        </View>
      )}
    </MotiView>
  );
}
