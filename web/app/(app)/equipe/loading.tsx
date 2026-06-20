import { Sk } from '@/components/Skeleton';

export default function EquipeLoading() {
  return (
    <div>
      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <Sk className="h-3 w-20 mb-2" />
            <Sk className="h-9 w-32" />
          </div>
          <Sk className="h-9 w-44 rounded-xl" />
        </div>

        {/* Grid de cards de profissionais */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              {/* Avatar + nome */}
              <div className="flex items-start gap-3 mb-4">
                <Sk className="w-12 h-12 rounded-xl flex-shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-2 pt-1">
                  <Sk className="h-4 w-3/4 max-w-[140px]" />
                  <Sk className="h-3 w-1/2 max-w-[100px]" />
                  <Sk className="h-5 w-14 rounded-full" />
                </div>
              </div>
              {/* Stats de desempenho */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-bg rounded-xl p-3">
                  <Sk className="h-3 w-2/3 mb-2" />
                  <Sk className="h-5 w-1/2 max-w-[60px]" />
                </div>
                <div className="bg-bg rounded-xl p-3">
                  <Sk className="h-3 w-2/3 mb-2" />
                  <Sk className="h-5 w-1/2 max-w-[60px]" />
                </div>
              </div>
              {/* Comissão */}
              <div className="bg-bg rounded-xl p-3 mb-3">
                <Sk className="h-3 w-1/2 mb-2 max-w-[100px]" />
                <Sk className="h-5 w-1/3 max-w-[60px]" />
              </div>
              {/* Botão ativar/desativar */}
              <Sk className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
