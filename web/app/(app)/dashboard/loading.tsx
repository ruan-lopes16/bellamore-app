import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da Dashboard — espelha o layout real de `page.tsx`:
 * header (nav de mês + título) + hero receita + 4 KPIs do mês + 3 KPIs do dia
 * + "Meta do mês" + 4 ações rápidas + grid agenda/alertas.
 *
 * Blocos condicionais (Reconquistar / Aniversariantes) ficam de fora de
 * propósito — somem com frequência e desenhá-los causaria o pulo inverso.
 */
export default function DashboardLoading() {
  return (
    <div className="max-w-5xl mx-auto w-full">
      {/* Header — linha de navegação de mês + título/olho */}
      <div className="mb-6">
        <div className="flex items-center gap-1 mb-1">
          <Sk className="w-[22px] h-[22px] rounded-md flex-shrink-0" />
          <Sk className="h-2.5 w-28" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Sk className="h-8 w-40" />
          <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
        </div>
      </div>

      {/* Hero receita gradient */}
      <div className="rounded-3xl mb-4 h-[140px]"
        style={{ background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)', padding: '22px 28px' }}>
        <div className="h-2.5 w-40 rounded bg-white/10 mb-3" />
        <div className="h-9 w-44 rounded bg-white/15 mb-4" />
        <div className="flex items-center gap-3">
          <div className="h-5 w-20 rounded-full bg-white/10" />
          <div className="h-3 w-24 rounded bg-white/10" />
        </div>
      </div>

      {/* KPIs do mês — 4 cards (2x2 mobile, 4 colunas desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-surface border border-border-soft rounded-2xl p-3 md:p-5 shadow-sm min-w-0">
            <div className="flex items-start justify-between mb-2 gap-1">
              <Sk className="h-2.5 w-2/3 max-w-[70px]" />
              <Sk className="w-3 h-3 rounded flex-shrink-0" />
            </div>
            <Sk className="h-4 w-3/4 max-w-[90px]" />
            <Sk className="h-2.5 w-2/3 max-w-[80px] mt-1.5" />
          </div>
        ))}
      </div>

      {/* KPIs do dia — 3 cards compactos */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-7">
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border-soft rounded-2xl p-3 md:p-5 shadow-sm min-w-0">
            <div className="flex items-start justify-between mb-2 gap-1">
              <Sk className="h-2.5 w-2/3 max-w-[60px]" />
              <Sk className="w-3 h-3 rounded flex-shrink-0" />
            </div>
            <Sk className="h-5 w-1/2 max-w-[40px] mb-1" />
            <Sk className="h-2.5 w-3/4 max-w-[80px]" />
          </div>
        ))}
      </div>

      {/* Meta do mês */}
      <div className="mb-4 rounded-2xl p-4 md:p-5 bg-surface border border-border-soft shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Sk className="w-3.5 h-3.5 rounded flex-shrink-0" />
          <Sk className="h-2.5 w-24" />
          <Sk className="h-3 w-28 ml-auto" />
        </div>
        <Sk className="h-2 w-full rounded-full" />
        <Sk className="h-2.5 w-44 mt-2" />
      </div>

      {/* Ações rápidas */}
      <div className="mb-7">
        <Sk className="h-3 w-28 mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Sk className="w-14 h-14 rounded-2xl" />
              <Sk className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Grid Agenda hoje + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Agenda do dia */}
        <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sk className="w-3.5 h-3.5 rounded" />
            <Sk className="h-3 w-36" />
          </div>
          <div className="flex flex-col gap-2">
            {[1,2,3].map(i => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg border border-border">
                <Sk className="w-12 h-4 rounded flex-shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <Sk className="h-3.5 w-2/3 max-w-[160px]" />
                  <Sk className="h-3 w-1/2 max-w-[100px]" />
                </div>
                <Sk className="h-5 w-16 rounded-lg flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Alertas */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sk className="w-3.5 h-3.5 rounded" />
            <Sk className="h-3 w-20" />
          </div>
          <div className="flex flex-col gap-2">
            {[1,2].map(i => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-bg border border-border">
                <Sk className="w-3.5 h-3.5 rounded flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <Sk className="h-3 w-2/3 max-w-[140px]" />
                  <Sk className="h-3 w-1/2 max-w-[120px]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
