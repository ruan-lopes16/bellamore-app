import { Sk } from '@/components/Skeleton';

/**
 * Skeletons do Financeiro — uma definição só, compartilhada pelo `loading.tsx`
 * (skeleton de navegação do App Router) e pelo `page.tsx` (gate `loading` do
 * fetch, que re-dispara a cada troca de mês). Assim os dois não divergem e
 * ambos batem com a grade real de `page.tsx`.
 */

/**
 * Grade única de KPIs — mesma do real: `grid-cols-2 lg:grid-cols-3`, 7 cards,
 * o último ocupando a linha no mobile quando a contagem é ímpar.
 */
export function KpisFinanceiroSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
      {[1, 2, 3, 4, 5, 6, 7].map((i, idx, arr) => (
        <div key={i}
          className={`bg-surface border border-border rounded-2xl p-3 sm:p-5 shadow-sm min-w-0 ${
            idx === arr.length - 1 && arr.length % 2 === 1 ? 'col-span-2 lg:col-span-1' : ''
          }`}>
          <Sk className="h-3 w-1/3 mb-3 max-w-[100px]" />
          <Sk className="h-7 w-2/3 mb-3 max-w-[140px]" />
          <Sk className="h-3 w-1/2 max-w-[120px]" />
        </div>
      ))}
    </div>
  );
}

/**
 * Grid de evolução + top serviços + lista de despesas (a despesa ocupa a linha
 * inteira no desktop, `md:col-span-2`, igual ao real quando não há métodos).
 */
export function GraficosDespesasSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Evolução */}
      <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
        <Sk className="h-5 w-36 mb-5" />
        <div className="flex items-end gap-3 h-24">
          {[60, 80, 45, 90, 70, 100].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <Sk className="w-full rounded-t-sm" style={{ height: `${h}%` }} />
              <Sk className="h-2.5 w-6" />
            </div>
          ))}
        </div>
      </div>
      {/* Top serviços */}
      <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
        <Sk className="h-5 w-1/3 max-w-[140px] mb-4" />
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Sk className="h-5 w-5 flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="flex justify-between gap-2">
                  <Sk className="h-3 flex-1 max-w-[140px]" />
                  <Sk className="h-3 w-14 flex-shrink-0" />
                </div>
                <Sk className="h-1.5 w-full rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Despesas */}
      <div className="md:col-span-2 bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border gap-3">
          <Sk className="h-5 w-1/3 max-w-[100px]" />
          <Sk className="h-4 w-16 flex-shrink-0" />
        </div>
        <div className="p-5 flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <Sk className="h-3.5 w-2/3 max-w-[180px]" />
                <Sk className="h-3 w-1/2 max-w-[120px]" />
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <Sk className="h-4 w-16" />
                <Sk className="h-4 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton da página inteira — usado pelo `loading.tsx` durante a navegação.
 * Header + seletor de mês (placeholders) + as mesmas peças que o `page.tsx`
 * usa no gate de fetch.
 */
export default function FinanceiroSkeleton() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div>
            <Sk className="h-3 w-20 mb-2" />
            <Sk className="h-8 w-36" />
          </div>
          <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
        </div>
        <Sk className="h-10 w-28 rounded-xl" />
      </div>

      {/* Seletor de mês (centralizado) */}
      <div className="flex items-center justify-center mb-6">
        <div className="bg-surface border border-border rounded-2xl p-3 flex items-center gap-3 shadow-sm">
          <Sk className="w-8 h-8 rounded-lg" />
          <div className="w-36 flex flex-col items-center gap-1.5">
            <Sk className="h-4 w-24" />
            <Sk className="h-3 w-20" />
          </div>
          <Sk className="w-8 h-8 rounded-lg" />
        </div>
      </div>

      <KpisFinanceiroSkeleton />
      <GraficosDespesasSkeleton />
    </div>
  );
}
