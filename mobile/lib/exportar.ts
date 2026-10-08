import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { nomeAbaPlanilha, linhasParaCelulas, type DefinicaoExportacao } from '@shared/exportacao/tipos';
import { montarHtmlTabela } from '@shared/exportacao/pdf-html';

async function compartilhar(uri: string, mimeType: string, titulo: string) {
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('Exportar', 'Este aparelho não permite compartilhar arquivos.');
    return;
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: titulo });
}

/** Gera a planilha (mesmas colunas do web) e abre o compartilhar. */
export async function exportarExcel<T>(def: DefinicaoExportacao<T>, linhas: T[]): Promise<void> {
  try {
    const ws = XLSX.utils.aoa_to_sheet([def.colunas.map(c => c.cabecalho), ...linhasParaCelulas(def, linhas)]);
    ws['!cols'] = def.colunas.map(c => ({ wch: c.largura ?? 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nomeAbaPlanilha(def.titulo));
    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const uri = `${FileSystem.cacheDirectory}${def.arquivo}.xlsx`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    await compartilhar(uri, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', def.titulo);
  } catch (e) {
    Alert.alert('Exportar', `Não foi possível gerar a planilha: ${(e as Error).message}`);
  }
}

/** Gera o PDF (layout do web, via HTML compartilhado) e abre o compartilhar. */
export async function exportarPdf<T>(def: DefinicaoExportacao<T>, linhas: T[]): Promise<void> {
  try {
    const { uri } = await Print.printToFileAsync({ html: montarHtmlTabela(def, linhas, new Date()), width: 842, height: 595 });
    const destino = `${FileSystem.cacheDirectory}${def.arquivo}.pdf`;
    await FileSystem.deleteAsync(destino, { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: destino });
    await compartilhar(destino, 'application/pdf', def.titulo);
  } catch (e) {
    Alert.alert('Exportar', `Não foi possível gerar o PDF: ${(e as Error).message}`);
  }
}
