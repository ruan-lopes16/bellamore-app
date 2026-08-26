export type MetodoPagamentoTaxa = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';

export type TaxaReservaInsertPayload = {
  empresa_id: string;
  agendamento_id: string;
  cliente_id: string | null;
  valor: number;
  status: 'pendente' | 'pago';
  paga_em: string | null;
  metodo: MetodoPagamentoTaxa | null;
};

/**
 * Monta o payload de insert de taxas_reserva a partir de um valor e da
 * indicacao explicita, feita na hora do agendamento, de que a taxa ja foi
 * cobrada. Retorna null quando o valor e zero ou negativo (nenhuma linha
 * deve ser criada, mesma regra ja usada para a taxa de cancelamento).
 *
 * `metodo` so e gravado quando `jaCobrada` e verdadeiro — e mesmo assim e
 * opcional (o dado so existe "quando houver", conforme pedido), entao um
 * `metodo` informado com `jaCobrada: false` e descartado em vez de gerar
 * uma taxa 'pendente' com forma de pagamento, que nao faz sentido.
 */
export function buildTaxaReservaInsert(
  params: {
    empresaId: string;
    agendamentoId: string;
    clienteId: string | null;
    valor: number;
    jaCobrada: boolean;
    metodo?: MetodoPagamentoTaxa | null;
  },
  agoraIso: string,
): TaxaReservaInsertPayload | null {
  if (params.valor <= 0) return null;
  return {
    empresa_id: params.empresaId,
    agendamento_id: params.agendamentoId,
    cliente_id: params.clienteId,
    valor: params.valor,
    status: params.jaCobrada ? 'pago' : 'pendente',
    paga_em: params.jaCobrada ? agoraIso : null,
    metodo: params.jaCobrada ? (params.metodo ?? null) : null,
  };
}

/**
 * Soma o valor das taxas de reserva pagas cujo agendamento_id esta entre os
 * agendamentos presentes numa comanda.
 */
export function somarTaxasReservaPagas(
  agendamentoIds: string[],
  taxasPagas: { agendamento_id: string; valor: number }[],
): number {
  const idsNaComanda = new Set(agendamentoIds);
  return taxasPagas
    .filter(t => idsNaComanda.has(t.agendamento_id))
    .reduce((soma, t) => soma + t.valor, 0);
}

/**
 * Aplica o desconto de taxa de reserva ja paga sobre o total da comanda,
 * depois do desconto manual. Limitado ao que sobra do subtotal (nunca deixa
 * o total negativo, mesma regra ja usada pelo desconto manual).
 */
export function aplicarDescontoReserva(
  subtotal: number,
  descontoManual: number,
  descontoReserva: number,
): { total: number; descontoReservaAplicado: number } {
  const descontoReservaAplicado = Math.min(
    descontoReserva,
    Math.max(subtotal - descontoManual, 0),
  );
  const total = Math.max(subtotal - descontoManual - descontoReservaAplicado, 0);
  return { total, descontoReservaAplicado };
}
