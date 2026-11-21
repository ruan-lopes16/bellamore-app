// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { carregarContinuacoesDaVespera, limitesVesperaQueContinua } from '@shared/agenda-consultas';
import { continuacoesPorHora, horasDaJanela, intervalosDaVespera, itensDaJanela } from '@shared/agenda-grade';
import { janelaDoDia, resumoDoDia } from '@shared/agenda';

const RAIZ = join(__dirname, '..', '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const DIA = '2026-11-05';
// 23:00 do dia 4 às 01:30 do dia 5 (Brasília)
const noite = { id: 'n1', data_hora_inicio: '2026-11-04T23:00:00-03:00', data_hora_fim: '2026-11-05T01:30:00-03:00', status: 'agendado' };

describe('limitesVesperaQueContinua', () => {
  it('início dentro do dia anterior (Brasília) e fim depois das 00:00 do dia', () => {
    expect(limitesVesperaQueContinua(DIA)).toEqual({
      inicioDeIso: '2026-11-04T03:00:00.000Z',
      inicioAteIso: '2026-11-05T02:59:59.999Z',
      fimDepoisDeIso: '2026-11-05T03:00:00.000Z',
    });
  });
});

describe('carregarContinuacoesDaVespera', () => {
  function dbFalso(resposta: { data: unknown[] | null; error: { message: string } | null }) {
    const chamadas: [string, ...unknown[]][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'gt', 'neq']) q[m] = (...a: unknown[]) => { chamadas.push([m, ...a]); return q; };
    q.order = (...a: unknown[]) => { chamadas.push(['order', ...a]); return Promise.resolve(resposta); };
    return { db: { from: (t: string) => { chamadas.push(['from', t]); return q; } }, chamadas };
  }

  it('filtra pela véspera, fim depois do dia, sem cancelado e pela profissional', async () => {
    const { db, chamadas } = dbFalso({ data: [noite], error: null });
    const r = await carregarContinuacoesDaVespera(db, { empresaId: 'e1', dia: DIA, profissionalId: 'p1', select: '*' });
    expect(r).toEqual([noite]);
    expect(chamadas).toContainEqual(['from', 'agendamentos']);
    expect(chamadas).toContainEqual(['gte', 'data_hora_inicio', '2026-11-04T03:00:00.000Z']);
    expect(chamadas).toContainEqual(['lte', 'data_hora_inicio', '2026-11-05T02:59:59.999Z']);
    expect(chamadas).toContainEqual(['gt', 'data_hora_fim', '2026-11-05T03:00:00.000Z']);
    expect(chamadas).toContainEqual(['neq', 'status', 'cancelado']);
    expect(chamadas).toContainEqual(['eq', 'profissional_id', 'p1']);
  });

  it('sem profissional não filtra por ela', async () => {
    const { db, chamadas } = dbFalso({ data: [], error: null });
    await carregarContinuacoesDaVespera(db, { empresaId: 'e1', dia: DIA, profissionalId: null, select: '*' });
    expect(chamadas.some((c) => c[0] === 'eq' && c[1] === 'profissional_id')).toBe(false);
  });

  it('lança erro quando a consulta falha', async () => {
    const { db } = dbFalso({ data: null, error: { message: 'boom' } });
    await expect(carregarContinuacoesDaVespera(db, { empresaId: 'e1', dia: DIA, select: '*' })).rejects.toThrow();
  });
});

describe('véspera na grade', () => {
  it('vira continuação a partir da hora 0 e estica a janela até 01:30', () => {
    const horas = horasDaJanela(janelaDoDia(itensDaJanela(DIA, [], intervalosDaVespera([noite]))));
    expect(horas).toContain(0);
    expect(horas).toContain(1);
    expect(continuacoesPorHora([noite], DIA, [0, 1, 2])).toEqual({ 0: [noite], 1: [noite] });
  });

  it('cancelado e faltou não esticam a janela', () => {
    expect(intervalosDaVespera([{ ...noite, status: 'cancelado' }, { ...noite, status: 'faltou' }])).toEqual([]);
  });

  it('não entra no resumo do dia nem na contagem (a lista do dia continua separada)', () => {
    const doDia = [{ status: 'agendado', profissional_id: 'p1', valor: 100 }];
    const resumo = resumoDoDia(doDia);
    // A véspera nunca é passada ao resumo: o resultado só depende do que começa no dia.
    expect(resumo).toEqual(resumoDoDia([...doDia]));
    expect(resumoDoDia([...doDia, { status: 'agendado', profissional_id: 'p1', valor: 50 }])).not.toEqual(resumo);
  });
});

describe('varredura das agendas', () => {
  it('as duas agendas do app carregam a véspera e só a passam à grade', () => {
    for (const [tela, hook] of [
      ['mobile/app/(empresa)/agenda.tsx', 'useContinuacoesVespera'],
      ['mobile/app/(profissional)/agenda.tsx', 'useContinuacoesVesperaProfissional'],
    ] as const) {
      const src = ler(tela);
      expect(src).toContain(hook);
      expect(src).toContain('continuacoesPorHora([...agendamentos, ...vespera]');
      expect(src).toContain('intervalosDaVespera(vespera)');
      // Resumo, cartões da hora e KPIs seguem só com os atendimentos do dia.
      expect(src).not.toMatch(/resumoDoDia\([^)]*vespera/);
      expect(src).not.toMatch(/agruparPorHora\([^)]*vespera/);
    }
  });

  it('os hooks do app usam a função compartilhada', () => {
    expect(ler('mobile/hooks/useAgenda.ts')).toContain('carregarContinuacoesDaVespera');
    expect(ler('mobile/hooks/useProfissional.ts')).toContain('carregarContinuacoesDaVespera');
  });

  it('a timeline em colunas do app soma a véspera da própria profissional às continuações', () => {
    const src = ler('mobile/components/agenda/TimelineColunas.tsx');
    expect(src).toContain('vespera.filter((v) => v.profissional_id === c.profissional.id)');
  });

  it('a agenda web carrega a véspera, desenha na Timeline e não a mistura no resumo', () => {
    const src = ler('web/app/(app)/agenda/page.tsx');
    expect(src).toContain('carregarContinuacoesDaVespera<Ag>');
    expect(src).toContain('intervalosDaVespera(vespera)');
    expect(src).toContain('desde ontem');
    expect(src).toContain('vespera={vespera}');
    expect(src).not.toMatch(/resumoDoDia\([^]*?vespera[^]*?\[agsVisiveis\]/);
    expect(src).toMatch(/const resumoDia = useMemo\(\s*\(\) => resumoDoDia\(agsVisiveis/);
  });
});
