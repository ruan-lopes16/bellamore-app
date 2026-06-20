import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Cliente Detalhe — corresponde ao layout real:
 * voltar + hero gradient (avatar + nome + ações + 3 KPIs)
 * + tabs (Info / Histórico / Anamnese) + sidebar
 */
export default function ClienteDetalheLoading() {
  return (
    <div>
      {/* Voltar */}
      <Sk className="h-4 w-20 mb-4" />

      {/* Hero gradient */}
      <div className="rounded-2xl p-5 mb-6"
        style={{ background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)' }}>
        <div className="flex items-start gap-4 mb-5">
          <div className="w-16 h-16 rounded-2xl flex-shrink-0 bg-white/15" />
          <div className="flex-1 min-w-0 flex flex-col gap-2 pt-1">
            <div className="h-6 w-3/4 max-w-[200px] rounded bg-white/15" />
            <div className="h-3 w-1/2 max-w-[160px] rounded bg-white/10" />
          </div>
          <div className="w-8 h-8 rounded-[10px] bg-white/10 flex-shrink-0" />
        </div>
        {/* Botões */}
        <div className="flex flex-wrap gap-2 mb-5">
          <div className="flex-1 min-w-[90px] h-10 rounded-xl bg-white/90" />
          <div className="flex-1 min-w-[90px] h-10 rounded-xl bg-white/10" />
          <div className="flex-1 min-w-[90px] h-10 rounded-xl bg-white/10" />
        </div>
        {/* KPIs hero */}
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3].map(i => (
            <div key={i} className="rounded-[14px] p-3" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-5 w-12 rounded bg-white/15 mb-1.5" />
              <div className="h-3 w-3/4 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Coluna principal */}
        <div className="flex-1 min-w-0 w-full">
          {/* Tabs */}
          <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 mb-5 w-fit">
            {[80, 90, 80].map((w, i) => (
              <Sk key={i} className="h-8 rounded-lg" style={{ width: `${w}px` }} />
            ))}
          </div>
          {/* Card de info */}
          <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <Sk className="h-4 w-32" />
              <Sk className="h-4 w-12" />
            </div>
            <div className="p-5 flex flex-col gap-5">
              {[1,2,3,4].map(i => (
                <div key={i}>
                  <Sk className="h-3 w-20 mb-2" />
                  <Sk className="h-4 w-full max-w-xs" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-72 lg:flex-shrink-0 flex flex-col gap-4">
          {/* Ações rápidas */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
            <Sk className="h-3 w-24 mb-3" />
            <Sk className="h-9 w-full rounded-xl" />
          </div>
          {/* Informações */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <Sk className="h-3 w-24 mb-1" />
            {[1,2,3].map(i => (
              <div key={i}>
                <Sk className="h-3 w-14 mb-1.5" />
                <Sk className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
