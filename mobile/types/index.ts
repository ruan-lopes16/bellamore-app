// ============================================================
// TIPOS BASE — App Estética
// ============================================================

export type PerfilRole = 'gestor' | 'profissional' | 'cliente';

export type AgendamentoStatus =
  | 'agendado'
  | 'confirmado'
  | 'concluido'
  | 'cancelado'
  | 'faltou';

export type PagamentoMetodo = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
export type PagamentoStatus = 'pendente' | 'pago' | 'estornado';
export type ComissaoStatus  = 'pendente' | 'pago';
export type DespesaStatus   = 'pendente' | 'pago';
export type ComandaStatus   = 'aberta' | 'fechada';
export type MovimentoTipo   = 'entrada' | 'saida' | 'ajuste';

// ============================================================

export interface User {
  id: string;
  nome: string;
  telefone?: string;
  email?: string;
  data_nascimento?: string;
  endereco?: string;
  foto_url?: string;
  created_at: string;
}

export interface Empresa {
  id: string;
  owner_id: string;
  nome: string;
  cnpj?: string;
  endereco?: string;
  telefone?: string;
  logo_url?: string;
  horario_funcionamento?: Record<string, { inicio: string; fim: string }>;
  ativo: boolean;
  created_at: string;
}

export interface EmpresaMembro {
  id: string;
  empresa_id: string;
  user_id: string;
  role: PerfilRole;
  percentual_comissao: number;
  ativo: boolean;
  created_at: string;
  // joins opcionais
  user?: User;
  empresa?: Empresa;
}

export interface Servico {
  id: string;
  empresa_id: string;
  nome: string;
  descricao?: string;
  preco: number;
  custo: number;
  duracao_minutos: number;
  categoria?: string;
  ativo: boolean;
}

export interface Pacote {
  id: string;
  empresa_id: string;
  nome: string;
  preco: number;
  validade_dias: number;
  ativo: boolean;
  servicos?: Servico[];
}

export interface Agendamento {
  id: string;
  empresa_id: string;
  profissional_id: string;
  cliente_id: string;
  servico_id: string;
  comanda_id?: string;
  data_hora_inicio: string;
  data_hora_fim: string;
  status: AgendamentoStatus;
  valor: number;
  observacao?: string;
  created_at: string;
  // joins opcionais
  profissional?: User;
  cliente?: User;
  servico?: Servico;
}

export interface Comanda {
  id: string;
  empresa_id: string;
  cliente_id: string;
  profissional_id?: string;
  status: ComandaStatus;
  valor_total: number;
  desconto: number;
  valor_final: number;
  observacao?: string;
  fechada_at?: string;
  created_at: string;
  agendamentos?: Agendamento[];
}

export interface Pagamento {
  id: string;
  empresa_id: string;
  comanda_id?: string;
  agendamento_id?: string;
  cliente_id?: string;
  valor: number;
  metodo: PagamentoMetodo;
  status: PagamentoStatus;
  created_at: string;
}

export interface Comissao {
  id: string;
  empresa_id: string;
  profissional_id: string;
  agendamento_id: string;
  valor_servico: number;
  percentual: number;
  valor_comissao: number;
  status: ComissaoStatus;
  created_at: string;
  agendamento?: Agendamento;
}

export interface Produto {
  id: string;
  empresa_id: string;
  nome: string;
  categoria?: string;
  unidade: string;
  preco_custo: number;
  preco_venda: number;
  estoque_atual: number;
  estoque_minimo: number;
  ativo: boolean;
}

export interface EstoqueMovimento {
  id: string;
  produto_id: string;
  empresa_id: string;
  tipo: MovimentoTipo;
  quantidade: number;
  motivo?: string;
  agendamento_id?: string;
  created_at: string;
}

export interface Despesa {
  id: string;
  empresa_id: string;
  descricao: string;
  categoria?: string;
  valor: number;
  recorrente: boolean;
  periodicidade?: 'mensal' | 'semanal' | 'anual';
  data_vencimento?: string;
  data_pagamento?: string;
  status: DespesaStatus;
  created_at: string;
}

export interface AnamneseFicha {
  id: string;
  empresa_id: string;
  cliente_id: string;
  profissional_id?: string;
  respostas: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface Notificacao {
  id: string;
  user_id: string;
  empresa_id?: string;
  tipo: 'agendamento' | 'comissao' | 'pagamento' | 'estoque_baixo' | 'cliente_sumido';
  titulo: string;
  mensagem?: string;
  lida: boolean;
  created_at: string;
}

// ============================================================
// AUTH STORE TYPES
// ============================================================

export interface AuthState {
  user: User | null;
  // empresa ativa selecionada (profissional pode ter mais de uma)
  empresaAtiva: Empresa | null;
  // papel do usuário na empresa ativa
  roleAtivo: PerfilRole | null;
  // é owner da empresa ativa?
  isOwner: boolean;
}
