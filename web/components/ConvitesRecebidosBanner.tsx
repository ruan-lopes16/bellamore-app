'use client';

import { useEffect, useState } from 'react';
import { MailPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { carregarMeusConvites, aceitarConvite, recusarConvite, type ConviteRecebido } from '@shared/convites-consultas';
import { rotuloPapelEquipe } from '@shared/equipe';

const supabase = createClient();

/**
 * Banner da convidada: convites pendentes para a conta logada, com Aceitar e Recusar.
 * Sem a migration 092 `carregarMeusConvites` devolve lista vazia e nada aparece.
 * Aceitar recarrega a página: a empresa é a do primeiro vínculo ativo (mesmo mecanismo do
 * `getAppContext`; o projeto ainda não tem seletor de empresa ativa).
 */
export default function ConvitesRecebidosBanner() {
  const [convites, setConvites] = useState<ConviteRecebido[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  async function carregar() {
    try { setConvites(await carregarMeusConvites(supabase)); }
    catch { /* banner é opcional: falha de carga não atrapalha a tela */ }
  }

  useEffect(() => { carregar(); }, []);

  async function responder(c: ConviteRecebido, aceitar: boolean) {
    if (ocupado) return;
    setOcupado(c.id); setErro('');
    try {
      if (aceitar) {
        await aceitarConvite(supabase, c.id);
        window.location.reload();
        return;
      }
      await recusarConvite(supabase, c.id);
      setConvites(prev => prev.filter(x => x.id !== c.id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível responder ao convite.');
      await carregar();
    }
    setOcupado(null);
  }

  if (convites.length === 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {erro && (
        <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--color-rose-soft)', color: 'var(--color-rose)' }}>{erro}</div>
      )}
      {convites.map(c => (
        <div key={c.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: 'var(--color-primary-soft)', border: '1px solid var(--color-border)' }}>
          <MailPlus size={18} style={{ color: 'var(--color-primary)' }} className="shrink-0"/>
          <p className="flex-1 text-sm text-text">
            {c.convidado_por_nome ? `${c.convidado_por_nome} convidou você` : 'Você foi convidada'} para a equipe de{' '}
            <strong>{c.empresa_nome}</strong> como {rotuloPapelEquipe(c.role).toLowerCase()}.
          </p>
          <div className="flex gap-2 shrink-0">
            <button type="button" disabled={!!ocupado} onClick={() => responder(c, false)}
              className="h-9 px-4 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition disabled:opacity-50">
              Recusar
            </button>
            <button type="button" disabled={!!ocupado} onClick={() => responder(c, true)}
              className="h-9 px-4 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {ocupado === c.id ? 'Aguarde...' : 'Aceitar'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
