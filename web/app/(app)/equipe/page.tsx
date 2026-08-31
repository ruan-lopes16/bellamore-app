'use client';

import { useState, useEffect } from 'react';
import {
  Plus, X, Phone, Edit3, PowerOff, Power, Percent, UserCog, ChevronDown, CheckCircle2, BarChart2, Trophy,
  UploadCloud, FileText,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { format, startOfMonth, endOfMonth, subMonths, isSameMonth } from 'date-fns';
import { Sk } from '@/components/Skeleton';
import { maskPhone, maskCNPJ, maskCPF, validaCNPJ, validaCPF } from '@/lib/masks';
import { podeAtribuirRole } from '@/lib/permissions';
// createClient usado apenas nas funções da tela principal (carregarEquipe, toggleAtivo, salvarComissao)
import { ptBR } from 'date-fns/locale';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type TipoContrato = 'clt' | 'pj' | 'autonomo';

type Profissional = {
  id: string;           // empresa_membros.id
  user_id: string;
  role: 'owner' | 'gestor' | 'profissional';
  percentual_comissao: number;
  ativo: boolean;
  created_at: string;
  user: { id: string; nome: string; telefone?: string; email?: string };
  total_mes: number;
  atendimentos_mes: number;
  comissao_pendente: number;
  // Dados contratuais — todos opcionais, preenchidos depois da criação
  tipo_contrato?: TipoContrato | null;
  documento?: string | null;              // CPF (CLT/autônomo) ou CNPJ (PJ)
  data_admissao?: string | null;
  contrato_arquivo_path?: string | null;  // caminho no bucket privado, não URL
};

const TIPO_CONTRATO_LABEL: Record<TipoContrato, string> = {
  clt: 'CLT', pj: 'PJ', autonomo: 'Autônomo',
};

// ── Helpers ───────────────────────────────────────────────────

const AVATAR_CORES = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
] as const;

function avatarCor(nome: string) {
  return AVATAR_CORES[(nome?.charCodeAt(0) ?? 0) % AVATAR_CORES.length];
}
function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function roleBadge(role: 'owner' | 'gestor' | 'profissional') {
  if (role === 'owner')  return { label: 'Dono(a)',     bg: 'var(--color-primary-soft)', color: 'var(--color-primary)' };
  if (role === 'gestor') return { label: 'Gestor(a)',   bg: 'rgba(59,130,246,0.12)',     color: 'rgb(59,130,246)' };
  return                        { label: 'Profissional', bg: 'var(--color-bg2)',          color: 'var(--color-ink3)' };
}
function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}

const inputClass = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelClass = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

