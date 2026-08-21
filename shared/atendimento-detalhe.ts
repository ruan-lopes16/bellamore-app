// ── Tipos de entrada (linhas cruas vindas do Supabase) ────────

export type ServicoDoAgendamento = {
  ordem: number;
  servico: { nome: string } | null;
};

export type AgendamentoComServicos = {
  /** Servico legado (agendamentos.servico_id) — usado como fallback. */
  servico?: { nome: string } | null;
  agendamento_servicos?: ServicoDoAgendamento[] | null;
};

/**
 * Nome legivel dos servicos de um agendamento: junta as linhas de
 * agendamento_servicos por `ordem` com " + ".
 *
 * Existe porque a Agenda grava so o PRIMEIRO servico em agendamentos.servico_id
 * e a SOMA de todos em agendamentos.valor. Ler apenas o servico legado exibe o
 * nome de um servico ao lado do preco de varios.
 *
 * Cai no servico legado quando nao ha linhas em agendamento_servicos — o caso
 * da maioria dos agendamentos anteriores a migration 020. Retorna null quando
 * nao ha nome nenhum, para a tela decidir o placeholder.
 */
export function descreverServicos(ag: AgendamentoComServicos): string | null {
  const nomes = listarServicos(ag);
  return nomes.length > 0 ? nomes.join(' + ') : null;
}

/**
 * Nomes dos servicos de um agendamento, em ordem, ja aplicando o fallback para
 * o servico legado. Existe separada de `descreverServicos` porque quem agrega
 * (ex.: contagem de servico favorito) precisa dos nomes um a um, e nao do texto
 * pronto — sem isso a regra de "preferir agendamento_servicos, cair no legado"
 * ficaria escrita em dois lugares, livre para divergir.
 */
export function listarServicos(ag: AgendamentoComServicos): string[] {
  const nomes = (ag.agendamento_servicos ?? [])
    .slice()                                   // nao mutar o array do chamador
    .sort((a, b) => a.ordem - b.ordem)
    .map((linha) => linha.servico?.nome)
    .filter((nome): nome is string => !!nome);

  if (nomes.length > 0) return nomes;
  return ag.servico?.nome ? [ag.servico.nome] : [];
}

export type ItemComandaCru = {
  id: string;
  tipo: 'servico' | 'produto' | 'pacote';
  descricao: string;
  quantidade: number;
  valor_unit: number;
  profissional?: { nome: string } | null;
};

export type PagamentoCru = {
  id: string; metodo: string; valor: number;
  bandeira?: string | null; parcelas?: number | null;
  taxa_perc?: number | null; valor_liquido?: number | null;
};

export type ComandaCru = {
  id: string; valor_total: number; desconto: number; desconto_reserva: number;
  fechada_at: string | null; observacao?: string | null;
};

export type AgendamentoNaComanda = AgendamentoComServicos & {
  id: string; data_hora_inicio: string; valor: number;
  profissional?: { nome: string } | null;
};

export type EntradaDetalhe = {
  /** Agendamento aberto pelo usuario. null quando a linha e um extra de comanda. */
  agendamentoId: string | null;
  /** comanda_id gravado na linha. null = atendimento ainda nao fechado. */
  comandaIdEsperado: string | null;
  comanda: ComandaCru | null;
  itens: ItemComandaCru[];
  pagamentos: PagamentoCru[];
  agendamentosDaComanda: AgendamentoNaComanda[];
};

export type LinhaItem = {
  id: string;
  origem: 'agendamento' | 'comanda_item';
  tipo: 'servico' | 'produto' | 'pacote';
  descricao: string;
  quantidade: number;
  valorUnit: number;
  valorLinha: number;
  profissional: string | null;
  /** true na linha do agendamento que o usuario abriu */
  esteAtendimento: boolean;
};

export type LinhaPagamento = {
  id: string; metodo: string; valor: number;
  bandeira: string | null; parcelas: number;
  taxaPerc: number | null; valorLiquido: number | null;
};

export type OutroAtendimento = { id: string; dataHoraInicio: string; servicos: string | null };

export type SituacaoDetalhe = 'completo' | 'sem_comanda' | 'bloqueado_por_rls';

