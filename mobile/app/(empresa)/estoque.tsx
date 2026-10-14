/**
 * Estoque do app — mesma tela do web (`web/app/(app)/estoque/page.tsx`): 4 cartões, abas
 * Produtos | Movimentações, filtros, histórico por produto, movimentação manual pela função
 * de shared (erro real e saldo novo), movimentações do mês em Brasília com filtros, cartões e
 * exportação, e o ajuste de unidades de medida (`UnidadesEstoqueModal`, só com a migration 088).
 */
import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, Modal,
  TextInput, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import {
  Plus, Package, AlertTriangle, CheckCircle2,
  ChevronRight, ChevronLeft, X, ArrowDownCircle, ArrowUpCircle,
  Search, DollarSign, Wallet, List, CalendarDays, RefreshCw, Ruler,
} from 'lucide-react-native';
import {
  useFonts,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useEstoque, useMovimentosMes, type Produto } from '@/hooks/useEstoque';
import SuccessCheck from '@/components/SuccessCheck';
import { BotaoExportar } from '@/components/BotaoExportar';
import { SmoothTabs } from '@/components/SmoothTabs';
import { SecretText } from '@/components/Secret';
import { UnidadesEstoqueModal } from '@/components/UnidadesEstoqueModal';
import { usePermissoes } from '@/lib/permissions';
import { definicaoEstoqueProdutos, definicaoEstoqueMovimentacoes } from '@shared/exportacao/estoque';
import {
  CATEGORIAS_PRODUTO, rotuloCategoriaProduto, rotuloStatusEstoque, statusEstoque,
  resumoMovimentos, parseQuantidadeBR, formatarQuantidadeBR, unidadePedeQtdPorUnidade,
} from '@shared/estoque';
import type { MovimentoEstoque } from '@shared/estoque-consultas';
import { formatarMoeda } from '@shared/moeda';
import { chaveMesBRT, somarMeses, rotuloMesAno, rotuloDataHoraBRT } from '@shared/periodos';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: '#F3EEFD',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  red: '#C0392B', redSoft: '#FEF2F2',
  rose: '#C2185B', roseSoft: '#FDEEF4',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

type Aba = 'produtos' | 'movimentacoes';
type FiltroTipoProduto = 'todos' | 'material' | 'venda';
type FiltroSituacao = 'todos' | 'alertas';
type FiltroTipoMov = 'todos' | 'entrada' | 'saida';

const rotuloSecao = {
  fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3,
  letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 8,
};

// ── Banner de erro ───────────────────────────────────────────

function BannerErro({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginHorizontal: 24, marginBottom: 16, padding: 14,
      backgroundColor: C.redSoft, borderRadius: 16, borderWidth: 1, borderColor: '#F5C6C0',
    }}>
      <AlertTriangle size={18} color={C.red} strokeWidth={2} />
      <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.red }}>{mensagem}</Text>
      <TouchableOpacity onPress={onTentar} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.red }}>Tentar de novo</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Cartão de KPI ────────────────────────────────────────────

function Cartao({ label, value, sub, Icon, cor, bg }: {
  label: string; value: string; sub: string;
  Icon: typeof Package; cor: string; bg: string;
}) {
  return (
    <View style={{
      width: '48.5%', backgroundColor: C.surface, borderRadius: 18, padding: 14,
      borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 10,
    }}>
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={15} color={cor} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
          style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: C.text, lineHeight: 22 }}>
          {value}
        </SecretText>
        <Text numberOfLines={2} style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10.5, color: C.text3, marginTop: 2 }}>
          {label}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9.5, color: C.text4, marginTop: 1 }}>
          {sub}
        </Text>
      </View>
    </View>
  );
}

// ── Modal de movimentação ────────────────────────────────────

interface ModalMovProps {
  produto: Produto | null;
  onClose: () => void;
  onConfirmar: (tipo: 'entrada' | 'saida', quantidade: number, motivo: string) => Promise<{ novoSaldo: number }>;
}

