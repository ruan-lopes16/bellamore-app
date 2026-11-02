'use client';

/**
 * Mostrado pelo AppLayout no lugar da página quando as permissões da pessoa não carregaram
 * (`carregarMinhasPermissoes` devolveu `null`). Nada é liberado enquanto isso: "Tentar de novo"
 * recarrega a mesma rota.
 */
export default function ErroPermissoes() {
  return (
    <div className="rounded-2xl p-8 text-center" role="alert"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxWidth: 480, margin: '48px auto' }}>
      <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, color: 'var(--color-ink)', marginBottom: 6 }}>
        Não foi possível carregar suas permissões.
      </p>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink3)', marginBottom: 16 }}>
        Confira a conexão e tente de novo.
      </p>
      <button type="button" onClick={() => window.location.reload()}
        className="press px-4 h-10 rounded-2xl text-sm font-bold"
        style={{ background: 'var(--color-primary)', color: '#fff', fontFamily: 'var(--font-sans)' }}>
        Tentar de novo
      </button>
    </div>
  );
}
