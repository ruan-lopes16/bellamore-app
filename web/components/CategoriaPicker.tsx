'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { CategoriaIcon, CategoriaIconCustom } from '@/components/CategoriaIcon';
import {
  ALL_CATEGORIAS, CATEGORIA_LABEL, CATEGORIA_COR, CATEGORIA_BG,
  CATEGORIA_PALETA, CATEGORIA_ICONES, bgDaCor,
  type CategoriaCustom, type CategoriaServico,
} from '@shared/categorias';

const supabase = createClient();

type Props = {
  empresaId: string;
  customs: CategoriaCustom[];
  categoria: string | null;
  categoriaId: string | null;
  onSelect: (categoria: string | null, categoriaId: string | null) => void;
  onCustomCriada: (c: CategoriaCustom) => void;
};

const chipBase =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition';

export function CategoriaPicker({ empresaId, customs, categoria, categoriaId, onSelect, onCustomCriada }: Props) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome]   = useState('');
  const [cor,  setCor]    = useState(CATEGORIA_PALETA[0].cor);
  const [icone, setIcone] = useState<string>(CATEGORIA_ICONES[0]);
  const [erro, setErro]   = useState('');
  const [salvando, setSalvando] = useState(false);

  const nomesUsados = new Set<string>([
    ...ALL_CATEGORIAS.map((k) => CATEGORIA_LABEL[k].toLowerCase()),
    ...customs.map((c) => c.nome.toLowerCase()),
  ]);

  async function criar() {
    const limpo = nome.trim();
    if (!limpo) { setErro('Dê um nome à categoria.'); return; }
    if (nomesUsados.has(limpo.toLowerCase())) { setErro('Já existe uma categoria com esse nome.'); return; }
    setErro(''); setSalvando(true);
    const { data, error } = await supabase
      .from('categorias_servico')
      .insert({ empresa_id: empresaId, nome: limpo, cor, icone })
      .select('*')
      .single();
    setSalvando(false);
    if (error) {
      setErro(
        error.message.includes('categorias_servico_empresa_nome_uniq')
          ? 'Já existe uma categoria com esse nome.'
          : 'Sem permissão para criar categoria (só gestor/dono).',
      );
      return;
    }
    const nova = data as CategoriaCustom;
    onCustomCriada(nova);
    onSelect(null, nova.id);
    setCriando(false); setNome(''); setCor(CATEGORIA_PALETA[0].cor); setIcone(CATEGORIA_ICONES[0]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {ALL_CATEGORIAS.map((k: CategoriaServico) => {
          const ativo = categoria === k && !categoriaId;
          return (
            <button key={k} type="button" onClick={() => onSelect(k, null)}
              className={chipBase}
              style={{
                backgroundColor: ativo ? CATEGORIA_BG[k] : undefined,
                borderColor: ativo ? CATEGORIA_COR[k] : undefined,
                color: ativo ? CATEGORIA_COR[k] : undefined,
              }}
              data-inactive={!ativo || undefined}>
              <CategoriaIcon categoria={k} size={12} color={ativo ? CATEGORIA_COR[k] : undefined}
                className={!ativo ? 'text-text-4' : ''} />
              <span className={!ativo ? 'text-text-3' : ''}>{CATEGORIA_LABEL[k]}</span>
            </button>
          );
        })}
        {customs.map((c) => {
          const ativo = categoriaId === c.id;
          return (
            <button key={c.id} type="button" onClick={() => onSelect(null, c.id)}
              className={chipBase}
              style={{
                backgroundColor: ativo ? bgDaCor(c.cor) : undefined,
                borderColor: ativo ? c.cor : undefined,
                color: ativo ? c.cor : undefined,
              }}
              data-inactive={!ativo || undefined}>
              <CategoriaIconCustom name={c.icone} size={12} color={ativo ? c.cor : undefined}
                className={!ativo ? 'text-text-4' : ''} />
              <span className={!ativo ? 'text-text-3' : ''}>{c.nome}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setCriando((v) => !v)}
          className={`${chipBase} border-dashed border-border text-text-3 hover:border-accent hover:text-accent`}>
          <Plus size={12} strokeWidth={2.5} /> Nova
        </button>
      </div>

      {criando && (
        <div className="mt-3 rounded-xl border border-border bg-bg p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-2 uppercase tracking-wide">Nova categoria</span>
            <button type="button" onClick={() => setCriando(false)} className="text-text-4 hover:text-text-2"><X size={14} /></button>
          </div>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex: Massagem)"
            className="w-full h-9 px-3 rounded-lg border border-border bg-surface text-text text-sm focus:outline-none focus:border-accent" />
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIA_PALETA.map((p) => (
              <button key={p.cor} type="button" onClick={() => setCor(p.cor)}
                className="w-7 h-7 rounded-full border-2 transition"
                style={{ background: p.bg, borderColor: cor === p.cor ? p.cor : 'transparent' }}>
                <span className="block w-3 h-3 rounded-full mx-auto" style={{ background: p.cor }} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIA_ICONES.map((n) => (
              <button key={n} type="button" onClick={() => setIcone(n)}
                className="w-8 h-8 rounded-lg border flex items-center justify-center transition"
                style={{ borderColor: icone === n ? cor : 'var(--color-border)', color: icone === n ? cor : 'var(--color-ink3)' }}>
                <CategoriaIconCustom name={n} size={15} />
              </button>
            ))}
          </div>
          {erro && <p className="text-red text-xs">{erro}</p>}
          <button type="button" onClick={criar} disabled={salvando}
            className="h-9 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar categoria'}
          </button>
        </div>
      )}
    </div>
  );
}
