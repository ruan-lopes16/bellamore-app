import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { chaveDiaExibido } from '@shared/periodos';
import {
  FILTRO_TODAS, TL_HOUR_H, janelaDaTimeline, posicaoNaTimeline, horaDoClique, horasDaJanela,
  alturaDaJanela, topoAgora, bloqueiosVisiveis, bloqueiosDoDia, diasComBloqueio,
  faixaDoBloqueioNoDia, semanaDoDia, gradeDoMes, colunasDaTimeline, filtroEfetivo,
  buscarPaginas,
} from '@/app/(app)/agenda/visoes';

// Task 7 da paridade da Agenda: visões do web (Todas, colunas, janela do dia, bloqueios em Semana e Mês).
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');
const agenda = ler('web/app/(app)/agenda/page.tsx');
const mesView = ler('web/app/(app)/agenda/MesView.tsx');
const listaBloq = ler('web/app/(app)/agenda/BloqueiosDoDia.tsx');

// Brasília = UTC−3. 2026-10-19 é uma segunda-feira.
const DIA = '2026-10-19';
const brt = (dia: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [a, mes, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, mes - 1, d, h + 3, m)).toISOString();
};
const ag = (ini: string, fim: string, prof = 'p1') => ({
  id: `${ini}-${prof}`, data_hora_inicio: brt(DIA, ini), data_hora_fim: brt(DIA, fim),
  profissional: { id: prof, nome: prof.toUpperCase() },
});
const bl = (over: Partial<{ id: string; profissional_id: string | null; data_inicio: string; data_fim: string; situacao: 'aprovado' | 'pendente'; criado_por: string | null }> = {}) => ({
  id: 'b1', profissional_id: 'p1', data_inicio: brt(DIA, '12:00'), data_fim: brt(DIA, '13:00'),
  situacao: 'aprovado' as const, criado_por: 'p1', ...over,
});

describe('janela do dia na timeline', () => {
  it('sem nada no dia usa 7h–21h', () => {
    expect(janelaDaTimeline([], [], DIA)).toEqual({ ini: 7, fim: 21 });
  });
  it('estica para atendimento cedo e tarde', () => {
    expect(janelaDaTimeline([ag('06:30', '07:30'), ag('21:00', '22:15')], [], DIA)).toEqual({ ini: 6, fim: 23 });
  });
  it('bloqueio que vem do dia anterior é cortado no começo do dia', () => {
    const b = bl({ data_inicio: brt('2026-10-18', '20:00'), data_fim: brt(DIA, '08:00') });
    expect(janelaDaTimeline([], [b], DIA)).toEqual({ ini: 0, fim: 21 });
  });
  it('bloqueio que vai para o dia seguinte estica até 24h', () => {
    const b = bl({ data_inicio: brt(DIA, '18:00'), data_fim: brt('2026-10-20', '09:00') });
    expect(janelaDaTimeline([], [b], DIA)).toEqual({ ini: 7, fim: 24 });
  });
  it('bloqueio de outro dia não mexe na janela', () => {
    const b = bl({ data_inicio: brt('2026-10-20', '05:00'), data_fim: brt('2026-10-20', '06:00') });
    expect(janelaDaTimeline([], [b], DIA)).toEqual({ ini: 7, fim: 21 });
  });
  it('horas e altura acompanham a janela', () => {
    expect(horasDaJanela({ ini: 6, fim: 9 })).toEqual([6, 7, 8, 9]);
    expect(alturaDaJanela({ ini: 6, fim: 9 })).toBe(3 * TL_HOUR_H);
  });
});

describe('posição na timeline (nenhum card cortado)', () => {
  const j = { ini: 6, fim: 21 };
  it('topo e altura em Brasília, relativos ao início da janela', () => {
    expect(posicaoNaTimeline(brt(DIA, '06:30'), brt(DIA, '07:30'), DIA, j, 26)).toEqual({ top: 36, height: 72 });
  });
  it('card curto no fim da janela sobe para caber', () => {
    const p = posicaoNaTimeline(brt(DIA, '20:50'), brt(DIA, '21:00'), DIA, j, 26);
    expect(p.height).toBe(26);
    expect(p.top + p.height).toBeLessThanOrEqual(alturaDaJanela(j));
  });
  it('item que atravessa a meia-noite termina no fim do dia', () => {
    const p = posicaoNaTimeline(brt(DIA, '23:00'), brt('2026-10-20', '01:00'), DIA, { ini: 7, fim: 24 }, 20);
    expect(p.top + p.height).toBe(alturaDaJanela({ ini: 7, fim: 24 }));
  });
});

