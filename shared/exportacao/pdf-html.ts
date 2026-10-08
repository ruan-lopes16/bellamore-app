import { dataHoraBR, linhasParaCelulas, type DefinicaoExportacao } from './tipos';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * HTML da tabela para o PDF do app (expo-print), no mesmo layout do PDF do web
 * (web/lib/export.ts): A4 paisagem, título 16pt, "Exportado em …" em Brasília,
 * cabeçalho roxo #7c3aed, linhas alternadas #f8f6ff, fonte 9pt.
 */
export function montarHtmlTabela<T>(def: DefinicaoExportacao<T>, linhas: T[], exportadoEm: Date): string {
  const cab = def.colunas.map(c => `<th>${esc(c.cabecalho)}</th>`).join('');
  const corpo = linhasParaCelulas(def, linhas)
    .map(cel => `<tr>${cel.map(v => `<td>${esc(String(v))}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 14mm; }
body { font-family: Helvetica, Arial, sans-serif; color: #000; }
h1 { font-size: 16pt; margin: 0 0 4px; }
.data { font-size: 9pt; color: #787878; margin: 0 0 10px; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th { background: #7c3aed; color: #fff; text-align: left; padding: 3mm; font-weight: bold; }
td { padding: 3mm; }
tr:nth-child(even) td { background: #f8f6ff; }
</style></head><body>
<h1>${esc(def.titulo)}</h1>
<p class="data">Exportado em ${dataHoraBR(exportadoEm.toISOString())}</p>
<table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>
</body></html>`;
}
