import { Sk } from '@/components/Skeleton';

export default function EstoqueLoading() {
  return (
    <div>
      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <Sk className="h-3 w-32 mb-2" />
            <Sk className="h-9 w-32" />
          </div>
          <Sk className="h-9 w-36 rounded-xl" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
          <Sk className="h-9 w-24 rounded-t-lg flex-shrink-0" />
          <Sk className="h-9 w-32 rounded-t-lg flex-shrink-0" />
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

        {/* Busca + filtro */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
          <Sk className="h-10 flex-1 rounded-xl" />
          <Sk className="h-10 w-full sm:w-36 rounded-xl" />
        </div>

        {/* Tags de categoria */}
        <div className="flex gap-2 mb-5 overflow-x-auto">
          {[1,2,3,4,5].map(i => (
            <Sk key={i} className="h-7 w-20 rounded-full flex-shrink-0" />
          ))}
        </div>

        {/* Tabela de produtos com scroll horizontal */}
        <div className="bg-surface border border-border rounded-2xl overflow-x-auto shadow-sm">
          <div className="min-w-[600px]">
            <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-bg gap-2">
              {['col-span-4','col-span-2','col-span-2','col-span-2','col-span-2'].map((c,i) => (
                <div key={i} className={c}><Sk className="h-3 w-16" /></div>
              ))}
            </div>
            {[1,2,3,4,5].map(i => (
              <div key={i} className="grid grid-cols-12 items-center px-5 py-3.5 border-b border-border last:border-0 gap-2">
                <div className="col-span-4 flex items-center gap-3 min-w-0">
                  <Sk className="w-7 h-7 rounded-lg flex-shrink-0" />
                  <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <Sk className="h-4 w-full max-w-[140px]" />
                    <Sk className="h-3 w-1/2 max-w-[80px]" />
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
    </div>
  );
}
