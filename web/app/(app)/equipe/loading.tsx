import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Equipe — corresponde ao layout real:
 * header + 3 stat cards (Total / Ativas / Inativas) + grid de cards de profissional
 */
export default function EquipeLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-20 mb-2" />
          <Sk className="h-8 w-32" />
        </div>
        <Sk className="h-10 w-44 rounded-2xl" />
      </div>

      {/* Stats: 3 cards (icon + valor + label) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3 min-w-0">
            <Sk className="w-10 h-10 rounded-2xl flex-shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Sk className="h-6 w-10" />
              <Sk className="h-3 w-2/3 max-w-[80px]" />
            </div>
          </div>
        ))}
      </div>

      {/* Label de período */}
      <Sk className="h-3 w-40 mb-3" />

      {/* Grid de cards de profissionais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            {/* Avatar + nome + telefone + badge */}
            <div className="flex items-start gap-3 mb-4">
              <Sk className="w-12 h-12 rounded-2xl flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5 pt-1">
                <Sk className="h-4 w-3/4 max-w-[140px]" />
                <Sk className="h-3 w-1/2 max-w-[100px]" />
                <Sk className="h-4 w-12 rounded-md" />
              </div>
            </div>
            {/* Stats do mês */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-bg rounded-xl p-3 text-center">
                <Sk className="h-5 w-1/2 mx-auto mb-1.5 max-w-[40px]" />
                <Sk className="h-2.5 w-2/3 mx-auto max-w-[80px]" />
              </div>
              <div className="bg-bg rounded-xl p-3 text-center">
                <Sk className="h-5 w-2/3 mx-auto mb-1.5 max-w-[60px]" />
                <Sk className="h-2.5 w-2/3 mx-auto max-w-[80px]" />
              </div>
            </div>
            {/* Botão ação */}
            <Sk className="h-10 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