function ModalMovimentacao({ produto, onClose, onConfirmar }: ModalMovProps) {
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('entrada');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);
  const [sucesso, setSucesso] = useState<{ tipo: 'entrada' | 'saida'; qtd: number; novoSaldo: number } | null>(null);
  const gravandoRef = useRef(false);

  if (!produto) return null;

  const qtdNum = parseQuantidadeBR(quantidade);
  const novoEstoque = tipo === 'entrada' ? produto.estoque_atual + qtdNum : produto.estoque_atual - qtdNum;

  function fechar() {
    if (gravandoRef.current) return;
    onClose();
  }

  async function handleConfirmar() {
    if (gravandoRef.current) return;
    if (qtdNum <= 0) {
      Alert.alert('Quantidade inválida', 'Informe uma quantidade válida.');
      return;
    }
    if (tipo === 'saida' && qtdNum > produto!.estoque_atual) {
      Alert.alert('Não foi possível movimentar',
        `Estoque insuficiente. Disponível: ${formatarQuantidadeBR(produto!.estoque_atual)} ${produto!.unidade}`);
      return;
    }
    gravandoRef.current = true;
    setLoading(true);
    try {
      const r = await onConfirmar(tipo, qtdNum, motivo);
      setSucesso({ tipo, qtd: qtdNum, novoSaldo: r.novoSaldo });
      setTimeout(onClose, 1300);
    } catch (e) {
      // O modal continua aberto: a pessoa corrige e tenta de novo.
      gravandoRef.current = false;
      Alert.alert('Não foi possível movimentar', e instanceof Error ? e.message : 'Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  if (sucesso) {
    const isEntrada = sucesso.tipo === 'entrada';
    const cor = isEntrada ? C.green : C.red;
    const bgCor = isEntrada ? C.greenSoft : C.redSoft;
    return (
      <Modal visible transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <MotiView
            from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 250 }}
            style={{ backgroundColor: C.surface, borderRadius: 20, padding: 32, alignItems: 'center', gap: 10, width: '100%', maxWidth: 320 }}>
            <SuccessCheck size={64} color={cor} bg={bgCor} />
            <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 17, color: C.text, marginTop: 6 }}>
              {isEntrada ? 'Entrada registrada!' : 'Saída registrada!'}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text2 }} numberOfLines={1}>
              {produto.nome}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, textAlign: 'center' }}>
              {isEntrada ? '+' : '−'}{formatarQuantidadeBR(sucesso.qtd)} {produto.unidade} · Novo estoque: {formatarQuantidadeBR(sucesso.novoSaldo)} {produto.unidade}
            </Text>
          </MotiView>
        </View>
      </Modal>
    );
  }

  const corBotao = tipo === 'entrada' ? C.green : C.red;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={fechar}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={fechar}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
        <View style={{
          backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: 24, paddingBottom: 36,
        }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 20, color: C.text }}>
                Movimentar estoque
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginTop: 2 }}>
                {produto.nome}
              </Text>
            </View>
            <TouchableOpacity onPress={fechar} disabled={loading} style={{ padding: 4 }}>
              <X size={20} color={C.text3} />
            </TouchableOpacity>
          </View>

          {/* Tipo */}
          <Text style={rotuloSecao}>Tipo</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {(['entrada', 'saida'] as const).map((t) => {
              const ativo = tipo === t;
              const isEntrada = t === 'entrada';
              const cor = isEntrada ? C.green : C.red;
              const bgCor = isEntrada ? C.greenSoft : C.redSoft;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTipo(t)}
                  disabled={loading}
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 8, paddingVertical: 12, borderRadius: 14,
                    backgroundColor: ativo ? bgCor : C.bg,
                    borderWidth: 1.5,
                    borderColor: ativo ? cor : C.border,
                  }}
                >
                  {isEntrada
                    ? <ArrowUpCircle size={16} color={ativo ? cor : C.text3} strokeWidth={2} />
                    : <ArrowDownCircle size={16} color={ativo ? cor : C.text3} strokeWidth={2} />
                  }
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: ativo ? cor : C.text3 }}>
                    {isEntrada ? 'Entrada' : 'Saída'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Estoque atual */}
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between',
            backgroundColor: C.bg, borderRadius: 12, padding: 12, marginBottom: 20,
          }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
              Estoque atual
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
              {formatarQuantidadeBR(produto.estoque_atual)} {produto.unidade}
            </Text>
          </View>

          {/* Quantidade */}
          <Text style={rotuloSecao}>Quantidade *</Text>
          <TextInput
            value={quantidade}
            onChangeText={setQuantidade}
            keyboardType="decimal-pad"
            placeholder={`Ex: 5 ${produto.unidade}`}
            placeholderTextColor={C.text4}
            editable={!loading}
            style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, padding: 14, marginBottom: 12,
              fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text,
            }}
          />

          {/* Prévia do novo estoque */}
          {qtdNum > 0 && (
            <View style={{
              flexDirection: 'row', justifyContent: 'space-between', borderRadius: 12, padding: 12, marginBottom: 16,
              backgroundColor: novoEstoque < 0 ? C.redSoft : tipo === 'entrada' ? C.greenSoft : C.bg,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>Novo estoque</Text>
              <Text style={{
                fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13,
                color: novoEstoque < 0 ? C.red : tipo === 'entrada' ? C.green : C.text,
              }}>
                {formatarQuantidadeBR(novoEstoque)} {produto.unidade}
              </Text>
            </View>
          )}

          {/* Motivo */}
          <Text style={rotuloSecao}>Motivo (opcional)</Text>
          <TextInput
            value={motivo}
            onChangeText={setMotivo}
            placeholder="Ex: compra fornecedor / uso em atendimento"
            placeholderTextColor={C.text4}
            editable={!loading}
            style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, padding: 14, marginBottom: 24,
              fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text,
            }}
          />

          {/* Confirmar */}
          <TouchableOpacity
            onPress={handleConfirmar}
            disabled={loading || qtdNum <= 0}
            style={{
              backgroundColor: corBotao, borderRadius: 14,
              padding: 16, alignItems: 'center', opacity: loading || qtdNum <= 0 ? 0.5 : 1,
            }}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                  {tipo === 'entrada' ? 'Registrar entrada' : 'Registrar saída'}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Escolher produto (filtro das movimentações) ──────────────

