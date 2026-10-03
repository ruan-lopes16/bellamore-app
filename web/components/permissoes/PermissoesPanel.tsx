'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, History, Shield, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { SmoothTabs } from '@/components/SmoothTabs';
import { SearchSelect } from '@/components/SearchSelect';
import { SkCardList } from '@/components/Skeleton';
import { usePermissoes } from '@/components/PermissoesProvider';
import {
  CATALOGO_PERMISSOES, GRUPOS_PERMISSAO, aplicarMudancas, chaveMudanca, configVazia, contarExcecoes,
  descreverHistorico, estadoDoMembro, podeEditarAlvo, valorDoPapel,
  type ChavePermissao, type ConfigPermissoes, type EstadoExcecao, type LinhaHistorico,
  type MudancaPermissao, type Papel,
} from '@shared/permissoes';
import { carregarConfigPermissoes, carregarHistoricoPermissoes, salvarPermissoes } from '@shared/permissoes-consultas';
import { mensagemErroBanco } from '@shared/erros';

const supabase = createClient();

type Membro = { user_id: string; nome: string; role: 'owner' | 'gestor' | 'profissional' };
type SubAba = 'papel' | 'pessoa' | 'historico';

const ROTULO_ESTADO: Record<EstadoExcecao, string> = { padrao: 'Padrão', permitir: 'Permitir', bloquear: 'Bloquear' };

/** Liga/desliga no mesmo visual do ToggleLinha de Configurações. */
function Switch({ ligado, disabled, onChange, rotulo }: { ligado: boolean; disabled?: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} disabled={disabled}
      onClick={() => onChange(!ligado)}
      className={`relative w-10 h-5 rounded-full transition flex-shrink-0 ${ligado ? 'bg-primary' : 'bg-border'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${ligado ? 'left-[22px]' : 'left-0.5'}`}/>
    </button>
  );
}

/**
 * Aba Permissões de Configurações. Dona edita tudo; gestora só o papel Profissional e
 * exceções de profissionais (nunca as próprias). Alterações ficam num rascunho até "Salvar",
 * que chama a RPC salvar_permissoes (valida no banco e grava o histórico).
 */
