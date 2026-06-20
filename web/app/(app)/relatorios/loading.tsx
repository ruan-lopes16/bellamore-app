import { Sk } from '@/components/Skeleton';

/** Skeleton de carregamento da tela de Relatórios */
export default function RelatoriosLoading() {
  return (
    <div>
      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <div>
            <Sk className="h-3 w-16 mb-2" />
            <Sk className="h-9 w-36" />
            <Sk className="h-3 w-28 mt-2" />
          </div>
          <Sk className="h-10 w-32 rounded-xl" />
        </div>

        {/* KPIs 6 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <Sk className="h-5 w-1/2 max-w-[60px]" />
                <Sk className="h-3 w-2/3 max-w-[100px]" />
              </div>
            </div>
          ))}
        </div>

        {/* Abas */}
        <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
          {[1, 2, 3, 4, 5].map(i => (
            <Sk key={i} className="h-9 w-24 rounded-t-lg flex-shrink-0" />
          ))}
        </div>

        {/* Gráfico de barras */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm mb-4">
          <Sk className="h-5 w-48 mb-4 max-w-full" />
          <div className="flex items-end gap-2" style={{ height: 140 }}>
            {[70, 45, 85, 55, 30, 90].map((h, i) => (
              <Sk key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        {/* Dois cards lado a lado */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <Sk className="h-5 w-2/3 max-w-[200px] mb-4" />
              <div className="flex flex-col gap-3">
                {[1, 2, 3, 4].map(j => (
                  <div key={j} className="flex items-center gap-3">
                    <Sk className="h-3 w-16 sm:w-24 flex-shrink-0" />
                    <Sk className="flex-1 h-2 rounded-full" />
                    <Sk className="h-3 w-12 sm:w-16 flex-shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
