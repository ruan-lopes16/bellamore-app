import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { janelaDoDia } from '@shared/agenda';

// Task 6 da paridade da Agenda: visões do app (semana de verdade, Mês, janela do dia,
// colunas por profissional em "Todas" e bloqueios filtrados pela profissional escolhida).
const raiz = join(process.cwd(), '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8').replace(/\r\n/g, '\n');

// `grade.ts` mora no app. O web não pode importar módulos do mobile com import/from
// (web-nao-importa-mobile.test.ts: o type-check do `next build` não acha as dependências do app),
// então as funções puras entram só em tempo de execução, pelo glob do Vite (o tsc não segue).
type Grade = {
  horasDaJanela: (j: { ini: number; fim: number }) => number[];
  instanteDaHora: (dia: string, hora: number) => string;
  agruparPorHora: <T extends { data_hora_inicio: string }>(ags: T[]) => Record<number, T[]>;
  bloqueiosDaProfissional: <B>(bs: B[], p: string) => B[];
  bloqueiosPorHora: <B>(bs: B[], dia: string, horas: number[]) => Record<number, B[]>;
  itensDaJanela: (dia: string, ags: { data_hora_inicio: string; data_hora_fim: string }[], bs: unknown[]) => { inicio: string; fim: string }[];
};
const g = Object.values(
  (import.meta as unknown as { glob: (p: string, o: { eager: true }) => Record<string, unknown> })
    .glob('../../../mobile/components/agenda/grade.ts', { eager: true }),
)[0] as Grade;
const TODAS = 'todas' as const;
const { horasDaJanela, instanteDaHora, agruparPorHora, bloqueiosDaProfissional, bloqueiosPorHora, itensDaJanela } = g;

const EMPRESA = 'mobile/app/(empresa)/agenda.tsx';
const PROF = 'mobile/app/(profissional)/agenda.tsx';
const HOOK_AGENDA = 'mobile/hooks/useAgenda.ts';
const HOOK_PROF = 'mobile/hooks/useProfissional.ts';
const COMP = 'mobile/components/agenda';

const bl = (o: Partial<{ id: string; profissional_id: string | null; escopo: 'profissional' | 'geral'; situacao: 'aprovado' | 'pendente'; data_inicio: string; data_fim: string }>) => ({
  id: 'b', profissional_id: 'ana', escopo: 'profissional' as const, situacao: 'aprovado' as const,
  data_inicio: '2026-10-19T13:00:00.000Z', data_fim: '2026-10-19T15:00:00.000Z', ...o,
});

