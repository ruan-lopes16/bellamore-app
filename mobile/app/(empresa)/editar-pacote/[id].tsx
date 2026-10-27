import { useLocalSearchParams } from 'expo-router';
import { PacoteForm } from '@/components/pacotes/PacoteForm';

/**
 * Editar pacote. Pacote já vendido (ou contagem de vendas com erro) trava tipo, serviços e
 * quantidades; nome, preço e validade seguem livres. Sem validade continua sem validade.
 */
export default function EditarPacote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PacoteForm pacoteId={id} />;
}
