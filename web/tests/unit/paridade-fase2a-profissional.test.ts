import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const web = readFileSync(join(raiz, 'web/app/(app)/dashboard/DashboardProfissionalView.tsx'), 'utf8');
const hook = readFileSync(join(raiz, 'mobile/hooks/useProfissional.ts'), 'utf8');
const agenda = readFileSync(join(raiz, 'mobile/app/(profissional)/agenda.tsx'), 'utf8');
const comissoes = readFileSync(join(raiz, 'mobile/app/(profissional)/comissoes.tsx'), 'utf8');
const inicio = readFileSync(join(raiz, 'mobile/app/(profissional)/inicio.tsx'), 'utf8');

describe('dinheiro da profissional igual nas duas plataformas', () => {
  it('web e mobile usam os mesmos resumos de shared', () => {
    for (const src of [web, hook]) {
      expect(src).toContain('resumoComissoesProfissional(');
      expect(src).toContain('faturamentoPrevistoDia(');
    }
  });
  it('comissão do dia vem da tabela comissoes, não do percentual atual', () => {
    expect(hook).not.toContain('percentual_comissao');
    expect(hook).not.toMatch(/receitaDia \* \(percentual/);
    expect(agenda).not.toMatch(/ag\.valor \* \(percentual/);
  });
  it('mês e dia em Brasília', () => {
    expect(web).toContain('hojeBRT()');
    expect(web).not.toMatch(/(startOfMonth|endOfMonth)\([^)]*\)\.toISOString\(\)/);
    expect(hook).toContain('limitesMes(');
  });
  it('KPIs do dia filtram pela empresa ativa', () => {
    const trecho = hook.slice(hook.indexOf('export function useKpisDiaProfissional'), hook.indexOf('export function useComissoesProfissional'));
    expect(trecho).toContain(".eq('empresa_id', empresaId!)");
  });
  it('rótulo "Comissão prev." saiu (não é mais previsão por percentual)', () => {
    expect(agenda).not.toContain('Comissão prev.');
  });
  it('resumo do mês confere o erro da consulta (nunca zeros silenciosos)', () => {
    const trecho = hook.slice(hook.indexOf('export function useResumoComissoes'), hook.indexOf('export function useDiasProfissional'));
    expect(trecho).toContain('if (error) throw error');
  });
  it('telas da profissional mostram erro visível e protegem valores com SecretText', () => {
    expect(inicio).toContain('isError');
    expect(inicio).toContain('SecretText');
    expect(agenda).toContain('SecretText');
  });
  it('agenda da profissional filtra pela empresa ativa e usa limites de Brasília', () => {
    const trecho = hook.slice(hook.indexOf('export function useAgendaProfissional'), hook.indexOf('// ── KPIs do dia'));
    expect(trecho).toContain(".eq('empresa_id', empresaId!)");
    expect(trecho).toContain('limitesDias(chave, chave)');
    expect(trecho).toContain("['prof-agenda', userId, empresaId, chave]");
    expect(trecho).toContain('if (error) throw error');
  });
  it('tela de comissões da profissional mostra erro e protege valores', () => {
    expect(comissoes).toContain('isError: erroResumo');
    expect(comissoes).toContain('SecretText');
    expect(comissoes).toContain('Tentar de novo');
  });
  it('consultas web de meta e histórico checam o erro', () => {
    expect(web).toContain('if (erroMembro) throw erroMembro');
    expect(web).toContain('if (erroHistorico) throw erroHistorico');
  });
  it('rótulo de comissão do dia não diz "hoje" em dia navegado', () => {
    expect(agenda).not.toContain("label: 'Comissão hoje'");
  });
});
