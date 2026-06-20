import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Configurações — corresponde ao layout real:
 * header com dark toggle + tabs (Empresa/Perfil) + cards de seção
 */
export default function ConfiguracoesLoading() {
  return (
    <div>
      {/* Header com dark mode toggle */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <Sk className="h-3 w-32 mb-2" />
          <Sk className="h-8 w-40" />
        </div>
        <Sk className="w-10 h-10 rounded-2xl flex-shrink-0" />
      </div>

      {/* Tabs Empresa / Perfil */}
      <div className="flex gap-1 border-b border-border mb-8 overflow-x-auto">
        <Sk className="h-9 w-24 rounded-t-lg flex-shrink-0" />
        <Sk className="h-9 w-28 rounded-t-lg flex-shrink-0" />
      </div>

      {/* Seções (Logo / Dados / Horários / Membros) */}
      <div className="max-w-2xl flex flex-col gap-6">
        {/* Logo */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <Sk className="w-5 h-5 rounded" />
            <Sk className="h-4 w-16" />
          </div>
          <div className="flex items-center gap-5">
            <Sk className="w-20 h-20 rounded-2xl flex-shrink-0" />
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <Sk className="h-4 w-1/2 max-w-[140px]" />
              <Sk className="h-3 w-full max-w-[260px]" />
              <Sk className="h-8 w-32 rounded-xl" />
            </div>
          </div>
        </div>

        {/* Dados da empresa */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <Sk className="w-5 h-5 rounded" />
            <Sk className="h-4 w-36" />
          </div>
          <div className="flex flex-col gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Sk className="h-3 w-20" />
                  <Sk className="h-10 rounded-xl" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Sk className="h-3 w-20" />
                  <Sk className="h-10 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Horários */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <Sk className="w-5 h-5 rounded" />
            <Sk className="h-4 w-40" />
          </div>
          <div className="flex flex-col gap-3">
            {[1,2,3,4,5,6,7].map(i => (
              <div key={i} className="flex flex-wrap items-center gap-3">
                <Sk className="w-10 h-5 rounded-full flex-shrink-0" />
                <Sk className="h-3 w-20 sm:w-32 flex-shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Sk className="h-9 flex-1 max-w-[100px] rounded-xl" />
                  <Sk className="h-3 w-6" />
                  <Sk className="h-9 flex-1 max-w-[100px] rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Botão salvar */}
        <Sk className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}
