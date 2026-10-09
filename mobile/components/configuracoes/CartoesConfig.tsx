/**
 * Configurações → Cartões (app): maquininhas (tabela padrão de taxas + exceções por bandeira) e bandeiras.
 * Espelha `web/components/configuracoes/CartoesConfig.tsx`. Edição exige a permissão `config.taxas`;
 * sem ela, ou antes da migration 086 (`legado`), é só leitura.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { CreditCard, Star, Plus, Pencil, Trash2, Undo2, X, ChevronDown, ChevronRight } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { usePermissoes } from '@/lib/permissions';
import { mensagemErroBanco } from '@shared/erros';
import {
  MAX_PARCELAS, bandeirasAtivas, bandeirasComExcecao, campoParaTaxa, chaveBandeira, descartarExcecoesRedundantes,
  gradeParaTaxas, maquininhaPadrao, maquininhasAtivas, mascararPercentual, taxasParaGrade, validarTabela,
  type ConfigCartoes, type GradeTaxas, type Maquininha, type TaxaLinha,
} from '@shared/taxas-cartao';
import { carregarConfigCartoes, definirPadrao, salvarBandeira, salvarMaquininha } from '@shared/taxas-cartao-consultas';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  red: '#C0392B',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};
const F = {
  r: 'PlusJakartaSans_400Regular', m: 'PlusJakartaSans_500Medium',
  s: 'PlusJakartaSans_600SemiBold', b: 'PlusJakartaSans_700Bold', t: 'Fraunces_600SemiBold',
};

type Editor = {
  id?: string; nome: string; max: string; ativa: boolean; padrao: boolean; ordem: number;
  originais: TaxaLinha[]; padraoGrade: GradeTaxas; excecoes: Record<string, GradeTaxas>;
};

function msgErro(e: unknown, acao: string): string {
  return e instanceof Error && e.message ? e.message : mensagemErroBanco(e as Parameters<typeof mensagemErroBanco>[0], acao);
}

const inputStyle = {
  height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
  paddingHorizontal: 12, fontFamily: F.m, fontSize: 14, color: C.text,
} as const;

function BotaoSec({ children, onPress, disabled, flex }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; flex?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.7}
      style={{
        height: 36, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        opacity: disabled ? 0.5 : 1, flexShrink: flex ? 0 : undefined,
      }}>
      {children}
    </TouchableOpacity>
  );
}
const txtSec = { fontFamily: F.s, fontSize: 12, color: C.text2 } as const;

/** Campo de percentual com sufixo "%". */
function CampoTaxa({ rotulo, valor, onChange, desabilitado, placeholder }: {
  rotulo: string; valor: string; onChange: (v: string) => void; desabilitado: boolean; placeholder?: string;
}) {
  return (
    <View style={{ width: '31%', minWidth: 90, flexGrow: 1 }}>
      <Text style={{ fontFamily: F.s, fontSize: 11, color: C.text3, marginBottom: 4 }}>{rotulo}</Text>
      <View>
        <TextInput value={valor} onChangeText={v => onChange(mascararPercentual(v))} keyboardType="decimal-pad"
          placeholder={placeholder ?? '0,00'} placeholderTextColor={C.text4} editable={!desabilitado}
          style={[inputStyle, { paddingRight: 28, opacity: desabilitado ? 0.6 : 1 }]} />
        <Text style={{ position: 'absolute', right: 10, top: 10, fontFamily: F.b, fontSize: 12, color: C.text3 }}>%</Text>
      </View>
    </View>
  );
}

