/**
 * @file lib/export.ts
 * Utilitários de exportação para XLSX e PDF.
 *
 * Usa dynamic import para evitar SSR (libs são browser-only).
 *
 * @example
 * exportToXLSX('clientes', 'Clientes', colunas, dados);
 * exportToPDF('clientes', 'Clientes', colunas, dados);
 */

export type ExportColumn<T = Record<string, unknown>> = {
  /** Rótulo do cabeçalho */
  header: string;
  /** Função que extrai o valor da linha (sempre retorna string para uniformidade) */
  accessor: (row: T) => string | number | null | undefined;
  /** Largura da coluna no XLSX (caracteres) */
  width?: number;
};

// ── XLSX ──────────────────────────────────────────────────────

export async function exportToXLSX<T>(
  filename: string,
  sheetTitle: string,
  columns: ExportColumn<T>[],
  data: T[],
): Promise<void> {
  const XLSX = await import('xlsx');

  const header = columns.map(c => c.header);
  const rows   = data.map(row => columns.map(c => c.accessor(row) ?? ''));

  const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);

  // Largura das colunas
  worksheet['!cols'] = columns.map(c => ({ wch: c.width ?? 20 }));

  // Estilo do cabeçalho (negrito via cell format)
  header.forEach((_, i) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: i });
    if (!worksheet[addr]) return;
    worksheet[addr].s = { font: { bold: true } };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetTitle.slice(0, 31));

  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

// ── PDF ───────────────────────────────────────────────────────

export async function exportToPDF<T>(
  filename: string,
  title: string,
  columns: ExportColumn<T>[],
  data: T[],
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 14, 18);

  // Data de exportação
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  const hoje = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  doc.text(`Exportado em ${hoje}`, 14, 25);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 30,
    head:   [columns.map(c => c.header)],
    body:   data.map(row => columns.map(c => String(c.accessor(row) ?? ''))),
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

  doc.save(`${filename}.pdf`);
}
