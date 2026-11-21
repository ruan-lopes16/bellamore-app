'use client';

/**
 * Troca de mês do Dashboard web sem "travar":
 * - o rótulo do mês muda no clique (antes a página só mudava quando o servidor terminava as
 *   ~25 consultas, sem nenhum retorno visual — a navegação do Next é uma transição e mantém a
 *   tela antiga parada até o fim);
 * - os números antigos continuam na tela, esmaecidos e marcados ("mostrando Outubro 2026"),
 *   até os novos chegarem (regra única `estadoTrocaMesDashboard`, a mesma do app);
 * - cliques seguidos valem pelo ÚLTIMO mês pedido: resposta de um clique antigo nunca é
 *   apresentada como a do mês novo.
 */
import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { navegacaoMesDashboard, estadoTrocaMesDashboard, type EstadoTrocaMes } from '@shared/dashboard';
import { rotuloMesAno } from '@shared/periodos';

type Ctx = { mesPedido: string; hoje: string; estado: EstadoTrocaMes; irPara: (mes: string | null) => void };

const TrocaMesCtx = createContext<Ctx | null>(null);

function useTrocaMes(): Ctx {
  const ctx = useContext(TrocaMesCtx);
  if (!ctx) throw new Error('TrocaMes fora do TrocaMesProvider');
  return ctx;
}

/** `mes` = mês dos números que o servidor acabou de renderizar; `hoje` = dia de Brasília. */
export function TrocaMesProvider({ mes, hoje, children }: { mes: string; hoje: string; children: ReactNode }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  // Último mês pedido (null = nenhuma troca em curso: vale o mês renderizado).
  const [alvo, setAlvo] = useState<string | null>(null);

  // Sem navegação em curso, o pedido acabou (ou falhou): volta a valer o mês renderizado.
  useEffect(() => { if (!pendente) setAlvo(null); }, [pendente]);

  const mesPedido = alvo ?? mes;
  const estado = estadoTrocaMesDashboard({ mesPedido, mesDosDados: mes, carregando: pendente });

  function irPara(destino: string | null) {
    const chave = navegacaoMesDashboard(destino, hoje).chave;
    if (chave === mesPedido) return;
    setAlvo(chave);
    startTransition(() => {
      router.push(destino ? `/dashboard?mes=${chave}` : '/dashboard', { scroll: false });
    });
  }

  return <TrocaMesCtx.Provider value={{ mesPedido, hoje, estado, irPara }}>{children}</TrocaMesCtx.Provider>;
}

/** Setas + rótulo do mês (muda no clique) + indicador discreto enquanto atualiza. */
export function NavegacaoMes() {
  const { mesPedido, hoje, estado, irPara } = useTrocaMes();
  const nav = navegacaoMesDashboard(mesPedido, hoje);
  const botao = 'flex items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bg2)] active:scale-90';
  return (
    <div className="flex items-center gap-1 mb-1 flex-wrap">
      <button type="button" onClick={() => irPara(nav.anterior)} aria-label="Mês anterior" className={botao}
        style={{ width: 22, height: 22, color: 'var(--color-ink4)' }}>
        <ChevronLeft size={12} strokeWidth={2.4} />
      </button>
      <p aria-live="polite" style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {rotuloMesAno(nav.chave)}
      </p>
      {nav.seguinte ? (
        <button type="button" onClick={() => irPara(nav.seguinte)} aria-label="Próximo mês" className={botao}
          style={{ width: 22, height: 22, color: 'var(--color-ink4)' }}>
          <ChevronRight size={12} strokeWidth={2.4} />
        </button>
      ) : (
        <span style={{ width: 22, height: 22 }} />
      )}
      {!nav.isMesAtual && (
        <button type="button" onClick={() => irPara(null)}
          style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 700, color: 'var(--color-accent)', background: 'var(--color-accent-soft)', borderRadius: 999, padding: '2px 8px', marginLeft: 2 }}>
          Hoje
        </button>
      )}
      {estado.aviso && (
        <span role="status" className="inline-flex items-center gap-1"
          style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600, color: 'var(--color-ink4)', marginLeft: 6 }}>
          <Loader2 size={11} className="animate-spin" />
          {estado.aviso}
        </span>
      )}
    </div>
  );
}

/** Conteúdo com números do mês: esmaecido (e marcado como ocupado) enquanto não é do mês pedido. */
export function ConteudoMes({ children }: { children: ReactNode }) {
  const { estado } = useTrocaMes();
  return (
    <div aria-busy={estado.atualizando}
      style={{ opacity: estado.atualizando ? 0.45 : 1, transition: 'opacity 150ms ease', pointerEvents: estado.atualizando ? 'none' : undefined }}>
      {children}
    </div>
  );
}
