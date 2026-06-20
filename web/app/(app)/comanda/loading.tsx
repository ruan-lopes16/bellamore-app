import { Sk } from '@/components/Skeleton';

export default function ComandaLoading() {
  return (
    <div>
      <div className="flex gap-0 -m-4 md:-m-8 overflow-hidden" style={{ height: '100dvh' }}>
        {/* Painel esquerdo */}
        <div className="w-full md:w-72 md:flex-shrink-0 border-r border-border bg-bg p-3 flex flex-col gap-2">
          <Sk className="h-10 w-40 mb-2 max-w-full" />
          {[1, 2, 3, 4, 5].map(i => (
            <Sk key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        {/* Painel direito */}
        <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-4">
          <Sk className="w-16 h-16 rounded-2xl" />
          <Sk className="h-6 w-48" />
          <Sk className="h-4 w-64" />
        </div>
      </div>
    </div>
  );
}
