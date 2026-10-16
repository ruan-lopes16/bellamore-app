'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useScrollLock } from '@/lib/useScrollLock';
import { formatarMoeda } from '@shared/moeda';

interface Props {
  /** Valor da taxa de cancelamento que seria gerada. */
  valor: number;
  /** Cliente do atendimento, só para contextualizar. */
  clienteNome?: string;
  /** Bloqueia os botões enquanto o UPDATE roda. */
  loading?: boolean;
  onCobrar: () => void;
  onNaoCobrar: () => void;
  /** Fecha sem mudar o status. */
  onFechar: () => void;
}

/**
 * Pergunta, ao cancelar ou marcar falta, se a taxa de cancelamento deve ser cobrada neste atendimento.
 * "Cobrar" e "Não cobrar" gravam `status` e `cobrar_taxa_cancelamento` juntos; fechar não muda nada.
 */
export function PerguntaTaxaCancelamentoModal({ valor, clienteNome, loading = false, onCobrar, onNaoCobrar, onFechar }: Props) {
  useScrollLock(true);
  return (
    <div className="bm-modal fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={loading ? undefined : onFechar} />
      <div
        className="relative rounded-2xl shadow-xl w-full max-w-sm"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-start gap-4 p-6 pb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: 'var(--color-amber-soft)' }}>
            <AlertTriangle size={18} style={{ color: 'var(--color-amber)' }} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold" style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-sans)' }}>
              Cobrar taxa de cancelamento de {formatarMoeda(valor)}?
            </h3>
            {clienteNome && (
              <p className="text-sm mt-1" style={{ color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}>
                Atendimento de {clienteNome}.
              </p>
            )}
          </div>
          <button type="button" onClick={onFechar} disabled={loading}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition flex-shrink-0"
            style={{ color: 'var(--color-ink4)' }} aria-label="Fechar">
            <X size={15} />
          </button>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button type="button" onClick={onNaoCobrar} disabled={loading}
            className="flex-1 h-10 rounded-xl text-sm font-semibold transition disabled:opacity-50"
            style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)', color: 'var(--color-ink2)' }}>
            Não cobrar
          </button>
          <button type="button" onClick={onCobrar} disabled={loading}
            className="flex-1 h-10 rounded-xl text-sm font-bold text-white transition disabled:opacity-50"
            style={{ background: 'var(--color-amber)' }}>
            {loading ? 'Aguarde...' : 'Cobrar'}
          </button>
        </div>
      </div>
    </div>
  );
}
