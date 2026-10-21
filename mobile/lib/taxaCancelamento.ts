import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import {
  carregarConfigTaxas, colunaCobrarTaxaExiste, perguntaTaxaCancelamento,
} from '@shared/taxas-atendimento';
import { formatarMoeda } from '@shared/moeda';

export type EscolhaCobrancaCancelamento = {
  /** false = a pessoa voltou (ou a configuração não pôde ser lida): não mude o status. */
  continuar: boolean;
  /** Campos a juntar ao UPDATE de status (vazio antes da migration 091). */
  extra: { cobrar_taxa_cancelamento?: boolean };
  /** true = a pergunta da taxa foi mostrada (a tela não pergunta de novo antes de mudar o status). */
  perguntou: boolean;
};

/**
 * Antes de mudar o status de um atendimento: se o novo status é cancelado/faltou, decide o
 * campo `cobrar_taxa_cancelamento` do UPDATE. Com a 091, SEMPRE devolve o campo explícito
 * (o que a pessoa escolheu, ou `true` quando não há o que perguntar). Sem a 091, nada muda.
 * Pergunta "Cobrar taxa de cancelamento de R$ X?" só quando a configuração da empresa cobraria.
 */
export async function escolherCobrancaCancelamento(args: {
  empresaId: string | undefined;
  novoStatus: string;
  clienteId: string | null | undefined;
  valorAtendimento: number;
}): Promise<EscolhaCobrancaCancelamento> {
  const { empresaId, novoStatus, clienteId, valorAtendimento } = args;
  if (novoStatus !== 'cancelado' && novoStatus !== 'faltou') return { continuar: true, extra: {}, perguntou: false };
  if (!empresaId || !(await colunaCobrarTaxaExiste(supabase))) return { continuar: true, extra: {}, perguntou: false };

  let cfg;
  try {
    cfg = await carregarConfigTaxas(supabase, empresaId);
  } catch {
    Alert.alert('Erro', 'Não foi possível ler a configuração da taxa de cancelamento. Tente novamente.');
    return { continuar: false, extra: {}, perguntou: false };
  }

  const { perguntar, valor } = perguntaTaxaCancelamento(
    cfg.cancelamento, novoStatus, clienteId ?? null, Number(valorAtendimento) || 0,
  );
  if (!perguntar) return { continuar: true, extra: { cobrar_taxa_cancelamento: true }, perguntou: false };

  return new Promise(resolve => {
    Alert.alert(
      'Taxa de cancelamento',
      `Cobrar taxa de cancelamento de ${formatarMoeda(valor)}?`,
      [
        { text: 'Cobrar', onPress: () => resolve({ continuar: true, extra: { cobrar_taxa_cancelamento: true }, perguntou: true }) },
        { text: 'Não cobrar', onPress: () => resolve({ continuar: true, extra: { cobrar_taxa_cancelamento: false }, perguntou: true }) },
        { text: 'Voltar', style: 'cancel', onPress: () => resolve({ continuar: false, extra: {}, perguntou: true }) },
      ],
      { cancelable: true, onDismiss: () => resolve({ continuar: false, extra: {}, perguntou: true }) },
    );
  });
}