function GradeEditor({ grade, max, onChange, desabilitado, vazioOk }: {
  grade: GradeTaxas; max: number; onChange: (g: GradeTaxas) => void; desabilitado: boolean; vazioOk?: boolean;
}) {
  const ph = vazioOk ? 'usa a padrão' : '0,00';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <CampoTaxa rotulo="Débito" valor={grade.debito} desabilitado={desabilitado} placeholder={ph}
        onChange={v => onChange({ ...grade, debito: v })} />
      {Array.from({ length: max }, (_, i) => (
        <CampoTaxa key={i} rotulo={`Crédito ${i + 1}x`} valor={grade.credito[i] ?? ''} desabilitado={desabilitado} placeholder={ph}
          onChange={v => {
            const credito = Array.from({ length: max }, (_, j) => grade.credito[j] ?? '');
            credito[i] = v;
            onChange({ ...grade, credito });
          }} />
      ))}
    </View>
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
  const inicialRef = useRef('');
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const ocupadoRef = useRef(false);
  ocupadoRef.current = ocupado;

  /** Fecha o editor; com alterações não salvas pede confirmação. */
  const fecharEditor = useCallback(() => {
    if (ocupadoRef.current) return;
    const ed = editorRef.current;
    if (ed && JSON.stringify(ed) !== inicialRef.current) {
      Alert.alert('Descartar alterações?', 'As alterações desta maquininha ainda não foram salvas.', [
        { text: 'Continuar editando', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => setEditor(null) },
      ]);
      return;
    }
    setEditor(null);
  }, []);

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
      ? <Text style={{ fontFamily: F.m, fontSize: 13, color: C.red }}>{erroCarga}</Text>
      : <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />;
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
    setErroEditor('');
    abrir({
      nome: '', max: String(max), ativa: true, padrao: false,
      ordem: Math.max(0, ...cfg.maquininhas.map(m => m.ordem)) + 1,
      originais: [],
      padraoGrade: base ? taxasParaGrade(base.taxas, null, max) : { debito: '', credito: Array(max).fill('') },
      excecoes: {},
    });
  }

  function abrirEdicao(m: Maquininha) {
    setErroEditor('');
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
      // Maquininha nova criada antes de uma falha parcial: adota o id para o retry atualizar em vez de duplicar.
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
    Alert.alert(
      `Remover a maquininha "${m.nome}"?`,
      'Pagamentos já registrados continuam como estão e você pode restaurá-la depois.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover', style: 'destructive',
          onPress: () => void executar('remover a maquininha', async () => {
            await salvarMaquininha(supabase, empresaId, { ...m, ativa: false }, m.taxas);
          }),
        },
      ],
    );
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
    if (!b || rascunho === undefined || ocupado) return;
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
    <View style={{ gap: 18 }}>
      <Text style={{ fontFamily: F.r, fontSize: 12, color: C.text3 }}>
        Cadastre suas maquininhas, as bandeiras aceitas e a taxa de cada parcela. Valem para os próximos pagamentos; os já registrados mantêm a taxa de quando foram feitos.
      </Text>
      {cfg.legado && <Text style={{ fontFamily: F.s, fontSize: 12, color: C.text3 }}>Disponível após a atualização do sistema</Text>}
      {!cfg.legado && !podeEditar && <Text style={{ fontFamily: F.s, fontSize: 12, color: C.text3 }}>Você pode consultar, mas não editar as taxas.</Text>}
      {!!erro && <Text style={{ fontFamily: F.m, fontSize: 13, color: C.red }}>{erro}</Text>}

      {/* Maquininhas */}
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: F.b, fontSize: 14, color: C.text }}>Maquininhas</Text>
          {!somenteLeitura && (
            <BotaoSec onPress={abrirNova} disabled={ocupado}><Plus size={14} color={C.text2} /><Text style={txtSec}>Adicionar maquininha</Text></BotaoSec>
          )}
        </View>
        {ativas.map(m => (
          <View key={m.id} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <CreditCard size={16} color={C.text3} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 14, color: C.text }}>{m.nome}</Text>
                <Text style={{ fontFamily: F.r, fontSize: 12, color: C.text3 }}>até {m.maxParcelas}x</Text>
              </View>
              {m.padrao && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: C.primarySoft }}>
                  <Star size={11} color={C.primary} />
                  <Text style={{ fontFamily: F.b, fontSize: 11, color: C.primary }}>Padrão</Text>
                </View>
              )}
            </View>
            {!somenteLeitura && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {!m.padrao && <BotaoSec onPress={() => tornarPadrao(m)} disabled={ocupado}><Text style={txtSec}>Tornar padrão</Text></BotaoSec>}
                <BotaoSec onPress={() => abrirEdicao(m)} disabled={ocupado}><Pencil size={13} color={C.text2} /><Text style={txtSec}>Editar</Text></BotaoSec>
                <BotaoSec onPress={() => remover(m)} disabled={ocupado}><Trash2 size={13} color={C.red} /><Text style={txtSec}>Remover</Text></BotaoSec>
              </View>
            )}
          </View>
        ))}
        {removidas.length > 0 && (
          <View>
            <TouchableOpacity onPress={() => setRemovidasAbertas(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {removidasAbertas ? <ChevronDown size={14} color={C.text3} /> : <ChevronRight size={14} color={C.text3} />}
              <Text style={{ fontFamily: F.s, fontSize: 12, color: C.text3 }}>Removidas ({removidas.length})</Text>
            </TouchableOpacity>
            {removidasAbertas && (
              <View style={{ gap: 8, marginTop: 8 }}>
                {removidas.map(m => (
                  <View key={m.id} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: C.border, borderRadius: 16, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: 0.85 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.m, fontSize: 14, color: C.text2 }}>{m.nome}</Text>
                    {!somenteLeitura && (
                      <BotaoSec onPress={() => restaurar(m)} disabled={ocupado}><Undo2 size={13} color={C.text2} /><Text style={txtSec}>Restaurar</Text></BotaoSec>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Bandeiras */}
      <View style={{ gap: 10 }}>
        <Text style={{ fontFamily: F.b, fontSize: 14, color: C.text }}>Bandeiras</Text>
        {bandeiras.map(b => (
          <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: b.ativa ? 1 : 0.6 }}>
            <TextInput value={nomesBandeira[b.id] ?? b.nome} editable={!somenteLeitura && !ocupado}
              onChangeText={v => setNomesBandeira(s => ({ ...s, [b.id]: v }))}
              onEndEditing={() => renomearBandeira(b.id)} returnKeyType="done"
              style={[inputStyle, { flex: 1 }]} />
            {!somenteLeitura && (
              <BotaoSec flex onPress={() => alternarBandeira(b.id)} disabled={ocupado}>
                <Text style={txtSec}>{b.ativa ? 'Desativar' : 'Ativar'}</Text>
              </BotaoSec>
            )}
          </View>
        ))}
        {!somenteLeitura && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput value={novaBandeira} onChangeText={setNovaBandeira} placeholder="Nome da nova bandeira"
              placeholderTextColor={C.text4} editable={!ocupado} onSubmitEditing={adicionarBandeira} returnKeyType="done"
              style={[inputStyle, { flex: 1 }]} />
            <BotaoSec flex onPress={adicionarBandeira} disabled={ocupado}><Plus size={14} color={C.text2} /><Text style={txtSec}>Adicionar</Text></BotaoSec>
          </View>
        )}
      </View>

      {/* Editor de maquininha */}
      <Modal visible={!!editor} animationType="slide" transparent onRequestClose={fecharEditor}>
        {editor && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ fontFamily: F.t, fontSize: 18, color: C.text }}>{editor.id ? 'Editar maquininha' : 'Nova maquininha'}</Text>
                <TouchableOpacity onPress={fecharEditor} accessibilityLabel="Fechar" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><X size={18} color={C.text3} /></TouchableOpacity>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 20 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.s, fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Nome *</Text>
                    <TextInput value={editor.nome} onChangeText={v => setEditor({ ...editor, nome: v })} placeholder="Ex: InfinitePay"
                      placeholderTextColor={C.text4} style={inputStyle} />
                  </View>
                  <View style={{ width: 110 }}>
                    <Text style={{ fontFamily: F.s, fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Máx. parcelas</Text>
                    <TextInput value={editor.max} keyboardType="number-pad" style={inputStyle}
                      onChangeText={v => setEditor({ ...editor, max: v.replace(/\D/g, '').slice(0, 2) })} />
                  </View>
                </View>

                <View style={{ gap: 10 }}>
                  <Text style={{ fontFamily: F.b, fontSize: 14, color: C.text }}>Tabela padrão</Text>
                  <GradeEditor grade={editor.padraoGrade} max={maxEditor} desabilitado={ocupado}
                    onChange={g => setEditor({ ...editor, padraoGrade: g })} />
                </View>

                <View style={{ gap: 10 }}>
                  <Text style={{ fontFamily: F.b, fontSize: 14, color: C.text }}>Exceções por bandeira</Text>
                  <Text style={{ fontFamily: F.r, fontSize: 12, color: C.text3 }}>Preencha só o que muda; o que ficar vazio usa a tabela padrão.</Text>
                  {Object.entries(editor.excecoes).map(([bid, g]) => {
                    const b = cfg.bandeiras.find(x => x.id === bid);
                    return (
                      <View key={bid} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, gap: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ fontFamily: F.s, fontSize: 14, color: C.text }}>{b?.nome ?? 'Bandeira'}</Text>
                          <BotaoSec disabled={ocupado} onPress={() => { const { [bid]: _, ...resto } = editor.excecoes; setEditor({ ...editor, excecoes: resto }); }}>
                            <Trash2 size={13} color={C.red} /><Text style={txtSec}>Remover exceção</Text>
                          </BotaoSec>
                        </View>
                        <GradeEditor grade={g} max={maxEditor} desabilitado={ocupado} vazioOk
                          onChange={ng => setEditor({ ...editor, excecoes: { ...editor.excecoes, [bid]: ng } })} />
                      </View>
                    );
                  })}
                  {bandeirasSemExcecao.length > 0 && (
                    <View style={{ gap: 6 }}>
                      <Text style={{ fontFamily: F.s, fontSize: 11, color: C.text3 }}>Adicionar exceção para:</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {bandeirasSemExcecao.map(b => (
                          <TouchableOpacity key={b.id} disabled={ocupado} activeOpacity={0.7}
                            onPress={() => setEditor({ ...editor, excecoes: { ...editor.excecoes, [b.id]: {
                              debito: editor.padraoGrade.debito,
                              credito: Array.from({ length: maxEditor }, (_, i) => editor.padraoGrade.credito[i] ?? ''),
                            } } })}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.border }}>
                            <Plus size={12} color={C.text2} />
                            <Text style={txtSec}>{b.nome}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
                {!!erroEditor && <Text style={{ fontFamily: F.m, fontSize: 13, color: C.red }}>{erroEditor}</Text>}
              </ScrollView>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 18, borderTopWidth: 1, borderTopColor: C.border }}>
                <BotaoSec onPress={fecharEditor} disabled={ocupado}><Text style={txtSec}>Cancelar</Text></BotaoSec>
                <TouchableOpacity onPress={salvarEditor} disabled={ocupado} activeOpacity={0.8}
                  style={{ height: 36, paddingHorizontal: 18, borderRadius: 12, backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: ocupado ? 0.5 : 1 }}>
                  {ocupado && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={{ fontFamily: F.b, fontSize: 13, color: '#fff' }}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}
      </Modal>
    </View>
  );
}
