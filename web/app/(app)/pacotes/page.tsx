'use client';

/**
 * @file pacotes/page.tsx
 * Módulo de Pacotes — catálogo, vendidos e relatório de utilização (Paridade Serviços e Pacotes).
 *
 * ## Abas
 * - Catálogo  : cadastro (PacoteForm) e venda (VenderPacoteModal) dos pacotes
 * - Vendidos  : pacotes das clientes; filtros Todos, Ativos, Concluídos, Expirados e "A cobrar"
 * - Relatório : utilização e receita (RelatorioPacotes), carregado só ao abrir a aba
 *
 * ## Regras (as mesmas do app)
 * - cargas paginadas e com erro conferido: shared/pacotes-consultas.ts (erro → "—" e aviso, nunca zeros)
 * - validade, saldo e status exibido: shared/pacotes.ts (statusPacoteCliente, saldoSessoes, rotuloValidade)
 * - venda: VenderPacoteModal → venderPacote (096), "Cobrar agora" ou "Cobrar na comanda"
 * - excluir vendido: excluirPacoteCliente (096); sem a 096, o caminho antigo conferido (lib/pacotes-web.ts)
 * - permissões: catálogo `pacotes.gerenciar`; vender e excluir vendido `pacotes.vender`; sessões
 *   `pacotes.vender` ou `agenda.gerenciar_outras` (a RLS da 093 confere cada escrita)
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, X, Trash2, Edit3, Check, Gift, Users, AlertCircle, Tag } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { usePermissoes } from '@/components/PermissoesProvider';
import { ExportButton } from '@/components/ExportButton';
import { Sk } from '@/components/Skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SmoothTabs } from '@/components/SmoothTabs';
import { PacoteForm } from '@/components/pacotes/PacoteForm';
import { VenderPacoteModal } from '@/components/pacotes/VenderPacoteModal';
import { GerenciarSessoes, type PacoteParaSessoes } from '@/components/pacotes/GerenciarSessoes';
import { RelatorioPacotes } from '@/components/pacotes/RelatorioPacotes';
import {
  detectarMigration096, excluirVendidoSem096, filtrarVendidos, marcarComboUtilizado, type FiltroVendidos,
} from '@/lib/pacotes-web';
import { definicaoPacotesCatalogo, definicaoPacotesVendidos, definicaoPacotesUtilizacao } from '@shared/exportacao/pacotes';
import { formatarMoeda as fmtBRL } from '@shared/moeda';
import {
  carregarCatalogoPacotes, carregarPacotesVendidos, carregarRelatorioUtilizacao,
  type PacoteCatalogo, type PacoteVendido, type RelatorioUtilizacao,
} from '@shared/pacotes-consultas';
import { excluirPacoteCliente, ErroPacote, SemMigration096 } from '@shared/pacotes-venda';
import { rotuloValidade, saldoSessoes, statusPacoteCliente, totalSessoes, type StatusPacoteCliente } from '@shared/pacotes';
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
import { mensagemErroBanco } from '@shared/erros';
import { hojeBRT } from '@shared/periodos';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type Servico = { id: string; nome: string; preco: number };

/** Pacote vendido com o status exibido e o saldo calculados pela regra única. */
type Vendido = PacoteVendido & {
  statusExibido: StatusPacoteCliente;
  /** null = ilimitado; combo não usa. */
  total: number | null;
  usadas: number;
};

const STATUS_CFG: Record<StatusPacoteCliente, { label: string; cls: string }> = {
  ativo:     { label: 'Ativo',     cls: 'bg-green-soft text-green'     },
  concluido: { label: 'Concluído', cls: 'bg-primary-soft text-primary' },
  expirado:  { label: 'Expirado',  cls: 'bg-red-soft text-red'         },
  cancelado: { label: 'Cancelado', cls: 'bg-bg text-text-3'            },
};

const fmtData = (d: string | null) => (d ? format(parseISO(d), 'dd/MM/yyyy') : 'Sem validade');
const msgErro = (e: unknown, acao: string) =>
  e instanceof ErroPacote ? e.message : mensagemErroBanco(e as { code?: string; message?: string }, acao);

