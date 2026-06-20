import { Sk } from '@/components/Skeleton';

export default function AgendaLoading() {
  return (
    <div>
      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <Sk className="h-3 w-24 mb-2" />
            <Sk className="h-9 w-32" />
          </div>
          <div className="flex items-center gap-2">
            <Sk className="h-9 w-28 rounded-xl" />
            <Sk className="h-9 w-20 rounded-xl" />
          </div>
        </div>

        {/* Calendário semanal */}
        <div className="flex justify-center mb-6">
          <div className="bg-surface border border-border rounded-2xl p-3 sm:p-4 max-w-full overflow-x-auto">
            <div className="flex items-center gap-1 sm:gap-2">
              <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
              <div className="flex gap-0.5 sm:gap-1">
                {[1,2,3,4,5,6,7].map(i => (
                  <div key={i} className="w-10 sm:w-12 flex flex-col items-center py-2.5 gap-1.5 flex-shrink-0">
                    <Sk className="h-2.5 w-6" />
                    <Sk className="w-8 h-8 rounded-xl" />
                  </div>
                ))}
              </div>
              <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
            </div>
          </div>
        </div>

        {/* Lista de agendamentos */}
        <Sk className="h-4 w-40 mb-3" />
        <div className="flex flex-col gap-3">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-start gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Sk className="h-4 w-32" />
                  <Sk className="h-5 w-20 rounded-lg flex-shrink-0" />
                </div>
                <Sk className="h-3 w-40" />
                <Sk className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
