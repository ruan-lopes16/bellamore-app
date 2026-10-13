'use client';
/**
 * Configurações → Cartões: maquininhas (tabela padrão de taxas + exceções por bandeira) e bandeiras.
 * Edição exige a permissão `config.taxas`; sem ela, ou antes da migration 086 (`legado`), é só leitura.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, CreditCard, Loader2, Pencil, Plus, Star, Trash2, Undo2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { usePermissoes } from '@/components/PermissoesProvider';
import { mensagemErroBanco } from '@shared/erros';
import {
  MAX_PARCELAS, bandeirasAtivas, bandeirasComExcecao, campoParaTaxa, chaveBandeira, descartarExcecoesRedundantes,
  gradeParaTaxas, maquininhaPadrao, maquininhasAtivas, mascararPercentual, taxasParaGrade, validarTabela,
  type ConfigCartoes, type GradeTaxas, type Maquininha, type TaxaLinha,
} from '@shared/taxas-cartao';
import { carregarConfigCartoes, definirPadrao, salvarBandeira, salvarMaquininha } from '@shared/taxas-cartao-consultas';

const supabase = createClient();
const inputCls = 'w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition disabled:opacity-60';
const labelCls = 'block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5';
const btnSec = 'h-9 px-3 rounded-xl border border-border text-xs font-semibold text-text-2 hover:bg-bg transition disabled:opacity-50 inline-flex items-center gap-1.5';

type Editor = {
  id?: string; nome: string; max: string; ativa: boolean; padrao: boolean; ordem: number;
  originais: TaxaLinha[]; padraoGrade: GradeTaxas; excecoes: Record<string, GradeTaxas>;
};

function msgErro(e: unknown, acao: string): string {
  return e instanceof Error && e.message ? e.message : mensagemErroBanco(e as Parameters<typeof mensagemErroBanco>[0], acao);
}

/** Campo de percentual com sufixo "%". */
function CampoTaxa({ rotulo, valor, onChange, desabilitado, placeholder }: {
  rotulo: string; valor: string; onChange: (v: string) => void; desabilitado: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-text-3 mb-1">{rotulo}</label>
      <div className="relative">
        <input value={valor} onChange={e => onChange(mascararPercentual(e.target.value))} inputMode="decimal"
          placeholder={placeholder ?? '0,00'} disabled={desabilitado} className={`${inputCls} pr-8`}/>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 text-xs font-bold">%</span>
      </div>
    </div>
  );
}

function GradeEditor({ grade, max, onChange, desabilitado, vazioOk }: {
  grade: GradeTaxas; max: number; onChange: (g: GradeTaxas) => void; desabilitado: boolean; vazioOk?: boolean;
}) {
  const ph = vazioOk ? 'usa a padrão' : '0,00';
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <CampoTaxa rotulo="Débito" valor={grade.debito} desabilitado={desabilitado} placeholder={ph}
        onChange={v => onChange({ ...grade, debito: v })}/>
      {Array.from({ length: max }, (_, i) => (
        <CampoTaxa key={i} rotulo={`Crédito ${i + 1}x`} valor={grade.credito[i] ?? ''} desabilitado={desabilitado} placeholder={ph}
          onChange={v => {
            const credito = Array.from({ length: max }, (_, j) => grade.credito[j] ?? '');
            credito[i] = v;
            onChange({ ...grade, credito });
          }}/>
      ))}
    </div>
  );
}

