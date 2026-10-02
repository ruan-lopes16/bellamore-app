# Paridade — Fase 2B: Funcionalidades financeiras que faltam em cada plataforma — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar as diferenças de *funcionalidade* financeira entre web e app, usando a fonte única criada na Fase 2A:
- **Comissões** (gestão e profissional) iguais nas duas plataformas: mesma fonte, mesma lista de períodos em Brasília, mesmo agrupamento, mesmo resumo por profissional e "Pagar" = só as pendentes do período exibido (inclusive na Equipe web); Comissões no menu do app com badge.
- **Financeiro do app:** lançamento automático das recorrentes mensais (igual ao web, à prova de erro) e calendário do mês (mesma grade do `FinanceMonthCalendar`).
- **Dashboard:** o app ganha navegação de mês, KPIs do mês, meta, reconquista (45 dias), aniversariantes, despesas vencendo em 7 dias e sparkline; o web ganha o alerta "comandas não fechadas". Toda regra duplicada vai para `shared/`.
- **Relatórios:** o app ganha as 7 abas do web (Financeiro detalhado, Serviços, Equipe com comissão, Clientes top 10 + retenção, Estoque, Comissões, Avaliações); o web ganha "Sumidas +60d" e "Taxa de retorno".
- **Limpeza/robustez** pendente da 2A.

**Architecture:** Novos módulos puros em `shared/` (sem dependências), cada um com um par "regras" (funções puras, TDD) + "consultas" (recebem `ClienteDb`, paginam com `buscarTodasOuLancar`, **lançam erro**):
- `shared/periodos.ts` (ampliado): `instanteMs`, períodos de comissão com navegação, calendário do mês, rótulos e horas em Brasília.
- `shared/comissoes.ts` + `shared/comissoes-consultas.ts`.
- `shared/despesas.ts` (ampliado) + `shared/despesas-consultas.ts`.
- `shared/dashboard.ts` + `shared/dashboard-consultas.ts`.
- `shared/relatorios.ts` + `shared/relatorios-consultas.ts`.

As telas só buscam (via consultas de shared) e desenham (via funções de shared). Os KPIs da grade do Dashboard e dos Relatórios saem de listas montadas em shared (`cartoesKpiDashboard`, `cartoesKpiRelatorio`, `linhasResumoFinanceiro`): as duas plataformas desenham **a mesma lista**, só trocando ícone/cor por `id`.

**Tech Stack:** Next.js (web, client pages + server component do Dashboard), Expo Router + React Native + TanStack Query (mobile), Supabase (Postgres + RLS + PostgREST), Vitest em `web/tests/unit` (testa `shared/` e lê código do mobile **como texto**).

**Spec:** `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md` (Financeiro/Relatórios/Dashboard; Equipe/Comissões) e `CLAUDE.md` › "Sessão 2026-09-30 — Paridade Fase 2A" (lista da Fase 2B).

## Global Constraints

### Decisões do dono (obrigatórias)

1. **Todas as 12 decisões da Fase 2A continuam valendo** (receita, comissão da tabela por `created_at`, lucro, fechamento, Brasília, semana no domingo, ticket, retorno, deltas, alerta de todas as pendentes).
2. **"Pagar" comissão = só as pendentes do período exibido** (decisão de 2026-10-01), em todas as telas: Comissões web e app, aba Comissões dos Relatórios web e app e **Equipe web** (período = mês atual em Brasília). A Equipe mostra, à parte, "+ R$ X de meses anteriores — pague em Comissões". Todo pagamento passa por `pagarComissoes` (`.update` + `.eq('status','pendente')` + `.eq('empresa_id')` + `.select('id')` e conferência das linhas afetadas).
3. **Exportação no app = Fase 2C** (o app vai gerar o mesmo PDF/XLSX do web e abrir o compartilhamento nativo com expo-print/expo-sharing/expo-file-system). Nesta fase os botões de Download do app ficam como estão.
4. **"Agenda hoje" não conta cancelados** nas duas plataformas (decisão de 2026-10-01; não regredir).
5. **Fechamento importado só vale para mês inteiro** no período (confirmado em 2026-10-01); detalhamentos e gráficos diários mostram a nota.
6. **Períodos de comissão** (lista única `PERIODOS_COMISSAO`, nas 4 telas de comissão): Dia, Semana, Mês, Trimestre, Semestre, Ano — **de calendário e navegáveis** (setas; nunca o futuro). É a lista do `ComissoesGestorView` web (referência). Justificativa: pagar comissão exige voltar a um período fechado (ex.: março); a lista dos Relatórios (`PERIODOS_RELATORIO`, móvel e sem navegação de mês) não permite isso.
7. **Calendário do Financeiro no app:** o mesmo calendário do web (setas + rótulo + intervalo + grade de 6 semanas que abre/fecha), não um simples seletor de mês — mesma grade de `gradeCalendarioMes`.
8. **Reconquista = clientes inativos** (mesmo card no web: "Reconquistar"): última visita concluída há **mais de 45 dias** (dias de Brasília), mais antigas primeiro, até 5. **Aniversariantes:** próximos 7 dias, até 8; 29/02 em ano não bissexto = 28/02. **Despesas vencendo:** pendentes com vencimento de hoje a hoje+7 (Brasília). **Comandas não fechadas:** `comanda_id is null`, status fora de cancelado/faltou e `data_hora_fim` < agora.

### Regras técnicas

- Comentários, textos de UI e comunicação em **português**.
- `cd web && npx tsc --noEmit` → **zero erros** ao fim de cada task.
- `cd mobile && npx tsc --noEmit` → **exatamente os 8 erros pré-existentes** (compare por **arquivo + código TS**; a linha pode mudar):
  ```
  app/(empresa)/comissoes.tsx(281,130) TS2769   ← some ao reescrever comissoes.tsx (Task 5), permitido
  app/(empresa)/configuracoes.tsx(191,7) TS2739
  app/(empresa)/configuracoes.tsx(208,7) TS2739
  app/(empresa)/estoque.tsx(498,11) TS2322
  app/(empresa)/relatorios.tsx(~154) TS2322     ← some ao reescrever relatorios.tsx (Task 16), permitido
  hooks/useAgenda.ts(21,18) TS2430
  hooks/useNotificacoes.ts(52,5) TS2322
  hooks/useNotificacoes.ts(59,5) TS2322
  ```
  Nenhum erro novo.
- `cd web && npx vitest run` verde ao fim de cada task e após a última mudança.
- Toda consulta direta ao Supabase confere `.error`. Funções de shared lançam erro.
- Carga que falhou mostra **estado de erro visível**; nunca zeros nem números velhos (web: contador de requisição `reqRef`; app: `'—'` fora do `isSuccess`).
- Todo `.update()`/`.delete()` usa `.select('id')` e confere as linhas afetadas; `insert` em lote também (`.select('id')` + contagem).
- Mutações do app que mexem em dinheiro chamam `invalidarFinanceiro(qc)` (de `@/lib/invalidarFinanceiro`).
- **O web nunca importa módulos do mobile** (`web-nao-importa-mobile.test.ts`); lógica comum mora em `shared/`.
- Consultas que podem passar de 1000 linhas: `buscarTodasOuLancar` com `.order(...).order('id')`.
- Migrations: nenhuma nesta fase.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nenhum arquivo temporário no repositório (`git status --porcelain` limpo além do que a task altera).
- Testes de UI já existentes que precisam continuar valendo: `ComissoesGestorView` mantém `'flex-col gap-3 p-4 sm:flex-row'`, `variant="mobileHeader"`, `bm-mobile-page-header` e **exatamente 1** `useScrollLock(` (`useScrollLock(!!pagando)`); Equipe mantém 2 `useScrollLock(` (não criar modal novo); Dashboard web mantém `'col-span-2 lg:col-span-1'`, `<CountUp value={bruto} decimals={2} />`, sem `TrendingUp`; Relatórios web mantém `function ChartBar` com `self-stretch`, `'flex items-stretch gap-2'` e `'if (loading) return <KpiCardSkeleton />;'`; no `useDashboard.ts` o primeiro `from('agendamentos')` continua sendo o "Agenda hoje" com `.neq('status', 'cancelado')` a menos de 600 caracteres.

Setup (se faltar `node_modules`):
```bash
cd web && npm install --no-audit --no-fund && cd .. && git checkout -- web/package-lock.json
cd mobile && npm install --no-audit --no-fund --legacy-peer-deps && rm -f package-lock.json
```

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `shared/periodos.ts` | + `instanteMs` (sem fuso = UTC), períodos de comissão, rótulos, calendário, `horaBRT` |
| `shared/kpis-financeiros.ts` | lucro/líquido a partir das partes arredondadas |
| `shared/fechamentos-mensais.ts` | só `getFechamentoForMonth` (sai `resolveFinanceiroKpis`/`somarPeriodoComFechamentos`) |
| `shared/kpis-financeiros-consultas.ts` | exporta `buscarTodasOuLancar`; pendentes com `profissional_id, created_at` |
| `shared/comissoes.ts` + `shared/comissoes-consultas.ts` (novos) | normalização, resumo, por profissional, agrupamento, pendentes por período; `carregarComissoesDoPeriodo`, `pagarComissoes` |
| `shared/despesas.ts` + `shared/despesas-consultas.ts` (novo) | lançamento de recorrentes; histórico paginado |
| `shared/dashboard.ts` + `shared/dashboard-consultas.ts` (novos) | reconquista, aniversariantes, meta, comandas, navegação, sparkline, KPIs; consultas e filtros |
| `shared/relatorios.ts` + `shared/relatorios-consultas.ts` (novos) | abas, rankings, insumos, avaliações, cartões e resumo; estoque e avaliações |
| `shared/invalidacao-financeira.ts` | + `'despesas-vencendo'` (Task 12), `'rel-comissoes'` (Task 15) |
| `web/tests/unit/fixtures/fake-db.ts` (novo) | client falso comum dos testes de consultas |
| `web/app/(app)/comissoes/ComissoesGestorView.tsx`, `ComissoesProfissionalView.tsx` | reescritos sobre shared |
| `web/app/(app)/equipe/page.tsx` | Pagar = pendentes do mês |
| `web/app/(app)/financeiro/page.tsx`, `web/components/FinanceMonthCalendar.tsx` | lançamento e calendário via shared |
| `web/app/(app)/dashboard/page.tsx`, `web/components/Sidebar.tsx`, `web/components/SparkBars.tsx` | regras do Dashboard via shared, alerta de comandas |
| `web/app/(app)/relatorios/page.tsx` | abas via shared, Sumidas e Taxa de retorno |
| `mobile/hooks/useComissoesGestor.ts`, `mobile/app/(empresa)/comissoes.tsx`, `mobile/app/(empresa)/mais.tsx` | comissões da gestão + menu |
| `mobile/hooks/useProfissional.ts`, `mobile/app/(profissional)/comissoes.tsx`, `inicio.tsx` | comissões da profissional; `useDiasProfissional` em Brasília |
| `mobile/hooks/useFinanceiro.ts`, `mobile/app/(empresa)/financeiro.tsx`, `mobile/components/CalendarioMesFinanceiro.tsx` (novo) | recorrentes e calendário |
| `mobile/hooks/useDashboard.ts`, `mobile/app/(empresa)/dashboard.tsx`, `mobile/components/SparkLinha.tsx` (novo) | Dashboard completo |
| `mobile/hooks/useRelatorios.ts`, `mobile/app/(empresa)/relatorios.tsx` | 7 abas |

Comandos sempre a partir da raiz do worktree. "Rodar o teste" = `cd web && npx vitest run tests/unit/<arquivo>`; "verificação da task" = `cd web && npx tsc --noEmit && npx vitest run` e, se a task tocou mobile ou shared, `cd mobile && npx tsc --noEmit 2>&1 | grep "error TS"` comparado ao baseline.

---

### Task 1: `shared/periodos.ts` — instantes sem fuso, períodos de comissão, rótulos e calendário

**Files:** Modify `shared/periodos.ts` · Test `web/tests/unit/shared-periodos-fase2b.test.ts`

**Interfaces (Produces):** `instanteMs(ts)`, `type PeriodoComissao`, `PERIODOS_COMISSAO`, `limitesPeriodoComissao(periodo, hoje, deslocamento=0)`, `rotuloPeriodoComissao(periodo, l)`, `DIAS_SEMANA_ABREV`, `rotuloMesAno(chave)`, `rotuloDiaCurto(dia)`, `rotuloDiaExtenso(dia)`, `rotuloDataBR(dia)`, `type CelulaCalendario`, `gradeCalendarioMes(chave, destaque?)`, `rotuloIntervaloMes(chave)`, `chaveDiaExibido(d: Date)`, `horaBRT(ts)`, `rotuloDataHoraBRT(ts)`.

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/shared-periodos-fase2b.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chaveDiaBRT, chaveMesBRT, contemInstante, instanteMs, limitesDias, limitesMes,
  PERIODOS_COMISSAO, limitesPeriodoComissao, rotuloPeriodoComissao, rotuloDiaCurto, rotuloMesAno,
  rotuloDiaExtenso, rotuloDataBR, gradeCalendarioMes, rotuloIntervaloMes, chaveDiaExibido, horaBRT,
  rotuloDataHoraBRT, DIAS_SEMANA_ABREV, type PeriodoComissao,
} from '@shared/periodos';

describe('instante sem fuso é UTC (não depende do fuso do aparelho)', () => {
  const tz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/Sao_Paulo'; });
  afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
  it('instanteMs', () => {
    expect(instanteMs('2026-10-01T02:30:00')).toBe(Date.parse('2026-10-01T02:30:00Z'));
    expect(instanteMs('2026-10-01 02:30:00')).toBe(Date.parse('2026-10-01T02:30:00Z'));
    expect(instanteMs('2026-10-01T02:30:00.123')).toBe(Date.parse('2026-10-01T02:30:00.123Z'));
    expect(instanteMs('2026-10-01T02:30:00+00:00')).toBe(Date.parse('2026-10-01T02:30:00Z'));
    expect(instanteMs('2026-10-01T02:30:00-03:00')).toBe(Date.parse('2026-10-01T05:30:00Z'));
  });
  it('chaveDiaBRT, chaveMesBRT e contemInstante usam a mesma leitura', () => {
    expect(chaveDiaBRT('2026-10-01T02:30:00')).toBe('2026-09-30');
    expect(chaveMesBRT('2026-10-01 02:30:00')).toBe('2026-09');
    expect(contemInstante(limitesMes('2026-09'), '2026-10-01T02:59:59')).toBe(true);
    expect(contemInstante(limitesMes('2026-09'), '2026-10-01T03:00:00')).toBe(false);
    expect(chaveDiaBRT('2026-09-30')).toBe('2026-09-30');
  });
});

describe('períodos de comissão — lista única, calendário, navegação', () => {
  const hoje = '2026-09-30'; // quarta
  const ini = (p: PeriodoComissao, d: number, h = hoje) => {
    const l = limitesPeriodoComissao(p, h, d); return [l.startDate, l.endDate];
  };
  it('lista única', () => {
    expect(PERIODOS_COMISSAO.map(p => p.key)).toEqual(['dia', 'semana', 'mes', 'trimestre', 'semestre', 'ano']);
    expect(PERIODOS_COMISSAO.map(p => p.label)).toEqual(['Dia', 'Semana', 'Mês', 'Trimestre', 'Semestre', 'Ano']);
  });
  it('dia, semana (domingo), mês', () => {
    expect(limitesPeriodoComissao('dia', hoje)).toEqual(limitesDias(hoje, hoje));
    expect(ini('dia', -30)).toEqual(['2026-08-31', '2026-08-31']);
    expect(ini('semana', 0)).toEqual(['2026-09-27', '2026-10-03']);
    expect(ini('semana', -1)).toEqual(['2026-09-20', '2026-09-26']);
    expect(limitesPeriodoComissao('mes', hoje)).toEqual(limitesMes('2026-09'));
    expect(limitesPeriodoComissao('mes', hoje, -9)).toEqual(limitesMes('2025-12'));
  });
  it('trimestre, semestre e ano de calendário', () => {
    expect(ini('trimestre', 0)).toEqual(['2026-07-01', '2026-09-30']);
    expect(ini('trimestre', -1)).toEqual(['2026-04-01', '2026-06-30']);
    expect(ini('trimestre', -3)).toEqual(['2025-10-01', '2025-12-31']);
    expect(ini('trimestre', 0, '2026-10-01')).toEqual(['2026-10-01', '2026-12-31']);
    expect(ini('semestre', 0)).toEqual(['2026-07-01', '2026-12-31']);
    expect(ini('semestre', -1)).toEqual(['2026-01-01', '2026-06-30']);
    expect(ini('semestre', -2)).toEqual(['2025-07-01', '2025-12-31']);
    expect(ini('ano', -1)).toEqual(['2025-01-01', '2025-12-31']);
  });
  it('rótulos', () => {
    const r = (p: PeriodoComissao, d = 0) => rotuloPeriodoComissao(p, limitesPeriodoComissao(p, hoje, d));
    expect(r('dia')).toBe('Qua, 30 de set 2026');
    expect(r('semana')).toBe('27/09 – 03/10/2026');
    expect(r('mes')).toBe('Setembro 2026');
    expect(r('trimestre')).toBe('3º Trimestre 2026');
    expect(r('semestre')).toBe('2º Semestre 2026');
    expect(r('semestre', -1)).toBe('1º Semestre 2026');
    expect(r('ano')).toBe('2026');
  });
});