function enriquecer(v: PacoteVendido, hoje: string): Vendido {
  const combo = !v.pacote.controla_sessoes;
  const saldo = saldoSessoes(v.pacote.servicos, v.usos, combo);
  return {
    ...v,
    statusExibido: statusPacoteCliente({ data_validade: v.data_validade, status: v.status, combo }, saldo, v.usos.length, hoje),
    total: combo ? null : totalSessoes(v.pacote.servicos),
    usadas: v.usos.length,
  };
}

// ── Página principal ──────────────────────────────────────────

export default function PacotesPage() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [aba,       setAba]       = useState<'catalogo' | 'vendidos' | 'relatorio'>('catalogo');

  const { pode } = usePermissoes();
  const podeGerenciarCatalogo = pode('pacotes.gerenciar');
  const podeVender = pode('pacotes.vender');
  // Sessões: quem vende pacote ou mexe na agenda das outras (a RLS também libera a própria agenda).
  const podeSessoes = podeVender || pode('agenda.gerenciar_outras');

  // Dados (null = não carregou: erro mostra "—", nunca zero)
  const [pacotes,   setPacotes]   = useState<PacoteCatalogo[] | null>(null);
  const [vendidosRaw, setVendidosRaw] = useState<PacoteVendido[] | null>(null);
  const [servicos,  setServicos]  = useState<Servico[]>([]);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [tem096,    setTem096]    = useState<boolean | null | undefined>(undefined);
  const reqRef = useRef(0);

  // Relatório (carregado só com a aba aberta)
  const [relatorio, setRelatorio] = useState<RelatorioUtilizacao | null>(null);
  const [relLoading, setRelLoading] = useState(false);
  const [relErro, setRelErro] = useState<string | null>(null);
  const [relVersao, setRelVersao] = useState(0);

  const [filtroStatus, setFiltroStatus] = useState<FiltroVendidos>('todos');

  // Modais
  const [modalPacote,  setModalPacote]  = useState<PacoteCatalogo | 'novo' | null>(null);
  const [modalVender,  setModalVender]  = useState<PacoteCatalogo | null>(null);
  const [modalSessao,  setModalSessao]  = useState<PacoteParaSessoes | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<PacoteCatalogo | null>(null);
  const [confirmExcluirVenda, setConfirmExcluirVenda] = useState<Vendido | null>(null);
  const [excluindo,      setExcluindo]      = useState(false);
  const [marcando,       setMarcando]       = useState<string | null>(null);

  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'rose' } | null>(null);
  function showToast(msg: string, tone: 'green' | 'rose' = 'green') {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 4000);
  }

  // ── Empresa
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (data) setEmpresaId(data.empresa_id);
    })();
    detectarMigration096(supabase).then(setTem096);
  }, []);

  // ── Cargas (contador de requisição: resposta antiga nunca sobrescreve a nova)
  const carregar = useCallback(async (empId: string) => {
    const req = ++reqRef.current;
    setLoading(true);
    const [rPac, rVend, rServ] = await Promise.allSettled([
      carregarCatalogoPacotes(supabase, empId),
      carregarPacotesVendidos(supabase, empId),
      buscarTodasOuLancar<Servico>((de, ate) => supabase.from('servicos').select('id, nome, preco')
        .eq('empresa_id', empId).eq('ativo', true).order('nome').order('id').range(de, ate)),
    ]);
    if (req !== reqRef.current) return;
    const falha = (r: PromiseSettledResult<unknown>, acao: string) =>
      r.status === 'rejected' ? mensagemErroBanco(r.reason as { message?: string }, acao) : null;
    setErroCarga(falha(rPac, 'carregar os pacotes') ?? falha(rVend, 'carregar os pacotes vendidos') ?? falha(rServ, 'carregar os serviços'));
    setPacotes(rPac.status === 'fulfilled' ? rPac.value : null);
    setVendidosRaw(rVend.status === 'fulfilled' ? rVend.value : null);
    if (rServ.status === 'fulfilled') setServicos(rServ.value);
    setLoading(false);
    setRelVersao(v => v + 1);
  }, []);

  useEffect(() => { if (empresaId) carregar(empresaId); }, [empresaId, carregar]);

  // ── Relatório: só com a aba aberta (e recarrega depois de cada mudança)
  useEffect(() => {
    if (aba !== 'relatorio' || !empresaId) return;
    let vivo = true;
    setRelLoading(true);
    carregarRelatorioUtilizacao(supabase, empresaId)
      .then(r => { if (vivo) { setRelatorio(r); setRelErro(null); } })
      .catch(e => { if (vivo) { setRelatorio(null); setRelErro(mensagemErroBanco(e as { message?: string }, 'carregar o relatório')); } })
      .finally(() => { if (vivo) setRelLoading(false); });
    return () => { vivo = false; };
  }, [aba, empresaId, relVersao]);

  const recarregar = () => { if (empresaId) carregar(empresaId); };

  // ── Vendidos com status/saldo da regra única
  const vendidos = useMemo<Vendido[] | null>(() => {
    if (!vendidosRaw) return null;
    const hoje = hojeBRT();
    return vendidosRaw.map(v => enriquecer(v, hoje));
  }, [vendidosRaw]);
  const listaVendidos = vendidos ?? [];
  const vendidosFiltrados = useMemo(() => filtrarVendidos(listaVendidos, filtroStatus), [listaVendidos, filtroStatus]);
  const conta = (f: FiltroVendidos) => (vendidos ? String(filtrarVendidos(vendidos, f).length) : '—');

  // ── Stats ("—" com erro)
  const stat = (v: number | null) => (v == null ? '—' : String(v));
  const totalAtivos   = pacotes ? pacotes.filter(p => p.ativo).length : null;
  const totalVendidos = vendidos ? vendidos.length : null;
  const emAndamento   = vendidos ? vendidos.filter(v => v.statusExibido === 'ativo').length : null;
  const sessoesRestantes = vendidos
    ? vendidos.filter(v => v.statusExibido === 'ativo' && v.total != null).reduce((s, v) => s + Math.max(0, (v.total ?? 0) - v.usadas), 0)
    : null;

  // ── Catálogo
  async function toggleAtivo(p: PacoteCatalogo) {
    if (!empresaId) return;
    const { data: alterados, error } = await supabase.from('pacotes').update({ ativo: !p.ativo })
      .eq('id', p.id).eq('empresa_id', empresaId).select('id');
    if (error || !alterados || alterados.length === 0) {
      showToast(mensagemErroBanco(error ?? { code: '42501' }, 'alterar o pacote'), 'rose');
      return;
    }
    recarregar();
  }

  function pedirExclusao(p: PacoteCatalogo) {
    if (!vendidos) { showToast('Não foi possível conferir se o pacote já foi vendido. Recarregue a tela.', 'rose'); return; }
    if (vendidos.some(v => v.pacote.id === p.id)) { showToast('Pacote já foi vendido — desative em vez de excluir.', 'rose'); return; }
    setConfirmExcluir(p);
  }
  async function excluirPacote() {
    if (!empresaId || !confirmExcluir) return;
    setExcluindo(true);
    const { data: apagados, error } = await supabase.from('pacotes')
      .delete().eq('id', confirmExcluir.id).eq('empresa_id', empresaId).select('id');
    setExcluindo(false);
    setConfirmExcluir(null);
    if (error || !apagados || apagados.length === 0) { showToast(mensagemErroBanco(error ?? { code: '42501' }, 'excluir o pacote'), 'rose'); return; }
    showToast('Pacote excluído.');
    recarregar();
  }

  // ── Excluir pacote vendido: pela função (096), que acerta a venda ligada; sem ela, o caminho antigo.
  function pedirExclusaoVenda(v: Vendido) {
    if (v.usadas > 0) { showToast('Este pacote já tem sessões usadas. Para cancelar, fale com a dona.', 'rose'); return; }
    setConfirmExcluirVenda(v);
  }
  async function excluirVenda() {
    if (!empresaId || !confirmExcluirVenda) return;
    const id = confirmExcluirVenda.id;
    setExcluindo(true);
    try {
      try {
        await excluirPacoteCliente(supabase, empresaId, id);
      } catch (e) {
        if (!(e instanceof SemMigration096)) throw e;
        await excluirVendidoSem096(supabase, empresaId, id);
      }
      showToast('Pacote vendido excluído.');
      recarregar();
    } catch (e) {
      showToast(msgErro(e, 'excluir o pacote vendido'), 'rose');
    } finally {
      setExcluindo(false);
      setConfirmExcluirVenda(null);
    }
  }

  // ── Combo utilizado (sem flip otimista: só muda depois que o banco confirmou)
  async function marcarCombo(id: string) {
    if (!empresaId || marcando) return;
    setMarcando(id);
    const falha = await marcarComboUtilizado(supabase, empresaId, id);
    setMarcando(null);
    if (falha) { showToast(falha, 'rose'); return; }
    recarregar();
  }

  const abrirSessoes = (v: Vendido) => setModalSessao({
    id: v.id, cliente: v.cliente, total: v.total,
    pacote: { nome: v.pacote.nome, servicos: v.pacote.servicos.map(s => ({ servico_id: s.servico_id, nome: s.nome })) },
  });

  // ── Render
  return (
    <div className="bm-page">
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none max-w-[92vw] ${toast.tone === 'green' ? 'bg-green' : 'bg-red'}`}>
          {toast.tone === 'green' ? <Check size={16} strokeWidth={2.5}/> : <AlertCircle size={16} strokeWidth={2.5}/>} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Fidelização</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Pacotes</h1>
        </div>
        <div className="flex items-center gap-2 bm-mobile-page-actions">
          {aba === 'catalogo' && pacotes && (
            <ExportButton
              variant="mobileHeader"
              className="bm-mobile-header-export"
              definicao={definicaoPacotesCatalogo()}
              getLinhas={() => pacotes.map(p => ({ nome: p.nome, preco: p.preco, validadeDias: p.validade_dias, servicos: p.servicos.map(s => ({ nome: s.nome, quantidade: s.quantidade })), ativo: p.ativo }))}
            />
          )}
          {aba === 'vendidos' && vendidos && (
            <ExportButton
              variant="mobileHeader"
              className="bm-mobile-header-export"
              definicao={definicaoPacotesVendidos()}
              getLinhas={() => vendidosFiltrados.map(v => ({ cliente: v.cliente.nome, pacote: v.pacote.nome, usadas: v.usadas, totalSessoes: v.total, valorPago: v.valor_pago, inicio: v.data_inicio, validade: v.data_validade, status: v.cobranca === 'pendente' ? `${STATUS_CFG[v.statusExibido].label} · A cobrar` : STATUS_CFG[v.statusExibido].label }))}
            />
          )}
          {aba === 'relatorio' && relatorio && (
            <ExportButton
              variant="mobileHeader"
              className="bm-mobile-header-export"
              definicao={definicaoPacotesUtilizacao()}
              getLinhas={() => relatorio?.porPacote ?? []}
            />
          )}
          {podeGerenciarCatalogo && (
            <button onClick={() => setModalPacote('novo')}
              className="flex items-center gap-2 h-10 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition shadow-sm">
              <Plus size={16}/> Novo pacote
            </button>
          )}
        </div>
      </div>

      {erroCarga && (
        <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20 mb-4">
          <AlertCircle size={14} className="text-red flex-shrink-0"/>
          <p className="text-sm text-red flex-1">{erroCarga}</p>
          <button onClick={recarregar} className="text-xs font-bold text-primary underline flex-shrink-0">Tentar de novo</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {loading ? [1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
            <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/><div className="flex flex-col gap-2 flex-1"><Sk className="h-5 w-12"/><Sk className="h-3 w-24"/></div>
          </div>
        )) : [
          { icon: Gift,  label: 'Pacotes ativos',    v: stat(totalAtivos),   color: 'var(--color-primary)', bg: 'var(--color-primary-soft)' },
          { icon: Users, label: 'Vendas realizadas', v: stat(totalVendidos), color: 'var(--color-green)',   bg: 'var(--color-green-soft)'   },
          { icon: Check, label: 'Em andamento',      v: stat(emAndamento),   color: 'var(--color-accent)',  bg: 'var(--color-accent-soft)'  },
        ].map(({ icon: Icon, label, v, color, bg }, idx) => (
          <div key={label} className="bm-stagger"
            style={{ '--bm-i': idx, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={16} style={{ color }} strokeWidth={2}/>
            </div>
            <div>
              <p style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: 'var(--color-ink)', fontFamily: 'var(--font-sans)' }}>{v}</p>
              <p style={{ fontSize: 11.5, color: 'var(--color-ink3)', marginTop: 2, fontWeight: 500 }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Abas */}
      <SmoothTabs
        variant="underline"
        className="mb-6"
        tabs={[
          { key: 'catalogo',  label: 'Catálogo' },
          { key: 'vendidos',  label: `Vendidos (${stat(totalVendidos)})` },
          { key: 'relatorio', label: 'Relatório' },
        ]}
        active={aba}
        onChange={key => setAba(key as typeof aba)}
      />

      {/* ══════════ TAB: CATÁLOGO ══════════ */}
      {aba === 'catalogo' && (
        loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <Sk key={i} className="h-48 rounded-2xl"/>)}
          </div>
        ) : !pacotes ? null : pacotes.length === 0 ? (
          <div className="text-center py-16">
            <Gift size={36} className="mx-auto mb-3 text-text-4"/>
            <p className="text-text-3 text-sm">Nenhum pacote criado ainda.</p>
            {podeGerenciarCatalogo && (
              <button onClick={() => setModalPacote('novo')}
                className="mt-4 px-5 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition">
                Criar primeiro pacote
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pacotes.map((p, idx) => {
              const total = totalSessoes(p.servicos);
              return (
                <div key={p.id} className={`bm-stagger bg-surface border rounded-2xl p-5 shadow-sm flex flex-col gap-3 transition ${!p.ativo ? 'opacity-60 border-border' : 'border-border hover:border-accent/40'}`}
                  style={{ '--bm-i': idx, '--bm-step': '60ms' } as React.CSSProperties}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-text">{p.nome}</h3>
                      <p className="text-xs text-text-3 mt-0.5">{rotuloValidade(p.validade_dias)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.ativo ? 'bg-green-soft text-green' : 'bg-bg text-text-4'}`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {!p.controla_sessoes && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent-soft text-accent">Combo</span>
                      )}
                    </div>
                  </div>

                  <p className="text-2xl font-bold text-text" style={{ letterSpacing: '-0.02em' }}>{fmtBRL(p.preco)}</p>

                  <div className="flex flex-col gap-1 flex-1">
                    {p.servicos.length === 0 ? (
                      <p className="text-xs text-text-4">Nenhum serviço vinculado</p>
                    ) : p.servicos.map(s => (
                      <div key={s.servico_id} className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"/>
                        <span className="text-xs text-text-2 truncate">{s.nome}</span>
                        <span className="text-xs text-text-4 ml-auto flex-shrink-0">{s.quantidade ?? '∞'}×</span>
                      </div>
                    ))}
                    {!p.controla_sessoes ? null : total == null ? (
                      <p className="text-xs font-semibold text-primary mt-1">Sessões ilimitadas</p>
                    ) : total > 0 && (
                      <p className="text-xs font-semibold text-text-3 mt-1">{total} sessões no total</p>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-border">
                    {podeVender && (
                      <button
                        onClick={() => p.ativo && p.servicos.length > 0 && setModalVender(p)}
                        disabled={!p.ativo || p.servicos.length === 0}
                        title={p.servicos.length === 0 ? 'Adicione serviços antes de vender' : ''}
                        className="flex-1 h-8 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition disabled:opacity-40">
                        {p.servicos.length === 0 ? '⚠ Sem serviços' : 'Vender'}
                      </button>
                    )}
                    {podeGerenciarCatalogo && (
                      <>
                        <button onClick={() => setModalPacote(p)} title="Editar pacote"
                          className="w-8 h-8 rounded-lg border border-border hover:bg-bg flex items-center justify-center text-text-3 transition">
                          <Edit3 size={13}/>
                        </button>
                        <button onClick={() => toggleAtivo(p)} title={p.ativo ? 'Desativar' : 'Reativar'}
                          className="w-8 h-8 rounded-lg border border-border hover:bg-bg flex items-center justify-center text-text-3 transition">
                          {p.ativo ? <X size={13}/> : <Check size={13}/>}
                        </button>
                        <button onClick={() => pedirExclusao(p)} title="Excluir pacote"
                          className="w-8 h-8 rounded-lg border border-border hover:bg-red-soft hover:border-red/30 flex items-center justify-center text-text-3 hover:text-red transition">
                          <Trash2 size={13}/>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ══════════ TAB: VENDIDOS ══════════ */}
      {aba === 'vendidos' && (
        <div>
          <div className="overflow-x-auto mb-4 -mx-1 px-1">
            <SmoothTabs
              variant="pill"
              tabs={[
                { key: 'todos',     label: `Todos (${conta('todos')})`           },
                { key: 'ativo',     label: `Ativos (${conta('ativo')})`          },
                { key: 'concluido', label: `Concluídos (${conta('concluido')})`  },
                { key: 'expirado',  label: `Expirados (${conta('expirado')})`    },
                { key: 'a_cobrar',  label: `A cobrar (${conta('a_cobrar')})`     },
              ]}
              active={filtroStatus}
              onChange={k => setFiltroStatus(k as FiltroVendidos)}
            />
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1,2,3,4].map(i => <Sk key={i} className="h-52 rounded-2xl"/>)}
            </div>
          ) : !vendidos ? null : vendidosFiltrados.length === 0 ? (
            <div className="text-center py-12">
              <Tag size={28} className="mx-auto mb-2 text-text-4"/>
              <p className="text-sm text-text-3">
                {filtroStatus === 'a_cobrar' ? 'Nenhum pacote a cobrar' : filtroStatus !== 'todos' ? 'Nenhum pacote neste filtro' : 'Nenhuma venda registrada ainda'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vendidosFiltrados.map((v, idx) => {
                const ilimitado = v.total === null;
                const pct       = v.total != null && v.total > 0 ? (v.usadas / v.total) * 100 : 0;
                const statusCfg = STATUS_CFG[v.statusExibido];
                const restantes = v.total != null ? Math.max(0, v.total - v.usadas) : null;
                const corBarra  = pct >= 100 ? '#16A34A' : pct >= 70 ? '#D97706' : '#7C3AED';
                const aCobrar   = v.cobranca === 'pendente';

                return (
                  <div key={v.id} className="bm-stagger bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4"
                    style={{ '--bm-i': idx, '--bm-step': '60ms' } as React.CSSProperties}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-text truncate">{v.cliente.nome}</p>
                        <p className="text-xs text-text-3 mt-0.5 truncate">{v.pacote.nome}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {aCobrar && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-soft text-amber" title="Será cobrado ao fechar a comanda da cliente">A cobrar</span>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${statusCfg.cls}`}>{statusCfg.label}</span>
                        {podeVender && (
                          <button onClick={() => pedirExclusaoVenda(v)} title="Excluir pacote vendido"
                            className="w-7 h-7 rounded-lg border border-border hover:bg-red-soft hover:border-red/30 flex items-center justify-center text-text-3 hover:text-red transition">
                            <Trash2 size={12}/>
                          </button>
                        )}
                      </div>
                    </div>

                    {!v.pacote.controla_sessoes ? (
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex self-start text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent-soft text-accent mb-1">Combo</span>
                        {v.pacote.servicos.length === 0 ? (
                          <p className="text-xs text-text-4">Nenhum serviço vinculado</p>
                        ) : v.pacote.servicos.map(s => (
                          <div key={s.servico_id} className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"/>
                            <span className="text-xs text-text-2 truncate">{s.nome}</span>
                            <span className="text-xs text-text-4 ml-auto flex-shrink-0">{s.quantidade ?? '∞'}×</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-end justify-between mb-2">
                          <div>
                            <span className="text-3xl font-bold text-text">{v.usadas}</span>
                            <span className="text-lg text-text-3">/{ilimitado ? '∞' : v.total}</span>
                            <span className="text-xs text-text-3 ml-1.5">sessões</span>
                          </div>
                          {ilimitado && v.statusExibido === 'ativo' && (
                            <span className="text-xs font-semibold text-primary">Ilimitado</span>
                          )}
                          {restantes !== null && restantes > 0 && v.statusExibido === 'ativo' && (
                            <span className="text-xs font-semibold text-text-3">{restantes} restante{restantes !== 1 ? 's' : ''}</span>
                          )}
                          {!ilimitado && pct >= 100 && (
                            <span className="text-xs font-bold text-green flex items-center gap-1"><Check size={11} strokeWidth={3}/>Concluído</span>
                          )}
                        </div>
                        {ilimitado ? (
                          <div className="h-2.5 rounded-full" style={{ background: 'var(--color-primary-soft)' }}/>
                        ) : (v.total ?? 0) > 0 ? (
                          <div className="h-2.5 bg-bg rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: corBarra }}/>
                          </div>
                        ) : (
                          <div className="h-2.5 bg-bg rounded-full"/>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-bg rounded-xl p-3">
                        <p className="text-[10px] text-text-3 uppercase tracking-wide mb-0.5">Válido até</p>
                        <p className="text-sm font-semibold text-text">{fmtData(v.data_validade)}</p>
                      </div>
                      <div className="bg-bg rounded-xl p-3">
                        <p className="text-[10px] text-text-3 uppercase tracking-wide mb-0.5">{aCobrar ? 'Valor a cobrar' : 'Valor pago'}</p>
                        <p className="text-sm font-semibold text-text">{v.valor_pago != null ? fmtBRL(v.valor_pago) : '—'}</p>
                      </div>
                    </div>

                    {v.statusExibido === 'ativo' && !v.pacote.controla_sessoes && podeVender && (
                      <button onClick={() => marcarCombo(v.id)} disabled={marcando === v.id}
                        className="w-full h-9 rounded-xl bg-green text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50">
                        {marcando === v.id ? 'Salvando...' : 'Marcar como utilizado'}
                      </button>
                    )}
                    {v.pacote.controla_sessoes && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[10px] text-text-4 text-center">Sessões são registradas automaticamente ao concluir agendamentos.</p>
                        {podeSessoes && (
                          <button onClick={() => abrirSessoes(v)}
                            className="w-full h-8 rounded-xl border border-border text-text-3 text-xs font-semibold hover:bg-bg transition">
                            Gerenciar sessões
                          </button>
                        )}
                      </div>
                    )}
                    {v.observacao && (
                      <p className="text-xs text-text-4 italic -mt-2">&quot;{v.observacao}&quot;</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════ TAB: RELATÓRIO ══════════ */}
      {aba === 'relatorio' && (
        <RelatorioPacotes
          relatorio={relatorio}
          loading={relLoading}
          erro={relErro}
          sessoesRestantes={sessoesRestantes}
          onTentarDeNovo={() => setRelVersao(v => v + 1)}
        />
      )}

      {/* ── Modais ── */}
      {modalPacote !== null && empresaId && (
        <PacoteForm
          pacote={modalPacote === 'novo' ? null : modalPacote}
          jaVendido={modalPacote !== 'novo' && !!vendidos && vendidos.some(v => v.pacote.id === modalPacote.id)}
          vendidosIndisponivel={!vendidos}
          servicos={servicos}
          empresaId={empresaId}
          onClose={() => setModalPacote(null)}
          onSalvo={() => { setModalPacote(null); recarregar(); }}
        />
      )}

      {modalVender && empresaId && (
        <VenderPacoteModal
          empresaId={empresaId}
          pacotes={[modalVender]}
          pacoteInicialId={modalVender.id}
          padraoCobranca="agora"
          tem096={tem096}
          onClose={() => setModalVender(null)}
          onVendido={r => {
            setModalVender(null);
            recarregar();
            setAba('vendidos');
            if (r.cobranca === 'comanda') setFiltroStatus('a_cobrar');
            if (r.aviso) showToast(r.aviso, 'rose');
          }}
        />
      )}

      {modalSessao && empresaId && (
        <GerenciarSessoes
          pc={modalSessao}
          empresaId={empresaId}
          onChanged={recarregar}
          onClose={() => setModalSessao(null)}
        />
      )}

      <ConfirmDialog
        open={confirmExcluir !== null}
        title="Excluir pacote?"
        message={`"${confirmExcluir?.nome}" será removido permanentemente do catálogo. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        variant="danger"
        loading={excluindo}
        onConfirm={excluirPacote}
        onCancel={() => setConfirmExcluir(null)}
      />

      <ConfirmDialog
        open={confirmExcluirVenda !== null}
        title="Excluir pacote vendido?"
        message={confirmExcluirVenda?.cobranca === 'pendente'
          ? `O pacote "${confirmExcluirVenda?.pacote.nome}" a cobrar de ${confirmExcluirVenda?.cliente.nome} será excluído e não entrará mais na comanda. Sem volta.`
          : `O pacote "${confirmExcluirVenda?.pacote.nome}" de ${confirmExcluirVenda?.cliente.nome} será excluído. Se ele foi cobrado sozinho, a venda e o pagamento saem do faturamento; com outros pacotes na mesma venda, só o valor dele sai (a devolução é manual). Atendimentos vinculados serão desvinculados. Sem volta.`}
        confirmLabel="Excluir"
        variant="danger"
        loading={excluindo}
        onConfirm={excluirVenda}
        onCancel={() => setConfirmExcluirVenda(null)}
      />
    </div>
  );
}
