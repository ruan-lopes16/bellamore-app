import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Estoque — corresponde ao layout real:
 * header + tabs + 4 stat cards + busca/filtros + lista de produtos (cards horizontais)
 */
export default function EstoqueLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-32 mb-2" />
          <Sk className="h-8 w-28" />
        </div>
        <Sk className="h-10 w-36 rounded-2xl" />
      </div>

      {/* Tabs Produtos / Movimentações */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        <Sk className="h-9 w-24 rounded-t-lg flex-shrink-0" />
        <Sk className="h-9 w-32 rounded-t-lg flex-shrink-0" />
      </div>

      {/* Stats: 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3 min-w-0">
            <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Sk className="h-5 w-1/3 max-w-[40px]" />
              <Sk className="h-3 w-2/3 max-w-[100px]" />
            </div>
          </div>
        ))}
      </div>

      {/* Filtro Tipo (Todos / Material / Venda) */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {[80, 130, 110].map((w, i) => (
          <Sk key={i} className="h-9 rounded-xl flex-shrink-0" style={{ width: `${w}px` }} />
        ))}
      </div>

      {/* Busca + filtro status */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
        <Sk className="h-10 flex-1 rounded-xl" />
        <Sk className="h-10 w-full sm:w-44 rounded-xl flex-shrink-0" />
      </div>

      {/* Pílulas de categoria */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[60, 80, 70, 90, 65].map((w, i) => (
          <Sk key={i} className="h-7 rounded-full flex-shrink-0" style={{ width: `${w}px` }} />
        ))}
      </div>

      {/* Lista de produtos */}
      <div className="flex flex-col gap-2">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-3">
            <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <Sk className="h-4 w-2/3 max-w-[160px]" />
              <Sk className="h-3 w-1/2 max-w-[100px]" />
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <Sk className="h-4 w-12" />
              <Sk className="h-3 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
