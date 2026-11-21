import { useLocalSearchParams } from 'expo-router';
import { ServicoForm } from '@/components/servicos/ServicoForm';
import { comTemaDoUsuario } from '@/lib/tema';

/** Editar serviço: mesmo cadastro do novo, com insumos, Desativar e Excluir. */
function EditarServico() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <ServicoForm servicoId={id} />;
}

export default comTemaDoUsuario(EditarServico);