describe('grade da agenda do app (funções puras)', () => {
  it('horas da janela vêm de horariosDoDia, de hora em hora, sem o fim', () => {
    expect(horasDaJanela({ ini: 7, fim: 10 })).toEqual([7, 8, 9]);
    expect(horasDaJanela({ ini: 0, fim: 24 })).toHaveLength(24);
  });

  it('instante da hora é em Brasília', () => {
    expect(instanteDaHora('2026-10-19', 10)).toBe('2026-10-19T13:00:00.000Z');
    expect(instanteDaHora('2026-10-19', 0)).toBe('2026-10-19T03:00:00.000Z');
  });

  it('agrupa atendimentos pela hora de início em Brasília', () => {
    const r = agruparPorHora([
      { id: 'a', data_hora_inicio: '2026-10-19T13:30:00.000Z' },
      { id: 'b', data_hora_inicio: '2026-10-19T13:00:00.000Z' },
      { id: 'c', data_hora_inicio: '2026-10-19T22:00:00.000Z' },
    ]);
    expect(r[10].map((a) => a.id)).toEqual(['a', 'b']);
    expect(r[19].map((a) => a.id)).toEqual(['c']);
  });

  it('bloqueios da profissional: os dela e os gerais; em "Todas", todos', () => {
    const bs = [
      bl({ id: 'ana' }),
      bl({ id: 'bia', profissional_id: 'bia' }),
      bl({ id: 'geral', profissional_id: null, escopo: 'geral' }),
    ];
    expect(bloqueiosDaProfissional(bs, 'ana').map((b) => b.id)).toEqual(['ana', 'geral']);
    expect(bloqueiosDaProfissional(bs, 'bia').map((b) => b.id)).toEqual(['bia', 'geral']);
    expect(bloqueiosDaProfissional(bs, TODAS)).toHaveLength(3);
  });

  it('bloqueio de outra profissional não ocupa a hora da escolhida', () => {
    const bs = bloqueiosDaProfissional([bl({ profissional_id: 'bia' })], 'ana');
    expect(bloqueiosPorHora(bs, '2026-10-19', [10, 11, 12])).toEqual({});
  });

  it('bloqueio ocupa as horas que cruza, em Brasília; fim na hora cheia não conta', () => {
    // 10:00–12:00 BRT
    const r = bloqueiosPorHora([bl({})], '2026-10-19', horasDaJanela({ ini: 7, fim: 21 }));
    expect(Object.keys(r).map(Number)).toEqual([10, 11]);
    // 10:30–11:15 BRT
    const r2 = bloqueiosPorHora([bl({ data_inicio: '2026-10-19T13:30:00.000Z', data_fim: '2026-10-19T14:15:00.000Z' })], '2026-10-19', [9, 10, 11, 12]);
    expect(Object.keys(r2).map(Number)).toEqual([10, 11]);
  });

  it('bloqueio de vários dias é recortado ao dia exibido', () => {
    const b = bl({ data_inicio: '2026-10-18T13:00:00.000Z', data_fim: '2026-10-21T13:00:00.000Z' });
    expect(Object.keys(bloqueiosPorHora([b], '2026-10-19', horasDaJanela({ ini: 0, fim: 24 })))).toHaveLength(24);
    expect(janelaDoDia(itensDaJanela('2026-10-19', [], [b]))).toEqual({ ini: 0, fim: 24 });
  });

  it('janela estica para atendimentos fora de 7–21', () => {
    const itens = itensDaJanela('2026-10-19', [
      { data_hora_inicio: '2026-10-19T09:30:00.000Z', data_hora_fim: '2026-10-19T10:30:00.000Z' }, // 06:30–07:30
      { data_hora_inicio: '2026-10-20T00:00:00.000Z', data_hora_fim: '2026-10-20T01:15:00.000Z' }, // 21:00–22:15
    ], []);
    expect(janelaDoDia(itens)).toEqual({ ini: 6, fim: 23 });
  });
});

