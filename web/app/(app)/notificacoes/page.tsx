'use client';

/**
 * @file notificacoes/page.tsx
 * Central de notificações e alertas operacionais.
 *
 * ## Seções
 *
 * ### Alertas computados (sempre atuais, lidos da base em tempo real)
 * - Agendamentos de hoje não concluídos
 * - Produtos com estoque abaixo do mínimo
 * - Despesas a vencer nos próximos 7 dias
 * - Comissões pendentes de pagamento
 * - Clientes aniversariantes esta semana
 *
 * ### Notificações salvas (tabela notificacoes)
 * - Eventos registrados por triggers ou manualmente
 * - Marcação individual ou em lote como "lida"
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Bell, CalendarDays, AlertTriangle, DollarSign,
  Gift, Wallet, Check, CheckCheck, ChevronRight,
  Package, Clock, Ban, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { registrarEInscrever } from '@/components/SwRegister';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const supabase = createClient();

type PermissaoPush = 'default' | 'granted' | 'denied' | 'sem-suporte';

/**
 * Card de status/ativação do push no aparelho atual. O pedido de permissão
 * só acontece no clique — no Safari/iOS, chamar Notification.requestPermission()
 * fora de um gesto direto do usuário é negado silenciosamente, sem popup
 * nenhum (é por isso que não roda automático em lugar nenhum do app).
 */
function CardPushDispositivo() {
  const [permissao, setPermissao] = useState<PermissaoPush>('sem-suporte');
  const [ativando,  setAtivando]  = useState(false);

  useEffect(() => {
    const apto = 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
    setPermissao(apto ? (Notification.permission as PermissaoPush) : 'sem-suporte');
  }, []);

  async function ativar() {
    setAtivando(true);
    try {
      const resultado = await Notification.requestPermission();
      setPermissao(resultado as PermissaoPush);
      if (resultado === 'granted') await registrarEInscrever();
    } catch {
      // Falha silenciosa: o card continua mostrando o estado atual.
    } finally {
      setAtivando(false);
    }
  }

  if (permissao === 'sem-suporte') return null;

  return (
    <div className="mb-8 rounded-2xl p-4 flex items-center gap-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: permissao === 'granted' ? 'var(--color-green-soft)' : 'var(--color-primary-soft)' }}>
        <Bell size={18} style={{ color: permissao === 'granted' ? 'var(--color-green)' : 'var(--color-primary)' }}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: 'var(--color-ink)' }}>
          {permissao === 'granted' ? 'Notificações ativadas neste aparelho'
            : permissao === 'denied' ? 'Notificações bloqueadas neste aparelho'
            : 'Ativar lembretes de atendimento'}
        </p>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink3)', marginTop: 2 }}>
          {permissao === 'granted' ? 'Você recebe avisos 1h e 15min antes de cada atendimento, e o resumo do dia.'
            : permissao === 'denied' ? 'Ative em Ajustes do aparelho > Notificações > Bellamore (não dá para pedir de novo por aqui).'
            : 'Receba um aviso na tela do celular 1h e 15min antes de cada atendimento.'}
        </p>
      </div>
      {permissao === 'default' && (
        <button type="button" onClick={ativar} disabled={ativando}
          className="press flex-shrink-0 h-9 px-4 rounded-xl text-white text-xs font-bold transition disabled:opacity-60"
          style={{ background: 'var(--color-primary)' }}>
          {ativando ? 'Ativando…' : 'Ativar'}
        </button>
      )}
    </div>
  );
}

// ── Tipos ─────────────────────────────────────────────────────

type Alerta = {
  id:        string;
  icone:     React.ElementType;
  corIcone:  string;
  bgIcone:   string;
  titulo:    string;
  descricao: string;
  link:      string;
  urgente:   boolean;
};

type Notificacao = {
  id:         string;
  tipo:       string;
  titulo:     string;
  mensagem:   string | null;
  lida:       boolean;
  created_at: string;
};

// ── Ícone + cor por tipo de notificação salva ─────────────────
// Cobre o fluxo de aprovação de bloqueio (trigger da migration 069).
// O título/mensagem em pt-BR já vêm do trigger; aqui só o visual do tipo.
// Tipos sem entrada aqui caem no render genérico (dot + título + mensagem).

const TIPO_NOTIF: Record<string, { icon: React.ElementType; cor: string; bg: string }> = {
  bloqueio_pendente: { icon: Ban,   cor: 'var(--color-amber)', bg: 'var(--color-amber-soft)' },
  bloqueio_aprovado: { icon: Check, cor: 'var(--color-green)', bg: 'var(--color-green-soft)' },
  bloqueio_recusado: { icon: X,     cor: 'var(--color-red)',   bg: 'var(--color-red-soft)'   },
};

