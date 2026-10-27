'use client';

/**
 * @file VenderPacoteModal.tsx
 * Venda de pacote única do web (Pacotes e, na Task 7, Agenda): cliente, quantidade, valor, desconto
 * %/R$ e a cobrança — "Cobrar agora" (bloco de pagamento da Venda avulsa) ou "Cobrar na comanda"
 * (pacote "a cobrar", cobrado ao fechar a comanda). Grava por `venderPacote` (função `vender_pacote`,
 * 096) com a chave `vendaId` gerada uma vez por abertura do modal e reaproveitada na nova tentativa
 * (a função não duplica). Sem a 096: "Cobrar na comanda" fica escondido e "Cobrar agora" usa o caminho
 * antigo, gravando também a venda (`venderPacoteSem096`). Contrato: docs/superpowers/notes/2026-10-23-contrato-pacotes.md.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertCircle, Clock, Tag, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { usePermissoes } from '@/components/PermissoesProvider';
import { SearchSelect } from '@/components/SearchSelect';
import { BlocoPagamento, splitsNumericos, type SplitTela } from '@/components/pacotes/BlocoPagamento';
import {
  venderPacote, ErroPacote, SemMigration096, assinaturaVendaPacote, chaveVendaPacote, motivoBloqueioVendaPacote,
  vendaPacoteFoiGravada, venderPacoteSem096, MSG_ALTERADA_SEM_RESPOSTA, MSG_VENDA_JA_GRAVADA, MSG_COMANDA_INDISPONIVEL,
  TEXTO_COBRANCA, type TentativaVendaPacote,
} from '@shared/pacotes-venda';
import { tem096 as detectar096 } from '@shared/pacotes-consultas';
import { calcularDesconto, montarPagamentos, parseValorBR, resumoComanda, type ModoDesconto } from '@shared/comanda-fechamento';
import { carregarConfigCartoes } from '@shared/taxas-cartao-consultas';
import { configIndisponivel, AVISO_CARTOES_SEM_TAXA, type ConfigCartoes } from '@shared/taxas-cartao';
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
import { mensagemErroBanco } from '@shared/erros';
import { dataValidade, subtotalVendaPacote } from '@shared/pacotes';
import { hojeBRT } from '@shared/periodos';
import { novoUuid } from '@shared/uuid';
import { formatarMoeda as fmtBRL } from '@shared/moeda';

const supabase = createClient();

const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

/** Pacote do catálogo que pode ser vendido (o mínimo de `PacoteCatalogo`). */
export type PacoteParaVenda = { id: string; nome: string; preco: number; validade_dias: number | null; ativo?: boolean };

/** O que a venda gravou, para a tela que abriu o modal. */
export type ResultadoVendaPacote = {
  cobranca: 'agora' | 'comanda';
  vendaId: string;
  clienteId: string;
  pacoteId: string;
  quantidade: number;
  /**
   * Id do 1º pacote vendido (com a 096 é a própria `vendaId`): a Agenda vincula o atendimento a ele.
   * `null` no caminho antigo (sem a 096), em que o id não é lido de volta.
   */
  pacoteClienteId: string | null;
  /** Gravou, mas algo ficou para conferir (caminho antigo: pagamento não registrado). */
  aviso: string | null;
};

export type VenderPacoteModalProps = {
  empresaId: string;
  /** Pacotes que podem ser vendidos. Com mais de um, o modal mostra o seletor. */
  pacotes: PacoteParaVenda[];
  pacoteInicialId?: string;
  /** Cobrança marcada ao abrir: "agora" em Pacotes, "comanda" na Agenda (o atendimento ainda vai acontecer). */
  padraoCobranca: 'agora' | 'comanda';
  /** Cliente pré-selecionada (ex.: a do agendamento). */
  clienteInicial?: { id: string; nome: string } | null;
  /** Não deixa trocar a cliente (e não carrega a lista). Exige `clienteInicial`. */
  travarCliente?: boolean;
  /** A 096 está no banco? Omitido → o modal sonda ao abrir. `null` = não deu para saber. */
  tem096?: boolean | null;
  onClose: () => void;
  /** Chamado depois da tela de sucesso. */
  onVendido: (r: ResultadoVendaPacote) => void;
};

type Cliente = { id: string; nome: string };

