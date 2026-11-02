import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ChevronRight } from 'lucide-react-native';
import { useAuthStore } from '@/stores/authStore';
import { rotaInicial } from '@/lib/permissions';
import { useTema } from '@/lib/tema';

const AVATAR_BG = ['#2C1654', '#0D7E5F', '#B45309', '#7C3AED', '#C0392B'];

function rotuloPapel(role: string, owner: boolean) {
  if (owner) return 'Proprietário(a)';
  if (role === 'gestor') return 'Gestor(a)';
  if (role === 'profissional') return 'Profissional';
  return 'Sem acesso';
}

/**
 * Seletor de empresa do app (menu Mais e Início da profissional). Aparece só com 2 ou mais
 * vínculos. Ao trocar: salva a escolha no aparelho, recarrega a sessão (`trocarEmpresa`), invalida
 * todas as queries e vai para a tela inicial do papel nessa empresa. O _layout raiz registra o
 * aparelho de push na empresa nova.
 */
export function SeletorEmpresa({ style }: { style?: object }) {
  const { C } = useTema();
  const { empresasDisponiveis, empresaAtiva, trocarEmpresa } = useAuthStore();
  const qc = useQueryClient();
  const [trocando, setTrocando] = useState<string | null>(null);

  if (empresasDisponiveis.length < 2) return null;

  async function trocar(empresaId: string) {
    if (trocando || empresaId === empresaAtiva?.id) return;
    setTrocando(empresaId);
    try {
      await trocarEmpresa(empresaId);
      await qc.invalidateQueries();
      const s = useAuthStore.getState();
      if (s.roleAtivo) router.replace(rotaInicial(s.isOwner ? 'owner' : s.roleAtivo) as any);
    } catch {
      Alert.alert('Não foi possível trocar de empresa', 'Confira a conexão e tente de novo.');
    } finally {
      setTrocando(null);
    }
  }

  return (
    <View style={style}>
      <Text style={{
        fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3,
        textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
      }}>
        Empresas
      </Text>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, overflow: 'hidden',
      }}>
        {empresasDisponiveis.map(({ empresa, role, isOwner }, idx) => {
          const ativa = empresa.id === empresaAtiva?.id;
          const iniciais = empresa.nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
          return (
            <TouchableOpacity
              key={empresa.id}
              onPress={() => void trocar(empresa.id)}
              activeOpacity={ativa ? 1 : 0.7}
              disabled={!!trocando}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 16,
                borderBottomWidth: idx === empresasDisponiveis.length - 1 ? 0 : 1, borderBottomColor: C.border,
                backgroundColor: ativa ? C.primarySoft : C.surface,
              }}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 10, backgroundColor: AVATAR_BG[idx % AVATAR_BG.length],
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>{iniciais}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{empresa.nome}</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 1 }}>
                  {rotuloPapel(role, isOwner)}
                </Text>
              </View>
              {trocando === empresa.id
                ? <ActivityIndicator color={C.accent} />
                : ativa
                  ? <CheckCircle size={18} color={C.accent} strokeWidth={2} />
                  : <ChevronRight size={16} color={C.text4} strokeWidth={2} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