describe('clique e linha de agora', () => {
  it('clique arredonda de 15 em 15 e fica dentro da janela', () => {
    expect(horaDoClique(0, { ini: 6, fim: 21 })).toBe('06:00');
    expect(horaDoClique(36, { ini: 6, fim: 21 })).toBe('06:30');
    expect(horaDoClique(99999, { ini: 6, fim: 21 })).toBe('20:45');
    expect(horaDoClique(99999, { ini: 0, fim: 24 })).toBe('23:45');
    expect(horaDoClique(-10, { ini: 6, fim: 21 })).toBe('06:00');
  });
  it('linha de agora só no próprio dia e dentro da janela', () => {
    expect(topoAgora(brt(DIA, '08:00'), DIA, { ini: 7, fim: 21 })).toBe(72);
    expect(topoAgora(brt('2026-10-20', '08:00'), DIA, { ini: 7, fim: 21 })).toBeNull();
    expect(topoAgora(brt(DIA, '22:00'), DIA, { ini: 7, fim: 21 })).toBeNull();
  });
});

describe('filtro "Todas as profissionais"', () => {
  it('"todas" só vale com agenda.ver_equipe; sem ela volta para a própria pessoa', () => {
    expect(FILTRO_TODAS).toBe('todas');
    expect(filtroEfetivo('todas', true, 'eu')).toBe('todas');
    expect(filtroEfetivo('todas', false, 'eu')).toBe('eu');
    expect(filtroEfetivo('p2', true, 'eu')).toBe('p2');
  });
  it('em "Todas", uma coluna por profissional (na ordem, mesmo sem atendimento)', () => {
    const profs = [{ id: 'p1', nome: 'Ana' }, { id: 'p2', nome: 'Bia' }];
    const cols = colunasDaTimeline([ag('09:00', '10:00', 'p2')], profs, 'todas');
    expect(cols.map(c => c.profissional.nome)).toEqual(['Ana', 'Bia']);
    expect(cols[0].itens).toEqual([]);
    expect(cols[1].itens).toHaveLength(1);
  });
  it('com uma profissional escolhida, só a coluna dela', () => {
    const profs = [{ id: 'p1', nome: 'Ana' }, { id: 'p2', nome: 'Bia' }];
    expect(colunasDaTimeline([], profs, 'p2').map(c => c.profissional.id)).toEqual(['p2']);
  });
  it('profissional que só aparece no atendimento (desativada) ganha coluna', () => {
    const cols = colunasDaTimeline([ag('09:00', '10:00', 'px')], [{ id: 'p1', nome: 'Ana' }], 'todas');
    expect(cols.map(c => c.profissional.id)).toEqual(['p1', 'px']);
  });
});

describe('bloqueios visíveis por filtro e situação', () => {
  const todos = [
    bl({ id: 'meu', profissional_id: 'p1' }),
    bl({ id: 'dela', profissional_id: 'p2', criado_por: 'p2' }),
    bl({ id: 'geral', profissional_id: null, criado_por: 'dona' }),
    bl({ id: 'pend', profissional_id: 'p2', situacao: 'pendente', criado_por: 'p2' }),
  ];
  it('"todas" mostra os de todas; uma profissional mostra os dela e os gerais', () => {
    expect(bloqueiosVisiveis(todos, 'todas', 'dona', true).map(b => b.id)).toEqual(['meu', 'dela', 'geral', 'pend']);
    expect(bloqueiosVisiveis(todos, 'p1', 'dona', true).map(b => b.id)).toEqual(['meu', 'geral']);
  });
  it('pendente só para quem aprova ou quem criou', () => {
    expect(bloqueiosVisiveis(todos, 'todas', 'p1', false).map(b => b.id)).toEqual(['meu', 'dela', 'geral']);
    expect(bloqueiosVisiveis(todos, 'todas', 'p2', false).map(b => b.id)).toContain('pend');
  });
  it('bloqueios do dia e dias marcados no mês (em Brasília)', () => {
    const varios = bl({ id: 'v', data_inicio: brt('2026-10-18', '22:00'), data_fim: brt('2026-10-20', '10:00') });
    const outro = bl({ id: 'o', data_inicio: brt('2026-10-25', '09:00'), data_fim: brt('2026-10-25', '10:00') });
    expect(bloqueiosDoDia([varios, outro], DIA).map(b => b.id)).toEqual(['v']);
    const dias = diasComBloqueio([varios, outro], gradeDoMes(new Date(2026, 9, 1)).map(chaveDiaExibido));
    expect([...dias].sort()).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-25']);
  });
  it('faixa do bloqueio no dia: dia inteiro ou horário cortado', () => {
    const varios = bl({ data_inicio: brt('2026-10-18', '22:00'), data_fim: brt('2026-10-20', '10:00') });
    expect(faixaDoBloqueioNoDia(varios, DIA)).toBe('Dia inteiro');
    expect(faixaDoBloqueioNoDia(varios, '2026-10-20')).toBe('00:00–10:00');
    expect(faixaDoBloqueioNoDia(bl(), DIA)).toBe('12:00–13:00');
  });
});

