import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Estoque — corresponde ao layout real:
 * header + tabs + 4 stat cards + filtros tipo + busca/status + categoria pills
 * + tabela grid-cols-12 (Produto / Status / Estoque / Mínimo / Ações)
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

      {/* Stats: 4 cards (icon + value + label) */}
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

      {/* Filtro tipo (Todos / Material / Venda) */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {[80, 140, 120].map((w, i) => (
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

      {/* Tabela grid-cols-12 com scroll horizontal no mobile */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm overflow-x-auto">
        {/* Cabeçalho */}
        <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-bg min-w-[560px] gap-2">
          {[
            { span: 'col-span-4', w: 'w-16' },
            { span: 'col-span-2', w: 'w-14' },
            { span: 'col-span-2', w: 'w-16' },
            { span: 'col-span-2', w: 'w-14' },
            { span: 'col-span-2', w: 'w-12 ml-auto' },
          ].map(({ span, w }, i) => (
            <div key={i} className={span}><Sk className={`h-3 ${w}`} /></div>
          ))}
        </div>

        {/* Linhas */}
        {[1,2,3,4,5,6].map(i => (
          <div key={i} className="grid grid-cols-12 items-center px-5 py-3.5 border-b border-border last:border-0 min-w-[560px] gap-2">
            {/* Nome + categoria */}
            <div className="col-span-4 flex items-center gap-3 min-w-0">
              <Sk className="w-7 h-7 rounded-lg flex-shrink-0" />
              <div className="min-w-0 flex flex-col gap-1.5">
                <Sk className="h-4 w-full max-w-[140px]" />
                <Sk className="h-3 w-1/2 max-w-[80px]" />
              </div>
            </div>
            {/* Status badge */}
            <div className="col-span-2"><Sk className="h-5 w-16 rounded-full" /></div>
            {/* Estoque */}
            <div className="col-span-2"><Sk className="h-4 w-12" /></div>
            {/* Mínimo */}
            <div className="col-span-2"><Sk className="h-4 w-10" /></div>
            {/* Ações */}
            <div className="col-span-2 flex justify-end gap-2">
              <Sk className="w-8 h-8 rounded-lg" />
              <Sk className="w-8 h-8 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
