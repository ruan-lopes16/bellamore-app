'use client';

import { useState } from 'react';
import { X, Pencil, Trash2, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { CategoriaIconCustom } from '@/components/CategoriaIcon';
import {
  CATEGORIA_PALETA, CATEGORIA_ICONES, bgDaCor, type CategoriaCustom,
} from '@shared/categorias';

const supabase = createClient();

type Props = {
  customs: CategoriaCustom[];
  contarUso: (categoriaId: string) => number;
  onClose: () => void;
  onAtualizada: (c: CategoriaCustom) => void;
  onExcluida: (id: string) => void;
};

export function CategoriasManagerModal({ customs, contarUso, onClose, onAtualizada, onExcluida }: Props) {
  useScrollLock();
  const [editId, setEditId]   = useState<string | null>(null);
  const [nome, setNome]       = useState('');
  const [cor, setCor]         = useState('');
  const [icone, setIcone]     = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [erro, setErro]       = useState('');
  const [busy, setBusy]       = useState(false);

  function abrirEdicao(c: CategoriaCustom) {
    setEditId(c.id); setNome(c.nome); setCor(c.cor); setIcone(c.icone); setErro('');
  }

  async function salvar(id: string) {
    const limpo = nome.trim();
    if (!limpo) { setErro('Nome obrigatório.'); return; }
    setBusy(true); setErro('');
    const { data, error } = await supabase
      .from('categorias_servico')
      .update({ nome: limpo, cor, icone })
      .eq('id', id).select('*').single();
    setBusy(false);
    if (error) {
      setErro(error.message.includes('uniq') ? 'Já existe categoria com esse nome.' : 'Sem permissão (só gestor/dono).');
      return;
    }
    onAtualizada(data as CategoriaCustom);
    setEditId(null);
  }

  async function excluir(id: string) {
    setBusy(true);
    const { error } = await supabase.from('categorias_servico').delete().eq('id', id).select('id');
    setBusy(false);
    if (error) { setErro('Sem permissão para excluir (só gestor/dono).'); return; }
    onExcluida(id);
    setConfirmDel(null);
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">Categorias personalizadas</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-3">
          {customs.length === 0 && (
            <p className="text-sm text-text-4 text-center py-6">
              Nenhuma categoria personalizada. Crie uma ao cadastrar um serviço.
            </p>
          )}
          {customs.map((c) => {
            const emEdicao = editId === c.id;
            const usos = contarUso(c.id);
            return (
              <div key={c.id} className="rounded-xl border border-border p-3">
                {!emEdicao ? (
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: bgDaCor(c.cor) }}>
                      <CategoriaIconCustom name={c.icone} size={15} color={c.cor} />
                    </span>
                    <span className="flex-1 text-sm font-semibold text-text">{c.nome}</span>
                    {confirmDel === c.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] text-red">{usos > 0 ? `${usos} serviço(s) usam` : 'Confirmar?'}</span>
                        <button onClick={() => excluir(c.id)} disabled={busy} className="px-2 h-7 rounded-lg bg-red text-white text-xs font-bold disabled:opacity-50">Excluir</button>
                        <button onClick={() => setConfirmDel(null)} className="px-2 h-7 rounded-lg border border-border text-xs">Cancelar</button>
                      </span>
                    ) : (
                      <>
                        <button onClick={() => abrirEdicao(c)} className="w-7 h-7 rounded-lg border border-border text-text-4 hover:text-text-2 flex items-center justify-center"><Pencil size={12} /></button>
                        <button onClick={() => { setConfirmDel(c.id); setErro(''); }} className="w-7 h-7 rounded-lg border border-border text-text-4 hover:text-red flex items-center justify-center"><Trash2 size={12} /></button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <input value={nome} onChange={(e) => setNome(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:border-accent" />
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIA_PALETA.map((p) => (
                        <button key={p.cor} type="button" onClick={() => setCor(p.cor)} className="w-7 h-7 rounded-full border-2" style={{ background: p.bg, borderColor: cor === p.cor ? p.cor : 'transparent' }}>
                          <span className="block w-3 h-3 rounded-full mx-auto" style={{ background: p.cor }} />
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIA_ICONES.map((n) => (
                        <button key={n} type="button" onClick={() => setIcone(n)} className="w-8 h-8 rounded-lg border flex items-center justify-center" style={{ borderColor: icone === n ? cor : 'var(--color-border)', color: icone === n ? cor : 'var(--color-ink3)' }}>
                          <CategoriaIconCustom name={n} size={15} />
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditId(null)} className="flex-1 h-9 rounded-lg border border-border text-sm font-semibold">Cancelar</button>
                      <button onClick={() => salvar(c.id)} disabled={busy} className="flex-1 h-9 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1"><Check size={14} /> Salvar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {erro && <p className="text-red text-sm">{erro}</p>}
        </div>
      </div>
    </div>
  );
}
