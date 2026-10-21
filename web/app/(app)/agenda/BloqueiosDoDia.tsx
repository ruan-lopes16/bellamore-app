'use client';

import { Ban, X } from 'lucide-react';
import { motivoBloqueioLabel } from '@shared/bloqueios';
import { faixaDoBloqueioNoDia } from './visoes';

/** Bloqueio como a lista do dia precisa (mesmo formato carregado pela página). */
export type BloqueioItem = {
  id: string;
  profissional_id: string | null;
  titulo: string;
  data_inicio: string;
  data_fim: string;
  motivo: string | null;
  situacao: 'aprovado' | 'pendente';
  criado_por: string | null;
};

/**
 * Bloqueios do dia como itens da lista (visões Semana e Mês). Quem chama já passa só os
 * bloqueios visíveis do dia (`bloqueiosVisiveis` + `bloqueiosDoDia`), com o mesmo filtro da Timeline.
 * Remover segue a regra da Timeline: quem aprova, ou quem criou um pendente.
 */
export function BloqueiosDoDia({ bloqueios, chaveDia, nomeProfissional, meuUserId, podeAprovar, onPedirRemover }: {
  bloqueios: BloqueioItem[];
  chaveDia: string;
  nomeProfissional: (id: string) => string | undefined;
  meuUserId: string;
  podeAprovar: boolean;
  onPedirRemover: (b: BloqueioItem) => void;
}) {
  if (bloqueios.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 mb-3">
      {bloqueios.map(b => {
        const pendente = b.situacao === 'pendente';
        const podeRemover = podeAprovar || (pendente && b.criado_por === meuUserId);
        const quem = b.profissional_id ? (nomeProfissional(b.profissional_id) ?? 'Profissional') : 'Toda a agenda';
        const motivo = b.motivo ? motivoBloqueioLabel(b.motivo) : '';
        return (
          <div key={b.id}
            className="flex items-start gap-3 rounded-2xl px-4 py-3"
            style={{
              background: pendente
                ? 'repeating-linear-gradient(45deg, rgba(201,82,127,0.10) 0 6px, rgba(201,82,127,0.02) 6px 12px)'
                : 'var(--color-rose-soft)',
              border: '1px solid rgba(220,38,38,0.22)',
            }}>
            <Ban size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-rose)' }}/>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate" style={{ color: 'var(--color-rose)' }}>
                {b.titulo || 'Bloqueio'}
              </p>
              <p className="text-xs text-text-3 truncate">
                {faixaDoBloqueioNoDia(b, chaveDia)} · {quem}{motivo && motivo !== b.titulo ? ` · ${motivo}` : ''}
              </p>
              {pendente && (
                <p className="text-[11px] font-semibold" style={{ color: 'var(--color-amber)' }}>aguardando aprovação</p>
              )}
            </div>
            {podeRemover && (
              <button
                onClick={() => onPedirRemover(b)}
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface transition"
                title="Remover bloqueio">
                <X size={13} strokeWidth={2.5} style={{ color: 'var(--color-rose)' }}/>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
