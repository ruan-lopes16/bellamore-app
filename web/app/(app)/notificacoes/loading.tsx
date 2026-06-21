import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Notificações — corresponde ao layout real:
 * header (com badge não-lidas) + filtro futuras + lista de alertas
 */
export default function NotificacoesLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-20 mb-2" />
          <Sk className="h-8 w-40" />
        </div>
        <Sk className="h-8 w-24 rounded-full" />
      </div>

      {/* Filtro */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto">
        <Sk className="h-8 w-28 rounded-full flex-shrink-0" />
        <Sk className="h-8 w-32 rounded-full flex-shrink-0" />
      </div>

      {/* Lista de alertas */}
      <div className="flex flex-col gap-3 mb-8">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4 flex items-start gap-3 sm:gap-4">
            <Sk className="w-10 h-10 rounded-xl flex-shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <Sk className="h-4 w-3/4 max-w-[200px]" />
              <Sk className="h-3 w-full max-w-[260px]" />
              <Sk className="h-3 w-1/3 max-w-[80px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
