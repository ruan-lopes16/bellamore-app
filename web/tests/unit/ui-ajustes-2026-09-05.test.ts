import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

// ═══════════════════════════════════════════════════════════════
// Lote de ajustes 2026-09-05:
//  1. Skeletons (Dashboard / Financeiro / Relatórios) casados com o real
//  2. Timeline da Agenda (web) exibe início–fim
//  4. Taxa de reserva vira opt-in por agendamento (toggle, default desmarcado)
// ═══════════════════════════════════════════════════════════════

// ── 1. Dashboard ─────────────────────────────────────────────

describe('Dashboard — KPI "Fat. Bruto" removido (redundante com o card Receita)', () => {
  const page = read('app/(app)/dashboard/page.tsx');
  it('o array de KPIs do mês não tem mais "Fat. Bruto"', () => {
    expect(page).not.toContain("label: 'Fat. Bruto'");
  });
  it('o ícone TrendingUp, que só era usado por esse card, saiu do import', () => {
    // [^}]* já cruza quebras de linha (não usa `.`), então dispensa a flag /s
    expect(page).not.toMatch(/import \{[^}]*\bTrendingUp\b[^}]*\} from 'lucide-react'/);
  });
  it('o card órfão numa contagem ímpar ocupa a linha no mobile', () => {
    expect(page).toContain('col-span-2 lg:col-span-1');
  });
});

describe('Dashboard — loading.tsx casado com o layout real', () => {
  const sk = read('app/(app)/dashboard/loading.tsx');
  it('4 KPIs do mês no grid real (lg:grid-cols-4, não sm:grid-cols-4)', () => {
    // grade real dos KPIs do mês em page.tsx
    expect(sk).toContain('grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4');
    // a grade antiga (KPIs em sm:grid-cols-4) não pode sobrar
    expect(sk).not.toContain('grid grid-cols-2 sm:grid-cols-4 gap-2');
  });
  it('desenha o bloco "Meta do mês" (a tela real mostra e o skeleton não desenhava)', () => {
    expect(sk).toContain('Meta do mês');
  });
});

// ── Financeiro ───────────────────────────────────────────────

describe('Financeiro — skeleton único compartilhado', () => {
  const comp = read('app/(app)/financeiro/FinanceiroSkeleton.tsx');
  it('exporta as peças reutilizadas pelo page.tsx', () => {
    expect(comp).toContain('export function KpisFinanceiroSkeleton');
    expect(comp).toContain('export function GraficosDespesasSkeleton');
  });
  it('o page.tsx não tem mais o skeleton inline de 2 linhas de 3 KPIs', () => {
    const page = read('app/(app)/financeiro/page.tsx');
    expect(page).not.toContain('{[0,1].map(row =>');
    expect(page).toContain('<KpisFinanceiroSkeleton />');
    expect(page).toContain('<GraficosDespesasSkeleton />');
  });
});

// ── Relatórios ───────────────────────────────────────────────

describe('Relatórios — skeleton único compartilhado', () => {
  const comp = read('app/(app)/relatorios/RelatoriosSkeleton.tsx');
  it('exporta KpiCardSkeleton, reutilizado pelo KpiCard do page.tsx', () => {
    expect(comp).toContain('export function KpiCardSkeleton');
    expect(read('app/(app)/relatorios/page.tsx')).toContain('if (loading) return <KpiCardSkeleton />;');
  });
  it('a grade de KPIs do skeleton é a real (md:grid-cols-4, não md:grid-cols-3)', () => {
    expect(comp).toContain('grid grid-cols-2 md:grid-cols-4');
    expect(comp).not.toContain('md:grid-cols-3');
  });
  it('loading.tsx delega para o mesmo componente', () => {
    expect(read('app/(app)/relatorios/loading.tsx')).toContain("from './RelatoriosSkeleton'");
  });
});

// ── 2. Timeline da Agenda (web) — horário de término ─────────

describe('Timeline (web) — bloco mostra início–fim', () => {
  const src = read('app/(app)/agenda/page.tsx');
  it('o rótulo de hora do bloco concatena data_hora_inicio e data_hora_fim', () => {
    expect(src).toMatch(
      /format\(parseISO\(ag\.data_hora_inicio\), 'HH:mm'\)\}–\{format\(parseISO\(ag\.data_hora_fim\), 'HH:mm'\)/,
    );
  });
});

// ── 4. Taxa de reserva — opt-in por agendamento ─────────────

const fluxosNovoAgendamento: Array<[string, string, string]> = [
  ['web — Agenda (modal Novo)',        'app/(app)/agenda/page.tsx',        'if (aplicarTaxaReserva) {'],
  ['web — perfil da cliente',          'app/(app)/clientes/[id]/page.tsx', 'if (aplicarTaxaReserva) {'],
  ['mobile — novo-agendamento',        '../mobile/app/(empresa)/novo-agendamento.tsx', 'if (novoAg && aplicarTaxaReserva) {'],
];

describe.each(fluxosNovoAgendamento)('Taxa de reserva opt-in — %s', (_nome, arquivo, guardaInsert) => {
  const src = read(arquivo);
  it('tem o estado aplicarTaxaReserva, default desmarcado', () => {
    expect(src).toMatch(/const \[aplicarTaxaReserva, setAplicarTaxaReserva\] = useState\(false\)/);
  });
  it('o insert em taxas_reserva só roda quando o toggle está marcado', () => {
    expect(src).toContain(guardaInsert);
  });
  it('o toggle "Aplicar taxa de reserva" está na UI', () => {
    expect(src).toContain('Aplicar taxa de reserva');
  });
});
