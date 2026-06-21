import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Pacotes — corresponde ao layout real:
 * header + 3 stats (icon + valor + label) + 3 tabs + grid de cards de pacote
 */
export default function PacotesLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-24 mb-2" />
          <Sk className="h-8 w-28" />
        </div>
        <Sk className="h-10 w-36 rounded-xl" />
      </div>

      {/* Stats: 3 cards (icon + valor + label) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3 min-w-0">
            <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Sk className="h-5 w-10" />
              <Sk className="h-3 w-2/3 max-w-[120px]" />
            </div>
          </div>
        ))}
      </div>

      {/* Tabs: Catalogo / Vendidos / Relatorio */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        <Sk className="h-9 w-24 rounded-t-lg flex-shrink-0" />
        <Sk className="h-9 w-32 rounded-t-lg flex-shrink-0" />
        <Sk className="h-9 w-24 rounded-t-lg flex-shrink-0" />
      </div>

      {/* Grid de pacotes (3 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-3">
            {/* Header pacote: nome + dias + status */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <Sk className="h-4 w-2/3 max-w-[140px] mb-1.5" />
                <Sk className="h-3 w-1/2 max-w-[100px]" />
              </div>
              <Sk className="h-5 w-14 rounded-full flex-shrink-0" />
            </div>
            {/* Preço grande */}
            <Sk className="h-8 w-1/3 max-w-[100px]" />
            {/* Lista de serviços */}
            <div className="flex flex-col gap-1.5 flex-1">
              {[1,2,3].map(j => (
                <div key={j} className="flex items-center gap-2">
                  <Sk className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
                  <Sk className="h-3 flex-1 max-w-[140px]" />
                  <Sk className="h-3 w-6 flex-shrink-0" />
                </div>
              ))}
            </div>
            {/* Ações */}
            <div className="flex gap-2 pt-2 border-t border-border">
              <Sk className="h-8 flex-1 rounded-lg" />
              <Sk className="h-8 w-8 rounded-lg" />
              <Sk className="h-8 w-8 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
