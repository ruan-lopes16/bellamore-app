import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft } from 'lucide-react-native';
import {
  useFonts, Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { formatValorMonetarioInput, parseValorMonetario, dividirValorCompra } from '@shared/despesas';
import {
  montarRetiradaSociaInsert,
  type RetiradaSociaTipo, type MetodoPagamentoRetirada,
} from '@shared/retiradas-socia';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', accent: '#9B6FE8',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const METODOS: { key: MetodoPagamentoRetirada; label: string }[] = [
  { key: 'dinheiro', label: 'Dinheiro' },
  { key: 'pix', label: 'PIX / Transf.' },
  { key: 'credito', label: 'Crédito' },
  { key: 'debito', label: 'Débito' },
  { key: 'cortesia', label: 'Cortesia' },
];

function mascaraData(v: string) {
  const n = v.replace(/\D/g, '').slice(0, 8);
  if (n.length <= 2) return n;
  if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
}
function dataParaBanco(v: string): string | null {
  const p = v.split('/');
  if (p.length !== 3 || p[2].length !== 4) return null;
  return `${p[2]}-${p[1]}-${p[0]}`;
}
function bancoParaData(iso: string | null | undefined): string {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const inputStyle = {
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12,
  paddingHorizontal: 14, height: 46, fontFamily: 'PlusJakartaSans_600SemiBold' as const,
  fontSize: 15, color: C.text,
};

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}

