import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useProfissional.ts');
const tela = ler('mobile/app/(profissional)/comissoes.tsx');
const inicio = ler('mobile/app/(profissional)/inicio.tsx');

describe('comissões da profissional iguais ao web', () => {
  it('hook usa a consulta única filtrando a própria profissional', () => {
    for (const t of ['carregarComissoesDoPeriodo(', 'profissionalId: userId!', 'normalizarComissoes', 'resumoComissoesProfissional('])
      expect(hook).toContain(t);
  });
  it('tela: períodos, filtros e rótulos únicos', () => {
    for (const t of ['PERIODOS_COMISSAO', 'limitesPeriodoComissao(', 'FILTROS_COMISSAO', 'filtrarComissoes(',
      'Comissão média', 'isError: erroResumo', 'rotuloDataHoraBRT(']) expect(tela).toContain(t);
    for (const t of ['subMonths', 'Ticket médio', 'new Date(item.data_hora)']) expect(tela).not.toContain(t);
  });
  it('início usa o mês em Brasília', () => {
    expect(inicio).toContain('useResumoComissoes(mesAtual)');
  });
  it('dias com agendamento: Brasília + empresa ativa + erro conferido', () => {
    const t = hook.slice(hook.indexOf('export function useDiasProfissional'), hook.indexOf('// ── Bloqueios da própria agenda'));
    for (const s of [".eq('empresa_id', empresaId!)", 'limitesMes(chave)', 'chaveDiaBRT(', 'if (error) throw error'])
      expect(t).toContain(s);
    expect(t).not.toContain('new Date(mes.getFullYear()');
  });
});
