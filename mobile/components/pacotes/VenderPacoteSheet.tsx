/**
 * @file VenderPacoteSheet.tsx
 * Venda única de pacote no app (tela Pacotes e, na Task 7, Agenda). Mesma regra do web:
 * - cliente (pré-selecionada ou escolhida na lista paginada), pacote, quantidade, valor e desconto %/R$;
 * - "Cobrar agora": o bloco de pagamento da Venda avulsa (PagamentosEditor: maquininha, bandeira,
 *   parcelas e taxa da configuração de cartões) — grava venda, pacotes e pagamentos numa transação;
 * - "Cobrar na comanda": grava o pacote "a cobrar" (nada entra no faturamento até fechar a comanda).
 * Grava por `venderPacote` (função `vender_pacote`, migration 096). A chave `vendaId` é gerada uma vez
 * por abertura e reaproveitada na nova tentativa (a repetição não duplica). Depois de "sem resposta" o
 * formulário trava até tentar de novo com a MESMA venda.
 *
 * Sem a 096 (`SemMigration096`): "Cobrar na comanda" fica escondido e "Cobrar agora" usa o caminho
 * antigo (`venderSem096`), gravando também `vendas` e `pagamentos` (o pacote nunca fica sem receita).
 * Contrato: docs/superpowers/notes/2026-10-23-contrato-pacotes.md.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, AlertCircle } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { usePermissoes } from '@/lib/permissions';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import PagamentosEditor, { type SplitEditavel } from '@/components/comanda/PagamentosEditor';
import {
  calcularDesconto, resumoComanda, parseValorBR, montarPagamentos, ratearDescontoCentavos, type ModoDesconto, type SplitPagamento,
} from '@shared/comanda-fechamento';
import { configIndisponivel, AVISO_CARTOES_SEM_TAXA, type ConfigCartoes } from '@shared/taxas-cartao';
import { carregarConfigCartoes } from '@shared/taxas-cartao-consultas';
import { venderPacote, ErroPacote, SemMigration096 } from '@shared/pacotes-venda';
import { dataValidade, rotuloValidade } from '@shared/pacotes';
import type { PacoteCatalogo } from '@shared/pacotes-consultas';
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
import { mensagemErroBanco } from '@shared/erros';
import { formatarMoeda } from '@shared/moeda';
import { hojeBRT, rotuloDataBR } from '@shared/periodos';
import { novoUuid } from '@shared/uuid';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

export type CobrancaPacote = 'agora' | 'comanda';

/** Resultado da venda. `pacoteClienteId` = o 1º pacote vendido (a Agenda vincula ao atendimento). */
export type ResultadoVendaPacote = {
  vendaId: string; pacoteClienteId: string; cobranca: CobrancaPacote; quantidade: number; clienteId: string;
};

export type VenderPacoteSheetProps = {
  visible: boolean;
  empresaId: string;
  /** Catálogo; só os pacotes ativos são oferecidos. */
  pacotes: PacoteCatalogo[];
  /** Pacote já escolhido (ex.: "Vender" no card do catálogo). */
  pacoteId?: string | null;
  /** Cliente já escolhida (ex.: na Agenda): a escolha fica travada nela. */
  cliente?: { id: string; nome: string } | null;
  /** Cobrança marcada ao abrir: Pacotes abre em "agora", a Agenda em "comanda". */
  padraoCobranca: 'agora' | 'comanda';
  onClose: () => void;
  onVendido: (r: ResultadoVendaPacote) => void;
};

type Cliente = { id: string; nome: string; telefone: string | null };

/** Mensagem do erro de qualquer etapa. */
const msgErro = (e: unknown, acao: string) =>
  e instanceof Error && e.message && !(e as { code?: string }).code ? e.message : mensagemErroBanco(e as { code?: string; message?: string }, acao);

/**
 * Sem a 096: caminho antigo, só para "Cobrar agora". Grava `vendas` (id = a chave, sem RETURNING:
 * a policy de SELECT de vendas não vale para todo papel), os `pacote_clientes` (valor_pago líquido
 * rateado em centavos) e os `pagamentos` (montarPagamentos). Falha nos pacotes tenta desfazer a venda;
 * falha nos pagamentos lança avisando que a venda ficou sem pagamento. Devolve o id do 1º pacote.
 */
