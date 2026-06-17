'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function VerificarEmailContent() {
  const params = useSearchParams();
  const email = params.get('email') ?? 'seu e-mail';

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm text-center">

        {/* Ícone */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-soft mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2C1654" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2"/>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          </svg>
        </div>

        <h1 className="font-serif text-3xl text-text mb-2">Verifique seu e-mail</h1>
        <p className="text-text-3 text-sm leading-relaxed mb-1">
          Enviamos um link de confirmação para
        </p>
        <p className="text-text-2 font-semibold text-sm mb-6">{email}</p>

        {/* Card */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm text-left mb-6">
          <ol className="flex flex-col gap-3">
            {[
              'Abra o e-mail que enviamos',
              'Clique no link de confirmação',
              'Você será redirecionado para configurar seu estúdio',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-soft text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-text-2 text-sm">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-text-4 text-xs">
          Não recebeu?{' '}
          <a href="/cadastro" className="text-accent hover:underline font-medium">
            Tente novamente
          </a>
          {' '}ou verifique a pasta de spam.
        </p>

      </div>
    </div>
  );
}

export default function VerificarEmailPage() {
  return (
    <Suspense>
      <VerificarEmailContent />
    </Suspense>
  );
}
