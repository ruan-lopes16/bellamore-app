import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { carregarPreferenciaAgenda } from '@shared/agenda-consultas';

/** Chave da preferência "Minha agenda abre em" (invalidada ao salvar em Configurações). */
export const chavePreferenciaAgenda = (empresaId?: string, userId?: string) =>
  ['agenda-preferencia', empresaId, userId] as const;

/**
 * Preferência "Minha agenda abre em" da pessoa logada na empresa ativa (`'propria'` | `'todas'`).
 * Sem a 094 devolve `null` (o campo some e a agenda abre na própria pessoa); erro de rede = query em erro (a agenda abre na própria pessoa).
 */
export function usePreferenciaAgenda() {
  const { empresaAtiva, user } = useAuthStore();
  return useQuery({
    queryKey: chavePreferenciaAgenda(empresaAtiva?.id, user?.id),
    enabled: !!empresaAtiva?.id && !!user?.id,
    staleTime: 1000 * 60,
    queryFn: () => carregarPreferenciaAgenda(supabase, empresaAtiva!.id, user!.id),
  });
}