describe('telas e hooks da agenda do app', () => {
  const empresa = ler(EMPRESA);
  const prof = ler(PROF);
  const hookAgenda = ler(HOOK_AGENDA);
  const hookProf = ler(HOOK_PROF);

  it('componentes de visão existem em mobile/components/agenda', () => {
    for (const f of ['FaixaSemana.tsx', 'VisaoMes.tsx', 'AlternarVisao.tsx', 'TimelineColunas.tsx', 'grade.ts']) {
      expect(existsSync(join(raiz, COMP, f))).toBe(true);
    }
  });

  it('semana de verdade: setas chamam semanaVizinha e a semana é de domingo (diasDaSemana)', () => {
    const faixa = ler(`${COMP}/FaixaSemana.tsx`);
    expect(faixa).toContain('semanaVizinha(dia, -1)');
    expect(faixa).toContain('semanaVizinha(dia, 1)');
    expect(faixa).toContain('diasDaSemana(dia)');
    // rótulo do mês acompanha o dia
    expect(faixa).toContain('rotuloMesAno(dia)');
  });

  it('nenhum weekStartsOn: 1 nem lista fixa de horas nas agendas e hooks', () => {
    for (const s of [empresa, prof, hookAgenda, hookProf]) {
      expect(s).not.toContain('weekStartsOn');
      expect(s).not.toContain('startOfWeek');
    }
    for (const s of [empresa, prof]) {
      expect(s).not.toMatch(/const HORAS\s*=/);
      expect(s).toContain('janelaDoDia(');
      expect(s).toContain('horasDaJanela(');
      expect(s).toContain('<FaixaSemana');
      expect(s).toContain('<VisaoMes');
      expect(s).toContain('<AlternarVisao');
    }
  });

  it('visão Mês: grade do mês com contagem e toque abre o dia', () => {
    const mes = ler(`${COMP}/VisaoMes.tsx`);
    expect(mes).toContain('gradeCalendarioMes(');
    expect(mes).toContain('contagem');
    expect(mes).toContain('onAbrirDia(');
    for (const s of [empresa, prof]) expect(s).toMatch(/onAbrirDia=\{[\s\S]{0,120}setVisao\('dia'\)/);
  });

  it('contagem do mês: uma consulta paginada, em Brasília, com erro conferido', () => {
    for (const [src, nome] of [[hookAgenda, 'useDiasComAgendamento'], [hookProf, 'useDiasProfissional']] as const) {
      const i = src.indexOf(`export function ${nome}`);
      const t = src.slice(i, i + 1800);
      expect(t).toContain('buscarTodasPaginas');
      expect(t).toContain('.range(');
      expect(t).toContain("order('id')");
      expect(t).toContain('limitesMes(');
      expect(t).toContain('chaveDiaBRT(');
      expect(t).toContain('if (error) throw error');
      expect(t).toContain(".neq('status', 'cancelado')");
    }
  });

  it('agendamentos e bloqueios do dia em Brasília; bloqueios filtrados pela profissional (mantém os gerais)', () => {
    const iAg = hookAgenda.indexOf('export function useAgendamentoDia');
    expect(hookAgenda.slice(iAg, iAg + 1500)).toContain('limitesDias(');
    const i = hookAgenda.indexOf('export function useBloqueiosDia');
    const t = hookAgenda.slice(i, i + 1500);
    expect(t).toContain('limitesDias(');
    expect(t).toContain('escopo.eq.geral');
    expect(t).toContain("profissional !== TODAS");
    expect(hookAgenda).not.toContain('startOfDay(');
  });

  it('filtroProfissional: começa na própria pessoa e só vira "Todas" com agenda.ver_equipe', () => {
    expect(empresa).toMatch(/const \[filtroProfissional, setFiltroProfissional\] = useState<string \| 'todas'>\(/);
    expect(empresa).toMatch(/useState<string \| 'todas'>\(\(\) => user\?\.id \?\? ''\)/);
    expect(empresa).toMatch(/const filtro\b[^\n]*podeVerEquipe \? [^\n]*: \(?user\?\.id/);
    expect(empresa).toContain('useBloqueiosDia(dia, filtro)');
    expect(empresa).toContain('useAgendamentoDia(dia, filtro)');
    // chip "Todas" e chips da equipe só com ver_equipe
    expect(empresa).toMatch(/\{podeVerEquipe && \([\s\S]{0,600}setFiltroProfissional\(TODAS\)/);
  });

  it('modo "Todas": uma coluna por profissional com rolagem horizontal e nome no topo', () => {
    expect(empresa).toContain('colunasPorProfissional(');
    expect(empresa).toContain('<TimelineColunas');
    expect(empresa).toContain('bloqueiosDaProfissional(bloqueios, ');
    const col = ler(`${COMP}/TimelineColunas.tsx`);
    expect(col).toContain('horizontal');
    expect(col).toContain('profissional.nome');
  });

  it('slot vazio: some só com bloqueio da profissional ou geral; leva a profissional na rota', () => {
    expect(empresa).toContain('&profissional=${');
    expect(empresa).toContain('bloqueiosDaProfissional(');
    expect(prof).toContain('bloqueiosPorHora(');
    expect(empresa).toContain('bloqueiosPorHora(');
  });
});
