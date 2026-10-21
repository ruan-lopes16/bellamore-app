import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { salvarAvaliacao } from '@shared/agenda-consultas';
import { mensagemErroBanco } from '@shared/erros';

const C = {
  primary: '#2C1654', primarySoft: '#EEE8F8',
  amber: '#F59E0B', star: '#D8D0E4',
  green: '#0D7E5F', red: '#C0392B',
  border: '#E8E2DC', surface: '#FFFFFF', bg: '#F4F1EE',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

type AvaliacaoExistente = { nota: number; comentario: string | null } | null;

/**
 * Avaliação do atendimento concluído (app): 1 a 5 estrelas e comentário opcional, uma por
 * atendimento e editável. Carrega a existente por `agendamento_id` e grava com `salvarAvaliacao`
 * (shared), que nunca manda a profissional — o trigger da 094 preenche. A tela só renderiza
 * este bloco em concluído e para quem pode mexer no atendimento.
 */
export function AvaliacaoAtendimento({ empresaId, agendamentoId, clienteId }: {
  empresaId: string; agendamentoId: string; clienteId: string;
}) {
  const qc = useQueryClient();
  const { data: existente, isLoading, error: erroCarga } = useQuery({
    queryKey: ['avaliacao-atendimento', agendamentoId],
    staleTime: 1000 * 30,
    queryFn: async (): Promise<AvaliacaoExistente> => {
      const { data, error } = await supabase
        .from('avaliacoes')
        .select('nota, comentario')
        .eq('agendamento_id', agendamentoId)
        .maybeSingle();
      if (error) throw new Error(mensagemErroBanco(error, 'carregar a avaliação'));
      return (data as AvaliacaoExistente) ?? null;
    },
  });

  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // Preenche com a avaliação já gravada quando ela chega (ou muda de atendimento).
  useEffect(() => {
    setNota(existente?.nota ?? 0);
    setComentario(existente?.comentario ?? '');
  }, [existente, agendamentoId]);
  useEffect(() => { setMsg(null); }, [agendamentoId]);

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      await salvarAvaliacao(supabase as unknown as Parameters<typeof salvarAvaliacao>[0], {
        empresaId, agendamentoId, clienteId, nota, comentario,
      });
      setMsg({ tipo: 'ok', texto: 'Avaliação salva.' });
      qc.invalidateQueries({ queryKey: ['avaliacao-atendimento', agendamentoId] });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message || 'Não foi possível salvar a avaliação.' });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <View style={{ marginHorizontal: 24, marginTop: 16, marginBottom: 14 }}>
      <Text style={{
        fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11,
        color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
      }}>
        Avaliação do atendimento
      </Text>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 16, padding: 16, gap: 12,
      }}>
        {isLoading ? (
          <ActivityIndicator color={C.primary} />
        ) : erroCarga ? (
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red }}>
            {(erroCarga as Error).message}
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setNota(n)}
                  disabled={salvando}
                  accessibilityLabel={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
                  hitSlop={6}
                >
                  <Star
                    size={30}
                    color={n <= nota ? C.amber : C.star}
                    fill={n <= nota ? C.amber : 'transparent'}
                    strokeWidth={1.8}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              value={comentario}
              onChangeText={setComentario}
              placeholder="Comentário (opcional)"
              placeholderTextColor={C.text4}
              multiline
              editable={!salvando}
              style={{
                minHeight: 72, textAlignVertical: 'top',
                backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 12,
                padding: 12, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text,
              }}
            />

            {msg && (
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: msg.tipo === 'ok' ? C.green : C.red }}>
                {msg.texto}
              </Text>
            )}

            <TouchableOpacity
              onPress={salvar}
              disabled={salvando || nota < 1}
              style={{
                backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center',
                opacity: salvando || nota < 1 ? 0.5 : 1,
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>
                {salvando ? 'Salvando...' : existente ? 'Atualizar avaliação' : 'Salvar avaliação'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}
