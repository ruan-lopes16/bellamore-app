import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Financeiro — corresponde ao layout real:
 * header + seletor mês + 5 KPIs (3+2) + grid 2 colunas (evolução / top serviços / despesas)
 */
export default function FinanceiroLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-20 mb-2" />
          <Sk className="h-8 w-36" />
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

      {/* KPIs — linha 1 (3 cards: Bruto / Comissões / Líquido) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-3 sm:mb-4">
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <Sk className="h-3 w-1/2 mb-2 max-w-[140px]" />
            <Sk className="h-7 w-2/3 mb-2 max-w-[140px]" />
            <Sk className="h-3 w-3/4 max-w-[160px]" />
          </div>
        ))}
      </div>
      {/* KPIs — linha 2 (2 cards: Gastos / Lucro) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
        {[1,2].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <Sk className="h-3 w-1/2 mb-2 max-w-[140px]" />
            <Sk className="h-7 w-2/3 mb-2 max-w-[140px]" />
            <Sk className="h-3 w-3/4 max-w-[160px]" />
          </div>
        ))}
      </div>

      {/* Grid de 2 colunas: Evolução + Top Serviços */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Evolução mensal (gráfico de barras 3-séries) */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4 gap-2">
            <Sk className="h-5 w-1/3 max-w-[150px]" />
            <div className="flex flex-wrap items-center gap-2">
              {[1,2,3].map(i => <Sk key={i} className="h-3 w-12" />)}
            </div>
          </div>
          <div className="flex items-end gap-3 h-32">
            {[60,80,45,90,70,100].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="w-full flex items-end gap-0.5 h-24">
                  <Sk className="flex-1 rounded-t-sm" style={{ height: `${h}%` }} />
                  <Sk className="flex-1 rounded-t-sm" style={{ height: `${h * 0.5}%` }} />
                  <Sk className="flex-1 rounded-t-sm" style={{ height: `${h * 0.3}%` }} />
                </div>
                <Sk className="h-2.5 w-6" />
              </div>
            ))}
          </div>
        </div>

        {/* Top serviços */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <Sk className="h-5 w-1/3 max-w-[140px] mb-4" />
          <div className="flex flex-col gap-3">
            {[1,2,3,4].map(i => (
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
      </div>

      {/* Despesas (cabeçalho + lista) */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border gap-3">
          <Sk className="h-5 w-1/3 max-w-[100px]" />
          <Sk className="h-4 w-16 flex-shrink-0" />
        </div>
        {[1,2,3].map(i => (
          <div key={i} className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0">
            <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <Sk className="h-4 w-2/3 max-w-[180px]" />
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
  );
}