// ── Helpers ───────────────────────────────────────────────────

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

function fmtData(d: string) {
  return format(parseISO(d + 'T12:00:00'), "dd/MM", { locale: ptBR });
}

// ── Página ────────────────────────────────────────────────────

export default function NotificacoesPage() {

  const [loading,       setLoading]       = useState(true);
  const [alertas,       setAlertas]       = useState<Alerta[]>([]);
  const [alertasAg,     setAlertasAg]     = useState<Alerta[]>([]);
  const [agsExpandido,  setAgsExpandido]  = useState(false);
  const [notificacoes,  setNotificacoes]  = useState<Notificacao[]>([]);
  const [marcando,      setMarcando]      = useState(false);
  const [empresaId,     setEmpresaId]     = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membro } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;

      const empId = membro.empresa_id;
      setEmpresaId(empId);

      const hoje      = new Date();
      const hojeStr   = hoje.toISOString().slice(0, 10);
      const daqui7    = new Date(hoje.getTime() + 7 * 86400000).toISOString().slice(0, 10);
      const fimDia    = new Date(hojeStr + 'T23:59:59').toISOString();
      const mesAtual  = hoje.getMonth();

      const [rAgs, rEstoque, rDespesas, rComissoes, rClientes, rNotifs] = await Promise.all([
        // Agendamentos de hoje ainda não concluídos
        supabase.from('agendamentos')
          .select('id, data_hora_inicio, status, cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)')
          .eq('empresa_id', empId)
          .gte('data_hora_fim', hoje.toISOString())
          .lte('data_hora_inicio', fimDia)
          .not('status', 'in', '("concluido","cancelado","faltou")')
          .order('data_hora_inicio'),

        // Estoque abaixo do mínimo
        supabase.from('v_produtos_estoque_baixo')
          .select('id, nome, estoque_atual, estoque_minimo')
          .eq('empresa_id', empId).eq('ativo', true),

        // Despesas pendentes vencendo em 7 dias
        supabase.from('despesas')
          .select('id, descricao, valor, data_vencimento')
          .eq('empresa_id', empId).eq('status', 'pendente')
          .gte('data_vencimento', hojeStr)
          .lte('data_vencimento', daqui7)
          .order('data_vencimento'),

        // Comissões pendentes
        supabase.from('comissoes')
          .select('id, valor_comissao, profissional:users!comissoes_profissional_id_fkey(nome)')
          .eq('empresa_id', empId).eq('status', 'pendente'),

        // Clientes aniversariantes esta semana
        supabase.from('clientes')
          .select('id, nome, data_nascimento')
          .eq('empresa_id', empId).eq('ativo', true)
          .not('data_nascimento', 'is', null),

        // Notificações salvas
        supabase.from('notificacoes')
          .select('id, tipo, titulo, mensagem, lida, created_at')
          .eq('empresa_id', empId)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      // ── Construir alertas
      const lista: Alerta[] = [];
      // Alertas de agendamento ficam num grupo à parte — a tela os colapsa numa
      // linha-resumo expansível em vez do "paredão" de N linhas.
      const listaAg: Alerta[] = [];

      // Agendamentos do dia
      const agsHoje = rAgs.data ?? [];
      if (agsHoje.length > 0) {
        agsHoje.forEach((ag: any) => {
          const hora = format(parseISO(ag.data_hora_inicio), 'HH:mm');
          listaAg.push({
            id:       `ag-${ag.id}`,
            icone:    CalendarDays,
            corIcone: '#7C3AED',
            bgIcone:  '#F3EFFE',
            titulo:   `${hora} — ${ag.cliente?.nome ?? 'Cliente'}`,
            descricao: `${ag.servico?.nome ?? 'Serviço'} · Status: ${ag.status}`,
            link:     '/agenda',
            urgente:  false,
          });
        });
      }

      // Estoque baixo
      const estBaixo = rEstoque.data ?? [];
      estBaixo.forEach((p: any) => {
        lista.push({
          id:       `est-${p.id}`,
          icone:    Package,
          corIcone: '#D97706',
          bgIcone:  '#FEF3C7',
          titulo:   `Estoque baixo: ${p.nome}`,
          descricao: `${p.estoque_atual} em estoque (mínimo: ${p.estoque_minimo})`,
          link:     '/estoque',
          urgente:  p.estoque_atual <= 0,
        });
      });

      // Despesas a vencer
      const desp = rDespesas.data ?? [];
      desp.forEach((d: any) => {
        const diasRestantes = differenceInDays(parseISO(d.data_vencimento), hoje);
        lista.push({
          id:       `desp-${d.id}`,
          icone:    DollarSign,
          corIcone: '#DC2626',
          bgIcone:  '#FEF2F2',
          titulo:   `${d.descricao} — ${fmtBRL(Number(d.valor))}`,
          descricao: diasRestantes === 0
            ? 'Vence hoje!'
            : `Vence em ${diasRestantes} dia${diasRestantes !== 1 ? 's' : ''} (${fmtData(d.data_vencimento)})`,
          link:     '/financeiro',
          urgente:  diasRestantes <= 1,
        });
      });

      // Comissões pendentes
      const coms = rComissoes.data ?? [];
      if (coms.length > 0) {
        const totalCom = coms.reduce((s: number, c: any) => s + Number(c.valor_comissao), 0);
        // Agrupar por profissional
        const porProf: Record<string, { nome: string; total: number }> = {};
        coms.forEach((c: any) => {
          const nome = c.profissional?.nome ?? 'Profissional';
          if (!porProf[nome]) porProf[nome] = { nome, total: 0 };
          porProf[nome].total += Number(c.valor_comissao);
        });
        Object.values(porProf).forEach(({ nome, total }) => {
          lista.push({
            id:       `com-${nome}`,
            icone:    Wallet,
            corIcone: '#0D7E5F',
            bgIcone:  '#ECFDF5',
            titulo:   `Comissão pendente: ${nome}`,
            descricao: `${fmtBRL(total)} a pagar`,
            link:     '/equipe',
            urgente:  false,
          });
        });
      }

      // Aniversariantes: hoje + próximos 7 dias
      const clientes = rClientes.data ?? [];
      const limiteAniv = new Date(hoje.getTime() + 7 * 86400000);

      clientes.forEach((c: any) => {
        if (!c.data_nascimento) return;
        const nasc = new Date(c.data_nascimento + 'T12:00:00');
        const nascEsteAno = new Date(hoje.getFullYear(), nasc.getMonth(), nasc.getDate());
        const hojeD = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        // Se já passou este ano, checar ano que vem
        const nascRef = nascEsteAno < hojeD
          ? new Date(hoje.getFullYear() + 1, nasc.getMonth(), nasc.getDate())
          : nascEsteAno;
        if (nascRef <= limiteAniv) {
          const isHoje = nascRef.toDateString() === hoje.toDateString();
          const diasRestantes = Math.round((nascRef.getTime() - hoje.getTime()) / 86400000);
          lista.push({
            id:       `aniv-${c.id}`,
            icone:    Gift,
            corIcone: '#D4608A',
            bgIcone:  '#FDF0F5',
            titulo:   `🎂 Aniversário: ${c.nome}`,
            descricao: isHoje
              ? 'Aniversário HOJE! 🎉'
              : diasRestantes === 1
                ? 'Amanhã!'
                : `Em ${diasRestantes} dias · ${format(nascRef, 'dd/MM', { locale: ptBR })}`,
            link:     `/clientes/${c.id}`,
            urgente:  isHoje,
          });
        }
      });

      setAlertas(lista);
      setAlertasAg(listaAg);
      setNotificacoes((rNotifs.data ?? []) as Notificacao[]);
      setLoading(false);
    })();
  }, []);

  // ── Marcar todas como lidas
  async function marcarTodasLidas() {
    const ids = notificacoes.filter(n => !n.lida).map(n => n.id);
    if (ids.length === 0) return;
    setMarcando(true);
    await supabase.from('notificacoes').update({ lida: true }).in('id', ids);
    setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })));
    setMarcando(false);
  }

  async function marcarLida(id: string) {
    await supabase.from('notificacoes').update({ lida: true }).eq('id', id);
    setNotificacoes(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n));
  }

  const naoLidas = notificacoes.filter(n => !n.lida).length;
  const urgentes = alertas.filter(a => a.urgente).length;

  // ── Render ────────────────────────────────────────────────────

  if (loading) {
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
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Central</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Notificações</h1>
        </div>
        {naoLidas > 0 && (
          <button onClick={marcarTodasLidas} disabled={marcando} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-sm font-bold"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink2)', fontFamily: 'var(--font-sans)', opacity: marcando ? 0.5 : 1 }}>
            <CheckCheck size={15}/>
            {marcando ? 'Marcando...' : `Marcar ${naoLidas} como lida${naoLidas !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      <CardPushDispositivo />

      {/* ── Alertas computados ── */}
      <div className="mb-8">
        <div className="flex items-baseline justify-between pb-3 mb-2">
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Alertas ativos</span>
          {(alertas.length + alertasAg.length) > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: urgentes > 0 ? 'var(--color-rose)' : 'var(--color-amber-soft)', color: urgentes > 0 ? '#fff' : 'var(--color-amber)' }}>
              {alertas.length + alertasAg.length}
            </span>
          )}
        </div>

        {(alertas.length + alertasAg.length) === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'var(--color-green-soft)' }}>
              <Check size={22} style={{ color: 'var(--color-green)' }}/>
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, color: 'var(--color-ink)', marginBottom: 4 }}>Tudo em ordem!</p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink4)' }}>Nenhum alerta no momento.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Grupo de agendamentos do dia — 1 linha-resumo expansível */}
            {alertasAg.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <button type="button" onClick={() => setAgsExpandido(v => !v)}
                  className="press w-full flex items-center gap-4 p-4 text-left">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: '#F3EFFE' }}>
                    <CalendarDays size={18} style={{ color: '#7C3AED' }}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: 'var(--color-ink)' }}>
                      {alertasAg.length} {alertasAg.length === 1 ? 'atendimento' : 'atendimentos'} hoje
                    </p>
                    <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      próximo {alertasAg[0].titulo}
                    </p>
                  </div>
                  <ChevronRight size={14} style={{ color: 'var(--color-ink4)', flexShrink: 0, transform: agsExpandido ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}/>
                </button>
                {agsExpandido && (
                  <div style={{ borderTop: '1px solid var(--color-border)' }} className="flex flex-col">
                    {alertasAg.map(a => (
                      <Link key={a.id} href={a.link}
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
            )}
            {alertas.map((alerta, i) => {
              const Icon = alerta.icone;
              return (
                <Link key={alerta.id} href={alerta.link}
                  className="press bm-stagger flex items-center gap-4 p-4 rounded-2xl"
                  style={{ '--bm-i': i, '--bm-step': '60ms', background: alerta.urgente ? 'var(--color-rose-soft)' : 'var(--color-surface)', border: `1px solid ${alerta.urgente ? 'rgba(220,38,38,0.2)' : 'var(--color-border)'}`, display: 'flex', alignItems: 'center', gap: 16 } as React.CSSProperties}>
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: alerta.bgIcone }}>
                    <Icon size={18} style={{ color: alerta.corIcone }}/>
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
      </div>

      {/* ── Notificações salvas ── */}
      <div>
        <div className="flex items-baseline justify-between pb-3 mb-2">
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Histórico</span>
          {naoLidas > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'var(--color-primary)', color: '#fff' }}>
              {naoLidas} nova{naoLidas !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {notificacoes.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <Bell size={28} style={{ margin: '0 auto 12px', color: 'var(--color-ink4)' }}/>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink4)' }}>Nenhuma notificação registrada ainda.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {notificacoes.map((n, i) => (
              <div key={n.id} className="bm-stagger"
                style={{ '--bm-i': i % 8, '--bm-step': '50ms', background: n.lida ? 'var(--color-surface)' : 'var(--color-primary-soft)', border: `1px solid ${n.lida ? 'var(--color-border)' : 'rgba(44,23,80,0.15)'}`, borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: n.lida ? 0.7 : 1 } as React.CSSProperties}>
                {/* Ícone do tipo (fluxo de bloqueio) ou dot lida/não-lida */}
                {(() => {
                  const cfg = TIPO_NOTIF[n.tipo];
                  if (!cfg) return (
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: n.lida ? 'var(--color-border)' : 'var(--color-accent)', flexShrink: 0, marginTop: 6 }}/>
                  );
                  const Icon = cfg.icon;
                  return (
                    <div className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 10, background: cfg.bg, marginTop: 1 }}>
                      <Icon size={16} style={{ color: cfg.cor }}/>
                    </div>
                  );
                })()}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-start justify-between gap-2">
                    <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: n.lida ? 'var(--color-ink2)' : 'var(--color-ink)' }}>{n.titulo}</p>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink4)', flexShrink: 0 }}>
                      {format(parseISO(n.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  {n.mensagem && <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink3)', marginTop: 3 }}>{n.mensagem}</p>}
                </div>
                {!n.lida && (
                  <button onClick={() => marcarLida(n.id)} className="press w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                    <Check size={13}/>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
