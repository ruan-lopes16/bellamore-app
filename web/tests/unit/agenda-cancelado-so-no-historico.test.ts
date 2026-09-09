import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readWeb = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

describe('agenda web — cancelado oculto', () => {
  const src = readWeb('app/(app)/agenda/page.tsx');

  it('filtra cancelado nas duas queries de agendamentos (dia e mês)', () => {
    // fetchDia: filtro dentro da própria query de agendamentos do dia.
    expect(src).toMatch(/from\('agendamentos'\)[\s\S]{0,800}\.neq\('status', 'cancelado'\)/);
    // fetchMes: filtro na query de contagem por dia.
    expect(src).toMatch(/select\('data_hora_inicio'\)[\s\S]{0,200}\.neq\('status', 'cancelado'\)/);
    // backstop: exatamente essas duas ocorrências, nada a mais.
    const ocorrencias = src.match(/\.neq\('status', 'cancelado'\)/g) ?? [];
    expect(ocorrencias.length).toBe(2);
  });

  it('deriva a lista visível sem os cancelados', () => {
    expect(src).toMatch(/const agsVisiveis\s*=\s*useMemo\(/);
    expect(src).toMatch(/ags\.filter\(\s*a\s*=>\s*a\.status !== 'cancelado'\s*\)/);
    // O filtro do agsVisiveis é exatamente o check de cancelado — sem faltou, sem AND/OR.
    expect(src).toMatch(/agsVisiveis\s*=\s*useMemo\(\s*\n?\s*\(\)\s*=>\s*ags\.filter\(a => a\.status !== 'cancelado'\),\s*\n?\s*\[ags\],?\s*\n?\s*\)/);
  });

  it('as três chamadas de view recebem agsVisiveis, não o ags cru', () => {
    // ListaDia (semana + mês) e TimelineView.
    const comFiltro = src.match(/ags=\{agsVisiveis\}/g) ?? [];
    expect(comFiltro.length).toBeGreaterThanOrEqual(3);
    // Nenhum call site pode continuar passando ags={ags}.
    expect(src).not.toMatch(/ags=\{ags\}/);
    // O Exportar também precisa da lista filtrada — senão o PDF/XLSX sai com
    // a linha cancelada que já sumiu da tela (mudarStatus não refaz o fetch).
    expect(src).not.toMatch(/getData=\{\(\) => ags\}/);
    expect(src).toMatch(/getData=\{\(\) => agsVisiveis\}/);
  });

  it('mantém "faltou" visível e riscado na timeline', () => {
    // A expressão `inativo` continua reconhecendo faltou.
    expect(src).toMatch(/ag\.status === 'faltou'/);
  });
});

const readRepo = (f: string) => readFileSync(resolve(__dirname, '../../..', f), 'utf8');

describe('histórico da cliente no app nativo — cancelado visível', () => {
  const src = readRepo('mobile/hooks/useClientes.ts');

  it('useClienteDetalhe não filtra cancelado no histórico de agendamentos', () => {
    // 'cancelado' (masculino) só existia nessa query; 'cancelada' (feminino,
    // das taxas) continua permitido.
    expect(src).not.toMatch(/\.neq\('status', 'cancelado'\)/);
  });

  it('contagem de visitas e total gasto seguem só sobre concluído', () => {
    expect(src).toContain("historicoCompleto.filter((a: any) => a.status === 'concluido')");
  });

  it('a query de histórico continua escopada à cliente', () => {
    expect(src).toMatch(/\.from\('agendamentos'\)[\s\S]{0,400}\.eq\('cliente_id', clienteId\)/);
  });
});
