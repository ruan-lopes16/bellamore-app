import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Agenda — corresponde ao layout real:
 * header com toggle de 3 views + export + novo + navegador semana + lista
 */
export default function AgendaLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-24 mb-2" />
          <Sk className="h-8 w-32" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle 3 views (Semana / Mês / Timeline) */}
          <Sk className="h-10 w-44 rounded-2xl" />
          {/* Exportar */}
          <Sk className="h-10 w-24 rounded-2xl" />
          {/* Novo */}
          <Sk className="h-10 w-20 rounded-2xl" />
        </div>
      </div>

      {/* Navegador semana */}
      <div className="flex justify-center mb-6">
        <div className="bg-surface border border-border rounded-[20px] py-3 px-2 sm:px-4 max-w-full overflow-x-auto">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <Sk className="w-8 h-8 rounded-[10px] flex-shrink-0" />
            <div className="flex gap-0.5 sm:gap-1">
              {[1,2,3,4,5,6,7].map(i => (
                <div key={i} className="w-9 sm:w-11 flex flex-col items-center py-2 gap-1 flex-shrink-0">
                  <Sk className="h-2.5 w-6" />
                  <Sk className="h-5 w-5 rounded" />
                </div>
              ))}
            </div>
            <Sk className="w-8 h-8 rounded-[10px] flex-shrink-0" />
          </div>
        </div>
      </div>

      {/* Lista de agendamentos do dia */}
      <Sk className="h-4 w-40 mb-3" />
      <div className="flex flex-col gap-3">
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-start gap-3">
            <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Sk className="h-4 w-1/2 max-w-[140px]" />
                <Sk className="h-5 w-16 rounded-lg flex-shrink-0" />
              </div>
              <Sk className="h-3 w-2/3 max-w-[180px]" />
              <Sk className="h-3 w-1/3 max-w-[100px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
