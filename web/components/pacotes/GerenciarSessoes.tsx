'use client';

/**
 * @file GerenciarSessoes.tsx
 * Sessões de um pacote vendido: listar, lançar avulsa, vincular atendimento concluído, editar e
 * excluir (com confirmação). Toda escrita em `pacote_uso` vai com `.select('id')` e é conferida por
 * `erroEscritaPacoteUso`: desde a 093 só escreve quem tem "pacotes.vender", ou o atendimento é dela
 * / "agenda.gerenciar_outras" — a RLS recusa devolvendo 0 linhas.
 */
import { useEffect, useState } from 'react';
import { X, Edit3, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { desfazerVinculoPacote, erroEscritaPacoteUso } from '@shared/pacotes-consultas';
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
import { mensagemErroBanco } from '@shared/erros';
import { hojeBRT } from '@shared/periodos';
import { TITULO_EXCLUIR_SESSAO, textoExcluirSessao } from '@shared/pacotes';
import { atendimentosVinculaveis } from '@shared/permissoes';

const supabase = createClient();
const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";

type PacoteUsoRow = {
  id: string;
  servico_id: string | null;
  agendamento_id: string | null;
  observacao: string | null;
  created_at: string;
  servico?: { nome: string } | null;
};
type AgConcluido = {
  id: string; data_hora_inicio: string; servico_id: string | null; profissional_id: string | null;
  /** Pacote a que o atendimento já estava ligado (ex.: combo); o desfazer volta a ele. */
  pacote_cliente_id: string | null;
  servico?: { nome: string } | null;
};

/** Pacote vendido aberto no modal. `total` null = sessões ilimitadas. */
export type PacoteParaSessoes = {
  id: string;
  cliente: { id: string; nome: string };
  pacote: { nome: string; servicos: { servico_id: string; nome: string }[] };
  total: number | null;
};

export function GerenciarSessoes({
  pc, empresaId, podeLancarAvulsa, vincularDeOutras, onChanged, onClose,
}: {
  pc:        PacoteParaSessoes;
  empresaId: string;
  /** Sessão sem atendimento só com "pacotes.vender" (acoesPacoteVendido, igual à RLS da 093). */
  podeLancarAvulsa: boolean;
  /** Sem "agenda.gerenciar_outras" só os atendimentos da própria pessoa podem ser vinculados. */
  vincularDeOutras: boolean;
  onChanged: () => void;   // recarrega a página; NÃO fecha o modal
  onClose:   () => void;
}) {
  useScrollLock();
  const servicosPac = pc.pacote.servicos;
  const servUnicoId = servicosPac.length === 1 ? servicosPac[0].servico_id : '';
  const opcServico = servicosPac.map(s => ({ value: s.servico_id, label: s.nome }));

  const [sessoes,    setSessoes]    = useState<PacoteUsoRow[]>([]);
  const [candidatos, setCandidatos] = useState<AgConcluido[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [erroCarga,  setErroCarga]  = useState<string | null>(null);
  const [erro,       setErro]       = useState('');
  const [busy,       setBusy]       = useState(false);

  // adicionar avulsa
  const [addOpen,  setAddOpen]  = useState(false);
  const [novoServ, setNovoServ] = useState(servUnicoId);
  const [novaData, setNovaData] = useState(() => hojeBRT());
  const [novaObs,  setNovaObs]  = useState('');

  // vincular atendimento
  const [vincOpen, setVincOpen] = useState(false);
  const [vincAg,   setVincAg]   = useState('');

  // edição de sessão
  const [editId,  setEditId]  = useState<string | null>(null);
  const [edServ,  setEdServ]  = useState('');
  const [edData,  setEdData]  = useState('');
  const [edObs,   setEdObs]   = useState('');

  // exclusão (com confirmação)
  const [confirmExcluir, setConfirmExcluir] = useState<PacoteUsoRow | null>(null);

  async function carregar() {
    setLoading(true); setErroCarga(null);
    const { data: { user } } = await supabase.auth.getUser();
    const [rUso, rAg, rLink] = await Promise.all([
      supabase.from('pacote_uso')
        .select('id, servico_id, agendamento_id, observacao, created_at, servico:servicos(nome)')
        .eq('pacote_cliente_id', pc.id).order('created_at', { ascending: false }),
      supabase.from('agendamentos')
        // pacote_cliente_id: o desfazer do vínculo volta ao valor anterior (atendimento de combo segue no combo).
        .select('id, data_hora_inicio, servico_id, pacote_cliente_id, profissional_id, servico:servicos(nome)')
        .eq('empresa_id', empresaId).eq('cliente_id', pc.cliente.id).eq('status', 'concluido')
        .order('data_hora_inicio', { ascending: false }).limit(100),
      // Paginada: acima de 1000 sessões vinculadas a lista cortaria e mostraria atendimentos já vinculados.
      buscarTodasOuLancar<{ agendamento_id: string }>((de, ate) => supabase.from('pacote_uso').select('agendamento_id, id')
        .eq('empresa_id', empresaId).not('agendamento_id', 'is', null).order('id').range(de, ate))
        .then(data => ({ data, error: null }), (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } })),
    ]);
    if (rUso.error) setErroCarga(mensagemErroBanco(rUso.error, 'carregar as sessões'));
    else if (rAg.error) setErroCarga(mensagemErroBanco(rAg.error, 'carregar os atendimentos da cliente'));
    else if (rLink.error) setErroCarga(mensagemErroBanco(rLink.error, 'carregar os atendimentos vinculados'));
    if (!rUso.error) setSessoes((rUso.data ?? []) as unknown as PacoteUsoRow[]);
    if (!rAg.error && !rLink.error) {
      const linkados = new Set((rLink.data ?? []).map(x => x.agendamento_id));
      const livres = ((rAg.data ?? []) as unknown as AgConcluido[]).filter(a => !linkados.has(a.id));
      setCandidatos(atendimentosVinculaveis(livres, user?.id ?? null, vincularDeOutras));
    }
    setLoading(false);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  const refresh = async () => { await carregar(); onChanged(); };

  async function addAvulsa() {
    if (opcServico.length > 1 && !novoServ) { setErro('Escolha o serviço da sessão.'); return; }
    setBusy(true); setErro('');
    const rAvulsa = await supabase.from('pacote_uso').insert({
      empresa_id:        empresaId,
      pacote_cliente_id: pc.id,
      servico_id:        novoServ || servUnicoId || null,
      observacao:        novaObs.trim() || null,
      created_at:        `${novaData}T12:00:00`,
    }).select('id');
    setBusy(false);
    const falhaAvulsa = erroEscritaPacoteUso(rAvulsa, 'lançar a sessão');
    if (falhaAvulsa) { setErro(falhaAvulsa); return; }
    setAddOpen(false); setNovaObs(''); setNovoServ(servUnicoId); setNovaData(hojeBRT());
    refresh();
  }

  async function vincularAtendimento() {
    if (!vincAg) { setErro('Escolha o atendimento.'); return; }
    const ag = candidatos.find(a => a.id === vincAg);
    if (!ag) return;
    setBusy(true); setErro('');
    // 1º o vínculo no atendimento, com .select: a policy de UPDATE de agendamentos só deixa a
    // própria agenda (ou a de outra com "agenda.gerenciar_outras"). Antes o UPDATE vinha depois
    // e sem conferência: a sessão era lançada e o atendimento seguia contando como faturamento.
    const { data: vinculados, error: e0 } = await supabase.from('agendamentos')
      .update({ pacote_cliente_id: pc.id }).eq('id', ag.id).eq('empresa_id', empresaId).select('id');
    if (e0) { setBusy(false); setErro(mensagemErroBanco(e0, 'vincular o atendimento')); return; }
    if (!vinculados || vinculados.length === 0) { setBusy(false); setErro('Você não tem permissão para alterar este atendimento.'); return; }
    const rSessao = await supabase.from('pacote_uso').insert({
      empresa_id:        empresaId,
      pacote_cliente_id: pc.id,
      servico_id:        ag.servico_id,
      agendamento_id:    ag.id,
      created_at:        ag.data_hora_inicio,
    }).select('id');
    const falhaSessao = erroEscritaPacoteUso(rSessao, 'lançar a sessão');
    if (falhaSessao) {
      // Desfaz o vínculo voltando ao pacote ANTERIOR (null tiraria um atendimento de combo do combo e o
      // faria contar como faturamento); se nem o desfazer passar, avisa para conferir o atendimento.
      const falhaDesfazer = await desfazerVinculoPacote(supabase, empresaId, ag.id, ag.pacote_cliente_id ?? null);
      setBusy(false); setErro(falhaDesfazer ?? falhaSessao);
      return;
    }
    setBusy(false); setVincOpen(false); setVincAg('');
    refresh();
  }

  function abrirEdicao(s: PacoteUsoRow) {
    setEditId(s.id);
    setEdServ(s.servico_id ?? '');
    setEdData(format(parseISO(s.created_at), 'yyyy-MM-dd'));
    setEdObs(s.observacao ?? '');
  }
  async function salvarEdicao() {
    if (!editId) return;
    setBusy(true); setErro('');
    const rEdicao = await supabase.from('pacote_uso').update({
      servico_id: edServ || null,
      observacao: edObs.trim() || null,
      created_at: `${edData}T12:00:00`,
    }).eq('id', editId).select('id');
    setBusy(false);
    const falhaEdicao = erroEscritaPacoteUso(rEdicao, 'editar a sessão');
    if (falhaEdicao) { setErro(falhaEdicao); return; }
    setEditId(null);
    refresh();
  }
  async function excluirSessao(id: string) {
    setBusy(true); setErro('');
    const rExclusao = await supabase.from('pacote_uso').delete().eq('id', id).select('id');
    setBusy(false);
    setConfirmExcluir(null);
    const falhaExclusao = erroEscritaPacoteUso(rExclusao, 'excluir a sessão');
    if (falhaExclusao) { setErro(falhaExclusao); return; }
    refresh();
  }

  const total    = pc.total;
  const usadas   = sessoes.length;
  const esgotado = total != null && usadas >= total;

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-serif text-xl text-text">Sessões</h2>
            <p className="text-xs text-text-3 mt-0.5">{pc.cliente.nome} · {pc.pacote.nome}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          <div className="bg-bg rounded-xl p-3 flex items-center justify-between border border-border">
            <span className="text-sm text-text-2">Usadas</span>
            <span className="text-lg font-bold text-text">
              {erroCarga ? '—' : usadas}{total != null ? ` / ${total}` : ' (ilimitado)'}
            </span>
          </div>

          {erroCarga && (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2 border border-red/20">
              <p className="text-sm text-red flex-1">{erroCarga}</p>
              <button onClick={carregar} className="text-xs font-bold text-primary underline flex-shrink-0">Tentar de novo</button>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col gap-2">{[1,2,3].map(i => <Sk key={i} className="h-12 rounded-xl"/>)}</div>
          ) : erroCarga ? null : sessoes.length === 0 ? (
            <p className="text-sm text-text-4 text-center py-2">Nenhuma sessão registrada.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sessoes.map(s => editId === s.id ? (
                <div key={s.id} className="bg-bg rounded-xl p-3 flex flex-col gap-2 border border-primary/30">
                  {opcServico.length > 1 && (
                    <SearchSelect options={opcServico} value={edServ} onChange={setEdServ} placeholder="Serviço" />
                  )}
                  <input type="date" value={edData} onChange={e => setEdData(e.target.value)} className={inputCls}/>
                  <input value={edObs} onChange={e => setEdObs(e.target.value)} placeholder="Observação" className={inputCls}/>
                  <div className="flex gap-2">
                    <button onClick={() => setEditId(null)} className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-surface transition">Cancelar</button>
                    <button onClick={salvarEdicao} disabled={busy} className="flex-1 h-8 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50">Salvar</button>
                  </div>
                </div>
              ) : (
                <div key={s.id} className="bg-bg rounded-xl p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text truncate">{s.servico?.nome ?? 'Sem serviço'}</p>
                    <p className="text-[11px] text-text-4">
                      {format(parseISO(s.created_at), 'dd/MM/yyyy')}
                      {' · '}{s.agendamento_id ? 'via agendamento' : 'avulsa'}
                      {s.observacao ? ` · ${s.observacao}` : ''}
                    </p>
                  </div>
                  <button onClick={() => abrirEdicao(s)} title="Editar sessão" className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-primary hover:bg-primary-soft transition"><Edit3 size={13}/></button>
                  <button onClick={() => setConfirmExcluir(s)} disabled={busy} title="Excluir sessão" className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition"><Trash2 size={13}/></button>
                </div>
              ))}
            </div>
          )}

          {erro && <p className="text-sm text-red">{erro}</p>}

          {/* Adicionar avulsa */}
          {addOpen ? (
            <div className="bg-bg rounded-xl p-3 flex flex-col gap-2 border border-border">
              <p className="text-xs font-semibold text-text-2">Nova sessão avulsa</p>
              {opcServico.length > 1 && (
                <SearchSelect options={opcServico} value={novoServ} onChange={setNovoServ} placeholder="Serviço" />
              )}
              <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)} className={inputCls}/>
              <input value={novaObs} onChange={e => setNovaObs(e.target.value)} placeholder="Observação (opcional)" className={inputCls}/>
              <div className="flex gap-2">
                <button onClick={() => setAddOpen(false)} className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-surface transition">Cancelar</button>
                <button onClick={addAvulsa} disabled={busy} className="flex-1 h-8 rounded-lg bg-green text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50">Adicionar</button>
              </div>
            </div>
          ) : podeLancarAvulsa ? (
            <button onClick={() => { setErro(''); setAddOpen(true); setVincOpen(false); }} disabled={!!erroCarga}
              className="w-full h-9 rounded-xl border border-border text-text-3 text-xs font-semibold hover:bg-bg transition disabled:opacity-40">
              + Sessão avulsa {esgotado ? '(pacote já esgotado)' : ''}
            </button>
          ) : null}

          {/* Vincular atendimento já realizado */}
          {vincOpen ? (
            <div className="bg-bg rounded-xl p-3 flex flex-col gap-2 border border-border">
              <p className="text-xs font-semibold text-text-2">Vincular atendimento concluído</p>
              {candidatos.length === 0 ? (
                <p className="text-xs text-text-4">Nenhum atendimento concluído do cliente sem vínculo.</p>
              ) : (
                <SearchSelect
                  options={candidatos.map(a => ({
                    value: a.id,
                    label: `${format(parseISO(a.data_hora_inicio), 'dd/MM/yyyy')} · ${a.servico?.nome ?? 'Serviço'}`,
                  }))}
                  value={vincAg} onChange={setVincAg}
                  placeholder="Escolher atendimento"
                />
              )}
              <div className="flex gap-2">
                <button onClick={() => setVincOpen(false)} className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-surface transition">Cancelar</button>
                <button onClick={vincularAtendimento} disabled={busy || candidatos.length === 0} className="flex-1 h-8 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50">Vincular</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setErro(''); setVincOpen(true); setAddOpen(false); }} disabled={!!erroCarga}
              className="w-full h-9 rounded-xl border border-border text-text-3 text-xs font-semibold hover:bg-bg transition disabled:opacity-40">
              Vincular atendimento já realizado
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmExcluir !== null}
        title={TITULO_EXCLUIR_SESSAO}
        message={textoExcluirSessao(!!confirmExcluir?.agendamento_id)}
        confirmLabel="Excluir sessão"
        variant="danger"
        loading={busy}
        onConfirm={() => { if (confirmExcluir) excluirSessao(confirmExcluir.id); }}
        onCancel={() => setConfirmExcluir(null)}
      />
    </div>
  );
}
