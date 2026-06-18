import { Sk } from '@/components/Skeleton';

export default function EstoqueLoading() {
  return (
    <div>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Sk className="h-3 w-32 mb-2" />
            <Sk className="h-9 w-32" />
          </div>
          <Sk className="h-9 w-36 rounded-xl" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-6">
          <Sk className="h-9 w-24 rounded-t-lg" />
          <Sk className="h-9 w-32 rounded-t-lg" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
              <div className="flex flex-col gap-2 flex-1">
                <Sk className="h-5 w-10" />
                <Sk className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>

        {/* Busca + filtro */}
        <div className="flex items-center gap-3 mb-3">
          <Sk className="h-10 flex-1 rounded-xl" />
          <Sk className="h-10 w-36 rounded-xl" />
        </div>

        {/* Tags de categoria */}
        <div className="flex gap-2 mb-5">
          {[1,2,3,4,5].map(i => (
            <Sk key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>

        {/* Tabela de produtos */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-bg gap-2">
            {['col-span-4','col-span-2','col-span-2','col-span-2','col-span-2'].map((c,i) => (
              <div key={i} className={c}><Sk className="h-3 w-16" /></div>
            ))}
          </div>
          {[1,2,3,4,5].map(i => (
            <div key={i} className="grid grid-cols-12 items-center px-5 py-3.5 border-b border-border last:border-0">
              <div className="col-span-4 flex items-center gap-3">
                <Sk className="w-7 h-7 rounded-lg flex-shrink-0" />
                <div className="flex flex-col gap-1.5">
                  <Sk className="h-4 w-32" />
                  <Sk className="h-3 w-16" />
                </div>
              </div>
              <div className="col-span-2"><Sk className="h-5 w-14 rounded-full" /></div>
              <div className="col-span-2"><Sk className="h-4 w-12" /></div>
              <div className="col-span-2"><Sk className="h-4 w-10" /></div>
              <div className="col-span-2 flex justify-end gap-2">
                <Sk className="w-8 h-8 rounded-lg" />
                <Sk className="w-8 h-8 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
