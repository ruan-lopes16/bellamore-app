'use client';

/**
 * @file notificacoes/page.tsx
 * Central de notificações, igual ao app (regras e consultas em shared):
 *
 * - **Alertas** — calculados na hora (`carregarDadosAlertas` + `alertasCalculados`): agendamentos
 *   de hoje, estoque baixo, despesas vencendo, comissões pendentes, comandas não fechadas e
 *   aniversariantes dos próximos 7 dias. Cada um só aparece com a permissão correspondente.
 * - **Avisos** — linhas gravadas em `notificacoes` (`carregarAvisos`), só da pessoa na empresa
 *   ativa, com filtro Todas/Não lidas, paginação e "marcar como lida" conferido no banco.
 *
 * Datas sempre em Brasília (o "hoje" antigo desta tela saía em UTC). Ao marcar avisos como lidos,
 * dispara `EVENTO_SINO` para a Sidebar recalcular o sino.
 */

import { useEmpresaAtiva } from '@/components/EmpresaAtivaProvider';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell, CalendarDays, DollarSign, Gift, Wallet, Check, CheckCheck, ChevronRight,
  Package, Ban, X, Receipt, ClipboardList, AlertCircle, RefreshCw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { usePermissoes } from '@/components/PermissoesProvider';
import {
  alertasCalculados, alertaTemRota, avisoTemRota, resumoAgendamentosHoje, rotaDoAviso, rotaDoDestino,
  rotuloNaoLidas, separarAlertas, tipoNotificacao, TEXTOS_NOTIFICACOES as T, TIPOS_NOTIFICACAO, VISUAL_ALERTA,
  type Alerta, type CorAviso,
} from '@shared/notificacoes';
import {
  carregarAvisos, carregarDadosAlertas, contarAvisosNaoLidos, marcarLidas, marcarTodasLidas,
  type AvisoRow,
} from '@shared/notificacoes-consultas';
import { rotuloDataHoraBRT } from '@shared/periodos';
import { EVENTO_SINO } from '@/lib/sino';

const supabase = createClient();

/** Nome do ícone lucide (shared) → componente. */
const ICONES: Record<string, React.ElementType> = {
  CalendarDays, Package, DollarSign, Wallet, Receipt, Gift, ClipboardList, Ban, Check, X,
};
const icone = (nome: string) => ICONES[nome] ?? Bell;
const cor = (c: CorAviso) => ({ fg: `var(--color-${c})`, bg: `var(--color-${c}-soft)` });

type Filtro = 'todas' | 'nao_lidas';

/** Tela do alerta (no web todo destino tem tela; a regra é a mesma do app). */
const hrefAlerta = (a: Alerta) => (alertaTemRota(a.destino, 'web') ? rotaDoDestino(a.destino, 'web') : '/notificacoes');

