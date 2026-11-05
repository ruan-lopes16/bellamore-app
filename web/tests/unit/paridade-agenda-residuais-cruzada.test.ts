/**
 * Residuais de agenda e pacotes (web × app) — varredura cruzada
 * (spec docs/superpowers/specs/2026-11-04-agenda-pacotes-residuais-design.md).
 *
 * Trava:
 * - validade dos pacotes oferecidos pelo dia do atendimento (nunca `hojeBRT()`);
 * - "Desvincular e cobrar normal" no erro de carga dos pacotes nas duas comandas;
 * - avaliação lida pela função única de shared;
 * - continuação do atendimento longo nas duas agendas do app;
 * - agenda web sem `isToday` (calendário do computador).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const ler = (f: string) => semComentarios(readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'));

const COMANDA_WEB = 'web/app/(app)/comanda/page.tsx';
const COMANDA_APP = 'mobile/app/(empresa)/nova-comanda.tsx';
const AGENDA_WEB = 'web/app/(app)/agenda/page.tsx';
const DETALHE_WEB = 'web/app/(app)/agenda/DetalheAtendimento.tsx';
const NOVO_AG_APP = 'mobile/app/(empresa)/novo-agendamento.tsx';
const AVAL_APP = 'mobile/components/atendimento/AvaliacaoAtendimento.tsx';
const AGENDA_APP = 'mobile/app/(empresa)/agenda.tsx';
const AGENDA_PROF_APP = 'mobile/app/(profissional)/agenda.tsx';
const TIMELINE_APP = 'mobile/components/agenda/TimelineColunas.tsx';

describe('validade dos pacotes pelo dia do atendimento', () => {
  it.each([COMANDA_WEB, COMANDA_APP, AGENDA_WEB, NOVO_AG_APP])('%s', (f) => {
    const s = ler(f);
    expect(s).toContain('calcularPacotesAtivosCliente(rows, ');
    expect(s).not.toMatch(/calcularPacotesAtivosCliente\([^)]*hojeBRT\(\)\)/);
  });
});

describe('Comanda: desvincular tudo quando a carga dos pacotes falha', () => {
  it.each([COMANDA_WEB, COMANDA_APP])('%s', (f) => {
    const s = ler(f);
    expect(s).toContain('ROTULO_DESVINCULAR_TODOS');
    expect(s).toContain('atendimentosVinculados(itens, pacoteLinks)');
  });
});

describe('avaliação pela função única', () => {
  it.each([DETALHE_WEB, AVAL_APP])('%s', (f) => {
    const s = ler(f);
    expect(s).toContain('carregarAvaliacao(');
    expect(s).toContain('salvarAvaliacao(');
    expect(s).not.toContain("from('avaliacoes')");
  });
});

describe('atendimento longo na grade do app', () => {
  it.each([AGENDA_APP, AGENDA_PROF_APP, TIMELINE_APP])('%s', (f) => {
    expect(ler(f)).toContain('continuacoesPorHora(');
  });
});

describe('agenda web e comanda web em Brasília', () => {
  it.each([AGENDA_WEB, COMANDA_WEB])('%s', (f) => {
    const s = ler(f);
    expect(s).not.toContain('isToday(');
    expect(s).toContain('dataDoDia(hojeBRT())');
  });
});

describe('app: invalidação única da agenda', () => {
  it.each([COMANDA_APP, NOVO_AG_APP, 'mobile/app/(empresa)/agendamento/[id].tsx'])('%s', (f) => {
    expect(ler(f)).toMatch(/invalidar(Chaves)?Agenda\((qc|queryClient)\)/);
  });
});
