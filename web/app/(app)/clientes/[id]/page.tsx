'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Phone, Calendar, Edit3, Trash2, ShieldCheck, MapPin, X, AlertCircle, MessageCircle, Archive, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import type { Cliente } from '@/types';
import { format, addMinutes } from 'date-fns';
import { maskPhone } from '@/lib/masks';
import { avancarComEnter } from '@/lib/formNav';
import { ptBR } from 'date-fns/locale';
import { Sk } from '@/components/Skeleton';
import { Secret } from '@/components/privacy';
import { SearchSelect } from '@/components/SearchSelect';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { usePermissoes } from '@/components/PermissoesProvider';
import { buildTaxaReservaInsert } from '@shared/taxa-reserva';
import {
  montarAgendamento, valorDigitadoValido, instanteBRT, conflitosDeHorario, instanteNoPassado,
  msgConflito, MSG_HORARIO_PASSADO,
} from '@shared/agenda';
import { horaBRT, hojeBRT } from '@shared/periodos';
import { parseValorBR } from '@shared/comanda-fechamento';
import { valorTaxaReservaSugerida } from '@shared/taxas-atendimento';
import { mensagemErroBanco } from '@shared/erros';
import { novoUuid } from '@shared/uuid';
import { podeArquivarCliente, podeEditarAnamnese, opcoesRemoverCliente } from '@shared/permissoes';
import {
  aniversarioParaGravar, nomeClienteValido, parseEndereco, serializarEndereco,
  partesAniversario, diasNoMes, idadeCliente, erroTelefoneCliente, erroEmailCliente, contatosCliente,
} from '@shared/clientes';
import {
  ANAMNESE_VAZIA, normalizarAnamnese, anamnesePreenchida, restricoesAnamnese, ehRestricao,
  PERGUNTAS_SIM_NAO, PERGUNTAS_OPCOES, TEXTO_DECLARACAO, type AnamneseRespostas,
} from '@shared/anamnese';
import type { DetalheAtendimento } from '@shared/atendimento-detalhe';
import { carregarDetalheAtendimento } from '@shared/atendimento-detalhe-consultas';
import { ConteudoComanda } from '@/components/ConteudoComanda';
import {
  carregarHistoricoCliente, arquivarCliente, reativarCliente, clienteTemHistorico, excluirCliente,
  MSG_EXCLUSAO_COM_HISTORICO, type ItemHistorico,
} from '@shared/clientes-consultas';
import {
  kpisPerfilCliente, tagsPerfilCliente, AVISO_CLIENTE_ARQUIVADA, type Agregado,
} from '@shared/clientes-segmentos';
import { HistoricoCliente, type AberturaDetalhe } from './HistoricoCliente';

const supabase = createClient();

type Endereco = { logradouro: string; numero: string; bairro: string; complemento: string };

/** Mês/dia do aniversário como strings sem zero à esquerda ("3", "7"), para o rascunho do formulário. */
function nascPartes(data?: string | null): { nascMes: string; nascDia: string } {
  const { mes, dia } = partesAniversario(data);
  return { nascMes: mes ? String(Number(mes)) : '', nascDia: dia ? String(Number(dia)) : '' };
}

