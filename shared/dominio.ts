export type AgendamentoStatus = 'agendado' | 'confirmado' | 'concluido' | 'cancelado' | 'faltou';
export type PagamentoMetodo  = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
export type PagamentoStatus  = 'pendente' | 'pago' | 'estornado';
export type ComissaoStatus   = 'pendente' | 'pago';
export type DespesaStatus    = 'pendente' | 'pago';
export type ComandaStatus    = 'aberta' | 'fechada';
export type MovimentoTipo    = 'entrada' | 'saida' | 'ajuste';
export type PerfilRole       = 'gestor' | 'profissional' | 'cliente';

export const AGENDAMENTO_LABEL: Record<AgendamentoStatus, string> = {
  agendado:  'Agendado',
  confirmado: 'Confirmado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  faltou:    'Faltou',
};

export const AGENDAMENTO_COR: Record<AgendamentoStatus, string> = {
  agendado:  '#F59E0B',
  confirmado: '#6366F1',
  concluido: '#16A34A',
  cancelado: '#9CA3AF',
  faltou:    '#EF4444',
};

export const PAGAMENTO_METODO_LABEL: Record<PagamentoMetodo, string> = {
  dinheiro: 'Dinheiro',
  pix:      'Pix',
  credito:  'Crédito',
  debito:   'Débito',
  cortesia: 'Cortesia',
};

export const PAGAMENTO_STATUS_LABEL: Record<PagamentoStatus, string> = {
  pendente: 'Pendente',
  pago:     'Pago',
  estornado: 'Estornado',
};

export const COMISSAO_STATUS_LABEL: Record<ComissaoStatus, string> = {
  pendente: 'Pendente',
  pago:     'Pago',
};

export const DESPESA_STATUS_LABEL: Record<DespesaStatus, string> = {
  pendente: 'Pendente',
  pago:     'Pago',
};

export const MOVIMENTO_LABEL: Record<MovimentoTipo, string> = {
  entrada: 'Entrada',
  saida:   'Saída',
  ajuste:  'Ajuste',
};

export const PERIODICIDADE_LABEL: Record<string, string> = {
  mensal:  'Mensal',
  semanal: 'Semanal',
  anual:   'Anual',
};

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return raw;
}

export function formatCNPJ(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 14)
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  return raw;
}
