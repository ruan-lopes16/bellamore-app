import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { CategoriaIcon, CategoriaIconCustom } from '@/components/CategoriaIcon';
import {
  ALL_CATEGORIAS, CATEGORIA_LABEL, CATEGORIA_COR, CATEGORIA_BG,
  CATEGORIA_PALETA, CATEGORIA_ICONES, bgDaCor,
  type CategoriaCustom, type CategoriaServico,
} from '@shared/categorias';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', accent: '#9B6FE8',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
  red: '#DC2626',
};

type Props = {
  empresaId: string;
  customs: CategoriaCustom[];
  categoria: string | null;
  categoriaId: string | null;
  onSelect: (categoria: string | null, categoriaId: string | null) => void;
  onCustomCriada: (c: CategoriaCustom) => void;
};

export function CategoriaPicker({ empresaId, customs, categoria, categoriaId, onSelect, onCustomCriada }: Props) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome]   = useState('');
  const [cor, setCor]     = useState(CATEGORIA_PALETA[0].cor);
  const [icone, setIcone] = useState<string>(CATEGORIA_ICONES[0]);
  const [erro, setErro]   = useState('');
  const [salvando, setSalvando] = useState(false);

  const nomesUsados = new Set<string>([
    ...ALL_CATEGORIAS.map((k) => CATEGORIA_LABEL[k].toLowerCase()),
    ...customs.map((c) => c.nome.toLowerCase()),
  ]);

  async function criar() {
    const limpo = nome.trim();
    if (!limpo) { setErro('Dê um nome à categoria.'); return; }
    if (nomesUsados.has(limpo.toLowerCase())) { setErro('Já existe uma categoria com esse nome.'); return; }
    setErro(''); setSalvando(true);
    const { data, error } = await supabase
      .from('categorias_servico')
      .insert({ empresa_id: empresaId, nome: limpo, cor, icone })
      .select('*')
      .single();
    setSalvando(false);
    if (error) {
      Alert.alert('Não deu', error.message.includes('uniq')
        ? 'Já existe uma categoria com esse nome.'
        : 'Sem permissão para criar categoria (só gestor/dono).');
      return;
    }
    const nova = data as CategoriaCustom;
    onCustomCriada(nova);
    onSelect(null, nova.id);
    setCriando(false); setNome(''); setCor(CATEGORIA_PALETA[0].cor); setIcone(CATEGORIA_ICONES[0]);
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ALL_CATEGORIAS.map((k: CategoriaServico) => {
          const ativo = categoria === k && !categoriaId;
          return (
            <TouchableOpacity key={k} onPress={() => onSelect(k, null)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                backgroundColor: ativo ? CATEGORIA_BG[k] : C.surface,
                borderWidth: 1, borderColor: ativo ? CATEGORIA_COR[k] : C.border,
              }}>
              <CategoriaIcon categoria={k} size={16} color={ativo ? CATEGORIA_COR[k] : C.text4} />
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? CATEGORIA_COR[k] : C.text3 }}>
                {CATEGORIA_LABEL[k]}
              </Text>
            </TouchableOpacity>
          );
        })}
        {customs.map((c) => {
          const ativo = categoriaId === c.id;
          return (
            <TouchableOpacity key={c.id} onPress={() => onSelect(null, c.id)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                backgroundColor: ativo ? bgDaCor(c.cor) : C.surface,
                borderWidth: 1, borderColor: ativo ? c.cor : C.border,
              }}>
              <CategoriaIconCustom name={c.icone} size={16} color={ativo ? c.cor : C.text4} />
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? c.cor : C.text3 }}>
                {c.nome}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity onPress={() => setCriando((v) => !v)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed',
          }}>
          <Plus size={14} color={C.text3} strokeWidth={2.5} />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3 }}>Nova</Text>
        </TouchableOpacity>
      </View>

      {criando && (
        <View style={{ marginTop: 12, borderWidth: 1, borderColor: C.border, borderRadius: 14, backgroundColor: C.bg, padding: 12, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text2, textTransform: 'uppercase', letterSpacing: 0.8 }}>Nova categoria</Text>
            <TouchableOpacity onPress={() => setCriando(false)}><X size={16} color={C.text4} /></TouchableOpacity>
          </View>
          <TextInput value={nome} onChangeText={setNome} placeholder="Nome (ex: Massagem)" placeholderTextColor={C.text4}
            style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, height: 42, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORIA_PALETA.map((p) => (
              <TouchableOpacity key={p.cor} onPress={() => setCor(p.cor)}
                style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.bg, borderWidth: 2, borderColor: cor === p.cor ? p.cor : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: p.cor }} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORIA_ICONES.map((n) => (
              <TouchableOpacity key={n} onPress={() => setIcone(n)}
                style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: icone === n ? cor : C.border, alignItems: 'center', justifyContent: 'center' }}>
                <CategoriaIconCustom name={n} size={16} color={icone === n ? cor : C.text3} />
              </TouchableOpacity>
            ))}
          </View>
          {erro ? <Text style={{ color: C.red, fontSize: 12, fontFamily: 'PlusJakartaSans_500Medium' }}>{erro}</Text> : null}
          <TouchableOpacity onPress={criar} disabled={salvando}
            style={{ height: 42, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.5 : 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>{salvando ? 'Salvando...' : 'Salvar categoria'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