// ── Campos de dados contratuais (reaproveitado em Nova/Editar profissional) ──
// Tipo de contrato define qual documento faz sentido pedir: CLT e Autônomo
// pedem CPF (é a pessoa física que assina), PJ pede CNPJ (é a empresa dela).
function CamposContratuais({ tipoContrato, setTipoContrato, documento, setDocumento, dataAdmissao, setDataAdmissao }: {
  tipoContrato: TipoContrato | '';   setTipoContrato: (v: TipoContrato | '') => void;
  documento: string;                 setDocumento: (v: string) => void;
  dataAdmissao: string;              setDataAdmissao: (v: string) => void;
}) {
  return (
    <div className="border-t border-border pt-4 flex flex-col gap-4">
      <p className={labelClass}>Dados contratuais <span className="text-text-4 normal-case font-normal">(opcional)</span></p>
      <div>
        <label className={labelClass}>Tipo de contrato</label>
        <div className="grid grid-cols-3 gap-2">
          {(['clt', 'pj', 'autonomo'] as const).map(t => (
            <button key={t} type="button"
              onClick={() => setTipoContrato(tipoContrato === t ? '' : t)}
              className="h-10 rounded-xl border text-sm font-semibold transition"
              style={{
                borderColor: tipoContrato === t ? 'var(--color-primary)' : 'var(--color-border)',
                background:  tipoContrato === t ? 'var(--color-primary-soft)' : 'transparent',
                color:       tipoContrato === t ? 'var(--color-primary)' : 'var(--color-text-2)',
              }}>
              {TIPO_CONTRATO_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      {tipoContrato && (
        <>
          <div>
            <label className={labelClass}>{tipoContrato === 'pj' ? 'CNPJ' : 'CPF'}</label>
            <input value={documento}
              onChange={e => setDocumento(tipoContrato === 'pj' ? maskCNPJ(e.target.value) : maskCPF(e.target.value))}
              placeholder={tipoContrato === 'pj' ? '00.000.000/0000-00' : '000.000.000-00'}
              inputMode="numeric" className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Data de admissão</label>
            <input value={dataAdmissao} onChange={e => setDataAdmissao(e.target.value)}
              type="date" className={inputClass}/>
          </div>
        </>
      )}
    </div>
  );
}

// ── Modal adicionar profissional ──────────────────────────────

function NovoProfModal({ empresaId, meuRole, onClose, onSalvo }: {
  empresaId: string;
  meuRole: 'owner' | 'gestor' | 'profissional';
  onClose: () => void;
  onSalvo: (p: Profissional, mensagem?: string) => void;
}) {
  useScrollLock();
  const [nome,          setNome]          = useState('');
  const [telefone,      setTelefone]      = useState('');
  const [email,         setEmail]         = useState('');
  const [enviarConvite, setEnviarConvite] = useState(true);
  const [comissao,      setComissao]      = useState('0');
  const [role,          setRole]          = useState<'gestor' | 'profissional'>('profissional');
  const [tipoContrato,  setTipoContrato]  = useState<TipoContrato | ''>('');
  const [documento,     setDocumento]     = useState('');
  const [dataAdmissao,  setDataAdmissao]  = useState('');
  const [salvando,      setSalvando]      = useState(false);
  const [erro,          setErro]          = useState('');

  const temEmail = email.trim().length > 0;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (documento.trim() && tipoContrato === 'pj' && !validaCNPJ(documento)) { setErro('CNPJ inválido. Verifique os dígitos.'); return; }
    if (documento.trim() && tipoContrato !== 'pj' && !validaCPF(documento))  { setErro('CPF inválido. Verifique os dígitos.'); return; }
    setSalvando(true);

    const usarConvite = temEmail && enviarConvite;
    const res = await fetch(usarConvite ? '/api/convites' : '/api/profissionais', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresaId,
        nome:                 nome.trim(),
        telefone:             telefone.trim() || null,
        email:                email.trim() || null,
        percentual_comissao:  parseFloat(comissao) || 0,
        role,
        tipo_contrato:        tipoContrato || null,
        documento:            documento.trim() || null,
        data_admissao:        dataAdmissao || null,
      }),
    });

    const json = await res.json();
    setSalvando(false);

    if (!res.ok) { setErro(json.error ?? 'Erro ao salvar.'); return; }

    onSalvo(
      { ...json.membro, total_mes: 0, atendimentos_mes: 0 },
      json.status === 'convite_enviado'
        ? `Convite enviado! ${nome.trim()} vai receber um e-mail para criar a senha.`
        : undefined,
    );
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto overflow-x-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-serif text-xl text-text">Nova profissional</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>
        <form onSubmit={salvar} className="p-5 flex flex-col gap-4">
          <div>
            <label className={labelClass}>Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Nome completo" required className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Telefone</label>
            <input value={telefone} onChange={e => setTelefone(maskPhone(e.target.value))}
              placeholder="(11) 99999-9999" type="tel" maxLength={15} className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>E-mail <span className="text-text-4 normal-case font-normal">(opcional)</span></label>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@exemplo.com" type="email" className={inputClass}/>
          </div>
          {temEmail && (
            <label className="flex items-start gap-2.5 -mt-1 cursor-pointer">
              <input type="checkbox" checked={enviarConvite} onChange={e => setEnviarConvite(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-border accent-[var(--color-primary)] flex-shrink-0"/>
              <span className="text-xs text-text-2 leading-snug">
                Enviar convite por e-mail — ela cria a própria senha e acessa o app com este e-mail.
              </span>
            </label>
          )}
          {podeAtribuirRole(meuRole, 'gestor') && (
            <div>
              <label className={labelClass}>Papel</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setRole('profissional')}
                  className="flex-1 h-10 rounded-xl border text-sm font-semibold transition"
                  style={{
                    borderColor: role === 'profissional' ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  role === 'profissional' ? 'var(--color-primary-soft)' : 'transparent',
                    color:       role === 'profissional' ? 'var(--color-primary)' : 'var(--color-text-2)',
                  }}>
                  Profissional
                </button>
                <button type="button" onClick={() => setRole('gestor')}
                  className="flex-1 h-10 rounded-xl border text-sm font-semibold transition"
                  style={{
                    borderColor: role === 'gestor' ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  role === 'gestor' ? 'var(--color-primary-soft)' : 'transparent',
                    color:       role === 'gestor' ? 'var(--color-primary)' : 'var(--color-text-2)',
                  }}>
                  Gestora
                </button>
              </div>
            </div>
          )}
          <div>
            <label className={labelClass}>Comissão por atendimento (%)</label>
            <div className="relative">
              <input value={comissao} onChange={e => setComissao(e.target.value)}
                inputMode="decimal" placeholder="0" min="0" max="100"
                className={`${inputClass} pr-8`}/>
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold pointer-events-none">%</span>
            </div>
          </div>
          <CamposContratuais
            tipoContrato={tipoContrato} setTipoContrato={setTipoContrato}
            documento={documento}       setDocumento={setDocumento}
            dataAdmissao={dataAdmissao} setDataAdmissao={setDataAdmissao}/>
          <p className="text-[11px] text-text-4 -mt-2">Documento do contrato pode ser anexado depois, em "Editar profissional".</p>
          {erro && <p className="text-red text-sm">{erro}</p>}
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || !nome.trim()}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {salvando
                ? (temEmail && enviarConvite ? 'Enviando convite...' : 'Salvando...')
                : (temEmail && enviarConvite ? 'Enviar convite' : 'Adicionar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal editar informações ──────────────────────────────────

function EditInfoModal({ prof, empresaId, onClose, onSalvo }: {
  prof: Profissional;
  empresaId: string;
  onClose: () => void;
  onSalvo: (dados: {
    nome: string; telefone: string; email: string; comissao: number;
    tipoContrato: TipoContrato | ''; documento: string; dataAdmissao: string;
    contratoArquivoPath?: string;
  }) => void;
}) {
  useScrollLock();
  const [nome,         setNome]         = useState(prof.user.nome);
  const [telefone,     setTelefone]     = useState(prof.user.telefone ?? '');
  const [email,        setEmail]        = useState(prof.user.email ?? '');
  const [comissao,     setComissao]     = useState(String(prof.percentual_comissao));
  const [tipoContrato, setTipoContrato] = useState<TipoContrato | ''>(prof.tipo_contrato ?? '');
  const [documento,    setDocumento]    = useState(prof.documento ?? '');
  const [dataAdmissao, setDataAdmissao] = useState(prof.data_admissao ?? '');
  const [arquivo,      setArquivo]      = useState<File | null>(null);
  const [enviandoArq,  setEnviandoArq]  = useState(false);
  const [abrindoDoc,   setAbrindoDoc]   = useState(false);
  const [salvando,     setSalvando]     = useState(false);
  const [erro,         setErro]         = useState('');

  async function verDocumentoAtual() {
    if (!prof.contrato_arquivo_path) return;
    setAbrindoDoc(true);
    const { data, error } = await supabase.storage
      .from('contratos-equipe')
      .createSignedUrl(prof.contrato_arquivo_path, 60);
    setAbrindoDoc(false);
    if (error || !data) { setErro('Não foi possível abrir o documento.'); return; }
    window.open(data.signedUrl, '_blank');
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setErro('');
    if (documento.trim() && tipoContrato === 'pj' && !validaCNPJ(documento)) { setErro('CNPJ inválido. Verifique os dígitos.'); return; }
    if (documento.trim() && tipoContrato !== 'pj' && !validaCPF(documento))  { setErro('CPF inválido. Verifique os dígitos.'); return; }
    setSalvando(true);

    // Upload do documento primeiro (se um arquivo novo foi escolhido) — nome
    // fixo por profissional (não usa o nome original do arquivo), então um
    // reenvio sempre substitui o anterior em vez de acumular versões soltas
    // no bucket.
    let contratoArquivoPath: string | undefined;
    if (arquivo) {
      setEnviandoArq(true);
      const ext = arquivo.name.split('.').pop()?.toLowerCase() || 'pdf';
      const path = `${empresaId}/${prof.id}/contrato.${ext}`;
      const { error: erroUpload } = await supabase.storage
        .from('contratos-equipe')
        .upload(path, arquivo, { upsert: true });
      setEnviandoArq(false);
      if (erroUpload) { setErro(`Erro ao enviar documento: ${erroUpload.message}`); setSalvando(false); return; }
      contratoArquivoPath = path;
    }

    const pct = parseFloat(comissao) || 0;
    const res = await fetch('/api/profissionais', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId:               prof.user_id,
        nome:                 nome.trim(),
        telefone:             telefone.trim() || null,
        email:                email.trim() || null,
        membroId:             prof.id,
        percentual_comissao:  pct,
        tipo_contrato:        tipoContrato || null,
        documento:            documento.trim() || null,
        data_admissao:        dataAdmissao || null,
        ...(contratoArquivoPath ? { contrato_arquivo_path: contratoArquivoPath } : {}),
      }),
    });
    const json = await res.json();
    setSalvando(false);
    if (!res.ok) { setErro(json.error ?? 'Erro ao salvar.'); return; }

    onSalvo({
      nome: nome.trim(), telefone: telefone.trim(), email: email.trim(), comissao: pct,
      tipoContrato, documento: documento.trim(), dataAdmissao, contratoArquivoPath,
    });
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto overflow-x-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-serif text-xl text-text">Editar profissional</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>
        <form onSubmit={salvar} className="p-5 flex flex-col gap-4">
          <div>
            <label className={labelClass}>Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Nome completo" required autoFocus className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Telefone</label>
            <input value={telefone} onChange={e => setTelefone(maskPhone(e.target.value))}
              placeholder="(11) 99999-9999" type="tel" maxLength={15} className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>E-mail</label>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@exemplo.com" type="email" className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Comissão por atendimento (%)</label>
            <div className="relative">
              <input value={comissao} onChange={e => setComissao(e.target.value)}
                inputMode="decimal" placeholder="0" min="0" max="100"
                className={`${inputClass} pr-8`}/>
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold pointer-events-none">%</span>
            </div>
          </div>
          <CamposContratuais
            tipoContrato={tipoContrato} setTipoContrato={setTipoContrato}
            documento={documento}       setDocumento={setDocumento}
            dataAdmissao={dataAdmissao} setDataAdmissao={setDataAdmissao}/>
          <div>
            <label className={labelClass}>Documento do contrato <span className="text-text-4 normal-case font-normal">(PDF ou imagem, opcional)</span></label>
            <label className="flex items-center gap-3 h-10 px-3.5 rounded-xl border border-dashed border-border bg-bg text-sm text-text-3 cursor-pointer hover:border-accent transition">
              <UploadCloud size={15} strokeWidth={2} className="flex-shrink-0"/>
              <span className="truncate">{arquivo ? arquivo.name : 'Selecionar arquivo...'}</span>
              <input type="file" accept="application/pdf,image/*" className="hidden"
                onChange={e => setArquivo(e.target.files?.[0] ?? null)}/>
            </label>
            {!arquivo && prof.contrato_arquivo_path && (
              <button type="button" onClick={verDocumentoAtual} disabled={abrindoDoc}
                className="mt-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50">
                {abrindoDoc ? 'Abrindo...' : 'Ver documento já enviado'}
              </button>
            )}
          </div>
          {erro && <p className="text-red text-sm">{erro}</p>}
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || !nome.trim()}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {salvando ? (enviandoArq ? 'Enviando documento...' : 'Salvando...') : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Desempenho individual ───────────────────────────────────────
// Busca sob demanda (só quando o modal abre) pra não pagar N+1 queries no
// carregamento normal da lista de equipe.

function DesempenhoModal({ prof, empresaId, onClose }: {
  prof: Profissional; empresaId: string; onClose: () => void;
}) {
  useScrollLock();
  const [loading, setLoading] = useState(true);
  const [tendencia, setTendencia] = useState<{ mes: string; valor: number }[]>([]);
  const [topServicos, setTopServicos] = useState<{ nome: string; qtd: number; valor: number }[]>([]);
  const [comparecimento, setComparecimento] = useState<{ concluido: number; perdido: number } | null>(null);

  useEffect(() => {
    (async () => {
      const hoje = new Date();
      const ini6 = startOfMonth(subMonths(hoje, 5));
      const fimMesAtual = endOfMonth(hoje);
      const iniMesAtual = startOfMonth(hoje);

      const { data } = await supabase.from('agendamentos')
        .select('valor, status, data_hora_inicio, servico:servicos(nome)')
        .eq('empresa_id', empresaId).eq('profissional_id', prof.user_id)
        .gte('data_hora_inicio', ini6.toISOString()).lte('data_hora_inicio', fimMesAtual.toISOString());

      type Row = { valor: number; status: string; data_hora_inicio: string; servico: { nome: string } | null };
      const rows = (data ?? []) as unknown as Row[];

      // Tendência 6 meses (só concluídos)
      const porMes = Array.from({ length: 6 }, (_, i) => {
        const m = subMonths(hoje, 5 - i);
        const valor = rows
          .filter(r => r.status === 'concluido' && isSameMonth(new Date(r.data_hora_inicio), m))
          .reduce((s, r) => s + Number(r.valor), 0);
        return { mes: format(m, 'MMM', { locale: ptBR }), valor };
      });
      setTendencia(porMes);

      // Top serviços do mês atual
      const rowsMes = rows.filter(r => r.status === 'concluido' && new Date(r.data_hora_inicio) >= iniMesAtual);
      const svcMap: Record<string, { qtd: number; valor: number }> = {};
      rowsMes.forEach(r => {
        const nome = r.servico?.nome ?? 'Serviço';
        if (!svcMap[nome]) svcMap[nome] = { qtd: 0, valor: 0 };
        svcMap[nome].qtd += 1; svcMap[nome].valor += Number(r.valor);
      });
      setTopServicos(Object.entries(svcMap).map(([nome, s]) => ({ nome, ...s })).sort((a, b) => b.valor - a.valor).slice(0, 5));

      // Comparecimento do mês atual (só agendamentos já ocorridos: concluído/cancelado/faltou)
      const rowsFinalizados = rows.filter(r =>
        new Date(r.data_hora_inicio) >= iniMesAtual &&
        ['concluido', 'cancelado', 'faltou'].includes(r.status)
      );
      const concluido = rowsFinalizados.filter(r => r.status === 'concluido').length;
      const perdido    = rowsFinalizados.filter(r => r.status !== 'concluido').length;
      setComparecimento({ concluido, perdido });

      setLoading(false);
    })();
  }, [prof.user_id, empresaId]);

  const ticketMedio = prof.atendimentos_mes > 0 ? prof.total_mes / prof.atendimentos_mes : 0;
  const maxTendencia = Math.max(...tendencia.map(t => t.valor), 1);
  const totalComparecimento = comparecimento ? comparecimento.concluido + comparecimento.perdido : 0;
  const pctComparecimento = totalComparecimento > 0 ? (comparecimento!.concluido / totalComparecimento) * 100 : null;

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col max-h-[85dvh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-serif text-lg text-text">{prof.user.nome}</h2>
            <p className="text-xs text-text-3 mt-0.5">Desempenho individual</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition flex-shrink-0">
            <X size={16}/>
          </button>
        </div>

        <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 p-5 flex flex-col gap-5">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-bg animate-pulse"/>)}
            </div>
          ) : (
            <>
              {/* KPIs rápidos */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-bg rounded-xl p-3">
                  <p className="text-[10px] text-text-3 uppercase tracking-wide mb-1">Ticket médio · mês</p>
                  <p className="text-lg font-bold text-text">{fmtBRL(ticketMedio)}</p>
                </div>
                <div className="bg-bg rounded-xl p-3">
                  <p className="text-[10px] text-text-3 uppercase tracking-wide mb-1">Comparecimento · mês</p>
                  <p className="text-lg font-bold" style={{ color: pctComparecimento === null ? 'var(--color-ink4)' : pctComparecimento >= 80 ? 'var(--color-green)' : 'var(--color-amber)' }}>
                    {pctComparecimento === null ? '—' : `${pctComparecimento.toFixed(0)}%`}
                  </p>
                </div>
              </div>

              {/* Tendência 6 meses */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-text-3 mb-3">Faturamento gerado · 6 meses</p>
                <div className="flex items-end gap-2" style={{ height: 96 }}>
                  {tendencia.map((t, i) => {
                    const isAtual = i === tendencia.length - 1;
                    const h = maxTendencia > 0 ? (t.valor / maxTendencia) * 100 : 0;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex items-end" style={{ height: 76 }}>
                          <div className="w-full rounded-t-sm transition-all" style={{ height: `${h}%`, background: 'var(--color-primary)', opacity: isAtual ? 1 : 0.35 + (i / tendencia.length) * 0.5 }}/>
                        </div>
                        <p className={`text-[9px] font-semibold capitalize ${isAtual ? 'text-primary' : 'text-text-4'}`}>{t.mes}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top serviços do mês */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-text-3 mb-3 flex items-center gap-1.5">
                  <Trophy size={12}/> Top serviços · mês
                </p>
                {topServicos.length === 0 ? (
                  <p className="text-sm text-text-4 italic">Sem atendimentos concluídos este mês.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {topServicos.map((s, i) => (
                      <div key={s.nome} className="flex items-center gap-2">
                        <span className={`text-sm font-bold w-4 flex-shrink-0 ${i < 2 ? 'text-primary' : 'text-text-4'}`}>{i + 1}</span>
                        <span className="text-sm text-text flex-1 truncate">{s.nome}</span>
                        <span className="text-xs text-text-4 flex-shrink-0">{s.qtd}×</span>
                        <span className="text-sm font-bold text-text flex-shrink-0 w-16 text-right">{fmtBRL(s.valor)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Card profissional ─────────────────────────────────────────

function ProfCard({ prof, podeAlterarRole, onEditInfo, onToggle, onPagar, onAlterarRole, onVerDesempenho }: {
  prof: Profissional;
  podeAlterarRole: boolean;
  onEditInfo: () => void;
  onToggle: () => void;
  onPagar: () => void;
  onAlterarRole: () => void;
  onVerDesempenho: () => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const [pagando,   setPagando]   = useState(false);
  const [abrindoDoc,setAbrindoDoc]= useState(false);

  let hue = 0;
  for (let i = 0; i < prof.user.nome.length; i++) hue = (hue * 31 + prof.user.nome.charCodeAt(i)) % 360;

  const temPendente = prof.comissao_pendente > 0;

  async function handlePagar() {
    setPagando(true);
    await onPagar();
    setPagando(false);
  }

  async function verDocumento() {
    if (!prof.contrato_arquivo_path) return;
    setAbrindoDoc(true);
    const { data, error } = await supabase.storage
      .from('contratos-equipe')
      .createSignedUrl(prof.contrato_arquivo_path, 60);
    setAbrindoDoc(false);
    if (!error && data) window.open(data.signedUrl, '_blank');
  }

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', opacity: prof.ativo ? 1 : 0.6, transition: 'opacity 0.2s' }}>

      {/* ── Cabeçalho (sempre visível, clicável para expandir) */}
      <button onClick={() => setExpandido(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 20, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        {/* Avatar */}
        <div style={{ width: 48, height: 48, borderRadius: 16, background: prof.ativo ? `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))` : 'linear-gradient(140deg, #9CA3AF, #6B7280)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-sans)' }}>{iniciais(prof.user.nome)}</span>
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <p style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--color-ink)', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prof.user.nome}</p>
            <button onClick={e => { e.stopPropagation(); onEditInfo(); }} title="Editar informações"
              style={{ width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink4)', background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}
              className="hover:text-accent transition">
              <Edit3 size={11} strokeWidth={2}/>
            </button>
          </div>
          {prof.user.telefone && (
            <a href={`tel:${prof.user.telefone}`} onClick={e => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--color-ink3)', textDecoration: 'none', marginTop: 2 }}
              className="hover:text-primary transition">
              <Phone size={10} strokeWidth={2}/>{prof.user.telefone}
            </a>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, background: prof.ativo ? 'var(--color-green-soft)' : 'var(--color-bg)', color: prof.ativo ? 'var(--color-green)' : 'var(--color-ink4)' }}>
              {prof.ativo ? 'Ativa' : 'Inativa'}
            </span>
            <span style={{ display: 'inline-flex', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, background: roleBadge(prof.role).bg, color: roleBadge(prof.role).color }}>
              {roleBadge(prof.role).label}
            </span>
            {temPendente && !expandido && (
              <span style={{ display: 'inline-flex', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, background: 'rgba(217,119,6,0.12)', color: '#B45309' }}>
                {fmtBRL(prof.comissao_pendente)} pendente
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <ChevronDown size={16} strokeWidth={2}
          style={{ color: 'var(--color-ink4)', flexShrink: 0, transition: 'transform 0.2s', transform: expandido ? 'rotate(180deg)' : 'rotate(0deg)' }}/>
      </button>

      {/* ── Conteúdo expandido */}
      {expandido && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--color-border)' }}>

          {/* Stats do mês */}
          {prof.ativo && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14, marginTop: 16 }}>
              <div style={{ background: 'var(--color-bg)', borderRadius: 14, padding: '10px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-primary)', lineHeight: 1, fontFamily: 'var(--font-sans)' }}>{prof.atendimentos_mes}</p>
                <p style={{ fontSize: 9.5, color: 'var(--color-ink4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Atendimentos</p>
              </div>
              <div style={{ background: 'var(--color-bg)', borderRadius: 14, padding: '10px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-green)', lineHeight: 1, fontFamily: 'var(--font-sans)' }}>{fmtBRL(prof.total_mes)}</p>
                <p style={{ fontSize: 9.5, color: 'var(--color-ink4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Faturado · mês</p>
              </div>
            </div>
          )}

          {/* Desempenho individual */}
          {prof.ativo && (
            <button onClick={onVerDesempenho}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 14, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)', marginBottom: 12 }}
              className="hover:bg-bg">
              <BarChart2 size={13} strokeWidth={2}/> Ver desempenho
            </button>
          )}

          {/* Comissão % */}
          {prof.ativo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 14, background: 'var(--color-primary-soft)', marginBottom: 12 }}>
              <Percent size={14} strokeWidth={2} style={{ color: 'var(--color-primary)', flexShrink: 0 }}/>
              <span style={{ fontSize: 11.5, color: 'var(--color-ink3)', flex: 1 }}>Comissão por atendimento</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-primary)', fontFamily: 'var(--font-sans)' }}>{prof.percentual_comissao}%</span>
            </div>
          )}

          {/* Dados contratuais — só aparece se algo já foi preenchido */}
          {prof.tipo_contrato && (
            <div style={{ padding: '10px 14px', borderRadius: 14, background: 'var(--color-bg)', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <UserCog size={13} strokeWidth={2} style={{ color: 'var(--color-ink3)', flexShrink: 0 }}/>
                <span style={{ fontSize: 11.5, color: 'var(--color-ink3)', flex: 1 }}>Contrato</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-ink2)' }}>{TIPO_CONTRATO_LABEL[prof.tipo_contrato]}</span>
              </div>
              {prof.documento && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 21 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-ink4)' }}>{prof.tipo_contrato === 'pj' ? 'CNPJ' : 'CPF'}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-ink2)' }}>{prof.documento}</span>
                </div>
              )}
              {prof.data_admissao && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 21 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-ink4)' }}>Admissão</span>
                  <span style={{ fontSize: 11, color: 'var(--color-ink2)' }}>{format(new Date(prof.data_admissao + 'T12:00'), 'dd/MM/yyyy')}</span>
                </div>
              )}
              {prof.contrato_arquivo_path && (
                <button onClick={e => { e.stopPropagation(); verDocumento(); }} disabled={abrindoDoc}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, paddingLeft: 21, background: 'transparent', border: 'none', cursor: abrindoDoc ? 'default' : 'pointer', color: 'var(--color-primary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
                  <FileText size={11} strokeWidth={2}/> {abrindoDoc ? 'Abrindo...' : 'Ver documento'}
                </button>
              )}
            </div>
          )}

          {/* Pagar comissão */}
          {prof.ativo && temPendente && (
            <button onClick={handlePagar} disabled={pagando}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, borderRadius: 14, fontSize: 12, fontWeight: 700, cursor: pagando ? 'default' : 'pointer', transition: 'all 0.15s', border: 'none', background: pagando ? 'var(--color-bg2)' : '#B45309', color: pagando ? 'var(--color-ink4)' : '#fff', fontFamily: 'var(--font-sans)', marginBottom: 10, opacity: pagando ? 0.7 : 1 }}>
              <CheckCircle2 size={14} strokeWidth={2.5}/>
              {pagando ? 'Registrando...' : `Pagar ${fmtBRL(prof.comissao_pendente)}`}
            </button>
          )}

          {/* Comissão em dia */}
          {prof.ativo && !temPendente && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 14, background: 'var(--color-green-soft)', marginBottom: 12, fontSize: 11.5, color: 'var(--color-green)', fontWeight: 600 }}>
              <CheckCircle2 size={13} strokeWidth={2.5}/>
              Comissão em dia
            </div>
          )}

          {/* Ativar / desativar */}
          <button onClick={onToggle}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 14, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', border: prof.ativo ? '1px solid rgba(201,82,127,0.3)' : '1px solid rgba(21,122,91,0.3)', background: 'transparent', color: prof.ativo ? 'var(--color-rose)' : 'var(--color-green)', fontFamily: 'var(--font-sans)' }}
            className={prof.ativo ? 'hover:bg-red-soft' : 'hover:bg-green-soft'}>
            {prof.ativo
              ? <><PowerOff size={13} strokeWidth={2}/> Desativar profissional</>
              : <><Power     size={13} strokeWidth={2}/> Reativar profissional</>
            }
          </button>

          {/* Promover / rebaixar */}
          {podeAlterarRole && prof.role !== 'owner' && (
            <button onClick={onAlterarRole}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 14, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)', marginTop: 8 }}>
              <UserCog size={13} strokeWidth={2}/>
              {prof.role === 'gestor' ? 'Rebaixar para profissional' : 'Promover a gestora'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function EquipePage() {
  const [profs,     setProfs]     = useState<Profissional[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [modal,          setModal]          = useState(false);
  const [editandoInfo,   setEditandoInfo]   = useState<Profissional | null>(null);
  const [confirmDesativar, setConfirmDesativar] = useState<Profissional | null>(null);
  const [meuUserId, setMeuUserId] = useState<string | null>(null);
  const [meuRole,   setMeuRole]   = useState<'owner' | 'gestor' | 'profissional'>('profissional');
  const [toast,     setToast]     = useState('');
  const [desempenho, setDesempenho] = useState<Profissional | null>(null);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000); }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id, role')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;
      setEmpresaId(membro.empresa_id);
      setMeuUserId(user.id);
      setMeuRole(membro.role as 'owner' | 'gestor' | 'profissional');
      await carregarEquipe(membro.empresa_id);
    })();
  }, []);

  async function carregarEquipe(empId: string) {
    setLoading(true);

    const { data: membros } = await supabase
      .from('empresa_membros')
      .select('id, user_id, role, percentual_comissao, ativo, created_at, tipo_contrato, documento, data_admissao, contrato_arquivo_path, user:users(id, nome, telefone, email)')
      .eq('empresa_id', empId)
      .in('role', ['owner', 'gestor', 'profissional'])
      .order('ativo', { ascending: false })
      .order('created_at');

    const inicio = startOfMonth(new Date()).toISOString();
    const fim    = endOfMonth(new Date()).toISOString();

    const [{ data: ags }, { data: comsPend }] = await Promise.all([
      supabase.from('agendamentos')
        .select('profissional_id, valor')
        .eq('empresa_id', empId)
        .eq('status', 'concluido')
        .gte('data_hora_inicio', inicio)
        .lte('data_hora_inicio', fim),
      supabase.from('comissoes')
        .select('profissional_id, valor_comissao')
        .eq('empresa_id', empId)
        .eq('status', 'pendente'),
    ]);

    const stats: Record<string, { total: number; count: number }> = {};
    ((ags ?? []) as { profissional_id: string; valor: number }[]).forEach(a => {
      if (!stats[a.profissional_id]) stats[a.profissional_id] = { total: 0, count: 0 };
      stats[a.profissional_id].total += Number(a.valor);
      stats[a.profissional_id].count += 1;
    });

    const pendMap: Record<string, number> = {};
    ((comsPend ?? []) as { profissional_id: string; valor_comissao: number }[]).forEach(c => {
      pendMap[c.profissional_id] = (pendMap[c.profissional_id] ?? 0) + Number(c.valor_comissao);
    });

    setProfs(((membros ?? []) as any[]).map(m => ({
      ...m,
      total_mes:         stats[m.user_id]?.total ?? 0,
      atendimentos_mes:  stats[m.user_id]?.count ?? 0,
      comissao_pendente: pendMap[m.user_id]   ?? 0,
    })));
    setLoading(false);
  }

  async function toggleAtivo(prof: Profissional) {
    if (prof.ativo) {
      setConfirmDesativar(prof);
      return;
    }
    await supabase.from('empresa_membros').update({ ativo: true }).eq('id', prof.id);
    setProfs(prev => prev.map(p => p.id === prof.id ? { ...p, ativo: true } : p));
  }

  async function confirmarDesativar() {
    if (!confirmDesativar) return;
    await supabase.from('empresa_membros').update({ ativo: false }).eq('id', confirmDesativar.id);
    setProfs(prev => prev.map(p => p.id === confirmDesativar.id ? { ...p, ativo: false } : p));
    setConfirmDesativar(null);
  }

  async function alterarRole(prof: Profissional) {
    const novoRole = prof.role === 'gestor' ? 'profissional' : 'gestor';
    const { error } = await supabase.from('empresa_membros')
      .update({ role: novoRole })
      .eq('id', prof.id);
    if (error) { alert(error.message); return; }
    setProfs(prev => prev.map(p => p.id === prof.id ? { ...p, role: novoRole } : p));
  }

function salvarInfo(prof: Profissional, dados: {
    nome: string; telefone: string; email: string; comissao: number;
    tipoContrato: TipoContrato | ''; documento: string; dataAdmissao: string;
    contratoArquivoPath?: string;
  }) {
    setProfs(prev => prev.map(p =>
      p.id === prof.id ? {
        ...p,
        percentual_comissao: dados.comissao,
        user: { ...p.user, nome: dados.nome, telefone: dados.telefone || undefined, email: dados.email || undefined },
        tipo_contrato: dados.tipoContrato || null,
        documento: dados.documento || null,
        data_admissao: dados.dataAdmissao || null,
        contrato_arquivo_path: dados.contratoArquivoPath ?? p.contrato_arquivo_path,
      } : p
    ));
    setEditandoInfo(null);
  }

  async function pagarComissoes(profUserId: string) {
    if (!empresaId) return;
    setProfs(prev => prev.map(p => p.user_id === profUserId ? { ...p, comissao_pendente: 0 } : p));
    const { error } = await supabase.from('comissoes')
      .update({ status: 'pago' })
      .eq('empresa_id', empresaId)
      .eq('profissional_id', profUserId)
      .eq('status', 'pendente');
    if (error) await carregarEquipe(empresaId);
  }

  function onProfSalva(nova: Profissional, mensagem?: string) {
    setProfs(prev => {
      const existe = prev.find(p => p.id === nova.id);
      return existe ? prev.map(p => p.id === nova.id ? nova : p) : [...prev, nova];
    });
    setModal(false);
    if (mensagem) showToast(mensagem);
  }

  const ativos   = profs.filter(p => p.ativo).length;
  const inativos = profs.length - ativos;
  const profsExibidos = mostrarInativas ? profs : profs.filter(p => p.ativo);
  const mes      = format(new Date(), 'MMMM', { locale: ptBR });

  return (
    <div className="bm-page">
      {/* Toast de feedback */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none">
          <CheckCircle2 size={16} strokeWidth={2.5}/> {toast}
        </div>
      )}

      {/* Header Bellamore */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Gestão</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Equipe</h1>
        </div>
        <div className="flex gap-2 pt-1 bm-mobile-page-actions">
          <ExportButton
            variant="mobileHeader"
            className="bm-mobile-header-export"
            filename={`equipe-${format(new Date(), 'yyyy-MM')}`}
            title={`Equipe — ${mes}`}
            columns={[
              { header: 'Nome',           accessor: (p: Profissional) => p.user.nome,             width: 28 },
              { header: 'Telefone',       accessor: (p: Profissional) => p.user.telefone ?? '',    width: 18 },
              { header: 'Comissão (%)',   accessor: (p: Profissional) => `${p.percentual_comissao}%`, width: 14 },
              { header: 'Atend./mês',    accessor: (p: Profissional) => p.atendimentos_mes,       width: 14 },
              { header: 'Total/mês',     accessor: (p: Profissional) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(p.total_mes), width: 16 },
              { header: 'Status',         accessor: (p: Profissional) => p.ativo ? 'Ativo' : 'Inativo', width: 10 },
            ]}
            getData={() => profs}
          />
          <button onClick={() => setModal(true)} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
            style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)', fontFamily: 'var(--font-sans)' }}>
            <Plus size={15} strokeWidth={2.5}/> Nova profissional
          </button>
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          {[1,2,3].map(i => (
            <div key={i} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Sk className="w-10 h-10 rounded-2xl flex-shrink-0"/>
              <div className="flex flex-col gap-2"><Sk className="h-6 w-10"/><Sk className="h-3 w-16"/></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total',    value: profs.length, color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', clique: undefined },
            { label: 'Ativas',   value: ativos,       color: 'var(--color-green)',   bg: 'var(--color-green-soft)', clique: undefined },
            { label: 'Inativas', value: inativos,     color: 'var(--color-ink3)',    bg: 'var(--color-bg2)', clique: () => setMostrarInativas(v => !v) },
          ].map(({ label, value, color, bg, clique }, i) => {
            const Wrapper = clique ? 'button' : 'div';
            return (
              <Wrapper key={label} type={clique ? 'button' : undefined} onClick={clique}
                className="bm-stagger rounded-2xl p-4 flex items-center gap-3 text-left"
                style={{ background: 'var(--color-surface)', border: mostrarInativas && label === 'Inativas' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)', '--bm-i': i, '--bm-step': '55ms', cursor: clique ? 'pointer' : 'default' } as React.CSSProperties}>
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                  <UserCog size={18} style={{ color }} strokeWidth={1.8}/>
                </div>
                <div>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 700, lineHeight: 1, color }}>{value}</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 2 }}>{label}{clique && (mostrarInativas ? ' · ocultar' : ' · ver')}</p>
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-3 mb-4"><Sk className="w-12 h-12 rounded-xl flex-shrink-0"/><div className="flex-1 flex flex-col gap-2"><Sk className="h-4 w-28"/><Sk className="h-3 w-20"/></div></div>
              <div className="grid grid-cols-2 gap-2 mb-3"><Sk className="h-16 rounded-xl"/><Sk className="h-16 rounded-xl"/></div>
              <Sk className="h-11 rounded-xl"/>
            </div>
          ))}
        </div>
      ) : profs.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <UserCog size={32} style={{ margin: '0 auto 12px', color: 'var(--color-ink4)' }} strokeWidth={1.5}/>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-ink3)', marginBottom: 12 }}>Nenhuma profissional na equipe ainda.</p>
          <button onClick={() => setModal(true)} style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>
            + Adicionar primeira profissional
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: 'var(--color-ink4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }} className="capitalize">
              {mes} · {ativos} {ativos === 1 ? 'profissional ativa' : 'profissionais ativas'}
            </p>
            {inativos > 0 && (
              <button onClick={() => setMostrarInativas(v => !v)}
                style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-accent)' }}>
                {mostrarInativas ? 'Ocultar inativas' : `Ver inativas (${inativos})`}
              </button>
            )}
          </div>
          {profsExibidos.length === 0 ? (
            <div className="text-center py-16 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <UserCog size={32} style={{ margin: '0 auto 12px', color: 'var(--color-ink4)' }} strokeWidth={1.5}/>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-ink3)', marginBottom: 12 }}>Todas as profissionais estão inativas.</p>
              <button onClick={() => setMostrarInativas(true)} style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>
                Ver inativas ({inativos})
              </button>
            </div>
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {profsExibidos.map((p, i) => (
              <div key={p.id} className="bm-stagger"
                style={{ '--bm-i': i, '--bm-step': '60ms' } as React.CSSProperties}>
                <ProfCard
                  prof={p}
                  podeAlterarRole={meuRole === 'owner' && p.user_id !== meuUserId}
                  onEditInfo={() => setEditandoInfo(p)}
                  onToggle={() => toggleAtivo(p)}
                  onPagar={() => pagarComissoes(p.user_id)}
                  onAlterarRole={() => alterarRole(p)}
                  onVerDesempenho={() => setDesempenho(p)}
                />
              </div>
            ))}
          </div>
          )}
        </>
      )}

      {modal && empresaId && (
        <NovoProfModal empresaId={empresaId} meuRole={meuRole} onClose={() => setModal(false)} onSalvo={onProfSalva}/>
      )}

      {editandoInfo && empresaId && (
        <EditInfoModal
          prof={editandoInfo}
          empresaId={empresaId}
          onClose={() => setEditandoInfo(null)}
          onSalvo={dados => salvarInfo(editandoInfo, dados)}/>
      )}

      <ConfirmDialog
        open={!!confirmDesativar}
        title="Desativar profissional"
        message={`"${confirmDesativar?.user.nome}" não aparecerá em novos agendamentos. Esta ação pode ser desfeita reativando o perfil.`}
        confirmLabel="Desativar"
        variant="warning"
        onConfirm={confirmarDesativar}
        onCancel={() => setConfirmDesativar(null)}
      />

      {desempenho && empresaId && (
        <DesempenhoModal prof={desempenho} empresaId={empresaId} onClose={() => setDesempenho(null)}/>
      )}

    </div>
  );
}
