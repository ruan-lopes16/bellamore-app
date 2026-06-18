import AppLayout from '@/components/AppLayout';
import { Sk } from '@/components/Skeleton';

export default function FinanceiroLoading() {
  return (
    <AppLayout>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
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
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <Sk className="h-3 w-24 mb-3" />
              <Sk className="h-7 w-28 mb-2" />
              <Sk className="h-3 w-20" />
            </div>
          ))}
        </div>
        {/* KPIs — linha 2 (2 cards) */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {[1,2].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <Sk className="h-3 w-20 mb-3" />
              <Sk className="h-7 w-24 mb-2" />
              <Sk className="h-3 w-16" />
            </div>
          ))}
        </div>

        {/* Gráfico */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm mb-6 h-52">
          <Sk className="h-4 w-40 mb-5" />
          <div className="flex items-end gap-3 h-28">
            {[70,50,90,60,80,100,45].map((h,i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <Sk className="w-full rounded-t-sm" style={{ height: `${h}%` }} />
                <Sk className="h-2.5 w-8" />
              </div>
            ))}
          </div>
        </div>

        {/* Despesas */}
        <div className="flex items-center justify-between mb-3">
          <Sk className="h-5 w-32" />
          <Sk className="h-9 w-36 rounded-xl" />
        </div>
        <div className="flex flex-col gap-2">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <Sk className="h-4 w-36" />
                <Sk className="h-3 w-24" />
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Sk className="h-4 w-16" />
                <Sk className="h-5 w-14 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
