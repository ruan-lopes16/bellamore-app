'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Erro global]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-soft mb-5">
          <AlertTriangle size={24} className="text-red" />
        </div>
        <h1 className="font-serif text-2xl text-text mb-2">Algo deu errado</h1>
        <p className="text-sm text-text-3 mb-6">
          {error.message || 'Ocorreu um erro inesperado. Tente novamente.'}
        </p>
        <button
          onClick={reset}
          className="h-11 px-6 rounded-xl bg-primary text-white text-sm font-bold hover:opacity-90 transition"
        >
          Tentar novamente
        </button>
        <a
          href="/dashboard"
          className="block mt-3 text-sm text-text-3 hover:text-text transition"
        >
          Voltar ao início
        </a>
      </div>
    </div>
  );
}
