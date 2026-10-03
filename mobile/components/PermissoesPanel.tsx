// mobile/components/PermissoesPanel.tsx
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { usePermissoes } from '@/lib/permissions';
import { SmoothTabs } from '@/components/SmoothTabs';
import {
  CATALOGO_PERMISSOES, GRUPOS_PERMISSAO, aplicarMudancas, chaveMudanca, configVazia, contarExcecoes,
  descreverHistorico, estadoDoMembro, podeConcederChave, podeEditarAlvo, valorDoPapel,
  type ChavePermissao, type ConfigPermissoes, type EstadoExcecao, type LinhaHistorico, type MudancaPermissao, type Papel,
} from '@shared/permissoes';
import { carregarConfigPermissoes, carregarHistoricoPermissoes, salvarPermissoes } from '@shared/permissoes-consultas';
import { mensagemErroBanco } from '@shared/erros';

// Mesmas cores das telas de Configurações/Equipe (o app define o tema localmente em cada tela).
const C = {
  surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

type Membro = { user_id: string; nome: string; role: 'owner' | 'gestor' | 'profissional' };
type SubAba = 'papel' | 'pessoa' | 'historico';
const ROTULO_ESTADO: Record<EstadoExcecao, string> = { padrao: 'Padrão', permitir: 'Permitir', bloquear: 'Bloquear' };
const F = { r: 'PlusJakartaSans_400Regular', s: 'PlusJakartaSans_600SemiBold', b: 'PlusJakartaSans_700Bold' };

/** Aba Permissões do app — mesma regra e mesmo fluxo de rascunho/salvar do web. */
export function PermissoesPanel({ empresaId, meuUserId, membroInicial }: { empresaId: string; meuUserId: string; membroInicial?: string }) {
  const { isOwner, papel, chaves } = usePermissoes();
  const editor = { isOwner, papel, userId: meuUserId };
  /** A gestora não liga o que ela mesma não tem (salvar_permissoes recusaria). Já gravado ligado pode ficar. */
  const travaLigar = (chave: ChavePermissao, gravadoLigado: boolean) =>
    !podeConcederChave(editor, chaves, chave) && !gravadoLigado;

  const [sub, setSub] = useState<SubAba>(membroInicial ? 'pessoa' : 'papel');
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<ConfigPermissoes>(configVazia());
  const [membros, setMembros] = useState<Membro[]>([]);
  const [historico, setHistorico] = useState<LinhaHistorico[]>([]);
  const [rascunho, setRascunho] = useState<Record<string, MudancaPermissao>>({});
  const [membroSel, setMembroSel] = useState(membroInicial ?? '');
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const [c, h, rM] = await Promise.all([
        carregarConfigPermissoes(supabase, empresaId),
        carregarHistoricoPermissoes(supabase, empresaId),
        supabase.from('empresa_membros').select('user_id, role, user:users(nome)')
          .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional']),
      ]);
      if (rM.error) throw new Error(rM.error.message);
      setCfg(c); setHistorico(h);
      setMembros(((rM.data ?? []) as any[])
        .map(m => ({ user_id: m.user_id, role: m.role, nome: m.user?.nome ?? 'Sem nome' }))
        .sort((a: Membro, b: Membro) => a.nome.localeCompare(b.nome)));
    } catch (e) {
      Alert.alert('Erro', `Não foi possível carregar as permissões: ${(e as Error).message}`);
    }
    setLoading(false);
  }
  useEffect(() => { if (empresaId) carregar(); }, [empresaId]);

  const mudancas = useMemo(() => Object.values(rascunho), [rascunho]);
  const visivel = useMemo(() => aplicarMudancas(cfg, mudancas), [cfg, mudancas]);
  const nomes = useMemo(() => Object.fromEntries(membros.map(m => [m.user_id, m.nome])), [membros]);
  const editaveis = membros.filter(m => podeEditarAlvo(editor, { tipo: 'membro', userId: m.user_id, papel: m.role }));
  const filtrados = editaveis.filter(m => m.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  // Só alvos que a pessoa pode editar: o membro vindo da URL pode ser ela mesma ou outra gestora.
  const membroAtual = editaveis.find(m => m.user_id === membroSel);

  function mudar(m: MudancaPermissao) {
    setRascunho(prev => {
      const k = chaveMudanca(m);
      const igual = m.tipo === 'papel'
        ? valorDoPapel(cfg, m.alvo, m.chave) === m.permitido
        : (cfg.membros[m.alvo]?.[m.chave] ?? null) === m.permitido;
      const prox = { ...prev };
      if (igual) delete prox[k]; else prox[k] = m;
      return prox;
    });
  }

  async function salvar() {
    setSalvando(true);
    const { error } = await salvarPermissoes(supabase, empresaId, mudancas);
    setSalvando(false);
    if (error) { Alert.alert('Erro', mensagemErroBanco(error, 'alterar estas permissões')); return; }
    setRascunho({});
    Alert.alert('Pronto', 'Permissões salvas');
    await carregar();
  }

  if (loading) return <ActivityIndicator color={C.primary} style={{ marginTop: 24 }}/>;

  const tituloGrupo = (g: string) => (
    <Text style={{ fontFamily: F.b, fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 18, marginBottom: 8 }}>{g}</Text>
  );

  return (
    <View style={{ gap: 12 }}>
      <SmoothTabs
        tabs={[{ key: 'papel', label: 'Por papel' }, { key: 'pessoa', label: 'Por pessoa' }, { key: 'historico', label: 'Histórico' }]}
        active={sub}
        onChange={(k: string) => setSub(k as SubAba)}
      />

      {sub === 'papel' && (
        <View>
          {!isOwner && <Text style={{ fontFamily: F.r, fontSize: 12, color: C.text3 }}>Como gestora, você altera só o papel Profissional e só liga o que você mesma tem.</Text>}
          {GRUPOS_PERMISSAO.map(g => (
            <View key={g}>
              {tituloGrupo(g)}
              {CATALOGO_PERMISSOES.filter(p => p.grupo === g).map(p => (
                <View key={p.chave} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border }}>
                  <Text style={{ fontFamily: F.s, fontSize: 14, color: C.text }}>{p.rotulo}</Text>
                  {!!p.descricao && <Text style={{ fontFamily: F.r, fontSize: 11, color: C.text4 }}>{p.descricao}</Text>}
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                    {(['gestor', 'profissional'] as Papel[]).map(pp => (
                      <View key={pp} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Switch
                          value={valorDoPapel(visivel, pp, p.chave)}
                          disabled={!podeEditarAlvo(editor, { tipo: 'papel', papel: pp })
                            || (!valorDoPapel(visivel, pp, p.chave) && travaLigar(p.chave, valorDoPapel(cfg, pp, p.chave)))}
                          onValueChange={v => mudar({ tipo: 'papel', alvo: pp, chave: p.chave, permitido: v })}
                          trackColor={{ true: C.primary, false: C.border }}
                        />
                        <Text style={{ fontFamily: F.r, fontSize: 12, color: C.text2 }}>{pp === 'gestor' ? 'Gestora' : 'Profissional'}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {sub === 'pessoa' && (
        <View>
          <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar pessoa da equipe..."
            placeholderTextColor={C.text4}
            style={{ fontFamily: F.r, fontSize: 14, color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12 }}/>
          {filtrados.map(m => {
            const n = contarExcecoes(visivel, m.user_id);
            const ativo = m.user_id === membroSel;
            return (
              <Pressable key={m.user_id} onPress={() => setMembroSel(m.user_id)}
                style={{ paddingVertical: 10, paddingHorizontal: 12, marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor: ativo ? C.primary : C.border }}>
                <Text style={{ fontFamily: F.s, fontSize: 14, color: C.text }}>{m.nome}</Text>
                <Text style={{ fontFamily: F.r, fontSize: 11, color: C.text4 }}>
                  {m.role === 'gestor' ? 'Gestora' : 'Profissional'}{n ? ` · ${n} ${n === 1 ? 'exceção' : 'exceções'}` : ''}
                </Text>
              </Pressable>
            );
          })}
          {editaveis.length === 0 && <Text style={{ fontFamily: F.r, fontSize: 13, color: C.text3, marginTop: 8 }}>Ninguém da equipe que você possa ajustar individualmente.</Text>}
          {membroAtual && membroAtual.role !== 'owner' && GRUPOS_PERMISSAO.map(g => (
            <View key={g}>
              {tituloGrupo(g)}
              {CATALOGO_PERMISSOES.filter(p => p.grupo === g).map(p => {
                const estado = estadoDoMembro(visivel, membroAtual.user_id, p.chave);
                const padrao = valorDoPapel(visivel, membroAtual.role as Papel, p.chave);
                return (
                  <View key={p.chave} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border }}>
                    <Text style={{ fontFamily: F.s, fontSize: 14, color: C.text }}>{p.rotulo}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                      {(['padrao', 'permitir', 'bloquear'] as EstadoExcecao[]).map(e => {
                        const semChave = e === 'permitir' && travaLigar(p.chave, cfg.membros[membroAtual.user_id]?.[p.chave] === true);
                        return (
                        <Pressable key={e} disabled={semChave}
                          onPress={() => mudar({ tipo: 'membro', alvo: membroAtual.user_id, chave: p.chave, permitido: e === 'padrao' ? null : e === 'permitir' })}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1, opacity: semChave ? 0.4 : 1,
                                   borderColor: estado === e ? C.primary : C.border, backgroundColor: estado === e ? C.primarySoft : 'transparent' }}>
                          <Text style={{ fontFamily: F.s, fontSize: 11.5, color: estado === e ? C.primary : C.text2 }}>
                            {e === 'padrao' ? `${ROTULO_ESTADO[e]} (${padrao ? '✔' : '✘'})` : ROTULO_ESTADO[e]}
                          </Text>
                        </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {sub === 'historico' && (
        <View>
          {historico.length === 0
            ? <Text style={{ fontFamily: F.r, fontSize: 13, color: C.text3 }}>Nenhuma alteração registrada ainda.</Text>
            : historico.map(l => (
              <Text key={l.id} style={{ fontFamily: F.r, fontSize: 12.5, color: C.text2, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border }}>
                {descreverHistorico(l, nomes)}
              </Text>
            ))}
        </View>
      )}

      {mudancas.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.text, borderRadius: 16, padding: 12, marginTop: 8 }}>
          <Text style={{ flex: 1, fontFamily: F.s, fontSize: 13, color: '#fff' }}>
            {mudancas.length} {mudancas.length === 1 ? 'alteração não salva' : 'alterações não salvas'}
          </Text>
          <Pressable onPress={() => setRascunho({})}><Text style={{ fontFamily: F.s, color: '#fff', opacity: 0.8 }}>Descartar</Text></Pressable>
          <Pressable onPress={salvar} disabled={salvando}
            style={{ backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, opacity: salvando ? 0.6 : 1 }}>
            <Text style={{ fontFamily: F.s, color: '#fff' }}>{salvando ? 'Salvando…' : 'Salvar'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}