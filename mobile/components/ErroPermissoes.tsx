import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { TITULO_ERRO_VINCULOS } from '@shared/destino-sessao';
import { useTemaGlobal } from '@/lib/tema';

/**
 * Cobre a tela quando as permissões não carregaram (`permissoesErro`): nada fica liberado e as
 * telas esperam por baixo. "Tentar de novo" relê as permissões da empresa ativa.
 * Com `erroEmpresas` (a leitura dos vínculos falhou) o título é "Não foi possível carregar suas
 * empresas" e há também "Sair": nunca vai para o login nem para Criar empresa por causa do erro.
 * Renderizado pelo _layout raiz, igual ao erro do AppLayout no web.
 */
export function ErroPermissoes() {
  const { C } = useTemaGlobal();
  const recarregar = useAuthStore(s => s.recarregarPermissoes);
  const erroEmpresas = useAuthStore(s => s.erroEmpresas);
  const sair = useAuthStore(s => s.sair);
  const [tentando, setTentando] = useState(false);

  async function tentar() {
    if (tentando) return;
    setTentando(true);
    try { await recarregar(); } finally { setTentando(false); }
  }

  return (
    <View
      accessibilityRole="alert"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
        backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <View style={{
        backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.border,
        padding: 24, width: '100%', maxWidth: 420, alignItems: 'center',
      }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 6, textAlign: 'center' }}>
          {erroEmpresas ? TITULO_ERRO_VINCULOS : 'Não foi possível carregar suas permissões.'}
        </Text>
        <Text style={{ fontSize: 13, color: C.text3, marginBottom: 16, textAlign: 'center' }}>
          Confira a conexão e tente de novo.
        </Text>
        <TouchableOpacity
          onPress={tentar}
          disabled={tentando}
          style={{
            backgroundColor: C.primary, borderRadius: 14, paddingHorizontal: 20, height: 44,
            alignItems: 'center', justifyContent: 'center', opacity: tentando ? 0.6 : 1, minWidth: 160,
          }}
        >
          {tentando
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>Tentar de novo</Text>}
        </TouchableOpacity>
        {erroEmpresas && (
          <TouchableOpacity
            onPress={() => { void sair(); }}
            style={{
              marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 20,
              height: 44, alignItems: 'center', justifyContent: 'center', minWidth: 160,
            }}
          >
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 14 }}>Sair</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