async function venderSem096(d: {
  vendaId: string; empresaId: string; clienteId: string; pacote: PacoteCatalogo; quantidade: number;
  valorUnit: number; desconto: number; splits: SplitPagamento[];
  config: ConfigCartoes; total: number;
}): Promise<{ pacoteClienteId: string; aviso: string | null }> {
  const unitCent = Math.round(d.valorUnit * 100);
  const cotas = ratearDescontoCentavos(Array.from({ length: d.quantidade }, () => unitCent), Math.round(d.desconto * 100));
  const hoje = hojeBRT();
  const { error: eVenda } = await supabase.from('vendas').insert({
    id: d.vendaId, empresa_id: d.empresaId, cliente_id: d.clienteId,
    valor_total: Math.round(unitCent * d.quantidade) / 100, desconto: Math.round(d.desconto * 100) / 100,
    observacao: 'Pacote',
  });
  if (eVenda) throw new ErroPacote(mensagemErroBanco(eVenda, 'registrar a venda do pacote'));

  const linhas = cotas.map(cota => ({
    empresa_id: d.empresaId, pacote_id: d.pacote.id, cliente_id: d.clienteId,
    data_inicio: hoje, data_validade: dataValidade(d.pacote.validade_dias, hoje),
    valor_pago: (unitCent - cota) / 100, status: 'ativo',
  }));
  const { data: criados, error: ePac } = await supabase.from('pacote_clientes').insert(linhas).select('id');
  if (ePac || !criados || criados.length !== linhas.length) {
    const msg = mensagemErroBanco(ePac ?? { code: '42501' }, 'registrar o pacote vendido');
    const { data: apagadas } = await supabase.from('vendas').delete().eq('id', d.vendaId).select('id');
    if ((apagadas?.length ?? 0) > 0) throw new ErroPacote(`${msg} Nada foi registrado; tente de novo.`);
    throw new ErroPacote(`${msg} A venda ficou registrada sem o pacote; confira em Financeiro antes de vender de novo.`);
  }

  const pagamentos = montarPagamentos(d.splits, {
    empresaId: d.empresaId, vendaId: d.vendaId, config: d.config, total: d.total,
  });
  const { error: ePag } = await supabase.from('pagamentos').insert(pagamentos);
  const aviso = ePag
    ? `O pacote foi vendido, mas o pagamento não foi registrado: ${mensagemErroBanco(ePag, 'registrar os pagamentos')} Confira em Financeiro.`
    : null;
  return { pacoteClienteId: (criados[0] as { id: string }).id, aviso };
}

/** Modal de venda de pacote. Monta o conteúdo só quando aberto: cada abertura começa do zero (e com chave nova). */
export function VenderPacoteSheet(props: VenderPacoteSheetProps) {
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      {props.visible ? <ConteudoVenda {...props} /> : null}
    </Modal>
  );
}

