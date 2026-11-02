import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { desativarPushDoAparelho } from '@/lib/notifications';
import type { User, Empresa, EmpresaMembro, AuthState } from '@/types';
import type { PerfilRole } from '@/types';
import { carregarMinhasPermissoes, papelDeRole } from '@shared/permissoes-consultas';
import type { PermissoesUsuario } from '@shared/permissoes';
import { escolherEmpresaAtiva, STORAGE_EMPRESA_ATIVA } from '@shared/empresa-ativa';

/** Lê a empresa salva no aparelho (falha de leitura = sem preferência). */
async function empresaSalva(): Promise<string | null> {
  try { return await AsyncStorage.getItem(STORAGE_EMPRESA_ATIVA); } catch { return null; }
}

/** Salva a empresa escolhida no aparelho (falha de escrita só perde a preferência). */
async function salvarEmpresa(empresaId: string): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_EMPRESA_ATIVA, empresaId); } catch { /* preferência perdida */ }
}

const PERMISSOES_VAZIAS: PermissoesUsuario = { isOwner: false, papel: null, chaves: [] };

interface AuthStore extends AuthState {
  // actions
  carregarSessao: (opts?: { manterEmpresaId?: string }) => Promise<void>;
  /** Logado, mas sem nenhuma empresa (owner ou membro). */
  semEmpresa: boolean;
  /** Permissões efetivas da pessoa logada na empresa ativa (catálogo + exceções). */
  permissoes: PermissoesUsuario;
  /** `false` enquanto as permissões da empresa atual ainda não chegaram (evita tratar "vazio" como "sem permissão"). */
  permissoesCarregadas: boolean;
  /**
   * `true` quando a RPC de permissões falhou (`carregarMinhasPermissoes` → `null`): o _layout raiz
   * mostra o erro com "Tentar de novo", `permissoesCarregadas` fica `false` (as telas esperam, não
   * expulsam) e nada é liberado (`chaves: []`).
   */
  permissoesErro: boolean;
  /**
   * `true` quando a leitura das empresas (vínculos ou empresas da dona) falhou: a sessão ficou
   * incompleta, `semEmpresa` nunca é ligado por isso e "Tentar de novo" recarrega a sessão inteira.
   */
  erroEmpresas: boolean;
  /** Recarrega as permissões efetivas (ao entrar, trocar de empresa e voltar ao app). */
  recarregarPermissoes: () => Promise<void>;
  selecionarEmpresa: (empresa: Empresa, role: PerfilRole, isOwner: boolean) => void;
  /**
   * Troca a empresa ativa pelo menu: salva no aparelho (`bm_empresa`) e recarrega a sessão com ela.
   * Quem chama invalida as queries (`SeletorEmpresa`).
   */
  trocarEmpresa: (empresaId: string) => Promise<void>;
  sair: () => Promise<void>;
  /** Zera o estado local de sessão (sem chamar o Supabase) — usado quando a sessão expira. */
  limparSessao: () => void;
  // empresas e papéis disponíveis para o usuário
  empresasDisponiveis: { empresa: Empresa; role: PerfilRole; isOwner: boolean }[];
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  empresaAtiva: null,
  roleAtivo: null,
  isOwner: false,
  empresasDisponiveis: [],
  semEmpresa: false,
  permissoes: PERMISSOES_VAZIAS,
  permissoesCarregadas: false,
  permissoesErro: false,
  erroEmpresas: false,

  carregarSessao: async (opts) => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;

    // Busca perfil do usuário
    const { data: userProfile } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    // Busca todas as empresas que o usuário pertence (como membro)
    const { data: membros, error: erroMembros } = await supabase
      .from('empresa_membros')
      .select('*, empresa:empresas(*)')
      .eq('user_id', authUser.id)
      .eq('ativo', true);

    // Busca empresas onde ele é owner
    const { data: ownedEmpresas, error: erroOwned } = await supabase
      .from('empresas')
      .select('*')
      .eq('owner_id', authUser.id)
      .eq('ativo', true);
    // Leitura com erro nunca vira "sem empresa": o _layout mandaria para Criar empresa e a pessoa
    // poderia criar uma 2ª empresa por engano. Fica com o que veio e `permissoesErro` mostra
    // "Tentar de novo" (que recarrega a sessão inteira quando não há empresa ativa).
    const erroEmpresas = !!erroMembros || !!erroOwned;

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

