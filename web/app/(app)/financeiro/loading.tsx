import { Sk } from '@/components/Skeleton';

export default function FinanceiroLoading() {
  return (
    <div>
      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <Sk className="h-3 w-20 mb-2" />
            <Sk className="h-9 w-40" />
          </div>
          <div className="flex items-center gap-2">
            <Sk className="w-8 h-8 rounded-lg" />
            <Sk className="h-5 w-32" />
            <Sk className="w-8 h-8 rounded-lg" />
          </div>
        </div>

        {/* KPIs — linha 1 (3 cards) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-3 sm:mb-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <Sk className="h-3 w-1/3 mb-3 max-w-[100px]" />
              <Sk className="h-7 w-2/3 mb-2 max-w-[140px]" />
              <Sk className="h-3 w-1/2 max-w-[100px]" />
            </div>
          ))}
        </div>
        {/* KPIs — linha 2 (2 cards) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
          {[1,2].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <Sk className="h-3 w-1/3 mb-3 max-w-[100px]" />
              <Sk className="h-7 w-2/3 mb-2 max-w-[140px]" />
              <Sk className="h-3 w-1/2 max-w-[90px]" />
            </div>
          ))}
        </div>

        {/* Gráfico */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm mb-6 h-52">
          <Sk className="h-4 w-40 mb-5 max-w-full" />
          <div className="flex items-end gap-2 sm:gap-3 h-28">
            {[70,50,90,60,80,100,45].map((h,i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <Sk className="w-full rounded-t-sm" style={{ height: `${h}%` }} />
                <Sk className="h-2.5 w-6 sm:w-8" />
              </div>
            ))}
          </div>
        </div>

        {/* Despesas */}
        <div className="flex items-center justify-between mb-3 gap-3">
          <Sk className="h-5 w-32" />
          <Sk className="h-9 w-32 rounded-xl flex-shrink-0" />
        </div>
        <div className="flex flex-col gap-2">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <Sk className="h-4 w-2/3 max-w-[160px]" />
                <Sk className="h-3 w-1/2 max-w-[100px]" />
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <Sk className="h-4 w-14" />
                <Sk className="h-5 w-12 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