function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function DisplayRow({ label, value, placeholder = '—' }: {
  label: string; value?: string; placeholder?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-sm ${value ? 'text-text' : 'text-text-4 italic'}`}>{value || placeholder}</p>
    </div>
  );
}

type ServicoOpt = { id: string; nome: string; preco: number; duracao_minutos: number };

// ── Modal: novo agendamento com cliente pré-selecionado ───────

type MetodoPagTaxa = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
/** Formas de pagamento da taxa de reserva quando marcada como já cobrada — mesmas 5 opções de `pagamentos.metodo` usadas no checkout da comanda. */
const METODOS_TAXA: { key: MetodoPagTaxa; label: string }[] = [
  { key: 'dinheiro', label: 'Dinheiro' },
  { key: 'pix',      label: 'Pix' },
  { key: 'credito',  label: 'Crédito' },
  { key: 'debito',   label: 'Débito' },
  { key: 'cortesia', label: 'Cortesia' },
];

function NovoAgModal({ empresaId, clienteId, clienteNome, onClose, onSalvo }: {
  empresaId: string; clienteId: string; clienteNome: string;
  onClose: () => void; onSalvo: () => void;
}) {
  useScrollLock();
  const { pode } = usePermissoes();
  const podeOutras = pode('agenda.gerenciar_outras');
  const [profissionais, setProfissionais] = useState<{ id: string; nome: string }[]>([]);
  const [servicos,      setServicos]      = useState<ServicoOpt[]>([]);
  const [servicoId,  setServicoId]  = useState('');
  const [profId,     setProfId]     = useState('');
  const [data,       setData]       = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hora,       setHora]       = useState('09:00');
  const [duracao,    setDuracao]    = useState(60);
  const [valor,      setValor]      = useState('');
  const [obs,        setObs]        = useState('');
  const [salvando,   setSalvando]   = useState(false);
  const [erro,       setErro]       = useState('');

  // Taxa de reserva (configurada pela empresa, pré-preenchida ao escolher o serviço).
  // `aplicarTaxaReserva` é o switch "Cobrar taxa de reserva neste atendimento": nasce ligado
  // (a chave geral da empresa é o padrão) e, desligado, nenhuma linha de `taxas_reserva` é criada.
  const [taxaReservaCfg, setTaxaReservaCfg] = useState<{ ativa: boolean; modo: 'percentual' | 'fixo'; valor: number }>({ ativa: false, modo: 'percentual', valor: 0 });
  const [aplicarTaxaReserva, setAplicarTaxaReserva] = useState(true);
  const [taxaReserva,        setTaxaReserva]        = useState('0');
  const [taxaEditadaManual, setTaxaEditadaManual] = useState(false);
  const [taxaReservaCobrada, setTaxaReservaCobrada] = useState(false);
  const [taxaReservaMetodo,  setTaxaReservaMetodo]  = useState<MetodoPagTaxa | null>(null);

  const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";

  useEffect(() => {
    Promise.all([
      supabase.from('empresa_membros').select('user_id, user:users(id, nome)')
        .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional']).eq('ativo', true),
      supabase.from('servicos').select('id, nome, preco, duracao_minutos')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.auth.getUser(),
    ]).then(([p, s, u]) => {
      const todos = (p.data ?? []).map((m: any) => ({ id: m.user.id, nome: m.user.nome }));
      // Sem 'agenda.gerenciar_outras' (RLS 082/083) só dá para agendar para si mesma.
      const meuId = u.data.user?.id;
      const lista = podeOutras ? todos : todos.filter((m: { id: string }) => m.id === meuId);
      setProfissionais(lista);
      if (!podeOutras && meuId) setProfId(meuId);
      setServicos((s.data ?? []) as ServicoOpt[]);
    });
  }, [empresaId, podeOutras]);

  // Configuração de taxa de reserva da empresa
  useEffect(() => {
    supabase.from('empresas')
      .select('taxa_reserva_ativa, taxa_reserva_modo, taxa_reserva_valor')
      .eq('id', empresaId).single()
      .then(({ data }: { data: any }) => {
        if (data) {
          setTaxaReservaCfg({
            ativa: data.taxa_reserva_ativa,
            modo: data.taxa_reserva_modo as 'percentual' | 'fixo',
            valor: Number(data.taxa_reserva_valor),
          });
        }
      });
  }, [empresaId]);

  function onServicoChange(id: string) {
    setServicoId(id);
    const s = servicos.find(sv => sv.id === id);
    if (s) { setDuracao(s.duracao_minutos); setValor(s.preco.toFixed(2).replace('.', ',')); }
  }

  // Valor pela regra única (vazio = preço do serviço, "0" = cortesia). A taxa sugerida é sobre esse
  // total e recalcula quando ele muda, até a pessoa digitar a taxa.
  const precoServico = servicos.find(sv => sv.id === servicoId)?.preco ?? 0;
  const valorOk = valorDigitadoValido(valor);
  const montado = montarAgendamento({
    linhas: servicoId ? [{ servico_id: servicoId, profissional_id: profId, valor, duracao_min: duracao, preco: precoServico }] : [],
    inicioIso: new Date().toISOString(),
  });
  const { valorTotal } = montado;
  useEffect(() => {
    if (!taxaReservaCfg.ativa || taxaEditadaManual) return;
    setTaxaReserva(String(valorTaxaReservaSugerida(taxaReservaCfg, valorTotal)).replace('.', ','));
  }, [taxaReservaCfg, taxaEditadaManual, valorTotal]);

  // Pergunta pendente antes de gravar (conflito de horário, depois horário passado) — mesmas regras
  // e textos da agenda (shared/agenda).
  const [pergunta, setPergunta] = useState<{ mensagem: string; titulo: string; seguir: () => void } | null>(null);
  // Agendamento já gravado cuja linha de serviço falhou: a nova tentativa só regrava a linha
  // (nunca cria um segundo agendamento nem uma segunda taxa).
  const [idCriado, setIdCriado] = useState<string | null>(null);

  async function gravarLinha(agId: string): Promise<boolean> {
    const { error: errLinhas } = await supabase.from('agendamento_servicos').insert(
      montado.linhas.map((l, i) => ({
        agendamento_id: agId, servico_id: l.servico_id, valor: l.valor,
        duracao_minutos: l.duracao_min, ordem: i, empresa_id: empresaId,
      })),
    );
    if (errLinhas) {
      setIdCriado(agId);
      setErro(`O agendamento foi salvo, mas os serviços não: ${mensagemErroBanco(errLinhas, 'salvar os serviços do agendamento')}`);
      return false;
    }
    return true;
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    if (idCriado) {
      setSalvando(true);
      const ok = await gravarLinha(idCriado);
      setSalvando(false);
      if (ok) onSalvo();
      return;
    }
    if (!valorOk) { setErro('Corrija o valor do serviço (use 0 para cortesia).'); return; }
    if (aplicarTaxaReserva && taxaReservaCfg.ativa && !valorDigitadoValido(taxaReserva)) { setErro('Corrija o valor da taxa de reserva.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) { setErro('Informe a data e o horário.'); return; }
    // Dia e hora em Brasília, nunca no fuso do navegador.
    const inicio = new Date(instanteBRT(data, hora));
    const fim    = addMinutes(inicio, duracao);

    setSalvando(true);
    const { data: conf, error: errConf } = await supabase
      .from('agendamentos')
      .select('id, profissional_id, data_hora_inicio, data_hora_fim, status')
      .eq('empresa_id', empresaId).eq('profissional_id', profId)
      .lt('data_hora_inicio', fim.toISOString()).gt('data_hora_fim', inicio.toISOString());
    setSalvando(false);
    if (errConf) { setErro(mensagemErroBanco(errConf, 'conferir a agenda')); return; }
    const conflitos = conflitosDeHorario(
      { profissional_id: profId, inicioIso: inicio.toISOString(), fimIso: fim.toISOString() },
      ((conf ?? []) as { id: string; profissional_id: string; data_hora_inicio: string; data_hora_fim: string; status: string }[])
        .map(a => ({ id: a.id, profissional_id: a.profissional_id, inicio: a.data_hora_inicio, fim: a.data_hora_fim, status: a.status })),
    );
    const nomeProf = profissionais.find(p => p.id === profId)?.nome ?? 'Profissional';
    const depoisDoConflito = () => {
      if (instanteNoPassado(inicio.toISOString(), Date.now())) {
        setPergunta({ titulo: 'Horário passado', mensagem: MSG_HORARIO_PASSADO, seguir: () => void gravar(inicio, fim) });
        return;
      }
      void gravar(inicio, fim);
    };
    if (conflitos.length > 0) {
      setPergunta({ titulo: 'Conflito de horário', mensagem: msgConflito(nomeProf, horaBRT(conflitos[0].inicio)), seguir: depoisDoConflito });
      return;
    }
    depoisDoConflito();
  }

  async function gravar(inicio: Date, fim: Date) {
    setSalvando(true);
    // Id gerado aqui e SEM RETURNING: com "agenda.gerenciar_outras" e sem "agenda.ver_equipe" a
    // pessoa cria na agenda de outra profissional, mas não lê a linha nova — o RETURNING recusava.
    const ag = { id: novoUuid() };
    const { error } = await supabase.from('agendamentos').insert({
      id: ag.id,
      empresa_id: empresaId, cliente_id: clienteId, profissional_id: profId,
      servico_id: servicoId, data_hora_inicio: inicio.toISOString(),
      data_hora_fim: fim.toISOString(), status: 'agendado',
      valor: valorTotal, observacao: obs.trim() || null,
    });
    if (error) { setSalvando(false); setErro(mensagemErroBanco(error, 'criar agendamento')); return; }

    // Só cria a linha com o switch "Cobrar taxa de reserva neste atendimento" ligado.
    if (aplicarTaxaReserva) {
      const taxaReservaValorNum = parseValorBR(taxaReserva);
      const taxaReservaPayload = buildTaxaReservaInsert({
        empresaId, agendamentoId: ag.id, clienteId, valor: taxaReservaValorNum,
        jaCobrada: taxaReservaCobrada, metodo: taxaReservaMetodo, cobrar: aplicarTaxaReserva,
      }, new Date().toISOString());
      if (taxaReservaPayload) {
        const { error: erroReserva } = await supabase.from('taxas_reserva').insert(taxaReservaPayload);
        if (erroReserva) {
          console.error('Erro ao registrar taxa de reserva:', erroReserva.message);
        }
      }
    }

    const ok = await gravarLinha(ag.id);
    setSalvando(false);
    if (ok) onSalvo();
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-serif text-xl text-text">Novo agendamento</h2>
            <p className="text-xs text-text-3 mt-0.5">Cliente: <span className="font-semibold text-text-2">{clienteNome}</span></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Serviço</label>
            <SearchSelect
              options={servicos.map(s => ({ value: s.id, label: s.nome }))}
              value={servicoId}
              onChange={onServicoChange}
              placeholder="Buscar serviço..."
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Profissional</label>
            <SearchSelect
              options={profissionais.map(p => ({ value: p.id, label: p.nome }))}
              value={profId}
              onChange={setProfId}
              placeholder="Selecionar profissional..."
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Data</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)} required className={inputCls}/>
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Horário</label>
              <input type="time" value={hora} onChange={e => setHora(e.target.value)} required className={inputCls}/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Duração (min)</label>
              <input type="number" value={duracao} onChange={e => setDuracao(Number(e.target.value))} min={15} step={15} required className={inputCls}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Valor (R$)</label>
              <input type="text" inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)}
                placeholder={precoServico.toFixed(2).replace('.', ',')} aria-invalid={!valorOk}
                className={`${inputCls} ${valorOk ? '' : 'border-red'}`}/>
              {!valorOk && <p className="text-[10px] text-red mt-0.5">Valor inválido (use 0 para cortesia)</p>}
            </div>
          </div>
          {taxaReservaCfg.ativa && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aplicarTaxaReserva}
                  onChange={e => setAplicarTaxaReserva(e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-primary"
                />
                <span className="text-xs font-semibold text-text-2 uppercase tracking-wide">Cobrar taxa de reserva neste atendimento</span>
              </label>
              {aplicarTaxaReserva && (
                <div className="mt-2">
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                    <input
                      value={taxaReserva}
                      onChange={e => { setTaxaReserva(e.target.value); setTaxaEditadaManual(true); }}
                      inputMode="decimal" placeholder="0,00"
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                  {parseValorBR(taxaReserva) > 0 && (
                    <>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={taxaReservaCobrada}
                          onChange={e => { setTaxaReservaCobrada(e.target.checked); if (!e.target.checked) setTaxaReservaMetodo(null); }}
                          className="w-4 h-4 rounded border-border accent-primary"
                        />
                        <span className="text-xs text-text-2">Já foi cobrada?</span>
                      </label>
                      {taxaReservaCobrada && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {METODOS_TAXA.map(m => (
                            <button key={m.key} type="button"
                              onClick={() => setTaxaReservaMetodo(prev => prev === m.key ? null : m.key)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                                taxaReservaMetodo === m.key
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-bg text-text-2 border-border hover:border-primary/40'
                              }`}>
                              {m.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Observação <span className="text-text-4 normal-case font-normal">(opcional)</span></label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Notas sobre o atendimento..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
          </div>
          {erro && <p className="text-red text-sm text-center">{erro}</p>}
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="submit" disabled={salvando || !servicoId || !profId} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
              {salvando ? 'Salvando...' : idCriado ? 'Salvar serviços' : 'Agendar'}
            </button>
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={!!pergunta}
        title={pergunta?.titulo ?? ''}
        message={pergunta?.mensagem ?? ''}
        confirmLabel={pergunta?.titulo === 'Horário passado' ? 'Registrar' : 'Agendar mesmo assim'}
        variant="warning"
        onConfirm={() => { const p = pergunta; setPergunta(null); p?.seguir(); }}
        onCancel={() => setPergunta(null)}
      />
    </div>
  );
}

