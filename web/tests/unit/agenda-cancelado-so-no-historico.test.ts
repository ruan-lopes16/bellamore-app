import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readWeb = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

describe('agenda web — cancelado oculto', () => {
  const src = readWeb('app/(app)/agenda/page.tsx');

  it('filtra cancelado nas duas queries de agendamentos (dia e mês)', () => {
    // fetchDia + fetchMes → duas ocorrências do filtro.
    const ocorrencias = src.match(/\.neq\('status', 'cancelado'\)/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });

  it('deriva a lista visível sem os cancelados', () => {
    expect(src).toMatch(/const agsVisiveis\s*=\s*useMemo\(/);
    expect(src).toMatch(/ags\.filter\(\s*a\s*=>\s*a\.status !== 'cancelado'\s*\)/);
    // O filtro NÃO pode tocar em 'faltou'.
    expect(src).not.toMatch(/agsVisiveis[\s\S]{0,120}'faltou'/);
  });

  it('as três chamadas de view recebem agsVisiveis, não o ags cru', () => {
    // ListaDia (semana + mês) e TimelineView.
    const comFiltro = src.match(/ags=\{agsVisiveis\}/g) ?? [];
    expect(comFiltro.length).toBeGreaterThanOrEqual(3);
    // Nenhum call site pode continuar passando ags={ags}.
    expect(src).not.toMatch(/ags=\{ags\}/);
  });

  it('mantém "faltou" visível e riscado na timeline', () => {
    // A expressão `inativo` continua reconhecendo faltou.
    expect(src).toMatch(/ag\.status === 'faltou'/);
  });
});