function ConteudoVenda({ empresaId, pacotes, pacoteId, cliente, padraoCobranca, onClose, onVendido }: VenderPacoteSheetProps) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { pode } = usePermissoes();
  // Desconto e Cortesia: mesma regra da comanda e da venda avulsa (comanda.desconto).
  const podeDesconto = pode('comanda.desconto');

  // Chave da venda: uma por abertura, reaproveitada em toda nova tentativa (a repetição não duplica).
  const [vendaId] = useState(() => novoUuid());

  const ativos = useMemo(() => pacotes.filter(p => p.ativo), [pacotes]);
  const [pacoteSel, setPacoteSel] = useState<string>(pacoteId ?? (ativos.length === 1 ? ativos[0].id : ''));
  const pacote = ativos.find(p => p.id === pacoteSel) ?? null;

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [erroClientes, setErroClientes] = useState<string | null>(null);
  const [clienteId, setClienteId] = useState(cliente?.id ?? '');
  const [buscaCliente, setBuscaCliente] = useState('');

  const [quantidade, setQuantidade] = useState(1);
  const [valorTxt, setValorTxt] = useState('');
  const [descontoTxt, setDescontoTxt] = useState('');
  const [descontoModo, setDescontoModo] = useState<ModoDesconto>('percentual');
  const [cobranca, setCobranca] = useState<CobrancaPacote>(padraoCobranca);
  const [splits, setSplits] = useState<SplitEditavel[]>([]);
  const [config, setConfig] = useState<ConfigCartoes>(() => configIndisponivel());
  /** A 096 existe? null = conferindo. Sem ela "Cobrar na comanda" fica escondido. */
  const [tem096, setTem096] = useState<boolean | null>(null);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  /** A última tentativa ficou sem resposta: o formulário trava e só a MESMA venda é repetida. */
  const [semResposta, setSemResposta] = useState(false);
  const gravandoRef = useRef(false);

  // Valor unitário começa no preço do pacote escolhido
  useEffect(() => { if (pacote) setValorTxt(pacote.preco.toFixed(2).replace('.', ',')); }, [pacote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let vivo = true;
    // Confere a 096 só lendo a coluna nova (nada é gravado).
    supabase.from('pacote_clientes').select('cobranca').limit(0).then(({ error }) => {
      if (!vivo) return;
      const existe = !error;
      setTem096(existe);
      if (!existe) setCobranca('agora');
    });
    carregarConfigCartoes(supabase, empresaId).then(
      c => { if (vivo) setConfig(c); },
      (e: unknown) => {
        if (!vivo) return;
        Alert.alert('Cartões', `${mensagemErroBanco(e as { code?: string; message?: string }, 'carregar as taxas dos cartões')} ${AVISO_CARTOES_SEM_TAXA}`);
      },
    );
    if (!cliente) {
      buscarTodasOuLancar<Cliente>((de, ate) => supabase.from('clientes')
        .select('id, nome, telefone').eq('empresa_id', empresaId).eq('ativo', true)
        .order('nome').order('id').range(de, ate)).then(
        lista => { if (vivo) setClientes(lista); },
        (e: unknown) => { if (vivo) setErroClientes(mensagemErroBanco(e as { code?: string; message?: string }, 'carregar as clientes')); },
      );
    }
    return () => { vivo = false; };
  }, [empresaId, cliente]);

  const clienteSel = cliente ?? clientes.find(c => c.id === clienteId) ?? null;
  const clientesFiltrados = useMemo(() => {
    const q = buscaCliente.trim().toLowerCase();
    if (!q) return [];
    const dig = q.replace(/\D/g, '');
    return clientes.filter(c => c.nome.toLowerCase().includes(q) || (!!dig && (c.telefone ?? '').replace(/\D/g, '').includes(dig))).slice(0, 6);
  }, [clientes, buscaCliente]);

  // Totais (mesma regra da comanda e da venda avulsa)
  const valorUnit = parseValorBR(valorTxt);
  const subtotal = Math.round(valorUnit * quantidade * 100) / 100;
  const { valor: desconto, erro: erroDesconto } = calcularDesconto(subtotal, podeDesconto ? parseValorBR(descontoTxt) : 0, descontoModo);
  const splitsNum = splits.map(s => ({ ...s, valor: parseValorBR(s.valor) }));
  const resumo = resumoComanda({
    subtotal, desconto, erroDesconto, descontoReserva: 0, splits: cobranca === 'agora' ? splitsNum : [],
  });
  const pronto = !!pacote && !!clienteSel && valorUnit >= 0 && !erroDesconto && (cobranca === 'comanda' || resumo.podeFechar);

  function motivoBloqueio(): string | null {
    if (!pacote) return 'Escolha o pacote.';
    if (!clienteSel) return 'Para vender pacote, escolha uma cliente cadastrada.';
    if (erroDesconto) return erroDesconto;
    if (cobranca === 'agora' && !resumo.podeFechar) return resumo.motivo ?? 'O pagamento não cobre o total da venda.';
    return null;
  }

  async function confirmar() {
    if (gravandoRef.current) return;
    const motivo = motivoBloqueio();
    if (motivo || !pacote || !clienteSel) { setErro(motivo ?? ''); return; }
    gravandoRef.current = true;
    setSalvando(true); setErro('');
    const pagamentos = cobranca === 'agora'
      ? montarPagamentos(splitsNum, { empresaId, config, total: resumo.total })
      : [];
    const base = { vendaId, empresaId, clienteId: clienteSel.id, pacoteId: pacote.id, quantidade, valorUnit, desconto, cobranca };
    try {
      let pacoteClienteId = vendaId; // na 096 o 1º pacote_clientes recebe id = venda_id
      let aviso: string | null = null;
      try {
        await venderPacote(supabase, { ...base, pagamentos });
      } catch (e) {
        if (!(e instanceof SemMigration096)) throw e;
        setTem096(false);
        if (cobranca === 'comanda') {
          setCobranca('agora');
          throw new ErroPacote('"Cobrar na comanda" ainda não está disponível. Use "Cobrar agora".');
        }
        const r = await venderSem096({
          vendaId, empresaId, clienteId: clienteSel.id, pacote, quantidade, valorUnit, desconto,
          splits: splitsNum, config, total: resumo.total,
        });
        pacoteClienteId = r.pacoteClienteId;
        aviso = r.aviso;
      }
      invalidarFinanceiro(qc);
      qc.invalidateQueries({ queryKey: ['pacotes-vendidos'] });
      if (aviso) Alert.alert('Venda do pacote', aviso);
      onVendido({ vendaId, pacoteClienteId, cobranca, quantidade, clienteId: clienteSel.id });
    } catch (e) {
      if (e instanceof ErroPacote && e.semResposta) {
        setSemResposta(true);
        setErro(`${e.message} Toque em "Tentar de novo": a mesma venda não é registrada duas vezes.`);
      } else {
        setErro(msgErro(e, 'vender o pacote'));
      }
    } finally {
      gravandoRef.current = false;
      setSalvando(false);
    }
  }

  const travado = semResposta || salvando;
  const hoje = hojeBRT();
  const validadePrevia = pacote ? dataValidade(pacote.validade_dias, hoje) : null;

  const chip = (ativo: boolean) => ({
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
    borderColor: ativo ? C.primary : C.border, backgroundColor: ativo ? C.primary : C.surface,
  });
  const chipTxt = (ativo: boolean) => ({ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text2 });
  const rotulo = { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase' as const, letterSpacing: 1.2, marginBottom: 8 };
  const input = {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, height: 42,
    fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text,
  } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '94%', paddingBottom: insets.bottom + 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: C.border }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 19, color: C.text }}>Vender pacote</Text>
            {pacote && <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, marginTop: 2 }}>{pacote.nome} · {rotuloValidade(pacote.validade_dias)}</Text>}
          </View>
          <TouchableOpacity onPress={onClose} disabled={salvando} accessibilityLabel="Fechar" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} color={C.text3} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View pointerEvents={travado ? 'none' : 'auto'} style={{ gap: 16, opacity: semResposta ? 0.6 : 1 }}>
            {/* Pacote */}
            {!pacoteId && (
              <View>
                <Text style={rotulo}>Pacote</Text>
                {ativos.length === 0 ? (
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4 }}>Nenhum pacote ativo no catálogo.</Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {ativos.map(p => (
                      <TouchableOpacity key={p.id} onPress={() => setPacoteSel(p.id)} style={chip(pacoteSel === p.id)}>
                        <Text style={chipTxt(pacoteSel === p.id)}>{p.nome} · {formatarMoeda(p.preco)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Cliente */}
            <View>
              <Text style={rotulo}>Cliente</Text>
              {clienteSel ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{clienteSel.nome}</Text>
                  {!cliente && (
                    <TouchableOpacity onPress={() => setClienteId('')}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3 }}>Trocar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : erroClientes ? (
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red }}>{erroClientes}</Text>
              ) : (
                <>
                  <TextInput value={buscaCliente} onChangeText={setBuscaCliente} placeholder="Buscar cliente por nome ou telefone" placeholderTextColor={C.text4} style={input} />
                  {clientesFiltrados.map(c => (
                    <TouchableOpacity key={c.id} onPress={() => { setClienteId(c.id); setBuscaCliente(''); }}
                      style={{ marginTop: 4, padding: 10, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>{c.nome}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>

            {/* Quantidade e valor */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={rotulo}>Quantidade</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 42 }}>
                  <TouchableOpacity onPress={() => setQuantidade(q => Math.max(1, q - 1))} accessibilityLabel="Diminuir quantidade"
                    style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.primary }}>−</Text>
                  </TouchableOpacity>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.text, minWidth: 20, textAlign: 'center' }}>{quantidade}</Text>
                  <TouchableOpacity onPress={() => setQuantidade(q => Math.min(100, q + 1))} accessibilityLabel="Aumentar quantidade"
                    style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.primary }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={rotulo}>Valor (cada)</Text>
                <TextInput value={valorTxt} onChangeText={setValorTxt} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={C.text4} accessibilityLabel="Valor do pacote" style={input} />
              </View>
            </View>

            {/* Desconto */}
            {podeDesconto && (
              <View>
                <Text style={rotulo}>Desconto</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['percentual', 'valor'] as ModoDesconto[]).map(m => (
                    <TouchableOpacity key={m} onPress={() => setDescontoModo(m)} style={chip(descontoModo === m)}>
                      <Text style={chipTxt(descontoModo === m)}>{m === 'percentual' ? '%' : 'R$'}</Text>
                    </TouchableOpacity>
                  ))}
                  <TextInput value={descontoTxt} onChangeText={setDescontoTxt} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.text4} accessibilityLabel="Desconto" style={{ ...input, flex: 1 }} />
                </View>
              </View>
            )}

            {/* Cobrança */}
            <View>
              <Text style={rotulo}>Cobrança</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => setCobranca('agora')} style={{ ...chip(cobranca === 'agora'), flex: 1, alignItems: 'center' }}>
                  <Text style={chipTxt(cobranca === 'agora')}>Cobrar agora</Text>
                </TouchableOpacity>
                {tem096 && (
                  <TouchableOpacity onPress={() => setCobranca('comanda')} style={{ ...chip(cobranca === 'comanda'), flex: 1, alignItems: 'center' }}>
                    <Text style={chipTxt(cobranca === 'comanda')}>Cobrar na comanda</Text>
                  </TouchableOpacity>
                )}
                {tem096 === null && <ActivityIndicator color={C.primary} />}
              </View>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, marginTop: 6 }}>
                {cobranca === 'agora'
                  ? 'O pagamento é lançado agora e entra no faturamento de hoje.'
                  : 'O pacote fica "A cobrar" e entra na próxima comanda da cliente. A cliente já pode usar as sessões.'}
              </Text>
            </View>

            {cobranca === 'agora' && (
              <PagamentosEditor splits={splits} setSplits={setSplits} config={config} resumo={resumo}
                permitirCortesia={podeDesconto} desabilitado={travado} />
            )}
          </View>

          {/* Resumo */}
          <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, gap: 4 }}>
            <Linha rotulo="Subtotal" valor={formatarMoeda(subtotal)} />
            {desconto > 0 && <Linha rotulo="Desconto" valor={`− ${formatarMoeda(desconto)}`} />}
            <Linha rotulo="Total" valor={formatarMoeda(resumo.total)} forte />
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, marginTop: 4 }}>
              {validadePrevia ? `Válido até ${rotuloDataBR(validadePrevia)}` : 'Sem validade — vale enquanto houver sessões'}
            </Text>
          </View>

          {erro ? (
            <View style={{ flexDirection: 'row', gap: 8, backgroundColor: C.redSoft, borderRadius: 12, padding: 12 }}>
              <AlertCircle size={14} color={C.red} />
              <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red }}>{erro}</Text>
            </View>
          ) : null}

          <TouchableOpacity onPress={confirmar} disabled={salvando || !pronto}
            style={{ height: 50, borderRadius: 14, backgroundColor: pronto ? C.primary : C.border, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.7 : 1 }}>
            {salvando ? <ActivityIndicator color="#fff" /> : (
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: pronto ? '#fff' : C.text3 }}>
                {semResposta ? 'Tentar de novo' : cobranca === 'agora' ? `Vender ${formatarMoeda(resumo.total)}` : 'Vender e cobrar na comanda'}
              </Text>
            )}
          </TouchableOpacity>
          {!pronto && !salvando && motivoBloqueio() ? (
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, textAlign: 'center' }}>{motivoBloqueio()}</Text>
          ) : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: forte ? 'PlusJakartaSans_700Bold' : 'PlusJakartaSans_500Medium', fontSize: forte ? 15 : 13, color: forte ? C.text : C.text2 }}>{rotulo}</Text>
      <Text style={{ fontFamily: forte ? 'PlusJakartaSans_700Bold' : 'PlusJakartaSans_600SemiBold', fontSize: forte ? 15 : 13, color: C.text }}>{valor}</Text>
    </View>
  );
}
