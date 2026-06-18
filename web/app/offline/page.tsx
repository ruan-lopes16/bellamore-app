'use client';

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg gap-5 px-4 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--color-primary)', boxShadow: '0 4px 20px rgba(44,23,80,0.25)' }}
      >
        <span className="text-white text-2xl font-bold font-serif">✦</span>
      </div>
      <div>
        <h1 className="font-serif text-2xl text-text mb-1">Sem conexão</h1>
        <p className="text-sm text-text-3 max-w-xs">
          Verifique sua internet e tente novamente.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="h-10 px-6 rounded-xl bg-primary text-white text-sm font-bold"
      >
        Tentar novamente
      </button>
    </div>
  );
}
