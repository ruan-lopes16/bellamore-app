import { Sk } from '@/components/Skeleton';

/**
 * Skeletons de Relatórios — uma definição só, compartilhada pelo `loading.tsx`
 * (skeleton de navegação do App Router) e pelo `page.tsx` (gate `loading` do
 * fetch, que re-dispara a cada troca de período). Assim os dois não divergem.
 *
 * O `page.tsx` continua interleavando (chrome fixo, só as áreas de dados
 * trocam) para o seletor de período não piscar na navegação — o que some é a
 * divergência entre os dois skeletons.
 */

/** Um card de KPI (ícone + duas linhas de texto) — igual ao branch `loading` de `KpiCard`. */
export function KpiCardSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-2xl p-3 sm:p-4 shadow-sm flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3 min-w-0">
      <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col gap-2 w-full">
        <Sk className="h-5 w-1/2 max-w-[60px]" />
        <Sk className="h-3 w-2/3 max-w-[100px]" />
      </div>
    </div>
  );
}

/** Grade de KPIs — mesma do real: `grid-cols-2 md:grid-cols-4`, 8 cards. */
export function KpisRelatoriosSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {Array.from({ length: 8 }).map((_, i) => <KpiCardSkeleton key={i} />)}
    </div>
  );
}

/** Card do gráfico "Evolução de faturamento" — título + barras (altura 140). */
export function GraficoEvolucaoSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
      <Sk className="h-5 w-2/3 max-w-[200px] mb-4" />
      <div className="flex items-end gap-2" style={{ height: 140 }}>
        {[70, 50, 85, 40, 65, 55].map((h, i) => (
          <Sk key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton da página inteira — usado pelo `loading.tsx` durante a navegação.
 * Espelha o 1º paint real: header + pills de período + KPIs + abas + gráfico.
 * Sem os cards "Resumo financeiro / Despesas por categoria" — a tela real os
 * esconde enquanto `loading` (`{!loading && …}`).
 */
export default function RelatoriosSkeleton() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <Sk className="h-3 w-16 mb-2" />
          <Sk className="h-8 w-40" />
        </div>
      </div>

      {/* Pills de período */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[64, 56, 48, 72].map((w, i) => (
          <Sk key={i} className="h-8 rounded-full" style={{ width: w }} />
        ))}
      </div>

      <KpisRelatoriosSkeleton />

      {/* Barra de abas (underline) */}
      <div className="flex gap-4 border-b border-border mb-6 overflow-x-auto">
        {[80, 72, 64, 72, 68, 84].map((w, i) => (
          <Sk key={i} className="h-9 rounded-t-md flex-shrink-0 mb-px" style={{ width: w }} />
        ))}
      </div>

      <GraficoEvolucaoSkeleton />
    </div>
  );
}
