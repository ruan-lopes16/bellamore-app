'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Banknote } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { CategoriaIcon, CATEGORIA_COR, CATEGORIA_BG } from '@/components/CategoriaIcon';
import type { CategoriaServico } from '@/components/CategoriaIcon';
import { addMonths, subMonths, startOfMonth, endOfMonth, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const supabase = createClient();

type ComissaoRow = {
  id: string;
  valor_servico: number;
  percentual: number;
  valor_comissao: number;
  status: 'pendente' | 'pago';
  created_at: string;
  agendamento: {
    data_hora_inicio: string | null;
    servico: { nome: string; categoria: string | null } | null;
  } | null;
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}

export default function ComissoesProfissionalView() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [mesRef,    setMesRef]    = useState(new Date());
  const [comissoes, setComissoes] = useState<ComissaoRow[]>([]);

  const isFuturo = startOfMonth(mesRef) > new Date();

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
    setLoading(true);
    const ini = startOfMonth(mesRef);
    const fim = endOfMonth(mesRef);
    const { data } = await supabase
      .from('comissoes')
      .select(`id, valor_servico, percentual, valor_comissao, status, created_at,
        agendamento:agendamentos(data_hora_inicio, servico:servicos(nome, categoria))`)
      .eq('empresa_id', empresaId)
      .gte('created_at', ini.toISOString())
      .lte('created_at', fim.toISOString())
      .order('created_at', { ascending: false });
    // RLS já restringe às próprias comissões — sem filtro extra necessário.
    setComissoes((data ?? []) as unknown as ComissaoRow[]);
    setLoading(false);
  }, [empresaId, mesRef]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const resumo = useMemo(() => {
    let total = 0, pendente = 0, pago = 0;
    for (const c of comissoes) {
      total += c.valor_comissao;
      if (c.status === 'pendente') pendente += c.valor_comissao;
      else pago += c.valor_comissao;
    }
    return { total, pendente, pago };
  }, [comissoes]);

  const mesLabel = format(mesRef, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase());

  return (
    <div className="bm-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Minha conta</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
            Minhas Comissões
          </h1>
        </div>
      </div>

      {/* Navegação de mês */}
      <div className="flex items-center justify-center gap-3 mb-5">
        <div className="bg-surface border border-border rounded-[20px] flex items-center gap-2 px-3 py-2">
          <button onClick={() => setMesRef(d => subMonths(d, 1))}
            className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition">
            <ChevronLeft size={16}/>
          </button>
          <span className="text-sm font-semibold text-text text-center" style={{ minWidth: 140 }}>{mesLabel}</span>
          <button onClick={() => !isFuturo && setMesRef(d => addMonths(d, 1))}
            disabled={isFuturo}
            className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition disabled:opacity-30">
            <ChevronRight size={16}/>
          </button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Total',    val: resumo.total,    cor: 'var(--color-primary)' },
          { label: 'Pendente', val: resumo.pendente, cor: 'var(--color-amber)'   },
          { label: 'Pago',     val: resumo.pago,     cor: 'var(--color-green)'   },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-2xl p-4"
            style={{ boxShadow: '0 1px 4px rgba(44,23,80,0.04)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-ink4)' }}>{s.label}</p>
            <p className="text-lg font-bold" style={{ color: s.cor, letterSpacing: '-0.02em' }}>
              {loading ? '—' : fmtBRL(s.val)}
            </p>
          </div>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-3">
              <Sk className="w-8 h-8 rounded-lg flex-shrink-0"/>
              <div className="flex-1"><Sk className="h-3.5 w-32 mb-1.5"/><Sk className="h-3 w-20"/></div>
              <Sk className="h-5 w-16"/>
            </div>
          ))}
        </div>
      ) : comissoes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Banknote size={28} className="mb-3" style={{ color: 'var(--color-ink4)' }}/>
          <h2 className="font-serif text-xl mb-1" style={{ color: 'var(--color-ink)' }}>Sem comissões</h2>
          <p className="text-sm" style={{ color: 'var(--color-ink3)' }}>Nenhum atendimento concluído neste mês.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(44,23,80,0.04)' }}>
          {comissoes.map((c, i) => {
            const cat = (c.agendamento?.servico?.categoria ?? 'outros') as CategoriaServico;
            const cor = CATEGORIA_COR[cat] ?? '#6B7280';
            const bg  = CATEGORIA_BG[cat]  ?? '#F3F4F6';
            return (
              <div key={c.id}
                className={`flex items-center gap-3 px-4 py-3 ${i < comissoes.length - 1 ? 'border-b border-border' : ''}`}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                  <CategoriaIcon categoria={cat} size={16} color={cor}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-ink)' }}>
                    {c.agendamento?.servico?.nome ?? '—'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-ink3)' }}>
                    {fmtBRL(c.valor_servico)} × {c.percentual}%
                    {c.agendamento?.data_hora_inicio && (
                      <span className="ml-1.5 opacity-70">
                        {format(parseISO(c.agendamento.data_hora_inicio), "dd/MM 'às' HH:mm")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold" style={{ color: 'var(--color-ink)' }}>{fmtBRL(c.valor_comissao)}</p>
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
      )}
    </div>
  );
}
