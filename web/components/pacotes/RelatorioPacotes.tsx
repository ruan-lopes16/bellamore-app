'use client';

/**
 * @file RelatorioPacotes.tsx
 * Aba Relatório de Pacotes: utilização (sessões totais/usadas, aproveitamento) e receita pela regra
 * única de `calcularRelatorioUtilizacao` (shared/pacotes-consultas.ts) — receita só dos pacotes
 * pagos (o "a cobrar" ainda não entrou no faturamento), a mesma que o Financeiro soma pelas vendas.
 * Erro de carga mostra "—" e o aviso, nunca zeros.
 */
import { AlertCircle } from 'lucide-react';
import { Sk } from '@/components/Skeleton';
import { formatarMoeda as fmtBRL } from '@shared/moeda';
import type { RelatorioUtilizacao } from '@shared/pacotes-consultas';

const corPct = (pct: number) => (pct >= 80 ? '#16A34A' : pct >= 50 ? '#D97706' : '#7C3AED');

export function RelatorioPacotes({
  relatorio, loading, erro, sessoesRestantes, onTentarDeNovo,
}: {
  relatorio: RelatorioUtilizacao | null;
  loading: boolean;
  erro: string | null;
  /** Sessões que sobram nos pacotes ativos (da aba Vendidos); null = indisponível. */
  sessoesRestantes: number | null;
  onTentarDeNovo: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Sk key={i} className="h-20 rounded-2xl"/>)}</div>
        <Sk className="h-48 rounded-2xl"/>
      </div>
    );
  }
  if (erro) {
    return (
      <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20">
        <AlertCircle size={14} className="text-red flex-shrink-0"/>
        <p className="text-sm text-red flex-1">{erro}</p>
        <button onClick={onTentarDeNovo} className="text-xs font-bold text-primary underline flex-shrink-0">Tentar de novo</button>
      </div>
    );
  }
  if (!relatorio || relatorio.vendas === 0) {
    return (
      <div className="text-center py-16">
        <AlertCircle size={36} className="mx-auto mb-3 text-text-4"/>
        <p className="text-text-3 text-sm">Nenhum pacote vendido para gerar relatório.</p>
      </div>
    );
  }

  const pagos = relatorio.vendas - relatorio.aCobrar;
  const kpis = [
    { label: 'Total de sessões',    value: String(relatorio.totalSessoes),  sub: 'combo e ilimitado não somam' },
    { label: 'Sessões realizadas',  value: String(relatorio.sessoesUsadas), sub: `${relatorio.aproveitamento}% de aproveitamento` },
    { label: 'Sessões restantes',   value: sessoesRestantes == null ? '—' : String(sessoesRestantes), sub: 'em pacotes ativos' },
    { label: 'Receita com pacotes', value: fmtBRL(relatorio.receitaTotal),  sub: `${pagos} paga${pagos !== 1 ? 's' : ''}${relatorio.aCobrar > 0 ? ` · ${relatorio.aCobrar} a cobrar` : ''}` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {kpis.map(({ label, value, sub }) => (
          <div key={label} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <p className="text-xs text-text-4 uppercase tracking-wide font-semibold mb-2">{label}</p>
            <p className="text-lg sm:text-2xl font-bold text-text mb-1 whitespace-nowrap tabular-nums">{value}</p>
            <p className="text-[11px] text-text-4">{sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="font-serif text-lg text-text">Aproveitamento global</p>
          <span className="text-sm font-bold text-text">{relatorio.aproveitamento}%</span>
        </div>
        <div className="h-3 bg-bg rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(relatorio.aproveitamento, 100)}%`, background: corPct(relatorio.aproveitamento) }}/>
        </div>
        <div className="flex justify-between mt-2 text-xs text-text-4">
          <span>{relatorio.sessoesUsadas} realizadas</span>
          <span>{Math.max(0, relatorio.totalSessoes - relatorio.sessoesUsadas)} restantes</span>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
        <p className="font-serif text-lg text-text px-5 pt-5 pb-4 border-b border-border">Utilização por pacote</p>
        <div className="divide-y divide-border">
          {relatorio.porPacote.map(p => {
            const pct = p.totalSessoes > 0 ? Math.round((p.sessoesUsadas / p.totalSessoes) * 100) : 0;
            return (
              <div key={p.pacote_id || p.nome} className="px-5 py-4">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-text truncate">{p.nome}</p>
                  <span className="text-xs font-bold text-text-2 flex-shrink-0">{fmtBRL(p.receita)}</span>
                </div>
                {!p.combo && (
                  <div className="h-2 bg-bg rounded-full overflow-hidden mb-1.5">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: corPct(pct) }}/>
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] text-text-4">
                  <span>{p.combo ? 'Combo · sem controle de sessões' : `${p.sessoesUsadas}/${p.totalSessoes} sessões · ${pct}% aproveitamento`}</span>
                  <span>{p.vendas} venda{p.vendas !== 1 ? 's' : ''}{p.aCobrar > 0 ? ` · ${p.aCobrar} a cobrar` : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
