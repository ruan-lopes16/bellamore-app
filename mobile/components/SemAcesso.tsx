import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

/**
 * Tela "Sem acesso", por cima da rota: a pessoa abriu (por menu antigo ou deep link) uma tela que a
 * permissão dela não libera — mesmo mapa do `exigirAcesso` do web (`permissaoDaRota`).
 * - `podeVoltar` (padrão): botão Voltar (tela anterior, ou o Início da empresa).
 * - `podeVoltar={false}`: papel que o app não conhece — só "Sair".
 */
export function SemAcesso({ podeVoltar = true }: { podeVoltar?: boolean }) {
  const sair = useAuthStore(s => s.sair);

  function voltar() {
    if (router.canGoBack()) router.back();
    else router.replace('/(empresa)/dashboard' as any);
  }

  return (
    <View
      accessibilityRole="alert"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 900,
        backgroundColor: '#F4F1EE', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <View style={{
        backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E8E2DC',
        padding: 24, width: '100%', maxWidth: 420, alignItems: 'center',
      }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1228', marginBottom: 6, textAlign: 'center' }}>
          Sem acesso
        </Text>
        <Text style={{ fontSize: 13, color: '#8878A6', marginBottom: 16, textAlign: 'center' }}>
          {podeVoltar
            ? 'Você não tem permissão para abrir esta tela. Fale com a dona do salão se precisar.'
            : 'Seu perfil nesta empresa não tem acesso ao app. Fale com a dona do salão.'}
        </Text>
        <TouchableOpacity
          onPress={podeVoltar ? voltar : () => { void sair(); }}
          style={{
            backgroundColor: '#2C1654', borderRadius: 14, paddingHorizontal: 20, height: 44,
            alignItems: 'center', justifyContent: 'center', minWidth: 160,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>{podeVoltar ? 'Voltar' : 'Sair'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
