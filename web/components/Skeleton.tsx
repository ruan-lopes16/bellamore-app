/**
 * @file Skeleton.tsx
 * Sistema de loading states com animação shimmer.
 *
 * ## Como funciona
 * A classe `.sk` (definida em globals.css) aplica um gradiente animado que
 * desliza da esquerda para a direita, simulando conteúdo carregando.
 *
 * ## Uso básico
 * ```tsx
 * // Bloco genérico com tamanho customizado
 * <Sk className="h-4 w-32" />
 * <Sk className="h-10 w-full rounded-xl" />
 *
 * // Layouts prontos (para páginas completas durante o loading)
 * <SkStatGrid cols={3} />
 * <SkTableRows count={5} />
 * ```
 *
 * ## Padrão de uso em pages (Client Components)
 * ```tsx
 * const [loading, setLoading] = useState(true);
 *
 * return loading ? (
 *   <SkStatGrid />  // skeleton
 * ) : (
 *   <div>...</div>  // conteúdo real
 * );
 * ```
 *
 * ## Para Server Components (dashboard)
 * Use `loading.tsx` ao lado do `page.tsx` — o Next.js exibe automaticamente
 * enquanto o Server Component está sendo renderizado.
 */

import type { CSSProperties } from 'react';

// ── Bloco base ────────────────────────────────────────────────

/**
 * Componente base de skeleton. Aceita className para tamanho/forma
 * e style para casos onde Tailwind não cobre (ex: altura percentual dinâmica).
 */
export function Sk({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`sk ${className}`} style={style} />;
}

// ── Layouts prontos ───────────────────────────────────────────

/**
 * Grade de stat-cards (número grande + label abaixo).
 * Usado em: clientes, serviços, estoque.
 * @param cols - número de colunas (default: 3)
 */
export function SkStatGrid({ cols = 3 }: { cols?: number }) {
  const colClass = cols === 4 ? 'grid-cols-2 md:grid-cols-4'
    : cols === 2 ? 'grid-cols-1 sm:grid-cols-2'
    : 'grid-cols-2 md:grid-cols-3';
  return (
    <div className={`grid ${colClass} gap-3 sm:gap-4 mb-6`}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
          <Sk className="h-7 w-1/3 mb-2 max-w-[60px]" />
          <Sk className="h-3 w-2/3 max-w-[80px]" />
        </div>
      ))}
    </div>
  );
}

/**
 * Linhas de tabela com avatar circular + colunas de texto.
 * Usado em: clientes, estoque.
 * @param count - número de linhas (default: 5)
 */
export function SkTableRows({ count = 5 }: { count?: number }) {
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 px-5 py-3.5 ${i < count - 1 ? 'border-b border-border' : ''}`}
        >
          <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
          <div className="flex-1 flex gap-3 overflow-hidden">
            <Sk className="h-4 w-28 flex-shrink-0" />
            <Sk className="h-4 w-20 hidden sm:block flex-shrink-0" />
            <Sk className="h-4 w-24 hidden sm:block flex-shrink-0" />
          </div>
          <Sk className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * Lista de cards verticais (agendamentos, despesas, etc.).
 * Cada card tem avatar + duas linhas de texto + badge.
 */
export function SkCardList({ count = 3, height = 'h-[88px]' }: {
  count?: number;
  height?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`bg-surface border border-border rounded-2xl ${height} flex items-center gap-3 px-4 shadow-sm`}
        >
          <Sk className="w-9 h-9 rounded-xl flex-shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <Sk className="h-3.5 w-2/3" />
            <Sk className="h-3 w-1/3" />
          </div>
          <Sk className="h-5 w-12 sm:w-16 rounded-lg flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

