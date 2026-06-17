import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ── Tipos ────────────────────────────────────────────────────

export type NotifTipo = 'agendamento' | 'comissao' | 'pagamento' | 'estoque_baixo' | 'cliente_sumido';

export interface Notificacao {
  id: string;
  tipo: NotifTipo;
  titulo: string;
  mensagem: string;
  lida: boolean;
  created_at: string;
  tempoRelativo: string;
}

// ── Hook ─────────────────────────────────────────────────────

export function useNotificacoes() {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const lista = useQuery<Notificacao[]>({
    queryKey: ['notificacoes', user?.id],
    enabled: !!user?.id,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notificacoes')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      return (data ?? []).map((n) => ({
        ...n,
        tempoRelativo: formatDistanceToNow(new Date(n.created_at), {
          locale: ptBR, addSuffix: true,
        }),
      }));
    },
  });

  // ── Marcar uma como lida ─────────────────────────────────
  const marcarLida = useMutation({
    mutationFn: (id: string) =>
      supabase.from('notificacoes').update({ lida: true }).eq('id', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notificacoes'] }),
  });

  // ── Marcar todas como lidas ──────────────────────────────
  const marcarTodasLidas = useMutation({
    mutationFn: () =>
      supabase.from('notificacoes')
        .update({ lida: true })
        .eq('user_id', user!.id)
        .eq('lida', false),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notificacoes'] }),
  });

  const todas       = lista.data ?? [];
  const naoLidas    = todas.filter((n) => !n.lida);
  const countNaoLidas = naoLidas.length;

  return {
    notificacoes: todas,
    naoLidas,
    countNaoLidas,
    isLoading: lista.isLoading,
    refetch: lista.refetch,
    marcarLida: (id: string) => marcarLida.mutate(id),
    marcarTodasLidas: () => marcarTodasLidas.mutate(),
  };
}
