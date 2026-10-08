import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('app: geração de exportação', () => {
  const lib = ler('mobile/lib/exportar.ts');
  it('Excel com xlsx em base64 e compartilhar', () => {
    expect(lib).toMatch(/XLSX\.write\([^)]*type:\s*'base64'/);
    expect(lib).toContain('EncodingType.Base64');
    expect(lib).toContain('Sharing.shareAsync');
    expect(lib).toContain('linhasParaCelulas(');
  });
  it('PDF pelo HTML compartilhado e expo-print', () => {
    expect(lib).toContain('montarHtmlTabela(');
    expect(lib).toContain('Print.printToFileAsync');
  });
  it('avisa em português quando não dá para compartilhar', () => {
    expect(lib).toContain('Sharing.isAvailableAsync');
    expect(lib).toMatch(/Alert\.alert\(/);
  });
  it('botão pergunta Excel ou PDF', () => {
    const b = ler('mobile/components/BotaoExportar.tsx');
    expect(b).toContain("'Excel'");
    expect(b).toContain("'PDF'");
    expect(b).toContain('exportarExcel(');
    expect(b).toContain('exportarPdf(');
  });
});