function ModalEscolherProduto({ produtos, valor, onEscolher, onClose }: {
  produtos: Produto[]; valor: string; onEscolher: (id: string) => void; onClose: () => void;
}) {
  const [busca, setBusca] = useState('');
  const q = busca.trim().toLowerCase();
  const lista = q ? produtos.filter(p => p.nome.toLowerCase().includes(q)) : produtos;
  const opcoes = [{ id: '', nome: 'Todos os produtos', unidade: '' }, ...lista];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, maxHeight: '75%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 20, color: C.text }}>Filtrar por produto</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <X size={20} color={C.text3} />
            </TouchableOpacity>
          </View>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
            backgroundColor: C.bg, borderRadius: 12, borderWidth: 1, borderColor: C.border,
            paddingHorizontal: 12, paddingVertical: 10,
          }}>
            <Search size={15} color={C.text3} strokeWidth={2} />
            <TextInput
              value={busca}
              onChangeText={setBusca}
              placeholder="Filtrar por produto..."
              placeholderTextColor={C.text4}
              style={{ flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text }}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {opcoes.map(p => {
              const ativo = p.id === valor;
              return (
                <TouchableOpacity
                  key={p.id || '__todos__'}
                  onPress={() => onEscolher(p.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10,
                    backgroundColor: ativo ? C.primarySoft : 'transparent',
                  }}
                >
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: ativo ? 'PlusJakartaSans_700Bold' : 'PlusJakartaSans_500Medium', fontSize: 13, color: ativo ? C.primary : C.text }}>
                    {p.nome}
                  </Text>
                  {!!p.unidade && (
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, marginLeft: 8 }}>{p.unidade}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Card de produto ──────────────────────────────────────────

function ProdutoRow({ produto, onMovimentar, onHistorico, onEdit }: {
  produto: Produto; onMovimentar: () => void; onHistorico: () => void; onEdit: () => void;
}) {
  const pct = produto.estoque_minimo > 0
    ? Math.max(0, Math.min(produto.estoque_atual / produto.estoque_minimo, 1))
    : 1;

  const statusColor =
    produto.status === 'critico' ? C.red :
    produto.status === 'baixo'   ? C.amber : C.green;

  const statusBg =
    produto.status === 'critico' ? C.redSoft :
    produto.status === 'baixo'   ? C.amberSoft : C.greenSoft;

  const mostraDentro = unidadePedeQtdPorUnidade(produto.unidade) && produto.qtd_por_unidade > 1;

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: C.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={onMovimentar}
          activeOpacity={0.7}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingTop: 14, paddingBottom: 8, paddingLeft: 16, paddingRight: 8,
          }}
        >
          {/* Ícone status */}
          <View style={{
            width: 38, height: 38, borderRadius: 12,
            backgroundColor: statusBg,
            alignItems: 'center', justifyContent: 'center',
          }}>
            {produto.status === 'ok'
              ? <CheckCircle2 size={17} color={statusColor} strokeWidth={2} />
              : <AlertTriangle size={17} color={statusColor} strokeWidth={2} />
            }
          </View>

          {/* Info */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 2 }}>
              {produto.nome}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                {rotuloCategoriaProduto(produto.categoria)}
              </Text>
              {produto.tipo === 'venda' && (
                <Text style={{
                  fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: C.green,
                  backgroundColor: C.greenSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, overflow: 'hidden',
                }}>
                  PDV
                </Text>
              )}
            </View>
            {/* Barra de progresso */}
            <View style={{ height: 3, backgroundColor: C.border, borderRadius: 2 }}>
              <View style={{ width: `${pct * 100}%`, height: 3, backgroundColor: statusColor, borderRadius: 2 }} />
            </View>
          </View>

          {/* Saldo */}
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: produto.status === 'critico' ? C.red : produto.status === 'baixo' ? C.amber : C.text }}>
              {formatarQuantidadeBR(produto.estoque_atual)}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
              {produto.unidade}
            </Text>
            {mostraDentro && (
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4 }}>
                ({Math.round(produto.estoque_atual * produto.qtd_por_unidade)} un)
              </Text>
            )}
          </View>
        </TouchableOpacity>

        {/* Editar / ver produto (inclui excluir) */}
        <TouchableOpacity
          onPress={onEdit}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ paddingHorizontal: 12, paddingVertical: 14 }}
        >
          <ChevronRight size={16} color={C.text4} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* Ações */}
      <View style={{ flexDirection: 'row', gap: 8, paddingLeft: 66, paddingRight: 16, paddingBottom: 12 }}>
        <TouchableOpacity onPress={onHistorico} style={estiloAcao}>
          <CalendarDays size={12} color={C.text3} strokeWidth={2} />
          <Text style={textoAcao}>Histórico</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onMovimentar} style={estiloAcao}>
          <RefreshCw size={12} color={C.text3} strokeWidth={2} />
          <Text style={textoAcao}>Movimentar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const estiloAcao = {
  flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, borderWidth: 1, borderColor: C.border,
};
const textoAcao = { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3 };