export default function NovaRetirada() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva, user } = useAuthStore();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editando = !!id;

  const [tipo, setTipo] = useState<RetiradaSociaTipo>('emprestimo');
  const [valor, setValor] = useState('');
  const [data, setData] = useState('');
  const [descricao, setDescricao] = useState('');
  const [metodo, setMetodo] = useState<MetodoPagamentoRetirada | null>(null);
  const [parcelado, setParcelado] = useState(false);
  const [totalParcelas, setTotalParcelas] = useState('');
  const [valorParcela, setValorParcela] = useState('');
  const [primeiraParcela, setPrimeiraParcela] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(editando);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (!editando) return;
    (async () => {
      const { data: r } = await supabase.from('retiradas_socia').select('*').eq('id', id).single();
      if (r) {
        setTipo(r.tipo);
        setValor(formatValorMonetarioInput(Number(r.valor)));
        setData(bancoParaData(r.data));
        setDescricao(r.descricao ?? '');
        setMetodo(r.metodo ?? null);
        setParcelado(!!r.parcelado);
        setTotalParcelas(r.total_parcelas ? String(r.total_parcelas) : '');
        setValorParcela(r.valor_parcela ? formatValorMonetarioInput(Number(r.valor_parcela)) : '');
        setPrimeiraParcela(bancoParaData(r.primeira_parcela_em));
      }
      setCarregando(false);
    })();
  }, [id]);

  const valorNum = parseValorMonetario(valor);
  const nParc = parseInt(totalParcelas, 10) || 0;
  const sugestaoParcela = valorNum && nParc >= 2 ? formatValorMonetarioInput(dividirValorCompra(valorNum, nParc).valorBase) : '';

  async function salvar() {
    if (!empresaAtiva) return;
    const built = montarRetiradaSociaInsert({
      empresaId: empresaAtiva.id, tipo, valorInput: valor,
      data: dataParaBanco(data) ?? '', descricao, metodo,
      parcelado: tipo === 'emprestimo' && parcelado,
      totalParcelasInput: totalParcelas,
      valorParcelaInput: valorParcela || sugestaoParcela,
      primeiraParcelaEm: dataParaBanco(primeiraParcela) ?? '',
    }, user?.id ?? null);
    if (!built.ok) { Alert.alert('Não foi possível salvar', built.erro); return; }

    setSalvando(true);
    const p = built.payload;
    let error;
    if (editando) {
      ({ error } = await supabase.from('retiradas_socia').update({
        valor: p.valor, data: p.data, descricao: p.descricao, metodo: p.metodo,
        parcelado: p.parcelado, total_parcelas: p.total_parcelas,
        valor_parcela: p.valor_parcela, primeira_parcela_em: p.primeira_parcela_em,
      }).eq('id', id).select('id'));
    } else {
      ({ error } = await supabase.from('retiradas_socia').insert(p).select('id'));
    }
    setSalvando(false);
    if (error) { Alert.alert('Erro', 'Não foi possível salvar. Verifique se você é a dona da conta.'); return; }
    qc.invalidateQueries({ queryKey: ['fin-retiradas'] });
    router.back();
  }

  if (!fontsLoaded) return null;

  const chip = (ativo: boolean) => ({
    flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' as const,
    borderWidth: 1, borderColor: ativo ? C.primary : C.border,
    backgroundColor: ativo ? C.primary : C.surface,
  });
  const chipTxt = (ativo: boolean) => ({
    fontFamily: 'PlusJakartaSans_700Bold' as const, fontSize: 12, color: ativo ? '#fff' : C.text3,
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          <TouchableOpacity onPress={() => router.back()}
            style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {empresaAtiva?.nome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            {editando ? 'Editar lançamento' : 'Nova retirada'}
          </Text>
        </LinearGradient>

        {carregando ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : (
          <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350, delay: 60 }} style={{ padding: 24 }}>
            <Campo label="Tipo">
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity disabled={editando} onPress={() => setTipo('emprestimo')} style={[chip(tipo === 'emprestimo'), editando && { opacity: 0.6 }]}>
                  <Text style={chipTxt(tipo === 'emprestimo')}>Empréstimo</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: tipo === 'emprestimo' ? 'rgba(255,255,255,0.8)' : C.text4 }}>ela devolve</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={editando} onPress={() => setTipo('retirada')} style={[chip(tipo === 'retirada'), editando && { opacity: 0.6 }]}>
                  <Text style={chipTxt(tipo === 'retirada')}>Retirada</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: tipo === 'retirada' ? 'rgba(255,255,255,0.8)' : C.text4 }}>não devolve</Text>
                </TouchableOpacity>
              </View>
              {editando && <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4, marginTop: 4 }}>O tipo não pode ser alterado. Para mudar, exclua e recrie.</Text>}
            </Campo>

            <Campo label="Valor *">
              <TextInput value={valor} onChangeText={setValor} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={C.text4} style={inputStyle} />
            </Campo>

            <Campo label="Data *">
              <TextInput value={data} onChangeText={(v) => setData(mascaraData(v))} keyboardType="numeric" placeholder="DD/MM/AAAA" placeholderTextColor={C.text4} style={inputStyle} />
            </Campo>

            <Campo label="Descrição">
              <TextInput value={descricao} onChangeText={setDescricao} placeholder="Ex: uso pessoal" placeholderTextColor={C.text4} style={inputStyle} />
            </Campo>

            <Campo label="De onde saiu (opcional)">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {METODOS.map(({ key, label }) => {
                  const ativo = metodo === key;
                  return (
                    <TouchableOpacity key={key} onPress={() => setMetodo(ativo ? null : key)}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: ativo ? C.primary : C.border, backgroundColor: ativo ? C.primary : C.surface }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text2 }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Campo>

            {tipo === 'emprestimo' && (
              <>
                <View style={{ height: 1, backgroundColor: C.border, marginVertical: 8 }} />
                <Campo label="Devolução">
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity onPress={() => setParcelado(false)} style={chip(!parcelado)}>
                      <Text style={chipTxt(!parcelado)}>Avulsa</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setParcelado(true)} style={chip(parcelado)}>
                      <Text style={chipTxt(parcelado)}>Em parcelas</Text>
                    </TouchableOpacity>
                  </View>
                </Campo>
                {parcelado && (
                  <>
                    <Campo label="Nº de parcelas *">
                      <TextInput value={totalParcelas} onChangeText={(v) => setTotalParcelas(v.replace(/\D/g, ''))} keyboardType="numeric" placeholder="Ex: 3" placeholderTextColor={C.text4} style={inputStyle} />
                    </Campo>
                    <Campo label="Valor da parcela">
                      <TextInput value={valorParcela} onChangeText={setValorParcela} keyboardType="decimal-pad" placeholder={sugestaoParcela || '0,00'} placeholderTextColor={C.text4} style={inputStyle} />
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4, marginTop: 4 }}>Em branco = divide o valor pelas parcelas.</Text>
                    </Campo>
                    <Campo label="1ª parcela em *">
                      <TextInput value={primeiraParcela} onChangeText={(v) => setPrimeiraParcela(mascaraData(v))} keyboardType="numeric" placeholder="DD/MM/AAAA" placeholderTextColor={C.text4} style={inputStyle} />
                    </Campo>
                  </>
                )}
              </>
            )}

            <TouchableOpacity onPress={salvar} disabled={salvando}
              style={{ backgroundColor: C.primary, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8, opacity: salvando ? 0.6 : 1 }}>
              {salvando ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>Salvar</Text>}
            </TouchableOpacity>
          </MotiView>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
