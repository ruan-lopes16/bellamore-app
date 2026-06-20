import { Sk } from '@/components/Skeleton';

export default function ClientesLoading() {
  return (
    <div>
      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <Sk className="h-3 w-28 mb-2" />
            <Sk className="h-9 w-36" />
          </div>
          <Sk className="h-9 w-32 rounded-xl" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-6">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <Sk className="h-5 w-10" />
                <Sk className="h-3 w-2/3 max-w-[100px]" />
              </div>
            </div>
          ))}
        </div>

        {/* Busca */}
        <Sk className="h-10 w-full rounded-xl mb-4" />

        {/* Tabela com scroll horizontal no mobile */}
        <div className="bg-surface border border-border rounded-2xl overflow-x-auto shadow-sm">
          <div className="min-w-[520px]">
            <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-bg gap-2">
              {['col-span-4','col-span-3','col-span-3','col-span-2'].map((c,i) => (
                <div key={i} className={c}><Sk className="h-3 w-16" /></div>
              ))}
            </div>
            {[1,2,3,4,5].map(i => (
              <div key={i} className="grid grid-cols-12 items-center px-5 py-3.5 border-b border-border last:border-0 gap-2">
                <div className="col-span-4 flex items-center gap-3 min-w-0">
                  <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
                  <Sk className="h-4 flex-1 max-w-[140px]" />
                </div>
                <div className="col-span-3"><Sk className="h-4 w-full max-w-[100px]" /></div>
                <div className="col-span-3"><Sk className="h-4 w-full max-w-[120px]" /></div>
                <div className="col-span-2"><Sk className="h-4 w-14" /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
