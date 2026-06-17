import { PerfilRole } from '@/types';

// ============================================================
// PERMISSÕES POR PERFIL
// Centraliza toda a lógica de acesso — nunca dispersar no código
// ============================================================

type Permissao =
  | 'ver_financeiro_sensivel'   // CNPJ, dados bancários, faturamento bruto
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
    'ver_financeiro_sensivel',
    'ver_despesas',
    'ver_resumo_financeiro',
    'ver_todos_agendamentos',
    'ver_proprios_agendamentos',
    'gerenciar_profissionais',
    'gerenciar_servicos',
    'gerenciar_produtos',
    'gerenciar_estoque',
    'ver_comissoes_todas',
    'ver_propria_comissao',
    'ver_todos_clientes',
    'ver_anamnese',
    'fechar_comanda',
    'configurar_empresa',
  ],
  gestor: [
    'ver_despesas',
    'ver_resumo_financeiro',
    'ver_todos_agendamentos',
    'ver_proprios_agendamentos',
    'gerenciar_profissionais',
    'gerenciar_servicos',
    'gerenciar_produtos',
    'gerenciar_estoque',
    'ver_comissoes_todas',
    'ver_propria_comissao',
    'ver_todos_clientes',
    'ver_anamnese',
    'fechar_comanda',
  ],
  profissional: [
    'ver_proprios_agendamentos',
    'ver_propria_comissao',
    'ver_anamnese',
    'fechar_comanda',
  ],
  cliente: [],
};

export function temPermissao(
  role: PerfilRole | 'owner',
  permissao: Permissao
): boolean {
  return PERMISSOES[role]?.includes(permissao) ?? false;
}

// Retorna a rota inicial baseada no perfil
export function rotaInicial(role: PerfilRole | 'owner'): string {
  switch (role) {
    case 'owner':
    case 'gestor':
      return '/(empresa)/dashboard';
    case 'profissional':
      return '/(profissional)/agenda';
    case 'cliente':
      return '/(cliente)/inicio';
    default:
      return '/(auth)/login';
  }
}
