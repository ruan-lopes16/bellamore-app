import { useLocalSearchParams } from 'expo-router';
import { ServicoForm } from '@/components/servicos/ServicoForm';

/**
 * Novo serviço. `?categoria=` (fixa) ou `?categoriaId=` (personalizada) vêm do "+" de um grupo
 * da tela de Serviços e já deixam a categoria escolhida, igual ao web.
 */
export default function NovoServico() {
  const { categoria, categoriaId } = useLocalSearchParams<{ categoria?: string; categoriaId?: string }>();
  return <ServicoForm categoriaInicial={categoria || null} categoriaIdInicial={categoriaId || null} />;
}
