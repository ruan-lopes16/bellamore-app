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
import { MessageCircle, Phone, Star, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { Secret } from '@/components/privacy';
import { ConteudoComanda } from '@/components/ConteudoComanda';
import { contatosCliente, type resumoDoDia } from '@shared/agenda';
import { carregarDetalheAtendimento } from '@shared/atendimento-detalhe-consultas';
import type { DetalheAtendimento as DetalheComanda } from '@shared/atendimento-detalhe';
import { formatarMoeda as fmtBRL } from '@shared/moeda';
import { carregarAvaliacao, salvarAvaliacao } from '@shared/agenda-consultas';
import { mensagemErroBanco } from '@shared/erros';

const supabase = createClient();

/** O mínimo do atendimento que o detalhe usa. */
export type AgDoDetalhe = {
  id: string;
  comanda_id?: string | null;
  status?: string | null;
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
export function DetalheAtendimento({ ag, comanda, empresaId }: { ag: AgDoDetalhe; comanda: EstadoComanda; empresaId?: string | null }) {
  const contatos = contatosCliente(ag.cliente?.telefone);
  const temComanda = !!ag.comanda_id;

  return (
    <div className="flex flex-col gap-4 mt-3">
      {ag.status === 'concluido' && ag.cliente && empresaId && (
        <AvaliacaoDetalhe key={ag.id} agendamentoId={ag.id} empresaId={empresaId} clienteId={ag.cliente.id}/>
      )}

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
 * Seção "Avaliação" do atendimento concluído: lê a nota já dada (`carregarAvaliacao`) e permite
 * dar ou corrigir (`salvarAvaliacao` faz upsert). Erro de leitura mostra "Tentar de novo" e nunca
 * deixa salvar às cegas por cima de uma nota que não foi lida.
 */
function AvaliacaoDetalhe({ agendamentoId, empresaId, clienteId }: {
  agendamentoId: string; empresaId: string; clienteId: string;
}) {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [recarga, setRecarga] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true); setErroCarga('');
    carregarAvaliacao(supabase as unknown as Parameters<typeof carregarAvaliacao>[0], agendamentoId)
      .then(a => {
        if (!vivo) return;
        setNota(a?.nota ?? 0); setComentario(a?.comentario ?? ''); setCarregando(false);
      })
      .catch(e => {
        if (!vivo) return;
        setErroCarga((e as Error).message || 'Não foi possível carregar a avaliação.'); setCarregando(false);
      });
    return () => { vivo = false; };
  }, [agendamentoId, recarga]);

  async function salvar() {
    if (nota === 0 || salvando) return;
    setSalvando(true); setErro(''); setSalvo(false);
    try {
      await salvarAvaliacao(supabase as unknown as Parameters<typeof salvarAvaliacao>[0], {
        empresaId, agendamentoId, clienteId, nota, comentario,
      });
      setSalvo(true);
    } catch (e) {
      setErro(mensagemErroBanco(e as { code?: string; message?: string }, 'salvar a avaliação'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Avaliação</p>
      {carregando ? (
        <p className="text-xs text-text-3">Carregando…</p>
      ) : erroCarga ? (
        <div>
          <p className="text-xs font-semibold text-red">{erroCarga}</p>
          <button type="button" onClick={() => setRecarga(n => n + 1)} className="mt-1 text-xs font-bold text-primary underline">
            Tentar de novo
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map(i => (
              <button key={i} type="button" aria-label={`${i} estrela${i > 1 ? 's' : ''}`}
                onClick={() => { setNota(i); setSalvo(false); }}
                className="transition-transform hover:scale-110 active:scale-95">
                <Star size={26} strokeWidth={1.5}
                  fill={i <= nota ? 'var(--color-amber)' : 'none'}
                  style={{ color: i <= nota ? 'var(--color-amber)' : 'var(--color-border)' }}/>
              </button>
            ))}
          </div>
          <textarea
            value={comentario}
            onChange={e => { setComentario(e.target.value); setSalvo(false); }}
            placeholder="Comentário"
            aria-label="Comentário"
            rows={2}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"
          />
          {erro && <p className="text-xs font-semibold text-red">{erro}</p>}
          {salvo && <p className="text-xs font-semibold text-green">Avaliação salva</p>}
          <button type="button" onClick={salvar} disabled={nota === 0 || salvando}
            className="h-9 rounded-xl text-white text-xs font-bold transition disabled:opacity-40"
            style={{ background: 'var(--color-amber)' }}>
            {salvando ? 'Salvando...' : 'Salvar avaliação'}
          </button>
        </>
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
