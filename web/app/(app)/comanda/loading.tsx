import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Comanda — corresponde ao layout real:
 * split horizontal (desktop) ou apenas lista de clientes (mobile)
 * Esquerda: busca + lista de clientes
 * Direita: empty state ou comanda do cliente selecionado
 */
export default function ComandaLoading() {
  return (
    <div>
      <div className="flex -mt-6 -mb-24 -mx-4 md:-mt-8 md:-mb-10 md:-mx-8 overflow-hidden" style={{ height: '100dvh' }}>
        {/* Painel esquerdo: clientes */}
        <div className="w-full md:w-72 md:flex-shrink-0 border-r border-border bg-bg p-3 flex flex-col gap-2">
          {/* Header */}
          <Sk className="h-5 w-32 mb-1" />
          {/* Busca */}
          <Sk className="h-10 w-full rounded-xl mb-2" />
          {/* Lista de clientes */}
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-surface rounded-xl p-3 flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <Sk className="h-3.5 w-2/3 max-w-[120px]" />
                <Sk className="h-3 w-1/2 max-w-[80px]" />
              </div>
            </div>
          ))}
        </div>
        {/* Painel direito: empty state (desktop) */}
        <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-4">
          <Sk className="w-16 h-16 rounded-2xl" />
          <Sk className="h-6 w-48" />
          <Sk className="h-4 w-64" />
        </div>
      </div>
    </div>
  );
}