    // Empresa ativa: a que já estava na tela (troca/recarga) ou a salva no aparelho, se ainda for
    // um vínculo ativo; senão a mais antiga — sempre a mesma (regra única de shared/empresa-ativa).
    const preferida = opts?.manterEmpresaId ?? (await empresaSalva());
    const vinculos = disponíveis.map((d) => {
      const m = membros?.find((x: EmpresaMembro) => x.empresa_id === d.empresa.id) as EmpresaMembro | undefined;
      return { id: m?.id ?? d.empresa.id, empresa_id: d.empresa.id, created_at: m?.created_at ?? d.empresa.created_at, d };
    });
    const escolhida = escolherEmpresaAtiva(vinculos, preferida)?.d;
    if (escolhida) void salvarEmpresa(escolhida.empresa.id);

    // Permissões da empresa escolhida ANTES do set: um único set, sem janela com `chaves: []`.
    // Owner entra com roleAtivo 'gestor' — isOwner manda.
    const escolhidaOwner = escolhida?.isOwner ?? false;
    // Falha da RPC (null): nada liberado, telas esperando e o erro com "Tentar de novo" no _layout.
    const carregadas = escolhida
      ? await carregarMinhasPermissoes(supabase, escolhida.empresa.id, escolhidaOwner, escolhidaOwner ? null : papelDeRole(escolhida.role))
      : PERMISSOES_VAZIAS;
    const permissoes = carregadas ?? PERMISSOES_VAZIAS;

    set({
      user: userProfile,
      empresasDisponiveis: disponíveis,
      empresaAtiva: escolhida?.empresa ?? null,
      roleAtivo: escolhidaOwner ? 'gestor' : (escolhida?.role ?? null),
      isOwner: escolhidaOwner,
      semEmpresa: !erroEmpresas && disponíveis.length === 0,
      permissoes,
      permissoesCarregadas: !erroEmpresas && carregadas !== null,
      permissoesErro: erroEmpresas || carregadas === null,
      erroEmpresas,
    });
  },

  selecionarEmpresa: (empresa, role, isOwner) => {
    void salvarEmpresa(empresa.id);
    set({ empresaAtiva: empresa, roleAtivo: role, isOwner, permissoes: PERMISSOES_VAZIAS, permissoesCarregadas: false, permissoesErro: false });
    void get().recarregarPermissoes();
  },

  trocarEmpresa: async (empresaId) => {
    await salvarEmpresa(empresaId);
    await get().carregarSessao({ manterEmpresaId: empresaId });
  },

  recarregarPermissoes: async () => {
    const { empresaAtiva, isOwner, roleAtivo, erroEmpresas } = get();
    // Sessão incompleta (empresas não carregaram): "Tentar de novo" relê tudo.
    if (erroEmpresas) { await get().carregarSessao({ manterEmpresaId: empresaAtiva?.id }); return; }
    if (!empresaAtiva) return;
    // Owner entra no store com roleAtivo 'gestor' (ver carregarSessao) — isOwner manda.
    const permissoes = await carregarMinhasPermissoes(supabase, empresaAtiva.id, isOwner, isOwner ? null : papelDeRole(roleAtivo));
    if (get().empresaAtiva?.id !== empresaAtiva.id) return;
    if (permissoes) {
      set({ permissoes, permissoesCarregadas: true, permissoesErro: false });
      return;
    }
    // Falhou. Releitura ao voltar ao app com as permissões desta empresa já carregadas: mantém as
    // que vieram do banco (não libera nada novo, nunca cai nos padrões do papel). Sem permissões
    // válidas (1ª carga, troca de empresa ou "Tentar de novo" depois de erro): nada liberado + erro.
    const s = get();
    if (s.permissoesCarregadas && !s.permissoesErro) return;
    set({ permissoes: PERMISSOES_VAZIAS, permissoesCarregadas: false, permissoesErro: true });
  },

  limparSessao: () => {
    set({
      user: null,
      empresaAtiva: null,
      roleAtivo: null,
      isOwner: false,
      empresasDisponiveis: [],
      semEmpresa: false,
      permissoes: PERMISSOES_VAZIAS,
      permissoesCarregadas: false,
      permissoesErro: false,
      erroEmpresas: false,
    });
  },

  sair: async () => {
    // Antes do signOut: a RLS só deixa apagar o aparelho com a sessão. Também cancela os lembretes locais.
    await desativarPushDoAparelho();
    await supabase.auth.signOut();
    get().limparSessao();
  },
}));