const inputClass = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelClass = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

// ── Tela ─────────────────────────────────────────────────────

/**
 * Detalhe de um atendimento do historico: o que foi feito, como fechou e como
 * foi pago. Busca sob demanda — nada disso e carregado junto com a lista.
 *
 * Recebe `agendamentoId` quando a linha veio de um agendamento, ou apenas
 * `comandaId` quando veio de um servico lancado direto na comanda.
 */
function DetalheAtendimentoModal({ agendamentoId, comandaId, tituloLinha, onClose }: {
  agendamentoId: string | null;
  comandaId: string | null;
  tituloLinha: string;
  onClose: () => void;
}) {
  useScrollLock();
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState<DetalheAtendimento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    carregarDetalheAtendimento(supabase, agendamentoId, comandaId)
      .then(d => { if (vivo) setDetalhe(d); })
      .catch(e => { if (vivo) setErro((e as Error).message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [agendamentoId, comandaId]);


  return (
    <div className="bm-modal fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhe</p>
            <h2 className="font-serif text-lg text-text truncate">{tituloLinha}</h2>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
          <ConteudoComanda detalhe={detalhe} carregando={carregando} erro={erro}/>
        </div>
      </div>
    </div>
  );
}

export default function ClientePerfilPage() {
  const router       = useRouter();
  const { id }       = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { pode } = usePermissoes();

  const [cliente,  setCliente]  = useState<Cliente | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [abaAtiva, setAbaAtiva] = useState<'info' | 'historico' | 'anamnese'>(
    searchParams.get('aba') === 'anamnese' && pode('anamnese.ver') ? 'anamnese' : 'info'
  );

  // ── Info edit ──────────────────────────────────────────────
  type InfoRascunho = { nome: string; telefone: string; email: string; nascMes: string; nascDia: string; obs: string } & Endereco;
  const [editInfo,      setEditInfo]      = useState(false);
  const [rascunhoInfo,  setRascunhoInfo]  = useState<InfoRascunho>({
    nome: '', telefone: '', email: '', nascMes: '', nascDia: '', obs: '',
    logradouro: '', numero: '', bairro: '', complemento: '',
  });
  const [salvandoInfo, setSalvandoInfo] = useState(false);
  const [erroInfo,      setErroInfo]      = useState('');

  // ── Anamnese ────────────────────────────────────────────────
  const [anamnese,   setAnamnese]   = useState<AnamneseRespostas>(ANAMNESE_VAZIA);
  const [editAn,     setEditAn]     = useState(searchParams.get('editar') === '1' && searchParams.get('aba') === 'anamnese' && podeEditarAnamnese(pode));
  const [rascunho,   setRascunho]   = useState<AnamneseRespostas>(ANAMNESE_VAZIA);
  const [erroAn,     setErroAn]     = useState('');
  const [erroCargaAn, setErroCargaAn] = useState('');
  const [salvandoAn, setSalvandoAn] = useState(false);

  // ── Histórico + KPIs (fonte única: carregarHistoricoCliente) ─
  // Carregado junto com o perfil: os 4 KPIs saem do mesmo `agregado` da lista de Clientes.
  const [itensHist,   setItensHist]   = useState<ItemHistorico[]>([]);
  const [agregado,    setAgregado]    = useState<Agregado | null>(null);
  const [loadingHist, setLoadingHist] = useState(true);
  const [erroHist,    setErroHist]    = useState('');

  const [empresaId,       setEmpresaId]       = useState<string | null>(null);
  const [modalAg,         setModalAg]         = useState(false);
  const [confirmArquivar, setConfirmArquivar] = useState(false);
  const [arquivando,      setArquivando]      = useState(false);
  const [reativando,      setReativando]      = useState(false);
  const [modalRemover,    setModalRemover]    = useState(false);
  useScrollLock(modalRemover);
  const [detalheAberto,   setDetalheAberto]   = useState<AberturaDetalhe | null>(null);
  const [confirmExcluir,  setConfirmExcluir]  = useState(false);
  const [excluindo,       setExcluindo]       = useState(false);
  const [erroExcluir,     setErroExcluir]     = useState('');

  /** (Re)carrega histórico e KPIs. Erro vira aviso e KPIs "—", nunca zeros nem lista vazia. */
  async function carregarHistorico(empresa: string) {
    setLoadingHist(true); setErroHist('');
    try {
      const { itens, agregado: ag } = await carregarHistoricoCliente(supabase, empresa, id);
      setItensHist(itens); setAgregado(ag);
    } catch (e) {
      setItensHist([]); setAgregado(null);
      setErroHist((e as Error).message || 'erro desconhecido');
    } finally {
      setLoadingHist(false);
    }
  }

  useEffect(() => {
    (async () => {
      const [{ data: clienteData, error: erroCliente }, rFicha, { data: { user } }] = await Promise.all([
        supabase.from('clientes').select('*').eq('id', id).maybeSingle(),
        supabase.from('anamnese_fichas').select('respostas').eq('cliente_id', id).maybeSingle(),
        supabase.auth.getUser(),
      ]);

      // Falha ao ler a cliente não é "não encontrada" (igual ao app).
      setErroCarga(erroCliente ? mensagemErroBanco(erroCliente, 'carregar a cliente') : '');
      setCliente(clienteData as Cliente);
      // Falha ao carregar não pode virar "ficha vazia": o usuário sobrescreveria uma ficha real.
      setErroCargaAn(rFicha.error ? rFicha.error.message : '');
      const ficha = normalizarAnamnese(rFicha.data?.respostas);
      setAnamnese(ficha); setRascunho(ficha);
      setLoading(false);

      // A empresa do histórico é a da própria cliente (nunca a 1ª empresa do usuário).
      if (clienteData) void carregarHistorico((clienteData as Cliente).empresa_id);
      else setLoadingHist(false);

      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (membro) setEmpresaId(membro.empresa_id);
    })();
  }, [id]);

  useEffect(() => {
    if (!cliente) return;
    // rascunho de info
    const end = parseEndereco(cliente.endereco);
    setRascunhoInfo({
      nome: cliente.nome, telefone: cliente.telefone ?? '',
      email: cliente.email ?? '', ...nascPartes(cliente.data_nascimento), obs: cliente.observacoes ?? '',
      logradouro: end.logradouro, numero: end.numero,
      bairro: end.bairro, complemento: end.complemento,
    });
  }, [cliente]);

  function resetRascunhoInfo(c: Cliente) {
    const end = parseEndereco(c.endereco);
    setRascunhoInfo({
      nome: c.nome, telefone: c.telefone ?? '',
      email: c.email ?? '', ...nascPartes(c.data_nascimento), obs: c.observacoes ?? '',
      logradouro: end.logradouro, numero: end.numero,
      bairro: end.bairro, complemento: end.complemento,
    });
  }

  async function salvarInfo() {
    if (!nomeClienteValido(rascunhoInfo.nome)) return;
    const erroTel = erroTelefoneCliente(rascunhoInfo.telefone);
    if (erroTel) { setErroInfo(erroTel); return; }
    const erroMail = erroEmailCliente(rascunhoInfo.email);
    if (erroMail) { setErroInfo(erroMail); return; }
    const { nascMes, nascDia } = rascunhoInfo;
    if (!!nascMes !== !!nascDia) { setErroInfo('Escolha o mês e o dia do aniversário, ou deixe os dois em branco.'); return; }
    setErroInfo('');
    // Mês/dia inalterados: mantém a data original (preserva um ano real, se houver).
    const data_nascimento = aniversarioParaGravar(cliente?.data_nascimento, nascMes, nascDia);
    const enderecoJson = serializarEndereco({
      logradouro: rascunhoInfo.logradouro, numero: rascunhoInfo.numero,
      bairro: rascunhoInfo.bairro, complemento: rascunhoInfo.complemento,
    });
    const observacoes = rascunhoInfo.obs.trim() || null;
    setSalvandoInfo(true);
    const { data: atualizadas, error } = await supabase.from('clientes').update({
      nome: rascunhoInfo.nome.trim(),
      telefone: rascunhoInfo.telefone.trim() || null,
      email: rascunhoInfo.email.trim() || null,
      data_nascimento,
      endereco: enderecoJson,
      observacoes,
    }).eq('id', id).select('id');
    setSalvandoInfo(false);
    if (error) { setErroInfo(mensagemErroBanco(error, 'editar cliente')); return; }
    if (!atualizadas || atualizadas.length === 0) { setErroInfo('Sem permissão para editar esta cliente.'); return; }
    setCliente(prev => prev ? {
      ...prev,
      nome: rascunhoInfo.nome.trim(),
      telefone: rascunhoInfo.telefone.trim() || undefined,
      email: rascunhoInfo.email.trim() || undefined,
      data_nascimento: data_nascimento ?? undefined,
      endereco: enderecoJson ?? undefined,
      observacoes: observacoes ?? undefined,
    } : prev);
    setEditInfo(false);
  }

  function desativar() {
    setErroExcluir('');
    setModalRemover(true);
  }

  async function confirmarArquivar() {
    if (!cliente) return;
    setArquivando(true);
    try {
      await arquivarCliente(supabase, cliente.empresa_id, id);
      setConfirmArquivar(false);
      router.push('/clientes');
    } catch (e) {
      setConfirmArquivar(false);
      setErroExcluir((e as Error).message);
    } finally {
      setArquivando(false);
    }
  }

  /** Reativa a cliente arquivada e fica no perfil (ela volta à lista e aos segmentos). */
  async function reativar() {
    if (!cliente) return;
    setReativando(true); setErroExcluir('');
    try {
      await reativarCliente(supabase, cliente.empresa_id, id);
      setCliente(prev => prev ? { ...prev, ativo: true } : prev);
    } catch (e) {
      setErroExcluir((e as Error).message);
    } finally {
      setReativando(false);
    }
  }

  /** Verifica se a cliente tem qualquer histórico vinculado (bloqueia exclusão definitiva) */
  /** Exclusão definitiva: só sem histórico (mesma regra e textos do app, em shared). */
  async function pedirExclusao() {
    setModalRemover(false);
    setErroExcluir('');
    try {
      if (await clienteTemHistorico(supabase, id)) { setErroExcluir(MSG_EXCLUSAO_COM_HISTORICO); return; }
    } catch (e) {
      setErroExcluir((e as Error).message);
      return;
    }
    setConfirmExcluir(true);
  }

  async function confirmarExcluir() {
    if (!cliente) return;
    setExcluindo(true);
    try {
      // .select('id') + conferência de linhas: RLS que recusa devolve sucesso com 0 linhas.
      await excluirCliente(supabase, cliente.empresa_id, id);
    } catch (e) {
      setExcluindo(false);
      setConfirmExcluir(false);
      setErroExcluir((e as Error).message);
      return;
    }
    setExcluindo(false);
    setConfirmExcluir(false);
    router.push('/clientes');
  }

  if (loading) return (
    <div className="bm-page">
      <Sk className="h-4 w-20 mb-4" />
      {/* Hero gradient (avatar + nome + ações + 3 KPIs) */}
      <div className="rounded-2xl p-5 mb-6"
        style={{ background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)' }}>
        <div className="flex items-start gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl flex-shrink-0 bg-white/10" />
          <div className="flex-1 min-w-0 flex flex-col gap-2 pt-1">
            <div className="h-6 w-3/4 max-w-[200px] rounded bg-white/15" />
            <div className="h-3.5 w-1/2 max-w-[140px] rounded bg-white/10" />
          </div>
          <div className="w-8 h-8 rounded-[10px] bg-white/10 flex-shrink-0" />
        </div>
        {/* Action buttons */}
        <div className="flex gap-2 mb-5">
          <div className="flex-1 h-10 rounded-xl bg-white/90" />
          <div className="flex-1 h-10 rounded-xl bg-white/10" />
          <div className="flex-1 h-10 rounded-xl bg-white/10" />
        </div>
        {/* KPIs hero */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-[14px] p-3" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-5 w-12 rounded bg-white/15 mb-1.5" />
              <div className="h-3 w-3/4 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* coluna principal */}
        <div className="flex-1 min-w-0 w-full">
          {/* Tabs */}
          <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 mb-5 w-fit">
            {[80, 90, 80].map((w, i) => (
              <Sk key={i} className="h-8 rounded-lg" style={{ width: `${w}px` }} />
            ))}
          </div>
          {/* Bloco info */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <Sk className="h-4 w-32" />
              <Sk className="h-4 w-12" />
            </div>
            {[1,2,3,4].map(i => (
              <div key={i}>
                <Sk className="h-3 w-16 mb-2" />
                <Sk className="h-4 w-full max-w-xs" />
              </div>
            ))}
          </div>
        </div>
        {/* Sidebar */}
        <div className="w-full lg:w-72 lg:flex-shrink-0 flex flex-col gap-4">
          {/* Ações rápidas */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
            <Sk className="h-3 w-24 mb-3" />
            <Sk className="h-9 w-full rounded-xl" />
          </div>
          {/* Informações */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <Sk className="h-3 w-24 mb-1" />
            {[1,2,3].map(i => (
              <div key={i}>
                <Sk className="h-3 w-14 mb-1.5" />
                <Sk className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
  if (!cliente) return (
    <div className="text-center py-16 text-text-3">
      {erroCarga
        ? <p role="alert">Não foi possível carregar a cliente. {erroCarga}</p>
        : <p>Cliente não encontrada.</p>}
      <button onClick={() => router.push('/clientes')} className="mt-4 text-sm font-semibold text-primary">Voltar</button>
    </div>
  );

  const idade = idadeCliente(cliente.data_nascimento);

  const enderecoAtual = parseEndereco(cliente.endereco);
  const temEndereco   = Object.values(enderecoAtual).some(Boolean);
  const contatos      = contatosCliente(cliente.telefone);
  const arquivada     = cliente.ativo === false;
  const remover       = opcoesRemoverCliente(arquivada, pode);
  // Erro ou carregamento: sem agregado → "—" nos KPIs (nunca zero) e nenhuma tag de segmento.
  const agregadoPronto = !loadingHist && !erroHist ? agregado : null;
  // Tags e KPIs: os mesmos textos do app (shared/clientes-segmentos).
  const tags = tagsPerfilCliente({
    id: cliente.id, nome: cliente.nome, telefone: cliente.telefone ?? null, email: cliente.email ?? null,
    data_nascimento: cliente.data_nascimento ?? null, ativo: cliente.ativo, created_at: cliente.created_at,
  }, agregadoPronto, hojeBRT());
  const kpis = kpisPerfilCliente(agregadoPronto, hojeBRT());

  return (
    <div className="bm-page">
      {/* Hero plum */}
      {(() => {
        let hue = 0;
        for (let i = 0; i < cliente.nome.length; i++) hue = (hue * 31 + cliente.nome.charCodeAt(i)) % 360;
        return (
          <div style={{ background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)', borderRadius: 24, padding: '28px 28px 20px', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
            <button onClick={() => router.push('/clientes')}
              className="press flex items-center gap-1.5 mb-5"
              style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
              <ChevronLeft size={15} strokeWidth={2}/> Clientes
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div style={{ width: 64, height: 64, borderRadius: 64 * 0.32, flexShrink: 0, background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 22, boxShadow: '0 0 0 3px rgba(255,255,255,0.15), 0 0 0 7px rgba(139,92,240,0.2)' }}>
                {iniciais(cliente.nome)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 600, color: '#fff', lineHeight: 1.1 }}>{cliente.nome}</h1>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                  Cliente desde {format(new Date(cliente.created_at), "MMMM 'de' yyyy", { locale: ptBR })}
                  {idade !== null && ` · ${idade} anos`}
                </p>
                {cliente.telefone && (
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Phone size={12} strokeWidth={2}/>{cliente.telefone}
                  </p>
                )}
                {tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
                    {tags.map(t => (
                      <span key={t} style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: '#fff', background: t === 'Arquivada' ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.14)', borderRadius: 8, padding: '2px 8px' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {remover.algum && (
                <button onClick={desativar}
                  className="press"
                  style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', border: 'none', flexShrink: 0 }}>
                  <Trash2 size={14} strokeWidth={2}/>
                </button>
              )}
            </div>

            {/* Arquivada: aviso e Reativar (mesma permissão de arquivar) */}
            {arquivada && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
                <Archive size={14} strokeWidth={2} style={{ color: '#FCD34D', flexShrink: 0 }}/>
                <p style={{ flex: 1, fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                  {AVISO_CLIENTE_ARQUIVADA}
                </p>
                {podeArquivarCliente(pode) && (
                  <button onClick={reativar} disabled={reativando} className="press"
                    style={{ height: 32, padding: '0 12px', borderRadius: 10, background: '#fff', color: 'var(--color-primary)', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, border: 'none', flexShrink: 0, opacity: reativando ? 0.6 : 1 }}>
                    <RotateCcw size={13} strokeWidth={2.5}/>{reativando ? 'Reativando...' : 'Reativar'}
                  </button>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button onClick={() => setModalAg(true)} className="press"
                style={{ flex: 1, height: 38, borderRadius: 12, background: '#fff', color: 'var(--color-primary)', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 'none' }}>
                <Calendar size={14} strokeWidth={2.5}/>Agendar
              </button>
              {contatos && (
                <a href={contatos.whatsapp} target="_blank" rel="noopener noreferrer" className="press"
                  style={{ flex: 1, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none' }}>
                  <MessageCircle size={14} strokeWidth={2.5}/>WhatsApp
                </a>
              )}
              {contatos && (
                <a href={contatos.ligar} className="press"
                  style={{ flex: 1, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none' }}>
                  <Phone size={14} strokeWidth={2.5}/>Ligar
                </a>
              )}
            </div>

            {erroHist && (
              <p role="alert" style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#FCA5A5', marginBottom: 8 }}>
                Não foi possível carregar o histórico. Os números aparecem como —.
              </p>
            )}

            {/* KPIs — mesmo agregado da lista (shared/clientes-segmentos) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {kpis.map((kpi, i) => (
                <div key={kpi.rotulo} className="bm-stagger"
                  style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: '10px 12px', '--bm-i': i, '--bm-step': '55ms' } as React.CSSProperties}>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kpi.secreto ? <Secret>{kpi.valor}</Secret> : kpi.valor}</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4, fontWeight: 600 }}>{kpi.rotulo}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── Coluna esquerda ── */}
        <div className="flex-1 min-w-0 w-full">

          {/* Abas */}
          <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 mb-5 w-fit">
            {([
              { key: 'info',      label: 'Informações' },
              { key: 'historico', label: 'Histórico'   },
              { key: 'anamnese',  label: 'Anamnese'    },
            ] as const).filter(({ key }) => key !== 'anamnese' || pode('anamnese.ver')).map(({ key, label }) => (
              <button key={key} onClick={() => setAbaAtiva(key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                  abaAtiva === key ? 'bg-primary text-white' : 'text-text-3 hover:text-text-2'
                }`}>{label}</button>
            ))}
          </div>

          {/* Aba: Informações */}
          {abaAtiva === 'info' && (
            <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <p className="font-semibold text-text text-sm">Dados cadastrais</p>
                {!editInfo && pode('clientes.editar') && (
                  <button onClick={() => setEditInfo(true)}
                    className="flex items-center gap-1.5 text-xs text-accent font-semibold hover:underline">
                    <Edit3 size={12}/> Editar
                  </button>
                )}
              </div>

              <div className="p-5 flex flex-col gap-5">
                {editInfo ? (
                  <>
                    <div>
                      <label className={labelClass}>Nome completo *</label>
                      <input value={rascunhoInfo.nome}
                        onChange={e => setRascunhoInfo(r => ({ ...r, nome: e.target.value }))}
                        placeholder="Nome completo" className={inputClass}/>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Telefone / WhatsApp *</label>
                        <input value={rascunhoInfo.telefone} type="tel"
                          onChange={e => setRascunhoInfo(r => ({ ...r, telefone: maskPhone(e.target.value) }))}
                          placeholder="(11) 98765-4321" maxLength={15} className={inputClass}/>
                      </div>
                      <div>
                        <label className={labelClass}>Data de nascimento</label>
                        <div className="flex gap-2">
                          <select
                            value={rascunhoInfo.nascMes}
                            onChange={e => {
                              const m = e.target.value;
                              setRascunhoInfo(r => ({ ...r, nascMes: m, nascDia: r.nascDia && Number(r.nascDia) > diasNoMes(m) ? '' : r.nascDia }));
                            }}
                            className={inputClass}>
                            <option value="">Mês</option>
                            {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
                              .map((l, i) => <option key={i + 1} value={String(i + 1)}>{l}</option>)}
                          </select>
                          <select
                            value={rascunhoInfo.nascDia}
                            onChange={e => setRascunhoInfo(r => ({ ...r, nascDia: e.target.value }))}
                            className={inputClass}>
                            <option value="">Dia</option>
                            {Array.from({ length: diasNoMes(rascunhoInfo.nascMes) }, (_, i) => String(i + 1)).map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>E-mail</label>
                      <input value={rascunhoInfo.email} type="email"
                        onChange={e => setRascunhoInfo(r => ({ ...r, email: e.target.value }))}
                        placeholder="nome@exemplo.com" className={inputClass}/>
                    </div>
                    <div>
                      <label className={labelClass}>Observações internas</label>
                      <textarea value={rascunhoInfo.obs} rows={3}
                        onChange={e => setRascunhoInfo(r => ({ ...r, obs: e.target.value }))}
                        placeholder="Ex: preferências, restrições, como nos conheceu…"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
                    </div>

                    <div className="border-t border-border pt-5">
                      <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                        <MapPin size={12} strokeWidth={2}/> Endereço
                      </p>
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className={labelClass}>Logradouro</label>
                          <input value={rascunhoInfo.logradouro}
                            onChange={e => setRascunhoInfo(r => ({ ...r, logradouro: e.target.value }))}
                            placeholder="Rua, avenida, estrada..." className={inputClass}/>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className={labelClass}>Número</label>
                            <input value={rascunhoInfo.numero}
                              onChange={e => setRascunhoInfo(r => ({ ...r, numero: e.target.value }))}
                              placeholder="Ex: 123" className={inputClass}/>
                          </div>
                          <div>
                            <label className={labelClass}>Bairro</label>
                            <input value={rascunhoInfo.bairro}
                              onChange={e => setRascunhoInfo(r => ({ ...r, bairro: e.target.value }))}
                              placeholder="Ex: Centro" className={inputClass}/>
                          </div>
                        </div>
                        <div>
                          <label className={labelClass}>
                            Complemento{' '}
                            <span className="text-text-4 normal-case font-normal">(opcional)</span>
                          </label>
                          <input value={rascunhoInfo.complemento}
                            onChange={e => setRascunhoInfo(r => ({ ...r, complemento: e.target.value }))}
                            placeholder="Ap. 12, Bloco B..." className={inputClass}/>
                        </div>
                      </div>
                    </div>

                    {erroInfo && <p className="text-red text-sm">{erroInfo}</p>}
                    <div className="flex gap-3 pt-1">
                      <button onClick={() => { resetRascunhoInfo(cliente); setErroInfo(''); setEditInfo(false); }}
                        className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
                        Cancelar
                      </button>
                      <button onClick={salvarInfo} disabled={salvandoInfo || !nomeClienteValido(rascunhoInfo.nome)}
                        className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
                        {salvandoInfo ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <DisplayRow label="Nome completo" value={cliente.nome}/>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <DisplayRow label="Telefone" value={cliente.telefone} placeholder="Não informado"/>
                      <DisplayRow label="Data de nascimento"
                        value={cliente.data_nascimento
                          ? format(new Date(cliente.data_nascimento + 'T00:00:00'), 'dd/MM')
                          : undefined}
                        placeholder="Não informada"/>
                    </div>
                    <DisplayRow label="E-mail" value={cliente.email} placeholder="Não informado"/>
                    <DisplayRow label="Observações internas" value={cliente.observacoes} placeholder="Nenhuma"/>

                    <div className="border-t border-border pt-5">
                      <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                        <MapPin size={12} strokeWidth={2}/> Endereço
                      </p>
                      {temEndereco ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                          <DisplayRow label="Logradouro" value={enderecoAtual.logradouro}/>
                          <DisplayRow label="Número" value={enderecoAtual.numero} placeholder="—"/>
                          <DisplayRow label="Bairro" value={enderecoAtual.bairro}/>
                          {enderecoAtual.complemento && (
                            <DisplayRow label="Complemento" value={enderecoAtual.complemento}/>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-text-4 italic">Não informado</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Aba: Histórico — lista única (shared/clientes-consultas) */}
          {abaAtiva === 'historico' && (
            <HistoricoCliente
              itens={itensHist}
              carregando={loadingHist}
              erro={erroHist}
              onAbrirDetalhe={d => setDetalheAberto(d)}
            />
          )}

          {/* Aba: Anamnese */}
          {abaAtiva === 'anamnese' && pode('anamnese.ver') && (
            <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <p className="font-semibold text-text text-sm">Ficha de anamnese</p>
                  {anamnesePreenchida(anamnese) && (
                    <p className="text-xs text-text-4 mt-0.5">
                      Preenchida em {format(new Date(anamnese.salvo_em!), 'dd/MM/yyyy')}
                    </p>
                  )}
                </div>
                {!editAn && !erroCargaAn && podeEditarAnamnese(pode) && (
                  <button onClick={() => { setRascunho({ ...anamnese }); setEditAn(true); }}
                    className="flex items-center gap-1.5 text-xs text-accent font-semibold hover:underline">
                    <Edit3 size={12}/> Editar
                  </button>
                )}
              </div>

              <div className="p-5 flex flex-col gap-5">
                {erroCargaAn && (
                  <p className="text-red text-sm">Não foi possível carregar a ficha de anamnese: {erroCargaAn}</p>
                )}
                {editAn && !erroCargaAn ? (
                  <>
                    {PERGUNTAS_SIM_NAO.map(({ key, label, placeholder: ph }) => (
                      <div key={key} className="flex flex-col gap-2">
                        <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide">{label}</label>
                        <div className="flex gap-2">
                          {(['sim', 'nao'] as const).map(v => (
                            <button key={v} type="button"
                              onClick={() => setRascunho(r => ({ ...r, [key]: { ...r[key], resposta: v } }))}
                              className={`px-5 py-1.5 rounded-lg text-sm font-medium border transition ${
                                rascunho[key].resposta === v
                                  ? v === 'sim'
                                    ? (ehRestricao(key) ? 'bg-red-soft border-red/30 text-red' : 'bg-primary/10 border-primary/30 text-primary')
                                    : 'bg-green-soft border-green/30 text-green'
                                  : 'bg-bg border-border text-text-3 hover:border-accent'
                              }`}>
                              {v === 'sim' ? 'Sim' : 'Não'}
                            </button>
                          ))}
                        </div>
                        {rascunho[key].resposta === 'sim' && (
                          <textarea value={rascunho[key].detalhe}
                            onChange={e => setRascunho(r => ({ ...r, [key]: { ...r[key], detalhe: e.target.value } }))}
                            rows={2} placeholder={ph}
                            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
                        )}
                      </div>
                    ))}

                    {PERGUNTAS_OPCOES.map(p => (
                      <div key={p.key} className="flex flex-col gap-2">
                        <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide">{p.label}</label>
                        <div className="flex flex-wrap gap-2">
                          {p.opcoes.map(o => (
                            <button key={o.valor} type="button"
                              onClick={() => setRascunho(r => ({ ...r, [p.key]: o.valor }))}
                              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition ${
                                rascunho[p.key] === o.valor ? 'bg-primary-soft border-primary/30 text-primary' : 'bg-bg border-border text-text-3 hover:border-accent'
                              }`}>
                              {o.rotulo}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div>
                      <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Informações adicionais</label>
                      <textarea value={rascunho.info_adicionais}
                        onChange={e => setRascunho(r => ({ ...r, info_adicionais: e.target.value }))}
                        rows={3} placeholder="Outras informações relevantes..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
                    </div>

                    <div className="bg-primary-soft border border-primary/10 rounded-xl p-4">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={rascunho.declaracao_aceita}
                          onChange={e => setRascunho(r => ({ ...r, declaracao_aceita: e.target.checked }))}
                          className="mt-0.5 accent-primary flex-shrink-0 w-4 h-4"/>
                        <span className="text-xs text-text-2 leading-relaxed">
                          {TEXTO_DECLARACAO}
                        </span>
                      </label>
                    </div>

                    {erroAn && <p className="text-red text-sm">{erroAn}</p>}
                    <div className="flex gap-3">
                      <button onClick={() => { setEditAn(false); setErroAn(''); }}
                        className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
                        Cancelar
                      </button>
                      <button disabled={salvandoAn || !empresaId || !rascunho.declaracao_aceita}
                        title={!rascunho.declaracao_aceita ? 'Cliente precisa aceitar a declaração antes de salvar' : undefined}
                        onClick={async () => {
                          if (!empresaId) return;
                          setSalvandoAn(true); setErroAn('');
                          const { data: { user } } = await supabase.auth.getUser();
                          const dados: AnamneseRespostas = { ...rascunho, salvo_em: new Date().toISOString() };
                          const { data, error } = await supabase.from('anamnese_fichas')
                            .upsert({
                              empresa_id: empresaId, cliente_id: id, respostas: dados,
                              profissional_id: user?.id ?? null, updated_at: new Date().toISOString(),
                            }, { onConflict: 'empresa_id,cliente_id' })
                            .select('id');
                          setSalvandoAn(false);
                          if (error) { setErroAn(error.message); return; }
                          if (!data || data.length === 0) { setErroAn('Sem permissão para salvar a ficha.'); return; }
                          setAnamnese(dados);
                          setEditAn(false);
                        }}
                        className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
                        {salvandoAn ? 'Salvando...' : 'Salvar ficha'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {PERGUNTAS_SIM_NAO.map(({ key, label }) => {
                      const item = anamnese[key];
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <p className="text-xs font-semibold text-text-3 uppercase tracking-wide">{label}</p>
                          {item.resposta === '' ? (
                            <p className="text-sm text-text-4 italic">Não respondido</p>
                          ) : (
                            <>
                              <span className={`text-sm font-semibold w-fit px-2.5 py-0.5 rounded-lg ${
                                item.resposta === 'sim'
                                  ? (ehRestricao(key) ? 'bg-red-soft text-red' : 'bg-bg text-text-2 border border-border')
                                  : 'bg-green-soft text-green'
                              }`}>
                                {item.resposta === 'sim' ? 'Sim' : 'Não'}
                              </span>
                              {item.resposta === 'sim' && item.detalhe && (
                                <p className="text-sm text-text-2 leading-relaxed mt-0.5">{item.detalhe}</p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}

                    {PERGUNTAS_OPCOES.map(p => {
                      const rotulo = p.opcoes.find(o => o.valor === anamnese[p.key])?.rotulo;
                      return (
                        <div key={p.key} className="flex flex-col gap-1">
                          <p className="text-xs font-semibold text-text-3 uppercase tracking-wide">{p.label}</p>
                          {rotulo
                            ? <p className="text-sm text-text-2 font-semibold">{rotulo}</p>
                            : <p className="text-sm text-text-4 italic">Não respondido</p>}
                        </div>
                      );
                    })}

                    {anamnese.info_adicionais && (
                      <div>
                        <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-1">Informações adicionais</p>
                        <p className="text-sm text-text-2 leading-relaxed">{anamnese.info_adicionais}</p>
                      </div>
                    )}

                    <div className={`flex items-start gap-3 rounded-xl p-4 border ${
                      anamnese.declaracao_aceita ? 'bg-green-soft border-green/20' : 'bg-bg border-border'
                    }`}>
                      <ShieldCheck size={16} className={`flex-shrink-0 mt-0.5 ${anamnese.declaracao_aceita ? 'text-green' : 'text-text-4'}`} strokeWidth={2}/>
                      <div>
                        <p className="text-xs leading-relaxed text-text-2">
                          {TEXTO_DECLARACAO}
                        </p>
                        <p className={`text-xs mt-1 font-semibold ${anamnese.declaracao_aceita ? 'text-green' : 'text-text-4'}`}>
                          {anamnese.declaracao_aceita ? '✓ Declaração aceita' : 'Declaração não aceita'}
                        </p>
                      </div>
                    </div>

                    {!anamnesePreenchida(anamnese) && !erroCargaAn && podeEditarAnamnese(pode) && (
                      <button onClick={() => { setRascunho({ ...anamnese }); setEditAn(true); }}
                        className="text-accent text-sm font-semibold hover:underline self-start">
                        + Preencher ficha
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

        </div>{/* fim col esquerda */}

        {/* ── Coluna direita ── */}
        <div className="w-full lg:w-72 lg:flex-shrink-0 flex flex-col gap-4">

          {/* Ações rápidas */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3">Ações rápidas</p>
            <button
              onClick={() => setModalAg(true)}
              className="w-full h-9 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition flex items-center justify-center gap-2">
              <Calendar size={14} strokeWidth={2}/> Novo agendamento
            </button>
          </div>

          {/* Resumo */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3">Informações</p>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs text-text-4 mb-0.5">Cadastrado em</p>
                <p className="text-sm font-medium text-text-2">{format(new Date(cliente.created_at), 'dd/MM/yyyy')}</p>
              </div>
              {cliente.data_nascimento && (
                <div>
                  <p className="text-xs text-text-4 mb-0.5">Nascimento</p>
                  <p className="text-sm font-medium text-text-2">
                    {format(new Date(cliente.data_nascimento + 'T00:00:00'), 'dd/MM')}
                    {idade !== null && <span className="text-text-4 ml-1">({idade} anos)</span>}
                  </p>
                </div>
              )}
              {cliente.telefone && (
                <div>
                  <p className="text-xs text-text-4 mb-0.5">Telefone</p>
                  {contatos
                    ? <a href={contatos.ligar} className="text-sm font-medium text-primary hover:underline">{cliente.telefone}</a>
                    : <p className="text-sm font-medium text-text-2">{cliente.telefone}</p>}
                </div>
              )}
              {cliente.email && (
                <div>
                  <p className="text-xs text-text-4 mb-0.5">E-mail</p>
                  <a href={`mailto:${cliente.email}`} className="text-sm font-medium text-primary hover:underline truncate block">{cliente.email}</a>
                </div>
              )}
              {temEndereco && (
                <div>
                  <p className="text-xs text-text-4 mb-0.5">Endereço</p>
                  <p className="text-sm font-medium text-text-2 leading-snug">
                    {[enderecoAtual.logradouro, enderecoAtual.numero].filter(Boolean).join(', ')}
                    {enderecoAtual.bairro && (
                      <><br/><span className="text-text-3">{enderecoAtual.bairro}</span></>
                    )}
                    {enderecoAtual.complemento && (
                      <><br/><span className="text-text-3">{enderecoAtual.complemento}</span></>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Status anamnese */}
          {pode('anamnese.ver') && (
          <div className={`border rounded-2xl p-4 shadow-sm ${anamnesePreenchida(anamnese) ? 'bg-green-soft border-green/20' : 'bg-amber-soft border-amber/20'}`}>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={14} className={anamnesePreenchida(anamnese) ? 'text-green' : 'text-amber'} strokeWidth={2}/>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: anamnesePreenchida(anamnese) ? '#0D7E5F' : '#B45309' }}>
                Anamnese
              </p>
            </div>
            <p className="text-xs" style={{ color: anamnesePreenchida(anamnese) ? '#065F46' : '#92400E' }}>
              {anamnesePreenchida(anamnese)
                ? `Preenchida em ${format(new Date(anamnese.salvo_em!), 'dd/MM/yyyy')}`
                : 'Ficha ainda não preenchida'}
            </p>
            {restricoesAnamnese(anamnese).length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5">
                {restricoesAnamnese(anamnese).map(r => (
                  <li key={r} className="text-xs font-semibold text-red">⚠ {r}</li>
                ))}
              </ul>
            )}
            {!anamnesePreenchida(anamnese) && !erroCargaAn && podeEditarAnamnese(pode) && (
              <button onClick={() => { setAbaAtiva('anamnese'); setRascunho({ ...anamnese }); setEditAn(true); }}
                className="text-xs font-semibold text-amber mt-2 hover:underline">
                Preencher agora →
              </button>
            )}
          </div>
          )}

        </div>{/* fim col direita */}

      </div>{/* fim flex */}

      {/* Modal novo agendamento */}
      {modalAg && empresaId && cliente && (
        <NovoAgModal
          empresaId={empresaId}
          clienteId={cliente.id}
          clienteNome={cliente.nome}
          onClose={() => setModalAg(false)}
          onSalvo={() => {
            setModalAg(false);
            // Recarrega histórico e KPIs (o agendamento novo entra na lista)
            void carregarHistorico(cliente.empresa_id);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmArquivar}
        title="Arquivar cliente"
        message={`"${cliente?.nome}" será arquivada e não aparecerá nas listas. O histórico é mantido.`}
        confirmLabel="Arquivar"
        variant="danger"
        loading={arquivando}
        onConfirm={confirmarArquivar}
        onCancel={() => setConfirmArquivar(false)}
      />

      <ConfirmDialog
        open={confirmExcluir}
        title="Excluir permanentemente"
        message={`"${cliente?.nome}" será excluída para sempre — essa ação não pode ser desfeita.`}
        confirmLabel="Excluir para sempre"
        variant="danger"
        loading={excluindo}
        onConfirm={confirmarExcluir}
        onCancel={() => setConfirmExcluir(false)}
      />

      {detalheAberto && (
        <DetalheAtendimentoModal
          agendamentoId={detalheAberto.agendamentoId}
          comandaId={detalheAberto.comandaId}
          tituloLinha={detalheAberto.titulo}
          onClose={() => setDetalheAberto(null)}
        />
      )}

      {/* Modal de escolha: arquivar ou excluir */}
      {modalRemover && (
        <div className="bm-modal fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setModalRemover(false)} />
          <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm border border-border">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="font-serif text-lg text-text">Remover cliente</h3>
              <button onClick={() => setModalRemover(false)}
                className="w-7 h-7 rounded-lg hover:bg-bg flex items-center justify-center text-text-4 transition">
                <X size={15}/>
              </button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <p className="text-sm text-text-3">O que você deseja fazer com "{cliente?.nome}"?</p>
              {remover.arquivar && (
              <button onClick={() => { setModalRemover(false); setConfirmArquivar(true); }}
                className="flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-bg transition text-left">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-amber-soft)' }}>
                  <Archive size={16} style={{ color: 'var(--color-amber)' }}/>
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">Arquivar</p>
                  <p className="text-xs text-text-4">Some das listas, mas o histórico é mantido</p>
                </div>
              </button>
              )}
              {remover.excluir && (
              <button onClick={pedirExclusao}
                className="flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-rose-soft transition text-left">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-rose-soft)' }}>
                  <Trash2 size={16} style={{ color: 'var(--color-rose)' }}/>
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">Excluir permanentemente</p>
                  <p className="text-xs text-text-4">Apaga para sempre — só é possível sem histórico</p>
                </div>
              </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast de erro ao tentar excluir */}
      {erroExcluir && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-sm bg-rose text-white text-sm px-5 py-3 rounded-2xl shadow-lg flex items-start gap-2">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5"/>
          <p className="flex-1">{erroExcluir}</p>
          <button onClick={() => setErroExcluir('')} className="flex-shrink-0"><X size={14}/></button>
        </div>
      )}
    </div>
  );
}