const rotuloSecao: React.CSSProperties = { fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em' };

function ErroCarga({ texto, onTentar }: { texto: string; onTentar: () => void }) {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-3" role="alert"
      style={{ background: 'var(--color-red-soft)', border: '1px solid rgba(220,38,38,0.2)' }}>
      <AlertCircle size={16} style={{ color: 'var(--color-red)', flexShrink: 0 }}/>
      <p style={{ flex: 1, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-red)' }}>{texto}</p>
      <button type="button" onClick={onTentar} className="press flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold"
        style={{ background: 'var(--color-surface)', color: 'var(--color-ink2)', border: '1px solid var(--color-border)' }}>
        <RefreshCw size={12}/> {T.tentarDeNovo}
      </button>
    </div>
  );
}

export default function NotificacoesPage() {
  const { empresaId } = useEmpresaAtiva();
  const permissoes = usePermissoes();
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);

  // Alertas: null = carregando ou com erro (nunca lista vazia por falha).
  const [alertas,      setAlertas]      = useState<Alerta[] | null>(null);
  const [erroAlertas,  setErroAlertas]  = useState('');
  const [agsExpandido, setAgsExpandido] = useState(false);

  // Avisos
  const [filtro,       setFiltro]       = useState<Filtro>('todas');
  const [avisos,       setAvisos]       = useState<AvisoRow[] | null>(null);
  const [pagina,       setPagina]       = useState(0);
  const [temMais,      setTemMais]      = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erroAvisos,   setErroAvisos]   = useState('');
  const [naoLidas,     setNaoLidas]     = useState<number | null>(null);
  const [marcando,     setMarcando]     = useState(false);
  const [aviso,        setAviso]        = useState('');
  // Resposta atrasada de um filtro anterior não sobrescreve a lista atual.
  const reqAvisos = useRef(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    })();
  }, []);

  const carregarAlertas = useCallback(async () => {
    if (!userId) return;
    setErroAlertas(''); setAlertas(null);
    try {
      const dados = await carregarDadosAlertas(supabase, empresaId, { userId, pode: permissoes.pode });
      setAlertas(alertasCalculados(dados, permissoes, { userId }));
    } catch (e) {
      setErroAlertas(e instanceof Error ? e.message : T.erroAlertas);
    }
  }, [empresaId, userId, permissoes]);

  const contar = useCallback(async () => {
    if (!userId) return;
    try { setNaoLidas(await contarAvisosNaoLidos(supabase, empresaId, userId)); }
    catch { setNaoLidas(null); }
  }, [empresaId, userId]);

  const carregarPagina = useCallback(async (p: number) => {
    if (!userId) return;
    const req = ++reqAvisos.current;
    setErroAvisos('');
    if (p === 0) setAvisos(null); else setCarregandoMais(true);
    try {
      const r = await carregarAvisos(supabase, empresaId, userId, { soNaoLidas: filtro === 'nao_lidas', pagina: p });
      if (req !== reqAvisos.current) return;
      setAvisos(prev => (p === 0 ? r.avisos : [...(prev ?? []), ...r.avisos]));
      setTemMais(r.temMais);
      setPagina(p);
    } catch (e) {
      if (req !== reqAvisos.current) return;
      setErroAvisos(e instanceof Error ? e.message : T.erroAvisos);
    } finally {
      if (req === reqAvisos.current) setCarregandoMais(false);
    }
  }, [empresaId, userId, filtro]);

  useEffect(() => { carregarAlertas(); }, [carregarAlertas]);
  useEffect(() => { carregarPagina(0); }, [carregarPagina]);
  useEffect(() => { contar(); }, [contar]);

  function avisarSino() {
    window.dispatchEvent(new Event(EVENTO_SINO));
  }

  /** Marca um aviso: a tela só muda o que o banco confirmou. */
  async function marcarUma(id: string) {
    setAviso('');
    try {
      const { confirmados } = await marcarLidas(supabase, [id]);
      if (confirmados.length === 0) { setAviso(T.avisoNaoMarcado); return; }
      setAvisos(prev => {
        if (!prev) return prev;
        return filtro === 'nao_lidas' ? prev.filter(a => a.id !== id) : prev.map(a => (a.id === id ? { ...a, lida: true } : a));
      });
      setNaoLidas(n => (n === null ? n : Math.max(0, n - 1)));
      avisarSino();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : T.erroMarcar);
    }
  }

  async function marcarTodas() {
    if (!userId) return;
    setMarcando(true); setAviso('');
    try {
      await marcarTodasLidas(supabase, empresaId, userId);
      await Promise.all([carregarPagina(0), contar()]);
      avisarSino();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : T.erroMarcarTodas);
    } finally {
      setMarcando(false);
    }
  }

  /** Abrir um aviso marca como lido e leva para a tela dele (aviso sem tela própria só marca). */
  function abrirAviso(a: AvisoRow) {
    if (!a.lida) marcarUma(a.id);
    if (avisoTemRota(a.tipo, 'web')) router.push(rotaDoAviso(a.tipo, 'web'));
  }

  const { agendamentos: alertasAg, outros: outrosAlertas } = separarAlertas(alertas ?? []);
  const resumoAg = resumoAgendamentosHoje(alertasAg);
  const urgentes = (alertas ?? []).filter(a => a.urgente).length;

  // ── Render ────────────────────────────────────────────────────

  if (!userId && alertas === null && avisos === null && !erroAlertas) {
    return (
      <div className="bm-page">
        <div className="mb-6"><Sk className="h-3 w-28 mb-2"/><Sk className="h-9 w-40"/></div>
        <div className="flex flex-col gap-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 flex items-start gap-4">
              <Sk className="w-10 h-10 rounded-xl flex-shrink-0"/>
              <div className="flex-1 flex flex-col gap-2">
                <Sk className="h-4 w-48"/><Sk className="h-3 w-64"/>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bm-page">
      {/* Header Bellamore */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p style={{ ...rotuloSecao, marginBottom: 2 }}>Central</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>{T.titulo}</h1>
        </div>
        {(naoLidas ?? 0) > 0 && (
          <button onClick={marcarTodas} disabled={marcando} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-sm font-bold"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink2)', fontFamily: 'var(--font-sans)', opacity: marcando ? 0.5 : 1 }}>
            <CheckCheck size={15}/>
            {marcando ? T.marcando : T.marcarTodas}
          </button>
        )}
      </div>

      {aviso && (
        <p role="alert" className="mb-4 text-sm" style={{ color: 'var(--color-rose)' }}>{aviso}</p>
      )}

      {/* ── Alertas (calculados na hora) ── */}
      <section className="mb-8">
        <div className="flex items-baseline justify-between pb-3 mb-2">
          <h2 style={rotuloSecao}>{T.secaoAlertas}</h2>
          {alertas && alertas.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: urgentes > 0 ? 'var(--color-rose)' : 'var(--color-amber-soft)', color: urgentes > 0 ? '#fff' : 'var(--color-amber)' }}>
              {alertas.length}
            </span>
          )}
        </div>

        {erroAlertas ? (
          <ErroCarga texto={`${erroAlertas} Os alertas aparecem como "—" até carregar.`} onTentar={carregarAlertas}/>
        ) : alertas === null ? (
          <div className="flex flex-col gap-2">
            {[1,2,3].map(i => <Sk key={i} className="h-[72px] rounded-2xl"/>)}
          </div>
        ) : alertas.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'var(--color-green-soft)' }}>
              <Check size={22} style={{ color: 'var(--color-green)' }}/>
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, color: 'var(--color-ink)', marginBottom: 4 }}>{T.semAlertasTitulo}</p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink4)' }}>{T.semAlertas}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Agendamentos de hoje: 1 linha-resumo expansível em vez do "paredão" de N linhas. */}
            {resumoAg && (() => {
              const v = cor(VISUAL_ALERTA.agendamentos.cor);
              const Icon = icone(VISUAL_ALERTA.agendamentos.icone);
              return (
                <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <button type="button" onClick={() => setAgsExpandido(x => !x)}
                    className="press w-full flex items-center gap-4 p-4 text-left">
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: v.bg }}>
                      <Icon size={18} style={{ color: v.fg }}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: 'var(--color-ink)' }}>
                        {resumoAg.titulo}
                      </p>
                      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {resumoAg.descricao}
                      </p>
                    </div>
                    <ChevronRight size={14} style={{ color: 'var(--color-ink4)', flexShrink: 0, transform: agsExpandido ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}/>
                  </button>
                  {agsExpandido && (
                    <div style={{ borderTop: '1px solid var(--color-border)' }} className="flex flex-col">
                      {alertasAg.map(a => (
                        <Link key={a.id} href={hrefAlerta(a)}
                          className="press flex items-center gap-3 px-4 py-3"
                          style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.titulo}</p>
                            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.descricao}</p>
                          </div>
                          <ChevronRight size={14} style={{ color: 'var(--color-ink4)', flexShrink: 0 }}/>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {outrosAlertas.map((alerta, i) => {
              const visual = VISUAL_ALERTA[alerta.grupo];
              const v = cor(visual.cor);
              const Icon = icone(visual.icone);
              return (
                <Link key={alerta.id} href={hrefAlerta(alerta)}
                  className="press bm-stagger flex items-center gap-4 p-4 rounded-2xl"
                  style={{ '--bm-i': i, '--bm-step': '60ms', background: alerta.urgente ? 'var(--color-rose-soft)' : 'var(--color-surface)', border: `1px solid ${alerta.urgente ? 'rgba(220,38,38,0.2)' : 'var(--color-border)'}`, display: 'flex', alignItems: 'center', gap: 16 } as React.CSSProperties}>
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: v.bg }}>
                    <Icon size={18} style={{ color: v.fg }}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: alerta.urgente ? 'var(--color-rose)' : 'var(--color-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {alerta.titulo}
                    </p>
                    <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alerta.descricao}</p>
                  </div>
                  <ChevronRight size={14} style={{ color: 'var(--color-ink4)', flexShrink: 0 }}/>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Avisos (gravados no banco) ── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-2">
          <div className="flex items-baseline gap-2">
            <h2 style={rotuloSecao}>{T.secaoAvisos}</h2>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'var(--color-primary)', color: '#fff' }}>
              {rotuloNaoLidas(naoLidas)}
            </span>
          </div>
          <div className="flex gap-1 p-1 rounded-xl" role="tablist" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
            {([['todas', T.filtroTodas], ['nao_lidas', T.filtroNaoLidas]] as const).map(([k, rotulo]) => (
              <button key={k} type="button" role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)}
                className="press h-8 px-3 rounded-lg text-xs font-bold"
                style={filtro === k
                  ? { background: 'var(--color-surface)', color: 'var(--color-primary)', boxShadow: '0 1px 3px rgba(44,23,80,0.1)' }
                  : { background: 'transparent', color: 'var(--color-ink3)' }}>
                {rotulo}
              </button>
            ))}
          </div>
        </div>

        {erroAvisos && avisos === null ? (
          <ErroCarga texto={erroAvisos} onTentar={() => carregarPagina(0)}/>
        ) : avisos === null ? (
          <div className="flex flex-col gap-2">
            {[1,2,3].map(i => <Sk key={i} className="h-[64px] rounded-2xl"/>)}
          </div>
        ) : avisos.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <Bell size={28} style={{ margin: '0 auto 12px', color: 'var(--color-ink4)' }}/>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink4)' }}>
              {filtro === 'nao_lidas' ? T.semAvisosNaoLidos : T.semAvisos}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {avisos.map((n, i) => {
              const t = tipoNotificacao(n.tipo);
              const visual = t ? TIPOS_NOTIFICACAO[t] : null;
              const v = visual ? cor(visual.cor) : null;
              const Icon = visual ? icone(visual.icone) : null;
              return (
                <div key={n.id} className="bm-stagger"
                  style={{ '--bm-i': i % 8, '--bm-step': '50ms', background: n.lida ? 'var(--color-surface)' : 'var(--color-primary-soft)', border: `1px solid ${n.lida ? 'var(--color-border)' : 'rgba(44,23,80,0.15)'}`, borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: n.lida ? 0.7 : 1 } as React.CSSProperties}>
                  {Icon && v ? (
                    <div className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 10, background: v.bg, marginTop: 1 }}>
                      <Icon size={16} style={{ color: v.fg }}/>
                    </div>
                  ) : (
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: n.lida ? 'var(--color-border)' : 'var(--color-accent)', flexShrink: 0, marginTop: 6 }}/>
                  )}
                  <button type="button" onClick={() => abrirAviso(n)} className="press text-left" style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-start justify-between gap-2">
                      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: n.lida ? 'var(--color-ink2)' : 'var(--color-ink)' }}>{n.titulo}</p>
                      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink4)', flexShrink: 0 }}>
                        {rotuloDataHoraBRT(n.created_at)}
                      </span>
                    </div>
                    {visual && <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: v!.fg, marginTop: 2 }}>{visual.rotulo}</p>}
                    {n.mensagem && <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink3)', marginTop: 3 }}>{n.mensagem}</p>}
                  </button>
                  {!n.lida && (
                    <button onClick={() => marcarUma(n.id)} title={T.marcarUma} aria-label={T.marcarUma}
                      className="press w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                      <Check size={13}/>
                    </button>
                  )}
                </div>
              );
            })}
            {erroAvisos && <ErroCarga texto={erroAvisos} onTentar={() => carregarPagina(pagina + 1)}/>}
            {temMais && !erroAvisos && (
              <button type="button" onClick={() => carregarPagina(pagina + 1)} disabled={carregandoMais}
                className="press h-10 rounded-2xl text-sm font-bold disabled:opacity-50"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink2)' }}>
                {carregandoMais ? T.carregando : T.mostrarMais}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
