'use client';

import { useEffect, useRef, useState } from 'react';
import { MailPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  carregarMeusConvites, aceitarConvite, recusarConvite, mensagemConviteAceitoOutraEmpresa,
  type ConviteRecebido,
} from '@shared/convites-consultas';
import { rotuloPapelEquipe } from '@shared/equipe';

const supabase = createClient();

/**
 * Banner da convidada: convites pendentes para a conta logada, com Aceitar e Recusar.
 * Sem a migration 092 `carregarMeusConvites` devolve lista vazia e nada aparece.
 *
 * Empresa depois do aceite: o web usa o primeiro vínculo ativo (`getAppContext`, `limit(1)`) e
 * ainda não tem seletor de empresa ativa.
 * - `semEmpresa` (tela /criar-empresa): a empresa nova é a única, então vai direto para o painel.
 * - Dentro do app (já tem empresa): não recarrega (a página continuaria na empresa antiga ou cairia
 *   numa qualquer) e mostra o aviso de `mensagemConviteAceitoOutraEmpresa`.
 */
export default function ConvitesRecebidosBanner({ semEmpresa = false }: { semEmpresa?: boolean }) {
  const [convites, setConvites] = useState<ConviteRecebido[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const ocupadoRef = useRef(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  async function carregar() {
    try { setConvites(await carregarMeusConvites(supabase)); }
    catch { /* banner é opcional: falha de carga não atrapalha a tela */ }
  }

  useEffect(() => { carregar(); }, []);

  async function responder(c: ConviteRecebido, aceitar: boolean) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(c.id); setErro(''); setAviso('');
    try {
      if (aceitar) {
        await aceitarConvite(supabase, c.id);
        if (semEmpresa) {
          window.location.assign('/dashboard');
          return; // a trava fica ligada até a página trocar
        }
        setAviso(mensagemConviteAceitoOutraEmpresa(c.empresa_nome));
      } else {
        await recusarConvite(supabase, c.id);
      }
      setConvites(prev => prev.filter(x => x.id !== c.id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível responder ao convite.');
      await carregar();
    }
    ocupadoRef.current = false;
    setOcupado(null);
  }

  if (convites.length === 0 && !aviso && !erro) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {aviso && (
        <div className="flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-sm text-text"
          style={{ background: 'var(--color-primary-soft)', border: '1px solid var(--color-border)' }}>
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso('')} className="font-bold underline shrink-0">OK</button>
        </div>
      )}
      {erro && (
        <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--color-rose-soft)', color: 'var(--color-rose)' }}>{erro}</div>
      )}
      {convites.map(c => (
        <div key={c.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: 'var(--color-primary-soft)', border: '1px solid var(--color-border)' }}>
          <MailPlus size={18} style={{ color: 'var(--color-primary)' }} className="shrink-0"/>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text">
              Você foi convidada para entrar na equipe de <strong>{c.empresa_nome}</strong> como{' '}
              {rotuloPapelEquipe(c.role).toLowerCase()}.
            </p>
            {c.convidado_por_nome && <p className="text-xs text-text-3 mt-0.5">Convite de {c.convidado_por_nome}</p>}
          </div>
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
