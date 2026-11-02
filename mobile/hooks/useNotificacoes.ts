/**
 * @file useNotificacoes.ts
 * Sino e tela de Notificações do app (empresa e profissional), pelas mesmas consultas e regras do
 * web (@shared/notificacoes-consultas, @shared/notificacoes):
 * - Avisos: linhas de `notificacoes` da pessoa NA EMPRESA ATIVA, paginadas, com filtro "Não lidas";
 * - Alertas: calculados na hora, só com o que a permissão da pessoa deixa ver;
 * - Sino e badges dos menus: `badgesDoMenu` sobre contagens leves (`carregarContagensSino`): o mesmo
 *   número de `contagemSino` da tela, sem baixar clientes e comandas em cada menu (igual à Sidebar web).
 * Toda chave começa com 'notificacoes' (o push recebido invalida tudo de uma vez).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { usePermissoes } from '@/lib/permissions';
import {
  carregarAvisos, contarAvisosNaoLidos, carregarContagensSino, carregarDadosAlertas, marcarLidas, marcarTodasLidas,
  type AvisoRow,
} from '@shared/notificacoes-consultas';
import { alertasCalculados, badgesDoMenu, type Alerta, type BadgesMenu } from '@shared/notificacoes';

export type { AvisoRow, Alerta };

const MINUTO = 60_000;

function useContexto() {
  const userId = useAuthStore(s => s.user?.id);
  const empresaId = useAuthStore(s => s.empresaAtiva?.id);
  const perm = usePermissoes();
  return { userId, empresaId, perm };
}

/** Alertas calculados da pessoa (null enquanto carrega ou com erro na 1ª carga). */
export function useAlertas() {
  const { userId, empresaId, perm } = useContexto();
  const { pode, permissoesCarregadas, isOwner, papel, chaves } = perm;
  const q = useQuery({
    // As chaves entram na chave: mudar a permissão muda o que é consultado.
    queryKey: ['notificacoes', 'alertas', empresaId, userId, isOwner, papel, chaves.join(',')],
    enabled: !!empresaId && !!userId && permissoesCarregadas,
    staleTime: MINUTO,
    refetchInterval: 5 * MINUTO,
    queryFn: () => carregarDadosAlertas(supabase, empresaId!, { userId: userId!, pode }),
  });
  const alertas: Alerta[] | null = q.data && userId
    ? alertasCalculados(q.data, { isOwner, papel, chaves }, { userId })
    : null;
  return { alertas, isLoading: q.isLoading, isError: q.isError && !q.data, error: q.error, refetch: q.refetch };
}

/** Quantos avisos não lidos a pessoa tem na empresa ativa (null enquanto carrega ou com erro). */
export function useAvisosNaoLidos() {
  const { userId, empresaId } = useContexto();
  const q = useQuery({
    queryKey: ['notificacoes', 'nao-lidas', empresaId, userId],
    enabled: !!empresaId && !!userId,
    staleTime: MINUTO,
    refetchInterval: 2 * MINUTO,
    queryFn: () => contarAvisosNaoLidos(supabase, empresaId!, userId!),
  });
  return { naoLidas: q.data ?? null, isError: q.isError && q.data === undefined, refetch: q.refetch };
}

/** Contagens do sino e dos badges (só `count head`, pela permissão de quem vê). */
function useContagensSino() {
  const { userId, empresaId, perm } = useContexto();
  const { pode, permissoesCarregadas, isOwner, papel, chaves } = perm;
  return useQuery({
    queryKey: ['notificacoes', 'contagens', empresaId, userId, isOwner, papel, chaves.join(',')],
    enabled: !!empresaId && !!userId && permissoesCarregadas,
    staleTime: MINUTO,
    refetchInterval: 2 * MINUTO,
    queryFn: () => carregarContagensSino(supabase, empresaId!, { userId: userId!, pode }),
  });
}

/**
 * Sino e badges Comissões/Comanda dos menus, pela mesma regra da Sidebar do web (`badgesDoMenu`).
 * `null` = sem número confiável (carregando ou erro na 1ª carga): não mostra badge. Depois de uma
 * carga boa, um erro de recarga mantém o número anterior (o cache), nunca um falso.
 */
export function useBadgesMenu(): BadgesMenu {
  const { perm } = useContexto();
  const q = useContagensSino();
  const { naoLidas } = useAvisosNaoLidos();
  const permissoes = perm.permissoesCarregadas ? { isOwner: perm.isOwner, papel: perm.papel, chaves: perm.chaves } : null;
  return badgesDoMenu(q.isError && !q.data ? null : q.data ?? null, permissoes, naoLidas);
}

/** Número do sino: avisos não lidos + alertas que pedem ação (`badgesDoMenu`). */
export function useSino(): number | null {
  return useBadgesMenu().sino;
}

/** Avisos da tela, paginados (TAMANHO_PAGINA_AVISOS), com o filtro "Não lidas". */
export function useAvisos(soNaoLidas: boolean) {
  const { userId, empresaId } = useContexto();
  const q = useInfiniteQuery({
    queryKey: ['notificacoes', 'avisos', empresaId, userId, soNaoLidas],
    enabled: !!empresaId && !!userId,
    staleTime: MINUTO,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => carregarAvisos(supabase, empresaId!, userId!, { soNaoLidas, pagina: pageParam }),
    getNextPageParam: (ultima, todas) => (ultima.temMais ? todas.length : undefined),
  });
  const avisos: AvisoRow[] | null = q.data ? q.data.pages.flatMap(p => p.avisos) : null;
  return {
    avisos,
    isLoading: q.isLoading,
    isError: q.isError && !q.data,
    error: q.error,
    refetch: q.refetch,
    temMais: !!q.hasNextPage,
    carregandoMais: q.isFetchingNextPage,
    carregarMais: () => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); },
  };
}

/** Marcar um aviso / todos como lidos (só muda o que o banco confirmou). Lança em erro. */
export function useMarcarLidas() {
  const { userId, empresaId } = useContexto();
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: ['notificacoes'] });
  const uma = useMutation({
    mutationFn: (id: string) => marcarLidas(supabase, [id]),
    onSettled: invalidar,
  });
  const todas = useMutation({
    mutationFn: () => marcarTodasLidas(supabase, empresaId!, userId!),
    onSettled: invalidar,
  });
  return {
    marcarUma: (id: string) => uma.mutateAsync(id),
    marcarTodas: () => todas.mutateAsync(),
    marcandoTodas: todas.isPending,
  };
}
