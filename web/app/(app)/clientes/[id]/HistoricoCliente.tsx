'use client';

import { Calendar, Clock, CheckCircle2, XCircle, AlertCircle, ShoppingBag, Banknote, Package, Sparkles } from 'lucide-react';
import { Sk } from '@/components/Skeleton';
import { Secret } from '@/components/privacy';
import type { ItemHistorico } from '@shared/clientes-consultas';
import { PAGAMENTO_METODO_LABEL, type PagamentoMetodo } from '@shared/dominio';
import { chaveDiaBRT, horaBRT } from '@shared/periodos';
import { formatarMoeda as fmtBRL } from '@shared/moeda';

/** O que o perfil precisa para abrir o detalhe da comanda de uma linha. */
export type AberturaDetalhe = { agendamentoId: string | null; comandaId: string | null; titulo: string };

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  agendado:   { label: 'Agendado',   bg: 'bg-amber-soft',   text: 'text-amber',   icon: Clock        },
  confirmado: { label: 'Confirmado', bg: 'bg-primary-soft', text: 'text-primary', icon: CheckCircle2 },
  concluido:  { label: 'Concluído',  bg: 'bg-green-soft',   text: 'text-green',   icon: CheckCircle2 },
  cancelado:  { label: 'Cancelado',  bg: 'bg-red-soft',     text: 'text-red',     icon: XCircle      },
  faltou:     { label: 'Faltou',     bg: 'bg-red-soft',     text: 'text-red',     icon: AlertCircle  },
};

/** "dd/mm/aaaa às HH:mm" sempre em Brasília (nunca no fuso do navegador). */
function dataHoraBRT(iso: string): string {
  const [a, m, d] = chaveDiaBRT(iso).split('-');
  return `${d}/${m}/${a} às ${horaBRT(iso)}`;
}

/** Rótulo da forma de pagamento da taxa (null quando não registrada). */
function rotuloMetodo(metodo: string | null): string | null {
  if (!metodo) return null;
  return PAGAMENTO_METODO_LABEL[metodo as PagamentoMetodo] ?? metodo;
}

function rotuloTaxa(tipo: 'taxa_reserva' | 'taxa_cancelamento', status: string): string {
  const nome = tipo === 'taxa_reserva' ? 'Taxa de reserva' : 'Taxa de cancelamento';
  const situacao = status === 'pago' ? 'paga' : status === 'retida' ? 'retida' : 'pendente';
  return `${nome} ${situacao}`;
}

/**
 * Histórico ÚNICO da cliente (web), na ordem de `carregarHistoricoCliente`: atendimentos, serviços
 * extras de comanda, vendas avulsas com os itens e taxas de reserva/cancelamento com a forma de
 * pagamento. Atendimentos e extras abrem o detalhe da comanda. Com erro de carga mostra o aviso,
 * nunca "nenhum registro".
 */
export function HistoricoCliente({ itens, carregando, erro, onAbrirDetalhe }: {
  itens: ItemHistorico[];
  carregando: boolean;
  erro: string;
  onAbrirDetalhe: (d: AberturaDetalhe) => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <p className="font-semibold text-text text-sm">Histórico</p>
        {!carregando && !erro && (
          <span className="text-xs text-text-4">{itens.length} {itens.length === 1 ? 'registro' : 'registros'}</span>
        )}
      </div>

      {carregando ? (
        <div className="p-4 flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg border border-border">
              <Sk className="w-10 h-10 rounded-xl flex-shrink-0"/>
              <div className="flex-1 flex flex-col gap-2">
                <Sk className="h-3.5 w-32"/><Sk className="h-3 w-20"/>
              </div>
              <Sk className="h-5 w-20 rounded-lg"/>
            </div>
          ))}
        </div>
      ) : erro ? (
        <p role="alert" className="m-5 text-sm text-red">Não foi possível carregar o histórico: {erro}</p>
      ) : itens.length === 0 ? (
        <div className="text-center py-10 text-text-4 text-sm">
          <Calendar size={24} className="mx-auto mb-3 text-text-4" strokeWidth={1.5}/>
          Nenhum registro ainda.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {itens.map(item => <LinhaHistorico key={`${item.tipo}-${item.id}`} item={item} onAbrirDetalhe={onAbrirDetalhe}/>)}
        </div>
      )}
    </div>
  );
}