describe('semana de domingo a sábado em todas as visões', () => {
  it('semanaDoDia e gradeDoMes começam no domingo (diasDaSemana)', () => {
    const semana = semanaDoDia(new Date(2026, 9, 21)).map(chaveDiaExibido);
    expect(semana).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    const grade = gradeDoMes(new Date(2026, 9, 15));
    expect(grade).toHaveLength(42);
    expect(chaveDiaExibido(grade[0])).toBe('2026-09-27');
    expect(grade[0].getDay()).toBe(0);
  });
  it('página e calendário não usam mais startOfWeek nem a janela fixa', () => {
    for (const src of [agenda, mesView]) {
      expect(src).not.toContain('weekStartsOn');
      expect(src).not.toContain('startOfWeek');
    }
    expect(agenda).not.toContain('TL_H_START');
    expect(agenda).not.toContain('TL_H_END');
    expect(agenda).toContain('janelaDaTimeline(');
    expect(agenda).toContain('semanaDoDia(');
    expect(mesView).toContain('gradeDoMes(');
  });
});

describe('página: seletor, carga e bloqueios em Semana e Mês', () => {
  it('estado filtroProfissional: string | "todas", começando na própria pessoa', () => {
    expect(agenda).toMatch(/useState<FiltroProfissional>\(''\)/);
    expect(agenda).toContain('setFiltroProfissional(user.id)');
    expect(agenda).not.toContain('profFiltro');
    expect(agenda).not.toContain('Nunca existe modo');
  });
  it('"Todas as profissionais" no seletor só com agenda.ver_equipe', () => {
    expect(agenda).toMatch(/ehGestao[^\n]*\{ value: FILTRO_TODAS, label: 'Todas as profissionais' \}/);
  });
  it('carga do dia e do mês paginada, filtrando profissional só fora de "Todas"', () => {
    expect(agenda).toContain('buscarPaginas(');
    expect(agenda).toMatch(/filtro !== FILTRO_TODAS\) q = q\.eq\('profissional_id', filtro\)/);
    expect(agenda).toContain("from('agenda_bloqueios')");
    expect(agenda).toContain('setBloqueiosMes(');
  });
  it('Semana (ListaDia) recebe os bloqueios do dia e Mês marca os dias', () => {
    expect(agenda).toMatch(/<ListaDia[^>]*bloqueios=\{bloqueiosDaLista\}/);
    expect(agenda).toMatch(/<MesView[^>]*diasBloqueados=\{diasBloqueadosMes\}/);
    expect(agenda).toContain('<BloqueiosDoDia');
    expect(mesView).toContain('diasBloqueados');
    expect(listaBloq).toContain('aguardando aprovação');
  });
});

describe('revisão da Task 7', () => {
  it('Timeline: cabeçalho dos nomes dentro da mesma área rolável das colunas (rolagem horizontal alinhada em "Todas")', () => {
    const i = agenda.indexOf('ref={scrollRef}');
    const cab = agenda.indexOf('Cabeçalho com nomes dos profissionais');
    expect(i).toBeGreaterThan(0);
    expect(cab).toBeGreaterThan(i);
    // cabeçalho fixo no topo da rolagem vertical e conteúdo com a largura das colunas
    expect(agenda).toMatch(/sticky top-0[^\n]*Cabeçalho|Cabeçalho[\s\S]{0,200}sticky top-0/);
    expect(agenda).toContain("minWidth: 'max-content'");
  });
  it('erro na carga do mês fica na tela como aviso (nunca calendário vazio em silêncio)', () => {
    expect(agenda).toMatch(/const \[erroMes, setErroMes\] = useState\(''\)/);
    expect(agenda).toContain('setErroMes(mensagemErroBanco(');
    expect(agenda).toMatch(/\{erroMes && \(/);
    expect(agenda).not.toContain("showErro(mensagemErroBanco(e as { message?: string; code?: string }, 'carregar o calendário do mês'))");
  });
  it('criar, remover, aprovar ou recusar bloqueio recarrega as marcas do mês', () => {
    expect(agenda).toContain('function recarregarMes()');
    const corpo = (nome: string) => agenda.slice(agenda.indexOf(nome), agenda.indexOf(nome) + 1200);
    expect(corpo('async function deletarBloqueio')).toContain('recarregarMes()');
    expect(corpo('async function aprovarBloqueio')).toContain('recarregarMes()');
    expect(corpo('async function recusarBloqueio')).toContain('recarregarMes()');
    expect(agenda.slice(agenda.indexOf('onSalvo={b =>'), agenda.indexOf('onSalvo={b =>') + 300)).toContain('recarregarMes()');
  });
});

describe('buscarPaginas', () => {
  it('pede páginas até vir uma incompleta e junta tudo', async () => {
    const pedidos: [number, number][] = [];
    const linhas = await buscarPaginas<number>((de, ate) => {
      pedidos.push([de, ate]);
      return Promise.resolve({ data: de === 0 ? [1, 2] : [3], error: null });
    }, 2);
    expect(linhas).toEqual([1, 2, 3]);
    expect(pedidos).toEqual([[0, 1], [2, 3]]);
  });
  it('erro em qualquer página vira exceção (nunca lista cortada em silêncio)', async () => {
    await expect(buscarPaginas(() => Promise.resolve({ data: null, error: { message: 'x' } }))).rejects.toEqual({ message: 'x' });
  });
});