describe('rótulos, calendário e horas', () => {
  it('rótulos curtos', () => {
    expect(DIAS_SEMANA_ABREV).toEqual(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
    expect(rotuloDiaCurto('2026-09-27')).toBe('Dom, 27 de set');
    expect(rotuloMesAno('2026-03')).toBe('Março 2026');
    expect(rotuloDiaExtenso('2026-07-16')).toBe('16 de julho de 2026');
    expect(rotuloDataBR('2026-09-05')).toBe('05/09/2026');
    expect(rotuloIntervaloMes('2026-07')).toBe('01/07 - 31/07');
    expect(rotuloIntervaloMes('2028-02')).toBe('01/02 - 29/02');
  });
  it('grade de 6 semanas começando no domingo', () => {
    const g = gradeCalendarioMes('2026-07', '2026-07-16');
    expect(g).toHaveLength(42);
    expect(g[0]).toEqual({ dia: '2026-06-28', numero: 28, foraDoMes: true, destacado: false });
    expect(g[41].dia).toBe('2026-08-08');
    expect(g.find(c => c.destacado)?.dia).toBe('2026-07-16');
    expect(g.filter(c => !c.foraDoMes)).toHaveLength(31);
    expect(gradeCalendarioMes('2026-11')[0].dia).toBe('2026-11-01');
  });
  it('dia exibido e horas em Brasília', () => {
    expect(chaveDiaExibido(new Date(2026, 6, 16, 23, 0))).toBe('2026-07-16');
    expect(horaBRT('2026-09-30T12:05:00Z')).toBe('09:05');
    expect(horaBRT('2026-10-01T02:30:00+00:00')).toBe('23:30');
    expect(rotuloDataHoraBRT('2026-10-01T02:30:00Z')).toBe('30/09 às 23:30');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha** (exports inexistentes).

- [ ] **Step 3: Implementar.** Logo após `diaDoMs`, acrescente:

```ts
const RE_SEM_FUSO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Milissegundos UTC de um instante. String SEM fuso ('2026-09-30T10:00:00' ou
 * com espaço) é lida como UTC — é como o Postgres a guarda. `Date.parse` a
 * leria no fuso do aparelho e o dia mudaria conforme o celular.
 */
export function instanteMs(ts: string): number {
  return Date.parse(RE_SEM_FUSO.test(ts) ? `${ts.replace(' ', 'T')}Z` : ts);
}
```

Em `chaveDiaBRT` troque `Date.parse(valor)` por `instanteMs(valor)`; em `contemInstante` troque `const ms = Date.parse(ts);` por `const ms = instanteMs(ts);`. No fim do arquivo acrescente:

```ts
// ── Comissões: períodos de calendário com navegação (lista ÚNICA web + mobile) ──

export type PeriodoComissao = 'dia' | 'semana' | 'mes' | 'trimestre' | 'semestre' | 'ano';

export const PERIODOS_COMISSAO: { key: PeriodoComissao; label: string }[] = [
  { key: 'dia', label: 'Dia' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mês' },
  { key: 'trimestre', label: 'Trimestre' },
  { key: 'semestre', label: 'Semestre' },
  { key: 'ano', label: 'Ano' },
];

function blocoDoCalendario(hoje: string, meses: number, deslocamento: number): Limites {
  const m = Number(hoje.slice(5, 7));
  const inicioBloco = `${hoje.slice(0, 4)}-${pad(Math.floor((m - 1) / meses) * meses + 1)}`;
  const ini = somarMeses(inicioBloco, meses * deslocamento);
  return limitesDias(`${ini}-01`, ultimoDiaDoMes(somarMeses(ini, meses - 1)));
}

/**
 * Limites do período de comissão. `deslocamento` = quantos períodos a partir
 * do atual (0 = atual, −1 = anterior). Trimestre/semestre são de calendário.
 */
export function limitesPeriodoComissao(periodo: PeriodoComissao, hoje: string, deslocamento = 0): Limites {
  switch (periodo) {
    case 'dia': {
      const d = somarDias(hoje, deslocamento);
      return limitesDias(d, d);
    }
    case 'semana': {
      const ref = somarDias(hoje, 7 * deslocamento);
      const ini = somarDias(ref, -diaDaSemana(ref));
      return limitesDias(ini, somarDias(ini, 6));
    }
    case 'mes':
      return limitesMes(somarMeses(hoje.slice(0, 7), deslocamento));
    case 'trimestre':
      return blocoDoCalendario(hoje, 3, deslocamento);
    case 'semestre':
      return blocoDoCalendario(hoje, 6, deslocamento);
    case 'ano': {
      const a = Number(hoje.slice(0, 4)) + deslocamento;
      return limitesDias(`${a}-01-01`, `${a}-12-31`);
    }
  }
}

export const DIAS_SEMANA_ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 'Setembro 2026' para '2026-09' (ou um dia do mês). */
export function rotuloMesAno(chave: string): string {
  return `${capitalizar(MESES[Number(chave.slice(5, 7)) - 1])} ${chave.slice(0, 4)}`;
}
/** 'Qua, 30 de set'. */
export function rotuloDiaCurto(dia: string): string {
  return `${DIAS_SEMANA_ABREV[diaDaSemana(dia)]}, ${dia.slice(8, 10)} de ${MESES_ABREV[Number(dia.slice(5, 7)) - 1]}`;
}
/** '16 de julho de 2026'. */
export function rotuloDiaExtenso(dia: string): string {
  return `${Number(dia.slice(8, 10))} de ${MESES[Number(dia.slice(5, 7)) - 1]} de ${dia.slice(0, 4)}`;
}
/** '05/09/2026'. */
export function rotuloDataBR(dia: string): string {
  return ddmmaaaa(dia);
}

export function rotuloPeriodoComissao(periodo: PeriodoComissao, l: Limites): string {
  const ano = l.startDate.slice(0, 4);
  const mes = Number(l.startDate.slice(5, 7));
  switch (periodo) {
    case 'dia': return `${rotuloDiaCurto(l.startDate)} ${ano}`;
    case 'semana': return `${ddmm(l.startDate)} – ${ddmmaaaa(l.endDate)}`;
    case 'mes': return rotuloMesAno(l.startDate);
    case 'trimestre': return `${Math.floor((mes - 1) / 3) + 1}º Trimestre ${ano}`;
    case 'semestre': return `${mes <= 6 ? 1 : 2}º Semestre ${ano}`;
    case 'ano': return ano;
  }
}

// ── Calendário do mês (Financeiro web e app) ──────────────────────

export type CelulaCalendario = { dia: string; numero: number; foraDoMes: boolean; destacado: boolean };

/** 42 dias (6 semanas, domingo primeiro) que cobrem o mês 'yyyy-MM'. */
export function gradeCalendarioMes(chave: string, diaDestacado?: string | null): CelulaCalendario[] {
  const k = chave.slice(0, 7);
  const primeiro = `${k}-01`;
  const inicio = somarDias(primeiro, -diaDaSemana(primeiro));
  return Array.from({ length: 42 }, (_, i) => {
    const dia = somarDias(inicio, i);
    return { dia, numero: Number(dia.slice(8, 10)), foraDoMes: dia.slice(0, 7) !== k, destacado: dia === diaDestacado };
  });
}

/** '01/07 - 31/07'. */
export function rotuloIntervaloMes(chave: string): string {
  const k = chave.slice(0, 7);
  return `${ddmm(`${k}-01`)} - ${ddmm(ultimoDiaDoMes(k))}`;
}

/** 'yyyy-MM-dd' do Date do seletor da tela (calendário local, sem fuso). */
export function chaveDiaExibido(d: Date): string {
  return `${chaveDoMesExibido(d)}-${pad(d.getDate())}`;
}

/** 'HH:mm' em Brasília (o servidor do web roda em UTC). */
export function horaBRT(ts: string): string {
  const d = new Date(instanteMs(ts) - OFFSET_BRT_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** '30/09 às 23:30' em Brasília. */
export function rotuloDataHoraBRT(ts: string): string {
  return `${ddmm(chaveDiaBRT(ts))} às ${horaBRT(ts)}`;
}
```

- [ ] **Step 4: Verificação da task** (inclui `tsc` mobile).
- [ ] **Step 5: Commit**
```bash
git add shared/periodos.ts web/tests/unit/shared-periodos-fase2b.test.ts
git commit -m "feat(shared): periodos de comissao, calendario do mes e instantes sem fuso em UTC" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `shared/kpis-financeiros.ts` — lucro das partes arredondadas, testes pendentes da 2A e limpeza

**Files:** Modify `shared/kpis-financeiros.ts`, `shared/fechamentos-mensais.ts`, `web/tests/unit/financeiro-fechamentos-mensais.test.ts` · Test `web/tests/unit/shared-kpis-financeiros-fase2b.test.ts`

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/shared-kpis-financeiros-fase2b.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, resumoMetodosPagamento, arredondar, DADOS_VAZIOS,
} from '@shared/kpis-financeiros';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const SET = limitesMes('2026-09');

describe('lucro e líquido = conta das partes exibidas (consistência de 1 centavo)', () => {
  it('meio centavo não some no lucro', () => {
    const k = calcularKpisFinanceiros({
      ...DADOS_VAZIOS,
      vendas: [{ id: 'v', valor_final: 0.006, created_at: '2026-09-10T12:00:00Z' }],
      pagamentos: [{ id: 'g', metodo: 'credito', valor: 0.006, valor_liquido: 0.002, created_at: '2026-09-10T12:00:00Z' }],
      despesas: [{ id: 'd', valor: 0.004, categoria: null, status: 'pago', data_pagamento: '2026-09-10' }],
    }, SET);
    expect([k.bruto, k.taxasCartao, k.despesas]).toEqual([0.01, 0, 0]);
    expect(k.liquidoAposTaxas).toBe(0.01);
    expect(k.lucro).toBe(0.01);
  });
  it('invariante na fixture', () => {
    const k = calcularKpisFinanceiros(fixtureSetembro(), SET);
    expect(k.lucro).toBe(arredondar(k.bruto - k.taxasCartao - k.comissoes - k.despesas));
    expect(k.liquidoAposTaxas).toBe(arredondar(k.bruto - k.taxasCartao));
  });
});

describe('casos que a 2A deixou sem teste', () => {
  it('mês fechado: comissões do fechamento, pendentes continuam ao vivo', () => {
    const k = calcularKpisFinanceiros(
      { ...fixtureSetembro(), fechamentos: [{ mes: '2026-09-01', receita_bruta: 9000, comissao_paga: 999 }] }, SET);
    expect(k.comissoes).toBe(999);
    expect(k.comissoesPendentes).toBe(80);
    expect(k.taxasCartao).toBe(0);
    expect(k.mesesComFechamento).toEqual(['2026-09']);
  });
  it('valor_liquido em string conta na taxa de cartão', () => {
    const k = calcularKpisFinanceiros({ ...DADOS_VAZIOS, pagamentos: [
      { id: 'g', metodo: 'credito', valor: '200.00', valor_liquido: '194.00', created_at: '2026-09-10T13:30:00Z' },
    ] }, SET);
    expect(k.taxasCartao).toBe(6);
  });
  it('pagamento de 01/10 00:00 BRT fica fora de setembro (cartão e formas de pagamento)', () => {
    const dados = { ...DADOS_VAZIOS, pagamentos: [
      { id: 'g1', metodo: 'credito', valor: 100, valor_liquido: 97, created_at: '2026-09-15T12:00:00Z' },
      { id: 'g2', metodo: 'debito', valor: 50, valor_liquido: 49, created_at: '2026-10-01T03:00:00Z' },
    ] };
    expect(calcularKpisFinanceiros(dados, SET).taxasCartao).toBe(3);
    expect(resumoMetodosPagamento(recortarDados(dados, SET).pagamentos).map(m => m.metodo)).toEqual(['credito']);
  });
});
```

- [ ] **Step 2: Rodar** — falha o primeiro teste (lucro `0` / `-0`).

- [ ] **Step 3: `calcularKpisFinanceiros`.** Antes do `return`, acrescente:
```ts
  // Lucro e líquido a partir das partes JÁ arredondadas: a conta que a tela
  // mostra (bruto − cartão − comissões − despesas) fecha no centavo.
  const brutoR = arredondar(bruto);
  const cartaoR = arredondar(taxasCartao);
  const comissoesR = arredondar(comissoes);
  const despesasR = arredondar(despesas);
```
e no objeto retornado use `bruto: brutoR`, `taxasCartao: cartaoR`, `liquidoAposTaxas: arredondar(brutoR - cartaoR)`, `comissoes: comissoesR`, `despesas: despesasR`, `lucro: arredondar(brutoR - cartaoR - comissoesR - despesasR)`.

- [ ] **Step 4: Limpeza (item da 2A).** Confirme sem uso:
```bash
grep -rn "somarPeriodoComFechamentos\|resolveFinanceiroKpis\|FinanceiroKpisBase\|ValoresPorMes" web/app web/components web/lib mobile/app mobile/hooks shared
```
Esperado: só `shared/fechamentos-mensais.ts`. Substitua o arquivo inteiro por:
```ts
/**
 * @file fechamentos-mensais.ts
 * Leitura do fechamento mensal importado (financeiro_ajustes_mensais). A regra
 * de aplicação (substitui receita e comissão do mês INTEIRO e zera a taxa de
 * cartão) mora só em calcularKpisFinanceiros (@shared/kpis-financeiros).
 */
export type FinanceiroFechamentoRow = { mes: string; receita_bruta: number | null; comissao_paga: number | null };
export type FinanceiroFechamento = { receitaBruta: number; comissao: number };

export function getFechamentoForMonth(rows: FinanceiroFechamentoRow[], monthKey: string): FinanceiroFechamento | null {
  const row = rows.find(item => item.mes.slice(0, 7) === monthKey);
  if (!row) return null;
  return { receitaBruta: roundMoney(Number(row.receita_bruta ?? 0)), comissao: roundMoney(Number(row.comissao_paga ?? 0)) };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
```
E substitua `web/tests/unit/financeiro-fechamentos-mensais.test.ts` inteiro por:
```ts
import { describe, expect, it } from 'vitest';
import { getFechamentoForMonth } from '@shared/fechamentos-mensais';

describe('getFechamentoForMonth', () => {
  it('lê receita e comissão do mês pedido', () => {
    expect(getFechamentoForMonth([{ mes: '2026-01-01', receita_bruta: 6491.08, comissao_paga: 2920.99 }], '2026-01'))
      .toEqual({ receitaBruta: 6491.08, comissao: 2920.99 });
  });
  it('null vira zero', () => {
    expect(getFechamentoForMonth([{ mes: '2026-05-01', receita_bruta: null, comissao_paga: null }], '2026-05'))
      .toEqual({ receitaBruta: 0, comissao: 0 });
  });
  it('mês sem fechamento → null', () => {
    expect(getFechamentoForMonth([{ mes: '2026-05-01', receita_bruta: 1, comissao_paga: 1 }], '2026-06')).toBeNull();
  });
});
```
(A regra do fechamento já é coberta em `shared-kpis-financeiros.test.ts` › "fechamento mensal importado".)

- [ ] **Step 5: Verificação da task** (inclui mobile).
- [ ] **Step 6: Commit** — `git add shared/kpis-financeiros.ts shared/fechamentos-mensais.ts web/tests/unit/financeiro-fechamentos-mensais.test.ts web/tests/unit/shared-kpis-financeiros-fase2b.test.ts` · mensagem `fix(shared): lucro das partes arredondadas, testes pendentes e remocao de somarPeriodoComFechamentos`.

---

### Task 3: `shared/comissoes.ts` + `shared/comissoes-consultas.ts`

**Files:** Create `shared/comissoes.ts`, `shared/comissoes-consultas.ts`, `web/tests/unit/fixtures/fake-db.ts`, `web/tests/unit/shared-comissoes.test.ts`, `web/tests/unit/shared-comissoes-consultas.test.ts` · Modify `shared/kpis-financeiros-consultas.ts`

**Interfaces (Produces):** ver Mapa. `buscarTodasOuLancar<T>(montar)` exportado; `carregarComissoesPendentes` devolve `{ id, profissional_id, valor_comissao, created_at }[]`.

- [ ] **Step 1: Fake DB comum**
```ts
// web/tests/unit/fixtures/fake-db.ts
export type Op = [string, unknown[]];
export type Chamada = { tabela: string; ops: Op[] };
type Resposta = { data: unknown[] | null; error: { message: string } | null };

/** Client falso: grava a cadeia; `range` devolve `linhas[tabela]`; `update(...).select()` devolve `respostaUpdate`. */
export function fakeDb(opcoes: {
  linhas?: Record<string, unknown[]>;
  erroEm?: string;
  respostaUpdate?: (tabela: string, ids: string[], lote: number) => Resposta;
} = {}) {
  const chamadas: Chamada[] = [];
  let lote = 0;
  const db = {
    from(tabela: string) {
      const chamada: Chamada = { tabela, ops: [] };
      chamadas.push(chamada);
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') return undefined;
          return (...args: unknown[]) => {
            chamada.ops.push([String(prop), args]);
            if (prop === 'range') {
              if (tabela === opcoes.erroEm) return Promise.resolve({ data: null, error: { message: `falha em ${tabela}` } });
              const [de, ate] = args as [number, number];
              return Promise.resolve({ data: (opcoes.linhas?.[tabela] ?? []).slice(de, ate + 1), error: null });
            }
            if (prop === 'select' && chamada.ops.some(([m]) => m === 'update')) {
              const em = chamada.ops.find(([m]) => m === 'in');
              const ids = (em ? em[1][1] : []) as string[];
              return Promise.resolve(opcoes.respostaUpdate
                ? opcoes.respostaUpdate(tabela, ids, lote++)
                : { data: ids.map(id => ({ id })), error: null });
            }
            return builder;
          };
        },
      });
      return builder;
    },
  };
  return { db, chamadas };
}
export const opsDe = (chamadas: Chamada[], tabela: string) => chamadas.filter(c => c.tabela === tabela).map(c => c.ops);

/** Builder que só grava (para os `aplicarFiltro...`). */
export function gravador() {
  const ops: Op[] = [];
  const b: Record<string, unknown> = new Proxy({}, {
    get(_a, prop) { return (...args: unknown[]) => { ops.push([String(prop), args]); return b; }; },
  });
  return { b, ops };
}
```

- [ ] **Step 2: Testes que falham**

```ts
// web/tests/unit/shared-comissoes.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import {
  normalizarComissoes, resumoComissoes, filtrarComissoes, comissoesPorProfissional, agruparComissoesPorData,
  pendentesPorProfissional, rotuloPercentualComissao, textoConfirmarPagamento, FILTROS_COMISSAO,
  type ComissaoDetalheRow,
} from '@shared/comissoes';

const ROWS: ComissaoDetalheRow[] = [
  { id: 'k1', profissional_id: 'p1', agendamento_id: 'a1', valor_servico: '200.00', percentual: '40', valor_comissao: '80.00',
    status: 'pendente', created_at: '2026-09-10T13:30:00Z', profissional: { nome: 'Ana' },
    agendamento: { data_hora_inicio: '2026-09-10T13:00:00Z', valor: '200', servico: { nome: 'Limpeza', categoria: 'facial', categoria_id: null }, cliente: { nome: 'Carla' } } },
  { id: 'k2', profissional_id: 'p1', agendamento_id: 'a2', valor_servico: 100, percentual: 30, valor_comissao: 30,
    status: 'pago', created_at: '2026-10-01T02:45:00Z', profissional: { nome: 'Ana' },
    agendamento: { data_hora_inicio: '2026-10-01T02:00:00Z', valor: 100, servico: { nome: 'Drenagem' }, cliente: { nome: 'Duda' } } },
  { id: 'k3', profissional_id: 'p2', agendamento_id: null, valor_servico: 150, percentual: 40, valor_comissao: 60,
    status: 'pendente', created_at: '2026-08-31T23:00:00Z', profissional: null, agendamento: null },
];
const itens = normalizarComissoes(ROWS);

describe('normalização (strings do numeric, nomes ausentes)', () => {
  it('converte e preenche', () => {
    expect(itens[0]).toMatchObject({ valorServico: 200, percentual: 40, valorComissao: 80, status: 'pendente',
      profissionalNome: 'Ana', servicoNome: 'Limpeza', clienteNome: 'Carla', valorAtendimento: 200 });
    expect(itens[2]).toMatchObject({ profissionalNome: 'Profissional', servicoNome: 'Serviço', clienteNome: '—',
      dataAtendimento: null, valorAtendimento: null });
  });
});

describe('resumo, filtros e cards por profissional', () => {
  it('resumo', () => {
    expect(resumoComissoes(itens)).toEqual({ total: 170, pendente: 140, pago: 30, quantidade: 3 });
  });
  it('filtros', () => {
    expect(FILTROS_COMISSAO.map(f => f.key)).toEqual(['todas', 'pendentes', 'pagas']);
    expect(filtrarComissoes(itens, 'pendentes').map(c => c.id)).toEqual(['k1', 'k3']);
    expect(filtrarComissoes(itens, 'pagas').map(c => c.id)).toEqual(['k2']);
  });
  it('por profissional: inclui inativa, percentual único ou null, ids pendentes', () => {
    const p = comissoesPorProfissional(itens);
    expect(p.map(x => [x.profissionalId, x.total, x.pendente, x.pago, x.atendimentos])).toEqual([
      ['p1', 110, 80, 30, 2], ['p2', 60, 60, 0, 1],
    ]);
    expect(p[0].percentual).toBeNull();
    expect(p[1].percentual).toBe(40);
    expect(p[0].idsPendentes).toEqual(['k1']);
  });
  it('soma dos cards = resumo geral', () => {
    const p = comissoesPorProfissional(itens);
    expect(p.reduce((s, x) => s + x.pendente, 0)).toBe(resumoComissoes(itens).pendente);
  });
});

describe('agrupamento por data em Brasília', () => {
  it('por dia (dia/semana/mês) — data do atendimento, senão created_at', () => {
    expect(agruparComissoesPorData(itens, 'mes').map(g => [g.chave, g.rotulo])).toEqual([
      ['2026-09-30', 'Qua, 30 de set'], ['2026-09-10', 'Qui, 10 de set'], ['2026-08-31', 'Seg, 31 de ago'],
    ]);
  });
  it('por mês (trimestre/semestre/ano)', () => {
    expect(agruparComissoesPorData(itens, 'trimestre').map(g => [g.chave, g.rotulo, g.itens.length])).toEqual([
      ['2026-09', 'Setembro 2026', 2], ['2026-08', 'Agosto 2026', 1],
    ]);
  });
});

describe('pendentes por profissional (Equipe: Pagar = período)', () => {
  it('separa o período do que é anterior', () => {
    const r = pendentesPorProfissional([
      { id: 'k1', profissional_id: 'p1', valor_comissao: '80.00', created_at: '2026-09-10T13:30:00Z' },
      { id: 'k3', profissional_id: 'p2', valor_comissao: 60, created_at: '2026-08-31T23:00:00Z' },
    ], limitesMes('2026-09'));
    expect(r.p1).toEqual({ idsDoPeriodo: ['k1'], valorDoPeriodo: 80, valorAnterior: 0 });
    expect(r.p2).toEqual({ idsDoPeriodo: [], valorDoPeriodo: 0, valorAnterior: 60 });
  });
});

describe('textos iguais nas duas plataformas', () => {
  it('percentual e confirmação', () => {
    expect(rotuloPercentualComissao(40)).toBe('40%');
    expect(rotuloPercentualComissao(37.5)).toBe('37,5%');
    expect(rotuloPercentualComissao(null)).toBe('vários %');
    expect(textoConfirmarPagamento('Ana', 'R$ 80', 'Setembro 2026'))
      .toBe('Marcar como pagas as comissões pendentes de Ana em Setembro 2026 (R$ 80)?');
  });
});
```

```ts
// web/tests/unit/shared-comissoes-consultas.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import { carregarComissoesDoPeriodo, pagarComissoes, COLUNAS_COMISSAO_DETALHE } from '@shared/comissoes-consultas';
import { carregarComissoesPendentes } from '@shared/kpis-financeiros-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const SET = limitesMes('2026-09');

describe('carregarComissoesDoPeriodo', () => {
  it('created_at em Brasília, ordem estável, colunas únicas', async () => {
    const { db, chamadas } = fakeDb();
    await carregarComissoesDoPeriodo(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'comissoes');
    expect(ops).toContainEqual(['select', [COLUNAS_COMISSAO_DETALHE]]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['gte', ['created_at', SET.startIso]]);
    expect(ops).toContainEqual(['lte', ['created_at', SET.endIso]]);
    expect(ops).toContainEqual(['order', ['id']]);
    expect(ops.some(([m, a]) => m === 'eq' && a[0] === 'profissional_id')).toBe(false);
  });
  it('profissional: filtra pelo próprio id', async () => {
    const { db, chamadas } = fakeDb();
    await carregarComissoesDoPeriodo(db, 'emp', SET, { profissionalId: 'p1' });
    expect(opsDe(chamadas, 'comissoes')[0]).toContainEqual(['eq', ['profissional_id', 'p1']]);
  });
  it('pagina e lança erro', async () => {
    const { db } = fakeDb({ linhas: { comissoes: Array.from({ length: 1500 }, (_, i) => ({ id: `k${i}` })) } });
    expect(await carregarComissoesDoPeriodo(db, 'emp', SET)).toHaveLength(1500);
    await expect(carregarComissoesDoPeriodo(fakeDb({ erroEm: 'comissoes' }).db, 'emp', SET)).rejects.toThrow('falha em comissoes');
  });
});

describe('pagarComissoes — só pendentes, da empresa, conferindo as linhas', () => {
  it('filtros e .select(id)', async () => {
    const { db, chamadas } = fakeDb();
    const r = await pagarComissoes(db, 'emp', ['a', 'a', 'b']);
    const [ops] = opsDe(chamadas, 'comissoes');
    expect(ops).toContainEqual(['update', [{ status: 'pago' }]]);
    expect(ops).toContainEqual(['in', ['id', ['a', 'b']]]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['eq', ['status', 'pendente']]);
    expect(ops).toContainEqual(['select', ['id']]);
    expect(r).toEqual({ confirmados: ['a', 'b'], naoConfirmados: [], erro: null });
  });
  it('lotes de 150 ids', async () => {
    const { db, chamadas } = fakeDb();
    await pagarComissoes(db, 'emp', Array.from({ length: 320 }, (_, i) => `k${i}`));
    expect(opsDe(chamadas, 'comissoes').map(ops => (ops.find(([m]) => m === 'in')![1][1] as string[]).length)).toEqual([150, 150, 20]);
  });
  it('RLS devolve menos linhas → naoConfirmados', async () => {
    const { db } = fakeDb({ respostaUpdate: (_t, ids) => ({ data: ids.slice(1).map(id => ({ id })), error: null }) });
    expect(await pagarComissoes(db, 'emp', ['a', 'b'])).toEqual({ confirmados: ['b'], naoConfirmados: ['a'], erro: null });
  });
  it('erro no 2º lote: para, devolve o que confirmou e a mensagem', async () => {
    const { db } = fakeDb({ respostaUpdate: (_t, ids, lote) => lote === 1
      ? { data: null, error: { message: 'falhou' } } : { data: ids.map(id => ({ id })), error: null } });
    const r = await pagarComissoes(db, 'emp', Array.from({ length: 200 }, (_, i) => `k${i}`));
    expect(r.confirmados).toHaveLength(150);
    expect(r.naoConfirmados).toHaveLength(50);
    expect(r.erro).toBe('falhou');
  });
  it('sem ids, não consulta', async () => {
    const { db, chamadas } = fakeDb();
    expect(await pagarComissoes(db, 'emp', [])).toEqual({ confirmados: [], naoConfirmados: [], erro: null });
    expect(chamadas).toHaveLength(0);
  });
});

describe('carregarComissoesPendentes traz profissional e data (Equipe)', () => {
  it('colunas', async () => {
    const { db, chamadas } = fakeDb();
    await carregarComissoesPendentes(db, 'emp');
    expect(opsDe(chamadas, 'comissoes')[0]).toContainEqual(['select', ['id, profissional_id, valor_comissao, created_at']]);
  });
});
```

- [ ] **Step 3: Rodar e confirmar a falha.**

- [ ] **Step 4: `shared/kpis-financeiros-consultas.ts`.** Renomeie `async function todas<T>` para `export async function buscarTodasOuLancar<T>` (JSDoc: "Pagina com buscarTodasPaginas e LANÇA o erro do banco — base de todas as consultas de shared.") e troque todas as chamadas `todas<…>(` / `todas((` por `buscarTodasOuLancar`. Confira: `grep -n "todas[<(]" shared/kpis-financeiros-consultas.ts` não devolve nada. Em `carregarComissoesPendentes`, mude a assinatura e o select:
```ts
export type ComissaoPendenteRow = { id: string; profissional_id: string; valor_comissao: number | string; created_at: string };

/** Todas as comissões pendentes da empresa, de qualquer mês (alerta do Dashboard, badge do menu e Equipe). */
export async function carregarComissoesPendentes(db: ClienteDb, empresaId: string): Promise<ComissaoPendenteRow[]> {
  return buscarTodasOuLancar<ComissaoPendenteRow>((de, ate) => db.from('comissoes')
    .select('id, profissional_id, valor_comissao, created_at')
    .eq('empresa_id', empresaId).eq('status', 'pendente')
    .order('created_at').order('id')
    .range(de, ate));
}
```

- [ ] **Step 5: Criar `shared/comissoes.ts`**

```ts
/**
 * @file comissoes.ts
 * Regras ÚNICAS das telas de comissão de web e mobile: Comissões (gestão e
 * profissional), aba Comissões dos Relatórios e "Pagar" da Equipe.
 * - Fonte: tabela `comissoes` (valor gerado), período por created_at em
 *   Brasília. Nunca recalcular pelo percentual atual da profissional.
 * - "Pagar" = só as pendentes do período exibido (decisão do dono, 2026-10-01).
 */
import { arredondar, num, type Valor } from './kpis-financeiros';
import {
  chaveDiaBRT, chaveMesBRT, contemInstante, instanteMs, rotuloDiaCurto, rotuloMesAno,
  type Limites, type PeriodoComissao,
} from './periodos';

export type ComissaoDetalheRow = {
  id: string;
  profissional_id: string;
  agendamento_id: string | null;
  valor_servico: Valor;
  percentual: Valor;
  valor_comissao: Valor;
  status: string;
  created_at: string;
  profissional?: { nome: string | null } | null;
  agendamento?: {
    data_hora_inicio: string | null;
    valor?: Valor;
    servico?: { nome: string | null; categoria?: string | null; categoria_id?: string | null } | null;
    cliente?: { nome: string | null } | null;
  } | null;
};

export type ComissaoItem = {
  id: string;
  profissionalId: string;
  profissionalNome: string;
  agendamentoId: string | null;
  valorServico: number;
  percentual: number;
  valorComissao: number;
  status: 'pendente' | 'pago';
  criadaEm: string;
  /** Início do atendimento (exibição e agrupamento); null se o atendimento não veio. */
  dataAtendimento: string | null;
  valorAtendimento: number | null;
  servicoNome: string;
  servicoCategoria: string | null;
  servicoCategoriaId: string | null;
  clienteNome: string;
};

export function normalizarComissao(r: ComissaoDetalheRow): ComissaoItem {
  const ag = r.agendamento ?? null;
  return {
    id: r.id,
    profissionalId: r.profissional_id,
    profissionalNome: r.profissional?.nome || 'Profissional',
    agendamentoId: r.agendamento_id ?? null,
    valorServico: num(r.valor_servico),
    percentual: num(r.percentual),
    valorComissao: num(r.valor_comissao),
    status: r.status === 'pago' ? 'pago' : 'pendente',
    criadaEm: r.created_at,
    dataAtendimento: ag?.data_hora_inicio ?? null,
    valorAtendimento: ag && ag.valor != null ? num(ag.valor) : null,
    servicoNome: ag?.servico?.nome || 'Serviço',
    servicoCategoria: ag?.servico?.categoria ?? null,
    servicoCategoriaId: ag?.servico?.categoria_id ?? null,
    clienteNome: ag?.cliente?.nome || '—',
  };
}

export function normalizarComissoes(rows: ComissaoDetalheRow[]): ComissaoItem[] {
  return rows.map(normalizarComissao);
}

export type FiltroComissao = 'todas' | 'pendentes' | 'pagas';
export const FILTROS_COMISSAO: { key: FiltroComissao; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'pendentes', label: 'Pendentes' },
  { key: 'pagas', label: 'Pagas' },
];

export function filtrarComissoes(itens: ComissaoItem[], filtro: FiltroComissao): ComissaoItem[] {
  if (filtro === 'pendentes') return itens.filter(c => c.status === 'pendente');
  if (filtro === 'pagas') return itens.filter(c => c.status === 'pago');
  return itens;
}

export type ResumoComissoes = { total: number; pendente: number; pago: number; quantidade: number };

export function resumoComissoes(itens: ComissaoItem[]): ResumoComissoes {
  let total = 0;
  let pendente = 0;
  for (const c of itens) {
    total += c.valorComissao;
    if (c.status === 'pendente') pendente += c.valorComissao;
  }
  const t = arredondar(total);
  const p = arredondar(pendente);
  return { total: t, pendente: p, pago: arredondar(t - p), quantidade: itens.length };
}

export type ComissoesDaProfissional = {
  profissionalId: string;
  nome: string;
  itens: ComissaoItem[];
  total: number;
  pendente: number;
  pago: number;
  atendimentos: number;
  /** Percentual das comissões do período, se for um só; null quando variou. */
  percentual: number | null;
  /** O que "Pagar" marca: as pendentes DESTE período. */
  idsPendentes: string[];
};

/** Um card por profissional (inclusive inativas), maior total primeiro. */
export function comissoesPorProfissional(itens: ComissaoItem[]): ComissoesDaProfissional[] {
  const mapa = new Map<string, ComissaoItem[]>();
  for (const c of itens) {
    const lista = mapa.get(c.profissionalId);
    if (lista) lista.push(c); else mapa.set(c.profissionalId, [c]);
  }
  const out: ComissoesDaProfissional[] = [];
  for (const [profissionalId, doProf] of mapa) {
    const r = resumoComissoes(doProf);
    const percentuais = new Set(doProf.map(c => c.percentual));
    out.push({
      profissionalId,
      nome: doProf[0].profissionalNome,
      itens: doProf,
      total: r.total, pendente: r.pendente, pago: r.pago,
      atendimentos: doProf.length,
      percentual: percentuais.size === 1 ? doProf[0].percentual : null,
      idsPendentes: doProf.filter(c => c.status === 'pendente').map(c => c.id),
    });
  }
  return out.sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export type GrupoComissoes = { chave: string; rotulo: string; itens: ComissaoItem[] };

/** Por dia (Dia/Semana/Mês) ou por mês (Trimestre/Semestre/Ano), mais recente primeiro, em Brasília. */
export function agruparComissoesPorData(itens: ComissaoItem[], periodo: PeriodoComissao): GrupoComissoes[] {
  const porMes = periodo === 'trimestre' || periodo === 'semestre' || periodo === 'ano';
  const mapa = new Map<string, ComissaoItem[]>();
  for (const c of itens) {
    const ref = c.dataAtendimento ?? c.criadaEm;
    const chave = porMes ? chaveMesBRT(ref) : chaveDiaBRT(ref);
    const lista = mapa.get(chave);
    if (lista) lista.push(c); else mapa.set(chave, [c]);
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([chave, lista]) => ({ chave, rotulo: porMes ? rotuloMesAno(chave) : rotuloDiaCurto(chave), itens: lista }));
}

export type PendentesDaProfissional = { idsDoPeriodo: string[]; valorDoPeriodo: number; valorAnterior: number };

/** Pendentes separadas em "do período" (o que Pagar marca) e "anteriores ao período" (só aviso). */
export function pendentesPorProfissional(
  rows: { id: string; profissional_id: string; valor_comissao: Valor; created_at: string }[],
  l: Limites,
): Record<string, PendentesDaProfissional> {
  const out: Record<string, PendentesDaProfissional> = {};
  const inicio = instanteMs(l.startIso);
  for (const c of rows) {
    const p = (out[c.profissional_id] ??= { idsDoPeriodo: [], valorDoPeriodo: 0, valorAnterior: 0 });
    if (contemInstante(l, c.created_at)) {
      p.idsDoPeriodo.push(c.id);
      p.valorDoPeriodo += num(c.valor_comissao);
    } else if (instanteMs(c.created_at) < inicio) {
      p.valorAnterior += num(c.valor_comissao);
    }
  }
  for (const p of Object.values(out)) {
    p.valorDoPeriodo = arredondar(p.valorDoPeriodo);
    p.valorAnterior = arredondar(p.valorAnterior);
  }
  return out;
}

export function rotuloPercentualComissao(percentual: number | null): string {
  return percentual == null ? 'vários %' : `${String(percentual).replace('.', ',')}%`;
}

export function textoConfirmarPagamento(nome: string, valorFormatado: string, rotuloPeriodo: string): string {
  return `Marcar como pagas as comissões pendentes de ${nome} em ${rotuloPeriodo} (${valorFormatado})?`;
}

export const MENSAGEM_PAGAMENTO_PARCIAL =
  'Algumas comissões não foram marcadas como pagas (sem permissão ou já estavam pagas). A lista foi atualizada.';
```

- [ ] **Step 6: Criar `shared/comissoes-consultas.ts`**

```ts
/**
 * @file comissoes-consultas.ts
 * Consultas ÚNICAS de comissões (web e mobile). Lançam erro na leitura; o
 * pagamento devolve o que o banco confirmou (RLS pode aceitar 0 linhas).
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import type { Limites } from './periodos';
import type { ComissaoDetalheRow } from './comissoes';

export const COLUNAS_COMISSAO_DETALHE = `id, profissional_id, agendamento_id, valor_servico, percentual, valor_comissao, status, created_at,
  profissional:users!comissoes_profissional_id_fkey(nome),
  agendamento:agendamentos(data_hora_inicio, valor,
    servico:servicos(nome, categoria, categoria_id),
    cliente:clientes!agendamentos_cliente_id_fkey(nome))`;

/** Comissões geradas no período (created_at), mais recentes primeiro. `profissionalId` = tela da profissional. */
export async function carregarComissoesDoPeriodo(
  db: ClienteDb, empresaId: string, l: Limites, opcoes: { profissionalId?: string } = {},
): Promise<ComissaoDetalheRow[]> {
  return buscarTodasOuLancar<ComissaoDetalheRow>((de, ate) => {
    let q = db.from('comissoes').select(COLUNAS_COMISSAO_DETALHE)
      .eq('empresa_id', empresaId)
      .gte('created_at', l.startIso).lte('created_at', l.endIso);
    if (opcoes.profissionalId) q = q.eq('profissional_id', opcoes.profissionalId);
    return q.order('created_at', { ascending: false }).order('id').range(de, ate);
  });
}

export type ResultadoPagamento = { confirmados: string[]; naoConfirmados: string[]; erro: string | null };

const LOTE_PAGAMENTO = 150;

/**
 * Marca como pagas as comissões `ids` (as pendentes do período exibido).
 * Só toca pendentes da empresa e confere as linhas devolvidas. Para no
 * primeiro erro; o que não foi confirmado volta em `naoConfirmados`.
 */
export async function pagarComissoes(db: ClienteDb, empresaId: string, ids: string[]): Promise<ResultadoPagamento> {
  const unicos = [...new Set(ids)];
  const confirmados: string[] = [];
  let erro: string | null = null;
  for (let i = 0; i < unicos.length && !erro; i += LOTE_PAGAMENTO) {
    const lote = unicos.slice(i, i + LOTE_PAGAMENTO);
    try {
      const { data, error } = await db.from('comissoes')
        .update({ status: 'pago' })
        .in('id', lote)
        .eq('empresa_id', empresaId)
        .eq('status', 'pendente')
        .select('id');
      if (error) { erro = error.message; break; }
      for (const r of (data ?? []) as { id: string }[]) confirmados.push(r.id);
    } catch (e) {
      erro = (e as Error).message || 'erro desconhecido';
    }
  }
  const ok = new Set(confirmados);
  return { confirmados, naoConfirmados: unicos.filter(id => !ok.has(id)), erro };
}
```

- [ ] **Step 7: Verificação da task** (inclui mobile).
- [ ] **Step 8: Commit** — arquivos da task · `feat(shared): comissoes unicas (normalizacao, resumo, agrupamento, pagar so do periodo)`.

---

### Task 4: Web — Comissões (gestão e profissional) e "Pagar" da Equipe

**Files:** Modify `web/app/(app)/comissoes/ComissoesGestorView.tsx`, `ComissoesProfissionalView.tsx`, `web/app/(app)/equipe/page.tsx` · Test `web/tests/unit/paridade-fase2b-web-comissoes.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-web-comissoes.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const gestor = ler('web/app/(app)/comissoes/ComissoesGestorView.tsx');
const prof = ler('web/app/(app)/comissoes/ComissoesProfissionalView.tsx');
const equipe = ler('web/app/(app)/equipe/page.tsx');

describe('web Comissões usa as regras únicas', () => {
  it('gestão', () => {
    for (const t of ['PERIODOS_COMISSAO', 'limitesPeriodoComissao(', 'rotuloPeriodoComissao(', 'carregarComissoesDoPeriodo(',
      'normalizarComissoes(', 'resumoComissoes(', 'comissoesPorProfissional(', 'agruparComissoesPorData(',
      'pagarComissoes(', 'MENSAGEM_PAGAMENTO_PARCIAL', 'Não foi possível carregar as comissões', 'reqRef.current'])
      expect(gestor).toContain(t);
    for (const t of ['startOfMonth', 'endOfMonth', 'toISOString()', 'function getPeriodRange', "from('comissoes')", 'percentual_comissao'])
      expect(gestor).not.toContain(t);
  });
  it('profissional', () => {
    for (const t of ['PERIODOS_COMISSAO', 'limitesPeriodoComissao(', 'carregarComissoesDoPeriodo(', 'profissionalId: userId',
      'resumoComissoesProfissional(', 'FILTROS_COMISSAO', 'filtrarComissoes(', 'Comissão média', 'rotuloDataHoraBRT('])
      expect(prof).toContain(t);
    expect(prof).not.toContain('startOfMonth');
    expect(prof).not.toContain("from('comissoes')");
  });
  it('Equipe: Pagar = pendentes do mês (Brasília), aviso das anteriores', () => {
    for (const t of ['pendentesPorProfissional(', 'pagarComissoes(', 'limitesMes(', 'hojeBRT()', 'de meses anteriores', 'ids_pendentes_mes'])
      expect(equipe).toContain(t);
    expect(equipe).not.toContain(".update({ status: 'pago' })");
    expect(equipe).not.toContain('startOfMonth(new Date())');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha.**

- [ ] **Step 3: `ComissoesGestorView.tsx`.**
1. Troque o JSDoc/imports do topo por:
```tsx
'use client';

/**
 * @file comissoes/ComissoesGestorView.tsx
 * Comissões da equipe. Fonte, períodos e regras ÚNICOS, os mesmos do app
 * (mobile/app/(empresa)/comissoes.tsx): carregarComissoesDoPeriodo (created_at
 * em Brasília), PERIODOS_COMISSAO, @shared/comissoes. "Pagar" = só as
 * pendentes do período exibido.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Banknote, CircleCheck, X, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { Sk } from '@/components/Skeleton';
import { Secret, PrivacyToggle } from '@/components/privacy';
import { ExportButton } from '@/components/ExportButton';
import { CategoriaIcon, CategoriaIconCustom } from '@/components/CategoriaIcon';
import { resolverCategoriaServico, type CategoriaCustom } from '@shared/categorias';
import {
  PERIODOS_COMISSAO, limitesPeriodoComissao, rotuloPeriodoComissao, hojeBRT, somarDias, diaDaSemana,
  diasEntre, DIAS_SEMANA_ABREV, horaBRT, chaveDiaBRT, rotuloDataBR, type PeriodoComissao,
} from '@shared/periodos';
import {
  normalizarComissoes, resumoComissoes, comissoesPorProfissional, agruparComissoesPorData, filtrarComissoes,
  rotuloPercentualComissao, FILTROS_COMISSAO, MENSAGEM_PAGAMENTO_PARCIAL, type ComissaoItem, type FiltroComissao,
} from '@shared/comissoes';
import { carregarComissoesDoPeriodo, pagarComissoes } from '@shared/comissoes-consultas';
```
2. Apague `DIAS_SEMANA`, `type Periodo`, `type Filtro`, `PERIODOS`, `getPeriodRange`, `navigate`, `getPeriodLabel`, `type ComissaoRow`, `type ProfRow`, `groupByPeriodo`. Mantenha `fmtBRL`, `iniciais`, `avatarGradient`.
3. Estado e carga (substitua do `useState` de `periodo` até o fim de `marcarPago`):
```tsx
  const [periodo, setPeriodo] = useState<PeriodoComissao>('mes');
  const [deslocamento, setDeslocamento] = useState(0);
  const [itens, setItens] = useState<ComissaoItem[]>([]);
  const [erroCarga, setErroCarga] = useState('');
  const [categoriasCustom, setCategoriasCustom] = useState<CategoriaCustom[]>([]);
  const [filtro, setFiltro] = useState<FiltroComissao>('todas');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [pagando, setPagando] = useState<string | null>(null);
  useScrollLock(!!pagando);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState('');
  const [toastErro, setToastErro] = useState('');
  const reqRef = useRef(0);

  const hoje = hojeBRT();
  const limites = useMemo(() => limitesPeriodoComissao(periodo, hoje, deslocamento), [periodo, hoje, deslocamento]);
  const periodoLabel = rotuloPeriodoComissao(periodo, limites);
  const podeAvancar = deslocamento < 0;
  // Faixa domingo–sábado do modo Dia
  const semana = useMemo(() => {
    const domingo = somarDias(limites.startDate, -diaDaSemana(limites.startDate));
    return Array.from({ length: 7 }, (_, i) => somarDias(domingo, i));
  }, [limites.startDate]);

  // (useEffect do empresaId: mantenha o existente)

  const fetchData = useCallback(async () => {
    if (!empresaId) return;
    const req = ++reqRef.current;
    setLoading(true);
    setErroCarga('');
    try {
      const [rows, rCat] = await Promise.all([
        carregarComissoesDoPeriodo(supabase, empresaId, limites),
        supabase.from('categorias_servico').select('*').eq('empresa_id', empresaId).order('nome'),
      ]);
      if (rCat.error) throw new Error(rCat.error.message);
      if (req !== reqRef.current) return;   // resposta velha
      setItens(normalizarComissoes(rows));
      setCategoriasCustom((rCat.data ?? []) as CategoriaCustom[]);
    } catch (e) {
      if (req !== reqRef.current) return;
      setItens([]);
      setErroCarga((e as Error).message || 'erro desconhecido');
    }
    if (req === reqRef.current) setLoading(false);
  }, [empresaId, limites]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setExpandidos(new Set()); }, [periodo, deslocamento]);

  const profissionais = useMemo(() => comissoesPorProfissional(itens), [itens]);
  const resumo = useMemo(() => resumoComissoes(itens), [itens]);

  function toggleExpand(id: string) { /* mantém o corpo atual */ }

  async function marcarPago(profId: string) {
    const prof = profissionais.find(p => p.profissionalId === profId);
    if (!empresaId || !prof || prof.idsPendentes.length === 0) return;
    setSalvando(true);
    const r = await pagarComissoes(supabase, empresaId, prof.idsPendentes);
    setSalvando(false);
    setPagando(null);
    if (r.naoConfirmados.length > 0) {
      setToastErro(r.erro ? `Erro ao registrar o pagamento: ${r.erro}` : MENSAGEM_PAGAMENTO_PARCIAL);
      setTimeout(() => setToastErro(''), 4000);
    } else {
      setToast('Pagamento registrado!');
      setTimeout(() => setToast(''), 2500);
    }
    fetchData();
  }

  type ExRow = { prof: string; data: string; servico: string; valor: number; perc: string; comissao: number; status: string };
  const exportRows: ExRow[] = itens.map(c => ({
    prof: c.profissionalNome,
    data: rotuloDataBR(chaveDiaBRT(c.dataAtendimento ?? c.criadaEm)),
    servico: c.servicoNome,
    valor: c.valorServico,
    perc: `${c.percentual}%`,
    comissao: c.valorComissao,
    status: c.status === 'pago' ? 'Pago' : 'Pendente',
  }));
```
Apague `navDia`/`selecionarDia`, `isFuturo`, `refDate`.
4. JSX:
   - Ao lado do toast verde, acrescente o toast vermelho (`toastErro`, classe `bg-red`).
   - Abas: `PERIODOS_COMISSAO.map(...)`, `onClick={() => { setPeriodo(p.key); setDeslocamento(0); }}`.
   - Modo Dia: seta esquerda `setDeslocamento(x => x - 1)`; seta direita `disabled={!podeAvancar}` e `podeAvancar && setDeslocamento(x => x + 1)`; botões da faixa `semana.map(d => …)` com `sel = d === limites.startDate`, `hj = d === hoje`, `fut = d > hoje`, `onClick={() => !fut && setDeslocamento(diasEntre(hoje, d))}`, `key={d}`, rótulo `DIAS_SEMANA_ABREV[diaDaSemana(d)]` e número `Number(d.slice(8, 10))`.
   - Demais períodos: mesmas setas (`!podeAvancar` desabilita) e `{periodoLabel}`.
   - Logo abaixo da navegação:
```tsx
      {erroCarga && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-xl border border-red/30 bg-red/5 text-sm text-red">
          Não foi possível carregar as comissões: {erroCarga}
        </div>
      )}
```
   - Resumo: `{loading || erroCarga ? '—' : <Secret>{fmtBRL(s.val)}</Secret>}`.
   - Filtros: `FILTROS_COMISSAO.map(f => <button key={f.key} onClick={() => setFiltro(f.key)} …>{f.label}</button>)`.
   - Lista: condição `loading ? … : erroCarga ? null : profissionais.length === 0 ? … : …`. Em cada card: `key={prof.profissionalId}`, `const list = filtrarComissoes(prof.itens, filtro)`, `const groups = agruparComissoesPorData(list, periodo)`, `prof.atendimentos` atend., `{rotuloPercentualComissao(prof.percentual)}` no lugar de `{prof.percentual}%`, `expanded = expandidos.has(prof.profissionalId)`, `onClick={() => setPagando(prof.profissionalId)}`.
   - Itens do grupo: `resolverCategoriaServico(c.servicoCategoria, c.servicoCategoriaId, categoriasCustom)`, `{c.servicoNome}`, `{fmtBRL(c.valorServico)} × {c.percentual}%`, hora `{c.dataAtendimento && <span …>{horaBRT(c.dataAtendimento)}</span>}`, `{fmtBRL(c.valorComissao)}`.
   - Modal: `profissionais.find(p => p.profissionalId === pagando)`; abaixo de "Total a repassar" acrescente `<p className="text-[11px] mt-1" style={{ color: 'var(--color-amber)' }}>Pendentes de {periodoLabel}</p>`.
   Mantenha `flex-col gap-3 p-4 sm:flex-row`, `bm-modal` e o `ExportButton`.

- [ ] **Step 4: `ComissoesProfissionalView.tsx`** — mesma estrutura, sem cards por profissional:
   - Imports: `PERIODOS_COMISSAO, limitesPeriodoComissao, rotuloPeriodoComissao, hojeBRT, rotuloDataHoraBRT, type PeriodoComissao` de `@shared/periodos`; `normalizarComissoes, filtrarComissoes, FILTROS_COMISSAO, type ComissaoItem, type FiltroComissao` de `@shared/comissoes`; `resumoComissoesProfissional` de `@shared/kpis-financeiros`; `carregarComissoesDoPeriodo` de `@shared/comissoes-consultas`. Remova date-fns.
   - No efeito inicial guarde `setUserId(user.id)` (novo estado `userId`).
   - Estados `periodo`, `deslocamento`, `filtro`, `itens`, `erroCarga`, `reqRef`, `limites`/`periodoLabel`/`podeAvancar` como na gestão. Carga: `carregarComissoesDoPeriodo(supabase, empresaId, limites, { profissionalId: userId })` (só quando `empresaId && userId`), categorias com `.error` conferido, padrão `reqRef`.
   - `const resumo = useMemo(() => resumoComissoesProfissional(itens.map(c => ({ valor_servico: c.valorServico, valor_comissao: c.valorComissao, status: c.status }))), [itens]);`
   - Abas de período + setas (iguais à gestão; no modo Dia só setas) e filtros `FILTROS_COMISSAO`.
   - Resumo em 5 cards (`grid grid-cols-2 sm:grid-cols-5 gap-3`): **Total** (`comissaoTotal`), **Recebido** (`comissaoPaga`), **A receber** (`comissaoPendente`), **Atendimentos** (`atendimentos`), **Comissão média** (`comissaoMedia`); `'—'` quando `loading || erroCarga`.
   - Lista `filtrarComissoes(itens, filtro)`: serviço, cliente (`c.clienteNome`), `{fmtBRL(c.valorServico)} × {c.percentual}%`, `rotuloDataHoraBRT(c.dataAtendimento ?? c.criadaEm)`, comissão e status. Banner "Não foi possível carregar suas comissões: …" em erro.

- [ ] **Step 5: `equipe/page.tsx`.**
   - Imports: troque `import { format, startOfMonth, endOfMonth } from 'date-fns';` por `import { format } from 'date-fns';`; acrescente `import Link from 'next/link';`, `import { hojeBRT, limitesMes } from '@shared/periodos';`, `import { pendentesPorProfissional, MENSAGEM_PAGAMENTO_PARCIAL } from '@shared/comissoes';`, `import { carregarComissoesPendentes } from '@shared/kpis-financeiros-consultas';`, `import { pagarComissoes } from '@shared/comissoes-consultas';`.
   - Tipo `Profissional`: acrescente `comissao_pendente_anterior: number; ids_pendentes_mes: string[];` (o `comissao_pendente` passa a ser **do mês**).
   - Em `carregarEquipe`, troque o bloco de `inicio/fim` até o `setProfs` por:
```ts
    // Mês atual em Brasília: é o "período exibido" da Equipe (Pagar = pendentes dele).
    const mesAtual = limitesMes(hojeBRT().slice(0, 7));
    try {
      const [rAgs, pendentes] = await Promise.all([
        supabase.from('agendamentos').select('profissional_id, valor')
          .eq('empresa_id', empId).eq('status', 'concluido')
          .gte('data_hora_inicio', mesAtual.startIso).lte('data_hora_inicio', mesAtual.endIso),
        carregarComissoesPendentes(supabase, empId),
      ]);
      if (rAgs.error) throw new Error(rAgs.error.message);
      const stats: Record<string, { total: number; count: number }> = {};
      ((rAgs.data ?? []) as { profissional_id: string; valor: number }[]).forEach(a => {
        if (!stats[a.profissional_id]) stats[a.profissional_id] = { total: 0, count: 0 };
        stats[a.profissional_id].total += Number(a.valor);
        stats[a.profissional_id].count += 1;
      });
      const pend = pendentesPorProfissional(pendentes, mesAtual);
      setProfs(((membros ?? []) as any[]).map(m => ({
        ...m,
        total_mes:                  stats[m.user_id]?.total ?? 0,
        atendimentos_mes:           stats[m.user_id]?.count ?? 0,
        comissao_pendente:          pend[m.user_id]?.valorDoPeriodo ?? 0,
        comissao_pendente_anterior: pend[m.user_id]?.valorAnterior ?? 0,
        ids_pendentes_mes:          pend[m.user_id]?.idsDoPeriodo ?? [],
      })));
    } catch (e) {
      alert(`Erro ao carregar a equipe: ${(e as Error).message}`);
    }
    setLoading(false);
```
   Confira também o `error` da consulta de `membros` (`const { data: membros, error: erroMembros } = …; if (erroMembros) { alert(...); setLoading(false); return; }`).
   - Substitua `pagarComissoes(profUserId)` local por:
```ts
  /** Pagar = só as pendentes do MÊS ATUAL (decisão do dono); as anteriores ficam para a tela Comissões. */
  async function pagarComissoesDoMes(prof: Profissional) {
    if (!empresaId || prof.ids_pendentes_mes.length === 0) return;
    const r = await pagarComissoes(supabase, empresaId, prof.ids_pendentes_mes);
    if (r.naoConfirmados.length > 0) {
      alert(r.erro ? `Erro ao registrar o pagamento: ${r.erro}` : MENSAGEM_PAGAMENTO_PARCIAL);
    }
    await carregarEquipe(empresaId);
  }
```
   e `onPagar={() => pagarComissoesDoMes(p)}`.
   - No `ProfCard`: badge "`<Secret>{fmtBRL(prof.comissao_pendente)}</Secret> pendente no mês`"; botão "`Pagar <Secret>{fmtBRL(prof.comissao_pendente)}</Secret> do mês`"; logo abaixo do botão:
```tsx
          {prof.ativo && prof.comissao_pendente_anterior > 0 && (
            <Link href="/comissoes" style={{ display: 'block', fontSize: 11, color: '#B45309', marginBottom: 10, fontFamily: 'var(--font-sans)' }}>
              + <Secret>{fmtBRL(prof.comissao_pendente_anterior)}</Secret> de meses anteriores — pague em Comissões
            </Link>
          )}
```
   e "Comissão em dia" só quando `!temPendente && prof.comissao_pendente_anterior === 0`.

- [ ] **Step 6: Verificação da task** (web).
- [ ] **Step 7: Commit** — `feat(web): comissoes com periodos e regras unicas; pagar so as pendentes do periodo (inclusive Equipe)`.

---

### Task 5: Mobile — Comissões da gestão e item no menu "Mais"

**Files:** Modify `mobile/hooks/useComissoesGestor.ts` (reescrito), `mobile/app/(empresa)/comissoes.tsx` (reescrito), `mobile/app/(empresa)/mais.tsx`, `mobile/hooks/useDashboard.ts` · Test `web/tests/unit/paridade-fase2b-mobile-comissoes.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-mobile-comissoes.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useComissoesGestor.ts');
const tela = ler('mobile/app/(empresa)/comissoes.tsx');
const mais = ler('mobile/app/(empresa)/mais.tsx');
const dash = ler('mobile/hooks/useDashboard.ts');

describe('app Comissões = web Comissões', () => {
  it('hook', () => {
    for (const t of ['carregarComissoesDoPeriodo(', 'normalizarComissoes(', 'comissoesPorProfissional(', 'resumoComissoes(',
      'limitesPeriodoComissao(', 'pagarComissoes(', 'mutateAsync', 'invalidarFinanceiro(qc)', "'comissoes-gestor'",
      'MENSAGEM_PAGAMENTO_PARCIAL']) expect(hook).toContain(t);
    for (const t of ['startOfMonth', 'endOfMonth', 'toISOString()', '.update(']) expect(hook).not.toContain(t);
  });
  it('tela', () => {
    for (const t of ['PERIODOS_COMISSAO', 'rotuloPeriodoComissao(', 'FILTROS_COMISSAO', 'agruparComissoesPorData(',
      'filtrarComissoes(', 'Não foi possível carregar as comissões', 'Alert.alert', 'rotuloPercentualComissao(']) expect(tela).toContain(t);
    for (const t of ['subMonths', 'border: 1', 'percentual}% de comissão']) expect(tela).not.toContain(t);
  });
  it('menu Mais com Comissões e badge de pendentes', () => {
    expect(mais).toContain("router.push('/(empresa)/comissoes'");
    expect(mais).toContain('useResumoComissoesPendentes(');
    expect(mais).toContain('badge=');
    expect(dash).toContain('export function useResumoComissoesPendentes');
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**

- [ ] **Step 3: `useDashboard.ts`** — extraia a consulta de pendentes para um hook exportado (mesma chave, mesma função) e use-o dentro de `useDashboard`:
```ts
/** TODAS as comissões pendentes da empresa (alerta do Dashboard e badge do menu "Mais"). */
export function useResumoComissoesPendentes() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  return useQuery({
    queryKey: ['comissoes-pendentes', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => resumoComissoesPendentes(await carregarComissoesPendentes(supabase, empresaId!)),
  });
}
```
Em `useDashboard`: `const comissoesPendentes = useResumoComissoesPendentes();` (apague o `useQuery` antigo). Coloque o novo hook **depois** de `useDashboard` no arquivo, para o primeiro `from('agendamentos')` continuar sendo o "Agenda hoje".

- [ ] **Step 4: Reescrever `useComissoesGestor.ts`**
```ts
/**
 * @file useComissoesGestor.ts
 * Comissões da equipe no app — mesma fonte, períodos e regras do web
 * (ComissoesGestorView): @shared/comissoes + @shared/comissoes-consultas.
 * "Pagar" = só as pendentes do período exibido.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import { hojeBRT, limitesPeriodoComissao, type PeriodoComissao } from '@shared/periodos';
import {
  normalizarComissoes, comissoesPorProfissional, resumoComissoes, MENSAGEM_PAGAMENTO_PARCIAL,
  type ComissoesDaProfissional,
} from '@shared/comissoes';
import { carregarComissoesDoPeriodo, pagarComissoes } from '@shared/comissoes-consultas';
import type { CategoriaCustom } from '@shared/categorias';

export function useComissoesGestor(periodo: PeriodoComissao, deslocamento: number) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();
  const limites = limitesPeriodoComissao(periodo, hojeBRT(), deslocamento);

  const query = useQuery({
    queryKey: ['comissoes-gestor', empresaId, limites.startIso, limites.endIso],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => normalizarComissoes(await carregarComissoesDoPeriodo(supabase, empresaId!, limites)),
  });

  const categorias = useQuery({
    queryKey: ['categorias-servico', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase.from('categorias_servico').select('*').eq('empresa_id', empresaId!).order('nome');
      if (error) throw error;
      return (data ?? []) as CategoriaCustom[];
    },
  });

  const pagar = useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await pagarComissoes(supabase, empresaId!, ids);
      if (r.naoConfirmados.length > 0) throw new Error(r.erro ?? MENSAGEM_PAGAMENTO_PARCIAL);
      return r.confirmados.length;
    },
    onSettled: () => invalidarFinanceiro(qc),   // lucro, pendentes e badge mudam em todas as telas
  });

  const itens = query.data ?? [];
  return {
    limites,
    itens,
    profissionais: comissoesPorProfissional(itens),
    resumo: resumoComissoes(itens),
    categorias: categorias.data ?? [],
    pronto: query.isSuccess,
    isLoading: query.isLoading,
    isError: query.isError || categorias.isError,
    erro: (query.error ?? categorias.error) as Error | null,
    refetch: () => { query.refetch(); categorias.refetch(); },
    pagar: (p: ComissoesDaProfissional) => pagar.mutateAsync(p.idsPendentes),
  };
}
```

- [ ] **Step 5: Reescrever `mobile/app/(empresa)/comissoes.tsx`.** Mantenha `C`, `AVATAR_COLORS`, `initials`, fontes e o visual atual. Mudanças:
   - `formatBRL` = `new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v)` (igual ao web: centavos aparecem).
   - Imports: `SmoothTabs`; `PERIODOS_COMISSAO, rotuloPeriodoComissao, horaBRT, type PeriodoComissao` (`@shared/periodos`); `FILTROS_COMISSAO, filtrarComissoes, agruparComissoesPorData, rotuloPercentualComissao, type ComissoesDaProfissional, type FiltroComissao` (`@shared/comissoes`); `resolverCategoriaServico, type CategoriaCustom, type CategoriaServico` (`@shared/categorias`); `CategoriaIcon, CategoriaIconCustom`. Remova date-fns.
   - `ProfCard({ item, index, filtro, periodo, categorias, onPagar })`: `const grupos = agruparComissoesPorData(filtrarComissoes(item.itens, filtro), periodo); if (grupos.length === 0) return null;` subtítulo `` `${rotuloPercentualComissao(item.percentual)} de comissão · ${item.atendimentos} atend.` ``; Pagar se `item.pendente > 0`. Para cada grupo, cabeçalho (só se `periodo !== 'dia'`) com `g.rotulo` em caixa alta; linhas com `const r = resolverCategoriaServico(c.servicoCategoria, c.servicoCategoriaId, categorias)`, ícone `r.iconeCustom ? <CategoriaIconCustom name={r.iconeCustom} size={16} color={r.cor} /> : <CategoriaIcon categoria={(r.iconeBuiltin ?? 'outros') as CategoriaServico} size={16} color={r.cor} />` sobre fundo `r.bg`, `c.servicoNome`, `<SecretText>{formatBRL(c.valorServico)} × {c.percentual}% = {formatBRL(c.valorComissao)}</SecretText>` e `c.dataAtendimento ? ' · ' + horaBRT(c.dataAtendimento) : ''`. Rodapé com `item.pendente`/`item.pago`.
   - `ModalPagamento({ profissional, rotuloPeriodo, onClose, onConfirmar: () => Promise<unknown> })`:
```tsx
  async function confirmar() {
    setSalvando(true);
    try {
      await onConfirmar();
      onClose();
    } catch (e) {
      Alert.alert('Não foi possível registrar o pagamento', (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
```
   Mostrar "Pendentes de {rotuloPeriodo}" e `formatBRL(profissional?.pendente ?? 0)`.
   - Tela: estados `periodo` ('mes'), `deslocamento` (0), `filtro`, `pagando`. `const { limites, profissionais, resumo, categorias, pronto, isLoading, isError, erro, refetch, pagar } = useComissoesGestor(periodo, deslocamento); const rotulo = rotuloPeriodoComissao(periodo, limites); const podeAvancar = deslocamento < 0;`
   - Abaixo do cabeçalho: `<SmoothTabs tabs={PERIODOS_COMISSAO} active={periodo} onChange={k => { setPeriodo(k as PeriodoComissao); setDeslocamento(0); }} activeColor={C.primary} trackBg={C.surface} trackBorder={C.border} inactiveTextColor={C.text3} style={{ marginHorizontal: 24, marginBottom: 12 }} />`.
   - Navegação: setas (borda via `borderWidth: 1`, sem `border`/`background`) com `setDeslocamento(d => d - 1)` e `podeAvancar && setDeslocamento(d => d + 1)` (`opacity` 0.3 sem `podeAvancar`), rótulo `{rotulo}`.
   - Banner de erro (mesmo estilo do Dashboard, `TouchableOpacity` que chama `refetch()`): título "Não foi possível carregar as comissões", texto `erro?.message`.
   - Resumo: `pronto ? formatBRL(s.val) : '—'`.
   - Filtros: `FILTROS_COMISSAO`.
   - Cards: `profissionais.map((p, i) => <ProfCard key={p.profissionalId} item={p} index={i} filtro={filtro} periodo={periodo} categorias={categorias} onPagar={() => setPagando(p)} />)`; vazio só quando `pronto && profissionais.length === 0`.
   - `<ModalPagamento profissional={pagando} rotuloPeriodo={rotulo} onClose={() => setPagando(null)} onConfirmar={() => (pagando ? pagar(pagando) : Promise.resolve())} />`.

- [ ] **Step 6: `mais.tsx`.**
   - `MenuItem` ganha `badge?: number` e, antes do chevron:
```tsx
      {!!badge && badge > 0 && (
        <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: '#fff' }}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
```
   - `import { useResumoComissoesPendentes } from '@/hooks/useDashboard';` e, no componente (antes do `if (!fontsLoaded)`): `const { data: pendentes } = useResumoComissoesPendentes();`
   - Após o item "Equipe", dentro de Gestão:
```tsx
              {temPermissao(role, 'ver_comissoes_todas') && (
                <MenuItem
                  icon={<DollarSign size={16} color={C.amber} strokeWidth={2} />}
                  label="Comissões"
                  sublabel="Repasses da equipe"
                  iconBg={C.amberSoft} iconColor={C.amber}
                  badge={pendentes?.quantidade ?? 0}
                  onPress={() => router.push('/(empresa)/comissoes' as any)}
                />
              )}
```
   (`DollarSign` já está importado.)

- [ ] **Step 7: Verificação da task** (mobile: o erro `comissoes.tsx TS2769` deve sumir; nenhum novo).
- [ ] **Step 8: Commit** — `feat(mobile): comissoes da gestao com periodos e regras unicas, pagar aguardando o resultado e item no menu`.

---

### Task 6: Mobile — Comissões da profissional e `useDiasProfissional`

**Files:** Modify `mobile/hooks/useProfissional.ts`, `mobile/app/(profissional)/comissoes.tsx`, `mobile/app/(profissional)/inicio.tsx`, `web/tests/unit/paridade-fase2a-profissional.test.ts` · Test `web/tests/unit/paridade-fase2b-mobile-profissional.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-mobile-profissional.test.ts
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
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: `useProfissional.ts`.**
   - Imports: acrescente `chaveDoMesExibido, chaveDiaBRT, type Limites` em `@shared/periodos`; `import { normalizarComissoes } from '@shared/comissoes';` e `export type { ComissaoItem } from '@shared/comissoes';` `import { carregarComissoesDoPeriodo } from '@shared/comissoes-consultas';`. Apague a `interface ComissaoItem` local.
   - Substitua `useComissoesProfissional` e `useResumoComissoes` por:
```ts
// ── Comissões da profissional (período) ──────────────────────
// Uma consulta só (mesma chave); cada hook transforma com `select`.
function consultaComissoesProfissional(userId: string | undefined, empresaId: string | undefined, l: Limites) {
  return {
    queryKey: ['prof-comissoes', userId, empresaId, l.startIso, l.endIso] as const,
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: () => carregarComissoesDoPeriodo(supabase, empresaId!, l, { profissionalId: userId! }),
  };
}

export function useComissoesProfissional(l: Limites) {
  const { user, empresaAtiva } = useAuthStore();
  return useQuery({ ...consultaComissoesProfissional(user?.id, empresaAtiva?.id, l), select: normalizarComissoes });
}

export function useResumoComissoes(l: Limites): { data: ResumoComissoes | null; isLoading: boolean; isError: boolean; error: Error | null; refetch: () => void } {
  const { user, empresaAtiva } = useAuthStore();
  const query = useQuery({
    ...consultaComissoesProfissional(user?.id, empresaAtiva?.id, l),
    select: (rows): ResumoComissoes => {
      const r = resumoComissoesProfissional(rows);
      return {
        total: r.comissaoTotal, pago: r.comissaoPaga, pendente: r.comissaoPendente,
        atendimentos: r.atendimentos, ticketMedio: r.comissaoMedia, faturamentoBruto: r.faturamentoBruto,
      };
    },
  });
  return { data: query.data ?? null, isLoading: query.isLoading, isError: query.isError, error: query.error as Error | null, refetch: query.refetch };
}
```
   Garanta que `consultaComissoesProfissional` fique entre o comentário "// ── Comissões da profissional" e `useComissoesProfissional`, e `useResumoComissoes` antes de `useDiasProfissional`. (A propriedade `ticketMedio` do tipo continua: é a comissão média; o rótulo na tela vira "Comissão média".)
   - Substitua `useDiasProfissional`:
```ts
export function useDiasProfissional(mes: Date) {
  const { user, empresaAtiva } = useAuthStore();
  const userId = user?.id;
  const empresaId = empresaAtiva?.id;
  const chave = chaveDoMesExibido(mes);
  return useQuery({
    queryKey: ['prof-dias', userId, empresaId, chave],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const l = limitesMes(chave);   // mês em Brasília
      const { data, error } = await supabase.from('agendamentos')
        .select('data_hora_inicio')
        .eq('empresa_id', empresaId!)
        .eq('profissional_id', userId!)
        .neq('status', 'cancelado')
        .gte('data_hora_inicio', l.startIso)
        .lte('data_hora_inicio', l.endIso);
      if (error) throw error;
      return new Set((data ?? []).map(a => chaveDiaBRT(a.data_hora_inicio)));
    },
  });
}
```
- [ ] **Step 4: `(profissional)/comissoes.tsx`.** Estados `periodo: PeriodoComissao = 'mes'`, `deslocamento`, `filtro: FiltroComissao = 'todas'`; `const l = limitesPeriodoComissao(periodo, hojeBRT(), deslocamento); const rotulo = rotuloPeriodoComissao(periodo, l);` `const { data: itens = [], isLoading, isError: erroLista, refetch } = useComissoesProfissional(l);` e mantenha `const { data: resumo, isError: erroResumo, error: errResumo, refetch: refetchResumo } = useResumoComissoes(l);`. Lista = `filtrarComissoes(itens, filtro)`; filtros `SmoothTabs tabs={FILTROS_COMISSAO}`; abas de período `SmoothTabs tabs={PERIODOS_COMISSAO}` (troca zera `deslocamento`); seletor com setas `deslocamento`/`rotulo` (próximo desabilitado quando `deslocamento >= 0`). Hero: "Total de comissões · {rotulo}". KPI "Ticket médio" → "Comissão média". `ComissaoCard`: `item.clienteNome`, `rotuloDataHoraBRT(item.dataAtendimento ?? item.criadaEm)`, `item.servicoNome`, `item.valorServico`, `item.percentual`, `item.valorComissao`. Banner de erro aparece com `erroResumo || erroLista`; `formatBRL` igual ao web (`minimumFractionDigits: 0`). Remova date-fns.
- [ ] **Step 5: `inicio.tsx`** — import `{ hojeBRT, limitesMes } from '@shared/periodos'`; `const mesAtual = limitesMes(hojeBRT().slice(0, 7));` e `useResumoComissoes(mesAtual)`.
- [ ] **Step 6: Ajustar o teste da 2A** (`paridade-fase2a-profissional.test.ts`, "resumo do mês confere o erro"): troque `expect(trecho).toContain('if (error) throw error');` por `expect(trecho).toContain('consultaComissoesProfissional(');` e acrescente `expect(hook).toContain('carregarComissoesDoPeriodo(');` (a consulta de shared lança o erro).
- [ ] **Step 7: Verificação da task** (mobile).
- [ ] **Step 8: Commit** — `feat(mobile): comissoes da profissional com periodos unicos; dias da agenda em Brasilia e da empresa ativa`.

---

### Task 7: `shared/despesas.ts` — lançamento das recorrentes + `shared/despesas-consultas.ts`

**Files:** Modify `shared/despesas.ts` · Create `shared/despesas-consultas.ts`, `web/tests/unit/shared-despesas-recorrentes.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/shared-despesas-recorrentes.test.ts
import { describe, expect, it } from 'vitest';
import {
  recorrentesParaLancarNoMes, montarLancamentosRecorrentes, vencimentoNoMes, chaveDespesa, textoRecorrentesPendentes,
  type DespesaRecorrenteTemplate,
} from '@shared/despesas';
import { carregarHistoricoRecorrentesMensais, COLUNAS_HISTORICO_RECORRENTE } from '@shared/despesas-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const HIST: DespesaRecorrenteTemplate[] = [   // mais recente primeiro
  { descricao: 'Aluguel', categoria: 'Aluguel', valor: '1500.00', periodicidade: 'mensal', data_vencimento: '2026-08-31', recorrencia_ate: null },
  { descricao: 'Notebook', categoria: 'Outros', valor: 333.33, periodicidade: 'mensal', data_vencimento: '2026-07-10',
    recorrencia_ate: '2027-04-10', parcela_atual: 3, total_parcelas: 12, valor_total_compra: '4000.00' },
  { descricao: 'Internet', categoria: null, valor: 99.9, periodicidade: 'mensal', data_vencimento: '2026-08-05', recorrencia_ate: '2026-08-31' },
  { descricao: 'Aluguel', categoria: 'Aluguel', valor: 1400, periodicidade: 'mensal', data_vencimento: '2026-07-31', recorrencia_ate: null },
];

describe('quais recorrentes lançar', () => {
  it('mais recente por série, sem encerradas, sem as já lançadas no mês', () => {
    expect(recorrentesParaLancarNoMes(HIST, [], '2026-09-01').map(t => t.descricao)).toEqual(['Aluguel', 'Notebook']);
    expect(recorrentesParaLancarNoMes(HIST, [{ descricao: 'Aluguel', categoria: 'Aluguel' }], '2026-09-01').map(t => t.descricao))
      .toEqual(['Notebook']);
    expect(chaveDespesa({ descricao: 'Internet', categoria: null })).toBe(chaveDespesa({ descricao: 'Internet' }));
  });
});

describe('o que é gravado', () => {
  it('vencimento preserva o dia, limitado ao fim do mês', () => {
    expect(vencimentoNoMes('2026-08-31', '2026-09')).toBe('2026-09-30');
    expect(vencimentoNoMes('2026-01-31', '2027-02')).toBe('2027-02-28');
    expect(vencimentoNoMes('2026-01-29', '2028-02')).toBe('2028-02-29');
    expect(vencimentoNoMes(null, '2026-09')).toBe('2026-09-01');
  });
  it('linhas de insert', () => {
    const [aluguel, notebook] = montarLancamentosRecorrentes(recorrentesParaLancarNoMes(HIST, [], '2026-09-01'), 'emp', '2026-09');
    expect(aluguel).toEqual({
      empresa_id: 'emp', descricao: 'Aluguel', categoria: 'Aluguel', valor: 1500, recorrente: true, periodicidade: 'mensal',
      data_vencimento: '2026-09-30', recorrencia_ate: null, total_parcelas: null, parcela_atual: null,
      valor_total_compra: null, status: 'pendente',
    });
    expect(notebook.valor).toBe(333.33);
    expect(notebook.parcela_atual).toBe(5);       // julho = 3 → setembro = 5 (meses pulados contam)
    expect(notebook.data_vencimento).toBe('2026-09-10');
    expect(notebook.valor_total_compra).toBe(4000);
  });
  it('parcela nunca passa do total', () => {
    const [x] = montarLancamentosRecorrentes([{ descricao: 'X', valor: 10, data_vencimento: '2026-01-05', parcela_atual: 11, total_parcelas: 12 }], 'emp', '2026-09');
    expect(x.parcela_atual).toBe(12);
  });
  it('texto do aviso', () => {
    expect(textoRecorrentesPendentes(1)).toBe('1 despesa recorrente do mês anterior não foi lançada.');
    expect(textoRecorrentesPendentes(3)).toBe('3 despesas recorrentes do mês anterior não foram lançadas.');
  });
});

describe('histórico paginado', () => {
  it('filtros, ordem e erro', async () => {
    const { db, chamadas } = fakeDb();
    await carregarHistoricoRecorrentesMensais(db, 'emp', '2026-09-01');
    const [ops] = opsDe(chamadas, 'despesas');
    expect(ops).toContainEqual(['select', [COLUNAS_HISTORICO_RECORRENTE]]);
    expect(ops).toContainEqual(['eq', ['recorrente', true]]);
    expect(ops).toContainEqual(['eq', ['periodicidade', 'mensal']]);
    expect(ops).toContainEqual(['lt', ['data_vencimento', '2026-09-01']]);
    expect(ops).toContainEqual(['order', ['data_vencimento', { ascending: false }]]);
    expect(ops).toContainEqual(['order', ['id']]);
    await expect(carregarHistoricoRecorrentesMensais(fakeDb({ erroEm: 'despesas' }).db, 'emp', '2026-09-01')).rejects.toThrow();
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: `shared/despesas.ts`.**
   - Alargue os tipos (aceitam `null` do banco):
```ts
export type RecorrenteTemplateHistorico = {
  descricao: string;
  categoria?: string | null;
  valor: number | string;
  periodicidade?: string | null;
  data_vencimento?: string | null;
  recorrencia_ate?: string | null;
};
```
   `templatesRecorrentesParaLancar` vira genérico: `export function templatesRecorrentesParaLancar<T extends RecorrenteTemplateHistorico>(historico: T[], chavesMesAtual: Set<string>, periodoInicioIso: string): T[]` com `const porChave: Record<string, T> = {};` (corpo igual). `OcorrenciaHistorico`: `categoria?: string | null; data_vencimento?: string | null; recorrencia_ate?: string | null;` e em `calcularParcelaDerivada` o parâmetro `categoria: string | null | undefined`.
   - No fim do arquivo:
```ts
// ── Lançamento automático das recorrentes mensais (web e mobile) ──

export type DespesaRecorrenteTemplate = RecorrenteTemplateHistorico & {
  parcela_atual?: number | null;
  total_parcelas?: number | null;
  valor_total_compra?: number | string | null;
};

export type DespesaRecorrenteInsert = {
  empresa_id: string;
  descricao: string;
  categoria: string | null;
  valor: number;
  recorrente: true;
  periodicidade: string;
  data_vencimento: string;
  recorrencia_ate: string | null;
  total_parcelas: number | null;
  parcela_atual: number | null;
  valor_total_compra: number | null;
  status: 'pendente';
};

/** Identidade da série (descrição + categoria; null e vazio são iguais). */
export function chaveDespesa(d: { descricao: string; categoria?: string | null }): string {
  return `${d.descricao}||${d.categoria ?? ''}`;
}

/**
 * Templates a lançar no mês que começa em `inicioMes`. `historico` = recorrentes
 * mensais anteriores, mais recente primeiro; `despesasDoMes` = lista do mês
 * (CARREGADA COM SUCESSO — com erro, não chame: duplicaria tudo).
 */
export function recorrentesParaLancarNoMes<T extends RecorrenteTemplateHistorico>(
  historico: T[], despesasDoMes: { descricao: string; categoria?: string | null }[], inicioMes: string,
): T[] {
  return templatesRecorrentesParaLancar(historico, new Set(despesasDoMes.map(chaveDespesa)), inicioMes);
}

/** Dia do vencimento do template no mês 'yyyy-MM' (dia 31 em fevereiro → último dia). */
export function vencimentoNoMes(dataVencimentoTemplate: string | null | undefined, chaveMes: string): string {
  const k = chaveMes.slice(0, 7);
  const [ano, mes] = k.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = dataVencimentoTemplate ? Number(dataVencimentoTemplate.slice(8, 10)) || 1 : 1;
  return `${k}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

/** Linhas de INSERT das recorrentes no mês 'yyyy-MM' (regra única web + mobile). */
export function montarLancamentosRecorrentes(
  templates: DespesaRecorrenteTemplate[], empresaId: string, chaveMes: string,
): DespesaRecorrenteInsert[] {
  const [ano, mes] = chaveMes.slice(0, 7).split('-').map(Number);
  return templates.map((r): DespesaRecorrenteInsert => {
    const total = r.total_parcelas ?? null;
    const compra = r.valor_total_compra != null ? Number(r.valor_total_compra) : null;
    return {
      empresa_id: empresaId,
      descricao: r.descricao,
      categoria: r.categoria ?? null,
      // Compra parcelada: as parcelas lançadas depois recebem o valor-base (a sobra fica na 1ª).
      valor: compra != null && total != null
        ? dividirValorCompra(compra, total).valorBase
        : Math.round(Number(r.valor) * 100) / 100,
      recorrente: true,
      periodicidade: r.periodicidade ?? 'mensal',
      data_vencimento: vencimentoNoMes(r.data_vencimento, chaveMes),
      recorrencia_ate: r.recorrencia_ate ?? null,
      total_parcelas: total,
      parcela_atual: total != null && r.parcela_atual != null && r.data_vencimento
        ? proximaParcelaAtual(r.parcela_atual, total, r.data_vencimento, ano, mes)
        : null,
      valor_total_compra: compra,
      status: 'pendente',
    };
  });
}

export function textoRecorrentesPendentes(n: number): string {
  const s = n !== 1 ? 's' : '';
  return `${n} despesa${s} recorrente${s} do mês anterior não ${n !== 1 ? 'foram lançadas' : 'foi lançada'}.`;
}
```
- [ ] **Step 4: `shared/despesas-consultas.ts`**
```ts
/**
 * @file despesas-consultas.ts
 * Histórico ÚNICO das recorrentes mensais (auto-lançamento e contagem derivada),
 * web e mobile. Paginado (sem teto silencioso) e lança erro.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import type { DespesaRecorrenteTemplate } from './despesas';

export const COLUNAS_HISTORICO_RECORRENTE =
  'id, descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate, parcela_atual, total_parcelas, valor_total_compra';

/** Recorrentes MENSAIS com vencimento antes de `antesDe` ('yyyy-MM-dd'), mais recentes primeiro. */
export async function carregarHistoricoRecorrentesMensais(
  db: ClienteDb, empresaId: string, antesDe: string,
): Promise<DespesaRecorrenteTemplate[]> {
  return buscarTodasOuLancar<DespesaRecorrenteTemplate>((de, ate) => db.from('despesas')
    .select(COLUNAS_HISTORICO_RECORRENTE)
    .eq('empresa_id', empresaId).eq('recorrente', true).eq('periodicidade', 'mensal')
    .lt('data_vencimento', antesDe)
    .order('data_vencimento', { ascending: false }).order('id')
    .range(de, ate));
}
```
- [ ] **Step 5: Verificação da task** (inclui mobile — os tipos alargados não podem quebrar `financeiro.tsx`/`nova-despesa.tsx`).
- [ ] **Step 6: Commit** — `feat(shared): lancamento unico das despesas recorrentes e historico paginado`.

---

### Task 8: Web — Financeiro (lançamento via shared) e `FinanceMonthCalendar` via shared

**Files:** Modify `web/app/(app)/financeiro/page.tsx`, `web/components/FinanceMonthCalendar.tsx`, `web/tests/unit/finance-month-calendar.test.tsx` · Test `web/tests/unit/paridade-fase2b-web-financeiro.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-web-financeiro.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const page = ler('web/app/(app)/financeiro/page.tsx');
const cal = ler('web/components/FinanceMonthCalendar.tsx');

describe('web Financeiro: recorrentes e calendário pelas regras únicas', () => {
  it('lançamento', () => {
    for (const t of ['carregarHistoricoRecorrentesMensais(', 'recorrentesParaLancarNoMes(', 'montarLancamentosRecorrentes(',
      'textoRecorrentesPendentes(', ".insert(linhas).select('id')"]) expect(page).toContain(t);
    for (const t of ['templatesRecorrentesParaLancar(', 'proximaParcelaAtual(', '.limit(5000)']) expect(page).not.toContain(t);
  });
  it('calendário', () => {
    for (const t of ['gradeCalendarioMes(', 'rotuloIntervaloMes(', 'DIAS_SEMANA_ABREV', 'rotuloDiaExtenso(']) expect(cal).toContain(t);
    expect(cal).not.toContain("from 'date-fns'");
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: `financeiro/page.tsx`.**
   - No import de `@shared/despesas`: tire `templatesRecorrentesParaLancar` e `proximaParcelaAtual`; acrescente `recorrentesParaLancarNoMes, montarLancamentosRecorrentes, textoRecorrentesPendentes, type DespesaRecorrenteTemplate`. Acrescente `import { carregarHistoricoRecorrentesMensais } from '@shared/despesas-consultas';`.
   - `type RecorrenteTemplate = DespesaRecorrenteTemplate;`
   - Em `carregar`, troque a consulta `recMesAnt` (o `supabase.from('despesas')…limit(5000)`) por `carregarHistoricoRecorrentesMensais(supabase, empId, periodo.startDate),` e o laço de erro por `for (const r of [despLista, taxasLista, reservaLista]) { if (r.error) throw r.error; }`. Troque o bloco de auto-lançamento por:
```ts
      // Auto-lançamento: regra única (shared/despesas). Só chega aqui se a lista
      // de despesas do mês veio sem erro — com erro, nada é proposto.
      const todasMensais = recMesAnt;
      setRecorrentesParaLancar(recorrentesParaLancarNoMes(todasMensais, (despLista.data ?? []) as Despesa[], periodo.startDate));
      setHistoricoMensal(todasMensais);
```
   - Substitua `lancarRecorrentes`:
```ts
  async function lancarRecorrentes() {
    if (!empresaId || erroCarga || loading || lancandoRec || recorrentesParaLancar.length === 0) return;
    setLancandoRec(true);
    const linhas = montarLancamentosRecorrentes(recorrentesParaLancar, empresaId, chaveDoMesExibido(mesRef));
    const { data, error } = await supabase.from('despesas').insert(linhas).select('id');
    setLancandoRec(false);
    if (error) {
      alert(`Erro ao lançar as despesas recorrentes: ${error.message}`);
    } else if ((data ?? []).length !== linhas.length) {
      alert('Nem todas as despesas recorrentes foram lançadas. Confira a lista.');
    }
    setRecorrentesParaLancar([]);
    recarregar();
  }
```
   - No aviso, troque o texto montado à mão por `{textoRecorrentesPendentes(recorrentesParaLancar.length)}`.
- [ ] **Step 4: `FinanceMonthCalendar.tsx`** — mesmas props e mesmo JSX; troque a lógica:
```tsx
'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  chaveDoMesExibido, chaveDiaExibido, gradeCalendarioMes, rotuloIntervaloMes, rotuloMesAno, rotuloDiaExtenso,
  DIAS_SEMANA_ABREV,
} from '@shared/periodos';

// (FinanceMonthCalendarProps: igual)

/**
 * Seletor de mês do Financeiro com calendário (só visual: a tela filtra o mês
 * inteiro). Grade, rótulos e semana no domingo vêm de @shared/periodos — o app
 * usa as mesmas funções (mobile/components/CalendarioMesFinanceiro.tsx).
 */
export function FinanceMonthCalendar({ month, isOpen, isNextDisabled, onToggle, onPreviousMonth, onNextMonth }: FinanceMonthCalendarProps) {
  const chave = chaveDoMesExibido(month);
  const labelTitle = rotuloMesAno(chave);
  const rangeLabel = rotuloIntervaloMes(chave);
  const gridDays = gradeCalendarioMes(chave, chaveDiaExibido(month));
```
   No JSX: `{labelTitle}` no lugar de `{label}`; cabeçalhos `DIAS_SEMANA_ABREV.map(...)`; células `gridDays.map(c => <div key={c.dia} role="gridcell" aria-label={rotuloDiaExtenso(c.dia)} aria-current={c.destacado ? 'date' : undefined} data-outside-month={c.foraDoMes ? 'true' : undefined} className={… c.destacado / !c.foraDoMes …}>{c.numero}</div>)`. Apague `WEEKDAYS`, `monthLabel`, `monthGrid` e os imports de date-fns.
- [ ] **Step 5:** Em `finance-month-calendar.test.tsx` troque `{ name: 'Sab' }` por `{ name: 'Sáb' }` (o cabeçalho passa a vir da lista única, com acento).
- [ ] **Step 6: Verificação da task.**
- [ ] **Step 7: Commit** — `refactor(web): Financeiro lanca recorrentes e desenha o calendario pelas funcoes unicas`.

---

### Task 9: Mobile — Financeiro: lançamento das recorrentes e calendário do mês

**Files:** Modify `mobile/hooks/useFinanceiro.ts`, `mobile/app/(empresa)/financeiro.tsx` · Create `mobile/components/CalendarioMesFinanceiro.tsx` · Test `web/tests/unit/paridade-fase2b-mobile-financeiro.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-mobile-financeiro.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useFinanceiro.ts');
const tela = ler('mobile/app/(empresa)/financeiro.tsx');
const cal = ler('mobile/components/CalendarioMesFinanceiro.tsx');

describe('app Financeiro = web Financeiro (recorrentes e calendário)', () => {
  it('lançamento só com as duas listas carregadas com sucesso', () => {
    for (const t of ['carregarHistoricoRecorrentesMensais(', 'recorrentesParaLancarNoMes(', 'montarLancamentosRecorrentes(',
      ".insert(linhas).select('id')", 'despesas.isSuccess && historicoQ.isSuccess', 'invalidarFinanceiro(qc)',
      "'fin-despesas-historico'"]) expect(hook).toContain(t);
  });
  it('tela: aviso, botão e calendário', () => {
    for (const t of ['<CalendarioMesFinanceiro', 'textoRecorrentesPendentes(', 'Lançar agora', 'lancarRecorrentes', '!isError &&'])
      expect(tela).toContain(t);
  });
  it('calendário com a grade única', () => {
    for (const t of ['gradeCalendarioMes(', 'rotuloIntervaloMes(', 'DIAS_SEMANA_ABREV', 'rotuloMesAno(']) expect(cal).toContain(t);
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: `useFinanceiro.ts`.**
   - Imports: `useMutation, useQueryClient` de TanStack; `import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';`; troque o import de tipo `OcorrenciaHistorico` por `import { recorrentesParaLancarNoMes, montarLancamentosRecorrentes, type DespesaRecorrenteTemplate } from '@shared/despesas';`; `import { carregarHistoricoRecorrentesMensais } from '@shared/despesas-consultas';`; `chaveDoMesExibido` de `@shared/periodos` (e use `const chave = chaveDoMesExibido(mesRef);`, removendo `format` se ficar sem uso).
   - Substitua a query `despesasHistorico` por:
```ts
  // ── Histórico das recorrentes mensais (auto-lançamento + contagem derivada) — consulta única de shared
  const historicoQ = useQuery<DespesaRecorrenteTemplate[]>({
    queryKey: ['fin-despesas-historico', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarHistoricoRecorrentesMensais(supabase, empresaId!, periodo.startDate),
  });

  // Só propõe lançar quando as DUAS listas vieram com sucesso e não estão
  // recarregando: com erro (ou dado velho) proporia duplicar as recorrentes.
  const qc = useQueryClient();
  const recorrentesParaLancar = despesas.isSuccess && historicoQ.isSuccess && !despesas.isFetching && !historicoQ.isFetching
    ? recorrentesParaLancarNoMes(historicoQ.data, despesas.data, periodo.startDate)
    : [];

  const lancar = useMutation({
    mutationFn: async () => {
      if (recorrentesParaLancar.length === 0) return 0;
      const linhas = montarLancamentosRecorrentes(recorrentesParaLancar, empresaId!, chave);
      const { data, error } = await supabase.from('despesas').insert(linhas).select('id');
      if (error) throw error;
      if ((data ?? []).length !== linhas.length) throw new Error('Nem todas as despesas recorrentes foram lançadas. Confira a lista.');
      return linhas.length;
    },
    onSettled: () => invalidarFinanceiro(qc),
  });
```
   - No retorno: `despesasHistorico: historicoQ.data ?? []`, `recorrentesParaLancar`, `lancarRecorrentes: () => lancar.mutateAsync()`, `lancandoRecorrentes: lancar.isPending`; troque `despesasHistorico.isError`/`.refetch()` por `historicoQ`.
- [ ] **Step 4: Criar `mobile/components/CalendarioMesFinanceiro.tsx`**
```tsx
/**
 * @file CalendarioMesFinanceiro.tsx
 * Seletor de mês do Financeiro com o calendário do mês — equivalente RN do
 * FinanceMonthCalendar do web, com a MESMA grade (6 semanas, domingo primeiro),
 * rótulos e destaque (@shared/periodos). Só visual: a tela filtra o mês inteiro.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react-native';
import {
  chaveDoMesExibido, chaveDiaExibido, gradeCalendarioMes, rotuloIntervaloMes, rotuloMesAno, rotuloDiaExtenso,
  DIAS_SEMANA_ABREV,
} from '@shared/periodos';

const C = {
  surface: '#FFFFFF', border: '#E8E2DC', bg: '#F4F1EE', primary: '#2C1654',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

export type CalendarioMesFinanceiroProps = {
  mes: Date;
  aberto: boolean;
  proximoDesabilitado: boolean;
  onAlternar: () => void;
  onMesAnterior: () => void;
  onProximoMes: () => void;
};

const botaoSeta = {
  width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border,
  alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: C.bg,
};

export function CalendarioMesFinanceiro({
  mes, aberto, proximoDesabilitado, onAlternar, onMesAnterior, onProximoMes,
}: CalendarioMesFinanceiroProps) {
  const chave = chaveDoMesExibido(mes);
  const titulo = rotuloMesAno(chave);
  const grade = gradeCalendarioMes(chave, chaveDiaExibido(mes));

  return (
    <View style={{ marginHorizontal: 24, marginBottom: 16 }}>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14,
        padding: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}>
        <TouchableOpacity onPress={onMesAnterior} accessibilityLabel="Mês anterior" style={botaoSeta}>
          <ChevronLeft size={14} color={C.text2} strokeWidth={2.5} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onAlternar}
          accessibilityLabel={`${aberto ? 'Fechar' : 'Abrir'} calendário de ${titulo}`}
          accessibilityState={{ expanded: aberto }}
          style={{ alignItems: 'center', minWidth: 160 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{titulo}</Text>
            <View style={{ transform: [{ rotate: aberto ? '180deg' : '0deg' }] }}>
              <ChevronDown size={13} color={C.text4} />
            </View>
          </View>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
            {rotuloIntervaloMes(chave)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onProximoMes} disabled={proximoDesabilitado} accessibilityLabel="Próximo mês"
          style={[botaoSeta, { opacity: proximoDesabilitado ? 0.3 : 1 }]}
        >
          <ChevronRight size={14} color={C.text2} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {aberto && (
        <View style={{ marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12 }}>
          <View style={{ flexDirection: 'row' }}>
            {DIAS_SEMANA_ABREV.map(d => (
              <Text key={d} style={{ width: `${100 / 7}%`, textAlign: 'center', fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text4, paddingVertical: 6 }}>
                {d}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {grade.map(c => (
              <View key={c.dia} accessibilityLabel={rotuloDiaExtenso(c.dia)} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                <View style={{ flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.destacado ? C.primary : 'transparent' }}>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13,
                    color: c.destacado ? '#fff' : c.foraDoMes ? C.text4 : C.text2,
                    opacity: c.foraDoMes && !c.destacado ? 0.6 : 1,
                  }}>
                    {c.numero}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
```
- [ ] **Step 5: `financeiro.tsx`.**
   - `import { CalendarioMesFinanceiro } from '@/components/CalendarioMesFinanceiro';` e `textoRecorrentesPendentes` no import de `@shared/despesas`; tire `startOfMonth, endOfMonth` do date-fns.
   - Estado `const [calendarioAberto, setCalendarioAberto] = useState(false);` e desestruture `recorrentesParaLancar, lancarRecorrentes, lancandoRecorrentes` de `useFinanceiro(mesRef)`.
   - Substitua o `MotiView` "Seletor de mês" inteiro por:
```tsx
        <CalendarioMesFinanceiro
          mes={mesRef}
          aberto={calendarioAberto}
          proximoDesabilitado={false}
          onAlternar={() => setCalendarioAberto(a => !a)}
          onMesAnterior={() => setMesRef(m => subMonths(m, 1))}
          onProximoMes={() => setMesRef(m => addMonths(m, 1))}
        />
```
   (o web também não trava o mês seguinte: `isNextDisabled={false}`).
   - Logo após o banner de erro:
```tsx
        {/* ── Recorrentes do mês anterior não lançadas (mesma regra do web) ── */}
        {!isError && recorrentesParaLancar.length > 0 && (
          <View style={{ marginHorizontal: 24, marginBottom: 12, backgroundColor: C.amberSoft, borderWidth: 1, borderColor: 'rgba(180,83,9,0.2)', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <RefreshCw size={14} color={C.amber} strokeWidth={2} />
            <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.amber }}>
              {textoRecorrentesPendentes(recorrentesParaLancar.length)}
            </Text>
            <TouchableOpacity
              disabled={lancandoRecorrentes}
              onPress={async () => {
                try { await lancarRecorrentes(); }
                catch (e) { Alert.alert('Erro ao lançar as despesas recorrentes', (e as Error).message); }
              }}
              style={{ backgroundColor: C.amber, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, opacity: lancandoRecorrentes ? 0.6 : 1 }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' }}>
                {lancandoRecorrentes ? 'Lançando...' : 'Lançar agora'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
```
   Mantenha exatamente 3 `invalidarFinanceiro(qc)` na tela (o do lançamento está no hook) e a fileira 'Receita'/'Gastos'/'Lucro'.
- [ ] **Step 6: Verificação da task** (mobile).
- [ ] **Step 7: Commit** — `feat(mobile): Financeiro lanca recorrentes como o web (a prova de erro) e ganha o calendario do mes`.

---

### Task 10: `shared/dashboard.ts` + `shared/dashboard-consultas.ts`

**Files:** Create `shared/dashboard.ts`, `shared/dashboard-consultas.ts`, `web/tests/unit/shared-dashboard.test.ts`, `web/tests/unit/shared-dashboard-consultas.test.ts`

- [ ] **Step 1: Testes que falham**
```ts
// web/tests/unit/shared-dashboard.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import { calcularKpisFinanceiros } from '@shared/kpis-financeiros';
import {
  clientesParaReconquistar, datasDasUltimasVisitas, aniversariantesProximos, janelaDespesasVencendo,
  progressoMetaEmpresa, rotuloProgressoMeta, resumoComandasNaoFechadas, navegacaoMesDashboard,
  geometriaSparkline, cartoesKpiDashboard, type UltimaVisita,
} from '@shared/dashboard';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const HOJE = '2026-09-30';

describe('reconquista: mais de 45 dias sem visita', () => {
  const ultimas = new Map<string, UltimaVisita>([
    ['a', { nome: 'Ana', ultimaVisita: '2026-08-15T15:00:00Z' }],   // 46 dias
    ['b', { nome: 'Bia', ultimaVisita: '2026-08-16T15:00:00Z' }],   // 45: não entra
    ['c', { nome: 'Cris', ultimaVisita: '2026-05-01T15:00:00Z' }],  // 152
    ['d', { nome: 'Duda', ultimaVisita: '2026-09-29T15:00:00Z' }],
    ['e', { nome: 'Eva', ultimaVisita: '2026-08-16T02:00:00Z' }],   // 15/08 23:00 BRT → 46
  ]);
  it('mais antigas primeiro, empate por nome', () => {
    expect(clientesParaReconquistar(ultimas, HOJE).map(c => [c.clienteId, c.diasSemVisita])).toEqual([['c', 152], ['a', 46], ['e', 46]]);
  });
  it('limite e dias configuráveis', () => {
    expect(clientesParaReconquistar(ultimas, HOJE, { dias: 0, limite: 2 })).toHaveLength(2);
  });
  it('datas para clientesSumidas', () => {
    expect(datasDasUltimasVisitas(ultimas).get('c')).toBe('2026-05-01T15:00:00Z');
  });
});

describe('aniversariantes nos próximos 7 dias', () => {
  it('hoje, amanhã, 7 dias; ontem e sem data ficam fora', () => {
    const cs = [
      { id: '1', nome: 'Hoje', data_nascimento: '1904-09-30' }, { id: '2', nome: 'Amanhã', data_nascimento: '1990-10-01' },
      { id: '3', nome: 'Sete', data_nascimento: '1904-10-07' }, { id: '4', nome: 'Oito', data_nascimento: '1904-10-08' },
      { id: '5', nome: 'Ontem', data_nascimento: '1904-09-29' }, { id: '6', nome: 'Sem', data_nascimento: null },
    ];
    expect(aniversariantesProximos(cs, HOJE).map(c => [c.id, c.diasAte, c.rotulo]))
      .toEqual([['1', 0, '🎂 Hoje!'], ['2', 1, 'Amanhã'], ['3', 7, 'Em 7 dias']]);
  });
  it('virada de ano e 29/02 em ano não bissexto', () => {
    expect(aniversariantesProximos([{ id: 'x', nome: 'X', data_nascimento: '1904-01-02' }], '2026-12-28')[0])
      .toMatchObject({ diasAte: 5, dataAniversario: '2027-01-02' });
    expect(aniversariantesProximos([{ id: 'y', nome: 'Y', data_nascimento: '1904-02-29' }], '2027-02-25')[0])
      .toMatchObject({ diasAte: 3, dataAniversario: '2027-02-28' });
  });
});

describe('despesas vencendo, meta, comandas e navegação', () => {
  it('janela de 7 dias', () => {
    expect(janelaDespesasVencendo(HOJE)).toEqual({ de: '2026-09-30', ate: '2026-10-07' });
  });
  it('meta mensal', () => {
    expect(progressoMetaEmpresa(5000, 10000)).toEqual({ temMeta: true, percentual: 50, atingida: false, faltam: 5000, acima: 0 });
    expect(progressoMetaEmpresa(12000, '10000')).toEqual({ temMeta: true, percentual: 100, atingida: true, faltam: 0, acima: 2000 });
    expect(progressoMetaEmpresa(100, 0).temMeta).toBe(false);
    expect(progressoMetaEmpresa(100, null).temMeta).toBe(false);
    const fmt = (v: number) => `R$ ${v}`;
    expect(rotuloProgressoMeta(progressoMetaEmpresa(5000, 10000), fmt)).toBe('50% concluído · faltam R$ 5000');
    expect(rotuloProgressoMeta(progressoMetaEmpresa(12000, 10000), fmt)).toBe('Meta atingida! +R$ 2000 acima');
  });
  it('comandas não fechadas', () => {
    expect(resumoComandasNaoFechadas([])).toEqual({ quantidade: 0, maisAntiga: null });
    expect(resumoComandasNaoFechadas([{ id: 'a', data_hora_inicio: 'x' }, { id: 'b', data_hora_inicio: 'y' }]))
      .toEqual({ quantidade: 2, maisAntiga: { id: 'a', data_hora_inicio: 'x' } });
  });
  it('navegação de mês (nunca o futuro)', () => {
    expect(navegacaoMesDashboard(undefined, HOJE)).toEqual({ chave: '2026-09', isMesAtual: true, anterior: '2026-08', seguinte: null });
    expect(navegacaoMesDashboard('2026-03', HOJE)).toEqual({ chave: '2026-03', isMesAtual: false, anterior: '2026-02', seguinte: '2026-04' });
    for (const x of ['2026-10', '2026-13', 'abc']) expect(navegacaoMesDashboard(x, HOJE).chave).toBe('2026-09');
    expect(navegacaoMesDashboard('2025-12', HOJE).seguinte).toBe('2026-01');
  });
});

describe('sparkline (mesma geometria no web e no app)', () => {
  it('linha, área e último ponto', () => {
    const g = geometriaSparkline([10, 20]);
    expect(g.linha).toBe('M8.0,74.0 L99.0,43.0 L190.0,12.0');
    expect(g.area).toBe('M8.0,74.0 L99.0,43.0 L190.0,12.0 L190.0,74 L8,74 Z');
    expect(g.ultimo).toEqual({ x: 190, y: 12 });
    expect(g.vazio).toBe(false);
    expect(geometriaSparkline([10, 20], 200, 80, 0).linha).toBe('M8.0,74.0 L99.0,74.0 L190.0,74.0');
    expect(geometriaSparkline([]).linha).toBe('M8.0,74.0 L190.0,74.0');
    expect(geometriaSparkline([0, 0]).vazio).toBe(true);
  });
});

describe('cartões de KPI do mês (mesma lista nas duas plataformas)', () => {
  const k = calcularKpisFinanceiros(fixtureSetembro(), limitesMes('2026-09'));
  const kAnt = calcularKpisFinanceiros(fixtureSetembro(), limitesMes('2026-08'));
  const fmt = (v: number) => `R$${v}`;
  it('não dona', () => {
    const c = cartoesKpiDashboard(k, kAnt, { isOwner: false, retiradasMes: 0, emprestimosAbertos: 0, fmt });
    expect(c.map(x => x.id)).toEqual(['liquido', 'lucro', 'comissoes', 'cancelamento']);
    expect(c[0]).toMatchObject({ rotulo: 'Líquido após taxas', valor: 'R$552.5' });
    expect(c[1]).toMatchObject({ rotulo: 'Lucro do mês', valor: 'R$117', delta: 368, sub: null });
    expect(c[2]).toMatchObject({ sub: 'R$80 de R$140 pendente', subDestaque: true });
    expect(c[3]).toMatchObject({ valor: '33.3%', sub: '2 perdido(s)' });
  });
  it('dona com retiradas e empréstimos', () => {
    const c = cartoesKpiDashboard(k, kAnt, { isOwner: true, retiradasMes: 17, emprestimosAbertos: 50, fmt });
    expect(c[1].sub).toBe('Após retiradas R$100');
    expect(c.map(x => x.id)).toEqual(['liquido', 'lucro', 'comissoes', 'cancelamento', 'donaDeve']);
  });
});
```

```ts
// web/tests/unit/shared-dashboard-consultas.test.ts
import { describe, expect, it } from 'vitest';
import {
  carregarUltimasVisitas, aplicarFiltroComandasNaoFechadas, carregarComandasNaoFechadas,
  aplicarFiltroDespesasVencendo, carregarDespesasVencendo, carregarAniversariantes,
} from '@shared/dashboard-consultas';
import { fakeDb, opsDe, gravador } from './fixtures/fake-db';

describe('últimas visitas (reconquista e sumidas)', () => {
  it('paginado, mais recente primeiro, 1ª linha de cada cliente', async () => {
    const linhas = [
      { cliente_id: 'a', data_hora_inicio: '2026-09-10T12:00:00Z', cliente: { nome: 'Ana' } },
      { cliente_id: null, data_hora_inicio: '2026-09-09T12:00:00Z', cliente: null },
      { cliente_id: 'a', data_hora_inicio: '2026-08-10T12:00:00Z', cliente: { nome: 'Ana' } },
      { cliente_id: 'b', data_hora_inicio: '2026-07-10T12:00:00Z', cliente: null },
    ];
    const { db, chamadas } = fakeDb({ linhas: { agendamentos: linhas } });
    const m = await carregarUltimasVisitas(db, 'emp', '2026-10-01T02:59:59.999Z');
    expect([...m.entries()]).toEqual([
      ['a', { nome: 'Ana', ultimaVisita: '2026-09-10T12:00:00Z' }],
      ['b', { nome: 'Cliente', ultimaVisita: '2026-07-10T12:00:00Z' }],
    ]);
    const [ops] = opsDe(chamadas, 'agendamentos');
    expect(ops).toContainEqual(['eq', ['status', 'concluido']]);
    expect(ops).toContainEqual(['lte', ['data_hora_inicio', '2026-10-01T02:59:59.999Z']]);
    expect(ops).toContainEqual(['order', ['data_hora_inicio', { ascending: false }]]);
    expect(ops).toContainEqual(['order', ['id']]);
  });
  it('sem limite final e com erro', async () => {
    const { db, chamadas } = fakeDb();
    await carregarUltimasVisitas(db, 'emp');
    expect(opsDe(chamadas, 'agendamentos')[0].some(([m]) => m === 'lte')).toBe(false);
    await expect(carregarUltimasVisitas(fakeDb({ erroEm: 'agendamentos' }).db, 'emp')).rejects.toThrow();
  });
});

describe('filtros únicos (Dashboard e badges do Sidebar)', () => {
  it('comandas não fechadas', () => {
    const { b, ops } = gravador();
    aplicarFiltroComandasNaoFechadas(b, 'emp', '2026-09-30T15:00:00.000Z');
    expect(ops).toEqual([
      ['eq', ['empresa_id', 'emp']], ['is', ['comanda_id', null]],
      ['not', ['status', 'in', '("cancelado","faltou")']], ['lt', ['data_hora_fim', '2026-09-30T15:00:00.000Z']],
    ]);
  });
  it('despesas vencendo em 7 dias', () => {
    const { b, ops } = gravador();
    aplicarFiltroDespesasVencendo(b, 'emp', '2026-09-30');
    expect(ops).toEqual([
      ['eq', ['empresa_id', 'emp']], ['eq', ['status', 'pendente']],
      ['gte', ['data_vencimento', '2026-09-30']], ['lte', ['data_vencimento', '2026-10-07']],
    ]);
  });
  it('consultas paginadas com ordem estável', async () => {
    const { db, chamadas } = fakeDb();
    await carregarComandasNaoFechadas(db, 'emp', 'agora');
    await carregarDespesasVencendo(db, 'emp', '2026-09-30');
    await carregarAniversariantes(db, 'emp');
    expect(opsDe(chamadas, 'agendamentos')[0]).toContainEqual(['order', ['data_hora_inicio', { ascending: true }]]);
    expect(opsDe(chamadas, 'despesas')[0]).toContainEqual(['order', ['data_vencimento']]);
    const cli = opsDe(chamadas, 'clientes')[0];
    expect(cli).toContainEqual(['eq', ['ativo', true]]);
    expect(cli).toContainEqual(['not', ['data_nascimento', 'is', null]]);
    for (const t of ['agendamentos', 'despesas', 'clientes']) expect(opsDe(chamadas, t)[0]).toContainEqual(['order', ['id']]);
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: `shared/dashboard.ts`**
```ts
/**
 * @file dashboard.ts
 * Regras ÚNICAS do Dashboard de web e mobile (decisões do dono, Fase 2B):
 * - Reconquista (= clientes inativos): última visita concluída há MAIS de 45
 *   dias de Brasília; mais antigas primeiro; até 5.
 * - Aniversariantes: próximos 7 dias (29/02 em ano comum = 28/02); até 8.
 * - Despesas vencendo: pendentes de hoje a hoje+7.
 * - Mês navegável, nunca no futuro.
 */
import { chaveDiaBRT, diasEntre, somarDias, somarMeses, ultimoDiaDoMes } from './periodos';
import { arredondar, variacaoPercentual, type KpisFinanceiros } from './kpis-financeiros';

export const DIAS_RECONQUISTA = 45;
export const DIAS_ANIVERSARIANTES = 7;
export const DIAS_DESPESAS_VENCENDO = 7;

export type UltimaVisita = { nome: string; ultimaVisita: string };
export type ClienteReconquistar = { clienteId: string; nome: string; ultimaVisita: string; diasSemVisita: number };

export function clientesParaReconquistar(
  ultimas: Map<string, UltimaVisita>, hoje: string, opcoes: { dias?: number; limite?: number } = {},
): ClienteReconquistar[] {
  const dias = opcoes.dias ?? DIAS_RECONQUISTA;
  const lista: ClienteReconquistar[] = [];
  for (const [clienteId, v] of ultimas) {
    const diasSemVisita = diasEntre(chaveDiaBRT(v.ultimaVisita), hoje);
    if (diasSemVisita > dias) lista.push({ clienteId, nome: v.nome, ultimaVisita: v.ultimaVisita, diasSemVisita });
  }
  return lista
    .sort((a, b) => b.diasSemVisita - a.diasSemVisita || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, opcoes.limite ?? 5);
}

/** cliente_id → data da última visita (entrada de clientesSumidas). */
export function datasDasUltimasVisitas(ultimas: Map<string, UltimaVisita>): Map<string, string> {
  return new Map([...ultimas].map(([id, v]) => [id, v.ultimaVisita] as [string, string]));
}

export type ClienteAniversario = { id: string; nome: string; data_nascimento: string | null; telefone?: string | null };
export type Aniversariante = ClienteAniversario & { diasAte: number; dataAniversario: string; rotulo: string };

function aniversarioNoAno(ano: number, mm: string, dd: string): string {
  const dia = `${ano}-${mm}-${dd}`;
  const ultimo = ultimoDiaDoMes(`${ano}-${mm}`);
  return dia > ultimo ? ultimo : dia;
}

export function aniversariantesProximos(
  clientes: ClienteAniversario[], hoje: string, opcoes: { dias?: number; limite?: number } = {},
): Aniversariante[] {
  const dias = opcoes.dias ?? DIAS_ANIVERSARIANTES;
  const ano = Number(hoje.slice(0, 4));
  const out: Aniversariante[] = [];
  for (const c of clientes) {
    const [, mm = '', dd = ''] = (c.data_nascimento ?? '').split('-');
    if (!/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd.slice(0, 2))) continue;
    let data = aniversarioNoAno(ano, mm, dd.slice(0, 2));
    if (data < hoje) data = aniversarioNoAno(ano + 1, mm, dd.slice(0, 2));
    const diasAte = diasEntre(hoje, data);
    if (diasAte > dias) continue;
    out.push({ ...c, diasAte, dataAniversario: data, rotulo: diasAte === 0 ? '🎂 Hoje!' : diasAte === 1 ? 'Amanhã' : `Em ${diasAte} dias` });
  }
  return out.sort((a, b) => a.diasAte - b.diasAte || a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, opcoes.limite ?? 8);
}

export function janelaDespesasVencendo(hoje: string, dias = DIAS_DESPESAS_VENCENDO): { de: string; ate: string } {
  return { de: hoje, ate: somarDias(hoje, dias) };
}

export type ProgressoMeta = { temMeta: boolean; percentual: number; atingida: boolean; faltam: number; acima: number };

/** Meta mensal da EMPRESA (empresas.meta_mensal) contra o faturamento bruto do mês. */
export function progressoMetaEmpresa(bruto: number, meta: number | string | null | undefined): ProgressoMeta {
  const m = Number(meta ?? 0);
  if (!Number.isFinite(m) || m <= 0) return { temMeta: false, percentual: 0, atingida: false, faltam: 0, acima: 0 };
  return {
    temMeta: true,
    percentual: Math.min((bruto / m) * 100, 100),
    atingida: bruto >= m,
    faltam: arredondar(Math.max(m - bruto, 0)),
    acima: arredondar(Math.max(bruto - m, 0)),
  };
}

export function rotuloProgressoMeta(p: ProgressoMeta, fmt: (v: number) => string): string {
  return p.atingida ? `Meta atingida! +${fmt(p.acima)} acima` : `${p.percentual.toFixed(0)}% concluído · faltam ${fmt(p.faltam)}`;
}

export type ComandaNaoFechadaRow = { id: string; data_hora_inicio: string };

/** Linhas em ordem crescente de início (consulta de shared): a 1ª é a mais antiga. */
export function resumoComandasNaoFechadas(rows: ComandaNaoFechadaRow[]): { quantidade: number; maisAntiga: ComandaNaoFechadaRow | null } {
  return { quantidade: rows.length, maisAntiga: rows[0] ?? null };
}

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mês do Dashboard: o pedido se for válido e não futuro; senão o atual. */
export function navegacaoMesDashboard(
  solicitado: string | null | undefined, hoje: string,
): { chave: string; isMesAtual: boolean; anterior: string; seguinte: string | null } {
  const atual = hoje.slice(0, 7);
  const chave = solicitado && RE_MES.test(solicitado) && solicitado <= atual ? solicitado : atual;
  return { chave, isMesAtual: chave === atual, anterior: somarMeses(chave, -1), seguinte: chave === atual ? null : somarMeses(chave, 1) };
}

export type GeometriaSparkline = { linha: string; area: string; ultimo: { x: number; y: number }; vazio: boolean };

/** Geometria da sparkline de receita acumulada (SparkBars web e SparkLinha app). */
export function geometriaSparkline(dados: number[], largura = 200, altura = 80, progresso = 1): GeometriaSparkline {
  const padL = 8, padR = 10, padT = 12, padB = 6;
  const plotW = largura - padL - padR;
  const plotH = altura - padT - padB;
  const base = padT + plotH;
  const max = Math.max(...dados, 1);
  const vazio = dados.length === 0 || dados.every(v => v === 0);
  const pts: { x: number; y: number }[] = [{ x: padL, y: base }];
  if (!vazio) {
    dados.forEach((v, i) => {
      const alvo = base - (v / max) * plotH;
      pts.push({ x: padL + ((i + 1) / dados.length) * plotW, y: base + (alvo - base) * progresso });
    });
  } else {
    pts.push({ x: padL + plotW, y: base });
  }
  const linha = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ultimo = pts[pts.length - 1];
  return { linha, area: `${linha} L${ultimo.x.toFixed(1)},${base} L${padL},${base} Z`, ultimo, vazio };
}

export type CartaoKpiDashboard = {
  id: 'liquido' | 'lucro' | 'comissoes' | 'cancelamento' | 'donaDeve';
  rotulo: string;
  valor: string;
  sub: string | null;
  subDestaque: boolean;
  delta: number | null;
  tom: 'primario' | 'negativo' | 'alerta';
};

/** KPIs do mês do Dashboard — a MESMA lista no web e no app. */
export function cartoesKpiDashboard(
  k: KpisFinanceiros, kAnt: KpisFinanceiros,
  o: { isOwner: boolean; retiradasMes: number; emprestimosAbertos: number; fmt: (v: number) => string },
): CartaoKpiDashboard[] {
  const { fmt } = o;
  const lista: CartaoKpiDashboard[] = [
    { id: 'liquido', rotulo: 'Líquido após taxas', valor: fmt(k.liquidoAposTaxas), sub: null, subDestaque: false, delta: null, tom: 'primario' },
    { id: 'lucro', rotulo: 'Lucro do mês', valor: fmt(k.lucro),
      sub: o.isOwner && o.retiradasMes > 0 ? `Após retiradas ${fmt(arredondar(k.lucro - o.retiradasMes))}` : null,
      subDestaque: false, delta: variacaoPercentual(k.lucro, kAnt.lucro), tom: k.lucro >= 0 ? 'primario' : 'negativo' },
    { id: 'comissoes', rotulo: 'Comissões', valor: fmt(k.comissoes),
      sub: k.comissoesPendentes > 0 ? `${fmt(k.comissoesPendentes)} de ${fmt(k.comissoes)} pendente` : 'Em dia',
      subDestaque: k.comissoesPendentes > 0, delta: null, tom: 'alerta' },
    { id: 'cancelamento', rotulo: '% Cancelamento', valor: `${k.pctCancelamento.toFixed(1)}%`,
      sub: k.perdidos > 0 ? `${k.perdidos} perdido(s)` : null, subDestaque: false, delta: null, tom: 'negativo' },
  ];
  if (o.isOwner && o.emprestimosAbertos > 0) {
    lista.push({ id: 'donaDeve', rotulo: 'A dona deve', valor: fmt(o.emprestimosAbertos), sub: 'empréstimos em aberto', subDestaque: false, delta: null, tom: 'alerta' });
  }
  return lista;
}
```
- [ ] **Step 4: `shared/dashboard-consultas.ts`**
```ts
/**
 * @file dashboard-consultas.ts
 * Consultas ÚNICAS do Dashboard (web server component, Sidebar e app). Lançam
 * erro. Os `aplicarFiltro...` recebem um builder pronto (ex.: com
 * `{ count: 'exact', head: true }` no Sidebar) e só aplicam os filtros da regra.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { janelaDespesasVencendo, type ClienteAniversario, type ComandaNaoFechadaRow, type UltimaVisita } from './dashboard';

/** Última visita concluída por cliente (até `ateIso`, se informado). Sem teto de linhas. */
export async function carregarUltimasVisitas(db: ClienteDb, empresaId: string, ateIso?: string): Promise<Map<string, UltimaVisita>> {
  const linhas = await buscarTodasOuLancar<{ cliente_id: string | null; data_hora_inicio: string; cliente: { nome: string | null } | null }>(
    (de, ate) => {
      let q = db.from('agendamentos')
        .select('cliente_id, data_hora_inicio, cliente:clientes!agendamentos_cliente_id_fkey(nome)')
        .eq('empresa_id', empresaId).eq('status', 'concluido');
      if (ateIso) q = q.lte('data_hora_inicio', ateIso);
      return q.order('data_hora_inicio', { ascending: false }).order('id').range(de, ate);
    });
  // Ordem decrescente: a 1ª linha de cada cliente é a última visita.
  const mapa = new Map<string, UltimaVisita>();
  for (const a of linhas) {
    if (a.cliente_id && !mapa.has(a.cliente_id)) mapa.set(a.cliente_id, { nome: a.cliente?.nome || 'Cliente', ultimaVisita: a.data_hora_inicio });
  }
  return mapa;
}

/** Atendimento que já terminou e nunca virou comanda (nem cancelado/falta). */
export function aplicarFiltroComandasNaoFechadas<Q>(q: Q, empresaId: string, agoraIso: string): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).eq('empresa_id', empresaId).is('comanda_id', null)
    .not('status', 'in', '("cancelado","faltou")').lt('data_hora_fim', agoraIso);
}

export async function carregarComandasNaoFechadas(db: ClienteDb, empresaId: string, agoraIso: string): Promise<ComandaNaoFechadaRow[]> {
  return buscarTodasOuLancar<ComandaNaoFechadaRow>((de, ate) =>
    aplicarFiltroComandasNaoFechadas(db.from('agendamentos').select('id, data_hora_inicio'), empresaId, agoraIso)
      .order('data_hora_inicio', { ascending: true }).order('id').range(de, ate));
}

export function aplicarFiltroDespesasVencendo<Q>(q: Q, empresaId: string, hoje: string): Q {
  const { de, ate } = janelaDespesasVencendo(hoje);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).eq('empresa_id', empresaId).eq('status', 'pendente')
    .gte('data_vencimento', de).lte('data_vencimento', ate);
}

export type DespesaVencendoRow = { id: string; descricao: string; valor: number | string; data_vencimento: string };

export async function carregarDespesasVencendo(db: ClienteDb, empresaId: string, hoje: string): Promise<DespesaVencendoRow[]> {
  return buscarTodasOuLancar<DespesaVencendoRow>((de, ate) =>
    aplicarFiltroDespesasVencendo(db.from('despesas').select('id, descricao, valor, data_vencimento'), empresaId, hoje)
      .order('data_vencimento').order('id').range(de, ate));
}

export async function carregarAniversariantes(db: ClienteDb, empresaId: string): Promise<ClienteAniversario[]> {
  return buscarTodasOuLancar<ClienteAniversario>((de, ate) => db.from('clientes')
    .select('id, nome, data_nascimento, telefone')
    .eq('empresa_id', empresaId).eq('ativo', true).not('data_nascimento', 'is', null)
    .order('id').range(de, ate));
}
```
- [ ] **Step 5: Verificação da task** (inclui mobile).
- [ ] **Step 6: Commit** — `feat(shared): regras e consultas unicas do Dashboard`.

---

### Task 11: Web — Dashboard (comandas não fechadas, regras de shared), Sidebar e SparkBars

**Files:** Modify `web/app/(app)/dashboard/page.tsx`, `web/components/Sidebar.tsx`, `web/components/SparkBars.tsx`, `web/tests/unit/paridade-fase2a-web-dashboard.test.ts` · Test `web/tests/unit/paridade-fase2b-web-dashboard.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-web-dashboard.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const page = ler('web/app/(app)/dashboard/page.tsx');
const sidebar = ler('web/components/Sidebar.tsx');
const spark = ler('web/components/SparkBars.tsx');

describe('web Dashboard com as regras únicas', () => {
  it('usa shared', () => {
    for (const t of ['navegacaoMesDashboard(', 'carregarUltimasVisitas(', 'clientesParaReconquistar(', 'carregarAniversariantes(',
      'aniversariantesProximos(', 'carregarDespesasVencendo(', 'carregarComandasNaoFechadas(', 'resumoComandasNaoFechadas(',
      'progressoMetaEmpresa(', 'rotuloProgressoMeta(', 'cartoesKpiDashboard(kpis, kpisAnt', 'horaBRT(']) expect(page).toContain(t);
    for (const t of ['.limit(3000)', 'differenceInDays', 'cutoff45', 'todayMidnight']) expect(page).not.toContain(t);
  });
  it('alerta de comandas não fechadas e link de comissões para /comissoes', () => {
    expect(page).toMatch(/comandas? não fechadas?/);
    expect(page).toContain('href="/comanda"');
    expect(page).toContain('href="/comissoes"');
  });
  it('Sidebar com os mesmos filtros e o dia de Brasília', () => {
    expect(sidebar).toContain('aplicarFiltroComandasNaoFechadas(');
    expect(sidebar).toContain('aplicarFiltroDespesasVencendo(');
    expect(sidebar).toContain('hojeBRT()');
    expect(sidebar).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
  it('SparkBars usa a geometria única', () => {
    expect(spark).toContain('geometriaSparkline(');
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: `dashboard/page.tsx`.**
   - Imports: tire `differenceInDays`; acrescente `rotuloMesAno, horaBRT` em `@shared/periodos`; `import { navegacaoMesDashboard, clientesParaReconquistar, aniversariantesProximos, resumoComandasNaoFechadas, progressoMetaEmpresa, rotuloProgressoMeta, cartoesKpiDashboard } from '@shared/dashboard';` `import { carregarUltimasVisitas, carregarAniversariantes, carregarDespesasVencendo, carregarComandasNaoFechadas } from '@shared/dashboard-consultas';`.
   - Mês: substitua de `const mesAtualKey` até `paramSeguinte` por:
```ts
  const nav           = navegacaoMesDashboard(mesParam, hojeStr);
  const mesRefKey     = nav.chave;
  const mesRef        = new Date(`${mesRefKey}-01T12:00:00`);
  const isMesAtual    = nav.isMesAtual;
  const mesRefLabel   = rotuloMesAno(mesRefKey);
  const paramAnterior = nav.anterior;
  const paramSeguinte = nav.seguinte;
```
   (apague `daqui7`; o link "próximo" usa `paramSeguinte` só quando `!isMesAtual`).
   - No `Promise.all`, troque as posições 3, 4 e 5 por `carregarDespesasVencendo(supabase, empresaId, hojeStr)`, `carregarUltimasVisitas(supabase, empresaId)`, `carregarAniversariantes(supabase, empresaId)` e acrescente no fim `carregarComandasNaoFechadas(supabase, empresaId, new Date().toISOString())`. O laço de erro fica `for (const r of [resultado[0], resultado[1], resultado[2]]) { if (r.error) throw r.error; }`. Desestruture: `agendamentosHoje, totalClientes, estoqueBaixo, despVencendo, ultimasVisitas, clientesComAniversario, dados, dadosDeHoje, comissoesPendentesRows, retiradasDados, comandasRows`.
   - Derivados: `const despPendentesItems = despVencendo;` `const comandas = resumoComandasNaoFechadas(comandasRows);` `totalAlertas` soma `+ (comandas.quantidade > 0 ? 1 : 0)`; troque o bloco "Clientes inativos" por `const clientesInativos = clientesParaReconquistar(ultimasVisitas, hojeStr);` e o de aniversariantes por `const aniversariantes = aniversariantesProximos(clientesComAniversario, hojeStr);`; `const meta = progressoMetaEmpresa(bruto, empresa.meta_mensal);` (apague `metaMensal`); `const cartoesMes = cartoesKpiDashboard(kpis, kpisAnt, { isOwner, retiradasMes, emprestimosAbertos, fmt });` (apague `pctLucro`, `lucroAposRetiradas`, `totalComMes`, `comPendenteMes`, `perdidosMes`, `pctCancelamento` se ficarem sem uso; mantenha `lucro` para o hero).
   - Grade de KPIs do mês: troque o array literal por `cartoesMes.map(({ id, rotulo, valor, sub, subDestaque, delta, tom }, i, arr) => …)` com `key={id}`, `const Icon = id === 'cancelamento' ? XCircle : id === 'comissoes' || id === 'donaDeve' ? BadgeDollarSign : Wallet;`, `const color = tom === 'negativo' ? 'var(--color-rose)' : tom === 'alerta' ? 'var(--color-amber)' : 'var(--color-primary)';` e a cor do `sub` `subDestaque ? 'var(--color-amber)' : 'var(--color-ink4)'` (peso 600 quando destacado). Mantenha a classe `col-span-2 lg:col-span-1`.
   - Meta: `{meta.temMeta && (…)}` com `width: \`${meta.percentual}%\``, cor por `meta.atingida`, valor `<Secret>{fmt(bruto)} / {fmt(Number(empresa.meta_mensal))}</Secret>` e texto `<Secret>{rotuloProgressoMeta(meta, fmt)}</Secret>`.
   - Reconquistar: `c.diasSemVisita` no lugar de `differenceInDays(...)`.
   - Aniversariantes: `label = c.rotulo`, `dateStr = \`${c.dataAniversario.slice(8, 10)}/${c.dataAniversario.slice(5, 7)}\``, `isToday = c.diasAte === 0`.
   - Agenda de hoje: `const horario = horaBRT(a.data_hora_inicio);` (o servidor roda em UTC: a hora saía 3h adiantada).
   - Despesa: `Vence {d.data_vencimento.slice(8, 10)}/{d.data_vencimento.slice(5, 7)}`.
   - Alerta de comissões: `href="/comissoes"` (era `/equipe`; o app já vai para Comissões).
   - Novo alerta, antes do de comissões:
```tsx
            {comandas.quantidade > 0 && comandas.maisAntiga && (
              <Link href="/comanda"
                className="flex items-start gap-3 p-3 rounded-xl transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-rose-soft)', border: '1px solid rgba(201,82,127,0.13)' }}>
                <Receipt size={13} style={{ color: 'var(--color-rose)', flexShrink: 0, marginTop: 1 }} strokeWidth={2} />
                <div className="min-w-0">
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-rose)' }}>
                    {comandas.quantidade} {comandas.quantidade === 1 ? 'comanda não fechada' : 'comandas não fechadas'}
                  </p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 1 }}>
                    Mais antiga: {rotuloDataHoraBRT(comandas.maisAntiga.data_hora_inicio)}
                  </p>
                </div>
              </Link>
            )}
```
   (importe `rotuloDataHoraBRT`; `Receipt` já está importado).
- [ ] **Step 4: `Sidebar.tsx`** — imports `import { hojeBRT } from '@shared/periodos';` e `import { aplicarFiltroComandasNaoFechadas, aplicarFiltroDespesasVencendo } from '@shared/dashboard-consultas';`. No efeito, apague `hoje`/`daqui7` e use:
```ts
        aplicarFiltroDespesasVencendo(
          supabase.from('despesas').select('id', { count: 'exact', head: true }), empresaId, hojeBRT()),
        supabase.from('comissoes').select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresaId).eq('status', 'pendente'),
        // Atendimentos já ocorridos sem comanda (regra única do Dashboard).
        aplicarFiltroComandasNaoFechadas(
          supabase.from('agendamentos').select('id', { count: 'exact', head: true }), empresaId, new Date().toISOString()),
```
- [ ] **Step 5: `SparkBars.tsx`** — `import { geometriaSparkline } from '@shared/dashboard';` e substitua o cálculo (de `const padL` até `const showDot`) por:
```ts
  const { linha: pathD, area: areaD, ultimo: last, vazio } = geometriaSparkline(data, width, height, progress);
  const showDot = progress > 0.05 && !vazio;
```
- [ ] **Step 6: Ajustar a 2A** (`paridade-fase2a-web-dashboard.test.ts`): troque `expect(src).toContain('variacaoPercentual(lucro, kpisAnt.lucro)');` por `expect(src).toContain('cartoesKpiDashboard(kpis, kpisAnt');` e `expect(src).toContain("label: 'Líquido após taxas'");` por `expect(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'dashboard.ts'), 'utf8')).toContain("rotulo: 'Líquido após taxas'");` (mantenha a asserção de que `Fat. Líquido` não existe).
- [ ] **Step 7: Verificação da task.**
- [ ] **Step 8: Commit** — `feat(web): Dashboard com alerta de comandas nao fechadas e regras unicas (reconquista paginada, horas em Brasilia)`.

---

### Task 12: Mobile — Dashboard completo

**Files:** Modify `mobile/hooks/useDashboard.ts`, `mobile/app/(empresa)/dashboard.tsx`, `shared/invalidacao-financeira.ts`, `web/tests/unit/paridade-fase2a-revisao-final.test.ts` · Create `mobile/components/SparkLinha.tsx` · Test `web/tests/unit/paridade-fase2b-mobile-dashboard.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-mobile-dashboard.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAVES_FINANCEIRO } from '@shared/invalidacao-financeira';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useDashboard.ts');
const tela = ler('mobile/app/(empresa)/dashboard.tsx');
const spark = ler('mobile/components/SparkLinha.tsx');

describe('app Dashboard = web Dashboard', () => {
  it('hook com as mesmas consultas e regras', () => {
    for (const t of ['navegacaoMesDashboard(', 'carregarUltimasVisitas(', 'clientesParaReconquistar(', 'carregarAniversariantes(',
      'aniversariantesProximos(', 'carregarDespesasVencendo(', 'carregarComandasNaoFechadas(', 'resumoComandasNaoFechadas(',
      'progressoMetaEmpresa(', 'receitaAcumuladaPorDia(', 'carregarRetiradas(', "'despesas-vencendo'", "from('empresas')",
      'if (error) throw error']) expect(hook).toContain(t);
    expect(hook).not.toContain('.limit(500)');
  });
  it('tela: navegação de mês, KPIs, meta, reconquista, aniversariantes, despesas e sparkline', () => {
    for (const t of ['setMesSolicitado', 'rotuloMesAno(', 'cartoesKpiDashboard(', 'rotuloProgressoMeta(', 'Reconquistar',
      'Aniversariantes', 'despesasVencendo', '<SparkLinha', 'horaBRT(', "hojePronto ? formatBRL(receitaHoje) : '—'",
      'Mês com fechamento importado']) expect(tela).toContain(t);
  });
  it('sparkline com a geometria única; despesas vencendo invalidadas ao mexer em dinheiro', () => {
    expect(spark).toContain('geometriaSparkline(');
    expect(CHAVES_FINANCEIRO).toContain('despesas-vencendo');
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: `shared/invalidacao-financeira.ts`** — acrescente `'despesas-vencendo',` à lista.
- [ ] **Step 4: Reescrever `useDashboard.ts`** (mantendo `useResumoComissoesPendentes` da Task 5, depois de `useDashboard`):
```ts
/**
 * @file useDashboard.ts
 * Dashboard do app — mesmas regras e fontes do Dashboard web (@shared/dashboard,
 * @shared/kpis-financeiros, @shared/dashboard-consultas). Mês navegável (nunca o
 * futuro); "hoje" sempre em Brasília; "Agenda hoje" não conta cancelados.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { Agendamento, Produto } from '@/types';
import { hojeBRT, limitesDias, limitesMes, uniaoLimites } from '@shared/periodos';
import {
  calcularKpisFinanceiros, variacaoPercentual, resumoComissoesPendentes, receitaAcumuladaPorDia,
  retiradasDoPeriodo, DADOS_VAZIOS,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarComissoesPendentes, carregarRetiradas } from '@shared/kpis-financeiros-consultas';
import { somaDevolucoesPorRetirada, saldoDevedorTotal } from '@shared/retiradas-socia';
import {
  navegacaoMesDashboard, clientesParaReconquistar, aniversariantesProximos, resumoComandasNaoFechadas, progressoMetaEmpresa,
} from '@shared/dashboard';
import {
  carregarComandasNaoFechadas, carregarDespesasVencendo, carregarUltimasVisitas, carregarAniversariantes,
} from '@shared/dashboard-consultas';

export function useDashboard(mesSolicitado: string | null = null) {
  const { empresaAtiva, isOwner } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const hoje    = hojeBRT();
  const nav     = navegacaoMesDashboard(mesSolicitado, hoje);
  const limHoje = limitesDias(hoje, hoje);
  const limMes  = limitesMes(nav.chave);
  const limAnt  = limitesMes(nav.anterior);

  // Agendamentos de hoje com joins ("Agenda hoje" não conta cancelados — decisão do dono)
  const agendamentosHoje = useQuery({ /* MANTENHA a query atual inteira (from('agendamentos') … .neq('status', 'cancelado')) */ });

  // Mês exibido + anterior (delta) numa busca só.
  const financeiro = useQuery({
    queryKey: ['dash-financeiro', empresaId, nav.chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60,
    queryFn: () => carregarDadosFinanceiros(supabase, empresaId!, uniaoLimites(limAnt, limMes)),
  });
  // "Receita hoje" quando o mês exibido não é o atual (mesma regra do web).
  const financeiroHoje = useQuery({
    queryKey: ['dash-financeiro', empresaId, 'hoje', hoje],
    enabled: !!empresaId && !nav.isMesAtual,
    staleTime: 1000 * 60,
    queryFn: () => carregarDadosFinanceiros(supabase, empresaId!, limHoje),
  });
  const comissoesPendentes = useResumoComissoesPendentes();
  const estoqueBaixo = useQuery({ /* MANTENHA a query atual */ });
  const comandasNaoFechadas = useQuery({
    queryKey: ['comandas-nao-fechadas', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60,
    queryFn: async () => resumoComandasNaoFechadas(await carregarComandasNaoFechadas(supabase, empresaId!, new Date().toISOString())),
  });
  const despesasVencendo = useQuery({
    queryKey: ['despesas-vencendo', empresaId, hoje],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarDespesasVencendo(supabase, empresaId!, hoje),
  });
  const reconquista = useQuery({
    queryKey: ['dash-reconquista', empresaId, hoje],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => clientesParaReconquistar(await carregarUltimasVisitas(supabase, empresaId!), hoje),
  });
  const aniversariantes = useQuery({
    queryKey: ['dash-aniversariantes', empresaId, hoje],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => aniversariantesProximos(await carregarAniversariantes(supabase, empresaId!), hoje),
  });
  // Meta lida do banco (o web lê a empresa a cada carga; o store do app pode estar velho).
  const meta = useQuery({
    queryKey: ['dash-meta', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase.from('empresas').select('meta_mensal').eq('id', empresaId!).single();
      if (error) throw error;
      return Number((data as { meta_mensal: number | string | null } | null)?.meta_mensal ?? 0);
    },
  });
  // Retiradas da dona (owner-only) — mesma chave/consulta do Financeiro.
  const retiradas = useQuery({
    queryKey: ['fin-retiradas', empresaId],
    enabled: !!empresaId && isOwner,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarRetiradas(supabase, empresaId!),
  });

  const dados    = financeiro.data ?? DADOS_VAZIOS;
  const kpisMes  = calcularKpisFinanceiros(dados, limMes);
  const kpisAnt  = calcularKpisFinanceiros(dados, limAnt);
  const kpisHoje = calcularKpisFinanceiros(nav.isMesAtual ? dados : (financeiroHoje.data ?? DADOS_VAZIOS), limHoje);
  const rowsRet  = retiradas.data?.rows ?? [];
  const devsRet  = retiradas.data?.devs ?? [];

  const consultas = [agendamentosHoje, financeiro, financeiroHoje, comissoesPendentes, estoqueBaixo,
    comandasNaoFechadas, despesasVencendo, reconquista, aniversariantes, meta, retiradas];

  return {
    nav,
    agendamentosHoje: agendamentosHoje.data ?? [],
    kpisMes,
    kpisAnt,
    receitaHoje: kpisHoje.bruto,
    receitaMes: kpisMes.bruto,
    variacaoReceitaMes: financeiro.data ? variacaoPercentual(kpisMes.bruto, kpisAnt.bruto) : null,
    sparkline: financeiro.data ? receitaAcumuladaPorDia(dados, limMes, nav.isMesAtual ? hoje : limMes.endDate) : [],
    meta: progressoMetaEmpresa(kpisMes.bruto, meta.data ?? 0),
    metaValor: meta.data ?? 0,
    metaPronta: meta.isSuccess && financeiro.isSuccess,
    isOwner,
    retiradasMes: retiradasDoPeriodo(rowsRet, devsRet, limMes),
    emprestimosAbertos: saldoDevedorTotal(rowsRet, somaDevolucoesPorRetirada(devsRet)),
    comissoesPendentes: comissoesPendentes.data ?? { quantidade: 0, total: 0 },
    estoqueBaixo: estoqueBaixo.data ?? [],
    comandasNaoFechadas: comandasNaoFechadas.data ?? { quantidade: 0, maisAntiga: null },
    despesasVencendo: despesasVencendo.data ?? [],
    reconquista: reconquista.data ?? [],
    aniversariantes: aniversariantes.data ?? [],
    // Só vale número com a consulta certa: carregando ou com erro a tela mostra '—'.
    financeiroPronto: financeiro.isSuccess,
    hojePronto: nav.isMesAtual ? financeiro.isSuccess : financeiroHoje.isSuccess,
    comissoesPendentesPronto: comissoesPendentes.isSuccess,
    isLoading: agendamentosHoje.isLoading || financeiro.isLoading,
    isError: consultas.some(q => q.isError),
    erro: (consultas.find(q => q.isError)?.error ?? null) as Error | null,
    refetch: () => { for (const q of consultas) q.refetch(); },
  };
}
```
   (Os dois `/* MANTENHA ... */` são as queries atuais copiadas sem mudança — **não** deixe o comentário no código.) `comissoesPendentes`/`estoqueBaixo`/`Agendamento`/`Produto` continuam tipados como hoje; `carregarComissoesPendentes`/`resumoComissoesPendentes` ficam importados para `useResumoComissoesPendentes`.
- [ ] **Step 5: Criar `mobile/components/SparkLinha.tsx`**
```tsx
/**
 * @file SparkLinha.tsx
 * Sparkline da receita acumulada do mês (card hero do Dashboard) — mesma
 * geometria do SparkBars web (@shared/dashboard › geometriaSparkline).
 */
import { useEffect, useState } from 'react';
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { geometriaSparkline } from '@shared/dashboard';

export function SparkLinha({ dados, largura = 200, altura = 80 }: { dados: number[]; largura?: number; altura?: number }) {
  const [progresso, setProgresso] = useState(0);
  useEffect(() => {
    let raf = 0;
    const inicio = Date.now();
    const passo = () => {
      const t = Math.min((Date.now() - inicio) / 1400, 1);
      setProgresso(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [dados.length]);

  const g = geometriaSparkline(dados, largura, altura, progresso);
  return (
    <Svg width={largura} height={altura}>
      <Defs>
        <LinearGradient id="sparkPreench" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="rgb(180,160,240)" stopOpacity={0.22} />
          <Stop offset="1" stopColor="rgb(180,160,240)" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="sparkTraco" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="rgb(210,190,255)" stopOpacity={0} />
          <Stop offset="0.55" stopColor="rgb(210,190,255)" stopOpacity={0} />
          <Stop offset="1" stopColor="rgb(210,190,255)" stopOpacity={0.55} />
        </LinearGradient>
      </Defs>
      <Path d={g.area} fill="url(#sparkPreench)" />
      <Path d={g.linha} fill="none" stroke="url(#sparkTraco)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {progresso > 0.05 && !g.vazio && (
        <>
          <Circle cx={g.ultimo.x} cy={g.ultimo.y} r={6} fill="rgba(180,160,240,0.25)" />
          <Circle cx={g.ultimo.x} cy={g.ultimo.y} r={3.5} fill="#fff" />
        </>
      )}
    </Svg>
  );
}
```
- [ ] **Step 6: `dashboard.tsx`.**
   - Imports: `useState`; `ChevronLeft, UserMinus, Cake, Target, Wallet, XCircle` do lucide; `SparkLinha`; `rotuloMesAno, horaBRT, rotuloDataHoraBRT` de `@shared/periodos`; `cartoesKpiDashboard, rotuloProgressoMeta` de `@shared/dashboard`.
   - `const [mesSolicitado, setMesSolicitado] = useState<string | null>(null);` e `useDashboard(mesSolicitado)` desestruturando também `nav, kpisMes, kpisAnt, sparkline, meta, metaValor, metaPronta, retiradasMes, emprestimosAbertos, despesasVencendo, reconquista, aniversariantes, hojePronto` e o `isOwner` do hook (troque o do store).
   - Depois do `if (!fontsLoaded)`: `const cartoesMes = cartoesKpiDashboard(kpisMes, kpisAnt, { isOwner, retiradasMes, emprestimosAbertos, fmt: formatBRL });` e troque `formatBRL` para o formato do web (`minimumFractionDigits: 0`, sem `maximumFractionDigits`).
   - Antes do hero (dentro de `podeVerFinanceiro`), a navegação:
```tsx
        {podeVerFinanceiro && (
          <View style={{ marginHorizontal: 24, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity onPress={() => setMesSolicitado(nav.anterior)} accessibilityLabel="Mês anterior" style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={14} color={C.text3} strokeWidth={2.4} />
            </TouchableOpacity>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2 }}>
              {rotuloMesAno(nav.chave)}
            </Text>
            {nav.seguinte ? (
              <TouchableOpacity onPress={() => setMesSolicitado(nav.seguinte)} accessibilityLabel="Próximo mês" style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
                <ChevronRight size={14} color={C.text3} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : <View style={{ width: 26 }} />}
            {!nav.isMesAtual && (
              <TouchableOpacity onPress={() => setMesSolicitado(null)} style={{ backgroundColor: C.primarySoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.accent }}>Hoje</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
```
   - Hero: rótulo `Receita do Mês · {rotuloMesAno(nav.chave)}`; ao lado do delta, `<Text …>Lucro <SecretText>{financeiroPronto ? formatBRL(kpisMes.lucro) : '—'}</SecretText></Text>`; dentro do `LinearGradient`, `<View pointerEvents="none" style={{ position: 'absolute', right: 16, bottom: 10 }}><SparkLinha dados={sparkline} /></View>` e, quando `kpisMes.mesesComFechamento.length > 0`, o texto "Mês com fechamento importado — o gráfico diário mostra só os lançamentos ao vivo." (mesma frase do web).
   - Logo após o banner de erro, a grade de KPIs do mês:
```tsx
        {podeVerFinanceiro && financeiroPronto && (
          <View style={{ marginHorizontal: 24, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {cartoesMes.map(c => {
              const cor = c.tom === 'negativo' ? C.rose : c.tom === 'alerta' ? C.amber : C.primary;
              return (
                <View key={c.id} style={{ width: '48%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{c.rotulo}</Text>
                  <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: cor }}>{c.valor}</SecretText>
                  {c.delta !== null && (
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: c.delta >= 0 ? C.green : C.rose, marginTop: 4 }}>
                      {c.delta >= 0 ? '▲' : '▼'} {Math.abs(c.delta)}%
                    </Text>
                  )}
                  {c.sub && (
                    <SecretText style={{ fontFamily: c.subDestaque ? 'PlusJakartaSans_600SemiBold' : 'PlusJakartaSans_400Regular', fontSize: 10, color: c.subDestaque ? C.amber : C.text4, marginTop: 4 }}>{c.sub}</SecretText>
                  )}
                </View>
              );
            })}
          </View>
        )}
```
   - Meta (depois dos mini KPIs): `{podeVerFinanceiro && metaPronta && meta.temMeta && (…)}` com cabeçalho "META DO MÊS", `<SecretText>{formatBRL(kpisMes.bruto)} / {formatBRL(metaValor)}</SecretText>`, barra (`width: \`${meta.percentual}%\``, verde se `meta.atingida`) e `<SecretText>{rotuloProgressoMeta(meta, formatBRL)}</SecretText>`.
   - Mini card "Receita Hoje": `{hojePronto ? formatBRL(receitaHoje) : '—'}`.
   - Agenda de hoje: `const hora = horaBRT(ag.data_hora_inicio);`.
   - Depois das ações rápidas, se `podeVerFinanceiro`: seção **Reconquistar** (`reconquista.map(c => TouchableOpacity → router.push(\`/(empresa)/cliente/${c.clienteId}\`))`, ícone `UserMinus`, "Sem visita há {c.diasSemVisita} dias", badge com a quantidade) e **Aniversariantes** (`aniversariantes.map(c => … \`${c.dataAniversario.slice(8, 10)}/${c.dataAniversario.slice(5, 7)} · ${c.rotulo}\` → cliente/${c.id})`, ícone `Cake`), cada uma só quando a lista não está vazia — mesmo visual dos cards de alerta.
   - Alertas: condição passa a incluir `(podeVerFinanceiro && despesasVencendo.length > 0)` e usa `comandasNaoFechadas.quantidade > 0`. Novo bloco por despesa (`router.push('/(empresa)/financeiro')`, fundo `C.roseSoft`): título `d.descricao`, texto `Vence {d.data_vencimento.slice(8, 10)}/{d.data_vencimento.slice(5, 7)} · <SecretText>{formatBRL(Number(d.valor))}</SecretText>`. No bloco de comandas: `comandasNaoFechadas.quantidade` no texto, `comandasNaoFechadas.maisAntiga` no `router.push` e "Mais antiga: {rotuloDataHoraBRT(comandasNaoFechadas.maisAntiga.data_hora_inicio)}" (guardar com `comandasNaoFechadas.maisAntiga &&`). Mantenha a frase "comandas não fechadas".
- [ ] **Step 7: Ajustar a 2A** (`paridade-fase2a-revisao-final.test.ts`, "dashboard mostra — fora do sucesso"): troque `"financeiroPronto ? formatBRL(receitaHoje) : '—'"` por `"hojePronto ? formatBRL(receitaHoje) : '—'"`.
- [ ] **Step 8: Verificação da task** (mobile).
- [ ] **Step 9: Commit** — `feat(mobile): Dashboard com navegacao de mes, KPIs, meta, reconquista, aniversariantes, despesas vencendo e sparkline`.

---

### Task 13: `shared/relatorios.ts` + `shared/relatorios-consultas.ts`

**Files:** Create `shared/relatorios.ts`, `shared/relatorios-consultas.ts`, `web/tests/unit/shared-relatorios.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/shared-relatorios.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import { calcularKpisFinanceiros, recortarDados } from '@shared/kpis-financeiros';
import {
  ABAS_RELATORIO, rankingDespesasPorCategoria, comissaoPorProfissional, resumoInsumos, resumoAvaliacoes,
  cartoesKpiRelatorio, linhasResumoFinanceiro, type AvaliacaoRow,
} from '@shared/relatorios';
import { carregarSaidasEstoque, carregarAvaliacoes, COLUNAS_AVALIACAO } from '@shared/relatorios-consultas';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';
import { fakeDb, opsDe } from './fixtures/fake-db';

const SET = limitesMes('2026-09');
const fx = fixtureSetembro();
const k = calcularKpisFinanceiros(fx, SET);
const kAnt = calcularKpisFinanceiros(fx, limitesMes('2026-08'));
const fmt = (v: number) => `R$${v}`;

describe('abas e rankings', () => {
  it('mesma lista de abas', () => {
    expect(ABAS_RELATORIO.map(a => a.key)).toEqual(['financeiro', 'servicos', 'equipe', 'clientes', 'estoque', 'comissoes', 'avaliacoes']);
  });
  it('despesas por categoria (pagas do período)', () => {
    const r = rankingDespesasPorCategoria(recortarDados(fx, SET).despesas);
    expect(r.map(x => [x.nome, x.valor, x.qtd])).toEqual([['Aluguel', 250, 1], ['Energia', 45.5, 1]]);
    expect(r[1].pct).toBeCloseTo(18.2);
    expect(rankingDespesasPorCategoria([{ valor: '10', categoria: null }])[0].nome).toBe('Outros');
  });
  it('comissão por profissional = soma das comissões do período', () => {
    expect(comissaoPorProfissional(recortarDados(fx, SET).comissoes)).toEqual({ p1: 80, p2: 60 });
  });
  it('insumos: top por quantidade, custo total de todos', () => {
    const movs = [
      { produto_id: 'x', quantidade: '2', produto: { nome: 'Ácido', preco_custo: '10.50' } },
      { produto_id: 'x', quantidade: 1, produto: { nome: 'Ácido', preco_custo: 10.5 } },
      { produto_id: 'y', quantidade: 5, produto: null },
    ];
    const r = resumoInsumos(movs, 3, 1);
    expect(r.ranking).toEqual([{ produtoId: 'y', nome: 'Produto', qtd: 5, custo: 0, pct: 100 }]);
    expect(r.custoTotal).toBe(31.5);
    expect(r.custoMedioPorAtendimento).toBe(10.5);
    expect(resumoInsumos(movs, 0).custoMedioPorAtendimento).toBeNull();
  });
  it('avaliações', () => {
    const avs: AvaliacaoRow[] = [
      { nota: 5, comentario: null, created_at: 'x', profissional_id: 'm1', profissional: { user: { nome: 'Ana' } }, cliente: { nome: 'C' } },
      { nota: 4, comentario: 'ok', created_at: 'x', profissional_id: 'm1', profissional: { user: { nome: 'Ana' } }, cliente: null },
      { nota: 4, comentario: null, created_at: 'x', profissional_id: null, profissional: null, cliente: null },
    ];
    const r = resumoAvaliacoes(avs);
    expect(r.notaMedia).toBeCloseTo(4.333, 2);
    expect([r.total, r.comNota5, r.pctNota5]).toEqual([3, 1, 33]);
    expect(r.ranking).toEqual([{ nome: 'Ana', media: 4.5, qtd: 2 }, { nome: 'Sem profissional', media: 4, qtd: 1 }]);
    expect(resumoAvaliacoes([])).toEqual({ notaMedia: null, total: 0, comNota5: 0, pctNota5: null, ranking: [] });
  });
});

describe('cartões e resumo financeiro (mesma lista web e app)', () => {
  it('cartões', () => {
    const c = cartoesKpiRelatorio(k, kAnt, { periodo: 'mes', isOwner: false, retiradasPeriodo: 0, fmt });
    expect(c.map(x => x.id)).toEqual(['bruto', 'cartao', 'liquido', 'lucro', 'atendimentos', 'ticket', 'comparecimento', 'cancelamento', 'taxas', 'comissoes']);
    expect(c[0]).toMatchObject({ valor: 'R$560', sub: 'inc. R$130 em vendas', delta: 2140, rotuloDelta: 'vs mês anterior' });
    expect(c.find(x => x.id === 'atendimentos')).toMatchObject({ valor: '3', delta: null });
    expect(c.find(x => x.id === 'cancelamento')).toMatchObject({ valor: '33.3%', sub: '2 perdido(s)', negativo: true });
    expect(c.find(x => x.id === 'comissoes')?.sub).toBe('R$80 pendentes');
    const dona = cartoesKpiRelatorio(k, kAnt, { periodo: 'mes', isOwner: true, retiradasPeriodo: 17, fmt });
    expect(dona.map(x => x.id).slice(3, 5)).toEqual(['lucro', 'aposRetiradas']);
    expect(dona[4]).toMatchObject({ valor: 'R$100', sub: '(−) R$17 da dona' });
  });
  it('resumo financeiro', () => {
    expect(linhasResumoFinanceiro(k, { isOwner: false, retiradasPeriodo: 0 }).map(l => [l.id, l.valor])).toEqual([
      ['servicos', 350], ['vendas', 130], ['taxas', 80], ['bruto', 560], ['cartao', 7.5], ['comissoes', 140], ['despesas', 295.5], ['lucro', 117],
    ]);
    expect(linhasResumoFinanceiro(k, { isOwner: true, retiradasPeriodo: 17 }).slice(-2).map(l => [l.id, l.valor]))
      .toEqual([['retiradas', 17], ['aposRetiradas', 100]]);
  });
});

describe('consultas das abas sob demanda', () => {
  it('estoque: saídas do período, paginado', async () => {
    const { db, chamadas } = fakeDb();
    await carregarSaidasEstoque(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'estoque_movimentos');
    expect(ops).toContainEqual(['eq', ['tipo', 'saida']]);
    expect(ops).toContainEqual(['gte', ['created_at', SET.startIso]]);
    expect(ops).toContainEqual(['order', ['id']]);
  });
  it('avaliações: nome da profissional pelo membro → users (empresa_membros não tem nome)', async () => {
    expect(COLUNAS_AVALIACAO).toContain('empresa_membros!avaliacoes_profissional_id_fkey(user:users!empresa_membros_user_id_fkey(nome))');
    const { db, chamadas } = fakeDb();
    await carregarAvaliacoes(db, 'emp', SET);
    expect(opsDe(chamadas, 'avaliacoes')[0]).toContainEqual(['order', ['created_at', { ascending: false }]]);
    await expect(carregarAvaliacoes(fakeDb({ erroEm: 'avaliacoes' }).db, 'emp', SET)).rejects.toThrow();
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: `shared/relatorios.ts`**
```ts
/**
 * @file relatorios.ts
 * Regras ÚNICAS das abas dos Relatórios (web e mobile). Os números vêm de
 * calcularKpisFinanceiros; aqui ficam as listas que as duas telas desenham
 * (cartões, resumo financeiro) e os rankings das abas.
 */
import { arredondar, num, variacaoPercentual, type KpisFinanceiros, type Valor } from './kpis-financeiros';
import { ROTULO_COMPARACAO, type PeriodoRelatorio } from './periodos';

export type AbaRelatorio = 'financeiro' | 'servicos' | 'equipe' | 'clientes' | 'estoque' | 'comissoes' | 'avaliacoes';

export const ABAS_RELATORIO: { key: AbaRelatorio; label: string }[] = [
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'servicos', label: 'Serviços' },
  { key: 'equipe', label: 'Equipe' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'estoque', label: 'Estoque' },
  { key: 'comissoes', label: 'Comissões' },
  { key: 'avaliacoes', label: 'Avaliações' },
];

export type ItemRankingSimples = { nome: string; valor: number; qtd: number; pct: number };

/** Despesas PAGAS do período por categoria (sem categoria = 'Outros'); pct relativo à maior. */
export function rankingDespesasPorCategoria(despesas: { valor: Valor; categoria: string | null }[]): ItemRankingSimples[] {
  const mapa = new Map<string, { valor: number; qtd: number }>();
  for (const d of despesas) {
    const chave = d.categoria || 'Outros';
    const item = mapa.get(chave) ?? { valor: 0, qtd: 0 };
    item.valor += num(d.valor);
    item.qtd += 1;
    mapa.set(chave, item);
  }
  const lista = [...mapa.entries()]
    .map(([nome, v]) => ({ nome, valor: arredondar(v.valor), qtd: v.qtd, pct: 0 }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'));
  const max = lista[0]?.valor ?? 0;
  return lista.map(i => ({ ...i, pct: max > 0 ? (i.valor / max) * 100 : 0 }));
}

/** Comissão gerada por profissional (linhas já recortadas ao período). */
export function comissaoPorProfissional(comissoes: { profissional_id: string; valor_comissao: Valor }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of comissoes) out[c.profissional_id] = (out[c.profissional_id] ?? 0) + num(c.valor_comissao);
  for (const k of Object.keys(out)) out[k] = arredondar(out[k]);
  return out;
}

export type MovEstoqueRow = { produto_id: string; quantidade: Valor; produto: { nome: string | null; preco_custo: Valor } | null };
export type ItemInsumo = { produtoId: string; nome: string; qtd: number; custo: number; pct: number };
export type ResumoInsumos = { ranking: ItemInsumo[]; custoTotal: number; custoMedioPorAtendimento: number | null };

/** Insumos consumidos: ranking por quantidade (top `limite`); custo total sobre TODAS as saídas. */
export function resumoInsumos(movs: MovEstoqueRow[], atendimentos: number, limite = 10): ResumoInsumos {
  const mapa = new Map<string, { nome: string; qtd: number; custo: number }>();
  for (const m of movs) {
    const item = mapa.get(m.produto_id) ?? { nome: m.produto?.nome || 'Produto', qtd: 0, custo: 0 };
    const qtd = num(m.quantidade);
    item.qtd += qtd;
    item.custo += qtd * num(m.produto?.preco_custo);
    mapa.set(m.produto_id, item);
  }
  const todos = [...mapa.entries()].map(([produtoId, v]) => ({ produtoId, ...v }))
    .sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt-BR'));
  const top = todos.slice(0, limite);
  const maxQ = top[0]?.qtd ?? 0;
  const custoTotal = arredondar(todos.reduce((s, i) => s + i.custo, 0));
  return {
    ranking: top.map(i => ({ ...i, custo: arredondar(i.custo), pct: maxQ > 0 ? (i.qtd / maxQ) * 100 : 0 })),
    custoTotal,
    custoMedioPorAtendimento: atendimentos > 0 ? arredondar(custoTotal / atendimentos) : null,
  };
}

export type AvaliacaoRow = {
  nota: number;
  comentario: string | null;
  created_at: string;
  profissional_id: string | null;
  profissional: { user: { nome: string | null } | null } | null;
  cliente: { nome: string | null } | null;
};
export type ResumoAvaliacoes = {
  notaMedia: number | null; total: number; comNota5: number; pctNota5: number | null;
  ranking: { nome: string; media: number; qtd: number }[];
};

export function resumoAvaliacoes(avs: AvaliacaoRow[]): ResumoAvaliacoes {
  if (avs.length === 0) return { notaMedia: null, total: 0, comNota5: 0, pctNota5: null, ranking: [] };
  const mapa = new Map<string, { nome: string; soma: number; qtd: number }>();
  for (const a of avs) {
    const chave = a.profissional_id ?? '__sem__';
    const item = mapa.get(chave) ?? { nome: a.profissional?.user?.nome || 'Sem profissional', soma: 0, qtd: 0 };
    item.soma += a.nota;
    item.qtd += 1;
    mapa.set(chave, item);
  }
  const comNota5 = avs.filter(a => a.nota === 5).length;
  return {
    notaMedia: avs.reduce((s, a) => s + a.nota, 0) / avs.length,
    total: avs.length,
    comNota5,
    pctNota5: Math.round((comNota5 / avs.length) * 100),
    ranking: [...mapa.values()].map(v => ({ nome: v.nome, media: v.soma / v.qtd, qtd: v.qtd }))
      .sort((a, b) => b.media - a.media || b.qtd - a.qtd),
  };
}

export type CartaoKpiRelatorio = {
  id: 'bruto' | 'cartao' | 'liquido' | 'lucro' | 'aposRetiradas' | 'atendimentos' | 'ticket'
    | 'comparecimento' | 'cancelamento' | 'taxas' | 'comissoes';
  rotulo: string;
  valor: string;
  sub: string | null;
  delta: number | null;
  rotuloDelta: string | null;
  /** Valor "ruim" (vermelho): saídas e resultados negativos. */
  negativo: boolean;
};

/** Grade de KPIs dos Relatórios — a MESMA lista no web e no app. */
export function cartoesKpiRelatorio(
  k: KpisFinanceiros, kAnt: KpisFinanceiros,
  o: { periodo: PeriodoRelatorio; isOwner: boolean; retiradasPeriodo: number; fmt: (v: number) => string },
): CartaoKpiRelatorio[] {
  const { fmt } = o;
  const rd = ROTULO_COMPARACAO[o.periodo];
  const base = { sub: null, delta: null, rotuloDelta: null, negativo: false };
  const lista: CartaoKpiRelatorio[] = [{
    ...base, id: 'bruto', rotulo: 'Faturamento bruto', valor: fmt(k.bruto),
    sub: k.receitaVendas > 0 ? `inc. ${fmt(k.receitaVendas)} em vendas` : null,
    delta: variacaoPercentual(k.bruto, kAnt.bruto), rotuloDelta: rd,
  }];
  if (k.taxasCartao > 0) lista.push({ ...base, id: 'cartao', rotulo: 'Taxas de cartão', valor: fmt(k.taxasCartao), negativo: true });
  lista.push({ ...base, id: 'liquido', rotulo: 'Líquido após taxas', valor: fmt(k.liquidoAposTaxas) });
  lista.push({ ...base, id: 'lucro', rotulo: 'Lucro real', valor: fmt(k.lucro), negativo: k.lucro < 0 });
  if (o.isOwner && o.retiradasPeriodo > 0) {
    const apos = arredondar(k.lucro - o.retiradasPeriodo);
    lista.push({ ...base, id: 'aposRetiradas', rotulo: 'Resultado após retiradas', valor: fmt(apos),
      sub: `(−) ${fmt(o.retiradasPeriodo)} da dona`, negativo: apos < 0 });
  }
  lista.push({ ...base, id: 'atendimentos', rotulo: 'Atendimentos', valor: String(k.atendimentos), sub: 'concluídos',
    delta: variacaoPercentual(k.atendimentos, kAnt.atendimentos), rotuloDelta: rd });
  lista.push({ ...base, id: 'ticket', rotulo: 'Ticket médio', valor: fmt(k.ticketMedio),
    delta: variacaoPercentual(k.ticketMedio, kAnt.ticketMedio), rotuloDelta: rd });
  lista.push({ ...base, id: 'comparecimento', rotulo: 'Taxa comparecimento', valor: `${k.pctComparecimento.toFixed(1)}%` });
  lista.push({ ...base, id: 'cancelamento', rotulo: 'Taxa de cancelamento',
    valor: k.totalAgendamentos > 0 ? `${k.pctCancelamento.toFixed(1)}%` : '—',
    sub: k.perdidos > 0 ? `${k.perdidos} perdido(s)` : null, negativo: true });
  const taxas = arredondar(k.receitaTaxasCancelamento + k.receitaTaxasReserva);
  if (taxas > 0) lista.push({ ...base, id: 'taxas', rotulo: 'Taxas (cancel. + reserva)', valor: fmt(taxas) });
  lista.push({ ...base, id: 'comissoes', rotulo: 'Total comissões', valor: fmt(k.comissoes),
    sub: k.comissoesPendentes > 0 ? `${fmt(k.comissoesPendentes)} pendentes` : 'Em dia' });
  return lista;
}

export type LinhaResumoFinanceiro = {
  id: 'servicos' | 'vendas' | 'taxas' | 'bruto' | 'cartao' | 'comissoes' | 'despesas' | 'lucro' | 'retiradas' | 'aposRetiradas';
  rotulo: string;
  valor: number;
  tipo: 'entrada' | 'total' | 'saida' | 'resultado';
};

/** Linhas do bloco "Resumo financeiro" (aba Financeiro) — mesma ordem e textos. */
export function linhasResumoFinanceiro(
  k: KpisFinanceiros, o: { isOwner: boolean; retiradasPeriodo: number },
): LinhaResumoFinanceiro[] {
  const l: LinhaResumoFinanceiro[] = [{ id: 'servicos', rotulo: 'Serviços concluídos', valor: k.receitaServicos, tipo: 'entrada' }];
  if (k.receitaVendas > 0) l.push({ id: 'vendas', rotulo: 'Vendas avulsas', valor: k.receitaVendas, tipo: 'entrada' });
  const taxas = arredondar(k.receitaTaxasCancelamento + k.receitaTaxasReserva);
  if (taxas > 0) l.push({ id: 'taxas', rotulo: 'Taxas (cancel. + reserva)', valor: taxas, tipo: 'entrada' });
  l.push(
    { id: 'bruto', rotulo: '= Faturamento bruto', valor: k.bruto, tipo: 'total' },
    { id: 'cartao', rotulo: '(−) Taxas de cartão', valor: k.taxasCartao, tipo: 'saida' },
    { id: 'comissoes', rotulo: '(−) Comissões', valor: k.comissoes, tipo: 'saida' },
    { id: 'despesas', rotulo: '(−) Despesas', valor: k.despesas, tipo: 'saida' },
    { id: 'lucro', rotulo: 'Lucro real', valor: k.lucro, tipo: 'resultado' },
  );
  if (o.isOwner && o.retiradasPeriodo > 0) {
    l.push(
      { id: 'retiradas', rotulo: '(−) Retiradas da dona', valor: o.retiradasPeriodo, tipo: 'saida' },
      { id: 'aposRetiradas', rotulo: 'Resultado após retiradas', valor: arredondar(k.lucro - o.retiradasPeriodo), tipo: 'resultado' },
    );
  }
  return l;
}
```
- [ ] **Step 4: `shared/relatorios-consultas.ts`**
```ts
/**
 * @file relatorios-consultas.ts
 * Consultas ÚNICAS das abas sob demanda dos Relatórios (Estoque, Avaliações).
 * Paginadas e lançam erro.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import type { Limites } from './periodos';
import type { AvaliacaoRow, MovEstoqueRow } from './relatorios';

export async function carregarSaidasEstoque(db: ClienteDb, empresaId: string, l: Limites): Promise<MovEstoqueRow[]> {
  return buscarTodasOuLancar<MovEstoqueRow>((de, ate) => db.from('estoque_movimentos')
    .select('produto_id, quantidade, produto:produtos(nome, preco_custo)')
    .eq('empresa_id', empresaId).eq('tipo', 'saida')
    .gte('created_at', l.startIso).lte('created_at', l.endIso)
    .order('created_at').order('id')
    .range(de, ate));
}

/**
 * avaliacoes.profissional_id aponta para empresa_membros (que NÃO tem nome):
 * o nome vem de empresa_membros → users. O embed antigo `empresa_membros(nome)`
 * fazia a aba Avaliações do web falhar sempre.
 */
export const COLUNAS_AVALIACAO = `nota, comentario, created_at, profissional_id,
  profissional:empresa_membros!avaliacoes_profissional_id_fkey(user:users!empresa_membros_user_id_fkey(nome)),
  cliente:clientes!avaliacoes_cliente_id_fkey(nome)`;

export async function carregarAvaliacoes(db: ClienteDb, empresaId: string, l: Limites): Promise<AvaliacaoRow[]> {
  return buscarTodasOuLancar<AvaliacaoRow>((de, ate) => db.from('avaliacoes')
    .select(COLUNAS_AVALIACAO)
    .eq('empresa_id', empresaId)
    .gte('created_at', l.startIso).lte('created_at', l.endIso)
    .order('created_at', { ascending: false }).order('id')
    .range(de, ate));
}
```
   Atenção: `.order('id')` em `estoque_movimentos`/`avaliacoes` exige coluna `id` — as duas têm (`avaliacoes` na 030; confirme `estoque_movimentos` com `grep -n "create table public.estoque_movimentos" -A 3 supabase/migrations/*.sql`).
- [ ] **Step 5: Verificação da task** (inclui mobile).
- [ ] **Step 6: Commit** — `feat(shared): regras e consultas unicas das abas dos Relatorios (corrige o embed de avaliacoes)`.

---

### Task 14: Web — Relatórios (abas via shared, Sumidas +60d e Taxa de retorno)

**Files:** Modify `web/app/(app)/relatorios/page.tsx`, `web/tests/unit/paridade-fase2a-web-relatorios.test.ts` · Test `web/tests/unit/paridade-fase2b-web-relatorios.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-web-relatorios.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'relatorios', 'page.tsx'), 'utf8');

describe('web Relatórios com as regras únicas', () => {
  it('abas, cartões, resumo e rankings de shared', () => {
    for (const t of ['ABAS_RELATORIO', 'cartoesKpiRelatorio(kpis, kpisAnt', 'linhasResumoFinanceiro(', 'rankingDespesasPorCategoria(',
      'comissaoPorProfissional(', 'resumoInsumos(', 'resumoAvaliacoes(', 'carregarSaidasEstoque(', 'carregarAvaliacoes(',
      'carregarComissoesDoPeriodo(', 'normalizarComissoes(', 'comissoesPorProfissional(', 'pagarComissoes(']) expect(src).toContain(t);
    for (const t of ['empresa_membros!avaliacoes_profissional_id_fkey(nome)', "from('estoque_movimentos')", "from('comissoes')",
      "import { buscarTodasPaginas }"]) expect(src).not.toContain(t);
  });
  it('Sumidas +60d e Taxa de retorno (antes só no app)', () => {
    for (const t of ['carregarUltimasVisitas(', 'clientesSumidas(', 'Sumidas +60d', 'Taxa de retorno', 'pctRetorno']) expect(src).toContain(t);
  });
  it('Pagar confirma antes', () => {
    expect(src).toContain('textoConfirmarPagamento(');
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: Imports e tipos.** Remova `import { buscarTodasPaginas } from '@shared/paginacao';`, `variacaoPercentual` (se sem uso) e acrescente:
```ts
import { chaveDiaBRT, rotuloDataBR } from '@shared/periodos';   // junte ao import existente
import { clientesSumidas } from '@shared/kpis-financeiros';     // junte ao import existente
import {
  ABAS_RELATORIO, cartoesKpiRelatorio, linhasResumoFinanceiro, rankingDespesasPorCategoria, comissaoPorProfissional,
  resumoInsumos, resumoAvaliacoes, type AbaRelatorio, type CartaoKpiRelatorio, type MovEstoqueRow, type AvaliacaoRow,
} from '@shared/relatorios';
import { carregarSaidasEstoque, carregarAvaliacoes } from '@shared/relatorios-consultas';
import {
  normalizarComissoes, comissoesPorProfissional, resumoComissoes, textoConfirmarPagamento, MENSAGEM_PAGAMENTO_PARCIAL,
  type ComissaoItem,
} from '@shared/comissoes';
import { carregarComissoesDoPeriodo, pagarComissoes } from '@shared/comissoes-consultas';
import { carregarUltimasVisitas } from '@shared/dashboard-consultas';
import { datasDasUltimasVisitas } from '@shared/dashboard';
```
   Apague os tipos `Despesa`, `Comissao`, `MovEstoque`, `Avaliacao`, `EstRankItem`. Substitua `ABA_OPTS`/`Aba` por:
```ts
const ICONE_ABA: Record<AbaRelatorio, React.ElementType> = {
  financeiro: BarChart2, servicos: Scissors, equipe: Users, clientes: User, estoque: Package, comissoes: DollarSign, avaliacoes: Star,
};
const ABA_OPTS = ABAS_RELATORIO.map(a => ({ ...a, icon: ICONE_ABA[a.key] }));
type Aba = AbaRelatorio;

const ICONE_KPI: Record<CartaoKpiRelatorio['id'], React.ElementType> = {
  bruto: DollarSign, cartao: CreditCard, liquido: TrendingUp, lucro: Activity, aposRetiradas: Activity,
  atendimentos: Scissors, ticket: Target, comparecimento: Users, cancelamento: XCircle, taxas: Receipt, comissoes: DollarSign,
};
const COR_KPI: Record<CartaoKpiRelatorio['id'], string> = {
  bruto: '#7C3AED', cartao: '#DC2626', liquido: '#16A34A', lucro: '#0D7E5F', aposRetiradas: '#0D7E5F',
  atendimentos: '#D4608A', ticket: '#B45309', comparecimento: '#1D4ED8', cancelamento: '#DC2626', taxas: '#DC2626', comissoes: '#D97706',
};
```
- [ ] **Step 4: Estado e cargas.** `comissoes: ComissaoItem[]`, `movs: MovEstoqueRow[]`, `avaliacoes: AvaliacaoRow[]`, novo `const [sumidas, setSumidas] = useState<number | null>(null);`. Em `carregar`:
```ts
      const [d, rCom, ultimas] = await Promise.all([
        carregarDadosFinanceiros(supabase, empId, uniaoLimites(lAnterior, lAtual)),
        carregarComissoesDoPeriodo(supabase, empId, lAtual),
        carregarUltimasVisitas(supabase, empId, lAtual.endIso),
      ]);
      if (req !== reqRef.current) return;
      // ... (histórico de retorno igual)
      setDados(d);
      setComissoes(normalizarComissoes(rCom));
      setSumidas(clientesSumidas(datasDasUltimasVisitas(ultimas), lAtual.endIso));
      setHistoricoClientes(hist);
```
   e no `catch` também `setSumidas(null)`. Efeito do Estoque: `try { const rows = await carregarSaidasEstoque(supabase, empresaId, atual); setMovs(rows); setEstoqueChave(chave); } catch (e) { setMovs([]); showErro(\`Erro ao carregar o estoque: ${(e as Error).message}\`); } setLoadingAba(false);`. Avaliações: idem com `carregarAvaliacoes`.
- [ ] **Step 5: Derivados.** Substitua `despesas`, `rankDespDespCat`, `rankEstoque`, `notaMedia/rankAvaliacoes`, `comissoesPorProf` e o `comPorProf` do `rankEquipe` por:
```ts
  const cartoes = cartoesKpiRelatorio(kpis, kpisAnt, { periodo, isOwner, retiradasPeriodo, fmt: fmtBRL });
  const linhasResumo = linhasResumoFinanceiro(kpis, { isOwner, retiradasPeriodo });
  const rankDespCat = useMemo(() => rankingDespesasPorCategoria(dadosPeriodo.despesas), [dadosPeriodo]);
  const comPorProf = useMemo(() => comissaoPorProfissional(dadosPeriodo.comissoes), [dadosPeriodo]);
  // rankEquipe: comissao: comPorProf[r.chave] ?? 0
  const insumos = useMemo(() => resumoInsumos(movs, kpis.atendimentos), [movs, kpis.atendimentos]);
  const aval = useMemo(() => resumoAvaliacoes(avaliacoes), [avaliacoes]);
  const comissoesPorProf = useMemo(() => comissoesPorProfissional(comissoes), [comissoes]);
  const resumoCom = useMemo(() => resumoComissoes(comissoes), [comissoes]);
  const { atendidas: clientesUnicos, retornaram, novas, pctRetorno } = useMemo(
    () => metricasRetorno(dadosPeriodo.agendamentos, historicoClientes), [dadosPeriodo, historicoClientes]);
```
   Apague `dBruto`, `dAtend`, `dTicket` e `resultadoAposRetiradas` local (o card e o resumo vêm de shared).
- [ ] **Step 6: Pagar.**
```ts
  async function marcarComoPago(profissionalId: string) {
    const prof = comissoesPorProf.find(p => p.profissionalId === profissionalId);
    if (!empresaId || !prof) return;
    const ids = prof.idsPendentes;
    if (ids.length === 0) return;
    if (!confirm(textoConfirmarPagamento(prof.nome, fmtBRL(prof.pendente), labelPeriodo))) return;

    // Optimistic update (lista detalhada + dados que alimentam os KPIs)
    const marcar = (idsAlvo: string[], status: 'pago' | 'pendente') => {
      setComissoes(prev => prev.map(c => idsAlvo.includes(c.id) ? { ...c, status } : c));
      setDados(prev => ({
        ...prev,
        comissoes: prev.comissoes.map(c => idsAlvo.includes(c.id) ? { ...c, status } : c),
      }));
    };
    marcar(ids, 'pago');

    // Pagar = só as pendentes do período exibido; pagarComissoes confere as linhas afetadas.
    const r = await pagarComissoes(supabase, empresaId, ids);
    const confirmados = new Set(r.confirmados);
    const naoConfirmados = ids.filter(id => !confirmados.has(id));
    if (naoConfirmados.length > 0) {
      marcar(naoConfirmados, 'pendente');
      showErro(r.erro ? `Erro ao atualizar comissões: ${r.erro}` : MENSAGEM_PAGAMENTO_PARCIAL);
    }
  }
```
- [ ] **Step 7: JSX.**
   - KPIs: `{!erroCarga && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">{cartoes.map(c => <KpiCard key={c.id} icon={ICONE_KPI[c.id]} label={c.rotulo} value={c.valor} sub={c.sub ?? undefined} delta={c.delta} rotuloDelta={c.rotuloDelta ?? undefined} cor={c.negativo ? '#DC2626' : COR_KPI[c.id]} loading={loading} />)}</div>}`.
   - Resumo financeiro: troque as linhas fixas por `linhasResumo.map(l => …)`: `entrada`/`saida` com `py-2.5 border-b border-border` e texto `text-text-2`; `total` com `bg-bg/50 px-1 rounded` e negrito; `resultado` com `pt-3 mt-1`, negrito e cor `l.valor >= 0 ? '#0D7E5F' : '#DC2626'`; valor `<Secret>{l.tipo === 'saida' && l.valor > 0 ? '− ' : ''}{fmtBRL(l.valor)}</Secret>`, cor `#7C3AED` (entrada/total) ou `#DC2626` (saída). Depois da linha `bruto`, mantenha "Inclui fechamento importado de …" quando houver.
   - Despesas por categoria: `rankDespCat` já vem de shared (mesmo JSX).
   - Equipe: igual (fonte da comissão mudou).
   - Clientes: grade `grid-cols-2 md:grid-cols-5` com **Clientes únicos**, **Retornaram**, **Novas**, **Taxa de retorno** (`clientesUnicos > 0 ? \`${pctRetorno}%\` : '—'`) e **Sumidas +60d** (`sumidas == null ? '—' : sumidas`); mantenha `>Novas<`.
   - Estoque: `insumos.ranking` (campos `nome/qtd/custo/pct`), "Custo total: {fmtBRL(insumos.custoTotal)}" e médio `insumos.custoMedioPorAtendimento != null ? fmtBRL(...) : '—'`.
   - Comissões: resumo `resumoCom.pendente`, `resumoCom.pago`, `resumoCom.quantidade`; cards `comissoesPorProf.map(prof => …)` com `prof.profissionalId`, `prof.nome`, `prof.pendente`/`prof.pago` e as contagens `prof.itens.filter(...)`; tabela `prof.itens.map(c => …)`: data `rotuloDataBR(chaveDiaBRT(c.dataAtendimento ?? c.criadaEm))`, `c.clienteNome`, `c.servicoNome`, `c.valorAtendimento != null ? fmtBRL(c.valorAtendimento) : '—'`, `c.percentual`, `c.valorComissao`, status; rodapé `prof.itens.length` e `prof.total`.
   - Avaliações: `aval.notaMedia != null ? aval.notaMedia.toFixed(1) : '—'`, sub `aval.total > 0 ? …`, "Profissionais avaliados" `aval.ranking.length`, "Com nota 5" `aval.comNota5` com sub `aval.pctNota5 != null ? \`${aval.pctNota5}% das avaliações\` : undefined`; ranking `aval.ranking`; recentes `avaliacoes.slice(0, 20)` com `av.profissional?.user?.nome`.
   - Export: aba comissões com accessors de `ComissaoItem` (`c.profissionalNome`, data como acima, `c.clienteNome`, `c.servicoNome`, `c.valorAtendimento`, `c.percentual`, `c.valorComissao`, status); aba estoque `getData` = `insumos.ranking`; financeiro continua `concluidos`.
   Mantenha `function ChartBar` (`self-stretch`), `'flex items-stretch gap-2'`, `'Período inclui mês com fechamento importado'`, o contador `reqRef` e `{!loading && !erroCarga && (\n            <ExportButton`.
- [ ] **Step 8: Ajustar a 2A** (`paridade-fase2a-web-relatorios.test.ts`, "deltas vs período anterior"): substitua as 3 asserções `variacaoPercentual(kpis.…, kpisAnt.…)` por `expect(src).toContain('cartoesKpiRelatorio(kpis, kpisAnt');` e mantenha `ROTULO_COMPARACAO`? — a página deixa de citar `ROTULO_COMPARACAO[periodo]`; troque essa asserção por `expect(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'relatorios.ts'), 'utf8')).toContain('ROTULO_COMPARACAO[o.periodo]');`.
- [ ] **Step 9: Verificação da task.**
- [ ] **Step 10: Commit** — `feat(web): Relatorios com abas de shared, Sumidas +60d e Taxa de retorno; corrige a aba Avaliacoes`.

---

### Task 15: Mobile — `useRelatorios` com os dados das 7 abas

**Files:** Modify `mobile/hooks/useRelatorios.ts`, `shared/invalidacao-financeira.ts`, `web/tests/unit/paridade-fase2a-revisao-final.test.ts` · Test `web/tests/unit/paridade-fase2b-mobile-relatorios.test.ts`

- [ ] **Step 1: Teste que falha**
```ts
// web/tests/unit/paridade-fase2b-mobile-relatorios.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAVES_FINANCEIRO } from '@shared/invalidacao-financeira';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useRelatorios.ts');

describe('app Relatórios: dados das abas pelas funções do web', () => {
  it('hook', () => {
    for (const t of ['serieFaturamento(', 'rankingDespesasPorCategoria(', 'comissaoPorProfissional(', 'resumoInsumos(',
      'resumoAvaliacoes(', 'carregarSaidasEstoque(', 'carregarAvaliacoes(', 'carregarComissoesDoPeriodo(',
      'comissoesPorProfissional(', 'pagarComissoes(', 'invalidarFinanceiro(qc)', 'carregarUltimasVisitas(',
      'carregarRetiradas(', "'rel-comissoes'", "aba === 'estoque'", "aba === 'avaliacoes'", "aba === 'comissoes'"])
      expect(hook).toContain(t);
  });
  it('pagar invalida a aba de comissões', () => {
    expect(CHAVES_FINANCEIRO).toContain('rel-comissoes');
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3:** `shared/invalidacao-financeira.ts`: acrescente `'rel-comissoes',`.
- [ ] **Step 4: Reescrever `useRelatorios.ts`**
```ts
/**
 * @file useRelatorios.ts
 * Relatórios do app — mesmas abas, períodos, consultas e funções dos Relatórios
 * web (@shared/relatorios, @shared/kpis-financeiros, @shared/comissoes).
 * Comissões, Estoque e Avaliações só buscam quando a aba é aberta (como no web).
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import { limitesDoPeriodo, uniaoLimites, hojeBRT, type PeriodoRelatorio, type OpcoesPeriodo } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, rankingAtendimentos, clientesAtendidosNoPeriodo, metricasRetorno,
  clientesSumidas, serieFaturamento, retiradasDoPeriodo,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarClientesComHistoricoAntes, carregarRetiradas } from '@shared/kpis-financeiros-consultas';
import {
  rankingDespesasPorCategoria, comissaoPorProfissional, resumoInsumos, resumoAvaliacoes, type AbaRelatorio,
} from '@shared/relatorios';
import { carregarSaidasEstoque, carregarAvaliacoes } from '@shared/relatorios-consultas';
import { normalizarComissoes, comissoesPorProfissional, resumoComissoes, MENSAGEM_PAGAMENTO_PARCIAL } from '@shared/comissoes';
import { carregarComissoesDoPeriodo, pagarComissoes } from '@shared/comissoes-consultas';
import { carregarUltimasVisitas } from '@shared/dashboard-consultas';
import { datasDasUltimasVisitas } from '@shared/dashboard';

export type { PeriodoRelatorio };

export interface ResumoRelatorio {
  faturamento: number; faturamentoAnterior: number;
  atendimentos: number; atendimentosAnterior: number;
  ticketMedio: number; ticketMedioAnterior: number;
  totalAgendamentos: number; perdidos: number; pctCancelamento: number;
}
export interface MetricasCliente {
  novos: number; retornaram: number;
  sumidos: number | undefined;   // undefined = carregando/erro (a tela mostra '—')
  totalAtendidas: number; pctRetorno: number;
}
export interface ServicoRelatorio { servico_id: string; nome: string; quantidade: number; receita: number; percentual: number }
export interface ProfissionalRelatorio {
  profissional_id: string; nome: string; foto_url?: string; especialidades: string;
  atendimentos: number; faturamento: number; comissao: number; percentual: number;
}
export interface ClienteRelatorio { cliente_id: string; nome: string; visitas: number; total: number; percentual: number }

export function useRelatorios(periodo: PeriodoRelatorio, opcoes: OpcoesPeriodo, aba: AbaRelatorio = 'financeiro') {
  const { empresaAtiva, isOwner } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();

  const { atual, anterior } = limitesDoPeriodo(periodo, hojeBRT(), opcoes);
  const chave = `${periodo}_${atual.startDate}_${atual.endDate}`;

  const dadosQ = useQuery({
    queryKey: ['rel-dados', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const dados = await carregarDadosFinanceiros(supabase, empresaId!, uniaoLimites(anterior, atual));
      const ids = clientesAtendidosNoPeriodo(recortarDados(dados, atual).agendamentos);
      const historico = await carregarClientesComHistoricoAntes(supabase, empresaId!, ids, atual.startIso);
      return { dados, historico: [...historico] };
    },
  });

  // Sumidas: última visita concluída até o FIM do período há +60 dias (regra única; web igual).
  const sumidosQ = useQuery({
    queryKey: ['rel-sumidos', empresaId, periodo, atual.startIso, atual.endIso],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => clientesSumidas(datasDasUltimasVisitas(await carregarUltimasVisitas(supabase, empresaId!, atual.endIso)), atual.endIso),
  });

  const retiradasQ = useQuery({
    queryKey: ['fin-retiradas', empresaId],
    enabled: !!empresaId && isOwner,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarRetiradas(supabase, empresaId!),
  });

  const comissoesQ = useQuery({
    queryKey: ['rel-comissoes', empresaId, chave],
    enabled: !!empresaId && aba === 'comissoes',
    staleTime: 1000 * 60 * 2,
    queryFn: async () => normalizarComissoes(await carregarComissoesDoPeriodo(supabase, empresaId!, atual)),
  });
  const estoqueQ = useQuery({
    queryKey: ['rel-estoque', empresaId, chave],
    enabled: !!empresaId && aba === 'estoque',
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarSaidasEstoque(supabase, empresaId!, atual),
  });
  const avaliacoesQ = useQuery({
    queryKey: ['rel-avaliacoes', empresaId, chave],
    enabled: !!empresaId && aba === 'avaliacoes',
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarAvaliacoes(supabase, empresaId!, atual),
  });

  const pagar = useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await pagarComissoes(supabase, empresaId!, ids);
      if (r.naoConfirmados.length > 0) throw new Error(r.erro ?? MENSAGEM_PAGAMENTO_PARCIAL);
      return r.confirmados.length;
    },
    onSettled: () => invalidarFinanceiro(qc),
  });

  const calculado = useMemo(() => {
    if (!dadosQ.data) return null;
    const { dados, historico } = dadosQ.data;
    const k = calcularKpisFinanceiros(dados, atual);
    const ka = calcularKpisFinanceiros(dados, anterior);
    const doPeriodo = recortarDados(dados, atual);
    const ags = doPeriodo.agendamentos;
    const retorno = metricasRetorno(ags, historico);
    const resumo: ResumoRelatorio = {
      faturamento: k.bruto, faturamentoAnterior: ka.bruto,
      atendimentos: k.atendimentos, atendimentosAnterior: ka.atendimentos,
      ticketMedio: k.ticketMedio, ticketMedioAnterior: ka.ticketMedio,
      totalAgendamentos: k.totalAgendamentos, perdidos: k.perdidos, pctCancelamento: k.pctCancelamento,
    };
    const servicos: ServicoRelatorio[] = rankingAtendimentos(ags, 'servico').map(s => ({
      servico_id: s.chave, nome: s.nome, quantidade: s.quantidade, receita: s.receita, percentual: Math.round(s.percentual),
    }));
    const comPorProf = comissaoPorProfissional(doPeriodo.comissoes);
    const extras: Record<string, { foto_url?: string; cats: Set<string> }> = {};
    for (const a of ags) {
      if (a.status !== 'concluido' || !a.profissional_id) continue;
      const e = (extras[a.profissional_id] ??= { foto_url: a.profissional?.foto_url ?? undefined, cats: new Set() });
      if (a.servico?.categoria) e.cats.add(a.servico.categoria);
    }
    const profissionais: ProfissionalRelatorio[] = rankingAtendimentos(ags, 'profissional').map(p => ({
      profissional_id: p.chave, nome: p.nome, foto_url: extras[p.chave]?.foto_url,
      especialidades: [...(extras[p.chave]?.cats ?? [])].slice(0, 2).join(' · ') || 'Geral',
      atendimentos: p.quantidade, faturamento: p.receita, comissao: comPorProf[p.chave] ?? 0, percentual: p.percentual,
    }));
    const topClientes: ClienteRelatorio[] = rankingAtendimentos(ags, 'cliente').slice(0, 10).map(c => ({
      cliente_id: c.chave, nome: c.nome, visitas: c.quantidade, total: c.receita, percentual: c.percentual,
    }));
    return {
      kpis: k, kpisAnt: ka, resumo, retorno, servicos, profissionais, topClientes,
      serie: serieFaturamento(dados, atual).map(p => ({ rotulo: p.rotulo, valor: p.valor })),
      despesasPorCategoria: rankingDespesasPorCategoria(doPeriodo.despesas),
      mesesComFechamento: k.mesesComFechamento,
    };
    // `chave` resume `atual`/`anterior` (objetos novos a cada render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dadosQ.data, chave]);

  const clientes: MetricasCliente | undefined = calculado ? {
    novos: calculado.retorno.novas,
    retornaram: calculado.retorno.retornaram,
    sumidos: sumidosQ.data,
    totalAtendidas: calculado.retorno.atendidas,
    pctRetorno: calculado.retorno.pctRetorno,
  } : undefined;

  const itensComissao = comissoesQ.data ?? [];

  return {
    ...(calculado ?? {}),
    resumo: calculado?.resumo,
    kpis: calculado?.kpis,
    kpisAnt: calculado?.kpisAnt,
    clientes,
    servicos: calculado?.servicos ?? [],
    profissionais: calculado?.profissionais ?? [],
    topClientes: calculado?.topClientes ?? [],
    serie: calculado?.serie ?? [],
    despesasPorCategoria: calculado?.despesasPorCategoria ?? [],
    mesesComFechamento: calculado?.mesesComFechamento ?? [],
    isOwner,
    retiradasPeriodo: isOwner ? retiradasDoPeriodo(retiradasQ.data?.rows ?? [], retiradasQ.data?.devs ?? [], atual) : 0,
    comissoes: {
      porProfissional: comissoesPorProfissional(itensComissao),
      resumo: resumoComissoes(itensComissao),
      pronto: comissoesQ.isSuccess, isError: comissoesQ.isError, refetch: comissoesQ.refetch,
    },
    insumos: resumoInsumos(estoqueQ.data ?? [], calculado?.kpis.atendimentos ?? 0),
    insumosPronto: estoqueQ.isSuccess, insumosErro: estoqueQ.isError,
    avaliacoes: resumoAvaliacoes(avaliacoesQ.data ?? []),
    avaliacoesRecentes: (avaliacoesQ.data ?? []).slice(0, 20),
    avaliacoesPronto: avaliacoesQ.isSuccess, avaliacoesErro: avaliacoesQ.isError,
    pagarComissoes: (ids: string[]) => pagar.mutateAsync(ids),
    pagando: pagar.isPending,
    atual,
    isLoading: dadosQ.isLoading,
    // Falha de qualquer consulta da carga principal: a tela mostra erro, nunca zeros.
    isError: dadosQ.isError || sumidosQ.isError || retiradasQ.isError,
    refetch: () => { dadosQ.refetch(); sumidosQ.refetch(); if (isOwner) retiradasQ.refetch(); },
  };
}
```
   (Remova o `...(calculado ?? {})` se o `tsc` reclamar de propriedades duplicadas — as chaves explícitas já cobrem tudo.)
- [ ] **Step 5: Ajustar a 2A** (`paridade-fase2a-revisao-final.test.ts`, "sumidas ignora cliente nulo"): troque `expect(h).toContain('a.cliente_id && !ultimo.has(a.cliente_id)');` por `expect(h).toContain('carregarUltimasVisitas(');` e acrescente `expect(ler('shared', 'dashboard-consultas.ts')).toContain('a.cliente_id && !mapa.has(a.cliente_id)');`.
- [ ] **Step 6: Verificação da task** (mobile; a tela ainda usa só parte do retorno — compila).
- [ ] **Step 7: Commit** — `feat(mobile): useRelatorios traz os dados das 7 abas pelas funcoes do web`.

---

### Task 16: Mobile — tela de Relatórios com as 7 abas

**Files:** Modify `mobile/app/(empresa)/relatorios.tsx`, `web/tests/unit/ui-lote-2026-09.test.ts` · Test: estender `web/tests/unit/paridade-fase2b-mobile-relatorios.test.ts`

- [ ] **Step 1: Acrescentar ao teste da Task 15**
```ts
describe('app Relatórios: tela com as 7 abas', () => {
  const tela = ler('mobile/app/(empresa)/relatorios.tsx');
  it('abas e blocos', () => {
    for (const t of ['ABAS_RELATORIO', 'cartoesKpiRelatorio(', 'linhasResumoFinanceiro(', '<GraficoBarras', 'Despesas por categoria',
      'Sumidas +60d', 'Taxa retorno', 'Top clientes', 'Insumos consumidos', 'Avaliações recentes', 'textoConfirmarPagamento(',
      'Período inclui mês com fechamento importado', "resumo && !isError ? formatBRL(resumo.faturamento) : '—'"])
      expect(tela).toContain(t);
    expect(tela).not.toContain('iconSize=');
  });
});
```
- [ ] **Step 2: Rodar e confirmar a falha.**
- [ ] **Step 3: Reescrever a tela.** Mantenha do arquivo atual, sem mudança: `C`, `mascaraData`, `paraIsoBR`, `formatBRL`, `initials`, `Avatar`, o estado de período/datas personalizadas e todo o hero (cabeçalho, `SmoothTabs` de `PERIODOS_RELATORIO`, datas personalizadas com `dataCustomInvalida`/"Data inválida", navegação de semana/ano e o bloco "Faturamento no período" com `variacaoPercentual(` e `ROTULO_COMPARACAO[periodo]`). Mudanças:
   - Imports novos: `useWindowDimensions, Alert` de react-native; `Svg, { Rect, G, Text as SvgText } from 'react-native-svg'`; `Star, Package, DollarSign, ChevronDown` do lucide; `ABAS_RELATORIO, cartoesKpiRelatorio, linhasResumoFinanceiro, type AbaRelatorio, type CartaoKpiRelatorio` de `@shared/relatorios`; `textoConfirmarPagamento, type ComissoesDaProfissional` de `@shared/comissoes`; `rotuloDataBR, chaveDiaBRT` de `@shared/periodos`. Remova `ServicoRow`/`ProfissionalRow`/`KpiCard` antigos e o import de `CategoriaIcon` (fim do `iconSize`, erro do baseline).
   - Estado `const [aba, setAba] = useState<AbaRelatorio>('financeiro');` e `const r = useRelatorios(periodo, opcoes, aba);`.
   - Valor do hero: `{resumo && !isError ? formatBRL(resumo.faturamento) : '—'}`.
   - Componentes auxiliares (no topo do arquivo):
```tsx
function Secao({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ marginHorizontal: 24, marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>{titulo}</Text>
        {extra}
      </View>
      <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <View style={{ padding: 20, alignItems: 'center' }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, textAlign: 'center' }}>{texto}</Text>
    </View>
  );
}

function CartaoKpi({ c }: { c: CartaoKpiRelatorio }) {
  return (
    <View style={{ width: '48%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 6 }}>{c.rotulo}</Text>
      <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: c.negativo ? C.red : C.text, letterSpacing: -0.5 }}>{c.valor}</SecretText>
      {c.sub && <SecretText style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginTop: 2 }}>{c.sub}</SecretText>}
      {c.delta !== null && (
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: c.delta >= 0 ? C.green : C.red, marginTop: 4 }}>
          {c.delta >= 0 ? '+' : ''}{c.delta}% {c.rotuloDelta}
        </Text>
      )}
    </View>
  );
}

function LinhaRanking({ pos, nome, valor, detalhe, pct, extra, cor = C.accent, ultimo }: {
  pos: number; nome: string; valor: string; detalhe: string; pct: number; extra?: string; cor?: string; ultimo: boolean;
}) {
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: ultimo ? 0 : 1, borderBottomColor: C.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: pos <= 3 ? C.primary : C.text4, minWidth: 18 }}>{pos}</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>{nome}</Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>{detalhe}</Text>
        <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>{valor}</SecretText>
      </View>
      <View style={{ height: 3, backgroundColor: C.border, borderRadius: 2, marginTop: 6, marginLeft: 28 }}>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: cor, width: `${Math.min(pct, 100)}%` }} />
      </View>
      {extra && <SecretText style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 3, marginLeft: 28 }}>{extra}</SecretText>}
    </View>
  );
}

function GraficoBarras({ pontos }: { pontos: { rotulo: string; valor: number }[] }) {
  const { width } = useWindowDimensions();
  const W = width - 48 - 32;
  const H = 140, BASE = 18, TOPO = 8;
  const max = Math.max(...pontos.map(p => p.valor), 1);
  const passo = W / Math.max(pontos.length, 1);
  const barra = Math.max(passo * 0.6, 2);
  return (
    <Svg width={W} height={H}>
      {pontos.map((p, i) => {
        const h = (p.valor / max) * (H - BASE - TOPO);
        const x = i * passo + (passo - barra) / 2;
        return (
          <G key={`${p.rotulo}-${i}`}>
            <Rect x={x} y={H - BASE - h} width={barra} height={p.valor > 0 ? Math.max(h, 2) : 0} rx={3} fill={C.accent} />
            <SvgText x={x + barra / 2} y={H - 4} fontSize={9} fill={C.text3} textAnchor="middle">{p.rotulo}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
```
   - Depois do banner de erro (texto: "Não foi possível carregar os relatórios." + "Tentar de novo"; **sem** "podem estar incompletos"), as abas: `<SmoothTabs tabs={ABAS_RELATORIO} active={aba} onChange={k => setAba(k as AbaRelatorio)} activeColor={C.primary} trackBg={C.surface} trackBorder={C.border} inactiveTextColor={C.text3} style={{ marginHorizontal: 24, marginTop: 16, marginBottom: 16 }} />`. Nada das abas Financeiro/Serviços/Equipe/Clientes é desenhado com `isError` ou sem `r.kpis` (mostra `<Vazio texto="Carregando…" />` enquanto `isLoading`).
   - `const notaFechamento = mesesComFechamento.length > 0 ? <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, padding: 12 }}>Período inclui mês com fechamento importado — detalhamentos mostram só os lançamentos ao vivo.</Text> : null;`
   - **Financeiro:** grade `cartoesKpiRelatorio(r.kpis, r.kpisAnt, { periodo, isOwner: r.isOwner, retiradasPeriodo: r.retiradasPeriodo, fmt: formatBRL }).filter(c => c.id !== 'bruto')` (o bruto já está no hero) em `flexDirection: 'row', flexWrap: 'wrap', gap: 8` com `<CartaoKpi>`; `Secao "Evolução de faturamento"` com `<GraficoBarras pontos={r.serie} />` (ou "Sem faturamento no período") + `notaFechamento`; `Secao "Resumo financeiro"` com `linhasResumoFinanceiro(r.kpis, { isOwner: r.isOwner, retiradasPeriodo: r.retiradasPeriodo })` (mesmas regras de cor do web) e, depois de `bruto`, "Inclui fechamento importado de …"; `Secao "Despesas por categoria"` com `r.despesasPorCategoria.slice(0, 6)` (barra vermelha `pct`).
   - **Serviços:** `Secao "Serviços por receita"` com `servicos.map((s, i) => <LinhaRanking pos={i + 1} nome={s.nome} valor={formatBRL(s.receita)} detalhe={\`${s.quantidade} atend.\`} pct={s.percentual} extra={\`Ticket médio: ${formatBRL(s.quantidade > 0 ? s.receita / s.quantidade : 0)}\`} …/>)`, total `formatBRL(resumo.faturamento)` e `notaFechamento`.
   - **Equipe:** `profissionais.map` com `Avatar` à esquerda (ou `LinhaRanking`), `detalhe={\`${p.atendimentos} atend.\`}`, `extra={p.comissao > 0 ? \`Comissão ${formatBRL(p.comissao)}\` : undefined}`, total "Total comissões no período" `formatBRL(r.kpis.comissoes)` e `notaFechamento`.
   - **Clientes:** grade de 5 métricas (Novas, Retornaram, **Sumidas +60d** com `clientes?.sumidos == null ? '—' : String(clientes.sumidos)`, Total atendidas, **Taxa retorno** com `clientes && clientes.totalAtendidas > 0 ? \`${clientes.pctRetorno}%\` : '—'`) e `Secao "Top clientes"` com `topClientes` (`detalhe` "N visitas", cor `C.rose`). Remova os cards "Novas clientes"/"Taxa retorno" soltos do topo (agora estão aqui).
   - **Estoque:** `!r.insumosPronto && !r.insumosErro` → Carregando; erro → `<Vazio texto="Não foi possível carregar o estoque." />`; vazio → "Sem saídas de estoque registradas no período"; senão `Secao "Insumos consumidos"` (`extra` com "Custo total: {formatBRL(r.insumos.custoTotal)}") e `r.insumos.ranking.map(e => <LinhaRanking … valor={formatBRL(e.custo)} detalhe={\`${e.qtd % 1 === 0 ? e.qtd : e.qtd.toFixed(2)} un.\`} pct={e.pct} cor={C.green} />)` + "Custo médio / atendimento" (`'—'` quando `null`).
   - **Comissões:** loading/erro como Estoque; resumo em 3 cartões (A pagar = `r.comissoes.resumo.pendente`, Já pago, Comissões no período = `quantidade`); por profissional:
```tsx
function CartaoComissoes({ p, rotuloPeriodo, onPagar, pagando }: {
  p: ComissoesDaProfissional; rotuloPeriodo: string; onPagar: (p: ComissoesDaProfissional) => Promise<unknown>; pagando: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  function confirmar() {
    Alert.alert('Confirmar pagamento', textoConfirmarPagamento(p.nome, formatBRL(p.pendente), rotuloPeriodo), [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Pagar', onPress: async () => {
        try { await onPagar(p); } catch (e) { Alert.alert('Não foi possível registrar o pagamento', (e as Error).message); }
      } },
    ]);
  }
  return (
    <View style={{ marginHorizontal: 24, marginBottom: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>{p.nome}</Text>
          <SecretText style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginTop: 2 }}>
            {formatBRL(p.pendente)} pendente · {formatBRL(p.pago)} pago
          </SecretText>
        </View>
        {p.pendente > 0 && (
          <TouchableOpacity onPress={confirmar} disabled={pagando} style={{ backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, opacity: pagando ? 0.6 : 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' }}>Pagar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setAberto(a => !a)} accessibilityLabel={aberto ? 'Ocultar' : 'Detalhar'}>
          <View style={{ transform: [{ rotate: aberto ? '180deg' : '0deg' }] }}><ChevronDown size={16} color={C.text4} /></View>
        </TouchableOpacity>
      </View>
      {aberto && p.itens.map((c, i) => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text }}>{c.clienteNome} · {c.servicoNome}</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
              {rotuloDataBR(chaveDiaBRT(c.dataAtendimento ?? c.criadaEm))} · {c.percentual}%
            </Text>
          </View>
          <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>{formatBRL(c.valorComissao)}</SecretText>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 8, textTransform: 'uppercase', color: c.status === 'pago' ? C.green : C.amber }}>
            {c.status === 'pago' ? 'Pago' : 'Pendente'}
          </Text>
        </View>
      ))}
    </View>
  );
}
```
   usado como `r.comissoes.porProfissional.map(p => <CartaoComissoes key={p.profissionalId} p={p} rotuloPeriodo={rotuloAtual} onPagar={x => r.pagarComissoes(x.idsPendentes)} pagando={r.pagando} />)`.
   - **Avaliações:** loading/erro como Estoque; 3 `CartaoKpi`-like (Nota média `r.avaliacoes.notaMedia != null ? r.avaliacoes.notaMedia.toFixed(1) : '—'`, Profissionais avaliados, Com nota 5 com `pctNota5`), `Secao "Nota média por profissional"` (`r.avaliacoes.ranking`, estrelas com `Star`) e `Secao "Avaliações recentes"` (`r.avaliacoesRecentes`, cliente, `av.profissional?.user?.nome`, nota, comentário entre aspas e `rotuloDataBR(chaveDiaBRT(av.created_at))`); vazio: "Nenhuma avaliação registrada neste período."
   - `formatBRL` permanece sem abreviar "k".
- [ ] **Step 4: Atualizar `ui-lote-2026-09.test.ts`** — no bloco "C1/C2/C3 mobile — Relatórios", troque o comentário (o app agora mostra a comissão por profissional) e substitua o 2º `it` por:
```ts
  it('comissão por profissional vem da regra única e sem cor de alerta', () => {
    expect(src).toContain('p.comissao > 0');
    expect(src).not.toContain('text-pink-500');
  });
```
- [ ] **Step 5: Verificação da task** (mobile: o `relatorios.tsx TS2322` deve sumir; nenhum novo).
- [ ] **Step 6: Commit** — `feat(mobile): Relatorios com as 7 abas do web (financeiro detalhado, equipe com comissao, clientes, estoque, comissoes, avaliacoes)`.

---

### Task 17: Verificação cruzada, registro e status do inventário

**Files:** Create `web/tests/unit/paridade-fase2b-cruzada.test.ts` · Modify `CLAUDE.md`, `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md`

- [ ] **Step 1: Teste cruzado**
```ts
// web/tests/unit/paridade-fase2b-cruzada.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { limitesMes } from '@shared/periodos';
import { calcularKpisFinanceiros } from '@shared/kpis-financeiros';
import { cartoesKpiRelatorio } from '@shared/relatorios';
import { cartoesKpiDashboard } from '@shared/dashboard';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');
function arquivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(join(raiz, dir))) {
    if (n === 'node_modules' || n === '.next') continue;
    const p = join(dir, n);
    if (statSync(join(raiz, p)).isDirectory()) arquivos(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

const PARES: Record<string, { web: string[]; mobile: string[]; exigidos: string[] }> = {
  'Comissões': {
    web: ['web/app/(app)/comissoes/ComissoesGestorView.tsx', 'web/app/(app)/comissoes/ComissoesProfissionalView.tsx'],
    mobile: ['mobile/hooks/useComissoesGestor.ts', 'mobile/app/(empresa)/comissoes.tsx', 'mobile/app/(profissional)/comissoes.tsx', 'mobile/hooks/useProfissional.ts'],
    exigidos: ['carregarComissoesDoPeriodo(', 'PERIODOS_COMISSAO', 'normalizarComissoes'],
  },
  'Financeiro (recorrentes)': {
    web: ['web/app/(app)/financeiro/page.tsx'], mobile: ['mobile/hooks/useFinanceiro.ts'],
    exigidos: ['carregarHistoricoRecorrentesMensais(', 'recorrentesParaLancarNoMes(', 'montarLancamentosRecorrentes('],
  },
  'Calendário do mês': {
    web: ['web/components/FinanceMonthCalendar.tsx'], mobile: ['mobile/components/CalendarioMesFinanceiro.tsx'],
    exigidos: ['gradeCalendarioMes(', 'rotuloIntervaloMes('],
  },
  'Dashboard': {
    web: ['web/app/(app)/dashboard/page.tsx'], mobile: ['mobile/hooks/useDashboard.ts'],
    exigidos: ['navegacaoMesDashboard(', 'clientesParaReconquistar(', 'aniversariantesProximos(', 'carregarDespesasVencendo(',
      'carregarComandasNaoFechadas(', 'progressoMetaEmpresa(', 'receitaAcumuladaPorDia('],
  },
  'Relatórios': {
    web: ['web/app/(app)/relatorios/page.tsx'], mobile: ['mobile/hooks/useRelatorios.ts', 'mobile/app/(empresa)/relatorios.tsx'],
    exigidos: ['rankingDespesasPorCategoria(', 'comissaoPorProfissional(', 'resumoInsumos(', 'resumoAvaliacoes(',
      'carregarComissoesDoPeriodo(', 'clientesSumidas(', 'carregarUltimasVisitas(', 'cartoesKpiRelatorio(', 'linhasResumoFinanceiro(', 'ABAS_RELATORIO'],
  },
};

describe('as duas plataformas usam as mesmas funções', () => {
  for (const [nome, { web, mobile, exigidos }] of Object.entries(PARES)) {
    it(nome, () => {
      const w = web.map(ler).join('\n');
      const m = mobile.map(ler).join('\n');
      for (const e of exigidos) {
        expect(w, `web/${nome} deveria usar ${e}`).toContain(e);
        expect(m, `mobile/${nome} deveria usar ${e}`).toContain(e);
      }
    });
  }
});

describe('ninguém fora de shared paga comissão nem conta pendentes à mão', () => {
  const telas = [...arquivos('web/app'), ...arquivos('web/components'), ...arquivos('mobile/app'), ...arquivos('mobile/hooks')];
  it('nenhum update direto em comissoes', () => {
    const ofensores = telas.filter(f => /from\('comissoes'\)[\s\S]{0,200}\.update\(/.test(ler(f)));
    expect(ofensores).toEqual([]);
  });
  it('nenhum .limit(3000) / .limit(5000) silencioso nas telas financeiras', () => {
    for (const f of ['web/app/(app)/dashboard/page.tsx', 'web/app/(app)/financeiro/page.tsx', 'mobile/hooks/useDashboard.ts', 'mobile/hooks/useFinanceiro.ts'])
      expect(ler(f)).not.toMatch(/\.limit\((3000|5000)\)/);
  });
  it('as telas de comissão não usam limites no fuso do aparelho', () => {
    for (const f of PARES['Comissões'].web.concat(PARES['Comissões'].mobile))
      expect(ler(f), f).not.toMatch(/(startOfMonth|endOfMonth|startOfDay|endOfDay)\([^)]*\)\.toISOString\(\)/);
  });
});

describe('mesma entrada → mesmos cartões nas duas plataformas', () => {
  it('Relatórios e Dashboard montam as listas por shared (determinísticas)', () => {
    const fx = fixtureSetembro();
    const k = calcularKpisFinanceiros(fx, limitesMes('2026-09'));
    const kAnt = calcularKpisFinanceiros(fx, limitesMes('2026-08'));
    const fmt = (v: number) => String(v);
    expect(cartoesKpiRelatorio(k, kAnt, { periodo: 'mes', isOwner: false, retiradasPeriodo: 0, fmt }))
      .toEqual(cartoesKpiRelatorio(k, kAnt, { periodo: 'mes', isOwner: false, retiradasPeriodo: 0, fmt }));
    expect(cartoesKpiDashboard(k, kAnt, { isOwner: false, retiradasMes: 0, emprestimosAbertos: 0, fmt }).find(c => c.id === 'lucro')?.valor)
      .toBe(String(k.lucro));
  });
});
```
- [ ] **Step 2: Rodar** — `cd web && npx vitest run tests/unit/paridade-fase2b-cruzada.test.ts` → PASS (se falhar, corrija a tela apontada, sem relaxar o teste).
- [ ] **Step 3: Verificação completa**
```bash
cd web && npx tsc --noEmit && npx vitest run
cd ../mobile && npx tsc --noEmit 2>&1 | grep "error TS"
cd .. && git status --porcelain
```
Esperado: web zero erros e suíte verde; mobile só erros do baseline (6, já que `comissoes.tsx` e `relatorios.tsx` foram reescritos), comparados por arquivo + código; `git status` sem arquivos soltos.
- [ ] **Step 4: Conferência visual (owner)** — com web e app logados na mesma empresa: Comissões (Mês e Trimestre) com os mesmos totais; pagar um card só muda as do período; Equipe mostra "do mês" + "de meses anteriores"; Financeiro de um mês sem as recorrentes mostra o mesmo aviso nas duas plataformas; Dashboard igual (inclusive comandas não fechadas no web); Relatórios com as mesmas 7 abas e números.
- [ ] **Step 5: Registrar no `CLAUDE.md`** (seção de histórico de auditorias, depois da 2A) a entrada "Sessão 2026-10-01 — Paridade Fase 2B (funcionalidades financeiras)", no formato das anteriores (tabela de critérios com Nota Humana "Aguardando avaliação"), listando:
   - decisões novas: Pagar = período (inclusive Equipe), exportação do app = Fase 2C, períodos de comissão de calendário com navegação, calendário do Financeiro igual ao web, regras do Dashboard (45 dias, 7 dias, 29/02 → 28/02);
   - módulos criados em `shared/` e as listas únicas (`cartoesKpiDashboard`, `cartoesKpiRelatorio`, `linhasResumoFinanceiro`);
   - bugs corrigidos: lançamento de recorrentes do web sem checar erro; "Pagar" da Equipe pagava todas as pendentes; comissões de profissional inativa sumiam da tela de gestão; Comissões com limites no fuso do navegador; aba Avaliações do web sempre com erro (embed `empresa_membros(nome)`); horários do Dashboard web em UTC; badge de despesas do Sidebar em UTC; `.limit(3000)` dos inativos; `useDiasProfissional` sem empresa e em horário local; instantes sem fuso lidos no fuso do aparelho; lucro com 1 centavo de diferença das partes;
   - pendências para fases seguintes (lista abaixo).
   No inventário, logo abaixo de "### Financeiro / Relatórios / Dashboard" e de "### Equipe / Comissões", acrescente:
```markdown
> **Status (2026-10-01): funcionalidades entregues** pela Fase 2B (`docs/superpowers/plans/2026-10-01-paridade-fase2b-funcionalidades-financeiras.md`) — comissões unificadas (Pagar = período, menu do app), recorrentes e calendário no app, Dashboard completo nas duas plataformas, 7 abas dos Relatórios no app, Sumidas/Taxa de retorno no web. Exportação do app: Fase 2C.
```
- [ ] **Step 6: Commit** — `git add web/tests/unit/paridade-fase2b-cruzada.test.ts CLAUDE.md docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md` · `test(paridade): verificacao cruzada da fase 2B e registro`.

---

## Self-review (resultado)

| Item | Onde | OK |
|---|---|---|
| A — Comissões unificadas (fonte, períodos BRT únicos, agrupamento, resumo por profissional) | Tasks 1, 3, 4, 5, 6 | ✔ |
| A — Pagar = só pendentes do período, inclusive Equipe web; `.select('id')` + linhas afetadas | Task 3 (`pagarComissoes`), Tasks 4, 5, 14, 15/16 | ✔ |
| A — Comissões no menu do app com badge; `invalidarFinanceiro` | Task 5 | ✔ |
| B — Recorrentes no app iguais ao web, sem relançar com erro | Tasks 7, 8, 9 (só com `isSuccess` das duas listas e sem `isFetching`) | ✔ |
| B — Calendário do mês no app (mesma grade; justificado) | Tasks 1, 8, 9; decisão 7 | ✔ |
| C — App: navegação de mês, meta, reconquista, aniversariantes, inativos, despesas 7 dias, sparkline com nota | Tasks 10, 12 | ✔ |
| C — Web: alerta de comandas não fechadas; regras extraídas para shared | Tasks 10, 11 | ✔ |
| D — App: 7 abas com as mesmas funções; Web: Sumidas +60d e Taxa de retorno | Tasks 13–16 | ✔ |
| E — `somarPeriodoComFechamentos`/`resolveFinanceiroKpis` removidos | Task 2 | ✔ |
| E — inativos paginados; `chaveDiaBRT` sem fuso = UTC; lucro das partes; `useDiasProfissional` | Tasks 10/11, 1, 2, 6 | ✔ |
| E — testes: pendentes em mês fechado, `valor_liquido` string, pagamento fora do período | Task 2 | ✔ |
| Erros visíveis, nunca zeros | Comissões (`reqRef`/`'—'`), Dashboard (`hojePronto`/`metaPronta`), Relatórios (hero `'—'`, abas com estado de erro) | ✔ |
| Testes de UI/2A existentes preservados ou ajustados de propósito | Tasks 6, 8, 11, 12, 14, 15, 16 (cada ajuste listado) | ✔ |
| Web não importa mobile | todas as regras novas em `shared/`; guarda existente | ✔ |
| Placeholders | nenhum (os dois `MANTENHA` da Task 12 são instrução de cópia literal, removidos do código) | ✔ |

## Fase 2C e fases seguintes (não são tasks aqui)

- **Fase 2C — Exportação no app:** o app gera o mesmo PDF/XLSX do web nas 9 telas (Financeiro, Relatórios por aba, Comissões, Equipe, Estoque, Clientes, Serviços, Pacotes, Agenda) e abre o compartilhamento nativo (expo-print / expo-sharing / expo-file-system); ligar os botões de Download hoje mortos; padronizar a formatação monetária num helper único de `shared/` (o Financeiro do app ainda abrevia "k").
- **Comanda/PDV:** pagamento obrigatório, bandeira/parcelas/taxa, valor cobrado gravado, desconto %×R$, erros não conferidos, Vendas avulsas no app.
- **Estoque:** produto de venda, categorias/unidades, "baixo" `<=`, saída negativa, Movimentações.
- **Equipe:** editar/desativar profissional no app, comissão e `tipo_contrato` no cadastro, convite que zera `percentual_comissao`, pagar pela Equipe no app.
- **Agenda:** `weekStartsOn: 1` e limites locais no app; **inserção de avaliação grava `users.id` em `avaliacoes.profissional_id` (FK de `empresa_membros`) — as avaliações provavelmente nunca são gravadas; corrigir junto com a Agenda** (a leitura já foi corrigida na Task 13).
- **Clientes:** segmentação unificada (VIP/Em risco/Sumidas), aniversariantes do mês, lista de sumidas.
- **Serviços/Pacotes** e **Configurações/Notificações/Papéis:** meta mensal editável no app, empresa ativa no web (`.limit(1)` em várias telas, inclusive Comissões e Equipe).