function LinhaHistorico({ item, onAbrirDetalhe }: { item: ItemHistorico; onAbrirDetalhe: (d: AberturaDetalhe) => void }) {
  const quando = dataHoraBRT(item.data);

  if (item.tipo === 'atendimento') {
    const cfg = STATUS_CFG[item.status] ?? STATUS_CFG.agendado;
    const Icon = cfg.icon;
    const titulo = item.servicos || 'Atendimento';
    return (
      <button type="button"
        onClick={() => onAbrirDetalhe({ agendamentoId: item.id, comandaId: item.comandaId, titulo })}
        className="w-full text-left flex items-start gap-3 px-5 py-4 hover:bg-bg transition">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
          <Icon size={14} strokeWidth={2} className={cfg.text}/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text truncate">{titulo}</p>
          <p className="text-xs text-text-3 mt-0.5">{quando}</p>
          {item.profissional && <p className="text-xs text-text-4 mt-0.5">Com {item.profissional.split(' ')[0]}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
          {item.pacote
            ? <span className="text-[11px] font-semibold text-green flex items-center gap-1"><Package size={11}/>Sessão de pacote</span>
            : <span className="text-xs font-bold text-text-2"><Secret>{fmtBRL(item.valor)}</Secret></span>}
        </div>
      </button>
    );
  }

  if (item.tipo === 'extra') {
    return (
      <button type="button"
        onClick={() => onAbrirDetalhe({ agendamentoId: null, comandaId: item.comandaId, titulo: item.descricao })}
        className="w-full text-left flex items-start gap-3 px-5 py-4 hover:bg-bg transition">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-soft">
          <Sparkles size={14} strokeWidth={2} className="text-primary"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text truncate">{item.descricao}</p>
          <p className="text-xs text-text-3 mt-0.5">{quando} · Serviço extra da comanda</p>
        </div>
        <span className="text-xs font-bold text-text-2 flex-shrink-0"><Secret>{fmtBRL(item.valor)}</Secret></span>
      </button>
    );
  }

  if (item.tipo === 'venda') {
    const itensDesc = item.itens.map(i => `${i.quantidade}× ${i.nome}`).join(', ');
    return (
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-accent-soft">
          <ShoppingBag size={14} strokeWidth={2} className="text-accent"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text truncate">Venda avulsa</p>
          <p className="text-xs text-text-3 mt-0.5">{quando}</p>
          {itensDesc && <p className="text-xs text-text-4 mt-0.5 truncate">{itensDesc}</p>}
        </div>
        <span className="text-xs font-bold text-text-2 flex-shrink-0"><Secret>{fmtBRL(item.valor)}</Secret></span>
      </div>
    );
  }

  const metodo = item.status === 'pago' ? rotuloMetodo(item.metodo) : null;
  const reserva = item.tipo === 'taxa_reserva';
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${reserva ? 'bg-accent-soft' : 'bg-red-soft'}`}>
        {reserva
          ? <Banknote size={14} strokeWidth={2} className="text-accent"/>
          : <XCircle size={14} strokeWidth={2} className="text-red"/>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text truncate">{rotuloTaxa(item.tipo, item.status)}</p>
        <p className="text-xs text-text-3 mt-0.5">{quando}{metodo ? ` · ${metodo}` : ''}</p>
      </div>
      <span className="text-xs font-bold text-text-2 flex-shrink-0"><Secret>{fmtBRL(item.valor)}</Secret></span>
    </div>
  );
}
