import { describe, expect, it } from 'vitest';
import { nomeAbaPlanilha, nomeArquivoSeguro, linhasParaCelulas, dataBR, dataHoraBR, type DefinicaoExportacao } from '@shared/exportacao/tipos';
import { montarHtmlTabela } from '@shared/exportacao/pdf-html';

type L = { a: string; n: number | null };
const def: DefinicaoExportacao<L> = {
  arquivo: 'teste', titulo: 'Título & <Cia>',
  colunas: [{ cabecalho: 'A', valor: l => l.a, largura: 10 }, { cabecalho: 'N', valor: l => l.n }],
};

describe('base das exportações', () => {
  it('nomeArquivoSeguro', () => {
    expect(nomeArquivoSeguro('Relatório Março 2026')).toBe('relatorio-marco-2026');
    expect(nomeArquivoSeguro('comissoes--1º  Trimestre')).toBe('comissoes-1-trimestre');
  });
  it('nomeAbaPlanilha: sem caracteres proibidos, até 31, nunca vazio', () => {
    for (const t of ['Comissões — 05/10 – 11/10/2026', 'Relatório Financeiro — 07/10/2026', 'a:b\\c/d?e*f[g]h']) {
      const n = nomeAbaPlanilha(t);
      expect(n).not.toMatch(/[:\\/?*[\]]/);
      expect(n.length).toBeLessThanOrEqual(31);
    }
    expect(nomeAbaPlanilha('Comissões — 05/10 – 11/10/2026')).toBe('Comissões — 05-10 – 11-10-2026'.slice(0, 31));
    expect(nomeAbaPlanilha('')).toBe('Planilha');
  });
  it('linhasParaCelulas: null/undefined viram vazio, números ficam números', () => {
    expect(linhasParaCelulas(def, [{ a: 'x', n: null }, { a: 'y', n: 3 }])).toEqual([['x', ''], ['y', 3]]);
  });
  it('dataBR e dataHoraBR (Brasília)', () => {
    expect(dataBR('2026-09-05')).toBe('05/09/2026');
    expect(dataBR(null)).toBe('');
    expect(dataHoraBR('2026-10-01T02:30:00Z')).toBe('30/09/2026 23:30');
  });
  it('montarHtmlTabela: título escapado, data em Brasília, cabeçalhos, linhas', () => {
    const html = montarHtmlTabela(def, [{ a: '<b>', n: 1 }], new Date('2026-10-07T15:04:00Z'));
    expect(html).toContain('Título &amp; &lt;Cia&gt;');
    expect(html).toContain('Exportado em 07/10/2026 12:04');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>&lt;b&gt;</td>');
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('#7c3aed');
  });
  it('lista vazia gera só o cabeçalho', () => {
    const html = montarHtmlTabela(def, [], new Date('2026-10-07T15:04:00Z'));
    expect(html).toContain('<th>N</th>');
    expect(html).not.toContain('<td>');
  });
});
