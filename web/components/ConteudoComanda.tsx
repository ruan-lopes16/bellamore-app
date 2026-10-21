'use client';

/**
 * @file ConteudoComanda.tsx
 * Bloco "O que foi feito / Fechamento / Como foi pago" de um atendimento, montado por
 * `montarDetalheAtendimento` (shared). Usado pelo detalhe do histórico no perfil da cliente e pelo
 * detalhe do atendimento na Agenda — mesmo texto e mesma ordem nos dois lugares.
 */

import { horaBRT } from '@shared/periodos';
import { Sk } from '@/components/Skeleton';
import { Secret } from '@/components/privacy';
import { formatarMoeda as fmtBRL } from '@shared/moeda';
import type { DetalheAtendimento } from '@shared/atendimento-detalhe';

export function ConteudoComanda({ detalhe, carregando, erro }: {
  detalhe: DetalheAtendimento | null;
  carregando: boolean;
  /** Mensagem em português do erro de carga; com erro nunca mostra comanda vazia. */
  erro?: string | null;
}) {
  if (carregando) {
    return (
      <div className="flex flex-col gap-3">
        <Sk className="h-4 w-40"/><Sk className="h-4 w-56"/><Sk className="h-4 w-32"/>
      </div>
    );
  }
  if (erro) return <p role="alert" className="text-sm text-red">{erro}</p>;
  if (!detalhe) return null;
  if (detalhe.situacao === 'bloqueado_por_rls') {
    return (
      <p className="text-sm text-text-3">
        Detalhes financeiros disponíveis apenas para quem atendeu ou para a gestão.
      </p>
    );
  }
  if (detalhe.situacao === 'sem_comanda') {
    return <p className="text-sm text-text-3">Este atendimento ainda não foi fechado em comanda.</p>;
  }

  return (
    <>
      <section className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">O que foi feito</p>
        {detalhe.itens.map(item => (
          <div key={`${item.origem}-${item.id}`}
            className={`flex items-start justify-between gap-3 text-sm ${item.esteAtendimento ? 'font-semibold text-text' : 'text-text-2'}`}>
            <span className="min-w-0">
              {item.quantidade > 1 && `${item.quantidade}× `}{item.descricao}
              {item.profissional && (
                <span className="block text-xs text-text-4">com {item.profissional.split(' ')[0]}</span>
              )}
            </span>
            <span className="flex-shrink-0"><Secret>{fmtBRL(item.valorLinha)}</Secret></span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1.5 border-t border-border pt-4">
        <p className="text-xs font-semibold text-text-3 uppercase tracking-widest mb-1">Fechamento</p>
        <div className="flex justify-between text-sm text-text-2">
          <span>Subtotal</span><span><Secret>{fmtBRL(detalhe.subtotal)}</Secret></span>
        </div>
        {detalhe.descontoManual > 0 && (
          <div className="flex justify-between text-sm text-text-2">
            <span>Desconto</span><span>− <Secret>{fmtBRL(detalhe.descontoManual)}</Secret></span>
          </div>
        )}
        {detalhe.descontoReserva > 0 && (
          <div className="flex justify-between text-sm text-text-2">
            <span>Taxa de reserva já paga</span><span>− <Secret>{fmtBRL(detalhe.descontoReserva)}</Secret></span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold text-text pt-1">
          <span>Total</span><span><Secret>{fmtBRL(detalhe.total)}</Secret></span>
        </div>
      </section>

      <section className="flex flex-col gap-1.5 border-t border-border pt-4">
        <p className="text-xs font-semibold text-text-3 uppercase tracking-widest mb-1">Como foi pago</p>
        {detalhe.pagamentos.length === 0 ? (
          <p className="text-sm text-text-4">Nenhum pagamento registrado.</p>
        ) : detalhe.pagamentos.map(p => (
          <div key={p.id} className="flex justify-between text-sm text-text-2">
            <span className="capitalize">
              {p.metodo}
              {p.bandeira && ` · ${p.bandeira}`}
              {p.parcelas > 1 && ` · ${p.parcelas}×`}
              {p.taxaPerc != null && (
                <span className="block text-xs text-text-4 normal-case">
                  taxa <Secret>{p.taxaPerc}%</Secret> · líquido <Secret>{fmtBRL(p.valorLiquido ?? 0)}</Secret>
                </span>
              )}
            </span>
            <span><Secret>{fmtBRL(p.valor)}</Secret></span>
          </div>
        ))}
      </section>

      {detalhe.outrosAtendimentos.length > 0 && (
        <section className="border-t border-border pt-4">
          <p className="text-xs text-text-3">
            Esta comanda fechou {detalhe.outrosAtendimentos.length + 1} atendimentos do mesmo dia —
            os valores acima são do total da visita:
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {detalhe.outrosAtendimentos.map(o => (
              <li key={o.id} className="text-xs text-text-4">
                {horaBRT(o.dataHoraInicio)} — {o.servicos ?? 'Serviço'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
