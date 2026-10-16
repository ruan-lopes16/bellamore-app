import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailQuestion, X } from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import {
  carregarConvitesPendentes, cancelarConvite, carregarHistoricoEquipe,
  type ConvitePendente,
} from '@shared/convites-consultas';
import {
  rotuloPapelEquipe, rotuloContrato, descreverHistoricoEquipe, quandoHistoricoEquipe,
  type LinhaHistoricoEquipe,
} from '@shared/equipe';

const C = {
  surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  rose: '#C9527F', roseSoft: '#FCEEF3',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6',
};

const titulo = {
  fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3,
  textTransform: 'uppercase', letterSpacing: 1.5, marginHorizontal: 24, marginBottom: 12,
} as const;

/** "16/10/2026" a partir do instante ISO (Brasília, sem Intl). */
const diaDe = (iso: string) => quandoHistoricoEquipe(iso).slice(0, 10);

/**
 * Seção "Convites pendentes" da Equipe (migration 092): nome, e-mail, papel, data e Cancelar com
 * confirmação. Sem a 092 a lista vem vazia e a seção não aparece. Só para quem tem `equipe.gerenciar`
 * (a tela decide); convite de gestora só a dona cancela (o banco recusa e a mensagem aparece).
 */
export function ConvitesPendentesSecao({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient();
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);

  const { data: convites = [], isError, error, refetch } = useQuery({
    queryKey: ['convites-pendentes', empresaId],
    staleTime: 1000 * 30,
    queryFn: () => carregarConvitesPendentes(supabase, empresaId),
  });

  async function cancelar(c: ConvitePendente) {
    setCancelandoId(c.id);
    try {
      await cancelarConvite(supabase, empresaId, c.id);
    } catch (e) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível cancelar o convite.');
    } finally {
      setCancelandoId(null);
      qc.invalidateQueries({ queryKey: ['convites-pendentes'] });
      qc.invalidateQueries({ queryKey: ['equipe-historico'] });
    }
  }

  function confirmarCancelar(c: ConvitePendente) {
    if (cancelandoId) return;
    Alert.alert(
      'Cancelar convite',
      `O convite para ${c.nome || c.email} será cancelado e ela não poderá mais aceitá-lo. Você pode enviar outro depois.`,
      [
        { text: 'Manter convite', style: 'cancel' },
        { text: 'Cancelar convite', style: 'destructive', onPress: () => { void cancelar(c); } },
      ],
    );
  }

  if (isError) {
    return (
      <View style={{ marginHorizontal: 24, marginBottom: 20, backgroundColor: C.roseSoft, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.rose, lineHeight: 18 }}>
          {error instanceof Error ? error.message : 'Não foi possível carregar os convites pendentes.'}
        </Text>
        <TouchableOpacity onPress={() => refetch()}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.rose, textDecorationLine: 'underline' }}>Tentar de novo</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (convites.length === 0) return null;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={titulo}>Convites pendentes · {convites.length}</Text>
      <View style={{ paddingHorizontal: 24, gap: 8 }}>
        {convites.map((c) => (
          <View key={c.id} style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14,
            flexDirection: 'row', alignItems: 'center', gap: 12,
          }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <MailQuestion size={16} color={C.primary} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
                {c.nome || c.email}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                {c.email}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text2, marginTop: 2 }}>
                {rotuloPapelEquipe(c.role)}{c.tipo_contrato ? ` · ${rotuloContrato(c.tipo_contrato)}` : ''} · enviado em {diaDe(c.criado_em)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => confirmarCancelar(c)} disabled={cancelandoId !== null}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 34, borderRadius: 10,
                borderWidth: 1, borderColor: 'rgba(201,82,127,0.3)', opacity: cancelandoId !== null ? 0.5 : 1,
              }}
            >
              {cancelandoId === c.id
                ? <ActivityIndicator size="small" color={C.rose} />
                : <X size={13} color={C.rose} strokeWidth={2.5} />}
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.rose }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Seção "Histórico" da Equipe (migration 092), paginada com "Mostrar mais" (mais recentes primeiro).
 * Frases de `descreverHistoricoEquipe`; e-mails já vêm mascarados do banco para quem não é a dona.
 * Sem a 092 (`disponivel: false`) a seção some. `nomes` = user_id → nome, montado pela tela.
 */
export function HistoricoEquipeSecao({ empresaId, nomes }: { empresaId: string; nomes: Record<string, string> }) {
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erroMais, setErroMais] = useState('');
  // Páginas além da primeira; a primeira vem do useQuery e se renova ao invalidar (aí as extras zeram).
  const [extras, setExtras] = useState<{ linhas: LinhaHistoricoEquipe[]; temMais: boolean; paginas: number }>({ linhas: [], temMais: false, paginas: 0 });

  const { data, isError, error, refetch } = useQuery({
    queryKey: ['equipe-historico', empresaId],
    staleTime: 1000 * 30,
    queryFn: async () => {
      const primeira = await carregarHistoricoEquipe(supabase, empresaId, 0);
      setExtras({ linhas: [], temMais: false, paginas: 0 });
      setErroMais('');
      return primeira;
    },
  });

  async function mostrarMais() {
    if (carregandoMais) return;
    setCarregandoMais(true);
    setErroMais('');
    try {
      const prox = extras.paginas + 1;
      const r = await carregarHistoricoEquipe(supabase, empresaId, prox);
      setExtras((a) => ({ linhas: [...a.linhas, ...r.linhas], temMais: r.temMais, paginas: prox }));
    } catch (e) {
      setErroMais(e instanceof Error ? e.message : 'Não foi possível carregar mais.');
    } finally {
      setCarregandoMais(false);
    }
  }

  if (isError) {
    return (
      <View style={{ marginHorizontal: 24, marginTop: 8, backgroundColor: C.roseSoft, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.rose, lineHeight: 18 }}>
          {error instanceof Error ? error.message : 'Não foi possível carregar o histórico da equipe.'}
        </Text>
        <TouchableOpacity onPress={() => refetch()}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.rose, textDecorationLine: 'underline' }}>Tentar de novo</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!data || !data.disponivel) return null;

  const linhas = [...data.linhas, ...extras.linhas];
  const temMais = extras.paginas === 0 ? data.temMais : extras.temMais;

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={titulo}>Histórico</Text>
      <View style={{ paddingHorizontal: 24 }}>
        {linhas.length === 0 ? (
          <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 20, alignItems: 'center' }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
              Nada registrado ainda.
            </Text>
          </View>
        ) : (
          <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, overflow: 'hidden' }}>
            {linhas.map((h, i) => (
              <View key={h.id} style={{ padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text, lineHeight: 19 }}>
                  {descreverHistoricoEquipe(h, nomes)}
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 3 }}>
                  {quandoHistoricoEquipe(h.criado_em)}
                </Text>
              </View>
            ))}
          </View>
        )}
        {erroMais ? (
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.rose, marginTop: 8, textAlign: 'center' }}>{erroMais}</Text>
        ) : null}
        {temMais && (
          <TouchableOpacity
            onPress={mostrarMais} disabled={carregandoMais}
            style={{ marginTop: 10, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', opacity: carregandoMais ? 0.6 : 1 }}
          >
            {carregandoMais
              ? <ActivityIndicator color={C.primary} />
              : <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.primary }}>Mostrar mais</Text>}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
