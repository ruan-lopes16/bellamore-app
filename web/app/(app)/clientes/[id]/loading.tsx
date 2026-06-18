import { Sk } from '@/components/Skeleton';

export default function ClienteDetalheLoading() {
  return (
    <div>
      <div>
        {/* Voltar + header */}
        <div className="flex items-center gap-3 mb-6">
          <Sk className="h-8 w-8 rounded-xl" />
          <div>
            <Sk className="h-3 w-20 mb-2" />
            <Sk className="h-8 w-48" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Coluna esquerda — perfil */}
          <div className="flex flex-col gap-4">
            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col items-center gap-3">
              <Sk className="w-16 h-16 rounded-2xl" />
              <Sk className="h-5 w-32" />
              <Sk className="h-3 w-24" />
            </div>
            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-3">
              {[1, 2, 3].map(i => (
                <div key={i}>
                  <Sk className="h-3 w-16 mb-1" />
                  <Sk className="h-4 w-full" />
                </div>
              ))}
            </div>
          </div>

          {/* Coluna direita — histórico */}
          <div className="col-span-2 flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
                  <Sk className="h-6 w-16 mb-1" />
                  <Sk className="h-3 w-24" />
                </div>
              ))}
            </div>
            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <Sk className="h-4 w-40 mb-4" />
              <div className="flex flex-col gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg border border-border">
                    <Sk className="w-10 h-10 rounded-xl flex-shrink-0" />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <Sk className="h-3.5 w-32" />
                      <Sk className="h-3 w-20" />
                    </div>
                    <Sk className="h-5 w-20 rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
