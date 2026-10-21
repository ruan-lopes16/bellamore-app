'use client';

/**
 * @file agenda/DetalheAtendimento.tsx
 * Partes do detalhe do atendimento na Agenda (web), separadas de `page.tsx`:
 * - `useDetalheComanda`  — busca a comanda do atendimento só quando o detalhe abre
 *                          (`carregarDetalheAtendimento`, a mesma consulta do perfil da cliente);
 * - `DetalheAtendimento` — botões Ligar / WhatsApp / Perfil e o bloco da comanda com os pagamentos;
 * - `ResumoDoDiaCards`   — os 4 números do dia (`resumoDoDia`, os mesmos do app).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Phone, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { Secret } from '@/components/privacy';
import { ConteudoComanda } from '@/components/ConteudoComanda';
import { contatosCliente, type resumoDoDia } from '@shared/agenda';
import { carregarDetalheAtendimento } from '@shared/atendimento-detalhe-consultas';
import type { DetalheAtendimento as DetalheComanda } from '@shared/atendimento-detalhe';
import { formatarMoeda as fmtBRL } from '@shared/moeda';

const supabase = createClient();

/** O mínimo do atendimento que o detalhe usa. */
export type AgDoDetalhe = {
  id: string;
  comanda_id?: string | null;
  cliente: { id: string; nome: string; telefone?: string | null } | null;
};

export type EstadoComanda = { detalhe: DetalheComanda | null; carregando: boolean; erro: string | null };

/**
 * Comanda do atendimento aberto no detalhe. Sem `comanda_id` não consulta nada. Troca rápida de
 * atendimento nunca mostra a comanda do anterior (resposta antiga é descartada). `null` = fechado.
 */
export function useDetalheComanda(ag: AgDoDetalhe | null): EstadoComanda {
  const agId = ag?.id ?? null;
  const comandaId = ag?.comanda_id ?? null;
  const [estado, setEstado] = useState<EstadoComanda>({ detalhe: null, carregando: false, erro: null });

  useEffect(() => {
    if (!agId || !comandaId) { setEstado({ detalhe: null, carregando: false, erro: null }); return; }
    let vivo = true;
    setEstado({ detalhe: null, carregando: true, erro: null });
    carregarDetalheAtendimento(supabase, agId, comandaId)
      .then(detalhe => { if (vivo) setEstado({ detalhe, carregando: false, erro: null }); })
      .catch(e => { if (vivo) setEstado({ detalhe: null, carregando: false, erro: (e as Error).message }); });
    return () => { vivo = false; };
  }, [agId, comandaId]);

  return estado;
}

const botao = 'press flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl border border-border bg-surface text-xs font-semibold text-text-2 hover:bg-bg transition';

/**
 * Contatos e comanda abaixo do card do atendimento. Os botões de telefone somem sem telefone e
 * "Perfil" some sem cliente; a seção da comanda só aparece quando o atendimento foi fechado.
 */
export function DetalheAtendimento({ ag, comanda }: { ag: AgDoDetalhe; comanda: EstadoComanda }) {
  const contatos = contatosCliente(ag.cliente?.telefone);
  const temComanda = !!ag.comanda_id;

  return (
    <div className="flex flex-col gap-4 mt-3">
      {(contatos || ag.cliente) && (
        <div className="flex gap-2">
          {contatos && (
            <>
              <a href={contatos.ligar} className={botao}>
                <Phone size={13} strokeWidth={2}/>Ligar
              </a>
              <a href={contatos.whatsapp} target="_blank" rel="noopener noreferrer" className={botao}>
                <MessageCircle size={13} strokeWidth={2}/>WhatsApp
              </a>
            </>
          )}
          {ag.cliente && (
            <Link href={`/clientes/${ag.cliente.id}`} className={botao}>
              <UserRound size={13} strokeWidth={2}/>Perfil
            </Link>
          )}
        </div>
      )}

      {temComanda && (
        <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Comanda</p>
          <ConteudoComanda detalhe={comanda.detalhe} carregando={comanda.carregando} erro={comanda.erro}/>
        </div>
      )}
    </div>
  );
}

/**
 * Os 4 números do dia (Agendamentos, Receita prevista, Profissionais, Pendentes), os mesmos do app.
 * Carregando mostra esqueleto; com erro de carga mostra "—" (nunca zero).
 */
export function ResumoDoDiaCards({ resumo, carregando, erro }: {
  resumo: ReturnType<typeof resumoDoDia>;
  carregando: boolean;
  erro: boolean;
}) {
  const semNumero = erro;
  const cards: { label: string; valor: React.ReactNode; cor: string }[] = [
    { label: 'Agendamentos', valor: semNumero ? '—' : String(resumo.total), cor: 'var(--color-ink)' },
    { label: 'Receita prevista', valor: semNumero ? '—' : <Secret>{fmtBRL(resumo.receitaPrevista)}</Secret>, cor: 'var(--color-green)' },
    { label: 'Profissionais', valor: semNumero ? '—' : String(resumo.profissionais), cor: 'var(--color-ink)' },
    { label: 'Pendentes', valor: semNumero ? '—' : String(resumo.pendentes), cor: !semNumero && resumo.pendentes > 0 ? 'var(--color-amber)' : 'var(--color-ink)' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-6">
      {cards.map(c => (
        <div key={c.label} className="bg-surface border border-border rounded-2xl px-4 py-3 min-w-0">
          {carregando ? (
            <Sk className="h-6 w-16 mb-1"/>
          ) : (
            <p className="text-lg font-bold whitespace-nowrap tabular-nums truncate" style={{ color: c.cor, fontFamily: 'var(--font-sans)' }}>{c.valor}</p>
          )}
          <p className="text-[11px] font-semibold text-text-3 uppercase tracking-wide">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
