export type AgendamentoStatus = 'agendado' | 'confirmado' | 'concluido' | 'cancelado' | 'faltou';
export type PagamentoMetodo  = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
export type PagamentoStatus  = 'pendente' | 'pago' | 'estornado';
export type ComissaoStatus   = 'pendente' | 'pago';
export type DespesaStatus    = 'pendente' | 'pago';
export type ComandaStatus    = 'aberta' | 'fechada';
export type MovimentoTipo    = 'entrada' | 'saida' | 'ajuste';
export type PerfilRole       = 'gestor' | 'profissional';

export const AGENDAMENTO_LABEL: Record<AgendamentoStatus, string> = {
  agendado:  'Agendado',
  confirmado: 'Confirmado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  faltou:    'Faltou',
};

export const PAGAMENTO_METODO_LABEL: Record<PagamentoMetodo, string> = {
  dinheiro: 'Dinheiro',
  pix:      'Pix',
  credito:  'Crédito',
  debito:   'Débito',
  cortesia: 'Cortesia',
};

/** Duração de serviço legível: 45 -> '45 min', 60 -> '1h', 90 -> '1h30'. */
export function formatarDuracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}` : `${h}h`;
}