export function PermissoesPanel({ empresaId, meuUserId, membroInicial }: { empresaId: string; meuUserId: string; membroInicial?: string }) {
  const { isOwner, papel } = usePermissoes();
  const editor = { isOwner, papel, userId: meuUserId };

  const [sub, setSub] = useState<SubAba>(membroInicial ? 'pessoa' : 'papel');
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<ConfigPermissoes>(configVazia());
  const [membros, setMembros] = useState<Membro[]>([]);
  const [historico, setHistorico] = useState<LinhaHistorico[]>([]);
  const [rascunho, setRascunho] = useState<Record<string, MudancaPermissao>>({});
  const [membroSel, setMembroSel] = useState(membroInicial ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [toast, setToast] = useState('');

  async function carregar() {
    setLoading(true); setErro('');
    try {
      const [c, h, rM] = await Promise.all([
        carregarConfigPermissoes(supabase, empresaId),
        carregarHistoricoPermissoes(supabase, empresaId),
        supabase.from('empresa_membros').select('user_id, role, user:users(nome)')
          .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional']),
      ]);
      if (rM.error) throw new Error(rM.error.message);
      setCfg(c); setHistorico(h);
      setMembros(((rM.data ?? []) as { user_id: string; role: Membro['role']; user: { nome: string } | null }[])
        .map(m => ({ user_id: m.user_id, role: m.role, nome: m.user?.nome ?? 'Sem nome' }))
        .sort((a, b) => a.nome.localeCompare(b.nome)));
    } catch (e) {
      setErro(`Não foi possível carregar as permissões: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  useEffect(() => { if (empresaId) carregar(); }, [empresaId]);

  const mudancas = useMemo(() => Object.values(rascunho), [rascunho]);
  const visivel = useMemo(() => aplicarMudancas(cfg, mudancas), [cfg, mudancas]);
  const nomes = useMemo(() => Object.fromEntries(membros.map(m => [m.user_id, m.nome])), [membros]);
  const membrosEditaveis = membros.filter(m => podeEditarAlvo(editor, { tipo: 'membro', userId: m.user_id, papel: m.role }));
  // Só alvos que a pessoa pode editar (o membro da URL pode ser ela mesma ou outra gestora).
  const membroAtual = membrosEditaveis.find(m => m.user_id === membroSel);

  function mudar(m: MudancaPermissao) {
    setRascunho(prev => {
      const k = chaveMudanca(m);
      // Voltar ao valor gravado remove a mudança do rascunho (não conta como "não salva").
      const igualAoGravado = m.tipo === 'papel'
        ? valorDoPapel(cfg, m.alvo, m.chave) === m.permitido
        : (cfg.membros[m.alvo]?.[m.chave] ?? null) === m.permitido;
      const prox = { ...prev };
      if (igualAoGravado) delete prox[k]; else prox[k] = m;
      return prox;
    });
  }

  async function salvar() {
    setSalvando(true); setErro('');
    const { error } = await salvarPermissoes(supabase, empresaId, mudancas);
    setSalvando(false);
    if (error) { setErro(mensagemErroBanco(error, 'alterar estas permissões')); return; }
    setRascunho({});
    setToast('Permissões salvas'); setTimeout(() => setToast(''), 3000);
    await carregar();
  }

  if (loading) return <SkCardList count={4}/>;

  return (
    <div className="max-w-3xl flex flex-col gap-5">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm">
          <Check size={16} strokeWidth={2.5}/> {toast}
        </div>
      )}

      <SmoothTabs
        tabs={[{ key: 'papel', label: 'Por papel' }, { key: 'pessoa', label: 'Por pessoa' }, { key: 'historico', label: 'Histórico' }]}
        active={sub}
        onChange={k => setSub(k as SubAba)}
      />

      {erro && <p className="text-sm text-rose bg-rose-soft rounded-xl px-4 py-3">{erro}</p>}

      {sub === 'papel' && (
        <div className="flex flex-col gap-4">
          {!isOwner && (
            <p className="text-xs text-text-3">Como gestora, você altera só o papel Profissional. A coluna Gestora é somente leitura.</p>
          )}
          {GRUPOS_PERMISSAO.map(grupo => (
            <section key={grupo} className="bg-surface border border-border rounded-2xl overflow-hidden">
              <header className="flex items-center px-4 py-2.5 bg-bg2 text-[11px] font-bold uppercase tracking-wide text-text-3">
                <span className="flex-1">{grupo}</span>
                <span className="w-20 text-center">Gestora</span>
                <span className="w-20 text-center">Profissional</span>
              </header>
              {CATALOGO_PERMISSOES.filter(p => p.grupo === grupo).map(p => (
                <div key={p.chave} className="flex items-center gap-2 px-4 py-3 border-t border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text">{p.rotulo}</p>
                    {p.descricao && <p className="text-[11.5px] text-text-3">{p.descricao}</p>}
                  </div>
                  {(['gestor', 'profissional'] as Papel[]).map(pp => (
                    <div key={pp} className="w-20 flex justify-center">
                      <Switch rotulo={`${p.rotulo} — ${pp === 'gestor' ? 'Gestora' : 'Profissional'}`}
                        ligado={valorDoPapel(visivel, pp, p.chave)}
                        disabled={!podeEditarAlvo(editor, { tipo: 'papel', papel: pp })}
                        onChange={v => mudar({ tipo: 'papel', alvo: pp, chave: p.chave, permitido: v })}/>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {sub === 'pessoa' && (
        <div className="flex flex-col gap-4">
          <SearchSelect
            options={membrosEditaveis.map(m => {
              const n = contarExcecoes(visivel, m.user_id);
              return { value: m.user_id, label: m.nome, sub: `${m.role === 'gestor' ? 'Gestora' : 'Profissional'}${n ? ` · ${n} ${n === 1 ? 'exceção' : 'exceções'}` : ''}` };
            })}
            value={membroSel}
            onChange={setMembroSel}
            placeholder="Escolha alguém da equipe..."
          />
          {membrosEditaveis.length === 0 && (
            <p className="text-sm text-text-3">Ninguém da equipe que você possa ajustar individualmente.</p>
          )}
          {membroAtual && membroAtual.role !== 'owner' && GRUPOS_PERMISSAO.map(grupo => (
            <section key={grupo} className="bg-surface border border-border rounded-2xl overflow-hidden">
              <header className="px-4 py-2.5 bg-bg2 text-[11px] font-bold uppercase tracking-wide text-text-3">{grupo}</header>
              {CATALOGO_PERMISSOES.filter(p => p.grupo === grupo).map(p => {
                const papelAlvo = membroAtual.role as Papel;
                const estado = estadoDoMembro(visivel, membroAtual.user_id, p.chave as ChavePermissao);
                const padrao = valorDoPapel(visivel, papelAlvo, p.chave);
                return (
                  <div key={p.chave} className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-border">
                    <p className="flex-1 min-w-[180px] text-[13px] font-semibold text-text">{p.rotulo}</p>
                    <div className="flex gap-1">
                      {(['padrao', 'permitir', 'bloquear'] as EstadoExcecao[]).map(e => (
                        <button key={e} type="button"
                          onClick={() => mudar({ tipo: 'membro', alvo: membroAtual.user_id, chave: p.chave, permitido: e === 'padrao' ? null : e === 'permitir' })}
                          className={`press px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition ${estado === e ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2'}`}>
                          {e === 'padrao' ? `${ROTULO_ESTADO[e]} (${padrao ? '✔' : '✘'})` : ROTULO_ESTADO[e]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
          {!membroAtual && membrosEditaveis.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-text-3"><User size={14}/> Escolha uma pessoa para ver e ajustar as exceções dela.</p>
          )}
        </div>
      )}

      {sub === 'historico' && (
        <div className="bg-surface border border-border rounded-2xl">
          {historico.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-text-3"><History size={14}/> Nenhuma alteração registrada ainda.</p>
          ) : historico.map(l => (
            <p key={l.id} className="px-4 py-2.5 border-t first:border-t-0 border-border text-[12.5px] text-text-2">
              {descreverHistorico(l, nomes)}
            </p>
          ))}
        </div>
      )}

      {mudancas.length > 0 && (
        <div className="sticky bottom-[calc(var(--bm-mobile-content-bottom)+8px)] lg:bottom-4 z-30 flex flex-wrap items-center gap-3 bg-ink text-white rounded-2xl px-4 py-3 shadow-lg">
          <Shield size={16}/>
          <span className="flex-1 text-sm font-semibold">
            {mudancas.length} {mudancas.length === 1 ? 'alteração não salva' : 'alterações não salvas'}
          </span>
          <button type="button" onClick={() => setRascunho({})} className="press text-sm font-semibold opacity-80">Descartar</button>
          <button type="button" onClick={salvar} disabled={salvando}
            className="press bg-primary text-white text-sm font-semibold px-4 py-1.5 rounded-xl disabled:opacity-60">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  );
}
