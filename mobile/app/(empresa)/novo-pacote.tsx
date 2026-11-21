import { PacoteForm } from '@/components/pacotes/PacoteForm';
import { comTemaDoUsuario } from '@/lib/tema';

/** Novo pacote: o mesmo cadastro do web (tipo, serviços com ∞, preço, validade livre ou sem validade). */
function NovoPacote() {
  return <PacoteForm />;
}

export default comTemaDoUsuario(NovoPacote);
