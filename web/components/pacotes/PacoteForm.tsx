'use client';

/**
 * @file PacoteForm.tsx
 * Cadastro do pacote (catálogo): tipo "Com sessões" ou "Combo", serviços com quantidade ou ∞
 * (ilimitado), preço e validade em dias livres ou "Sem validade" (editar um pacote sem validade
 * mantém sem validade: a tela sempre envia o valor explícito). A composição é sincronizada por
 * diferença com o erro conferido (`sincronizarServicosPacote`). Pacote já vendido tem a composição
 * travada; se a contagem de vendidos falhou, a composição também trava até recarregar.
 */
import { useRef, useState } from 'react';
import { X, Trash2, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { avancarComEnter } from '@/lib/formNav';
import { SearchSelect } from '@/components/SearchSelect';
import { validarPacote, MSG_VENDIDO_NAO_CONFERIDO } from '@shared/pacotes';
import { sincronizarServicosPacote } from '@shared/pacotes-consultas';
import { mensagemErroBanco } from '@shared/erros';
import { formatarMoeda as fmtBRL } from '@shared/moeda';
import type { PacoteCatalogo, ServicoDoPacote } from '@shared/pacotes-consultas';

const supabase = createClient();
const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

export function PacoteForm({
  pacote, jaVendido = false, vendidosIndisponivel = false, servicos, empresaId, onClose, onSalvo,
}: {
  pacote:    PacoteCatalogo | null;
  /** Pacote com venda registrada: tipo, serviços e quantidades travados (nome/preço/validade seguem editáveis). */
  jaVendido?: boolean;
  /** A contagem de vendidos falhou: nunca tratar como "não vendido" — a composição trava até recarregar. */
  vendidosIndisponivel?: boolean;
  servicos:  { id: string; nome: string; preco: number }[];
  empresaId: string;
  onClose:   () => void;
  onSalvo:   () => void;
}) {
  useScrollLock();
  const travadoPorVenda = !!pacote && jaVendido;
  const servicosTravados = !!pacote && (jaVendido || vendidosIndisponivel);
  const [nome,            setNome]            = useState(pacote?.nome ?? '');
  const [preco,           setPreco]           = useState(pacote ? pacote.preco.toFixed(2).replace('.', ',') : '');
  const [semValidade,     setSemValidade]     = useState(pacote ? pacote.validade_dias == null : false);
  const [validade,        setValidade]        = useState(pacote?.validade_dias != null ? String(pacote.validade_dias) : pacote ? '' : '90');
  const [controlaSessoes, setControlaSessoes] = useState(pacote?.controla_sessoes ?? true);
  const [itensList,       setItensList]       = useState<ServicoDoPacote[]>(pacote?.servicos ?? []);
  const [addServId,       setAddServId]       = useState('');
  const [addindoServico,  setAddindoServico]  = useState(false);
  const [salvando,        setSalvando]        = useState(false);
  const [erro,            setErro]            = useState('');
  // Pacote novo já criado numa tentativa que falhou na composição: a nova tentativa atualiza, não cria outro.
  const criadoRef = useRef<string | null>(null);
  // Serviços gravados no banco (base da diferença); atualizado a cada sincronização que deu certo.
  const gravadosRef = useRef<string[]>(pacote ? pacote.servicos.map(s => s.servico_id) : []);

  function adicionarServico(id: string) {
    if (!id || itensList.find(i => i.servico_id === id)) return;
    const s = servicos.find(x => x.id === id);
    if (!s) return;
    setItensList(prev => [...prev, { servico_id: id, nome: s.nome, quantidade: 1 }]);
    setAddServId('');
  }
  const atualizarQtd = (id: string, qtd: number) =>
    setItensList(prev => prev.map(i => i.servico_id === id ? { ...i, quantidade: Math.max(1, qtd) } : i));
  const toggleIlimitado = (id: string) =>
    setItensList(prev => prev.map(i => i.servico_id === id ? { ...i, quantidade: i.quantidade == null ? 1 : null } : i));
  const removerItem = (id: string) => setItensList(prev => prev.filter(i => i.servico_id !== id));

  async function salvar(e?: React.FormEvent) {
    e?.preventDefault();
    if (salvando) return;
    setErro('');
    const v = validarPacote({ nome, precoTxt: preco, validadeTxt: validade, semValidade, qtdServicos: itensList.length, composicaoTravada: servicosTravados });
    if (v.erro !== null) { setErro(v.erro); return; }
    const precoN = v.preco;
    const validadeN = v.validadeDias;

    setSalvando(true);
    try {
      const existenteId = pacote?.id ?? criadoRef.current;
      let pacoteId: string;
      if (existenteId) {
        const campos = servicosTravados
          ? { nome: nome.trim(), preco: precoN, validade_dias: validadeN }
          : { nome: nome.trim(), preco: precoN, validade_dias: validadeN, controla_sessoes: controlaSessoes };
        const { data: salvos, error: e1 } = await supabase.from('pacotes').update(campos)
          .eq('id', existenteId).eq('empresa_id', empresaId).select('id');
        if (e1) { setErro(mensagemErroBanco(e1, 'salvar o pacote')); return; }
        if (!salvos || salvos.length === 0) { setErro('Você não tem permissão para alterar pacotes.'); return; }
        pacoteId = existenteId;
        if (servicosTravados) { onSalvo(); return; }
      } else {
        const { data: novo, error: e1 } = await supabase.from('pacotes').insert({
          empresa_id: empresaId, nome: nome.trim(), preco: precoN, validade_dias: validadeN, controla_sessoes: controlaSessoes,
        }).select('id').single();
        if (e1 || !novo) { setErro(mensagemErroBanco(e1 ?? { code: '42501' }, 'criar o pacote')); return; }
        pacoteId = novo.id;
        criadoRef.current = novo.id;
      }

      // Combo não tem sessão ilimitada: força quantidade concreta.
      const itensSalvar = itensList.map(i => ({ servico_id: i.servico_id, quantidade: controlaSessoes ? i.quantidade : (i.quantidade ?? 1) }));
      const falha = await sincronizarServicosPacote(supabase, pacoteId, gravadosRef.current, itensSalvar);
      if (falha) { setErro(falha); return; }
      gravadosRef.current = itensSalvar.map(i => i.servico_id);
      onSalvo();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className={`relative bg-surface rounded-2xl shadow-xl w-full flex flex-col transition-all duration-200 ${addindoServico ? 'max-w-lg max-h-[94dvh]' : 'max-w-md max-h-[90dvh]'}`}>
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">{pacote ? 'Editar pacote' : 'Novo pacote'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>

        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          <div>
            <label className={labelCls}>Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} required placeholder="Ex: Pacote Escova Mensal" className={inputCls}/>
          </div>

          {servicosTravados && (
            <div className="flex items-center gap-2 bg-amber-soft rounded-xl px-3 py-2 border border-amber/20">
              <AlertCircle size={14} className="text-amber flex-shrink-0"/>
              <p className="text-xs text-amber">
                {travadoPorVenda
                  ? 'Pacote já vendido — o tipo, os serviços e as quantidades não podem ser alterados.'
                  : MSG_VENDIDO_NAO_CONFERIDO}
              </p>
            </div>
          )}

          <div>
            <label className={labelCls}>Tipo de pacote</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={servicosTravados} onClick={() => setControlaSessoes(true)}
                className={`h-10 rounded-xl text-xs font-semibold border transition disabled:opacity-50 disabled:cursor-not-allowed ${controlaSessoes ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-text-3 hover:border-accent'}`}>
                Com sessões
              </button>
              <button type="button" disabled={servicosTravados} onClick={() => setControlaSessoes(false)}
                className={`h-10 rounded-xl text-xs font-semibold border transition disabled:opacity-50 disabled:cursor-not-allowed ${!controlaSessoes ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-text-3 hover:border-accent'}`}>
                Combo
              </button>
            </div>
            <p className="text-[11px] text-text-4 mt-1">
              {controlaSessoes
                ? 'Rastreia sessões restantes por atendimento (ex: 10 sessões de manicure)'
                : 'Só agrupa serviços para um mesmo atendimento, sem controle de sessões (ex: spa dos lábios + design + buço)'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Preço *</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input value={preco} onChange={e => setPreco(e.target.value)} inputMode="decimal" placeholder="0,00" required className={`${inputCls} pl-9`}/>
              </div>
            </div>
            <div>
              <label className={labelCls}>Validade (dias)</label>
              <input value={semValidade ? '' : validade} onChange={e => setValidade(e.target.value.replace(/\D/g, ''))}
                disabled={semValidade} inputMode="numeric" placeholder={semValidade ? 'Sem validade' : 'Ex: 90'}
                className={`${inputCls} disabled:opacity-50`}/>
              <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-3 cursor-pointer">
                <input type="checkbox" checked={semValidade} onChange={e => setSemValidade(e.target.checked)} className="accent-primary"/>
                Sem validade
              </label>
            </div>
          </div>

          <div>
            <label className={labelCls}>Serviços incluídos</label>
            <div className={`flex flex-col gap-2 mb-2 overflow-y-auto pr-0.5 transition-all duration-200 ${addindoServico ? 'max-h-64' : 'max-h-48'}`}>
              {itensList.map(item => (
                <div key={item.servico_id} className="flex flex-col gap-2 bg-bg rounded-xl px-3 py-2 sm:flex-row sm:items-center">
                  <span className="text-sm text-text break-words sm:flex-1 sm:truncate">{item.nome}</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end sm:flex-shrink-0">
                    {controlaSessoes && item.quantidade == null ? (
                      <span className="text-xs font-semibold text-primary">Ilimitado</span>
                    ) : servicosTravados ? (
                      <span className="text-sm font-semibold text-text">{item.quantidade ?? 1} <span className="text-xs font-normal text-text-4">{controlaSessoes ? 'sessões' : '×'}</span></span>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => atualizarQtd(item.servico_id, (item.quantidade ?? 1) - 1)}
                            className="w-6 h-6 rounded-lg bg-surface border border-border text-text-2 text-xs flex items-center justify-center hover:bg-border transition">−</button>
                          <span className="w-8 text-center text-sm font-semibold text-text">{item.quantidade ?? 1}</span>
                          <button type="button" onClick={() => atualizarQtd(item.servico_id, (item.quantidade ?? 1) + 1)}
                            className="w-6 h-6 rounded-lg bg-surface border border-border text-text-2 text-xs flex items-center justify-center hover:bg-border transition">+</button>
                        </div>
                        <span className="text-xs text-text-4">{controlaSessoes ? 'sessões' : '×'}</span>
                      </>
                    )}
                    {controlaSessoes && !servicosTravados && (
                      <button type="button" onClick={() => toggleIlimitado(item.servico_id)}
                        title={item.quantidade == null ? 'Definir quantidade' : 'Tornar ilimitado'}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${item.quantidade == null ? 'text-primary bg-primary-soft' : 'text-text-4 hover:text-primary hover:bg-primary-soft'}`}>
                        ∞
                      </button>
                    )}
                    {!servicosTravados && (
                      <button type="button" onClick={() => removerItem(item.servico_id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition">
                        <Trash2 size={12}/>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!servicosTravados && (
              <SearchSelect
                options={servicos
                  .filter(s => !itensList.find(i => i.servico_id === s.id))
                  .map(s => ({ value: s.id, label: s.nome, sub: fmtBRL(s.preco) }))}
                value={addServId}
                onChange={id => { setAddServId(id); adicionarServico(id); }}
                onOpenChange={setAddindoServico}
                placeholder="+ Adicionar serviço..."
              />
            )}
          </div>

          {erro && (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2 border border-red/20">
              <AlertCircle size={14} className="text-red flex-shrink-0"/>
              <p className="text-sm text-red">{erro}</p>
            </div>
          )}
        </form>

        <div className="p-5 border-t border-border flex-shrink-0 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
          <button type="button" onClick={() => salvar()} disabled={salvando}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
            {salvando ? 'Salvando...' : pacote ? 'Salvar' : 'Criar pacote'}
          </button>
        </div>
      </div>
    </div>
  );
}
