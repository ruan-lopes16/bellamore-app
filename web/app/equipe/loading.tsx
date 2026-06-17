import AppLayout from '@/components/AppLayout';
import { Sk } from '@/components/Skeleton';

export default function EquipeLoading() {
  return (
    <AppLayout>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Sk className="h-3 w-20 mb-2" />
            <Sk className="h-9 w-32" />
          </div>
          <Sk className="h-9 w-44 rounded-xl" />
        </div>

        {/* Grid de cards de profissionais */}
        <div className="grid grid-cols-2 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              {/* Avatar + nome */}
              <div className="flex items-start gap-3 mb-4">
                <Sk className="w-12 h-12 rounded-xl flex-shrink-0" />
                <div className="flex-1 flex flex-col gap-2 pt-1">
                  <Sk className="h-4 w-28" />
                  <Sk className="h-3 w-20" />
                  <Sk className="h-5 w-14 rounded-full" />
                </div>
              </div>
              {/* Stats de desempenho */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-bg rounded-xl p-3">
                  <Sk className="h-3 w-12 mb-2" />
                  <Sk className="h-5 w-16" />
                </div>
                <div className="bg-bg rounded-xl p-3">
                  <Sk className="h-3 w-16 mb-2" />
                  <Sk className="h-5 w-10" />
                </div>
              </div>
              {/* Comissão */}
              <div className="bg-bg rounded-xl p-3 mb-3">
                <Sk className="h-3 w-20 mb-2" />
                <Sk className="h-5 w-12" />
              </div>
              {/* Botão ativar/desativar */}
              <Sk className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