export type DetalheAtendimento = {
  situacao: SituacaoDetalhe;
  itens: LinhaItem[];
  pagamentos: LinhaPagamento[];
  subtotal: number;
  descontoManual: number;
  descontoReserva: number;
  total: number;
  outrosAtendimentos: OutroAtendimento[];
};

/**
 * Detalhe sem nenhum dado financeiro. E uma funcao, e nao uma constante, para
 * cada chamada receber arrays proprios — devolver a mesma instancia deixaria
 * chamadas diferentes compartilhando estado mutavel.
 */
function detalheVazio(situacao: SituacaoDetalhe): DetalheAtendimento {
  return {
    situacao,
    itens: [],
    pagamentos: [],
    subtotal: 0,
    descontoManual: 0,
    descontoReserva: 0,
    total: 0,
    outrosAtendimentos: [],
  };
}

/**
 * Monta o modelo de exibicao do detalhe de um atendimento a partir das linhas
 * cruas ja consultadas.
 *
 * Tres pontos que uma leitura ingenua do schema erraria:
 *
 * 1. comanda_itens guarda SO os extras (produtos, servicos avulsos, pacotes).
 *    As linhas dos agendamentos ficam na tabela agendamentos, ligadas por
 *    comanda_id. Por isso `itens` une as duas fontes.
 * 2. comandas.desconto JA INCLUI o desconto_reserva (migration 057). O desconto
 *    manual e a diferenca entre os dois; somar de novo contaria duas vezes.
 * 3. Comanda ausente nao e sempre erro: se o atendimento nunca foi fechado,
 *    `comandaIdEsperado` e null e nao ha nada a mostrar. Se ha id esperado mas
 *    a linha nao veio, o RLS da migration 045 filtrou (profissional abrindo o
 *    atendimento de uma colega) — e a tela precisa dizer isso, nao ficar vazia.
 */
export function montarDetalheAtendimento(entrada: EntradaDetalhe): DetalheAtendimento {
  const { agendamentoId, comandaIdEsperado, comanda } = entrada;

  if (!comanda) {
    return detalheVazio(comandaIdEsperado ? 'bloqueado_por_rls' : 'sem_comanda');
  }

  const linhasAgendamento: LinhaItem[] = entrada.agendamentosDaComanda.map((ag) => ({
    id: ag.id,
    origem: 'agendamento',
    tipo: 'servico',
    descricao: descreverServicos(ag) ?? 'Servico',
    quantidade: 1,
    valorUnit: ag.valor,
    valorLinha: ag.valor,
    profissional: ag.profissional?.nome ?? null,
    esteAtendimento: ag.id === agendamentoId,
  }));

  const linhasExtras: LinhaItem[] = entrada.itens.map((item) => ({
    id: item.id,
    origem: 'comanda_item',
    tipo: item.tipo,
    descricao: item.descricao,
    quantidade: item.quantidade,
    valorUnit: item.valor_unit,
    valorLinha: item.quantidade * item.valor_unit,
    profissional: item.profissional?.nome ?? null,
    esteAtendimento: false,
  }));

  const pagamentos: LinhaPagamento[] = entrada.pagamentos.map((p) => ({
    id: p.id,
    metodo: p.metodo,
    valor: p.valor,
    bandeira: p.bandeira ?? null,
    parcelas: p.parcelas ?? 1,
    taxaPerc: p.taxa_perc ?? null,
    valorLiquido: p.valor_liquido ?? null,
  }));

  const outrosAtendimentos: OutroAtendimento[] = entrada.agendamentosDaComanda
    .filter((ag) => ag.id !== agendamentoId)
    .map((ag) => ({
      id: ag.id,
      dataHoraInicio: ag.data_hora_inicio,
      servicos: descreverServicos(ag),
    }));

  const descontoReserva = comanda.desconto_reserva ?? 0;

  return {
    situacao: 'completo',
    itens: [...linhasAgendamento, ...linhasExtras],
    pagamentos,
    subtotal: comanda.valor_total,
    descontoManual: comanda.desconto - descontoReserva,
    descontoReserva,
    total: comanda.valor_total - comanda.desconto,
    outrosAtendimentos,
  };
}
