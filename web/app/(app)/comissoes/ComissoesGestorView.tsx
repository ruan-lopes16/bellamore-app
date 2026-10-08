'use client';

/**
 * @file comissoes/ComissoesGestorView.tsx
 * Comissões da equipe. Fonte, períodos e regras ÚNICOS, os mesmos do app
 * (mobile/app/(empresa)/comissoes.tsx): carregarComissoesDoPeriodo (created_at
 * em Brasília), PERIODOS_COMISSAO, @shared/comissoes. "Pagar" = só as
 * pendentes do período exibido.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Banknote, CircleCheck, X, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { Sk } from '@/components/Skeleton';
import { Secret, PrivacyToggle } from '@/components/privacy';
import { usePermissoes } from '@/components/PermissoesProvider';
import { ExportButton } from '@/components/ExportButton';
import { definicaoComissoes, type LinhaComissao } from '@shared/exportacao/comissoes';
import { CategoriaIcon, CategoriaIconCustom } from '@/components/CategoriaIcon';
import { resolverCategoriaServico, type CategoriaCustom } from '@shared/categorias';
import {
  PERIODOS_COMISSAO, limitesPeriodoComissao, rotuloPeriodoComissao, hojeBRT, somarDias, diaDaSemana,
  diasEntre, DIAS_SEMANA_ABREV, horaBRT, chaveDiaBRT, rotuloDataBR, type PeriodoComissao,
} from '@shared/periodos';
import {
  normalizarComissoes, resumoComissoes, comissoesPorProfissional, agruparComissoesPorData, filtrarComissoes,
  rotuloPercentualComissao, FILTROS_COMISSAO, MENSAGEM_PAGAMENTO_PARCIAL, type ComissaoItem, type FiltroComissao,
} from '@shared/comissoes';
import { carregarComissoesDoPeriodo, pagarComissoes } from '@shared/comissoes-consultas';
import { formatarMoeda as fmtBRL } from '@shared/moeda';

const supabase = createClient();

function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function avatarGradient(nome: string) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return `linear-gradient(140deg, oklch(0.55 0.16 ${h}), oklch(0.42 0.17 ${h}))`;
}

export default function ComissoesGestorView() {
  const { pode } = usePermissoes();
  // O UPDATE de `comissoes` no banco exige `comissoes.pagar` (ver_todas só lista).
  const podePagar = pode('comissoes.pagar');
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [periodo, setPeriodo] = useState<PeriodoComissao>('mes');
  const [deslocamento, setDeslocamento] = useState(0);
  const [itens, setItens] = useState<ComissaoItem[]>([]);
  const [erroCarga, setErroCarga] = useState('');
  const [categoriasCustom, setCategoriasCustom] = useState<CategoriaCustom[]>([]);
  const [filtro, setFiltro] = useState<FiltroComissao>('todas');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [pagando, setPagando] = useState<string | null>(null);
  useScrollLock(!!pagando);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState('');
  const [toastErro, setToastErro] = useState('');
  const reqRef = useRef(0);

  const hoje = hojeBRT();
  const limites = useMemo(() => limitesPeriodoComissao(periodo, hoje, deslocamento), [periodo, hoje, deslocamento]);
  const periodoLabel = rotuloPeriodoComissao(periodo, limites);
  // Nunca navega para o futuro: com deslocamento 0 a seta "próximo" fica desabilitada.
  const podeAvancar = deslocamento < 0;
  // Faixa domingo–sábado do modo Dia
  const semana = useMemo(() => {
    const domingo = somarDias(limites.startDate, -diaDaSemana(limites.startDate));
    return Array.from({ length: 7 }, (_, i) => somarDias(domingo, i));
  }, [limites.startDate]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (data) setEmpresaId(data.empresa_id);
    })();
  }, []);

  const fetchData = useCallback(async () => {
    if (!empresaId) return;
    const req = ++reqRef.current;
    setLoading(true);
    setErroCarga('');
    try {
      const [rows, rCat] = await Promise.all([
        carregarComissoesDoPeriodo(supabase, empresaId, limites),
        supabase.from('categorias_servico').select('*').eq('empresa_id', empresaId).order('nome'),
      ]);
      if (rCat.error) throw new Error(rCat.error.message);
      if (req !== reqRef.current) return;   // resposta velha
      setItens(normalizarComissoes(rows));
      setCategoriasCustom((rCat.data ?? []) as CategoriaCustom[]);
    } catch (e) {
      if (req !== reqRef.current) return;
      setItens([]);
      setErroCarga((e as Error).message || 'erro desconhecido');
    }
    if (req === reqRef.current) setLoading(false);
  }, [empresaId, limites]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setExpandidos(new Set()); }, [periodo, deslocamento]);

  const profissionais = useMemo(() => comissoesPorProfissional(itens), [itens]);
  const resumo = useMemo(() => resumoComissoes(itens), [itens]);

  function toggleExpand(id: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  /** Paga só as pendentes do período exibido; nunca marca linhas que o banco não confirmou. */
  async function marcarPago(profId: string) {
    const prof = profissionais.find(p => p.profissionalId === profId);
    if (!empresaId || !prof || prof.idsPendentes.length === 0) return;
    setSalvando(true);
    const r = await pagarComissoes(supabase, empresaId, prof.idsPendentes);
    setSalvando(false);
    setPagando(null);
    if (r.naoConfirmados.length > 0) {
      setToastErro(r.erro ? `Erro ao registrar o pagamento: ${r.erro}` : MENSAGEM_PAGAMENTO_PARCIAL);
      setTimeout(() => setToastErro(''), 4000);
    } else {
      setToast('Pagamento registrado!');
      setTimeout(() => setToast(''), 2500);
    }
    fetchData();
  }

  const exportRows: LinhaComissao[] = itens.map(c => ({
    profissional: c.profissionalNome,
    dia: chaveDiaBRT(c.dataAtendimento ?? c.criadaEm),
    servico: c.servicoNome,
    valorServico: c.valorServico,
    percentual: c.percentual,
    comissao: c.valorComissao,
    pago: c.status === 'pago',
  }));

  return (
    <div className="bm-page">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2 pointer-events-none"
          style={{ animation: 'bm-pop .35s cubic-bezier(.2,.85,.3,1)' }}>
          <CircleCheck size={15} strokeWidth={3}/>{toast}
        </div>
      )}

      {toastErro && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg max-w-[90vw] text-center pointer-events-none"
          style={{ animation: 'bm-pop .35s cubic-bezier(.2,.85,.3,1)' }}>
          {toastErro}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Equipe</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
            Comissões
          </h1>
        </div>
        <PrivacyToggle />
        <ExportButton
          variant="mobileHeader"
          className="bm-mobile-header-export"
          definicao={definicaoComissoes(periodoLabel)}
          getLinhas={() => exportRows}
        />
      </div>

      {/* Tabs de período */}
      <div className="flex gap-1 mb-4 p-1 rounded-2xl w-fit" style={{ background: 'var(--color-bg2)' }}>
        {PERIODOS_COMISSAO.map(p => (
          <button key={p.key}
            onClick={() => { setPeriodo(p.key); setDeslocamento(0); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              periodo === p.key
                ? 'bg-surface text-primary border border-border shadow-sm'
                : 'text-text-3 hover:text-text-2'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Navegação de data */}
      {periodo === 'dia' ? (
        <div className="flex justify-center mb-5">
          <div className="bg-surface border border-border rounded-[20px] py-3 px-2 sm:px-4 overflow-x-auto">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button onClick={() => setDeslocamento(x => x - 1)}
                className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition flex-shrink-0">
                <ChevronLeft size={16}/>
              </button>
              <div className="flex gap-0.5 sm:gap-1">
                {semana.map((d) => {
                  const sel = d === limites.startDate;
                  const hj  = d === hoje;
                  const fut = d > hoje;
                  return (
                    <button key={d}
                      onClick={() => !fut && setDeslocamento(diasEntre(hoje, d))}
                      disabled={fut}
                      className="press flex flex-col items-center rounded-[14px] py-2.5 w-9 sm:w-11 flex-shrink-0 disabled:opacity-30"
                      style={{ background: sel ? 'var(--color-primary)' : 'transparent', transition: 'all 0.15s' }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4, fontFamily: 'var(--font-sans)', color: sel ? 'rgba(255,255,255,0.7)' : 'var(--color-ink4)' }}>
                        {DIAS_SEMANA_ABREV[diaDaSemana(d)]}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)', color: sel ? '#fff' : hj ? 'var(--color-accent)' : 'var(--color-ink2)' }}>
                        {Number(d.slice(8, 10))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => podeAvancar && setDeslocamento(x => x + 1)}
                disabled={!podeAvancar}
                className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition flex-shrink-0 disabled:opacity-30">
                <ChevronRight size={16}/>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3 mb-5">
          <div className="bg-surface border border-border rounded-[20px] flex items-center gap-2 px-3 py-2">
            <button onClick={() => setDeslocamento(x => x - 1)}
              className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition">
              <ChevronLeft size={16}/>
            </button>
            <span className="text-sm font-semibold text-text text-center" style={{ minWidth: 200 }}>{periodoLabel}</span>
            <button onClick={() => podeAvancar && setDeslocamento(x => x + 1)}
              disabled={!podeAvancar}
              className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition disabled:opacity-30">
              <ChevronRight size={16}/>
            </button>
          </div>
        </div>
      )}

      {erroCarga && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-xl border border-red/30 bg-red/5 text-sm text-red">
          Não foi possível carregar as comissões: {erroCarga}
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Total',    val: resumo.total,    cor: 'var(--color-primary)' },
          { label: 'Pendente', val: resumo.pendente, cor: 'var(--color-amber)'   },
          { label: 'Pago',     val: resumo.pago,     cor: 'var(--color-green)'   },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-2xl p-3 sm:p-4 min-w-0"
            style={{ boxShadow: '0 1px 4px rgba(44,23,80,0.04)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2 truncate" style={{ color: 'var(--color-ink4)' }}>{s.label}</p>
            <p className="text-sm sm:text-lg font-bold leading-tight break-words" style={{ color: s.cor, letterSpacing: '-0.02em' }}>
              {loading || erroCarga ? '—' : <Secret>{fmtBRL(s.val)}</Secret>}
            </p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-5">
        {FILTROS_COMISSAO.map(f => (
          <button key={f.key} onClick={() => setFiltro(f.key)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
              filtro === f.key
                ? 'bg-primary text-white border-primary'
                : 'bg-surface text-text-3 border-border hover:border-accent/40'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <Sk className="w-10 h-10 rounded-xl flex-shrink-0"/>
                <div className="flex-1"><Sk className="h-4 w-28 mb-1.5"/><Sk className="h-3 w-16"/></div>
                <Sk className="h-6 w-10"/>
                <Sk className="h-6 w-20"/>
                <Sk className="h-5 w-5 rounded"/>
              </div>
            </div>
          ))}
        </div>
      ) : erroCarga ? null : profissionais.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Banknote size={28} className="mb-3" style={{ color: 'var(--color-ink4)' }}/>
          <h2 className="font-serif text-xl mb-1" style={{ color: 'var(--color-ink)' }}>Sem comissões</h2>
          <p className="text-sm" style={{ color: 'var(--color-ink3)' }}>Nenhum atendimento concluído no período.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {profissionais.map(prof => {
            const list = filtrarComissoes(prof.itens, filtro);
            if (list.length === 0) return null;

            const expanded    = expandidos.has(prof.profissionalId);
            const temPendente = prof.pendente > 0;
            const groups      = agruparComissoesPorData(list, periodo);

            return (
              <div key={prof.profissionalId}
                className="bg-surface border border-border rounded-2xl overflow-hidden"
                style={{ boxShadow: '0 1px 4px rgba(44,23,80,0.04)' }}>

                {/* Card colapsado */}
                <div className="w-full flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <button
                    onClick={() => toggleExpand(prof.profissionalId)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left transition hover:opacity-80">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                      style={{ background: avatarGradient(prof.nome) }}>
                      {iniciais(prof.nome)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--color-ink)' }}>{prof.nome}</p>
                      <p className="text-xs" style={{ color: 'var(--color-ink3)' }}>{prof.atendimentos} atend.</p>
                    </div>

                    {/* % */}
                    <div className="text-center flex-shrink-0 px-2">
                      <p className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>{rotuloPercentualComissao(prof.percentual)}</p>
                      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-ink4)' }}>comissão</p>
                    </div>

                    {/* Valor R$ */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold"
                        style={{ color: temPendente ? 'var(--color-amber)' : 'var(--color-green)' }}>
                        <Secret>{fmtBRL(prof.total)}</Secret>
                      </p>
                      <p className="text-[10px]"
                        style={{ color: temPendente ? 'var(--color-amber)' : 'var(--color-green)' }}>
                        {temPendente ? 'pendente' : 'pago'}
                      </p>
                    </div>
                  </button>

                  {/* Pagar — visível direto no cabeçalho, sem precisar expandir */}
                  {temPendente && podePagar && (
                    <button onClick={() => setPagando(prof.profissionalId)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-bold hover:opacity-90 transition flex-shrink-0"
                      style={{ background: 'var(--color-green)' }}>
                      <Banknote size={13} strokeWidth={2}/>Pagar
                    </button>
                  )}

                  <button onClick={() => toggleExpand(prof.profissionalId)} className="flex-shrink-0 p-1">
                    <ChevronDown size={16} style={{ color: 'var(--color-ink4)', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}/>
                  </button>
                </div>

                {/* Detalhe expandido */}
                <div style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', transition: 'grid-template-rows 0.22s ease' }}>
                  <div className="overflow-hidden">
                  <div className="border-t border-border">
                    {groups.map(group => (
                      <div key={group.chave}>
                        {/* Cabeçalho de dia/mês */}
                        {periodo !== 'dia' && (
                          <div className="px-4 py-2 border-b border-border" style={{ background: 'var(--color-bg)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-ink4)' }}>
                              {group.rotulo}
                            </p>
                          </div>
                        )}

                        {group.itens.map((c, i) => {
                          const r   = resolverCategoriaServico(c.servicoCategoria, c.servicoCategoriaId, categoriasCustom);
                          const cor = r.cor;
                          const bg  = r.bg;
                          return (
                            <div key={c.id}
                              className={`flex items-center gap-3 px-4 py-3 ${i < group.itens.length - 1 ? 'border-b border-border' : ''}`}>
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ background: bg }}>
                                {r.iconeCustom
                                  ? <CategoriaIconCustom name={r.iconeCustom} size={15} color={cor}/>
                                  : <CategoriaIcon categoria={r.iconeBuiltin ?? 'outros'} size={15} color={cor}/>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-ink)' }}>
                                  {c.servicoNome}
                                </p>
                                <p className="text-[10px]" style={{ color: 'var(--color-ink3)' }}>
                                  <Secret>{fmtBRL(c.valorServico)} × {c.percentual}%</Secret>
                                  {c.dataAtendimento && (
                                    <span className="ml-1.5 opacity-60">
                                      {horaBRT(c.dataAtendimento)}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs font-bold" style={{ color: 'var(--color-ink)' }}>
                                  <Secret>{fmtBRL(c.valorComissao)}</Secret>
                                </p>
                                <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md mt-0.5 ${
                                  c.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'
                                }`}>
                                  {c.status === 'pago' ? 'Pago' : 'Pendente'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}

                    {/* Rodapé — resumo do repasse (ação "Pagar" já fica no cabeçalho do card) */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border" style={{ background: 'var(--color-bg)' }}>
                      <div>
                        <p className="text-[10px]" style={{ color: 'var(--color-ink3)' }}>
                          {temPendente ? 'Pendente para repassar' : 'Tudo repassado'}
                        </p>
                        <p className="text-sm font-bold" style={{ color: temPendente ? 'var(--color-amber)' : 'var(--color-green)' }}>
                          <Secret>{fmtBRL(temPendente ? prof.pendente : prof.pago)}</Secret>
                        </p>
                      </div>
                      {!temPendente && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
                          style={{ background: 'var(--color-green-soft)', color: 'var(--color-green)' }}>
                          <CircleCheck size={13} strokeWidth={2}/>Pago
                        </div>
                      )}
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de confirmação de pagamento */}
      {pagando && (() => {
        const prof = profissionais.find(p => p.profissionalId === pagando);
        if (!prof) return null;
        return (
          <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => !salvando && setPagando(null)}>
            <div className="bg-surface rounded-2xl p-6 w-full max-w-sm shadow-xl mx-4"
              onClick={e => e.stopPropagation()}
              style={{ animation: 'bm-pop .3s cubic-bezier(.2,.85,.3,1)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-ink3)' }}>Confirmar pagamento</p>
                  <h3 className="font-serif text-xl" style={{ color: 'var(--color-ink)' }}>{prof.nome}</h3>
                </div>
                <button onClick={() => setPagando(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition hover:bg-bg"
                  style={{ color: 'var(--color-ink3)' }}>
                  <X size={16}/>
                </button>
              </div>
              <div className="rounded-xl p-4 text-center mb-6" style={{ background: 'var(--color-amber-soft)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-amber)' }}>Total a repassar</p>
                <p className="text-3xl font-bold" style={{ color: 'var(--color-amber)', letterSpacing: '-0.02em' }}>
                  <Secret>{fmtBRL(prof.pendente)}</Secret>
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-amber)' }}>Pendentes de {periodoLabel}</p>
              </div>
              <button onClick={() => marcarPago(prof.profissionalId)}
                disabled={salvando}
                className="w-full h-12 rounded-xl text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--color-green)' }}>
                {salvando ? 'Salvando...' : <><Banknote size={16}/>Confirmar pagamento</>}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
