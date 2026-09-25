'use client';

import { useState } from 'react';
import { Target, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Secret } from '@/components/privacy';
import { progressoMetaPessoal } from '@shared/dashboard-profissional';

const supabase = createClient();

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

/** Meta mensal pessoal da profissional — distinta da meta da empresa. Ela
 * mesma define e altera; a mutação passa pela RPC `definir_minha_meta_mensal`
 * (migration 079), que só toca a própria linha/coluna. */
export default function MetaPessoalCard({ metaInicial, faturamentoBrutoMes }: {
  metaInicial: number | null;
  faturamentoBrutoMes: number;
}) {
  const [meta,       setMeta]       = useState(metaInicial);
  const [editando,   setEditando]   = useState(false);
  const [valorInput, setValorInput] = useState(meta ? meta.toFixed(2).replace('.', ',') : '');
  const [salvando,   setSalvando]   = useState(false);
  const [erro,       setErro]       = useState('');

  const progresso = progressoMetaPessoal(faturamentoBrutoMes, meta);

  function abrirEdicao() {
    setValorInput(meta ? meta.toFixed(2).replace('.', ',') : '');
    setErro('');
    setEditando(true);
  }

  async function salvar() {
    setErro('');
    if (!valorInput.trim()) {
      setSalvando(true);
      const { error } = await supabase.rpc('definir_minha_meta_mensal', { p_valor: null });
      setSalvando(false);
      if (error) { setErro(error.message); return; }
      setMeta(null); setEditando(false);
      return;
    }
    const valor = parseFloat(valorInput.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) { setErro('Valor inválido.'); return; }
    setSalvando(true);
    const { error } = await supabase.rpc('definir_minha_meta_mensal', { p_valor: valor });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setMeta(valor); setEditando(false);
  }

  if (editando) {
    return (
      <div className="mb-7 rounded-2xl p-4 md:p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Minha meta do mês
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
            <input value={valorInput} onChange={e => setValorInput(e.target.value)} inputMode="decimal" placeholder="Sem meta"
              className="w-full h-10 pl-9 pr-3.5 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"/>
          </div>
          <button onClick={salvar} disabled={salvando}
            className="h-10 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
          <button onClick={() => setEditando(false)}
            className="h-10 px-3 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Cancelar
          </button>
        </div>
        {erro && <p className="text-sm text-red mt-2">{erro}</p>}
        <p className="text-xs text-text-4 mt-2">Deixe em branco pra remover a meta.</p>
      </div>
    );
  }

  return (
    <div className="mb-7 rounded-2xl p-4 md:p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Target size={13} style={{ color: progresso.temMeta && progresso.percentual >= 100 ? 'var(--color-green)' : 'var(--color-accent)', flexShrink: 0 }} strokeWidth={2}/>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
          Minha meta do mês
        </p>
        <button onClick={abrirEdicao} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-3 hover:bg-bg transition">
          <Pencil size={13}/>
        </button>
      </div>
      {progresso.temMeta ? (
        <>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 700, color: progresso.percentual >= 100 ? 'var(--color-green)' : 'var(--color-ink2)', marginBottom: 8 }}>
            <Secret>{fmt(faturamentoBrutoMes)} / {fmt(meta!)}</Secret>
          </p>
          <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
            <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
              style={{ width: `${progresso.percentual}%`, background: progresso.percentual >= 100 ? 'var(--color-green)' : 'linear-gradient(90deg, var(--color-primary), var(--color-accent))' }}/>
          </div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: progresso.percentual >= 100 ? 'var(--color-green)' : 'var(--color-ink4)', marginTop: 6, fontWeight: progresso.percentual >= 100 ? 700 : 400 }}>
            <Secret>{progresso.percentual >= 100 ? 'Meta atingida!' : `${progresso.percentual}% concluído · faltam ${fmt(progresso.restante)}`}</Secret>
          </p>
        </>
      ) : (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink4)' }}>
          Sem meta definida — clique no ícone para definir uma meta pessoal.
        </p>
      )}
    </div>
  );
}
