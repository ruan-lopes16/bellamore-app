/**
 * Helpers puros do dashboard pessoal da profissional — sem I/O, sem
 * dependência de Supabase. As telas (web e mobile) buscam os dados e
 * chamam essas funções pra classificar/calcular.
 */

export type VisitaClienteProfissional = {
  clienteId: string;
  nome: string;
  /** ISO 8601 — data do último atendimento concluído dela com esse cliente. */
  ultimaVisita: string;
  /** Total de atendimentos concluídos dela com esse cliente (não da empresa). */
  totalVisitas: number;
};

export type ClienteReconquista = VisitaClienteProfissional & {
  diasSemVisita: number;
};

export type ReconquistaClassificacao = {
  /** Já voltou mais de uma vez, mas está há 45+ dias sem retornar. */
  emRisco: ClienteReconquista[];
  /** Veio 1 vez só e não voltou em 30+ dias — provavelmente não vai voltar sem contato. */
  naoRetornou: ClienteReconquista[];
};

const DIAS_EM_RISCO = 45;
const DIAS_NAO_RETORNOU = 30;

/**
 * Classifica os clientes que a profissional já atendeu em duas listas de
 * reconquista, mutuamente exclusivas — um cliente de 1 visita só nunca cai
 * em "em risco" mesmo que a visita tenha sido há mais de 45 dias, porque
 * "não retornou" já é o balde mais específico pra esse caso.
 */
export function classificarClientesReconquista(
  visitas: VisitaClienteProfissional[],
  agora: Date = new Date(),
): ReconquistaClassificacao {
  const emRisco: ClienteReconquista[] = [];
  const naoRetornou: ClienteReconquista[] = [];

  for (const v of visitas) {
    const diasSemVisita = Math.floor(
      (agora.getTime() - new Date(v.ultimaVisita).getTime()) / 86_400_000,
    );
    const item: ClienteReconquista = { ...v, diasSemVisita };

    if (v.totalVisitas === 1 && diasSemVisita >= DIAS_NAO_RETORNOU) {
      naoRetornou.push(item);
    } else if (v.totalVisitas >= 2 && diasSemVisita >= DIAS_EM_RISCO) {
      emRisco.push(item);
    }
  }

  emRisco.sort((a, b) => b.diasSemVisita - a.diasSemVisita);
  naoRetornou.sort((a, b) => b.diasSemVisita - a.diasSemVisita);
  return { emRisco, naoRetornou };
}

/**
 * Progresso do faturamento bruto do mês contra a meta pessoal da
 * profissional. Sem meta definida (null ou <= 0), temMeta vem false e a
 * tela decide não desenhar a barra.
 */
export function progressoMetaPessoal(
  faturamentoBrutoMes: number,
  metaMensalPessoal: number | null,
): { temMeta: boolean; percentual: number; restante: number } {
  if (!metaMensalPessoal || metaMensalPessoal <= 0) {
    return { temMeta: false, percentual: 0, restante: 0 };
  }
  const percentual = Math.min(100, Math.round((faturamentoBrutoMes / metaMensalPessoal) * 100));
  const restante = Math.max(0, metaMensalPessoal - faturamentoBrutoMes);
  return { temMeta: true, percentual, restante };
}
