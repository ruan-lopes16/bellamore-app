import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailOpen } from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { rotaInicial } from '@/lib/permissions';
import { carregarMeusConvites, aceitarConvite, recusarConvite } from '@shared/convites-consultas';
import { rotuloPapelEquipe } from '@shared/equipe';

const C = {
  surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6',
};

/**
 * Banner "Você foi convidada para entrar na equipe de {empresa} como {papel}" com Aceitar e Recusar
 * (migration 092). Flutua no topo das áreas logadas e da tela de criar empresa, sem deslocar o conteúdo.
 * Aceitar troca a empresa ativa para a nova e recarrega a sessão e os dados; sem a 092 a lista vem
 * vazia e o banner não aparece. Nunca grava em `empresa_membros`: tudo passa pelas funções do banco.
 */
export function BannerConvites() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const ocupadoRef = useRef(false);

  const { data: convites = [] } = useQuery({
    queryKey: ['meus-convites', user?.id],
    enabled: !!user?.id,
    staleTime: 1000 * 30,
    queryFn: () => carregarMeusConvites(supabase),
  });

  if (convites.length === 0) return null;

  async function responder(id: string, aceitar: boolean) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupadoId(id);
    try {
      if (!aceitar) {
        await recusarConvite(supabase, id);
        await qc.invalidateQueries({ queryKey: ['meus-convites'] });
        return;
      }
      const empresaId = await aceitarConvite(supabase, id);
      // Troca a empresa ativa para a nova e recarrega sessão, permissões e todos os dados.
      await useAuthStore.getState().carregarSessao({ manterEmpresaId: empresaId });
      await qc.invalidateQueries();
      const { roleAtivo, isOwner } = useAuthStore.getState();
      const papel = isOwner ? 'owner' : roleAtivo;
      if (papel) router.replace(rotaInicial(papel) as any);
    } catch (e) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível responder ao convite.');
      qc.invalidateQueries({ queryKey: ['meus-convites'] });
    } finally {
      ocupadoRef.current = false;
      setOcupadoId(null);
    }
  }

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, zIndex: 50, elevation: 12, gap: 8 }}>
      {convites.map((c) => {
        const ocupado = ocupadoId === c.id;
        return (
          <View key={c.id} style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14,
            shadowColor: C.primary, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <MailOpen size={15} color={C.primary} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, lineHeight: 19 }}>
                  Você foi convidada para entrar na equipe de {c.empresa_nome} como {rotuloPapelEquipe(c.role)}.
                </Text>
                {c.convidado_por_nome ? (
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                    Convite de {c.convidado_por_nome}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => responder(c.id, false)} disabled={ocupadoId !== null}
                style={{ flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: ocupadoId !== null ? 0.5 : 1 }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>Recusar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => responder(c.id, true)} disabled={ocupadoId !== null}
                style={{ flex: 1, height: 42, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: ocupadoId !== null && !ocupado ? 0.5 : 1 }}
              >
                {ocupado
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>Aceitar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}
