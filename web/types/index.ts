export type PerfilRole = 'gestor' | 'profissional' | 'cliente';

export type AgendamentoStatus = 'agendado' | 'confirmado' | 'concluido' | 'cancelado' | 'faltou';
export type PagamentoMetodo   = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
export type PagamentoStatus   = 'pendente' | 'pago' | 'estornado';
export type ComissaoStatus    = 'pendente' | 'pago';
export type DespesaStatus     = 'pendente' | 'pago';
export type ComandaStatus     = 'aberta' | 'fechada';
export type MovimentoTipo     = 'entrada' | 'saida' | 'ajuste';

export interface User {
  id: string;
  nome: string;
  telefone?: string;
  email?: string;
  data_nascimento?: string;
  endereco?: string;
  foto_url?: string;
  push_token?: string;
  created_at: string;
}

export interface Empresa {
  id: string;
  owner_id: string;
  nome: string;
  segmento?: string;
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
  validade_dias: number | null;
  ativo: boolean;
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
  qtd_por_unidade?: number;
  tipo?: 'material' | 'venda';
  ativo: boolean;
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

export interface AuthState {
  user: User | null;
  empresaAtiva: Empresa | null;
  roleAtivo: PerfilRole | null;
  isOwner: boolean;
  empresasDisponiveis: { empresa: Empresa; role: PerfilRole; isOwner: boolean }[];
}

// ── Clientes (tabela independente, sem vínculo com auth.users) ─

export interface Cliente {
  id: string;
  empresa_id: string;
  nome: string;
  telefone?: string;
  email?: string;
  data_nascimento?: string;
  observacoes?: string;
  endereco?: string;
  ativo: boolean;
  created_at: string;
}

// ── Pacotes e controle de sessões ─────────────────────────────

export interface PacoteServico {
  pacote_id: string;
  servico_id: string;
  quantidade: number;
  servico?: Pick<Servico, 'nome'>;
}

export interface PacoteCliente {
  id: string;
  empresa_id: string;
  pacote_id: string;
  cliente_id: string;
  data_inicio: string;
  data_validade: string | null;
  valor_pago?: number;
  status: 'ativo' | 'concluido' | 'expirado' | 'cancelado';
  observacao?: string;
  created_at: string;
  pacote?: Pacote;
  cliente?: Cliente;
}

export interface PacoteUso {
  id: string;
  empresa_id: string;
  pacote_cliente_id: string;
  servico_id?: string;
  agendamento_id?: string;
  observacao?: string;
  created_at: string;
}

// ── Vendas avulsas ────────────────────────────────────────────

export interface Venda {
  id: string;
  empresa_id: string;
  cliente_id?: string;
  valor_total: number;
  desconto: number;
  valor_final: number;
  observacao?: string;
  created_at: string;
  cliente?: Cliente;
  itens?: VendaItem[];
}

export interface VendaItem {
  id: string;
  empresa_id: string;
  venda_id: string;
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
  produto?: Pick<Produto, 'nome' | 'unidade'>;
}

// ── Estoque ───────────────────────────────────────────────────

export interface EstoqueMovimento {
  id: string;
  produto_id: string;
  empresa_id: string;
  tipo: MovimentoTipo;
  quantidade: number;
  motivo?: string;
  agendamento_id?: string;
  created_at: string;
  produto?: Pick<Produto, 'nome' | 'unidade'>;
}

// ── Receitas de insumos por serviço ───────────────────────────

export interface ServicoProduto {
  servico_id: string;
  produto_id: string;
  quantidade: number;
  servico?: Pick<Servico, 'nome'>;
  produto?: Pick<Produto, 'nome' | 'unidade'>;
}

// ── Helpers de form ───────────────────────────────────────────

/** Opção para SearchSelect */
export interface SelectOption {
  value: string;
  label: string;
  sub?: string;
}
