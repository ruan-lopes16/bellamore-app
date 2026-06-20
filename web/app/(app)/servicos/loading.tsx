import { Sk } from '@/components/Skeleton';

export default function ServicosLoading() {
  return (
    <div>
      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <Sk className="h-3 w-20 mb-2" />
            <Sk className="h-9 w-36" />
          </div>
          <Sk className="h-9 w-36 rounded-xl" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
              <Sk className="h-7 w-12 mb-2" />
              <Sk className="h-3 w-2/3 max-w-[80px]" />
            </div>
          ))}
        </div>

        {/* Grupos de categoria */}
        <div className="flex flex-col gap-8">
          {[1,2].map(group => (
            <div key={group}>
              <div className="flex items-center gap-2.5 mb-3">
                <Sk className="w-7 h-7 rounded-lg flex-shrink-0" />
                <Sk className="h-3 w-20" />
                <Sk className="h-3 w-14 ml-auto" />
              </div>
              <div className="flex flex-col gap-2">
                {[1,2,3].map(i => (
                  <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
                    <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <Sk className="h-4 w-2/3 max-w-[160px]" />
                      <Sk className="h-3 w-1/2 max-w-[100px]" />
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Sk className="h-5 w-14" />
                      <Sk className="w-8 h-8 rounded-lg" />
                    </div>
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
