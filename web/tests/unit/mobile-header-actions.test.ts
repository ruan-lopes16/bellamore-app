import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const headerPages = [
  'app/(app)/clientes/page.tsx',
  'app/(app)/financeiro/page.tsx',
  'app/(app)/servicos/page.tsx',
  'app/(app)/pacotes/page.tsx',
  'app/(app)/equipe/page.tsx',
  'app/(app)/comissoes/page.tsx',
  'app/(app)/relatorios/page.tsx',
  'app/(app)/estoque/page.tsx',
  'app/(app)/agenda/page.tsx',
];

describe('mobile header actions', () => {
  it('uses the shared pink export variant in every requested header', () => {
    const exportButton = read('components/ExportButton.tsx');

    expect(exportButton).toContain("variant?: 'default' | 'mobileHeader'");
    expect(exportButton).toContain('bm-mobile-header-export-button');

    for (const page of headerPages) {
      expect(read(page)).toContain('variant="mobileHeader"');
      expect(read(page)).toContain('bm-mobile-page-header');
    }
  });

  it('keeps the stock controls readable and gives the agenda timeline more content width', () => {
    const stock = read('app/(app)/estoque/page.tsx');
    const agenda = read('app/(app)/agenda/page.tsx');

    expect(stock).toContain('bm-mobile-stock-actions');
    expect(stock).toContain('Histórico geral');
    expect(agenda).toContain('w-10 md:w-12');
    expect(agenda).toContain('whitespace-nowrap');
  });

  it('aligns the Comanda view selector to the right edge of its title row', () => {
    expect(read('app/(app)/comanda/page.tsx')).toContain('bm-comanda-view-toggle');
  });
});