// ── Linha de movimentação ────────────────────────────────────

function MovimentoRow({ m }: { m: MovimentoEstoque }) {
  const isEntrada = m.tipo === 'entrada';
  const isAjuste = m.tipo === 'ajuste';
  const cor = isEntrada ? C.green : isAjuste ? C.primary : C.red;
  const bg = isEntrada ? C.greenSoft : isAjuste ? C.primarySoft : C.redSoft;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
          {m.produto?.nome ?? '—'}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4, marginTop: 2 }}>
          {rotuloDataHoraBRT(m.created_at)}
        </Text>
        {m.agendamento_id ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start', backgroundColor: C.primarySoft, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
            <CalendarDays size={10} color={C.primary} strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.primary }}>Via comanda</Text>
          </View>
        ) : (
          <Text numberOfLines={2} style={{ fontFamily: 'PlusJakartaSans_400Regular', fontStyle: 'italic', fontSize: 11, color: C.text4, marginTop: 3 }}>
            {m.motivo || 'Registro manual'}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: cor, backgroundColor: bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' }}>
          {isEntrada ? 'Entrada' : isAjuste ? 'Ajuste' : 'Saída'}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: cor }}>
          {isEntrada ? '+' : isAjuste ? '=' : '−'}{formatarQuantidadeBR(m.quantidade)}
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}> {m.produto?.unidade ?? ''}</Text>
        </Text>
      </View>
    </View>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function EstoqueScreen() {
  const insets = useSafeAreaInsets();
  const { pode } = usePermissoes();

  const [aba, setAba] = useState<Aba>('produtos');

  // Produtos
  const [busca, setBusca] = useState('');
  const [filtroPorTipo, setFiltroPorTipo] = useState<FiltroTipoProduto>('todos');
  const [filtroSt, setFiltroSt] = useState<FiltroSituacao>('todos');
  const [filtroCat, setFiltroCat] = useState<string | null>(null);
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null);
  const [modalUnidades, setModalUnidades] = useState(false);

  // Movimentações
  const [mes, setMes] = useState(() => chaveMesBRT(new Date()));
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipoMov>('todos');
  const [filtroProdId, setFiltroProdId] = useState('');
  const [escolhendoProduto, setEscolhendoProduto] = useState(false);

  const {
    produtos, resumo, isLoading, isError, erro, refetch,
    unidadesVisiveis, unidadesDisponivel, movimentar, salvarUnidades,
  } = useEstoque();

  const movQuery = useMovimentosMes(mes, aba === 'movimentacoes');
  // keepPreviousData: enquanto o mês novo carrega, nunca mostrar os números do mês anterior.
  const carregandoMov = movQuery.isLoading || movQuery.isPlaceholderData || (movQuery.isFetching && !movQuery.data);
  const erroMov = movQuery.isError
    ? (movQuery.error instanceof Error ? movQuery.error.message : 'Não foi possível carregar as movimentações.')
    : null;
  const movimentos: MovimentoEstoque[] = useMemo(
    () => (movQuery.isPlaceholderData ? [] : movQuery.data ?? []),
    [movQuery.data, movQuery.isPlaceholderData],
  );

  const mesAtual = chaveMesBRT(new Date());
  const podeAvancar = mes < mesAtual;

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), aba === 'movimentacoes' ? movQuery.refetch() : Promise.resolve()]);
    setRefreshing(false);
  }, [refetch, aba, movQuery]);

  // ── Produtos filtrados ────────────────────────────────────
  const alertas = useMemo(() => produtos.filter(p => p.status !== 'ok'), [produtos]);

  const listaFiltrada = useMemo(() => {
    let r = produtos;
    const q = busca.trim().toLowerCase();
    if (q) {
      r = r.filter(p =>
        p.nome.toLowerCase().includes(q) ||
        p.categoria.toLowerCase().includes(q) ||
        rotuloCategoriaProduto(p.categoria).toLowerCase().includes(q));
    }
    if (filtroCat) r = r.filter(p => p.categoria === filtroCat);
    if (filtroSt === 'alertas') r = r.filter(p => p.status !== 'ok');
    if (filtroPorTipo !== 'todos') r = r.filter(p => p.tipo === filtroPorTipo);
    return r;
  }, [produtos, busca, filtroCat, filtroSt, filtroPorTipo]);

  // Categorias que têm ao menos 1 produto (para os chips)
  const catsComProduto = CATEGORIAS_PRODUTO.filter(c => produtos.some(p => p.categoria === c.key));

  // ── Movimentos filtrados ──────────────────────────────────
  const movFiltrados = useMemo(() => {
    let r = movimentos;
    if (filtroTipo !== 'todos') r = r.filter(m => m.tipo === filtroTipo);
    if (filtroProdId) r = r.filter(m => m.produto_id === filtroProdId);
    return r;
  }, [movimentos, filtroTipo, filtroProdId]);

  const produtoFiltradoNome = useMemo(
    () => produtos.find(p => p.id === filtroProdId)?.nome ?? '',
    [produtos, filtroProdId],
  );

  // Cartões do mês recortados só pelo produto (independem do filtro de tipo), como no web.
  const movDoProduto = useMemo(
    () => (filtroProdId ? movimentos.filter(m => m.produto_id === filtroProdId) : movimentos),
    [movimentos, filtroProdId],
  );
  const resumoMov = useMemo(() => resumoMovimentos(movDoProduto), [movDoProduto]);

  if (!fontsLoaded) return null;

  function abrirHistoricoProduto(p: Produto) {
    setFiltroProdId(p.id);
    setFiltroTipo('todos');
    setAba('movimentacoes');
  }

  function navMes(dir: 1 | -1) {
    const novo = somarMeses(mes, dir);
    if (novo > mesAtual) return;
    setMes(novo);
  }

  const semValor = isLoading || isError;
  const cartoesProdutos = [
    { label: 'Materiais / Insumos', value: semValor ? '—' : String(resumo.materiais), sub: 'para atendimentos', Icon: Package, cor: C.primary, bg: C.primarySoft },
    { label: 'Para venda (PDV)', value: semValor ? '—' : String(resumo.venda), sub: 'para revenda', Icon: DollarSign, cor: C.green, bg: C.greenSoft },
    {
      label: 'Precisam de reposição', value: semValor ? '—' : String(resumo.alertas),
      sub: semValor ? '' : resumo.alertas > 0 ? 'estoque baixo' : 'tudo OK', Icon: AlertTriangle,
      cor: !semValor && resumo.alertas > 0 ? C.amber : C.green, bg: !semValor && resumo.alertas > 0 ? C.amberSoft : C.greenSoft,
    },
    { label: 'Valor total em estoque', value: semValor ? '—' : formatarMoeda(resumo.valorTotal), sub: 'custo de aquisição', Icon: Wallet, cor: C.accent, bg: C.accentSoft },
  ];

  const definicaoExport = aba === 'produtos'
    ? null
    : (carregandoMov || erroMov ? null : definicaoEstoqueMovimentacoes(mes));

  const TIPOS_MOV: { key: FiltroTipoMov; label: string; cor: string }[] = [
    { key: 'todos', label: 'Todos', cor: C.primary },
    { key: 'entrada', label: '↑ Entradas', cor: C.green },
    { key: 'saida', label: '↓ Saídas', cor: C.red },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 24, paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                Insumos & produtos
              </Text>
              <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 26, color: C.text }}>
                Estoque
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {aba === 'produtos' ? (
                <BotaoExportar
                  definicao={isLoading || isError ? null : definicaoEstoqueProdutos()}
                  getLinhas={() => listaFiltrada.map((p) => ({ nome: p.nome, categoria: rotuloCategoriaProduto(p.categoria), unidade: p.unidade, estoqueAtual: p.estoque_atual, estoqueMinimo: p.estoque_minimo, precoCusto: p.preco_custo, status: rotuloStatusEstoque(statusEstoque(p.estoque_atual, p.estoque_minimo)) }))}
                  cor={C.text2}
                />
              ) : (
                <BotaoExportar
                  definicao={definicaoExport}
                  getLinhas={() => movFiltrados.map((m) => ({ criadoEm: m.created_at, produto: m.produto?.nome ?? '—', tipo: m.tipo, quantidade: m.quantidade, unidade: m.produto?.unidade ?? '', motivo: m.motivo }))}
                  cor={C.text2}
                />
              )}
              {aba === 'produtos' && pode('estoque.acessar') && unidadesDisponivel && (
                <TouchableOpacity
                  onPress={() => setModalUnidades(true)}
                  accessibilityLabel="Unidades"
                  style={{ height: 38, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                  <Ruler size={14} color={C.text2} strokeWidth={2} />
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Unidades</Text>
                </TouchableOpacity>
              )}
              {aba === 'produtos' && (
                <TouchableOpacity
                  onPress={() => router.push('/(empresa)/novo-produto')}
                  accessibilityLabel="Novo produto"
                  style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Plus size={18} color="#fff" strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Cartões do estoque */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350 }}
          style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginHorizontal: 24, marginBottom: 16 }}
        >
          {cartoesProdutos.map(k => <Cartao key={k.label} {...k} />)}
        </MotiView>

        {/* Abas */}
        <View style={{ marginHorizontal: 24, marginBottom: 16 }}>
          <SmoothTabs
            variant="segmented"
            tabs={[
              { key: 'produtos', label: 'Produtos' },
              { key: 'movimentacoes', label: 'Movimentações' },
            ]}
            active={aba}
            onChange={(k) => setAba(k as Aba)}
          />
        </View>

        {/* ══ PRODUTOS ══ */}
        {aba === 'produtos' && (
          isError ? (
            <BannerErro mensagem={erro ?? 'Não foi possível carregar o estoque.'} onTentar={() => { refetch(); }} />
          ) : (
            <>
              {/* Banner de reposição */}
              {!isLoading && alertas.length > 0 && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  marginHorizontal: 24, marginBottom: 14, padding: 12,
                  backgroundColor: C.amberSoft, borderRadius: 16, borderWidth: 1, borderColor: '#F6DDB8',
                }}>
                  <AlertTriangle size={18} color={C.amber} strokeWidth={2} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.amber }}>
                      {alertas.length} {alertas.length === 1 ? 'produto precisa' : 'produtos precisam'} de reposição
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.amber, marginTop: 2 }}>
                      {alertas.slice(0, 3).map(p => p.nome).join(', ')}
                      {alertas.length > 3 ? ` e mais ${alertas.length - 3}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => { setFiltroSt('alertas'); setFiltroCat(null); }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.amber }}>Ver todos</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Filtro por tipo — Material vs Venda */}
              {!isLoading && produtos.length > 0 && (
                <View style={{ marginHorizontal: 24, marginBottom: 12 }}>
                  <SmoothTabs
                    variant="pill"
                    tabs={[
                      { key: 'todos', label: `Todos (${produtos.length})` },
                      { key: 'material', label: `Materiais / Insumos (${resumo.materiais})` },
                      { key: 'venda', label: `Para venda (PDV) (${resumo.venda})` },
                    ]}
                    active={filtroPorTipo}
                    onChange={(k) => { setFiltroPorTipo(k as FiltroTipoProduto); setFiltroCat(null); }}
                  />
                </View>
              )}

              {/* Busca */}
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                marginHorizontal: 24, marginBottom: 12,
                backgroundColor: C.surface, borderRadius: 12,
                borderWidth: 1, borderColor: C.border,
                paddingHorizontal: 12, paddingVertical: 10,
              }}>
                <Search size={15} color={C.text3} strokeWidth={2} />
                <TextInput
                  value={busca}
                  onChangeText={setBusca}
                  placeholder="Buscar produto..."
                  placeholderTextColor={C.text4}
                  style={{ flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text }}
                />
              </View>

              {/* Situação: Todos / Alertas */}
              <View style={{ marginHorizontal: 24, marginBottom: 12 }}>
                <SmoothTabs
                  variant="pill"
                  activeColor={filtroSt === 'alertas' ? '#D97706' : undefined}
                  tabs={[
                    { key: 'todos', label: 'Todos' },
                    { key: 'alertas', label: alertas.length > 0 ? `Alertas (${alertas.length})` : 'Alertas' },
                  ]}
                  active={filtroSt}
                  onChange={(k) => setFiltroSt(k as FiltroSituacao)}
                />
              </View>

              {/* Filtro por categoria */}
              {catsComProduto.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 24, marginBottom: 14 }}>
                  {[{ key: null as string | null, label: 'Todas' }, ...catsComProduto].map((c) => {
                    const ativo = filtroCat === c.key;
                    return (
                      <TouchableOpacity
                        key={c.key ?? '__todas__'}
                        onPress={() => setFiltroCat(c.key === null || ativo ? null : c.key)}
                        style={{
                          paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20,
                          backgroundColor: ativo ? C.primarySoft : C.surface,
                          borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? C.primary : C.text3 }}>
                          {c.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {/* Lista */}
              {isLoading ? (
                <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
              ) : listaFiltrada.length === 0 ? (
                <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 24 }}>
                  <Package size={40} color={C.text4} strokeWidth={1.5} />
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text3, marginTop: 12, textAlign: 'center' }}>
                    {busca || filtroCat || filtroSt === 'alertas' || filtroPorTipo !== 'todos'
                      ? 'Nenhum produto encontrado com esses filtros.'
                      : 'Nenhum produto cadastrado ainda.'}
                  </Text>
                  {busca || filtroCat || filtroSt === 'alertas' || filtroPorTipo !== 'todos' ? (
                    <TouchableOpacity onPress={() => { setBusca(''); setFiltroCat(null); setFiltroSt('todos'); setFiltroPorTipo('todos'); }} style={{ marginTop: 10 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.accent }}>Limpar filtros</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => router.push('/(empresa)/novo-produto')} style={{ marginTop: 10 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.accent }}>+ Cadastrar primeiro produto</Text>
                    </TouchableOpacity>
                  )}
                </MotiView>
              ) : (
                <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
                  {listaFiltrada.map((produto, i) => (
                    <MotiView
                      key={produto.id}
                      from={{ opacity: 0, translateX: -8 }}
                      animate={{ opacity: 1, translateX: 0 }}
                      transition={{ type: 'timing', duration: 300, delay: Math.min(i, 12) * 40 }}
                    >
                      <ProdutoRow
                        produto={produto}
                        onMovimentar={() => setProdutoSelecionado(produto)}
                        onHistorico={() => abrirHistoricoProduto(produto)}
                        onEdit={() => router.push(`/(empresa)/editar-produto/${produto.id}` as any)}
                      />
                    </MotiView>
                  ))}
                </View>
              )}
            </>
          )
        )}

        {/* ══ MOVIMENTAÇÕES ══ */}
        {aba === 'movimentacoes' && (
          <>
            {/* Navegação de mês */}
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 6 }}>
                <TouchableOpacity onPress={() => navMes(-1)} accessibilityLabel="Mês anterior" style={{ padding: 6 }}>
                  <ChevronLeft size={16} color={C.text3} />
                </TouchableOpacity>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, minWidth: 140, textAlign: 'center' }}>
                  {rotuloMesAno(mes)}
                </Text>
                <TouchableOpacity onPress={() => navMes(1)} disabled={!podeAvancar} accessibilityLabel="Próximo mês" style={{ padding: 6, opacity: podeAvancar ? 1 : 0.3 }}>
                  <ChevronRight size={16} color={C.text3} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Filtro por produto ativo */}
            {!!filtroProdId && !!produtoFiltradoNome && (
              <View style={{ alignItems: 'center', marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primarySoft, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Search size={12} color={C.primary} strokeWidth={2} />
                  <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.primary, maxWidth: 220 }}>
                    Mostrando: {produtoFiltradoNome}
                  </Text>
                  <TouchableOpacity onPress={() => setFiltroProdId('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.primary }}>Limpar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {erroMov ? (
              <BannerErro mensagem={erroMov} onTentar={() => { movQuery.refetch(); }} />
            ) : (
              <>
                {/* Cartões do mês */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginHorizontal: 24, marginBottom: 14 }}>
                  {[
                    { label: 'Saídas no mês', value: carregandoMov ? '—' : String(resumoMov.saidas), sub: carregandoMov ? '' : `${formatarQuantidadeBR(resumoMov.qtdSaidas)} unid. total`, Icon: ArrowDownCircle, cor: C.rose, bg: C.roseSoft },
                    { label: 'Entradas no mês', value: carregandoMov ? '—' : String(resumoMov.entradas), sub: carregandoMov ? '' : `${formatarQuantidadeBR(resumoMov.qtdEntradas)} unid. total`, Icon: ArrowUpCircle, cor: C.green, bg: C.greenSoft },
                    { label: 'Total registros', value: carregandoMov ? '—' : String(resumoMov.total), sub: 'entradas + saídas', Icon: List, cor: C.primary, bg: C.primarySoft },
                  ].map(k => <Cartao key={k.label} {...k} />)}
                </View>

                {/* Filtros: tipo + produto */}
                <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 24, marginBottom: 10 }}>
                  {TIPOS_MOV.map(t => {
                    const ativo = filtroTipo === t.key;
                    return (
                      <TouchableOpacity
                        key={t.key}
                        onPress={() => setFiltroTipo(t.key)}
                        style={{
                          paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20,
                          backgroundColor: ativo ? t.cor : C.surface,
                          borderWidth: 1, borderColor: ativo ? t.cor : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text3 }}>{t.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  onPress={() => setEscolhendoProduto(true)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    marginHorizontal: 24, marginBottom: 14,
                    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
                    paddingHorizontal: 12, paddingVertical: 11,
                  }}
                >
                  <Search size={15} color={C.text3} strokeWidth={2} />
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: filtroProdId ? C.text : C.text4 }}>
                    {produtoFiltradoNome || 'Filtrar por produto...'}
                  </Text>
                  <ChevronRight size={14} color={C.text4} />
                </TouchableOpacity>

                {/* Lista */}
                {carregandoMov ? (
                  <ActivityIndicator color={C.accent} style={{ marginTop: 30 }} />
                ) : movFiltrados.length === 0 ? (
                  <View style={{ alignItems: 'center', marginTop: 30, paddingHorizontal: 24 }}>
                    <List size={36} color={C.text4} strokeWidth={1.5} />
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text3, marginTop: 12, textAlign: 'center' }}>
                      {movimentos.length === 0
                        ? 'Nenhuma movimentação registrada neste mês.'
                        : 'Nenhuma movimentação encontrada com esses filtros.'}
                    </Text>
                    {movimentos.length > 0 && (
                      <TouchableOpacity onPress={() => { setFiltroTipo('todos'); setFiltroProdId(''); }} style={{ marginTop: 10 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.accent }}>Limpar filtros</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
                    {movFiltrados.map(m => <MovimentoRow key={m.id} m={m} />)}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Modal de movimentação */}
      <ModalMovimentacao
        key={produtoSelecionado?.id ?? 'nenhum'}
        produto={produtoSelecionado}
        onClose={() => setProdutoSelecionado(null)}
        onConfirmar={(tipo, quantidade, motivo) => movimentar(produtoSelecionado!, tipo, quantidade, motivo)}
      />

      {/* Filtro de produto das movimentações */}
      {escolhendoProduto && (
        <ModalEscolherProduto
          produtos={produtos}
          valor={filtroProdId}
          onEscolher={(id) => { setFiltroProdId(id); setEscolhendoProduto(false); }}
          onClose={() => setEscolhendoProduto(false)}
        />
      )}

      {/* Ajuste de unidades */}
      {modalUnidades && (
        <UnidadesEstoqueModal
          visiveis={unidadesVisiveis}
          onClose={() => setModalUnidades(false)}
          onSalvar={salvarUnidades}
          onSalvo={() => { setModalUnidades(false); Alert.alert('Unidades atualizadas'); }}
        />
      )}
    </View>
  );
}
