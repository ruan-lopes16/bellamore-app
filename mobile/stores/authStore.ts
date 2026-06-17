import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { User, Empresa, EmpresaMembro, AuthState } from '@/types';
import type { PerfilRole } from '@/types';

interface AuthStore extends AuthState {
  // actions
  carregarSessao: () => Promise<void>;
  selecionarEmpresa: (empresa: Empresa, role: PerfilRole, isOwner: boolean) => void;
  sair: () => Promise<void>;
  // empresas e papéis disponíveis para o usuário
  empresasDisponiveis: { empresa: Empresa; role: PerfilRole; isOwner: boolean }[];
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  empresaAtiva: null,
  roleAtivo: null,
  isOwner: false,
  empresasDisponiveis: [],

  carregarSessao: async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;

    // Busca perfil do usuário
    const { data: userProfile } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    // Busca todas as empresas que o usuário pertence (como membro)
    const { data: membros } = await supabase
      .from('empresa_membros')
      .select('*, empresa:empresas(*)')
      .eq('user_id', authUser.id)
      .eq('ativo', true);

    // Busca empresas onde ele é owner
    const { data: ownedEmpresas } = await supabase
      .from('empresas')
      .select('*')
      .eq('owner_id', authUser.id)
      .eq('ativo', true);

    const disponíveis: AuthStore['empresasDisponiveis'] = [];

    // Owner tem acesso total
    ownedEmpresas?.forEach((empresa) => {
      disponíveis.push({ empresa, role: 'gestor', isOwner: true });
    });

    // Membros (gestor, profissional, cliente)
    membros?.forEach((m: EmpresaMembro & { empresa: Empresa }) => {
      const jaAdicionado = disponíveis.some((d) => d.empresa.id === m.empresa_id);
      if (!jaAdicionado && m.empresa) {
        disponíveis.push({ empresa: m.empresa, role: m.role, isOwner: false });
      }
    });

    // Seleciona a primeira empresa por padrão
    const primeira = disponíveis[0];

    set({
      user: userProfile,
      empresasDisponiveis: disponíveis,
      empresaAtiva: primeira?.empresa ?? null,
      roleAtivo: primeira?.isOwner ? 'gestor' : (primeira?.role ?? null),
      isOwner: primeira?.isOwner ?? false,
    });
  },

  selecionarEmpresa: (empresa, role, isOwner) => {
    set({ empresaAtiva: empresa, roleAtivo: role, isOwner });
  },

  sair: async () => {
    await supabase.auth.signOut();
    set({
      user: null,
      empresaAtiva: null,
      roleAtivo: null,
      isOwner: false,
      empresasDisponiveis: [],
    });
  },
}));
