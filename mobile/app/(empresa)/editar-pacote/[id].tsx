import { useLocalSearchParams } from 'expo-router';
import { PacoteForm } from '@/components/pacotes/PacoteForm';
import { comTemaDoUsuario } from '@/lib/tema';

/**
 * Editar pacote. Pacote já vendido (ou contagem de vendas com erro) trava tipo, serviços e
 * quantidades; nome, preço e validade seguem livres. Sem validade continua sem validade.
 */
function EditarPacote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PacoteForm pacoteId={id} />;
}

export default comTemaDoUsuario(EditarPacote);
