// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as constantes from '@shared/clientes-constantes';
import * as segmentos from '@shared/clientes-segmentos';
import { DIAS_RECONQUISTA } from '@shared/dashboard';

/**
 * As constantes de segmento ficam num módulo SEM dependências: antes, clientes-segmentos importava
 * kpis-financeiros, que importava clientes-segmentos (ciclo), e dashboard lia DIAS_EM_RISCO no
 * nível do módulo — dependendo da ordem de carga (Metro/CJS), a constante podia sair undefined.
 */
const shared = join(process.cwd(), '..', 'shared');
const importsDe = (arquivo: string): string[] => {
  const texto = readFileSync(join(shared, arquivo), 'utf8');
  const out: string[] = [];
  // só imports/reexports de VALOR (import type some no build e não cria ciclo em tempo de execução)
  const re = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]\.\/([\w-]+)['"]/gm;
  for (let m = re.exec(texto); m; m = re.exec(texto)) out.push(`${m[1]}.ts`);
  return out;
};

describe('constantes de segmento de clientes', () => {
  it('módulo sem nenhum import', () => {
    expect(readFileSync(join(shared, 'clientes-constantes.ts'), 'utf8')).not.toMatch(/^\s*import\s/m);
  });

  it('valores da spec, reexportados por clientes-segmentos', () => {
    expect(constantes).toMatchObject({
      VIP_GASTO: 2000, VIP_ATENDIMENTOS: 8, RECORRENTE_ATENDIMENTOS: 5,
      DIAS_EM_RISCO: 45, DIAS_SUMIDA: 60, DIAS_RETORNO: 30, DIAS_NUNCA_ATENDIDA: 30,
    });
    expect(segmentos.DIAS_EM_RISCO).toBe(45);
    expect(segmentos.VIP_GASTO).toBe(2000);
    expect(DIAS_RECONQUISTA).toBe(45);
  });

  it('kpis-financeiros e dashboard leem as constantes do módulo sem dependências', () => {
    expect(importsDe('kpis-financeiros.ts')).not.toContain('clientes-segmentos.ts');
    expect(importsDe('dashboard.ts')).not.toContain('clientes-segmentos.ts');
    expect(importsDe('kpis-financeiros.ts')).toContain('clientes-constantes.ts');
    expect(importsDe('dashboard.ts')).toContain('clientes-constantes.ts');
  });

  it('nenhum ciclo de import de valor passa por clientes-segmentos, clientes-consultas ou dashboard', () => {
    const arquivos = readdirSync(shared).filter(f => f.endsWith('.ts'));
    const grafo = new Map(arquivos.map(f => [f, importsDe(f).filter(d => arquivos.includes(d))]));
    const ciclos: string[] = [];
    const visitar = (no: string, pilha: string[]) => {
      const i = pilha.indexOf(no);
      if (i >= 0) { ciclos.push([...pilha.slice(i), no].join(' -> ')); return; }
      if (pilha.length > 30) return;
      for (const d of grafo.get(no) ?? []) visitar(d, [...pilha, no]);
    };
    for (const inicio of ['clientes-segmentos.ts', 'clientes-consultas.ts', 'dashboard.ts']) visitar(inicio, []);
    expect(ciclos).toEqual([]);
  });
});
