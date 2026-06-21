import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Comissões — corresponde ao layout real:
 * header + month selector + 3 stat cards + filter pills + cards por profissional
 */
export default function ComissoesLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-16 mb-2" />
          <Sk className="h-8 w-32" />
        </div>
        <Sk className="h-9 w-28 rounded-xl" />
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <Sk className="w-8 h-8 rounded-lg" />
        <Sk className="h-5 w-32" />
        <Sk className="w-8 h-8 rounded-lg" />
      </div>

      {/* 3 KPI stats (Total / Pendente / Pago) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4">
            <Sk className="h-2.5 w-1/3 mb-2 max-w-[60px]" />
            <Sk className="h-5 w-2/3 max-w-[120px]" />
          </div>
        ))}
      </div>

      {/* Filter pills (Todas / Pendentes / Pagas) */}
      <div className="flex gap-2 mb-5 overflow-x-auto">
        {[70, 100, 80].map((w, i) => (
          <Sk key={i} className="h-8 rounded-full flex-shrink-0" style={{ width: `${w}px` }} />
        ))}
      </div>

      {/* Cards por profissional */}
      <div className="flex flex-col gap-4">
        {[1,2].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            {/* Header com avatar + nome + pendente */}
            <div className="flex items-center gap-3 mb-4">
              <Sk className="w-10 h-10 rounded-xl flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <Sk className="h-4 w-3/4 max-w-[160px] mb-1.5" />
                <Sk className="h-3 w-1/2 max-w-[100px]" />
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <Sk className="h-3 w-16" />
                <Sk className="h-5 w-20" />
              </div>
            </div>
            {/* Linhas de comissões */}
            {[1,2].map(j => (
              <div key={j} className="h-12 w-full rounded-xl mb-2 last:mb-0 bg-bg" />
            ))}
            {/* Botão pagar */}
            <Sk className="h-10 w-full rounded-xl mt-3" />
          </div>
        ))}
      </div>
    </div>
  );
}
