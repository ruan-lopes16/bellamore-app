import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rotulosEixoVisiveis } from '@shared/relatorios';
import { textoLancamentoRecorrentes, TODAS_RECORRENTES_LANCADAS } from '@shared/despesas';

const raiz = resolve(__dirname, '../../..');
const ler = (p: string) => readFileSync(resolve(raiz, p), 'utf8');

describe('rotulosEixoVisiveis (C13)', () => {
  it('até o máximo mostra todos', () => {
    expect(rotulosEixoVisiveis(7, 10)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rotulosEixoVisiveis(10, 10)).toHaveLength(10);
  });
  it('vazio ou inválido não mostra nada', () => {
    expect(rotulosEixoVisiveis(0)).toEqual([]);
    expect(rotulosEixoVisiveis(NaN)).toEqual([]);
  });
  it('mês de 30 dias: 1º, a cada 5 e o último', () => {
    expect(rotulosEixoVisiveis(30, 10)).toEqual([0, 4, 9, 14, 19, 24, 29]);
  });
  it('mês de 31 dias: não cola o dia 30 no 31', () => {
    expect(rotulosEixoVisiveis(31, 10)).toEqual([0, 4, 9, 14, 19, 24, 30]);
  });
  it('sempre crescente, sem repetição, com 1º e último', () => {
    for (let n = 11; n <= 40; n++) {
      const r = rotulosEixoVisiveis(n, 10);
      expect(r[0]).toBe(0);
      expect(r[r.length - 1]).toBe(n - 1);
      expect(new Set(r).size).toBe(r.length);
      expect([...r].sort((a, b) => a - b)).toEqual(r);
    }
  });
});

describe('avisos e telas (C13)', () => {
  it('tudo já lançado usa a constante única', () => {
    expect(textoLancamentoRecorrentes({ inseridas: 0, jaExistiam: 4 })).toBe(TODAS_RECORRENTES_LANCADAS);
    expect(ler('web/app/(app)/financeiro/page.tsx')).toMatch(/textoLancamentoRecorrentes\(/);
    expect(ler('mobile/app/(empresa)/financeiro.tsx')).toMatch(/textoLancamentoRecorrentes\(/);
  });
  it('Relatórios do app usa o helper do eixo e a Sparkline segue o cartão', () => {
    expect(ler('mobile/app/(empresa)/relatorios.tsx')).toMatch(/rotulosEixoVisiveis\(/);
    const dash = ler('mobile/app/(empresa)/dashboard.tsx');
    expect(dash).toMatch(/onLayout=\{e => setLarguraHero/);
    expect(dash).toMatch(/<SparkLinha dados=\{sparkline\} largura=/);
  });
  it('erro geral dos Relatórios aparece só no banner', () => {
    expect(ler('web/app/(app)/relatorios/page.tsx')).not.toMatch(/setErroCarga\(msg\);\s*showErro\(msg\)/);
    expect(ler('mobile/app/(empresa)/relatorios.tsx')).not.toMatch(/Não foi possível carregar os dados desta aba/);
  });
  it('histórico de Vendas do app só mostra spinner na primeira carga', () => {
    expect(ler('mobile/app/(empresa)/vendas.tsx')).toMatch(/mostrarSpinnerHistorico\(/);
  });
});
