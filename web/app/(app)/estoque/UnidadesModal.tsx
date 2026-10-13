'use client';

/**
 * @file estoque/UnidadesModal.tsx
 * Ajuste das unidades de medida que aparecem no cadastro de produto da empresa.
 * Grava em `estoque_unidades_empresa` (migration 088); produtos já cadastrados nunca mudam.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import {
  GRUPOS_UNIDADE, UNIDADES_PRODUTO, UNIDADES_PADRAO, normalizarUnidadesVisiveis,
} from '@shared/estoque';
import { salvarUnidadesVisiveis } from '@shared/estoque-consultas';

const supabase = createClient();

export function UnidadesModal({ empresaId, visiveis, onClose, onSalvo }: {
  empresaId: string;
  /** Unidades visíveis hoje (null = padrão). */
  visiveis: string[] | null;
  onClose: () => void;
  onSalvo: (unidades: string[]) => void;
}) {
  useScrollLock();

  const [ligadas,  setLigadas]  = useState<string[]>(() => normalizarUnidadesVisiveis(visiveis ?? UNIDADES_PADRAO));
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');

  function alternar(chave: string) {
    setLigadas(prev => prev.includes(chave) ? prev.filter(c => c !== chave) : [...prev, chave]);
  }

  async function salvar() {
    setErro(''); setSalvando(true);
    try {
      const lista = await salvarUnidadesVisiveis(supabase, empresaId, ligadas);
      onSalvo(lista);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ajustar as unidades.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-serif text-xl text-text">Unidades de medida</h2>
            <p className="text-xs text-text-3 mt-0.5">Escolha as que aparecem ao cadastrar um produto.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
          {GRUPOS_UNIDADE.map(g => (
            <div key={g.key}>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">{g.label}</label>
              <div className="flex flex-wrap gap-2">
                {UNIDADES_PRODUTO.filter(u => u.grupo === g.key).map(u => {
                  const ativo = ligadas.includes(u.key);
                  return (
                    <button key={u.key} type="button" onClick={() => alternar(u.key)} aria-pressed={ativo}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition ${
                        ativo
                          ? 'bg-primary-soft border-primary/30 text-primary'
                          : 'bg-bg border-border text-text-3 hover:border-accent'
                      }`}>
                      {u.label} ({u.key})
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {erro && <p className="text-red text-sm">{erro}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border flex-shrink-0">
          <button onClick={() => setLigadas(normalizarUnidadesVisiveis(UNIDADES_PADRAO))} type="button"
            className="h-10 px-3 rounded-xl border border-border text-text-3 text-sm font-semibold hover:bg-bg transition flex-shrink-0">
            Restaurar padrão
          </button>
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Cancelar
          </button>
          <button onClick={salvar} disabled={ligadas.length === 0 || salvando}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
