'use client';

import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { trocarEmpresaAtiva } from '@/components/EmpresaAtivaProvider';

export type OpcaoEmpresa = { empresa_id: string; nome: string };

/**
 * Seletor de empresa ativa (Sidebar e menu "Mais"). Só aparece para quem tem 2 vínculos ativos
 * ou mais. Ao trocar, o servidor valida o vínculo e grava o cookie; depois a página recarrega
 * para todas as telas lerem a empresa nova.
 */
export default function SeletorEmpresa({ vinculos, empresaId }: { vinculos: OpcaoEmpresa[]; empresaId: string }) {
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState('');

  if (vinculos.length < 2) return null;

  async function trocar(novo: string) {
    if (novo === empresaId || trocando) return;
    setTrocando(true); setErro('');
    try {
      await trocarEmpresaAtiva(novo);
      window.location.reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível trocar de empresa.');
      setTrocando(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 rounded-xl px-2.5 py-1.5"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <Building2 size={14} strokeWidth={2} style={{ color: 'var(--color-ink3)' }} className="shrink-0" />
        <span className="sr-only">Empresa</span>
        <select value={empresaId} disabled={trocando} onChange={e => trocar(e.target.value)}
          aria-label="Trocar de empresa"
          className="flex-1 min-w-0 bg-transparent text-xs font-semibold outline-none disabled:opacity-60"
          style={{ color: 'var(--color-ink)' }}>
          {vinculos.map(v => <option key={v.empresa_id} value={v.empresa_id}>{v.nome}</option>)}
        </select>
      </label>
      {trocando && <p className="text-[11px]" style={{ color: 'var(--color-ink3)' }}>Trocando de empresa...</p>}
      {erro && <p className="text-[11px]" style={{ color: 'var(--color-rose)' }}>{erro}</p>}
    </div>
  );
}