export function VenderPacoteModal({
  empresaId, pacotes, pacoteInicialId, padraoCobranca, clienteInicial = null, travarCliente = false,
  tem096: tem096Prop, onClose, onVendido,
}: VenderPacoteModalProps) {
  useScrollLock();
  const { pode } = usePermissoes();
  const podeDesconto = pode('comanda.desconto');

  // Chave da venda: uma por abertura do modal; a nova tentativa da MESMA venda reaproveita.
  const [chaveAbertura] = useState(() => novoUuid());
  const [tentativa, setTentativa] = useState<TentativaVendaPacote | null>(null);
  const gravandoRef = useRef(false);
  // Refs: a tela que abriu pode recriar estes objetos a cada render sem refazer cargas nem o timer.
  const clienteInicialRef = useRef(clienteInicial);
  const onVendidoRef = useRef(onVendido);
  onVendidoRef.current = onVendido;

  const [tem096, setTem096] = useState<boolean | null | undefined>(tem096Prop);
  const [cobranca, setCobranca] = useState<'agora' | 'comanda'>(tem096Prop === false ? 'agora' : padraoCobranca);
  const [pacoteId, setPacoteId] = useState(pacoteInicialId ?? (pacotes.length === 1 ? pacotes[0].id : ''));
  const pacote = pacotes.find(p => p.id === pacoteId) ?? null;
  const [clienteId, setClienteId] = useState(clienteInicial?.id ?? '');
  const [clientes, setClientes] = useState<Cliente[]>(clienteInicial ? [clienteInicial] : []);
  const [erroClientes, setErroClientes] = useState<string | null>(null);
  const [quantidadeTxt, setQuantidadeTxt] = useState('1');
  const [valorTxt, setValorTxt] = useState(pacote ? pacote.preco.toFixed(2).replace('.', ',') : '');
  const [descontoEntrada, setDescontoEntrada] = useState('');
  const [descontoModo, setDescontoModo] = useState<ModoDesconto>('percentual');
  const [splits, setSplits] = useState<SplitTela[]>([]);
  const [config, setConfig] = useState<ConfigCartoes>(() => configIndisponivel());
  const [configPronta, setConfigPronta] = useState(false);
  const [erroConfig, setErroConfig] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState<(ResultadoVendaPacote & { clienteNome: string; pacoteNome: string; validade: string | null; jaGravada: boolean }) | null>(null);

  // 096: sonda só se a tela não informou. Sem ela, "Cobrar na comanda" some.
  useEffect(() => {
    if (tem096Prop !== undefined) return;
    let vivo = true;
    detectar096(supabase).then(r => {
      if (!vivo) return;
      setTem096(r);
      if (r === false) setCobranca('agora');
    });
    return () => { vivo = false; };
  }, [tem096Prop]);

  // Maquininhas, bandeiras e taxas (086). Taxa nunca inventada: sem configuração, cartão sem taxa.
  useEffect(() => {
    let vivo = true;
    carregarConfigCartoes(supabase, empresaId)
      .then(c => { if (vivo) setConfig(c); })
      .catch(e => {
        if (!vivo) return;
        setErroConfig(`${mensagemErroBanco(e as { code?: string; message?: string }, 'carregar as taxas dos cartões')} ${AVISO_CARTOES_SEM_TAXA}`);
        setConfig(configIndisponivel());
      })
      .finally(() => { if (vivo) setConfigPronta(true); });
    return () => { vivo = false; };
  }, [empresaId]);

  // Clientes ativas, paginadas (acima de 1000 o PostgREST cortaria a lista em silêncio).
  useEffect(() => {
    if (travarCliente) return;
    let vivo = true;
    buscarTodasOuLancar<Cliente>((de, ate) => supabase.from('clientes').select('id, nome')
      .eq('empresa_id', empresaId).eq('ativo', true).order('nome').order('id').range(de, ate))
      .then(lista => {
        if (!vivo) return;
        setErroClientes(null);
        const ini = clienteInicialRef.current;
        setClientes(ini && !lista.some(c => c.id === ini.id) ? [ini, ...lista] : lista);
      })
      .catch(e => { if (vivo) setErroClientes(mensagemErroBanco(e as { message?: string }, 'carregar as clientes')); });
    return () => { vivo = false; };
  }, [empresaId, travarCliente]);

  // Trocar de pacote volta o valor para o preço dele.
  function escolherPacote(id: string) {
    setPacoteId(id);
    const p = pacotes.find(x => x.id === id);
    if (p) setValorTxt(p.preco.toFixed(2).replace('.', ','));
  }

  // ── Totais (mesma regra da comanda e da Venda avulsa)
  const quantidade = Number(quantidadeTxt);
  const valorUnit = parseValorBR(valorTxt);
  const subtotal = subtotalVendaPacote(valorUnit, quantidade);
  const { valor: desconto, erro: erroDesconto } = calcularDesconto(subtotal, podeDesconto ? parseValorBR(descontoEntrada) : 0, descontoModo);
  const splitsN = splitsNumericos(splits);
  const resumo = resumoComanda({ subtotal, desconto, erroDesconto, descontoReserva: 0, splits: cobranca === 'agora' ? splitsN : [] });
  const validadePrevista = pacote ? dataValidade(pacote.validade_dias, hojeBRT()) : null;

  const motivoBloqueio = useMemo(() => motivoBloqueioVendaPacote({
    temPacote: !!pacote, temCliente: !!clienteId, quantidade, valorTxt, valorUnit, erroDesconto, cobranca,
    resumo: { podeFechar: resumo.podeFechar, motivo: resumo.motivo }, configPronta,
  }), [pacote, clienteId, quantidade, valorUnit, valorTxt, erroDesconto, cobranca, resumo.podeFechar, resumo.motivo, configPronta]);

  async function vender() {
    if (gravandoRef.current || !pacote) return;
    if (motivoBloqueio) { setErro(motivoBloqueio); return; }

    const pagamentos = cobranca === 'agora'
      ? montarPagamentos(splitsN, { empresaId, config, total: resumo.total })
      : [];
    const entrada = { empresaId, clienteId, pacoteId: pacote.id, quantidade, valorUnit, desconto, cobranca, pagamentos };
    const assinatura = assinaturaVendaPacote(entrada);
    const chave = chaveVendaPacote(tentativa, chaveAbertura, assinatura);
    if (!chave) { setErro(MSG_ALTERADA_SEM_RESPOSTA); return; }

    gravandoRef.current = true;
    setSalvando(true); setErro('');
    try {
      let aviso: string | null = null;
      let pacoteClienteId: string | null = chave;
      try {
        await venderPacote(supabase, { ...entrada, vendaId: chave });
      } catch (e) {
        if (!(e instanceof SemMigration096)) throw e;
        // Sem a 096: "Cobrar na comanda" não existe; "Cobrar agora" pelo caminho antigo, com a venda.
        setTem096(false);
        if (cobranca === 'comanda') {
          setCobranca('agora');
          setErro(MSG_COMANDA_INDISPONIVEL);
          return;
        }
        ({ aviso, pacoteClienteId } = await venderPacoteSem096(supabase, {
          vendaId: chave, empresaId, clienteId, pacote: { id: pacote.id, validade_dias: pacote.validade_dias },
          quantidade, valorUnit, desconto, splits: splitsN, config,
        }));
      }
      setTentativa(null);
      setSucesso({
        cobranca, vendaId: chave, clienteId, pacoteId: pacote.id, quantidade, pacoteClienteId, aviso,
        clienteNome: clientes.find(c => c.id === clienteId)?.nome ?? 'Cliente',
        pacoteNome: pacote.nome, validade: validadePrevista, jaGravada: false,
      });
    } catch (e) {
      if (e instanceof ErroPacote) {
        // Erro definitivo: nada foi gravado com a chave (a próxima tentativa diferente usa outra).
        // Sem resposta: pode ter gravado — a mesma venda reaproveita a chave; mudar exige conferir.
        setTentativa({ chave, assinatura, semResposta: e.semResposta });
        setErro(e.message);
      } else {
        setErro(e instanceof Error && e.message ? e.message : 'Não foi possível vender o pacote.');
      }
    } finally {
      gravandoRef.current = false;
      setSalvando(false);
    }
  }

  /** Confere no banco (só leitura) a venda que ficou sem resposta. */
  async function conferir() {
    if (!tentativa || conferindo || !pacote) return;
    setConferindo(true);
    try {
      if (await vendaPacoteFoiGravada(supabase, tentativa.chave)) {
        setSucesso({
          cobranca, vendaId: tentativa.chave, clienteId, pacoteId: pacote.id, quantidade, pacoteClienteId: null, aviso: null,
          clienteNome: clientes.find(c => c.id === clienteId)?.nome ?? 'Cliente',
          pacoteNome: pacote.nome, validade: validadePrevista, jaGravada: true,
        });
      } else {
        setTentativa(null); setErro('');
      }
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Não foi possível conferir a venda.');
    } finally {
      setConferindo(false);
    }
  }

  useEffect(() => {
    if (!sucesso || sucesso.aviso) return;
    const t = setTimeout(() => onVendidoRef.current(sucesso), 1500);
    return () => clearTimeout(t);
  }, [sucesso]);

  // ── Sucesso
  if (sucesso) {
    return (
      <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
        <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm flex flex-col items-center text-center gap-2.5 py-10 px-6">
          <div className="relative flex items-center justify-center rounded-full"
            style={{ width: 64, height: 64, background: 'var(--color-green-soft)', animation: 'bm-pop .5s cubic-bezier(.2,.9,.3,1) both' }}>
            <Check size={28} strokeWidth={2.5} style={{ color: 'var(--color-green)' }}/>
          </div>
          <p className="font-serif text-lg text-text">
            {sucesso.jaGravada ? MSG_VENDA_JA_GRAVADA : sucesso.cobranca === 'comanda' ? 'Pacote a cobrar' : 'Pacote vendido!'}
          </p>
          <p className="text-sm text-text-2 truncate max-w-full">
            {sucesso.quantidade > 1 ? `${sucesso.quantidade}× ` : ''}{sucesso.pacoteNome} · {sucesso.clienteNome}
          </p>
          <p className="text-xs text-text-4">
            {sucesso.cobranca === 'comanda'
              ? 'Será cobrado ao fechar a comanda da cliente.'
              : sucesso.validade ? `Válido até ${format(parseISO(sucesso.validade), 'dd/MM/yyyy')}` : 'Sem validade — vale enquanto houver sessões'}
          </p>
          {sucesso.aviso && (
            <>
              <p className="text-xs font-semibold text-amber mt-2">{sucesso.aviso}</p>
              <button onClick={() => onVendido(sucesso)}
                className="mt-2 h-10 px-5 rounded-xl bg-primary text-white text-sm font-bold hover:opacity-90 transition">
                Entendi
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const travado = !!tentativa?.semResposta;

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif text-xl text-text">Vender pacote</h2>
            {pacote && <p className="text-xs text-text-3 mt-0.5 truncate">{pacote.nome} · {fmtBRL(pacote.preco)}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          {pacotes.length > 1 && (
            <div>
              <label className={labelCls}>Pacote *</label>
              <SearchSelect
                options={pacotes.map(p => ({ value: p.id, label: p.nome, sub: fmtBRL(p.preco) }))}
                value={pacoteId} onChange={escolherPacote} placeholder="Escolher pacote..."
              />
            </div>
          )}

          <fieldset disabled={travado} className="min-w-0 m-0 p-0 border-0 flex flex-col gap-4">
            <div>
              <label className={labelCls}>Cliente *</label>
              {travarCliente ? (
                <p className="h-10 px-3.5 rounded-xl border border-border bg-bg text-sm text-text flex items-center">{clienteInicial?.nome ?? '—'}</p>
              ) : (
                <SearchSelect
                  options={clientes.map(c => ({ value: c.id, label: c.nome }))}
                  value={clienteId} onChange={setClienteId} placeholder="Buscar cliente..." required
                />
              )}
              {erroClientes && <p className="text-xs text-red mt-1">{erroClientes}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className={labelCls}>Quantidade</label>
                <input value={quantidadeTxt} onChange={e => setQuantidadeTxt(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric" className={inputCls}/>
              </div>
              <div className="min-w-0">
                <label className={labelCls}>Valor (cada)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                  <input value={valorTxt} onChange={e => setValorTxt(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${inputCls} pl-9`}/>
                </div>
              </div>
            </div>

            {podeDesconto && (
              <div>
                <label className={labelCls}>Desconto</label>
                <div className="flex items-center gap-2">
                  <Tag size={15} className="text-text-3 flex-shrink-0"/>
                  {/* Trocar o modo limpa o valor para não reinterpretar o número */}
                  <div className="flex rounded-lg border border-border overflow-hidden flex-shrink-0">
                    {([['percentual', '%'], ['valor', 'R$']] as const).map(([modo, rotulo]) => (
                      <button key={modo} type="button" aria-pressed={descontoModo === modo}
                        onClick={() => { if (descontoModo !== modo) { setDescontoModo(modo); setDescontoEntrada(''); } }}
                        className={`h-10 px-3 text-xs font-bold transition ${descontoModo === modo ? 'bg-primary text-white' : 'bg-surface text-text-3 hover:text-text'}`}>
                        {rotulo}
                      </button>
                    ))}
                  </div>
                  <input value={descontoEntrada} onChange={e => setDescontoEntrada(e.target.value)}
                    inputMode="decimal" placeholder={descontoModo === 'percentual' ? '0' : '0,00'}
                    className={`${inputCls} ${erroDesconto ? '!border-red' : ''}`}/>
                </div>
                {erroDesconto && <p className="text-xs text-red font-semibold mt-2">{erroDesconto}</p>}
              </div>
            )}

            <div>
              <label className={labelCls}>Cobrança</label>
              <div className={`grid gap-2 ${tem096 !== false ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button type="button" onClick={() => setCobranca('agora')}
                  className={`h-10 rounded-xl text-xs font-semibold border transition ${cobranca === 'agora' ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-text-3 hover:border-accent'}`}>
                  Cobrar agora
                </button>
                {tem096 !== false && (
                  <button type="button" onClick={() => { setCobranca('comanda'); setSplits([]); }}
                    className={`h-10 rounded-xl text-xs font-semibold border transition ${cobranca === 'comanda' ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-text-3 hover:border-accent'}`}>
                    Cobrar na comanda
                  </button>
                )}
              </div>
              <p className="text-[11px] text-text-4 mt-1">
                {TEXTO_COBRANCA[cobranca]}
              </p>
            </div>
          </fieldset>

          {cobranca === 'agora' && (
            <div className="flex flex-col gap-3">
              <p className={labelCls}>Pagamento</p>
              <BlocoPagamento splits={splits} onChange={setSplits} config={config} falta={resumo.falta}
                permitirCortesia={podeDesconto} desabilitado={travado}/>
              {erroConfig && <p className="text-xs font-semibold text-amber">{erroConfig}</p>}
            </div>
          )}

          {/* Totais */}
          <div className="border-t border-border pt-3 flex flex-col gap-1.5">
            {desconto > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-text-3"><span>Subtotal</span><span>{fmtBRL(subtotal)}</span></div>
                <div className="flex items-center justify-between text-xs text-green font-semibold"><span>(−) Desconto</span><span>− {fmtBRL(desconto)}</span></div>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="font-bold text-text">Total</span>
              <span className="font-bold text-xl text-text">{fmtBRL(resumo.total)}</span>
            </div>
            {cobranca === 'agora' && splits.length > 0 && resumo.troco > 0.01 && (
              <div className="flex items-center justify-between text-sm font-bold text-primary"><span>Troco</span><span>{fmtBRL(resumo.troco)}</span></div>
            )}
            {cobranca === 'agora' && resumo.cortesiaAutomatica && splits.length === 0 && (
              <p className="text-xs text-text-4">Total R$ 0 — será registrado como Cortesia</p>
            )}
          </div>

          {pacote && (
            <div className="bg-bg rounded-xl px-4 py-3 flex items-center gap-2 border border-border">
              <Clock size={14} className="text-text-3 flex-shrink-0"/>
              <span className="text-xs text-text-3">
                {validadePrevista
                  ? <>Válido até <strong className="text-text">{format(parseISO(validadePrevista), 'dd/MM/yyyy')}</strong> · {pacote.validade_dias} dias</>
                  : <>Pacote <strong className="text-text">sem validade</strong> — vale enquanto houver sessões</>}
              </span>
            </div>
          )}

          {erro && (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2 border border-red/20">
              <AlertCircle size={14} className="text-red flex-shrink-0"/>
              <p className="text-sm text-red flex-1">{erro}</p>
              {travado && (
                <button onClick={conferir} disabled={conferindo} className="text-xs font-bold text-primary underline flex-shrink-0 disabled:opacity-50">
                  {conferindo ? 'Conferindo...' : 'Conferir'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex-shrink-0 flex flex-col gap-2">
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="button" onClick={vender}
              disabled={salvando || !!motivoBloqueio || (cobranca === 'agora' && !configPronta)}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
              {salvando ? 'Salvando...' : cobranca === 'agora' ? `Vender · ${fmtBRL(resumo.total)}` : 'Vender (a cobrar)'}
            </button>
          </div>
          {motivoBloqueio && !erro && <p className="text-xs text-center font-semibold text-amber">{motivoBloqueio}</p>}
        </div>
      </div>
    </div>
  );
}
