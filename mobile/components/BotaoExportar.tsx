import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, TouchableOpacity } from 'react-native';
import { Download } from 'lucide-react-native';
import type { DefinicaoExportacao } from '@shared/exportacao/tipos';
import { exportarExcel, exportarPdf } from '@/lib/exportar';

/**
 * Ícone de Download do cabeçalho: pergunta Excel ou PDF, gera com o que a tela
 * mostra (getLinhas) e abre o compartilhar. `definicao` nula esconde o botão.
 */
export function BotaoExportar<T>({ definicao, getLinhas, cor = '#6B7280' }: {
  definicao: DefinicaoExportacao<T> | null;
  getLinhas: () => T[];
  cor?: string;
}) {
  const [gerando, setGerando] = useState(false);
  const [escolhendo, setEscolhendo] = useState(false);
  if (!definicao) return null;

  async function gerar(tipo: 'Excel' | 'PDF') {
    setGerando(true);
    try {
      if (tipo === 'Excel') await exportarExcel(definicao!, getLinhas());
      else await exportarPdf(definicao!, getLinhas());
    } catch {
      Alert.alert('Exportar', 'Não foi possível montar a exportação.');
    } finally {
      setGerando(false);
    }
  }

  function escolher() {
    if (gerando || escolhendo) return;
    setEscolhendo(true);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancelar', 'Excel', 'PDF'], cancelButtonIndex: 0, title: 'Exportar' },
        i => { setEscolhendo(false); if (i === 1) gerar('Excel'); if (i === 2) gerar('PDF'); },
      );
    } else {
      Alert.alert('Exportar', 'Escolha o formato', [
        { text: 'Cancelar', style: 'cancel', onPress: () => setEscolhendo(false) },
        { text: 'Excel', onPress: () => { setEscolhendo(false); gerar('Excel'); } },
        { text: 'PDF', onPress: () => { setEscolhendo(false); gerar('PDF'); } },
      ], { cancelable: true, onDismiss: () => setEscolhendo(false) });
    }
  }

  return (
    <TouchableOpacity onPress={escolher} disabled={gerando} accessibilityLabel="Exportar"
      style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
      {gerando ? <ActivityIndicator size="small" color={cor} /> : <Download size={16} color={cor} strokeWidth={1.8} />}
    </TouchableOpacity>
  );
}
