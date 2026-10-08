/**
 * @file lib/export.ts
 * Exportação para XLSX e PDF a partir de uma definição compartilhada
 * (`shared/exportacao/<tela>.ts`) + linhas padrão montadas pela tela.
 *
 * Usa dynamic import para evitar SSR (libs são browser-only).
 *
 * @example
 * exportToXLSX(definicaoClientes(), linhas);
 * exportToPDF(definicaoClientes(), linhas);
 */
import { nomeAbaPlanilha, linhasParaCelulas, dataHoraBR, type DefinicaoExportacao } from '@shared/exportacao/tipos';

// ── XLSX ──────────────────────────────────────────────────────

export async function exportToXLSX<T>(def: DefinicaoExportacao<T>, linhas: T[]): Promise<void> {
  const XLSX = await import('xlsx');

  const cabecalhos = def.colunas.map(c => c.cabecalho);
  const worksheet = XLSX.utils.aoa_to_sheet([cabecalhos, ...linhasParaCelulas(def, linhas)]);

  // Largura das colunas
  worksheet['!cols'] = def.colunas.map(c => ({ wch: c.largura ?? 20 }));

  // Estilo do cabeçalho (negrito via cell format)
  cabecalhos.forEach((_, i) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: i });
    if (!worksheet[addr]) return;
    worksheet[addr].s = { font: { bold: true } };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, nomeAbaPlanilha(def.titulo));

  XLSX.writeFile(workbook, `${def.arquivo}.xlsx`);
}

// ── PDF ───────────────────────────────────────────────────────

export async function exportToPDF<T>(def: DefinicaoExportacao<T>, linhas: T[]): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(def.titulo, 14, 18);

  // Data de exportação (horário de Brasília)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Exportado em ${dataHoraBR(new Date().toISOString())}`, 14, 25);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 30,
    head:   [def.colunas.map(c => c.cabecalho)],
    body:   linhasParaCelulas(def, linhas).map(r => r.map(String)),
    styles: {
      font:     'helvetica',
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      fillColor:  [124, 58, 237], // primary
      textColor:  255,
      fontStyle:  'bold',
      fontSize:   9,
    },
    alternateRowStyles: {
      fillColor: [248, 246, 255],
    },
    margin: { left: 14, right: 14 },
  });

  doc.save(`${def.arquivo}.pdf`);
}
