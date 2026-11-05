/**
 * Bloco fino que marca, na grade da agenda, uma hora em que um atendimento que começou antes
 * ainda está em andamento ("↳ Maria · até 11:00"). Borda tracejada na cor do status; toque abre
 * o mesmo destino do cartão do atendimento. Não ocupa o lugar de nenhum atendimento que
 * começa nessa hora: a grade o desenha junto com os cartões, e some o "horário vazio".
 */
import { Text, TouchableOpacity } from 'react-native';
import { horaBRT } from '@shared/periodos';
import { useTema } from '@/lib/tema';

export function ContinuacaoAtendimento({ nome, fim, cor, onPress }: {
  /** Nome da cliente (ou "Atendimento" quando não houver). */
  nome: string | null | undefined;
  /** Fim do atendimento (ISO); mostrado em Brasília. */
  fim: string;
  /** Cor do status do atendimento (borda e texto). */
  cor: string;
  onPress: () => void;
}) {
  const { C } = useTema();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        borderWidth: 1, borderStyle: 'dashed', borderColor: cor, borderRadius: 10,
        paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6, backgroundColor: C.surface,
      }}
    >
      <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: cor }}>
        ↳ {nome ?? 'Atendimento'} · até {horaBRT(fim)}
      </Text>
    </TouchableOpacity>
  );
}
