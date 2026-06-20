import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Clientes — corresponde ao layout real:
 * header + 3 stat cards + busca + cards verticais (NÃO é tabela)
 */
export default function ClientesLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-28 mb-2" />
          <Sk className="h-8 w-36" />
        </div>
        <Sk className="h-10 w-32 rounded-2xl" />
      </div>

      {/* Stats: 3 cards com icon + valor + label */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3 min-w-0">
            <Sk className="w-10 h-10 rounded-2xl flex-shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Sk className="h-6 w-1/3 max-w-[50px]" />
              <Sk className="h-3 w-2/3 max-w-[100px]" />
            </div>
          </div>
        ))}
      </div>

      {/* Busca */}
      <Sk className="h-12 w-full rounded-2xl mb-5" />

      {/* Pílulas de filtro */}
      <div className="flex gap-2 mb-5">
        {[60, 70, 110].map((w, i) => (
          <Sk key={i} className="h-7 rounded-full flex-shrink-0" style={{ width: `${w}px` }} />
        ))}
      </div>

      {/* Lista de clientes — cards horizontais */}
      <div className="flex flex-col gap-2">
        {[1,2,3,4,5,6].map(i => (
          <div key={i} className="bg-surface border border-border rounded-[20px] p-3 px-4 shadow-sm flex items-center gap-3">
            <Sk className="w-11 h-11 rounded-xl flex-shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <Sk className="h-4 w-2/3 max-w-[160px]" />
              <Sk className="h-3 w-1/2 max-w-[120px]" />
            </div>
            <Sk className="w-4 h-4 rounded flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
