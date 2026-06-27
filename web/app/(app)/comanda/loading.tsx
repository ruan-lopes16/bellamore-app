import { Sk } from '@/components/Skeleton';

export default function ComandaLoading() {
  return (
    <div className="flex -mt-6 -mb-24 -mx-4 md:-mt-8 md:-mb-10 md:-mx-8 overflow-hidden" style={{ height: '100dvh' }}>

      {/* Painel esquerdo — mesma largura que o estado carregado */}
      <div className="w-full md:w-[26rem] flex-shrink-0 border-r border-border bg-bg flex flex-col">

        {/* Header: label + título + toggle + week strip */}
        <div className="px-3 pt-3 pb-2 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <Sk className="h-2.5 w-20 mb-1.5" />
              <Sk className="h-7 w-28" />
            </div>
            <Sk className="h-8 w-[88px] rounded-xl flex-shrink-0" />
          </div>
          {/* Week strip: prev + 7 dias + next */}
          <div className="flex items-center gap-0.5">
            <Sk className="w-7 h-7 rounded-[10px] flex-shrink-0" />
            <div className="flex gap-0.5 flex-1 justify-between">
              {[1,2,3,4,5,6,7].map(i => (
                <Sk key={i} className="flex-1 h-10 rounded-[12px]" />
              ))}
            </div>
            <Sk className="w-7 h-7 rounded-[10px] flex-shrink-0" />
          </div>
        </div>

        {/* Lista de clientes */}
        <div className="p-2 flex flex-col gap-1">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="rounded-xl p-3 border border-border flex items-start gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <Sk className="h-3.5 w-2/3 max-w-[120px]" />
                <Sk className="h-3 w-1/2 max-w-[80px]" />
              </div>
              <Sk className="h-5 w-14 rounded-lg flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Painel direito — empty state (desktop) */}
      <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-3">
        <Sk className="w-14 h-14 rounded-2xl" />
        <Sk className="h-6 w-48" />
        <Sk className="h-4 w-64" />
      </div>

    </div>
  );
}
