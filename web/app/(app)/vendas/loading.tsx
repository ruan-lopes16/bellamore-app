import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Vendas (PDV) — corresponde ao layout real:
 * header + tabs + split layout (produtos esquerda / carrinho+cliente+pagamento direita)
 */
export default function VendasLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-28 mb-2" />
          <Sk className="h-8 w-24" />
        </div>
      </div>

      {/* Tabs PDV / Histórico */}
      <div className="flex gap-0 border-b border-border mb-6">
        <Sk className="h-9 w-16 rounded-t-lg flex-shrink-0" />
        <Sk className="h-9 w-28 rounded-t-lg flex-shrink-0 ml-1" />
      </div>

      {/* Layout PDV: produtos esquerda + carrinho/checkout direita */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* Coluna esquerda: lista de produtos */}
        <div className="w-full md:w-[300px] md:flex-shrink-0 flex flex-col gap-3">
          {/* Busca */}
          <Sk className="h-10 rounded-xl" />
          {/* Cards de produtos */}
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border bg-surface">
              <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <Sk className="h-4 w-2/3 max-w-[140px]" />
                <Sk className="h-3 w-1/2 max-w-[80px]" />
              </div>
              <Sk className="h-4 w-12 flex-shrink-0" />
            </div>
          ))}
        </div>

        {/* Coluna direita: carrinho + cliente + pagamento */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Carrinho */}
          <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Sk className="h-5 w-24" />
              <Sk className="h-4 w-12" />
            </div>
            {[1,2].map(i => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <Sk className="h-4 w-2/3 max-w-[140px]" />
                  <Sk className="h-3 w-1/2 max-w-[80px]" />
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Sk className="w-7 h-7 rounded-lg" />
                  <Sk className="w-7 h-7 rounded-md" />
                  <Sk className="w-7 h-7 rounded-lg" />
                </div>
                <Sk className="h-4 w-16 flex-shrink-0" />
              </div>
            ))}
          </div>

          {/* Cliente + Desconto */}
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Sk className="h-3 w-20" />
                <Sk className="h-10 rounded-xl" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Sk className="h-3 w-16" />
                <Sk className="h-10 rounded-xl" />
              </div>
            </div>
          </div>

          {/* Pagamento + Total + Botão */}
          <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
            <Sk className="h-3 w-24" />
            {/* Botões de método */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[1,2,3,4].map(i => (
                <Sk key={i} className="h-12 rounded-xl" />
              ))}
            </div>
            {/* Total */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <Sk className="h-4 w-16" />
              <Sk className="h-7 w-28" />
            </div>
            {/* Botão finalizar */}
            <Sk className="h-12 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
