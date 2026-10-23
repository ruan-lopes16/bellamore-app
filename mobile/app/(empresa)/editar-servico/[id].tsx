import { useLocalSearchParams } from 'expo-router';
import { ServicoForm } from '@/components/servicos/ServicoForm';

/** Editar serviço: mesmo cadastro do novo, com insumos, Desativar e Excluir. */
export default function EditarServico() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <ServicoForm servicoId={id} />;
}
