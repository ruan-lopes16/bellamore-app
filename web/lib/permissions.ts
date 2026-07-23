import type { PerfilRole } from '@/types';

export type Permissao =
  | 'ver_financeiro_sensivel'
  | 'ver_despesas'
  | 'ver_resumo_financeiro'
  | 'ver_todos_agendamentos'
  | 'ver_proprios_agendamentos'
  | 'gerenciar_profissionais'
  | 'gerenciar_servicos'
  | 'gerenciar_produtos'
  | 'gerenciar_estoque'
  | 'ver_comissoes_todas'
  | 'ver_propria_comissao'
  | 'ver_todos_clientes'
  | 'ver_anamnese'
  | 'fechar_comanda'
  | 'configurar_empresa';

const PERMISSOES: Record<'owner' | PerfilRole, Permissao[]> = {
  owner: [
    'ver_financeiro_sensivel', 'ver_despesas', 'ver_resumo_financeiro',
    'ver_todos_agendamentos', 'ver_proprios_agendamentos',
    'gerenciar_profissionais', 'gerenciar_servicos', 'gerenciar_produtos',
    'gerenciar_estoque', 'ver_comissoes_todas', 'ver_propria_comissao',
    'ver_todos_clientes', 'ver_anamnese', 'fechar_comanda', 'configurar_empresa',
  ],
  gestor: [
    'ver_despesas', 'ver_resumo_financeiro',
    'ver_todos_agendamentos', 'ver_proprios_agendamentos',
    'gerenciar_profissionais', 'gerenciar_servicos', 'gerenciar_produtos',
    'gerenciar_estoque', 'ver_comissoes_todas', 'ver_propria_comissao',
    'ver_todos_clientes', 'ver_anamnese', 'fechar_comanda',
  ],
  profissional: ['ver_proprios_agendamentos', 'ver_propria_comissao', 'ver_anamnese', 'fechar_comanda'],
  cliente: [],
};

export function temPermissao(role: PerfilRole | 'owner', permissao: Permissao): boolean {
  return PERMISSOES[role]?.includes(permissao) ?? false;
}

export function rotaInicial(role: PerfilRole | 'owner'): string {
  switch (role) {
    case 'owner':
    case 'gestor':      return '/dashboard';
    case 'profissional': return '/agenda';
    case 'cliente':     return '/inicio';
    default:            return '/login';
  }
}

export function podeAtribuirRole(
  quemConvida: 'owner' | PerfilRole,
  roleAlvo: 'gestor' | 'profissional',
): boolean {
  if (roleAlvo === 'gestor') return quemConvida === 'owner';
  return quemConvida === 'owner' || quemConvida === 'gestor';
}