export function CartoesConfig({ empresaId }: { empresaId: string }) {
  const { pode } = usePermissoes();
  const podeEditar = pode('config.taxas');
  const [config, setConfig] = useState<ConfigCartoes | null>(null);
  const [erroCarga, setErroCarga] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [erroEditor, setErroEditor] = useState('');
  const [removidasAbertas, setRemovidasAbertas] = useState(false);
  const [novaBandeira, setNovaBandeira] = useState('');
  const [nomesBandeira, setNomesBandeira] = useState<Record<string, string>>({});
  const [excecaoNova, setExcecaoNova] = useState('');
  const inicialRef = useRef('');
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const ocupadoRef = useRef(false);
  ocupadoRef.current = ocupado;

  /** Fecha o editor; com alterações não salvas pede confirmação. */
  const fecharEditor = useCallback(() => {
    if (ocupadoRef.current) return;
    const ed = editorRef.current;
    if (ed && JSON.stringify(ed) !== inicialRef.current && !window.confirm('Descartar alterações?')) return;
    setEditor(null);
  }, []);

  useEffect(() => {
    if (!editor) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharEditor(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editor === null, fecharEditor]); // eslint-disable-line react-hooks/exhaustive-deps

  const recarregar = useCallback(async (): Promise<ConfigCartoes | null> => {
    try {
      const c = await carregarConfigCartoes(supabase, empresaId);
      setConfig(c); setErroCarga('');
      setNomesBandeira({});
      return c;
    } catch (e) {
      setErroCarga(msgErro(e, 'carregar as configurações de cartão'));
      return null;
    }
  }, [empresaId]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  if (!config) {
    return erroCarga
      ? <p className="text-sm text-red">{erroCarga}</p>
      : <div className="flex flex-col gap-3"><Sk className="h-24 rounded-2xl"/><Sk className="h-40 rounded-2xl"/></div>;
  }

  const cfg: ConfigCartoes = config;
  const somenteLeitura = cfg.legado || !podeEditar;
  const ativas = maquininhasAtivas(cfg);
  const removidas = cfg.maquininhas.filter(m => !m.ativa);
  const padrao = maquininhaPadrao(cfg);
  const bandeiras = [...cfg.bandeiras].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
  const chavesTodas = cfg.bandeiras.map(b => b.chave);

  /** Executa uma gravação: em erro mostra a mensagem; sempre recarrega a configuração. */
  async function executar(acao: string, fn: () => Promise<void>): Promise<boolean> {
    setOcupado(true); setErro('');
    try { await fn(); await recarregar(); return true; }
    catch (e) { setErro(msgErro(e, acao)); await recarregar(); return false; }
    finally { setOcupado(false); }
  }

  function abrir(ed: Editor) { inicialRef.current = JSON.stringify(ed); setEditor(ed); }

  function abrirNova() {
    const base = padrao;
    const max = base?.maxParcelas ?? 12;
    setErroEditor(''); setExcecaoNova('');
    abrir({
      nome: '', max: String(max), ativa: true, padrao: false,
      ordem: Math.max(0, ...cfg.maquininhas.map(m => m.ordem)) + 1,
      originais: [],
      padraoGrade: base ? taxasParaGrade(base.taxas, null, max) : { debito: '', credito: Array(max).fill('') },
      excecoes: {},
    });
  }

  function abrirEdicao(m: Maquininha) {
    setErroEditor(''); setExcecaoNova('');
    const excecoes: Record<string, GradeTaxas> = {};
    for (const bid of bandeirasComExcecao(m.taxas)) excecoes[bid] = taxasParaGrade(m.taxas, bid, m.maxParcelas);
    abrir({
      id: m.id, nome: m.nome, max: String(m.maxParcelas), ativa: m.ativa, padrao: m.padrao, ordem: m.ordem,
      originais: m.taxas, padraoGrade: taxasParaGrade(m.taxas, null, m.maxParcelas), excecoes,
    });
  }

  async function salvarEditor() {
    if (!editor) return;
    const nome = editor.nome.trim();
    if (!nome) { setErroEditor('Informe o nome da maquininha'); return; }
    const max = Number(editor.max);
    if (!Number.isInteger(max) || max < 1 || max > MAX_PARCELAS) {
      setErroEditor(`O máximo de parcelas precisa ficar entre 1 e ${MAX_PARCELAS}`); return;
    }
    const linhasPadrao = gradeParaTaxas(editor.padraoGrade, null, max, true);
    if (!linhasPadrao) { setErroEditor('Preencha todas as taxas da tabela padrão (entre 0% e 20%)'); return; }
    const linhas: TaxaLinha[] = [...linhasPadrao];
    for (const [bid, g] of Object.entries(editor.excecoes)) {
      const campos = [g.debito, ...g.credito.slice(0, max)].filter(c => c.trim() !== '');
      if (campos.some(c => campoParaTaxa(c) === null)) { setErroEditor('As taxas das exceções precisam ficar entre 0% e 20%'); return; }
      linhas.push(...(gradeParaTaxas(g, bid, max, false) ?? []));
    }
    const taxas = descartarExcecoesRedundantes(linhas);
    const invalida = validarTabela({ maxParcelas: max, taxas });
    if (invalida) { setErroEditor(invalida); return; }
    setOcupado(true); setErroEditor('');
    try {
      await salvarMaquininha(supabase, empresaId, {
        id: editor.id, nome, maxParcelas: max, ativa: editor.ativa, padrao: editor.padrao, ordem: editor.ordem, taxas,
      }, editor.originais);
      setEditor(null);
      await recarregar();
    } catch (e) {
      setErroEditor(msgErro(e, 'salvar a maquininha'));
      const criada = (e as { maquininhaId?: string }).maquininhaId;
      const idAtual = editor.id ?? criada;
      const c = await recarregar();
      const atual = c?.maquininhas.find(m => m.id === idAtual);
      setEditor(ed => (ed ? { ...ed, id: idAtual, originais: atual ? atual.taxas : ed.originais } : ed));
    } finally { setOcupado(false); }
  }

  function remover(m: Maquininha) {
    if (m.padrao) { setErro('Escolha outra maquininha padrão antes de remover esta'); return; }
    if (ativas.length <= 1) { setErro('Mantenha ao menos uma maquininha ativa'); return; }
    if (!window.confirm(`Remover a maquininha "${m.nome}"? Pagamentos já registrados continuam como estão e você pode restaurá-la depois.`)) return;
    void executar('remover a maquininha', async () => {
      await salvarMaquininha(supabase, empresaId, { ...m, ativa: false }, m.taxas);
    });
  }

  function restaurar(m: Maquininha) {
    void executar('restaurar a maquininha', async () => {
      await salvarMaquininha(supabase, empresaId, { ...m, ativa: true }, m.taxas);
    });
  }

  function tornarPadrao(m: Maquininha) {
    void executar('definir a maquininha padrão', () => definirPadrao(supabase, empresaId, m.id));
  }

  /** Nome igual (ignorando maiúsculas/acentos) a uma bandeira ativa diferente de `ignorarId`. */
  function nomeRepetido(nome: string, ignorarId?: string): boolean {
    const k = chaveBandeira(nome, []);
    return bandeirasAtivas(cfg).some(b => b.id !== ignorarId && chaveBandeira(b.nome, []) === k);
  }

  function adicionarBandeira() {
    const nome = novaBandeira.trim();
    if (!nome) { setErro('Informe o nome da bandeira'); return; }
    if (nomeRepetido(nome)) { setErro('Já existe uma bandeira ativa com esse nome'); return; }
    void executar('salvar a bandeira', async () => {
      await salvarBandeira(supabase, empresaId, { nome, ativa: true, ordem: Math.max(0, ...cfg.bandeiras.map(b => b.ordem)) + 1 }, chavesTodas);
      setNovaBandeira('');
    });
  }

  function renomearBandeira(id: string) {
    const b = cfg.bandeiras.find(x => x.id === id);
    const rascunho = nomesBandeira[id];
    if (!b || rascunho === undefined) return;
    const nome = rascunho.trim();
    if (nome === b.nome) { setNomesBandeira(s => { const { [id]: _, ...r } = s; return r; }); return; }
    if (!nome) { setErro('Informe o nome da bandeira'); void recarregar(); return; }
    if (b.ativa && nomeRepetido(nome, id)) { setErro('Já existe uma bandeira ativa com esse nome'); void recarregar(); return; }
    void executar('salvar a bandeira', () => salvarBandeira(supabase, empresaId, { id, nome, ativa: b.ativa }, chavesTodas));
  }

  function alternarBandeira(id: string) {
    const b = cfg.bandeiras.find(x => x.id === id);
    if (!b) return;
    if (!b.ativa && nomeRepetido(b.nome, id)) { setErro('Já existe uma bandeira ativa com esse nome'); return; }
    void executar('salvar a bandeira', () => salvarBandeira(supabase, empresaId, { id, nome: b.nome, ativa: !b.ativa }, chavesTodas));
  }

  const maxEditor = editor ? Math.min(MAX_PARCELAS, Math.max(1, Number(editor.max) || 1)) : 1;
  const bandeirasSemExcecao = editor ? bandeirasAtivas(cfg).filter(b => !editor.excecoes[b.id]) : [];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-text-3 -mt-1">
        Cadastre suas maquininhas, as bandeiras aceitas e a taxa de cada parcela. Valem para os próximos pagamentos; os já registrados mantêm a taxa de quando foram feitos.
      </p>
      {cfg.legado && <p className="text-xs font-semibold text-text-3">Disponível após a atualização do sistema</p>}
      {!cfg.legado && !podeEditar && <p className="text-xs font-semibold text-text-3">Você pode consultar, mas não editar as taxas.</p>}
      {erro && <p className="text-sm text-red" role="alert">{erro}</p>}

      {/* Maquininhas */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-text">Maquininhas</h3>
          {!somenteLeitura && (
            <button type="button" onClick={abrirNova} disabled={ocupado} className={btnSec}><Plus size={14}/> Adicionar maquininha</button>
          )}
        </div>
        {ativas.map(m => (
          <div key={m.id} className="rounded-2xl border border-border p-3.5 flex items-center gap-3 flex-wrap">
            <CreditCard size={16} className="text-text-3 flex-shrink-0"/>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text truncate">{m.nome}</p>
              <p className="text-xs text-text-3">até {m.maxParcelas}x</p>
            </div>
            {m.padrao && <span className="px-2 h-6 rounded-full bg-primary-soft text-primary text-[11px] font-bold inline-flex items-center gap-1"><Star size={11}/> Padrão</span>}
            {!somenteLeitura && (
              <div className="flex items-center gap-2">
                {!m.padrao && <button type="button" onClick={() => tornarPadrao(m)} disabled={ocupado} className={btnSec}>Tornar padrão</button>}
                <button type="button" onClick={() => abrirEdicao(m)} disabled={ocupado} className={btnSec}><Pencil size={13}/> Editar</button>
                <button type="button" onClick={() => remover(m)} disabled={ocupado} aria-label={`Remover ${m.nome}`}
                  className="w-9 h-9 rounded-xl border border-border text-text-4 hover:text-red flex items-center justify-center disabled:opacity-50"><Trash2 size={14}/></button>
              </div>
            )}
          </div>
        ))}
        {removidas.length > 0 && (
          <div>
            <button type="button" onClick={() => setRemovidasAbertas(v => !v)}
              className="text-xs font-semibold text-text-3 inline-flex items-center gap-1">
              {removidasAbertas ? <ChevronDown size={14}/> : <ChevronRight size={14}/>} Removidas ({removidas.length})
            </button>
            {removidasAbertas && (
              <div className="flex flex-col gap-2 mt-2">
                {removidas.map(m => (
                  <div key={m.id} className="rounded-2xl border border-dashed border-border p-3 flex items-center gap-3 opacity-80">
                    <p className="flex-1 text-sm text-text-2 truncate">{m.nome}</p>
                    {!somenteLeitura && (
                      <button type="button" onClick={() => restaurar(m)} disabled={ocupado} className={btnSec}><Undo2 size={13}/> Restaurar</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bandeiras */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-text">Bandeiras</h3>
        {bandeiras.map(b => (
          <div key={b.id} className={`flex items-center gap-2 ${b.ativa ? '' : 'opacity-60'}`}>
            <input value={nomesBandeira[b.id] ?? b.nome} disabled={somenteLeitura || ocupado} className={inputCls}
              onChange={e => setNomesBandeira(s => ({ ...s, [b.id]: e.target.value }))}
              onBlur={() => renomearBandeira(b.id)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}/>
            {!somenteLeitura && (
              <button type="button" onClick={() => alternarBandeira(b.id)} disabled={ocupado} className={`${btnSec} flex-shrink-0`}>
                {b.ativa ? 'Desativar' : 'Ativar'}
              </button>
            )}
          </div>
        ))}
        {!somenteLeitura && (
          <div className="flex items-center gap-2">
            <input value={novaBandeira} onChange={e => setNovaBandeira(e.target.value)} placeholder="Nome da nova bandeira"
              disabled={ocupado} className={inputCls}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarBandeira(); } }}/>
            <button type="button" onClick={adicionarBandeira} disabled={ocupado} className={`${btnSec} flex-shrink-0`}><Plus size={14}/> Adicionar bandeira</button>
          </div>
        )}
      </div>

      {/* Editor de maquininha */}
      {editor && createPortal(
        <div onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault(); }}
          className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={fecharEditor}/>
          <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
              <h2 className="font-serif text-xl text-text">{editor.id ? 'Editar maquininha' : 'Nova maquininha'}</h2>
              <button type="button" onClick={fecharEditor} aria-label="Fechar" className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3"><X size={16}/></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
                <div>
                  <label className={labelCls}>Nome *</label>
                  <input value={editor.nome} onChange={e => setEditor({ ...editor, nome: e.target.value })} placeholder="Ex: InfinitePay" className={inputCls}/>
                </div>
                <div>
                  <label className={labelCls}>Máx. de parcelas</label>
                  <input value={editor.max} inputMode="numeric" className={inputCls}
                    onChange={e => setEditor({ ...editor, max: e.target.value.replace(/\D/g, '').slice(0, 2) })}/>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-bold text-text">Tabela padrão</h4>
                <GradeEditor grade={editor.padraoGrade} max={maxEditor} desabilitado={ocupado}
                  onChange={g => setEditor({ ...editor, padraoGrade: g })}/>
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-bold text-text">Exceções por bandeira</h4>
                <p className="text-xs text-text-3 -mt-1">Preencha só o que muda; o que ficar vazio usa a tabela padrão.</p>
                {Object.entries(editor.excecoes).map(([bid, g]) => {
                  const b = cfg.bandeiras.find(x => x.id === bid);
                  return (
                    <div key={bid} className="rounded-xl border border-border p-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-text">{b?.nome ?? 'Bandeira'}</span>
                        <button type="button" disabled={ocupado} className={btnSec}
                          onClick={() => { const { [bid]: _, ...resto } = editor.excecoes; setEditor({ ...editor, excecoes: resto }); }}>
                          <Trash2 size={13}/> Remover exceção
                        </button>
                      </div>
                      <GradeEditor grade={g} max={maxEditor} desabilitado={ocupado} vazioOk
                        onChange={ng => setEditor({ ...editor, excecoes: { ...editor.excecoes, [bid]: ng } })}/>
                    </div>
                  );
                })}
                {bandeirasSemExcecao.length > 0 && (
                  <div className="flex items-center gap-2">
                    <select value={excecaoNova} onChange={e => setExcecaoNova(e.target.value)} className={`${inputCls} cursor-pointer`}>
                      <option value="">Escolha uma bandeira…</option>
                      {bandeirasSemExcecao.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                    </select>
                    <button type="button" disabled={!excecaoNova || ocupado} className={`${btnSec} flex-shrink-0`}
                      onClick={() => {
                        setEditor({ ...editor, excecoes: { ...editor.excecoes, [excecaoNova]: {
                          debito: editor.padraoGrade.debito,
                          credito: Array.from({ length: maxEditor }, (_, i) => editor.padraoGrade.credito[i] ?? ''),
                        } } });
                        setExcecaoNova('');
                      }}>
                      <Plus size={14}/> Adicionar exceção
                    </button>
                  </div>
                )}
              </div>
              {erroEditor && <p className="text-sm text-red" role="alert">{erroEditor}</p>}
            </div>
            <div className="p-5 border-t border-border flex justify-end gap-2 flex-shrink-0">
              <button type="button" onClick={fecharEditor} disabled={ocupado} className={btnSec}>Cancelar</button>
              <button type="button" onClick={salvarEditor} disabled={ocupado}
                className="h-9 px-4 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">
                {ocupado && <Loader2 size={14} className="animate-spin"/>} Salvar
              </button>
            </div>
          </div>
        </div>,
        document.body)}
    </div>
  );
}
