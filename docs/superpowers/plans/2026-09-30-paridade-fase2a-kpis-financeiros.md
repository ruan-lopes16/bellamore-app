# Paridade — Fase 2A: Números financeiros únicos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada número financeiro passa a ser calculado por um único conjunto de funções puras em `shared/`, e dá o mesmo valor em todas as telas das duas plataformas para o mesmo período. Os números cobertos são: faturamento bruto, taxa de cartão, líquido após taxas, comissões, despesas pagas, lucro, "após retiradas", ticket médio, nº de atendimentos, % de cancelamento e comparecimento, taxas de reserva e de cancelamento, e vendas avulsas. As telas são:
- **web:** Financeiro, Dashboard (inclusive a visão da profissional) e Relatórios;
- **mobile:** Financeiro, Dashboard, Relatórios e o Início e a Agenda da profissional.

**Architecture:** O plano cria três arquivos novos em `shared/`, sem dependências (nem date-fns):
- `shared/periodos.ts`: limites de período em Brasília (UTC−3 fixo), lista única de períodos, semana começando no domingo e rótulos.
- `shared/kpis-financeiros.ts`: funções puras. Recebem as linhas já buscadas e devolvem números. Toda função recorta as linhas pelos limites recebidos. Por isso o resultado não depende do tamanho da janela que cada tela buscou.
- `shared/kpis-financeiros-consultas.ts`: as consultas únicas. Recebem o client do Supabase (tipo estrutural `ClienteDb`) e devolvem as linhas. Paginam com `buscarTodasPaginas` e ordenam de forma estável, com desempate por `id`. Lançam erro em vez de devolver lista vazia.

**Por que centralizar também as consultas?** A maior parte das divergências atuais está nos filtros, não nas somas:
- UTC × Brasília;
- `pagamentos` × agendamentos;
- sessão de pacote incluída ou não;
- `created_at` × `data_pagamento`.

Uma lista de colunas compartilhada não impediria que cada tela filtrasse de um jeito. Uma função que recebe o client impede.

Cada plataforma continua dona do próprio carregamento: `useEffect` e server component no web, TanStack Query no mobile. O que é compartilhado é *o que* se busca e *como* se calcula.

**Tech Stack:**
- web: Next.js (client pages + server component no Dashboard);
- mobile: Expo Router + React Native + TanStack Query;
- Supabase (Postgres + RLS + PostgREST);
- testes: Vitest em `web/tests/unit`. Os testes cobrem `shared/` e leem código-fonte do mobile como texto.

**Spec:** `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md`, seção "P1 — Dinheiro › Financeiro / Relatórios / Dashboard".

## Global Constraints

### Decisões do dono (obrigatórias)

1. **Receita (faturamento bruto)** é a soma de:
   - agendamentos com `status = 'concluido'` **e** `pacote_cliente_id is null`, pelo `agendamentos.valor`, datados por `data_hora_inicio`;
   - `vendas.valor_final`, por `created_at`;
   - taxas de cancelamento com `status = 'pago'`, por `paga_em`;
   - taxas de reserva com `paga_em` preenchido, por `paga_em`. Isso inclui as retidas depois de pagas.

   `pagamentos` **nunca** é fonte de receita. Ele é fonte só da taxa de cartão e das formas de pagamento.
2. **Comissões** vêm da tabela `comissoes` (`valor_comissao`, o valor gerado de fato) e nunca são recalculadas pelo `percentual_comissao` atual. O período é delimitado por **`comissoes.created_at`**. Justificativa:
   - A tabela só tem essa data própria. Ela nasce quando o atendimento é concluído, pelo trigger `gerar_comissao`, que normalmente roda no mesmo dia do atendimento.
   - É a data que **todas** as telas de comissão já usam: web Relatórios, card de Comissões do Dashboard web, `ComissoesGestorView` web, `useComissoesGestor` mobile e área da profissional nas duas plataformas.
   - Datar pelo `agendamentos.data_hora_inicio` (via embed `!inner`) faria o Financeiro divergir da tela de Comissões, que está fora do escopo da 2A.

   A Task 12 confere em produção a diferença entre as duas datas. Se ela for material, a mudança vira item da Fase 2B.
3. **Lucro** = bruto − taxa de cartão − comissões − despesas pagas.
   - As despesas são as de `status = 'pago'`, datadas por `data_pagamento`.
   - **Taxa de cartão** = Σ(`pagamentos.valor − valor_liquido`), só onde `valor_liquido` não é nulo.
   - **Após retiradas** = lucro − retiradas da dona no período (`retiradasNoPeriodo` de `shared/retiradas-socia.ts`).
   - **"A dona deve"** é saldo histórico: é calculado sobre **todas** as retiradas da empresa, não só as do mês. Hoje o Financeiro web o calcula só com as do mês, e isso é um bug.
4. **Fechamento mensal importado** (`financeiro_ajustes_mensais`): substitui receita **e** comissão do mês inteiro e zera a taxa de cartão, igual em todas as telas, inclusive no Dashboard mobile. **Interpretação adotada (confirmar com o dono):** o fechamento só se aplica aos meses que o período cobre **por inteiro**. Uma semana ou um intervalo personalizado parcial dentro de um mês importado usa o cálculo ao vivo. Hoje, uma "Semana" de um mês importado mostra a receita do mês inteiro, o que está errado. As despesas nunca vêm do fechamento. As linhas de detalhamento (serviços, vendas, taxas) e o ticket médio continuam ao vivo; `mesesComFechamento` informa a tela.
5. **Datas sempre em Brasília**, UTC−3 fixo, via `shared/periodos.ts`:
   - Colunas `timestamptz` são filtradas por `startIso`/`endIso`; colunas `date`, por `startDate`/`endDate`.
   - Proibido nas telas financeiras: `toISOString().slice(0, 10)`, `startOfMonth(...)/endOfMonth(...)/startOfDay(...)/endOfDay(...).toISOString()` e agrupar mês com `slice(0, 7)` de timestamp.
   - O antigo `getMonthQueryBounds` passa a morar em `shared/periodos.ts`.
6. **Semana começa no domingo** (`diaDaSemana`/`limitesDoPeriodo`) nas duas plataformas.

   **Lista única de períodos** (Relatórios web e mobile):

   | Período | Intervalo |
   |---|---|
   | Hoje | o dia |
   | Semana | com navegação |
   | Mês | mês atual |
   | Mês anterior | mês passado |
   | 3 meses | mês atual + 2 anteriores |
   | 6 meses | mês atual + 5 anteriores |
   | Ano | com navegação |
   | Personalizado | intervalo livre |

   A lista é a do web mais "Hoje". O "Trimestre" do mobile era o trimestre de calendário e passa a ser "3 meses". Os dois lados já tinham "Personalizado".
7. **Ticket médio** = receita de serviços sem pacote ÷ nº de atendimentos concluídos sem pacote.
   - **"Atendimentos"** exibido = todos os concluídos, inclusive sessões de pacote, porque são atendimentos reais.
   - **Rankings** (serviço, profissional, cliente): a quantidade conta todos os concluídos e a receita soma só os faturáveis.
8. **"Clientes que retornaram"** = cliente com atendimento concluído no período que também tinha atendimento concluído **antes** do período (regra do mobile). No web, o card "Única visita" vira "Novas".
9. **Deltas vs período anterior equivalente** (bruto, atendimentos, ticket) nas duas plataformas. Usam `variacaoPercentual`, que devolve `null` com base zero.
10. **Alerta "comissões pendentes" no Dashboard** = **todas** as pendentes, de qualquer mês (regra do web), nas duas plataformas.
11. **Remover código morto e enganoso:**
    - `web/lib/financeiro/ajustes-mensais.ts` e seu teste: confirmado sem uso fora do próprio teste;
    - `web/lib/financeiro/periodo-mensal.ts`;
    - `web/lib/financeiro/fechamentos-mensais.ts`, que fica sem uso;
    - o "+12% vs mês anterior" fixo no mobile;
    - o locale `{ code: 'pt-BR' }` do gráfico mobile. Os rótulos de mês passam a vir de `rotuloMesCurto`, em `shared`.
12. **Fora do escopo da 2A:** ver a seção "Fase 2B" no fim do plano.

### Regras técnicas

- Toda comunicação, comentários e textos de UI em **português**.
- `cd web && npx tsc --noEmit` termina com **zero erros** ao fim de cada task.
- `cd mobile && npx tsc --noEmit` mantém **exatamente os 8 erros pré-existentes** (baseline abaixo) e **nenhum novo**.
  - Em arquivos editados nesta fase, a linha do erro pode mudar. Compare por **arquivo + código TSxxxx**.
  - Se `relatorios.tsx(…) TS2322` sumir por causa da reescrita, o baseline cai para 7, e isso é permitido.
- `cd web && npx vitest run` termina verde ao fim de cada task.
- Todo `.update()`/`.delete()` do Supabase usa `.select('id')` e confere as linhas afetadas. Esta fase não cria updates novos, mas não se deve remover os `.select('id')` existentes.
- Migrations: nenhuma nesta fase. Se alguma for necessária, o dono a aplica à mão no SQL Editor. Nunca `supabase db push`.
- Consultas que podem passar de 1000 linhas usam `buscarTodasPaginas` (`@shared/paginacao`) com ordenação estável terminando em `.order('id')`.
- Proibido declarar outro `async function buscarTodasPaginas` nas telas.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Baseline de erros do `tsc` mobile (não podem aumentar):

```
app/(empresa)/comissoes.tsx(281,130) TS2769
app/(empresa)/configuracoes.tsx(191,7) TS2739
app/(empresa)/configuracoes.tsx(208,7) TS2739
app/(empresa)/estoque.tsx(498,11) TS2322
app/(empresa)/relatorios.tsx(181,22) TS2322     ← linha pode mudar (Task 10); pode sumir
hooks/useAgenda.ts(21,18) TS2430
hooks/useNotificacoes.ts(52,5) TS2322
hooks/useNotificacoes.ts(59,5) TS2322
```

Setup de worktree novo (se ainda não houver `node_modules`):

```bash
cd web && npm install --no-audit --no-fund && cd .. && git checkout -- web/package-lock.json
cd mobile && npm install --no-audit --no-fund --legacy-peer-deps && rm -f package-lock.json
```

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `shared/periodos.ts` (novo) | Limites em Brasília, aritmética de datas em string, lista única de períodos, semana no domingo, rótulos, `getMonthQueryBounds` |
| `shared/kpis-financeiros.ts` (novo) | Tipos de linha, `calcularKpisFinanceiros`, recorte por período, deltas, retiradas, evolução, séries, rankings, formas de pagamento, retorno de clientes, resumos de comissão |
| `shared/kpis-financeiros-consultas.ts` (novo) | `carregarDadosFinanceiros`, `carregarComissoesPendentes`, `carregarClientesComHistoricoAntes`, `carregarRetiradas`, `filtroDespesasDoMes` |
| `web/tests/unit/fixtures/kpis-setembro-2026.ts` (novo) | Fixture com todos os casos de borda (pacote, BRT 21h–23h59, pendentes, fechamento) |
| `web/lib/financeiro/ajustes-mensais.ts` + `web/tests/unit/financeiro-ajustes-mensais.test.ts` | **Apagar** (Task 1) |
| `web/lib/financeiro/periodo-mensal.ts` | Reexporta na Task 1; **apagar** na Task 5 |
| `web/lib/financeiro/fechamentos-mensais.ts` | **Apagar** na Task 12 (sem uso) |
| `web/app/(app)/financeiro/page.tsx` | KPIs, evolução, top serviços, formas de pagamento e retiradas via shared; "Após retiradas" |
| `web/app/(app)/dashboard/page.tsx` | Mês e hoje em Brasília; KPIs, sparkline, comissões e retiradas via shared |
| `web/app/(app)/dashboard/DashboardProfissionalView.tsx` | Fat. hoje e resumo do mês da profissional via shared |
| `web/app/(app)/relatorios/page.tsx` | Períodos únicos, KPIs, deltas, série, rankings e retorno via shared |
| `mobile/hooks/useFinanceiro.ts` + `mobile/app/(empresa)/financeiro.tsx` | Mesma fonte do web; linha de taxas/comissões/líquido |
| `mobile/hooks/useDashboard.ts` + `mobile/app/(empresa)/dashboard.tsx` | Receita do mês e de hoje via shared, delta real, todas as pendentes |
| `mobile/hooks/useRelatorios.ts` + `mobile/app/(empresa)/relatorios.tsx` | Períodos únicos, KPIs e retorno via shared |
| `mobile/hooks/useProfissional.ts`, `mobile/app/(profissional)/agenda.tsx` | Comissão da tabela, Fat. hoje sem pacote/falta, filtro de empresa |
| `web/tests/unit/mobile-dashboard-commissions.test.ts` | Reescrito para a regra "todas as pendentes" |

---

### Task 1: `shared/periodos.ts` — limites em Brasília, períodos únicos, semana no domingo

**Files:**
- Create: `shared/periodos.ts`, `web/tests/unit/shared-periodos.test.ts`
- Modify: `web/lib/financeiro/periodo-mensal.ts` (vira reexportação), `web/tests/unit/financeiro-periodo-mensal.test.ts`
- Delete: `web/lib/financeiro/ajustes-mensais.ts`, `web/tests/unit/financeiro-ajustes-mensais.test.ts`

**Interfaces:**
- Produces (`shared/periodos.ts`):
  - `type Limites = { startIso; endIso; startDate; endDate }`
  - `OFFSET_BRT_MS`
  - `somarDias(dia, n)`, `diasEntre(ini, fim)`, `diaDaSemana(dia)`, `somarMeses(chave, n)`, `ultimoDiaDoMes(chave)`
  - `chaveDiaBRT(valor)`, `chaveMesBRT(valor)`, `hojeBRT(agora?)`
  - `limitesDias(ini, fim)`, `limitesMes(chave)`, `chaveDoMesExibido(mes: Date)`, `getMonthQueryBounds(mes: Date)`
  - `uniaoLimites(a, b)`, `contemInstante(l, ts)`, `contemData(l, dia)`, `mesesDoIntervalo(l)`, `mesesInteirosDoIntervalo(l)`
  - `type PeriodoRelatorio`, `PERIODOS_RELATORIO`, `ROTULO_COMPARACAO`, `type OpcoesPeriodo`, `limitesDoPeriodo(periodo, hoje, opcoes?)`
  - `MESES_ABREV`, `rotuloMesCurto(chave)`, `rotuloDoPeriodo(periodo, l)`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/shared-periodos.test.ts
import { describe, expect, it } from 'vitest';
import {
  limitesMes, limitesDias, getMonthQueryBounds, chaveMesBRT, chaveDiaBRT, hojeBRT,
  contemInstante, contemData, somarMeses, somarDias, ultimoDiaDoMes, uniaoLimites,
  mesesDoIntervalo, mesesInteirosDoIntervalo, limitesDoPeriodo, PERIODOS_RELATORIO,
  rotuloDoPeriodo, rotuloMesCurto, diaDaSemana,
} from '@shared/periodos';

describe('limites do mês em Brasília (UTC−3 fixo)', () => {
  it('setembro/2026 vai de 01/09 00:00 BRT a 30/09 23:59:59.999 BRT', () => {
    expect(limitesMes('2026-09')).toEqual({
      startIso: '2026-09-01T03:00:00.000Z',
      endIso: '2026-10-01T02:59:59.999Z',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
  });
  it('dezembro vira o ano e fevereiro bissexto tem 29 dias', () => {
    expect(limitesMes('2026-12').endIso).toBe('2027-01-01T02:59:59.999Z');
    expect(limitesMes('2028-02').endDate).toBe('2028-02-29');
    expect(ultimoDiaDoMes('2026-02')).toBe('2026-02-28');
  });
  it('getMonthQueryBounds usa o mês exibido na tela (compatível com o antigo web/lib)', () => {
    const b = getMonthQueryBounds(new Date(2026, 0, 15));
    expect(b.startDate).toBe('2026-01-01');
    expect(b.endDate).toBe('2026-01-31');
    expect(b.startIso).toBe('2026-01-01T03:00:00.000Z');
  });
  it('limites de um dia só', () => {
    expect(limitesDias('2026-09-30', '2026-09-30')).toEqual({
      startIso: '2026-09-30T03:00:00.000Z',
      endIso: '2026-10-01T02:59:59.999Z',
      startDate: '2026-09-30',
      endDate: '2026-09-30',
    });
  });
});

describe('fronteira das 21:00–23:59 do último dia do mês (BRT)', () => {
  const set = limitesMes('2026-09');
  it('30/09 21:00 e 23:59:59 BRT ainda são setembro', () => {
    expect(chaveMesBRT('2026-10-01T00:00:00.000Z')).toBe('2026-09');
    expect(chaveMesBRT('2026-10-01T02:59:59+00:00')).toBe('2026-09');
    expect(contemInstante(set, '2026-10-01T02:59:59.999Z')).toBe(true);
  });
  it('01/10 00:00 BRT já é outubro', () => {
    expect(chaveMesBRT('2026-10-01T03:00:00Z')).toBe('2026-10');
    expect(contemInstante(set, '2026-10-01T03:00:00.000Z')).toBe(false);
  });
  it('01/09 antes das 03:00 UTC ainda é agosto', () => {
    expect(chaveMesBRT('2026-09-01T02:59:59Z')).toBe('2026-08');
    expect(contemInstante(set, '2026-09-01T02:59:59Z')).toBe(false);
  });
  it('coluna date (yyyy-MM-dd) não sofre fuso', () => {
    expect(chaveDiaBRT('2026-09-30')).toBe('2026-09-30');
    expect(contemData(set, '2026-09-30')).toBe(true);
    expect(contemData(set, '2026-10-01')).toBe(false);
    expect(contemData(set, null)).toBe(false);
    expect(contemInstante(set, null)).toBe(false);
  });
  it('hojeBRT à 01:00 UTC ainda é o dia anterior', () => {
    expect(hojeBRT(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09-30');
  });
});

describe('aritmética de datas em string', () => {
  it('somarMeses e somarDias atravessam o ano', () => {
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
    expect(somarMeses('2026-12', 1)).toBe('2027-01');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('dia da semana (0 = domingo)', () => {
    expect(diaDaSemana('2026-09-27')).toBe(0);
    expect(diaDaSemana('2026-09-30')).toBe(3);
  });
  it('meses do intervalo e meses cobertos por inteiro', () => {
    const l = limitesDias('2026-07-15', '2026-09-02');
    expect(mesesDoIntervalo(l)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(mesesInteirosDoIntervalo(l)).toEqual(['2026-08']);
    expect(mesesInteirosDoIntervalo(limitesMes('2026-09'))).toEqual(['2026-09']);
  });
  it('união de limites', () => {
    expect(uniaoLimites(limitesMes('2026-09'), limitesMes('2026-08')))
      .toEqual(limitesDias('2026-08-01', '2026-09-30'));
  });
});

describe('períodos dos relatórios — lista única, semana no domingo', () => {
  const hoje = '2026-09-30'; // quarta-feira
  it('lista única nas duas plataformas', () => {
    expect(PERIODOS_RELATORIO.map(p => p.key))
      .toEqual(['hoje', 'semana', 'mes', 'mes_anterior', 'trimestre', 'semestre', 'ano', 'custom']);
  });
  it('hoje × ontem', () => {
    const { atual, anterior } = limitesDoPeriodo('hoje', hoje);
    expect(atual).toEqual(limitesDias('2026-09-30', '2026-09-30'));
    expect(anterior).toEqual(limitesDias('2026-09-29', '2026-09-29'));
  });
  it('semana começa no domingo; deslocamento volta semanas inteiras', () => {
    const { atual, anterior } = limitesDoPeriodo('semana', hoje);
    expect([atual.startDate, atual.endDate]).toEqual(['2026-09-27', '2026-10-03']);
    expect([anterior.startDate, anterior.endDate]).toEqual(['2026-09-20', '2026-09-26']);
    expect(limitesDoPeriodo('semana', hoje, { semanaOffset: -1 }).atual.startDate).toBe('2026-09-20');
    expect(limitesDoPeriodo('semana', '2026-09-27').atual.startDate).toBe('2026-09-27');
  });
  it('mês e mês anterior', () => {
    expect(limitesDoPeriodo('mes', hoje).atual).toEqual(limitesMes('2026-09'));
    expect(limitesDoPeriodo('mes', hoje).anterior).toEqual(limitesMes('2026-08'));
    expect(limitesDoPeriodo('mes_anterior', hoje).atual).toEqual(limitesMes('2026-08'));
    expect(limitesDoPeriodo('mes_anterior', hoje).anterior).toEqual(limitesMes('2026-07'));
  });
  it('3 meses e 6 meses = mês atual + anteriores; comparação com o bloco imediatamente antes', () => {
    const tri = limitesDoPeriodo('trimestre', hoje);
    expect([tri.atual.startDate, tri.atual.endDate]).toEqual(['2026-07-01', '2026-09-30']);
    expect([tri.anterior.startDate, tri.anterior.endDate]).toEqual(['2026-04-01', '2026-06-30']);
    const sem = limitesDoPeriodo('semestre', hoje);
    expect([sem.atual.startDate, sem.atual.endDate]).toEqual(['2026-04-01', '2026-09-30']);
    expect([sem.anterior.startDate, sem.anterior.endDate]).toEqual(['2025-10-01', '2026-03-31']);
  });
  it('ano com deslocamento', () => {
    const { atual, anterior } = limitesDoPeriodo('ano', hoje, { anoOffset: -1 });
    expect([atual.startDate, atual.endDate]).toEqual(['2025-01-01', '2025-12-31']);
    expect([anterior.startDate, anterior.endDate]).toEqual(['2024-01-01', '2024-12-31']);
  });
  it('personalizado: anterior = mesmo nº de dias imediatamente antes; fim limitado a hoje', () => {
    const { atual, anterior } = limitesDoPeriodo('custom', hoje, { custom: { ini: '2026-09-10', fim: '2026-09-19' } });
    expect([atual.startDate, atual.endDate]).toEqual(['2026-09-10', '2026-09-19']);
    expect([anterior.startDate, anterior.endDate]).toEqual(['2026-08-31', '2026-09-09']);
    expect(limitesDoPeriodo('custom', hoje, { custom: { ini: '2026-09-10', fim: '2026-12-01' } }).atual.endDate)
      .toBe('2026-09-30');
    expect(limitesDoPeriodo('custom', hoje, { custom: { ini: '2026-10-05', fim: '2026-09-20' } }).atual.startDate)
      .toBe('2026-09-20');
  });
});

describe('rótulos iguais nas duas plataformas', () => {
  it('rotuloMesCurto e rotuloDoPeriodo', () => {
    expect(rotuloMesCurto('2026-09')).toBe('set');
    expect(rotuloDoPeriodo('mes', limitesMes('2026-09'))).toBe('setembro 2026');
    expect(rotuloDoPeriodo('semana', limitesDias('2026-09-27', '2026-10-03'))).toBe('27/09 – 03/10');
    expect(rotuloDoPeriodo('trimestre', limitesDias('2026-07-01', '2026-09-30'))).toBe('jul – set 2026');
    expect(rotuloDoPeriodo('ano', limitesDias('2026-01-01', '2026-12-31'))).toBe('2026');
    expect(rotuloDoPeriodo('custom', limitesDias('2026-09-10', '2026-09-19'))).toBe('10/09/2026 – 19/09/2026');
    expect(rotuloDoPeriodo('hoje', limitesDias('2026-09-30', '2026-09-30'))).toBe('30/09/2026');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/shared-periodos.test.ts`
Expected: FAIL, com o erro de módulo `@shared/periodos` não encontrado.

- [ ] **Step 3: Criar `shared/periodos.ts`**

```ts
/**
 * @file periodos.ts
 * Limites de período no fuso de Brasília (America/Sao_Paulo). Fonte ÚNICA de
 * web e mobile para Financeiro, Dashboard, Relatórios e área da profissional.
 *
 * O Brasil não tem horário de verão desde 2019: Brasília é UTC−3 fixo. Tudo
 * aqui trabalha com strings 'yyyy-MM-dd' / 'yyyy-MM' e aritmética em UTC, então
 * o resultado NÃO depende do fuso do aparelho nem do servidor (o Dashboard web
 * roda num servidor em UTC). Sem date-fns de propósito: shared/ não tem
 * dependências.
 *
 * Regras de uso:
 * - Colunas timestamptz (data_hora_inicio, created_at, paga_em) filtram por
 *   `startIso` / `endIso` (00:00 BRT do 1º dia até 23:59:59.999 BRT do último).
 * - Colunas date (data_pagamento, data_vencimento, mes, data) filtram por
 *   `startDate` / `endDate`.
 * - A semana começa no DOMINGO nas duas plataformas.
 */

export const OFFSET_BRT_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 86_400_000;

export type Limites = {
  /** 00:00:00.000 BRT do primeiro dia, em ISO UTC (ex.: '2026-09-01T03:00:00.000Z'). */
  startIso: string;
  /** 23:59:59.999 BRT do último dia, em ISO UTC (ex.: '2026-10-01T02:59:59.999Z'). */
  endIso: string;
  /** Primeiro dia 'yyyy-MM-dd' (colunas date). */
  startDate: string;
  /** Último dia 'yyyy-MM-dd' (colunas date). */
  endDate: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

function msDoDia(dia: string): number {
  const [a, m, d] = dia.slice(0, 10).split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}
function diaDoMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Soma `n` dias (pode ser negativo) a 'yyyy-MM-dd'. */
export function somarDias(dia: string, n: number): string {
  return diaDoMs(msDoDia(dia) + n * DIA_MS);
}

/** Nº de dias de `inicio` até `fim` ('2026-09-01' → '2026-09-30' = 29). */
export function diasEntre(inicio: string, fim: string): number {
  return Math.round((msDoDia(fim) - msDoDia(inicio)) / DIA_MS);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(dia: string): number {
  return new Date(msDoDia(dia)).getUTCDay();
}

/** Soma `n` meses a uma chave 'yyyy-MM'. */
export function somarMeses(chave: string, n: number): string {
  const [a, m] = chave.slice(0, 7).split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Último dia 'yyyy-MM-dd' do mês 'yyyy-MM'. */
export function ultimoDiaDoMes(chave: string): string {
  const k = chave.slice(0, 7);
  const [a, m] = k.split('-').map(Number);
  return `${k}-${pad(new Date(Date.UTC(a, m, 0)).getUTCDate())}`;
}

/**
 * Dia 'yyyy-MM-dd' em Brasília. Aceita timestamptz ('2026-10-01T02:30:00+00:00'),
 * Date ou uma data 'yyyy-MM-dd' (devolvida como está — coluna date não tem fuso).
 */
export function chaveDiaBRT(valor: string | Date): string {
  if (typeof valor === 'string' && RE_DIA.test(valor)) return valor;
  const ms = typeof valor === 'string' ? Date.parse(valor) : valor.getTime();
  return diaDoMs(ms - OFFSET_BRT_MS);
}

/** Mês 'yyyy-MM' em Brasília (substitui `timestamp.slice(0, 7)`, que agrupa em UTC). */
export function chaveMesBRT(valor: string | Date): string {
  return chaveDiaBRT(valor).slice(0, 7);
}

/** Hoje em Brasília, 'yyyy-MM-dd'. */
export function hojeBRT(agora: Date = new Date()): string {
  return chaveDiaBRT(agora);
}

/** Limites do dia `inicio` 00:00 BRT até o dia `fim` 23:59:59.999 BRT. */
export function limitesDias(inicio: string, fim: string): Limites {
  return {
    startIso: new Date(msDoDia(inicio) + OFFSET_BRT_MS).toISOString(),
    endIso: new Date(msDoDia(fim) + DIA_MS + OFFSET_BRT_MS - 1).toISOString(),
    startDate: inicio.slice(0, 10),
    endDate: fim.slice(0, 10),
  };
}

/** Limites do mês 'yyyy-MM' em Brasília. */
export function limitesMes(chave: string): Limites {
  const k = chave.slice(0, 7);
  return limitesDias(`${k}-01`, ultimoDiaDoMes(k));
}

/**
 * Chave 'yyyy-MM' do mês que a TELA mostra. `mes` é o Date do seletor de mês
 * (calendário local do aparelho): usa ano/mês locais, sem converter fuso.
 */
export function chaveDoMesExibido(mes: Date): string {
  return `${mes.getFullYear()}-${pad(mes.getMonth() + 1)}`;
}

/** Limites do mês exibido na tela (substitui web/lib/financeiro/periodo-mensal). */
export function getMonthQueryBounds(mes: Date): Limites {
  return limitesMes(chaveDoMesExibido(mes));
}

/** Menor intervalo que contém `a` e `b` (para buscar o período e o anterior numa consulta só). */
export function uniaoLimites(a: Limites, b: Limites): Limites {
  const inicio = a.startDate <= b.startDate ? a.startDate : b.startDate;
  const fim = a.endDate >= b.endDate ? a.endDate : b.endDate;
  return limitesDias(inicio, fim);
}

/** O instante (timestamptz) cai dentro dos limites? */
export function contemInstante(l: Limites, ts: string | null | undefined): boolean {
  if (!ts) return false;
  const ms = Date.parse(ts);
  return ms >= Date.parse(l.startIso) && ms <= Date.parse(l.endIso);
}

/** A data (coluna date 'yyyy-MM-dd') cai dentro dos limites? */
export function contemData(l: Limites, dia: string | null | undefined): boolean {
  if (!dia) return false;
  const d = dia.slice(0, 10);
  return d >= l.startDate && d <= l.endDate;
}

/** Chaves 'yyyy-MM' de todos os meses que o intervalo toca. */
export function mesesDoIntervalo(l: Limites): string[] {
  const out: string[] = [];
  const fim = l.endDate.slice(0, 7);
  for (let k = l.startDate.slice(0, 7); k <= fim; k = somarMeses(k, 1)) out.push(k);
  return out;
}

/** Só os meses que o intervalo cobre do dia 1 ao último dia. */
export function mesesInteirosDoIntervalo(l: Limites): string[] {
  return mesesDoIntervalo(l).filter(k => l.startDate <= `${k}-01` && l.endDate >= ultimoDiaDoMes(k));
}

// ── Períodos dos relatórios (lista ÚNICA web + mobile) ─────────────

export type PeriodoRelatorio =
  | 'hoje' | 'semana' | 'mes' | 'mes_anterior' | 'trimestre' | 'semestre' | 'ano' | 'custom';

export const PERIODOS_RELATORIO: { key: PeriodoRelatorio; label: string }[] = [
  { key: 'hoje',         label: 'Hoje' },
  { key: 'semana',       label: 'Semana' },
  { key: 'mes',          label: 'Mês' },
  { key: 'mes_anterior', label: 'Mês anterior' },
  { key: 'trimestre',    label: '3 meses' },
  { key: 'semestre',     label: '6 meses' },
  { key: 'ano',          label: 'Ano' },
  { key: 'custom',       label: 'Personalizado' },
];

/** Legenda do delta "vs …" de cada período. */
export const ROTULO_COMPARACAO: Record<PeriodoRelatorio, string> = {
  hoje:         'vs ontem',
  semana:       'vs semana anterior',
  mes:          'vs mês anterior',
  mes_anterior: 'vs mês retrasado',
  trimestre:    'vs 3 meses anteriores',
  semestre:     'vs 6 meses anteriores',
  ano:          'vs ano anterior',
  custom:       'vs período anterior',
};

export type OpcoesPeriodo = {
  /** Semanas a partir da atual (0 = esta, −1 = passada). Só em 'semana'. */
  semanaOffset?: number;
  /** Anos a partir do atual. Só em 'ano'. */
  anoOffset?: number;
  /** Intervalo 'yyyy-MM-dd'. Só em 'custom'. */
  custom?: { ini: string; fim: string };
};

function blocoDeMeses(mesAtual: string, n: number): { atual: Limites; anterior: Limites } {
  const ini = somarMeses(mesAtual, -(n - 1));
  const iniAnt = somarMeses(mesAtual, -(2 * n - 1));
  const fimAnt = somarMeses(mesAtual, -n);
  return {
    atual: limitesDias(`${ini}-01`, ultimoDiaDoMes(mesAtual)),
    anterior: limitesDias(`${iniAnt}-01`, ultimoDiaDoMes(fimAnt)),
  };
}

/**
 * Limites do período escolhido e do período anterior equivalente (para os
 * deltas). `hoje` = hojeBRT() — recebido por parâmetro para ser testável.
 */
export function limitesDoPeriodo(
  periodo: PeriodoRelatorio,
  hoje: string,
  opcoes: OpcoesPeriodo = {},
): { atual: Limites; anterior: Limites } {
  const mes = hoje.slice(0, 7);
  switch (periodo) {
    case 'hoje': {
      const ontem = somarDias(hoje, -1);
      return { atual: limitesDias(hoje, hoje), anterior: limitesDias(ontem, ontem) };
    }
    case 'semana': {
      const ref = somarDias(hoje, 7 * (opcoes.semanaOffset ?? 0));
      const ini = somarDias(ref, -diaDaSemana(ref)); // domingo
      return {
        atual: limitesDias(ini, somarDias(ini, 6)),
        anterior: limitesDias(somarDias(ini, -7), somarDias(ini, -1)),
      };
    }
    case 'mes':
      return { atual: limitesMes(mes), anterior: limitesMes(somarMeses(mes, -1)) };
    case 'mes_anterior':
      return { atual: limitesMes(somarMeses(mes, -1)), anterior: limitesMes(somarMeses(mes, -2)) };
    case 'trimestre':
      return blocoDeMeses(mes, 3);
    case 'semestre':
      return blocoDeMeses(mes, 6);
    case 'ano': {
      const a = Number(hoje.slice(0, 4)) + (opcoes.anoOffset ?? 0);
      return {
        atual: limitesDias(`${a}-01-01`, `${a}-12-31`),
        anterior: limitesDias(`${a - 1}-01-01`, `${a - 1}-12-31`),
      };
    }
    case 'custom': {
      let fim = opcoes.custom?.fim || hoje;
      if (fim > hoje) fim = hoje;
      let ini = opcoes.custom?.ini || `${mes}-01`;
      if (ini > fim) ini = fim;
      const duracao = diasEntre(ini, fim) + 1;
      const fimAnt = somarDias(ini, -1);
      return {
        atual: limitesDias(ini, fim),
        anterior: limitesDias(somarDias(fimAnt, -(duracao - 1)), fimAnt),
      };
    }
  }
}

// ── Rótulos (iguais nas duas plataformas) ─────────────────────────

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
export const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'set' para '2026-09' (ou '2026-09-15'). */
export function rotuloMesCurto(chave: string): string {
  return MESES_ABREV[Number(chave.slice(5, 7)) - 1];
}

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ddmmaaaa = (d: string) => `${ddmm(d)}/${d.slice(0, 4)}`;

/** Rótulo do período exibido no cabeçalho dos relatórios. */
export function rotuloDoPeriodo(periodo: PeriodoRelatorio, l: Limites): string {
  switch (periodo) {
    case 'hoje':
      return ddmmaaaa(l.startDate);
    case 'semana':
      return `${ddmm(l.startDate)} – ${ddmm(l.endDate)}`;
    case 'mes':
    case 'mes_anterior':
      return `${MESES[Number(l.startDate.slice(5, 7)) - 1]} ${l.startDate.slice(0, 4)}`;
    case 'trimestre':
    case 'semestre':
      return `${rotuloMesCurto(l.startDate)} – ${rotuloMesCurto(l.endDate)} ${l.endDate.slice(0, 4)}`;
    case 'ano':
      return l.startDate.slice(0, 4);
    case 'custom':
      return `${ddmmaaaa(l.startDate)} – ${ddmmaaaa(l.endDate)}`;
  }
}
```

- [ ] **Step 4: `web/lib/financeiro/periodo-mensal.ts` vira reexportação temporária**

Substitua o conteúdo inteiro por o bloco abaixo. O arquivo é apagado na Task 5, quando o Financeiro web passar a importar de `@shared/periodos`:

```ts
// Temporário: a implementação mora em @shared/periodos (limites em Brasília,
// iguais no web e no mobile). Apagado na Task 5 da Fase 2A.
export { getMonthQueryBounds } from '@shared/periodos';
```

- [ ] **Step 5: Atualizar o teste antigo de período mensal**

Em `web/tests/unit/financeiro-periodo-mensal.test.ts`, troque o import:

```ts
import { getMonthQueryBounds } from '@shared/periodos';
```

- [ ] **Step 6: Apagar o código morto de ajustes mensais**

Confira que ninguém além do próprio teste importa o módulo:

```bash
grep -rn "ajustes-mensais" web mobile shared --include=*.ts --include=*.tsx | grep -v node_modules
```

Expected: só `web/tests/unit/financeiro-ajustes-mensais.test.ts`. Então:

```bash
git rm web/lib/financeiro/ajustes-mensais.ts web/tests/unit/financeiro-ajustes-mensais.test.ts
```

- [ ] **Step 7: Rodar o teste, o tsc e a suíte**

Run:
```bash
cd web && npx vitest run tests/unit/shared-periodos.test.ts tests/unit/financeiro-periodo-mensal.test.ts
cd web && npx tsc --noEmit && npx vitest run
cd ../mobile && npx tsc --noEmit 2>&1 | grep "error TS"
```
Expected: tudo verde; web sem erros; mobile com os 8 erros do baseline.

- [ ] **Step 8: Commit**

```bash
git add shared/periodos.ts web/tests/unit/shared-periodos.test.ts web/lib/financeiro/periodo-mensal.ts web/tests/unit/financeiro-periodo-mensal.test.ts
git commit -m "feat(shared): limites de periodo em Brasilia, lista unica de periodos e semana no domingo" -m "Remove o codigo morto web/lib/financeiro/ajustes-mensais.ts." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `shared/kpis-financeiros.ts` — núcleo dos KPIs do período

**Files:**
- Create: `shared/kpis-financeiros.ts`, `web/tests/unit/fixtures/kpis-setembro-2026.ts`, `web/tests/unit/shared-kpis-financeiros.test.ts`

**Interfaces:**
- Consumes:
  - de `shared/periodos.ts`: `Limites`, `contemInstante`, `contemData`, `chaveMesBRT`, `mesesDoIntervalo`, `mesesInteirosDoIntervalo`;
  - `getFechamentoForMonth` de `shared/fechamentos-mensais.ts`;
  - `retiradasNoPeriodo` e `somaDevolucoesPorRetirada` de `shared/retiradas-socia.ts`.
- Produces:
  - tipos: `Valor`, `AgendamentoFinRow`, `VendaFinRow`, `TaxaPagaFinRow`, `PagamentoFinRow`, `ComissaoFinRow`, `DespesaFinRow`, `DadosFinanceiros`, `KpisFinanceiros`;
  - constantes: `DADOS_VAZIOS`, `KPIS_ZERADOS`;
  - funções:
    - `num(v)`, `arredondar(v)`
    - `ehAtendimentoFaturavel(a)`
    - `recortarDados(d, l)`
    - `calcularKpisFinanceiros(d, l): KpisFinanceiros`
    - `variacaoPercentual(atual, anterior): number | null`
    - `resultadoAposRetiradas(lucro, retiradas)`
    - `retiradasDoPeriodo(rows, devs, l)`
    - `listarRetiradasDoPeriodo(rows, l)`

- [ ] **Step 1: Criar a fixture compartilhada dos testes**

```ts
// web/tests/unit/fixtures/kpis-setembro-2026.ts
import type { AgendamentoFinRow, DadosFinanceiros } from '@shared/kpis-financeiros';

const SERVICOS: Record<string, string> = { s1: 'Limpeza de pele', s2: 'Drenagem' };
const PROFISSIONAIS: Record<string, string> = { p1: 'Ana', p2: 'Bia' };
const CLIENTES: Record<string, string> = { c1: 'Carla', c2: 'Duda', c3: 'Eva', c4: 'Fabi' };

function ag(
  id: string, status: string, valor: number, data_hora_inicio: string,
  pacote_cliente_id: string | null, cliente_id: string, profissional_id: string, servico_id: string,
): AgendamentoFinRow {
  return {
    id, status, valor, data_hora_inicio, pacote_cliente_id, cliente_id, profissional_id, servico_id,
    servico: { nome: SERVICOS[servico_id], categoria: null },
    profissional: { nome: PROFISSIONAIS[profissional_id], foto_url: null },
    cliente: { nome: CLIENTES[cliente_id] },
  };
}

/**
 * Setembro/2026 com os casos de borda da Fase 2A. Totais esperados de setembro:
 * serviços 350 · vendas 130 · taxas canc. 50 · reserva 30 · bruto 560 ·
 * cartão 7,5 · comissões 140 (80 pendentes) · despesas 295,5 · lucro 117 ·
 * atendimentos 3 (2 faturáveis) · ticket 175 · 6 agendamentos, 2 perdidos.
 */
export function fixtureSetembro(): DadosFinanceiros {
  return {
    agendamentos: [
      ag('a1', 'concluido', 200, '2026-09-10T13:00:00Z', null, 'c1', 'p1', 's1'),
      ag('a2', 'concluido', 150, '2026-10-01T02:30:00Z', null, 'c2', 'p2', 's2'),  // 30/09 23:30 BRT → setembro
      ag('a3', 'concluido', 300, '2026-09-12T14:00:00Z', 'pc1', 'c1', 'p1', 's1'), // sessão de pacote: não é receita
      ag('a4', 'faltou',    100, '2026-09-15T14:00:00Z', null, 'c3', 'p1', 's1'),
      ag('a5', 'cancelado',  80, '2026-09-16T14:00:00Z', null, 'c3', 'p2', 's2'),
      ag('a6', 'concluido', 500, '2026-10-01T03:00:00Z', null, 'c2', 'p2', 's2'),  // 01/10 00:00 BRT → outubro
      ag('a7', 'agendado',  120, '2026-09-20T14:00:00Z', null, 'c4', 'p1', 's1'),
    ],
    vendas: [
      { id: 'v1', valor_final: 90, created_at: '2026-09-05T15:00:00Z' },
      { id: 'v2', valor_final: '40.00', created_at: '2026-10-01T02:00:00Z' },       // 30/09 23:00 BRT; valor em string
    ],
    taxasCancelamento: [{ id: 't1', valor: 50, paga_em: '2026-09-18T12:00:00Z' }],
    taxasReserva: [
      { id: 'r1', valor: 30, paga_em: '2026-09-02T12:00:00Z' },
      { id: 'r2', valor: 25, paga_em: '2026-08-31T23:00:00Z' },                     // 31/08 20:00 BRT → agosto
    ],
    pagamentos: [
      { id: 'g1', metodo: 'credito', valor: 200, valor_liquido: 194,  created_at: '2026-09-10T13:30:00Z' },
      { id: 'g2', metodo: 'pix',     valor: 150, valor_liquido: null, created_at: '2026-10-01T02:40:00Z' },
      { id: 'g3', metodo: 'debito',  valor: 90,  valor_liquido: 88.5, created_at: '2026-09-05T15:05:00Z' },
    ],
    comissoes: [
      { id: 'k1', profissional_id: 'p1', valor_comissao: 80, status: 'pendente', created_at: '2026-09-10T13:30:00Z' },
      { id: 'k2', profissional_id: 'p2', valor_comissao: 60, status: 'pago',     created_at: '2026-10-01T02:45:00Z' },
    ],
    despesas: [
      { id: 'd1', valor: 250,  categoria: 'Aluguel', status: 'pago',     data_pagamento: '2026-09-05' },
      { id: 'd2', valor: 45.5, categoria: 'Energia', status: 'pago',     data_pagamento: '2026-09-30' },
      { id: 'd3', valor: 999,  categoria: 'Outros',  status: 'pago',     data_pagamento: '2026-10-01' },
      { id: 'd4', valor: 300,  categoria: 'Outros',  status: 'pendente', data_pagamento: null },
      { id: 'd5', valor: 77,   categoria: 'Outros',  status: 'pendente', data_pagamento: '2026-09-20' },
    ],
    fechamentos: [],
  };
}
```

- [ ] **Step 2: Escrever o teste que falha**

```ts
// web/tests/unit/shared-kpis-financeiros.test.ts
import { describe, expect, it } from 'vitest';
import { limitesDias, limitesMes, uniaoLimites } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, variacaoPercentual, resultadoAposRetiradas,
  retiradasDoPeriodo, listarRetiradasDoPeriodo, ehAtendimentoFaturavel, DADOS_VAZIOS, KPIS_ZERADOS,
} from '@shared/kpis-financeiros';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const SET = limitesMes('2026-09');

describe('calcularKpisFinanceiros — setembro/2026', () => {
  const k = calcularKpisFinanceiros(fixtureSetembro(), SET);

  it('bruto = serviços concluídos sem pacote + vendas + taxas pagas (pagamentos não entram)', () => {
    expect(k.receitaServicos).toBe(350);
    expect(k.receitaVendas).toBe(130);
    expect(k.receitaTaxasCancelamento).toBe(50);
    expect(k.receitaTaxasReserva).toBe(30);
    expect(k.bruto).toBe(560);
  });
  it('taxa de cartão só onde há valor_liquido', () => {
    expect(k.taxasCartao).toBe(7.5);
    expect(k.liquidoAposTaxas).toBe(552.5);
  });
  it('comissões da tabela comissoes, por created_at em Brasília', () => {
    expect(k.comissoes).toBe(140);
    expect(k.comissoesPendentes).toBe(80);
  });
  it('despesas: só pagas, por data_pagamento (pendente fica fora mesmo com data)', () => {
    expect(k.despesas).toBe(295.5);
  });
  it('lucro = bruto − cartão − comissões − despesas', () => {
    expect(k.lucro).toBe(117);
  });
  it('ticket médio = serviços sem pacote ÷ atendimentos sem pacote', () => {
    expect(k.atendimentos).toBe(3);
    expect(k.atendimentosFaturaveis).toBe(2);
    expect(k.ticketMedio).toBe(175);
  });
  it('cancelamento e comparecimento', () => {
    expect(k.totalAgendamentos).toBe(6);
    expect(k.cancelados).toBe(1);
    expect(k.faltas).toBe(1);
    expect(k.perdidos).toBe(2);
    expect(k.pctCancelamento).toBeCloseTo(33.33, 2);
    expect(k.pctComparecimento).toBe(75);
    expect(k.mesesComFechamento).toEqual([]);
  });
});

describe('fronteira de Brasília no último dia do mês', () => {
  it('outubro só recebe o que começou a partir de 01/10 00:00 BRT', () => {
    const k = calcularKpisFinanceiros(fixtureSetembro(), limitesMes('2026-10'));
    expect(k.bruto).toBe(500);
    expect(k.taxasCartao).toBe(0);
    expect(k.comissoes).toBe(0);
    expect(k.despesas).toBe(999);
    expect(k.lucro).toBe(-499);
  });
  it('agosto recebe a reserva paga em 31/08 20:00 BRT (23:00 UTC)', () => {
    expect(calcularKpisFinanceiros(fixtureSetembro(), limitesMes('2026-08')).bruto).toBe(25);
  });
});

describe('fechamento mensal importado', () => {
  const comFechamento = (...linhas: { mes: string; receita_bruta: number; comissao_paga: number }[]) =>
    ({ ...fixtureSetembro(), fechamentos: linhas });

  it('substitui receita e comissão do mês inteiro e zera a taxa de cartão', () => {
    const k = calcularKpisFinanceiros(comFechamento({ mes: '2026-09-01', receita_bruta: 1000, comissao_paga: 300 }), SET);
    expect(k.bruto).toBe(1000);
    expect(k.comissoes).toBe(300);
    expect(k.taxasCartao).toBe(0);
    expect(k.despesas).toBe(295.5);
    expect(k.lucro).toBe(404.5);
    expect(k.mesesComFechamento).toEqual(['2026-09']);
    expect(k.receitaServicos).toBe(350); // detalhamento continua ao vivo
    expect(k.ticketMedio).toBe(175);
  });
  it('período parcial do mês importado usa o cálculo ao vivo', () => {
    const k = calcularKpisFinanceiros(
      comFechamento({ mes: '2026-09-01', receita_bruta: 1000, comissao_paga: 300 }),
      limitesDias('2026-09-01', '2026-09-15'),
    );
    expect(k.bruto).toBe(320);
    expect(k.lucro).toBe(-17.5);
    expect(k.mesesComFechamento).toEqual([]);
  });
  it('vários meses: importado onde há fechamento, ao vivo nos demais', () => {
    const k = calcularKpisFinanceiros(
      comFechamento({ mes: '2026-08-01', receita_bruta: 700, comissao_paga: 200 }),
      limitesDias('2026-08-01', '2026-09-30'),
    );
    expect(k.bruto).toBe(1260);
    expect(k.comissoes).toBe(340);
    expect(k.taxasCartao).toBe(7.5);
    expect(k.lucro).toBe(617);
    expect(k.mesesComFechamento).toEqual(['2026-08']);
  });
});

describe('recorte e casos vazios', () => {
  it('período vazio → tudo zero', () => {
    expect(calcularKpisFinanceiros(DADOS_VAZIOS, SET)).toEqual(KPIS_ZERADOS);
  });
  it('o resultado não depende do tamanho da janela buscada', () => {
    const superconjunto = fixtureSetembro();
    const recortado = recortarDados(superconjunto, uniaoLimites(limitesMes('2026-08'), SET));
    expect(calcularKpisFinanceiros(recortado, SET)).toEqual(calcularKpisFinanceiros(superconjunto, SET));
  });
  it('recortarDados tira o que está fora e as despesas pendentes', () => {
    const r = recortarDados(fixtureSetembro(), SET);
    expect(r.agendamentos.map(a => a.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a7']);
    expect(r.despesas.map(d => d.id)).toEqual(['d1', 'd2']);
    expect(r.taxasReserva.map(t => t.id)).toEqual(['r1']);
  });
  it('ehAtendimentoFaturavel', () => {
    expect(ehAtendimentoFaturavel({ status: 'concluido', pacote_cliente_id: null })).toBe(true);
    expect(ehAtendimentoFaturavel({ status: 'concluido', pacote_cliente_id: 'pc' })).toBe(false);
    expect(ehAtendimentoFaturavel({ status: 'faltou', pacote_cliente_id: null })).toBe(false);
  });
});

describe('variacaoPercentual (deltas vs período anterior)', () => {
  it('arredonda para inteiro', () => {
    expect(variacaoPercentual(110, 100)).toBe(10);
    expect(variacaoPercentual(90, 100)).toBe(-10);
  });
  it('base zero → null', () => {
    expect(variacaoPercentual(50, 0)).toBeNull();
    expect(variacaoPercentual(0, 0)).toBeNull();
  });
  it('base negativa (lucro) usa o módulo: melhorar é positivo', () => {
    expect(variacaoPercentual(-50, -100)).toBe(50);
    expect(variacaoPercentual(100, -100)).toBe(200);
  });
});

describe('retiradas da dona', () => {
  const rows = [
    { id: 'x', tipo: 'retirada' as const, valor: 50, data: '2026-09-10', convertido_em: null },
    { id: 'y', tipo: 'emprestimo' as const, valor: 200, data: '2026-08-01', convertido_em: '2026-09-20' },
    { id: 'z', tipo: 'retirada' as const, valor: 70, data: '2026-10-02', convertido_em: null },
  ];
  const devs = [{ retirada_id: 'y', valor: 80 }];
  it('retiradas do período = retiradas + empréstimos convertidos (saldo em aberto)', () => {
    expect(retiradasDoPeriodo(rows, devs, SET)).toBe(170);
  });
  it('após retiradas = lucro − retiradas', () => {
    expect(resultadoAposRetiradas(117, 170)).toBe(-53);
  });
  it('lista do período = data ou conversão no período, mais recente primeiro', () => {
    expect(listarRetiradasDoPeriodo(rows, SET).map(r => r.id)).toEqual(['x', 'y']);
  });
});
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/shared-kpis-financeiros.test.ts`
Expected: FAIL, com o erro de módulo `@shared/kpis-financeiros` não encontrado.

- [ ] **Step 4: Criar `shared/kpis-financeiros.ts`**

```ts
/**
 * @file kpis-financeiros.ts
 * Números financeiros ÚNICOS de web e mobile: Financeiro, Dashboard,
 * Relatórios e área da profissional. As telas buscam as linhas com
 * kpis-financeiros-consultas.ts e chamam estas funções — nenhuma tela soma
 * receita, comissão ou lucro por conta própria.
 *
 * Regras (decisões do dono, 2026-09-30):
 * - Faturamento bruto = atendimentos 'concluido' SEM sessão de pacote
 *   (agendamentos.valor, data = data_hora_inicio) + vendas avulsas
 *   (valor_final, created_at) + taxas de cancelamento pagas (paga_em) + taxas
 *   de reserva com paga_em (inclui as retidas depois de pagas).
 *   `pagamentos` NÃO é receita: só taxa de cartão e formas de pagamento.
 * - Taxa de cartão = Σ (pagamentos.valor − valor_liquido) quando há valor_liquido.
 * - Comissões = tabela `comissoes` (valor gerado), datada por created_at.
 *   Nunca recalcular pelo percentual_comissao atual.
 * - Despesas = só status 'pago', datadas por data_pagamento.
 * - Lucro = bruto − taxa de cartão − comissões − despesas.
 * - Fechamento importado (financeiro_ajustes_mensais) substitui receita E
 *   comissão do mês e zera a taxa de cartão — só nos meses que o período
 *   cobre por inteiro. Despesas nunca vêm do fechamento.
 * - Ticket médio = receita de serviços sem pacote ÷ atendimentos sem pacote.
 * - Datas em Brasília (ver periodos.ts). Toda função recorta as linhas pelos
 *   limites recebidos: o resultado não depende da janela que a tela buscou.
 */
import {
  type Limites, contemInstante, contemData, chaveMesBRT, mesesDoIntervalo, mesesInteirosDoIntervalo,
} from './periodos';
import { type FinanceiroFechamentoRow, getFechamentoForMonth } from './fechamentos-mensais';
import {
  type RetiradaSociaRow, type RetiradaSociaDevolucaoRow, retiradasNoPeriodo, somaDevolucoesPorRetirada,
} from './retiradas-socia';

// ── Linhas (formato mínimo que as consultas trazem) ────────────────

/** numeric do Postgres pode chegar como number ou string. */
export type Valor = number | string | null | undefined;

export type AgendamentoFinRow = {
  id: string;
  valor: Valor;
  status: string;
  data_hora_inicio: string;
  pacote_cliente_id: string | null;
  cliente_id: string | null;
  profissional_id: string | null;
  servico_id: string | null;
  servico?: { nome: string; categoria?: string | null } | null;
  profissional?: { nome: string; foto_url?: string | null } | null;
  cliente?: { nome: string } | null;
};
export type VendaFinRow = { id: string; valor_final: Valor; created_at: string };
export type TaxaPagaFinRow = { id: string; valor: Valor; paga_em: string | null };
export type PagamentoFinRow = { id: string; metodo: string; valor: Valor; valor_liquido: Valor; created_at: string };
export type ComissaoFinRow = { id: string; profissional_id: string; valor_comissao: Valor; status: string; created_at: string };
export type DespesaFinRow = { id: string; valor: Valor; categoria: string | null; status: string; data_pagamento: string | null };

export type DadosFinanceiros = {
  agendamentos: AgendamentoFinRow[];
  vendas: VendaFinRow[];
  taxasCancelamento: TaxaPagaFinRow[];
  taxasReserva: TaxaPagaFinRow[];
  pagamentos: PagamentoFinRow[];
  comissoes: ComissaoFinRow[];
  despesas: DespesaFinRow[];
  fechamentos: FinanceiroFechamentoRow[];
};

export const DADOS_VAZIOS: DadosFinanceiros = {
  agendamentos: [], vendas: [], taxasCancelamento: [], taxasReserva: [],
  pagamentos: [], comissoes: [], despesas: [], fechamentos: [],
};

export type KpisFinanceiros = {
  receitaServicos: number;
  receitaVendas: number;
  receitaTaxasCancelamento: number;
  receitaTaxasReserva: number;
  /** Faturamento bruto (com fechamento importado aplicado). */
  bruto: number;
  taxasCartao: number;
  liquidoAposTaxas: number;
  comissoes: number;
  /** Comissões geradas no período ainda não pagas (ao vivo). */
  comissoesPendentes: number;
  despesas: number;
  lucro: number;
  /** Concluídos, inclusive sessões de pacote. */
  atendimentos: number;
  /** Concluídos sem pacote (base do ticket médio). */
  atendimentosFaturaveis: number;
  ticketMedio: number;
  totalAgendamentos: number;
  cancelados: number;
  faltas: number;
  perdidos: number;
  /** (cancelados + faltas) ÷ todos os agendamentos do período × 100. */
  pctCancelamento: number;
  /** concluídos ÷ (concluídos + faltas) × 100. */
  pctComparecimento: number;
  /** Meses ('yyyy-MM') em que o fechamento importado substituiu o cálculo ao vivo. */
  mesesComFechamento: string[];
};

export const KPIS_ZERADOS: KpisFinanceiros = {
  receitaServicos: 0, receitaVendas: 0, receitaTaxasCancelamento: 0, receitaTaxasReserva: 0,
  bruto: 0, taxasCartao: 0, liquidoAposTaxas: 0, comissoes: 0, comissoesPendentes: 0,
  despesas: 0, lucro: 0, atendimentos: 0, atendimentosFaturaveis: 0, ticketMedio: 0,
  totalAgendamentos: 0, cancelados: 0, faltas: 0, perdidos: 0,
  pctCancelamento: 0, pctComparecimento: 0, mesesComFechamento: [],
};

// ── Utilitários ────────────────────────────────────────────────────

export function num(v: Valor): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

export function arredondar(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Atendimento que é receita: concluído e NÃO é sessão de pacote (já paga na venda do pacote). */
export function ehAtendimentoFaturavel(a: Pick<AgendamentoFinRow, 'status' | 'pacote_cliente_id'>): boolean {
  return a.status === 'concluido' && !a.pacote_cliente_id;
}

/** Mantém só as linhas dentro dos limites (e só despesas pagas). */
export function recortarDados(d: DadosFinanceiros, l: Limites): DadosFinanceiros {
  return {
    agendamentos: d.agendamentos.filter(a => contemInstante(l, a.data_hora_inicio)),
    vendas: d.vendas.filter(v => contemInstante(l, v.created_at)),
    taxasCancelamento: d.taxasCancelamento.filter(t => contemInstante(l, t.paga_em)),
    taxasReserva: d.taxasReserva.filter(t => contemInstante(l, t.paga_em)),
    pagamentos: d.pagamentos.filter(p => contemInstante(l, p.created_at)),
    comissoes: d.comissoes.filter(c => contemInstante(l, c.created_at)),
    despesas: d.despesas.filter(x => x.status === 'pago' && contemData(l, x.data_pagamento)),
    fechamentos: d.fechamentos,
  };
}

function somarEm(mapa: Record<string, number>, chave: string, valor: number) {
  mapa[chave] = (mapa[chave] ?? 0) + valor;
}

function taxaDeCartao(p: PagamentoFinRow): number {
  return p.valor_liquido == null ? 0 : num(p.valor) - num(p.valor_liquido);
}

// ── KPIs do período ────────────────────────────────────────────────

export function calcularKpisFinanceiros(dados: DadosFinanceiros, l: Limites): KpisFinanceiros {
  const d = recortarDados(dados, l);
  const concluidos = d.agendamentos.filter(a => a.status === 'concluido');
  const faturaveis = concluidos.filter(a => !a.pacote_cliente_id);
  const faltas = d.agendamentos.filter(a => a.status === 'faltou').length;
  const cancelados = d.agendamentos.filter(a => a.status === 'cancelado').length;

  const receitaServicos = faturaveis.reduce((s, a) => s + num(a.valor), 0);
  const receitaVendas = d.vendas.reduce((s, v) => s + num(v.valor_final), 0);
  const receitaTaxasCancelamento = d.taxasCancelamento.reduce((s, t) => s + num(t.valor), 0);
  const receitaTaxasReserva = d.taxasReserva.reduce((s, t) => s + num(t.valor), 0);

  // Mês a mês (Brasília), para aplicar o fechamento importado onde houver.
  const receitaMes: Record<string, number> = {};
  const comissaoMes: Record<string, number> = {};
  const cartaoMes: Record<string, number> = {};
  faturaveis.forEach(a => somarEm(receitaMes, chaveMesBRT(a.data_hora_inicio), num(a.valor)));
  d.vendas.forEach(v => somarEm(receitaMes, chaveMesBRT(v.created_at), num(v.valor_final)));
  d.taxasCancelamento.forEach(t => somarEm(receitaMes, chaveMesBRT(t.paga_em as string), num(t.valor)));
  d.taxasReserva.forEach(t => somarEm(receitaMes, chaveMesBRT(t.paga_em as string), num(t.valor)));
  d.comissoes.forEach(c => somarEm(comissaoMes, chaveMesBRT(c.created_at), num(c.valor_comissao)));
  d.pagamentos.forEach(p => somarEm(cartaoMes, chaveMesBRT(p.created_at), taxaDeCartao(p)));

  const inteiros = new Set(mesesInteirosDoIntervalo(l));
  let bruto = 0;
  let comissoes = 0;
  let taxasCartao = 0;
  const mesesComFechamento: string[] = [];
  for (const k of mesesDoIntervalo(l)) {
    const fechamento = inteiros.has(k) ? getFechamentoForMonth(d.fechamentos, k) : null;
    if (fechamento) {
      bruto += fechamento.receitaBruta;
      comissoes += fechamento.comissao;
      mesesComFechamento.push(k);
      continue;
    }
    bruto += receitaMes[k] ?? 0;
    comissoes += comissaoMes[k] ?? 0;
    taxasCartao += cartaoMes[k] ?? 0;
  }

  const despesas = d.despesas.reduce((s, x) => s + num(x.valor), 0);
  const comissoesPendentes = d.comissoes
    .filter(c => c.status === 'pendente')
    .reduce((s, c) => s + num(c.valor_comissao), 0);
  const totalAgendamentos = d.agendamentos.length;
  const perdidos = cancelados + faltas;
  const baseComparecimento = concluidos.length + faltas;

  return {
    receitaServicos: arredondar(receitaServicos),
    receitaVendas: arredondar(receitaVendas),
    receitaTaxasCancelamento: arredondar(receitaTaxasCancelamento),
    receitaTaxasReserva: arredondar(receitaTaxasReserva),
    bruto: arredondar(bruto),
    taxasCartao: arredondar(taxasCartao),
    liquidoAposTaxas: arredondar(bruto - taxasCartao),
    comissoes: arredondar(comissoes),
    comissoesPendentes: arredondar(comissoesPendentes),
    despesas: arredondar(despesas),
    lucro: arredondar(bruto - taxasCartao - comissoes - despesas),
    atendimentos: concluidos.length,
    atendimentosFaturaveis: faturaveis.length,
    ticketMedio: faturaveis.length > 0 ? arredondar(receitaServicos / faturaveis.length) : 0,
    totalAgendamentos,
    cancelados,
    faltas,
    perdidos,
    pctCancelamento: totalAgendamentos > 0 ? (perdidos / totalAgendamentos) * 100 : 0,
    pctComparecimento: baseComparecimento > 0 ? (concluidos.length / baseComparecimento) * 100 : 0,
    mesesComFechamento,
  };
}

/**
 * Variação % inteira de `atual` sobre `anterior`. `null` com base zero (a tela
 * esconde o delta). Base negativa (lucro) usa o módulo: melhorar é positivo.
 */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 100);
}

// ── Retiradas da dona ──────────────────────────────────────────────

/** "Após retiradas" = lucro − retiradas da dona no período. */
export function resultadoAposRetiradas(lucro: number, retiradas: number): number {
  return arredondar(lucro - retiradas);
}

/** Total que conta como retirada da dona nos limites (ver retiradasNoPeriodo). */
export function retiradasDoPeriodo(
  rows: Pick<RetiradaSociaRow, 'id' | 'tipo' | 'valor' | 'data' | 'convertido_em'>[],
  devs: Pick<RetiradaSociaDevolucaoRow, 'retirada_id' | 'valor'>[],
  l: Limites,
): number {
  return retiradasNoPeriodo(rows, somaDevolucoesPorRetirada(devs), l.startDate, l.endDate);
}

/** Retiradas para a LISTA do período (data ou conversão dentro), mais recentes primeiro. */
export function listarRetiradasDoPeriodo<T extends Pick<RetiradaSociaRow, 'data' | 'convertido_em'>>(
  rows: T[],
  l: Limites,
): T[] {
  return rows
    .filter(r => contemData(l, r.data) || contemData(l, r.convertido_em))
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}
```

- [ ] **Step 5: Rodar o teste, o tsc e a suíte**

Run: `cd web && npx vitest run tests/unit/shared-kpis-financeiros.test.ts && npx tsc --noEmit && npx vitest run`
Expected: tudo verde, zero erros.

- [ ] **Step 6: Commit**

```bash
git add shared/kpis-financeiros.ts web/tests/unit/fixtures/kpis-setembro-2026.ts web/tests/unit/shared-kpis-financeiros.test.ts
git commit -m "feat(shared): KPIs financeiros unicos (bruto, cartao, comissoes, despesas, lucro, ticket, fechamento)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `shared/kpis-financeiros.ts` — evolução, séries, rankings, clientes e comissões

**Files:**
- Modify: `shared/kpis-financeiros.ts`
- Create: `web/tests/unit/shared-kpis-financeiros-series.test.ts`

**Interfaces:**
- Produces:
  - `evolucaoMensal(dados, chaves): PontoEvolucao[]`, com `{ chave, rotulo, bruto, comissoes, despesas, taxasCartao, lucro }`
  - `serieFaturamento(dados, l): PontoSerie[]`, com `{ chave, rotulo, valor }`. A granularidade é dia até 10 dias, semana (domingo) até 45 dias e mês acima disso.
  - `receitaAcumuladaPorDia(dados, l, ateDia): number[]`
  - `rankingAtendimentos(ags, por: 'servico'|'profissional'|'cliente'): ItemRanking[]`, com `{ chave, nome, quantidade, receita, percentual }`
  - `resumoMetodosPagamento(pags): ResumoMetodo[]`
  - `clientesAtendidosNoPeriodo(ags): string[]`
  - `metricasRetorno(ags, comHistoricoAntes): { atendidas, retornaram, novas, pctRetorno }`
  - `resumoComissoesPendentes(rows): { quantidade, total }`
  - `resumoComissoesProfissional(rows): { faturamentoBruto, comissaoTotal, comissaoPaga, comissaoPendente, atendimentos, comissaoMedia }`
  - `faturamentoPrevistoDia(ags): number`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/shared-kpis-financeiros-series.test.ts
import { describe, expect, it } from 'vitest';
import { limitesDias, limitesMes } from '@shared/periodos';
import {
  evolucaoMensal, serieFaturamento, receitaAcumuladaPorDia, rankingAtendimentos,
  resumoMetodosPagamento, clientesAtendidosNoPeriodo, metricasRetorno, recortarDados,
  resumoComissoesPendentes, resumoComissoesProfissional, faturamentoPrevistoDia,
} from '@shared/kpis-financeiros';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const SET = limitesMes('2026-09');
const doMes = () => recortarDados(fixtureSetembro(), SET);

describe('evolucaoMensal (gráfico de 6 meses do Financeiro, web e mobile)', () => {
  it('um ponto por mês, com rótulo pt-BR e as mesmas regras do KPI', () => {
    expect(evolucaoMensal(fixtureSetembro(), ['2026-08', '2026-09', '2026-10'])).toEqual([
      { chave: '2026-08', rotulo: 'ago', bruto: 25,  comissoes: 0,   despesas: 0,     taxasCartao: 0,   lucro: 25 },
      { chave: '2026-09', rotulo: 'set', bruto: 560, comissoes: 140, despesas: 295.5, taxasCartao: 7.5, lucro: 117 },
      { chave: '2026-10', rotulo: 'out', bruto: 500, comissoes: 0,   despesas: 999,   taxasCartao: 0,   lucro: -499 },
    ]);
  });
});

describe('serieFaturamento (gráfico dos Relatórios)', () => {
  it('mês → semanas começando no domingo, soma = bruto do período', () => {
    const serie = serieFaturamento(fixtureSetembro(), SET);
    expect(serie.map(p => p.chave)).toEqual(['2026-09-01', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
    expect(serie.map(p => p.rotulo)).toEqual(['01/09', '06/09', '13/09', '20/09', '27/09']);
    expect(serie.map(p => p.valor)).toEqual([120, 200, 50, 0, 190]);
  });
  it('um dia → um ponto diário', () => {
    expect(serieFaturamento(fixtureSetembro(), limitesDias('2026-09-30', '2026-09-30')))
      .toEqual([{ chave: '2026-09-30', rotulo: '30/09', valor: 190 }]);
  });
  it('ano → meses, com fechamento importado no mês inteiro', () => {
    const ano = limitesDias('2026-01-01', '2026-12-31');
    const serie = serieFaturamento(fixtureSetembro(), ano);
    expect(serie).toHaveLength(12);
    expect(serie[7]).toEqual({ chave: '2026-08', rotulo: 'ago', valor: 25 });
    expect(serie[8].valor).toBe(560);
    const comFech = { ...fixtureSetembro(), fechamentos: [{ mes: '2026-09-01', receita_bruta: 1000, comissao_paga: 300 }] };
    expect(serieFaturamento(comFech, ano)[8].valor).toBe(1000);
  });
});

describe('receitaAcumuladaPorDia (sparkline do Dashboard)', () => {
  it('acumula o bruto dia a dia até o dia pedido', () => {
    expect(receitaAcumuladaPorDia(fixtureSetembro(), SET, '2026-09-05')).toEqual([0, 30, 30, 30, 120]);
  });
});

describe('rankingAtendimentos', () => {
  it('por serviço: quantidade conta todos os concluídos, receita só os sem pacote', () => {
    expect(rankingAtendimentos(doMes().agendamentos, 'servico')).toEqual([
      { chave: 's1', nome: 'Limpeza de pele', quantidade: 2, receita: 200, percentual: 100 },
      { chave: 's2', nome: 'Drenagem',        quantidade: 1, receita: 150, percentual: 75 },
    ]);
  });
  it('por profissional e por cliente', () => {
    expect(rankingAtendimentos(doMes().agendamentos, 'profissional').map(r => [r.nome, r.quantidade, r.receita]))
      .toEqual([['Ana', 2, 200], ['Bia', 1, 150]]);
    expect(rankingAtendimentos(doMes().agendamentos, 'cliente').map(r => [r.nome, r.quantidade, r.receita]))
      .toEqual([['Carla', 2, 200], ['Duda', 1, 150]]);
  });
  it('sem atendimentos → lista vazia', () => {
    expect(rankingAtendimentos([], 'servico')).toEqual([]);
  });
});

describe('resumoMetodosPagamento', () => {
  it('agrupa por método, % sobre o total, maior primeiro', () => {
    expect(resumoMetodosPagamento(doMes().pagamentos)).toEqual([
      { metodo: 'credito', valor: 200, quantidade: 1, percentual: 45 },
      { metodo: 'pix',     valor: 150, quantidade: 1, percentual: 34 },
      { metodo: 'debito',  valor: 90,  quantidade: 1, percentual: 20 },
    ]);
  });
});

describe('clientes que retornaram (regra única: atendida no período E antes dele)', () => {
  it('clientes atendidas no período (concluídos, com ou sem pacote)', () => {
    expect(clientesAtendidosNoPeriodo(doMes().agendamentos)).toEqual(['c1', 'c2']);
  });
  it('retornaram = já tinham atendimento concluído antes do período', () => {
    expect(metricasRetorno(doMes().agendamentos, new Set(['c1', 'c9'])))
      .toEqual({ atendidas: 2, retornaram: 1, novas: 1, pctRetorno: 50 });
  });
  it('período vazio', () => {
    expect(metricasRetorno([], [])).toEqual({ atendidas: 0, retornaram: 0, novas: 0, pctRetorno: 0 });
  });
});

describe('comissões', () => {
  it('pendentes (alerta do Dashboard): quantidade e total', () => {
    expect(resumoComissoesPendentes([{ valor_comissao: 80 }, { valor_comissao: '20.5' }]))
      .toEqual({ quantidade: 2, total: 100.5 });
  });
  it('resumo da profissional (área da profissional, web e mobile)', () => {
    expect(resumoComissoesProfissional([
      { valor_servico: 200, valor_comissao: 80, status: 'pendente' },
      { valor_servico: 150, valor_comissao: 60, status: 'pago' },
    ])).toEqual({
      faturamentoBruto: 350, comissaoTotal: 140, comissaoPaga: 60, comissaoPendente: 80,
      atendimentos: 2, comissaoMedia: 70,
    });
  });
});

describe('faturamentoPrevistoDia (Fat. hoje da profissional)', () => {
  it('ignora cancelados, faltas e sessões de pacote', () => {
    expect(faturamentoPrevistoDia([
      { valor: 100, status: 'agendado',   pacote_cliente_id: null },
      { valor: 50,  status: 'concluido',  pacote_cliente_id: null },
      { valor: 70,  status: 'faltou',     pacote_cliente_id: null },
      { valor: 40,  status: 'cancelado',  pacote_cliente_id: null },
      { valor: 300, status: 'confirmado', pacote_cliente_id: 'pc' },
    ])).toBe(150);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/shared-kpis-financeiros-series.test.ts`
Expected: FAIL (`evolucaoMensal` e os demais não são exportados).

- [ ] **Step 3: Ampliar o import de `./periodos`**

Em `shared/kpis-financeiros.ts`, substitua a linha de import de `./periodos` por:

```ts
import {
  type Limites, contemInstante, contemData, chaveMesBRT, mesesDoIntervalo, mesesInteirosDoIntervalo,
  limitesDias, limitesMes, somarDias, diasEntre, diaDaSemana, ultimoDiaDoMes, rotuloMesCurto,
} from './periodos';
```

- [ ] **Step 4: Acrescentar ao fim de `shared/kpis-financeiros.ts`**

```ts
// ── Séries ─────────────────────────────────────────────────────────

export type PontoEvolucao = {
  chave: string; rotulo: string;
  bruto: number; comissoes: number; despesas: number; taxasCartao: number; lucro: number;
};

/** Evolução mês a mês (gráfico do Financeiro). Cada ponto = calcularKpisFinanceiros do mês. */
export function evolucaoMensal(dados: DadosFinanceiros, chaves: string[]): PontoEvolucao[] {
  return chaves.map(chave => {
    const k = calcularKpisFinanceiros(dados, limitesMes(chave));
    return {
      chave, rotulo: rotuloMesCurto(chave),
      bruto: k.bruto, comissoes: k.comissoes, despesas: k.despesas, taxasCartao: k.taxasCartao, lucro: k.lucro,
    };
  });
}

export type PontoSerie = { chave: string; rotulo: string; valor: number };

const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/**
 * Faturamento bruto do período em buckets: até 10 dias → por dia; até 45 dias
 * → por semana (domingo a sábado, recortada ao período); acima → por mês.
 * Cada bucket usa calcularKpisFinanceiros (inclui vendas e taxas; fechamento
 * importado só em mês inteiro).
 */
export function serieFaturamento(dados: DadosFinanceiros, l: Limites): PontoSerie[] {
  const dias = diasEntre(l.startDate, l.endDate) + 1;
  const bruto = (ini: string, fim: string) => calcularKpisFinanceiros(dados, limitesDias(ini, fim)).bruto;
  const pontos: PontoSerie[] = [];

  if (dias <= 10) {
    for (let i = 0; i < dias; i++) {
      const dia = somarDias(l.startDate, i);
      pontos.push({ chave: dia, rotulo: ddmm(dia), valor: bruto(dia, dia) });
    }
    return pontos;
  }

  if (dias <= 45) {
    let ini = l.startDate;
    while (ini <= l.endDate) {
      const sabado = somarDias(ini, 6 - diaDaSemana(ini));
      const fim = sabado < l.endDate ? sabado : l.endDate;
      pontos.push({ chave: ini, rotulo: ddmm(ini), valor: bruto(ini, fim) });
      ini = somarDias(fim, 1);
    }
    return pontos;
  }

  for (const k of mesesDoIntervalo(l)) {
    const primeiro = `${k}-01`;
    const ultimo = ultimoDiaDoMes(k);
    const ini = primeiro > l.startDate ? primeiro : l.startDate;
    const fim = ultimo < l.endDate ? ultimo : l.endDate;
    pontos.push({ chave: k, rotulo: rotuloMesCurto(k), valor: bruto(ini, fim) });
  }
  return pontos;
}

/** Bruto acumulado dia a dia, do início dos limites até `ateDia` (sparkline do Dashboard). */
export function receitaAcumuladaPorDia(dados: DadosFinanceiros, l: Limites, ateDia: string): number[] {
  const fim = ateDia < l.endDate ? ateDia : l.endDate;
  const out: number[] = [];
  let acumulado = 0;
  for (let dia = l.startDate; dia <= fim; dia = somarDias(dia, 1)) {
    acumulado += calcularKpisFinanceiros(dados, limitesDias(dia, dia)).bruto;
    out.push(arredondar(acumulado));
  }
  return out;
}

// ── Rankings ───────────────────────────────────────────────────────

export type ItemRanking = { chave: string; nome: string; quantidade: number; receita: number; percentual: number };

const NOME_PADRAO = { servico: 'Serviço', profissional: 'Profissional', cliente: 'Cliente' } as const;

/**
 * Ranking dos atendimentos CONCLUÍDOS já recortados ao período. Quantidade
 * conta todos (inclusive sessão de pacote); receita soma só os faturáveis.
 * Ordena por receita e depois quantidade; `percentual` é relativo ao 1º.
 */
export function rankingAtendimentos(
  ags: AgendamentoFinRow[],
  por: 'servico' | 'profissional' | 'cliente',
): ItemRanking[] {
  const mapa = new Map<string, { nome: string; quantidade: number; receita: number }>();
  for (const a of ags) {
    if (a.status !== 'concluido') continue;
    const chave = (por === 'servico' ? a.servico_id : por === 'profissional' ? a.profissional_id : a.cliente_id) ?? '__sem__';
    const nome = (por === 'servico' ? a.servico?.nome : por === 'profissional' ? a.profissional?.nome : a.cliente?.nome)
      ?? NOME_PADRAO[por];
    const item = mapa.get(chave) ?? { nome, quantidade: 0, receita: 0 };
    item.quantidade += 1;
    if (!a.pacote_cliente_id) item.receita += num(a.valor);
    mapa.set(chave, item);
  }
  const lista = [...mapa.entries()]
    .map(([chave, v]) => ({ chave, nome: v.nome, quantidade: v.quantidade, receita: arredondar(v.receita), percentual: 0 }))
    .sort((a, b) => b.receita - a.receita || b.quantidade - a.quantidade);
  const max = lista[0]?.receita ?? 0;
  return lista.map(i => ({ ...i, percentual: max > 0 ? (i.receita / max) * 100 : 0 }));
}

export type ResumoMetodo = { metodo: string; valor: number; quantidade: number; percentual: number };

/** Formas de pagamento (pagamentos pagos já recortados ao período). */
export function resumoMetodosPagamento(pags: PagamentoFinRow[]): ResumoMetodo[] {
  const mapa: Record<string, { valor: number; quantidade: number }> = {};
  for (const p of pags) {
    const m = (mapa[p.metodo] ??= { valor: 0, quantidade: 0 });
    m.valor += num(p.valor);
    m.quantidade += 1;
  }
  const total = Object.values(mapa).reduce((s, m) => s + m.valor, 0);
  return Object.entries(mapa)
    .map(([metodo, m]) => ({
      metodo, valor: arredondar(m.valor), quantidade: m.quantidade,
      percentual: total > 0 ? Math.round((m.valor / total) * 100) : 0,
    }))
    .sort((a, b) => b.valor - a.valor);
}

// ── Clientes ───────────────────────────────────────────────────────

/** Clientes com atendimento concluído (com ou sem pacote) nas linhas recebidas. */
export function clientesAtendidosNoPeriodo(ags: Pick<AgendamentoFinRow, 'status' | 'cliente_id'>[]): string[] {
  const ids = new Set<string>();
  for (const a of ags) if (a.status === 'concluido' && a.cliente_id) ids.add(a.cliente_id);
  return [...ids];
}

export type MetricasRetorno = { atendidas: number; retornaram: number; novas: number; pctRetorno: number };

/**
 * "Retornou" = cliente atendida no período que também tinha atendimento
 * concluído ANTES do período (`comHistoricoAntes`, de
 * carregarClientesComHistoricoAntes). Regra única web + mobile.
 */
export function metricasRetorno(
  ags: Pick<AgendamentoFinRow, 'status' | 'cliente_id'>[],
  comHistoricoAntes: Iterable<string>,
): MetricasRetorno {
  const antes = new Set(comHistoricoAntes);
  const ids = clientesAtendidosNoPeriodo(ags);
  const retornaram = ids.filter(id => antes.has(id)).length;
  return {
    atendidas: ids.length,
    retornaram,
    novas: ids.length - retornaram,
    pctRetorno: ids.length > 0 ? Math.round((retornaram / ids.length) * 100) : 0,
  };
}

// ── Comissões ──────────────────────────────────────────────────────

/** Alerta do Dashboard: TODAS as comissões pendentes, de qualquer mês. */
export function resumoComissoesPendentes(rows: { valor_comissao: Valor }[]): { quantidade: number; total: number } {
  return {
    quantidade: rows.length,
    total: arredondar(rows.reduce((s, c) => s + num(c.valor_comissao), 0)),
  };
}

export type ResumoComissoesProfissional = {
  /** Σ valor_servico (preço cobrado, não a comissão). */
  faturamentoBruto: number;
  comissaoTotal: number;
  comissaoPaga: number;
  comissaoPendente: number;
  atendimentos: number;
  /** Comissão média por atendimento (arredondada ao real). */
  comissaoMedia: number;
};

/** Resumo das comissões da própria profissional (linhas já recortadas ao período). */
export function resumoComissoesProfissional(
  rows: { valor_servico: Valor; valor_comissao: Valor; status: string }[],
): ResumoComissoesProfissional {
  const total = rows.reduce((s, c) => s + num(c.valor_comissao), 0);
  const pago = rows.filter(c => c.status === 'pago').reduce((s, c) => s + num(c.valor_comissao), 0);
  return {
    faturamentoBruto: arredondar(rows.reduce((s, c) => s + num(c.valor_servico), 0)),
    comissaoTotal: arredondar(total),
    comissaoPaga: arredondar(pago),
    comissaoPendente: arredondar(total - pago),
    atendimentos: rows.length,
    comissaoMedia: rows.length > 0 ? Math.round(total / rows.length) : 0,
  };
}

/** "Fat. hoje" da profissional: valor previsto do dia, sem cancelados, faltas nem sessões de pacote. */
export function faturamentoPrevistoDia(
  ags: { valor: Valor; status: string; pacote_cliente_id: string | null }[],
): number {
  return arredondar(ags
    .filter(a => a.status !== 'cancelado' && a.status !== 'faltou' && !a.pacote_cliente_id)
    .reduce((s, a) => s + num(a.valor), 0));
}
```

- [ ] **Step 5: Rodar o teste, o tsc e a suíte**

Run: `cd web && npx vitest run tests/unit/shared-kpis-financeiros-series.test.ts tests/unit/shared-kpis-financeiros.test.ts && npx tsc --noEmit && npx vitest run`
Expected: tudo verde, zero erros.

- [ ] **Step 6: Commit**

```bash
git add shared/kpis-financeiros.ts web/tests/unit/shared-kpis-financeiros-series.test.ts
git commit -m "feat(shared): evolucao, series, rankings, retorno de clientes e resumos de comissao unicos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `shared/kpis-financeiros-consultas.ts` — as mesmas linhas nas duas plataformas

**Files:**
- Create: `shared/kpis-financeiros-consultas.ts`, `web/tests/unit/shared-kpis-financeiros-consultas.test.ts`

**Interfaces:**
- Consumes: `buscarTodasPaginas` (`shared/paginacao.ts`), `Limites`, os tipos de linha de `kpis-financeiros.ts` e `RetiradaSociaRow`/`RetiradaSociaDevolucaoRow`.
- Produces:
  - `interface ClienteDb { from(tabela: string): any }`
  - `COLUNAS_AGENDAMENTO_FIN`, `COLUNAS_RETIRADA`
  - `carregarDadosFinanceiros(db, empresaId, l): Promise<DadosFinanceiros>`
  - `carregarComissoesPendentes(db, empresaId)`
  - `carregarClientesComHistoricoAntes(db, empresaId, ids, antesIso): Promise<Set<string>>`
  - `carregarRetiradas(db, empresaId): Promise<{ rows; devs }>` (todas as retiradas da empresa)
  - `filtroDespesasDoMes(l): string`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/shared-kpis-financeiros-consultas.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import {
  carregarDadosFinanceiros, carregarComissoesPendentes, carregarClientesComHistoricoAntes,
  carregarRetiradas, filtroDespesasDoMes, COLUNAS_AGENDAMENTO_FIN,
} from '@shared/kpis-financeiros-consultas';

type Op = [string, unknown[]];
type Chamada = { tabela: string; ops: Op[] };

/** Client falso: registra a cadeia de chamadas e devolve `linhas[tabela]` fatiadas por range(). */
function fakeDb(linhas: Record<string, unknown[]> = {}, erroEm?: string) {
  const chamadas: Chamada[] = [];
  const db = {
    from(tabela: string) {
      const chamada: Chamada = { tabela, ops: [] };
      chamadas.push(chamada);
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_alvo, prop) {
          if (prop === 'then') return undefined;
          return (...args: unknown[]) => {
            chamada.ops.push([String(prop), args]);
            if (prop === 'range') {
              if (tabela === erroEm) return Promise.resolve({ data: null, error: { message: `falha em ${tabela}` } });
              const [de, ate] = args as [number, number];
              return Promise.resolve({ data: (linhas[tabela] ?? []).slice(de, ate + 1), error: null });
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
const opsDe = (chamadas: Chamada[], tabela: string) => chamadas.filter(c => c.tabela === tabela).map(c => c.ops);

const SET = limitesMes('2026-09');

describe('carregarDadosFinanceiros — mesmos filtros nas duas plataformas', () => {
  it('consulta as 8 tabelas', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    expect(chamadas.map(c => c.tabela).sort()).toEqual([
      'agendamentos', 'comissoes', 'despesas', 'financeiro_ajustes_mensais',
      'pagamentos', 'taxas_cancelamento', 'taxas_reserva', 'vendas',
    ]);
  });
  it('agendamentos: todos os status (para % de cancelamento), limites em Brasília, ordem estável', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'agendamentos');
    expect(ops).toContainEqual(['select', [COLUNAS_AGENDAMENTO_FIN]]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['gte', ['data_hora_inicio', '2026-09-01T03:00:00.000Z']]);
    expect(ops).toContainEqual(['lte', ['data_hora_inicio', '2026-10-01T02:59:59.999Z']]);
    expect(ops).toContainEqual(['order', ['id']]);
    expect(ops).toContainEqual(['range', [0, 999]]);
    expect(ops.some(([m, a]) => m === 'eq' && a[0] === 'status')).toBe(false);
  });
  it('despesas pagas por data_pagamento (coluna date)', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'despesas');
    expect(ops).toContainEqual(['eq', ['status', 'pago']]);
    expect(ops).toContainEqual(['gte', ['data_pagamento', '2026-09-01']]);
    expect(ops).toContainEqual(['lte', ['data_pagamento', '2026-09-30']]);
  });
  it('taxas: cancelamento pagas e reserva com paga_em', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    expect(opsDe(chamadas, 'taxas_cancelamento')[0]).toContainEqual(['eq', ['status', 'pago']]);
    expect(opsDe(chamadas, 'taxas_reserva')[0]).toContainEqual(['not', ['paga_em', 'is', null]]);
    expect(opsDe(chamadas, 'pagamentos')[0]).toContainEqual(['eq', ['status', 'pago']]);
  });
  it('comissões por created_at; fechamentos do 1º dia do mês inicial até o fim', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    expect(opsDe(chamadas, 'comissoes')[0]).toContainEqual(['gte', ['created_at', '2026-09-01T03:00:00.000Z']]);
    const fech = opsDe(chamadas, 'financeiro_ajustes_mensais')[0];
    expect(fech).toContainEqual(['gte', ['mes', '2026-09-01']]);
    expect(fech).toContainEqual(['lte', ['mes', '2026-09-30']]);
  });
  it('pagina além de 1000 linhas', async () => {
    const muitos = Array.from({ length: 1500 }, (_, i) => ({ id: `a${i}` }));
    const { db, chamadas } = fakeDb({ agendamentos: muitos });
    const dados = await carregarDadosFinanceiros(db, 'emp', SET);
    expect(dados.agendamentos).toHaveLength(1500);
    expect(opsDe(chamadas, 'agendamentos')).toHaveLength(2);
  });
  it('erro do banco vira exceção (nunca KPI zerado em silêncio)', async () => {
    const { db } = fakeDb({}, 'comissoes');
    await expect(carregarDadosFinanceiros(db, 'emp', SET)).rejects.toThrow('falha em comissoes');
  });
});

describe('demais consultas', () => {
  it('comissões pendentes: todas, de qualquer mês', async () => {
    const { db, chamadas } = fakeDb({ comissoes: [{ id: 'k', valor_comissao: 10 }] });
    expect(await carregarComissoesPendentes(db, 'emp')).toEqual([{ id: 'k', valor_comissao: 10 }]);
    const [ops] = opsDe(chamadas, 'comissoes');
    expect(ops).toContainEqual(['eq', ['status', 'pendente']]);
    expect(ops.some(([m]) => m === 'gte' || m === 'lte')).toBe(false);
  });
  it('histórico antes do período em lotes de 150 ids', async () => {
    const ids = Array.from({ length: 320 }, (_, i) => `c${i}`);
    const { db, chamadas } = fakeDb({ agendamentos: [{ cliente_id: 'c1' }] });
    const set = await carregarClientesComHistoricoAntes(db, 'emp', ids, SET.startIso);
    expect([...set]).toEqual(['c1']);
    const lotes = opsDe(chamadas, 'agendamentos').map(ops => (ops.find(([m]) => m === 'in')![1][1] as string[]).length);
    expect(lotes).toEqual([150, 150, 20]);
    expect(opsDe(chamadas, 'agendamentos')[0]).toContainEqual(['lt', ['data_hora_inicio', SET.startIso]]);
  });
  it('histórico sem ids não consulta nada', async () => {
    const { db, chamadas } = fakeDb();
    expect((await carregarClientesComHistoricoAntes(db, 'emp', [], SET.startIso)).size).toBe(0);
    expect(chamadas).toHaveLength(0);
  });
  it('retiradas: todas da empresa (saldo da dona é histórico)', async () => {
    const { db, chamadas } = fakeDb({ retiradas_socia: [{ id: 'r' }], retiradas_socia_devolucoes: [] });
    const r = await carregarRetiradas(db, 'emp');
    expect(r.rows).toEqual([{ id: 'r' }]);
    expect(opsDe(chamadas, 'retiradas_socia')[0].some(([m]) => m === 'or')).toBe(false);
  });
  it('filtro da lista de despesas do mês (vencimento OU pagamento no mês)', () => {
    expect(filtroDespesasDoMes(SET)).toBe(
      'and(data_vencimento.gte.2026-09-01,data_vencimento.lte.2026-09-30),and(data_pagamento.gte.2026-09-01,data_pagamento.lte.2026-09-30)',
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/shared-kpis-financeiros-consultas.test.ts`
Expected: FAIL, com o erro de módulo não encontrado.

- [ ] **Step 3: Criar `shared/kpis-financeiros-consultas.ts`**

```ts
/**
 * @file kpis-financeiros-consultas.ts
 * Consultas ÚNICAS que trazem as linhas usadas por kpis-financeiros.ts. Web
 * (client pages e o server component do Dashboard) e mobile (hooks do
 * TanStack Query) chamam estas funções passando o próprio client do Supabase.
 * Assim as duas plataformas buscam exatamente o mesmo conjunto de linhas, com
 * os mesmos filtros, ordenação estável (`id` como desempate) e paginação além
 * do teto silencioso de 1000 linhas do PostgREST.
 *
 * Por que uma função que recebe o client, e não só uma lista de colunas?
 * Os filtros foram o que mais divergiu entre as telas (UTC × Brasília,
 * `pagamentos` × agendamentos, pacote incluído ou não, created_at ×
 * data_pagamento). Centralizar a consulta inteira elimina essa classe de erro.
 * `ClienteDb` é estrutural para shared/ não depender do pacote @supabase/*.
 *
 * Toda consulta LANÇA erro em vez de devolver lista vazia: um KPI zerado por
 * falha de rede ou de RLS é pior que uma mensagem de erro.
 */
import { buscarTodasPaginas } from './paginacao';
import type { Limites } from './periodos';
import type {
  AgendamentoFinRow, ComissaoFinRow, DadosFinanceiros, DespesaFinRow,
  PagamentoFinRow, TaxaPagaFinRow, VendaFinRow,
} from './kpis-financeiros';
import type { FinanceiroFechamentoRow } from './fechamentos-mensais';
import type { RetiradaSociaDevolucaoRow, RetiradaSociaRow } from './retiradas-socia';

/** O mínimo do client supabase-js usado aqui (web: @supabase/ssr; mobile: @supabase/supabase-js). */
export interface ClienteDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

type RespostaDb<T> = { data: T[] | null; error: { message: string } | null };

async function todas<T>(montar: (de: number, ate: number) => PromiseLike<RespostaDb<T>>): Promise<T[]> {
  return buscarTodasPaginas<T>(async (de, ate) => {
    const r = await montar(de, ate);
    if (r.error) throw new Error(r.error.message);
    return r;
  });
}

/** Colunas dos agendamentos (inclui nomes para rankings e categoria/foto para o mobile). */
export const COLUNAS_AGENDAMENTO_FIN = `id, valor, status, data_hora_inicio, pacote_cliente_id, cliente_id, profissional_id, servico_id,
  servico:servicos(nome, categoria),
  profissional:users!agendamentos_profissional_id_fkey(nome, foto_url),
  cliente:clientes!agendamentos_cliente_id_fkey(nome)`;

export const COLUNAS_RETIRADA =
  'id,empresa_id,tipo,valor,data,descricao,metodo,parcelado,total_parcelas,valor_parcela,primeira_parcela_em,convertido_em,created_at';

/**
 * Todas as linhas financeiras dos limites `l`. Para comparar com o período
 * anterior, passe `uniaoLimites(anterior, atual)` e calcule os dois períodos
 * sobre o mesmo resultado — calcularKpisFinanceiros recorta sozinho.
 */
export async function carregarDadosFinanceiros(db: ClienteDb, empresaId: string, l: Limites): Promise<DadosFinanceiros> {
  const [agendamentos, vendas, taxasCancelamento, taxasReserva, pagamentos, comissoes, despesas, fechamentos] =
    await Promise.all([
      todas<AgendamentoFinRow>((de, ate) => db.from('agendamentos')
        .select(COLUNAS_AGENDAMENTO_FIN)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', l.startIso).lte('data_hora_inicio', l.endIso)
        .order('data_hora_inicio').order('id')
        .range(de, ate)),
      todas<VendaFinRow>((de, ate) => db.from('vendas')
        .select('id, valor_final, created_at')
        .eq('empresa_id', empresaId)
        .gte('created_at', l.startIso).lte('created_at', l.endIso)
        .order('created_at').order('id')
        .range(de, ate)),
      todas<TaxaPagaFinRow>((de, ate) => db.from('taxas_cancelamento')
        .select('id, valor, paga_em')
        .eq('empresa_id', empresaId).eq('status', 'pago')
        .gte('paga_em', l.startIso).lte('paga_em', l.endIso)
        .order('paga_em').order('id')
        .range(de, ate)),
      todas<TaxaPagaFinRow>((de, ate) => db.from('taxas_reserva')
        .select('id, valor, paga_em')
        .eq('empresa_id', empresaId).not('paga_em', 'is', null)
        .gte('paga_em', l.startIso).lte('paga_em', l.endIso)
        .order('paga_em').order('id')
        .range(de, ate)),
      todas<PagamentoFinRow>((de, ate) => db.from('pagamentos')
        .select('id, metodo, valor, valor_liquido, created_at')
        .eq('empresa_id', empresaId).eq('status', 'pago')
        .gte('created_at', l.startIso).lte('created_at', l.endIso)
        .order('created_at').order('id')
        .range(de, ate)),
      todas<ComissaoFinRow>((de, ate) => db.from('comissoes')
        .select('id, profissional_id, valor_comissao, status, created_at')
        .eq('empresa_id', empresaId)
        .gte('created_at', l.startIso).lte('created_at', l.endIso)
        .order('created_at').order('id')
        .range(de, ate)),
      todas<DespesaFinRow>((de, ate) => db.from('despesas')
        .select('id, valor, categoria, status, data_pagamento')
        .eq('empresa_id', empresaId).eq('status', 'pago')
        .gte('data_pagamento', l.startDate).lte('data_pagamento', l.endDate)
        .order('data_pagamento').order('id')
        .range(de, ate)),
      todas<FinanceiroFechamentoRow>((de, ate) => db.from('financeiro_ajustes_mensais')
        .select('mes, receita_bruta, comissao_paga')
        .eq('empresa_id', empresaId)
        .gte('mes', `${l.startDate.slice(0, 7)}-01`).lte('mes', l.endDate)
        .order('mes').order('id')
        .range(de, ate)),
    ]);
  return { agendamentos, vendas, taxasCancelamento, taxasReserva, pagamentos, comissoes, despesas, fechamentos };
}

/** Todas as comissões pendentes da empresa, de qualquer mês (alerta do Dashboard). */
export async function carregarComissoesPendentes(db: ClienteDb, empresaId: string): Promise<{ id: string; valor_comissao: number }[]> {
  return todas((de, ate) => db.from('comissoes')
    .select('id, valor_comissao')
    .eq('empresa_id', empresaId).eq('status', 'pendente')
    .order('created_at').order('id')
    .range(de, ate));
}

const LOTE_IDS = 150; // mantém a URL do PostgREST curta (~6 KB por lote)

/** Das `clienteIds`, quais já tinham atendimento concluído antes de `antesIso`. */
export async function carregarClientesComHistoricoAntes(
  db: ClienteDb, empresaId: string, clienteIds: string[], antesIso: string,
): Promise<Set<string>> {
  const comHistorico = new Set<string>();
  for (let i = 0; i < clienteIds.length; i += LOTE_IDS) {
    const lote = clienteIds.slice(i, i + LOTE_IDS);
    const linhas = await todas<{ cliente_id: string }>((de, ate) => db.from('agendamentos')
      .select('cliente_id')
      .eq('empresa_id', empresaId).eq('status', 'concluido')
      .lt('data_hora_inicio', antesIso)
      .in('cliente_id', lote)
      .order('id')
      .range(de, ate));
    for (const l of linhas) comHistorico.add(l.cliente_id);
  }
  return comHistorico;
}

/**
 * TODAS as retiradas/empréstimos da dona e devoluções da empresa. O saldo
 * "a dona deve" é histórico; a lista e o total do período saem de
 * listarRetiradasDoPeriodo / retiradasDoPeriodo. RLS: só a dona enxerga.
 */
export async function carregarRetiradas(
  db: ClienteDb, empresaId: string,
): Promise<{ rows: RetiradaSociaRow[]; devs: RetiradaSociaDevolucaoRow[] }> {
  const [rows, devs] = await Promise.all([
    todas<RetiradaSociaRow>((de, ate) => db.from('retiradas_socia')
      .select(COLUNAS_RETIRADA)
      .eq('empresa_id', empresaId)
      .order('data', { ascending: false }).order('id')
      .range(de, ate)),
    todas<RetiradaSociaDevolucaoRow>((de, ate) => db.from('retiradas_socia_devolucoes')
      .select('id,retirada_id,valor,data,metodo')
      .eq('empresa_id', empresaId)
      .order('id')
      .range(de, ate)),
  ]);
  return { rows, devs };
}

/** Filtro `.or()` da LISTA de despesas do mês: vencimento OU pagamento dentro do mês. */
export function filtroDespesasDoMes(l: Limites): string {
  return `and(data_vencimento.gte.${l.startDate},data_vencimento.lte.${l.endDate}),`
    + `and(data_pagamento.gte.${l.startDate},data_pagamento.lte.${l.endDate})`;
}
```

- [ ] **Step 4: Rodar o teste, o tsc (web e mobile) e a suíte**

Run:
```bash
cd web && npx vitest run tests/unit/shared-kpis-financeiros-consultas.test.ts && npx tsc --noEmit && npx vitest run
cd ../mobile && npx tsc --noEmit 2>&1 | grep "error TS"
```
Expected: verde; web sem erros; mobile com os 8 do baseline.

- [ ] **Step 5: Commit**

```bash
git add shared/kpis-financeiros-consultas.ts web/tests/unit/shared-kpis-financeiros-consultas.test.ts
git commit -m "feat(shared): consultas financeiras unicas (mesmas linhas no web e no mobile, paginadas, com erro explicito)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web — Financeiro

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`
- Delete: `web/lib/financeiro/periodo-mensal.ts`
- Test: `web/tests/unit/paridade-fase2a-web-financeiro.test.ts`

**Interfaces:**
- Consumes (de `@shared/periodos`): `limitesMes`, `somarMeses`, `uniaoLimites`, `chaveDoMesExibido`, `getMonthQueryBounds`.
- Consumes (de `@shared/kpis-financeiros`): `calcularKpisFinanceiros`, `recortarDados`, `evolucaoMensal`, `rankingAtendimentos`, `resumoMetodosPagamento`, `variacaoPercentual`, `resultadoAposRetiradas`, `retiradasDoPeriodo`, `listarRetiradasDoPeriodo`, `KPIS_ZERADOS`, `type KpisFinanceiros`.
- Consumes (de `@shared/kpis-financeiros-consultas`): `carregarDadosFinanceiros`, `carregarRetiradas`, `filtroDespesasDoMes`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/paridade-fase2a-web-financeiro.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

describe('web Financeiro usa os números únicos de shared', () => {
  const src = ler('web/app/(app)/financeiro/page.tsx');
  it('busca e calcula pelas funções de shared', () => {
    for (const trecho of [
      "from '@shared/kpis-financeiros'", "from '@shared/kpis-financeiros-consultas'", "from '@shared/periodos'",
      'carregarDadosFinanceiros(', 'calcularKpisFinanceiros(', 'evolucaoMensal(',
      'rankingAtendimentos(', 'resumoMetodosPagamento(', 'variacaoPercentual(', 'filtroDespesasDoMes(',
    ]) expect(src).toContain(trecho);
  });
  it('não recalcula comissão pelo percentual atual nem monta KPI à mão', () => {
    expect(src).not.toContain('percentual_comissao');
    expect(src).not.toContain('calcCom(');
    expect(src).not.toContain('resolveFinanceiroKpis');
    expect(src).not.toMatch(/function delta\(/);
    expect(src).not.toContain("from '@/lib/financeiro/");
  });
  it('"Após retiradas" no card de Lucro Real; saldo da dona sobre todas as retiradas', () => {
    expect(src).toContain('Após retiradas');
    expect(src).toContain('carregarRetiradas(');
    expect(src).toContain('saldoDevedorTotal(retiradasTodas');
  });
  it('mantém a grade única de KPIs', () => {
    expect(src).toContain('const kpisFinanceiro = [');
  });
  it('periodo-mensal.ts saiu (limites vêm de @shared/periodos)', () => {
    expect(existsSync(join(raiz, 'web/lib/financeiro/periodo-mensal.ts'))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/paridade-fase2a-web-financeiro.test.ts`
Expected: FAIL.

- [ ] **Step 3: Cabeçalho e imports**

1. Substitua o bloco JSDoc do topo (linhas 3–34) por:

```ts
/**
 * @file financeiro/page.tsx
 * Módulo financeiro: KPIs do mês, evolução de 6 meses, top serviços, formas de
 * pagamento, despesas, taxas e retiradas da dona.
 *
 * Todos os números vêm de @shared/kpis-financeiros (as mesmas funções do app
 * mobile, do Dashboard e dos Relatórios), sobre as linhas trazidas por
 * @shared/kpis-financeiros-consultas. Regras: ver o cabeçalho de
 * shared/kpis-financeiros.ts. Datas do mês em Brasília (@shared/periodos).
 */
```

2. Remova os imports de `@/lib/financeiro/fechamentos-mensais` e `@/lib/financeiro/periodo-mensal`.
3. Troque o import de `date-fns` por `import { format, addMonths, subMonths, isSameMonth } from 'date-fns';`.
4. No import de `@shared/retiradas-socia`, deixe `saldoEmprestimo, saldoDevedorTotal, somaDevolucoesPorRetirada, statusParcela, montarRetiradaSociaInsert, montarDevolucaoInsert`. Tire `retiradasNoPeriodo`.
5. Acrescente os imports abaixo:

```ts
import {
  limitesMes, somarMeses, uniaoLimites, chaveDoMesExibido, getMonthQueryBounds,
} from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, evolucaoMensal, rankingAtendimentos,
  resumoMetodosPagamento, variacaoPercentual, resultadoAposRetiradas, retiradasDoPeriodo,
  listarRetiradasDoPeriodo, KPIS_ZERADOS, type KpisFinanceiros,
} from '@shared/kpis-financeiros';
import {
  carregarDadosFinanceiros, carregarRetiradas, filtroDespesasDoMes,
} from '@shared/kpis-financeiros-consultas';
import type { RetiradaSociaRow, RetiradaSociaDevolucaoRow } from '@shared/retiradas-socia';
```

6. Apague a função local `delta` (linhas ~90–93).

- [ ] **Step 4: Estado**

Em `FinanceiroPage`, apague estes `useState`:
- `receita`, `receitaAnt`, `taxasCartao`;
- `comissoes`, `comissoesAnt`;
- `gastos`, `gastosAnt`;
- `taxasCancelamentoPagas`, `taxasReservaPagas`.

No lugar deles, acrescente:

```ts
  const [kpis,    setKpis]    = useState<KpisFinanceiros>(KPIS_ZERADOS);
  const [kpisAnt, setKpisAnt] = useState<KpisFinanceiros>(KPIS_ZERADOS);
```

Renomeie o estado das retiradas. Ele passa a guardar **todas** as retiradas:

```ts
  const [retiradasTodas, setRetiradasTodas] = useState<RetiradaSocia[]>([]);
```

- [ ] **Step 5: Substituir a função `carregar` inteira**

```ts
  async function carregar(empId: string, mes: Date) {
    setLoading(true);
    const chave   = chaveDoMesExibido(mes);
    const periodo = limitesMes(chave);
    const chaves6 = Array.from({ length: 6 }, (_, i) => somarMeses(chave, i - 5));
    const ini = periodo.startIso;
    const fim = periodo.endIso;

    try {
      const [dados, despLista, recMesAnt, taxasLista, reservaLista, retiradasDados] = await Promise.all([
        // KPIs do mês, do mês anterior e dos 6 meses do gráfico — uma busca só.
        carregarDadosFinanceiros(supabase, empId, uniaoLimites(limitesMes(chaves6[0]), periodo)),
        // Lista de despesas do mês (pendentes + pagas)
        supabase.from('despesas').select('*')
          .eq('empresa_id', empId)
          .or(filtroDespesasDoMes(periodo))
          .order('status').order('data_vencimento'),
        // Histórico de despesas mensais recorrentes (para auto-lançamento robusto)
        supabase.from('despesas')
          .select('descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate, parcela_atual, total_parcelas, valor_total_compra')
          .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
          .lt('data_vencimento', periodo.startDate)   // somente meses passados
          .order('data_vencimento', { ascending: false })
          .limit(5000),  // teto explicito: a contagem derivada (calcularParcelaDerivada) depende
                          // da linha mais antiga de cada serie estar presente no historico
        // Lista de taxas de cancelamento do mês (pendentes + pagas)
        supabase.from('taxas_cancelamento')
          .select('*, cliente:clientes(nome)')
          .eq('empresa_id', empId)
          .neq('status', 'cancelada')
          .gte('created_at', ini).lte('created_at', fim)
          .order('status').order('created_at'),
        // Lista de taxas de reserva do mês. 'cancelada' fica de fora: é o estado
        // terminal das taxas encerradas pelo trigger quando o atendimento acontece
        // (migration 061) — não é cobrança nem dívida.
        supabase.from('taxas_reserva')
          .select('*, cliente:clientes(nome)')
          .eq('empresa_id', empId)
          .neq('status', 'cancelada')
          .gte('created_at', ini).lte('created_at', fim)
          .order('status').order('created_at'),
        // Retiradas/empréstimos da dona — só o owner enxerga (RLS + guarda de UI).
        isOwner
          ? carregarRetiradas(supabase, empId)
          : Promise.resolve({ rows: [] as RetiradaSociaRow[], devs: [] as RetiradaSociaDevolucaoRow[] }),
      ]);

      const doMes = recortarDados(dados, periodo);
      setKpis(calcularKpisFinanceiros(dados, periodo));
      setKpisAnt(calcularKpisFinanceiros(dados, limitesMes(somarMeses(chave, -1))));
      setTopServicos(rankingAtendimentos(doMes.agendamentos, 'servico').slice(0, 5)
        .map(s => ({ nome: s.nome, quantidade: s.quantidade, receita: s.receita, percentual: Math.round(s.percentual) })));
      setMetodos(resumoMetodosPagamento(doMes.pagamentos));
      setEvolucao(evolucaoMensal(dados, chaves6)
        .map(p => ({ mes: p.rotulo, receita: p.bruto, comissoes: p.comissoes, gastos: p.despesas })));
      setTaxasCancelamento((taxasLista.data ?? []) as TaxaCancelamento[]);
      setTaxasReserva((reservaLista.data ?? []) as TaxaReserva[]);
      setDespesas((despLista.data ?? []) as Despesa[]);

      // Auto-lançamento robusto: pega o template mais recente por (descricao+categoria),
      // independente de quantos meses foram pulados, ignorando recorrências já
      // encerradas e as que já existem no mês atual. Composição coberta por teste em
      // shared/despesas.ts::templatesRecorrentesParaLancar — não reordenar sem testes.
      const todasMensais = (recMesAnt.data ?? []) as RecorrenteTemplate[];
      const despAtual = (despLista.data ?? []) as { descricao: string; categoria?: string }[];
      const chavesMesAtual = new Set(despAtual.map(d => `${d.descricao}||${d.categoria ?? ''}`));
      setRecorrentesParaLancar(templatesRecorrentesParaLancar(todasMensais, chavesMesAtual, periodo.startDate));
      setHistoricoMensal(todasMensais);

      setRetiradasTodas(retiradasDados.rows as RetiradaSocia[]);
      setRetiradasDevs(retiradasDados.devs as RetiradaSociaDevolucao[]);
    } catch (e) {
      alert(`Erro ao carregar o financeiro: ${(e as Error).message}`);
    }
    setLoading(false);
  }
```

- [ ] **Step 6: Valores derivados**

Substitua o bloco que começa em `const liquidoAposTaxas = receita - taxasCartao;` e vai até `const retiradasMes = retiradasNoPeriodo(...)` (linhas ~1424–1438) por:

```ts
  // Números do mês — todos de calcularKpisFinanceiros (mesmos do mobile/Dashboard/Relatórios).
  const receita                = kpis.bruto;
  const taxasCartao            = kpis.taxasCartao;
  const liquidoAposTaxas       = kpis.liquidoAposTaxas;
  const comissoes              = kpis.comissoes;
  const gastos                 = kpis.despesas;
  const lucro                  = kpis.lucro;
  const taxasCancelamentoPagas = kpis.receitaTaxasCancelamento;
  const taxasReservaPagas      = kpis.receitaTaxasReserva;
  const dReceita   = variacaoPercentual(kpis.bruto,     kpisAnt.bruto);
  const dComissoes = variacaoPercentual(kpis.comissoes, kpisAnt.comissoes);
  const dGastos    = variacaoPercentual(kpis.despesas,  kpisAnt.despesas);
  const hojeIso           = format(new Date(), 'yyyy-MM-dd');
  const despesasPendentes = despesas.filter(d => d.status === 'pendente');
  const totalPendente     = despesasPendentes.reduce((soma, d) => soma + Number(d.valor), 0);
  const maxEvolucao = Math.max(...evolucao.flatMap(e => [e.receita, e.gastos, e.comissoes ?? 0]), 1);

  // Retiradas/empréstimos da dona. "A dona deve" é saldo HISTÓRICO (todas as
  // retiradas); a lista e o total do mês são recortes do mês exibido.
  const retiradaBounds = getMonthQueryBounds(mesRef);
  const retiradas      = listarRetiradasDoPeriodo(retiradasTodas, retiradaBounds);
  const devPorRetirada = somaDevolucoesPorRetirada(retiradasDevs);
  const aDonaDeve      = saldoDevedorTotal(retiradasTodas, devPorRetirada);
  const retiradasMes   = retiradasDoPeriodo(retiradasTodas, retiradasDevs, retiradaBounds);
  const aposRetiradas  = resultadoAposRetiradas(lucro, retiradasMes);
```

Se `hojeIso` e `totalPendente` já estavam declarados neste bloco, **mantenha uma única declaração** de cada.

- [ ] **Step 7: "Após retiradas" no card de Lucro Real**

No array `kpisFinanceiro`:
- Acrescente `sub: null as string | null` a todos os itens.
- No item de Lucro Real, use `sub: isOwner && retiradasMes > 0 ? \`Após retiradas ${fmtBRL(aposRetiradas)}\` : null`.
- Nos cards opcionais de taxas, acrescente `sub: null`.

Na desestruturação do `.map`, inclua `sub` e renderize logo abaixo do valor:

```tsx
              {sub && (
                <p className="text-[10px] sm:text-xs text-text-4 truncate mb-1"><Secret>{sub}</Secret></p>
              )}
```

- [ ] **Step 8: Apagar `web/lib/financeiro/periodo-mensal.ts`**

```bash
git rm web/lib/financeiro/periodo-mensal.ts
```

O teste antigo `financeiro-periodo-mensal.test.ts` já importa de `@shared/periodos` desde a Task 1.

- [ ] **Step 9: tsc, testes e commit**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: zero erros, suíte verde. `ui-lote-2026-09.test.ts` continua exigindo `const kpisFinanceiro = [` e `col-span-2 lg:col-span-1`.

```bash
git add web/app/(app)/financeiro/page.tsx web/tests/unit/paridade-fase2a-web-financeiro.test.ts
git commit -m "fix(web): Financeiro usa os KPIs unicos de shared (comissao da tabela, meses em Brasilia, Apos retiradas)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Web — Dashboard (gestão)

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`
- Test: `web/tests/unit/paridade-fase2a-web-dashboard.test.ts`

**Interfaces:**
- Consumes:
  - `@shared/periodos`: `hojeBRT`, `limitesMes`, `limitesDias`, `somarMeses`, `somarDias`, `uniaoLimites`;
  - `@shared/kpis-financeiros`: `calcularKpisFinanceiros`, `variacaoPercentual`, `receitaAcumuladaPorDia`, `resumoComissoesPendentes`, `retiradasDoPeriodo`, `resultadoAposRetiradas`;
  - `@shared/kpis-financeiros-consultas`: `carregarDadosFinanceiros`, `carregarComissoesPendentes`, `carregarRetiradas`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/paridade-fase2a-web-dashboard.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'dashboard', 'page.tsx'), 'utf8');

describe('web Dashboard usa os números únicos de shared', () => {
  it('limites em Brasília por @shared/periodos (nada de fuso do servidor)', () => {
    expect(src).toContain("from '@shared/periodos'");
    expect(src).toContain('hojeBRT()');
    expect(src).not.toMatch(/(startOfMonth|endOfMonth)\([^)]*\)\.toISOString\(\)/);
    expect(src).not.toContain('Date.now() - 3 * 60 * 60 * 1000');
  });
  it('KPIs, sparkline e comissões pendentes pelas funções únicas', () => {
    for (const t of [
      'carregarDadosFinanceiros(', 'calcularKpisFinanceiros(', 'receitaAcumuladaPorDia(',
      'carregarComissoesPendentes(', 'resumoComissoesPendentes(', 'variacaoPercentual(',
    ]) expect(src).toContain(t);
    expect(src).not.toContain('percentual_comissao');
    expect(src).not.toContain('somarPeriodoComFechamentos');
    expect(src).not.toContain('async function buscarTodasPaginas');
  });
  it('lucro do mês compara com o lucro do mês anterior (não com bruto − gastos)', () => {
    expect(src).toContain('variacaoPercentual(lucro, kpisAnt.lucro)');
  });
  it('card "Líquido após taxas" no lugar do antigo "Fat. Líquido" (bruto − comissões)', () => {
    expect(src).toContain("label: 'Líquido após taxas'");
    expect(src).not.toContain("label: 'Fat. Líquido'");
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/paridade-fase2a-web-dashboard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Imports**

1. Apague a função local `buscarTodasPaginas` (linhas ~38–57) e a função `pct` (linhas ~33–36).
2. Troque o import de date-fns por `import { format } from 'date-fns';`.
3. Remova o import de `@/lib/financeiro/fechamentos-mensais`.
4. Deixe só `somaDevolucoesPorRetirada, saldoDevedorTotal` do import de `@shared/retiradas-socia`.
5. Acrescente:

```ts
import { hojeBRT, limitesMes, limitesDias, somarMeses, somarDias, uniaoLimites } from '@shared/periodos';
import {
  calcularKpisFinanceiros, variacaoPercentual, receitaAcumuladaPorDia, resumoComissoesPendentes,
  retiradasDoPeriodo, resultadoAposRetiradas,
} from '@shared/kpis-financeiros';
import {
  carregarDadosFinanceiros, carregarComissoesPendentes, carregarRetiradas,
} from '@shared/kpis-financeiros-consultas';
import type { RetiradaSociaRow, RetiradaSociaDevolucaoRow } from '@shared/retiradas-socia';
```

- [ ] **Step 4: Substituir o bloco de dados**

Substitua **desde** `// Brazil is UTC-3 (no DST since 2019)...` (linha ~98) **até** o fim do cálculo de `sparkData` (linha ~339, logo antes do `return (`). Mantenha o `if (!temPermissao(...))` que vem antes. O bloco novo:

```ts
  // Datas sempre em Brasília — o servidor roda em UTC (ver @shared/periodos).
  const hojeStr  = hojeBRT();
  const hoje     = new Date(`${hojeStr}T12:00:00`);   // só para rótulos e aniversários
  const diaLabel = format(hoje, "EEEE, d 'de' MMMM", { locale: ptBR });

  // Mês em exibição: navegável via ?mes=yyyy-MM, padrão = mês atual, sem ir ao futuro.
  const { mes: mesParam } = await searchParams;
  const mesAtualKey = hojeStr.slice(0, 7);
  const mesRefKey = mesParam && /^\d{4}-\d{2}$/.test(mesParam) && mesParam <= mesAtualKey ? mesParam : mesAtualKey;
  const mesRef        = new Date(`${mesRefKey}-01T12:00:00`);
  const isMesAtual    = mesRefKey === mesAtualKey;
  const mesRefLabel   = format(mesRef, "MMMM 'de' yyyy", { locale: ptBR });
  const paramAnterior = somarMeses(mesRefKey, -1);
  const paramSeguinte = somarMeses(mesRefKey, 1);

  const limMes  = limitesMes(mesRefKey);
  const limAnt  = limitesMes(paramAnterior);
  const limHoje = limitesDias(hojeStr, hojeStr);
  const daqui7  = somarDias(hojeStr, 7);

  const metaMensal = Number(empresa.meta_mensal ?? 0);

  // Retiradas/empréstimos da dona só aparecem para a própria dona (owner).
  const { data: empOwner } = await supabase.from('empresas').select('owner_id').eq('id', empresaId).single();
  const isOwner = !!empOwner && empOwner.owner_id === user.id;

  const [
    agendamentosHoje, totalClientes, estoqueBaixo, despPendentes,
    todasAgsCompletas, clientesComAniversario,
    dados, dadosDeHoje, comissoesPendentesRows, retiradasDados,
  ] = await Promise.all([
    supabase.from('agendamentos')
      .select('id,status,valor,data_hora_inicio,pacote_cliente_id,cliente:clientes!agendamentos_cliente_id_fkey(nome),servico:servicos(nome)')
      .eq('empresa_id', empresaId).gte('data_hora_inicio', limHoje.startIso).lte('data_hora_inicio', limHoje.endIso)
      .order('data_hora_inicio'),
    supabase.from('clientes').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('v_produtos_estoque_baixo').select('id,nome,estoque_atual,estoque_minimo')
      .eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('despesas').select('id,descricao,valor,data_vencimento')
      .eq('empresa_id', empresaId).eq('status', 'pendente')
      .gte('data_vencimento', hojeStr).lte('data_vencimento', daqui7).order('data_vencimento'),
    supabase.from('agendamentos')
      .select('cliente_id, data_hora_inicio, cliente:clientes!agendamentos_cliente_id_fkey(id, nome)')
      .eq('empresa_id', empresaId).eq('status', 'concluido')
      .order('data_hora_inicio', { ascending: false }).limit(3000),
    supabase.from('clientes')
      .select('id, nome, data_nascimento, telefone')
      .eq('empresa_id', empresaId).eq('ativo', true)
      .not('data_nascimento', 'is', null),
    // Mês exibido + anterior (comparativo) numa busca só — mesmas linhas do Financeiro.
    carregarDadosFinanceiros(supabase, empresaId, uniaoLimites(limAnt, limMes)),
    // "Fat. hoje" quando o mês exibido não é o atual.
    isMesAtual ? Promise.resolve(null) : carregarDadosFinanceiros(supabase, empresaId, limHoje),
    // Alerta: TODAS as comissões pendentes, de qualquer mês (regra única web + mobile).
    carregarComissoesPendentes(supabase, empresaId),
    isOwner
      ? carregarRetiradas(supabase, empresaId)
      : Promise.resolve({ rows: [] as RetiradaSociaRow[], devs: [] as RetiradaSociaDevolucaoRow[] }),
  ]);

  // KPIs — mesmas funções do Financeiro, Relatórios e app mobile.
  const kpis     = calcularKpisFinanceiros(dados, limMes);
  const kpisAnt  = calcularKpisFinanceiros(dados, limAnt);
  const kpisHoje = calcularKpisFinanceiros(dadosDeHoje ?? dados, limHoje);
  const { bruto, lucro, liquidoAposTaxas } = kpis;
  const pctBruto = variacaoPercentual(bruto, kpisAnt.bruto);
  const pctLucro = variacaoPercentual(lucro, kpisAnt.lucro);

  // Retiradas/empréstimos da dona (owner-only) — linhas ADITIVAS, não mudam o lucro.
  const retiradasMes       = retiradasDoPeriodo(retiradasDados.rows, retiradasDados.devs, limMes);
  const emprestimosAbertos = saldoDevedorTotal(retiradasDados.rows, somaDevolucoesPorRetirada(retiradasDados.devs));
  const lucroAposRetiradas = resultadoAposRetiradas(lucro, retiradasMes);

  const agsHoje       = agendamentosHoje.data ?? [];
  const agsConcluidos = agsHoje.filter(a => a.status === 'concluido');
  const fatHoje       = kpisHoje.bruto;

  const estoqueBaixoItems  = estoqueBaixo.data ?? [];
  const despPendentesItems = despPendentes.data ?? [];
  const totalComPendente   = resumoComissoesPendentes(comissoesPendentesRows).total;
  const totalComMes        = kpis.comissoes;          // já com fechamento importado
  const comPendenteMes     = kpis.comissoesPendentes;
  const totalAlertas       = estoqueBaixoItems.length + despPendentesItems.length + (totalComPendente > 0 ? 1 : 0);

  const perdidosMes     = kpis.perdidos;
  const pctCancelamento = kpis.pctCancelamento;
```

Depois desse bloco, **mantenha sem mudança** os blocos "Clientes inativos" (`cutoff45` … `clientesInativos`) e "Aniversariantes" (`todayMidnight` … `aniversariantes`). Os dois continuam funcionando com o novo `hoje`.

Por fim, substitua o bloco da sparkline (`const diasNoPeriodo …` até o `for` que monta `sparkData`) por:

```ts
  // Receita acumulada dia a dia (mês atual: até hoje · mês passado: completo), em Brasília.
  const sparkData = receitaAcumuladaPorDia(dados, limMes, isMesAtual ? hojeStr : limMes.endDate);
```

- [ ] **Step 5: Cards**

No array "KPIs do mês", troque o primeiro item por:

```ts
          { label: 'Líquido após taxas', value: fmt(liquidoAposTaxas), color: 'var(--color-primary)', delta: null, sub: null, icon: Wallet },
```

No array "KPIs do dia", troque o `sub` de "Fat. hoje" por `'Serv. + vendas + taxas'`.

Os demais usos já existem com os mesmos nomes e continuam como estão: `bruto`, `lucro`, `pctBruto`, `pctLucro`, `totalComMes`, `comPendenteMes`, `pctCancelamento`, `perdidosMes`, `retiradasMes`, `lucroAposRetiradas`, `emprestimosAbertos`, `totalComPendente` e `sparkData`.

- [ ] **Step 6: tsc, testes e commit**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: zero erros e suíte verde. `ui-ajustes-2026-09-05.test.ts` continua exigindo `<CountUp value={bruto} decimals={2} />` e a ausência de `label: 'Fat. Bruto'`.

```bash
git add web/app/(app)/dashboard/page.tsx web/tests/unit/paridade-fase2a-web-dashboard.test.ts
git commit -m "fix(web): Dashboard em Brasilia e com os KPIs unicos (comissao da tabela, lucro com taxa de cartao)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web — Relatórios

**Files:**
- Modify: `web/app/(app)/relatorios/page.tsx`
- Test: `web/tests/unit/paridade-fase2a-web-relatorios.test.ts`

**Interfaces:**
- Consumes:
  - `@shared/periodos`: `PERIODOS_RELATORIO`, `ROTULO_COMPARACAO`, `limitesDoPeriodo`, `rotuloDoPeriodo`, `uniaoLimites`, `hojeBRT`, `type PeriodoRelatorio`, `type OpcoesPeriodo`;
  - `@shared/kpis-financeiros`: `calcularKpisFinanceiros`, `recortarDados`, `serieFaturamento`, `rankingAtendimentos`, `metricasRetorno`, `clientesAtendidosNoPeriodo`, `variacaoPercentual`, `retiradasDoPeriodo`, `resultadoAposRetiradas`, `DADOS_VAZIOS`, `type DadosFinanceiros`, `type ItemRanking`;
  - `@shared/kpis-financeiros-consultas`: `carregarDadosFinanceiros`, `carregarClientesComHistoricoAntes`, `carregarRetiradas`;
  - `@shared/paginacao`: `buscarTodasPaginas`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/paridade-fase2a-web-relatorios.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'relatorios', 'page.tsx'), 'utf8');

describe('web Relatórios usa períodos e números únicos de shared', () => {
  it('lista de períodos e limites vêm de @shared/periodos', () => {
    expect(src).toContain('PERIODOS_RELATORIO');
    expect(src).toContain('limitesDoPeriodo(');
    expect(src).toContain('rotuloDoPeriodo(');
    expect(src).not.toContain('function periodoParaDatas');
  });
  it('KPIs, série, rankings e retorno pelas funções únicas', () => {
    for (const t of [
      'carregarDadosFinanceiros(', 'calcularKpisFinanceiros(', 'serieFaturamento(',
      'rankingAtendimentos(', 'metricasRetorno(', 'carregarClientesComHistoricoAntes(',
    ]) expect(src).toContain(t);
    expect(src).not.toContain('somarPeriodoComFechamentos');
    expect(src).not.toContain('async function buscarTodasPaginas');
    expect(src).not.toMatch(/\.slice\(0,\s*7\)/);
  });
  it('deltas vs período anterior (bruto, atendimentos, ticket)', () => {
    expect(src).toContain('variacaoPercentual(kpis.bruto, kpisAnt.bruto)');
    expect(src).toContain('variacaoPercentual(kpis.atendimentos, kpisAnt.atendimentos)');
    expect(src).toContain('variacaoPercentual(kpis.ticketMedio, kpisAnt.ticketMedio)');
    expect(src).toContain('ROTULO_COMPARACAO[periodo]');
  });
  it('"Única visita" virou "Novas" (retorno = atendida antes do período)', () => {
    expect(src).not.toContain('Única visita');
    expect(src).toContain('>Novas<');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/paridade-fase2a-web-relatorios.test.ts`
Expected: FAIL.

- [ ] **Step 3: Tipos, constantes e imports**

1. Apague `type Periodo`, `type Venda`, `type TaxaPaga`, `PERIODOS`, `type PeriodoOpts` e `function periodoParaDatas`.
2. Acrescente `type Periodo = PeriodoRelatorio;`.
3. Remova o import de `@/lib/financeiro/fechamentos-mensais`.
4. Do import de `@shared/retiradas-socia`, tire `retiradasNoPeriodo` e `somaDevolucoesPorRetirada`. Deixe o import só se sobrar algum uso.
5. Enxugue o import de date-fns para `format, parseISO`.
6. Acrescente:

```ts
import {
  PERIODOS_RELATORIO, ROTULO_COMPARACAO, limitesDoPeriodo, rotuloDoPeriodo, uniaoLimites, hojeBRT,
  type PeriodoRelatorio, type OpcoesPeriodo,
} from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, serieFaturamento, rankingAtendimentos, metricasRetorno,
  clientesAtendidosNoPeriodo, variacaoPercentual, retiradasDoPeriodo,
  resultadoAposRetiradas as calcularAposRetiradas, DADOS_VAZIOS,
  type DadosFinanceiros, type ItemRanking,
} from '@shared/kpis-financeiros';
import {
  carregarDadosFinanceiros, carregarClientesComHistoricoAntes, carregarRetiradas,
} from '@shared/kpis-financeiros-consultas';
import { buscarTodasPaginas } from '@shared/paginacao';
import type { RetiradaSociaRow, RetiradaSociaDevolucaoRow } from '@shared/retiradas-socia';
```

- [ ] **Step 4: `KpiCard` com delta**

Na assinatura, acrescente `delta = null, rotuloDelta` às props e `delta?: number | null; rotuloDelta?: string` ao tipo. Logo depois da linha do `sub`, acrescente:

```tsx
        {delta !== null && (
          <p className={`text-[10px] sm:text-xs font-semibold mt-0.5 leading-tight ${delta >= 0 ? 'text-green' : 'text-red'}`}>
            <Secret>{delta >= 0 ? '+' : ''}{delta}%</Secret> {rotuloDelta}
          </p>
        )}
```

- [ ] **Step 5: Estado e carregamento**

1. Apague os estados `ags`, `despesas`, `vendas`, `taxas`, `reserva`, `pags` e `fechamentos`.
2. Apague a função local `buscarTodasPaginas`.
3. Troque os estados das retiradas para os tipos de shared: `useState<RetiradaSociaRow[]>` e `useState<RetiradaSociaDevolucaoRow[]>`.
4. Acrescente:

```ts
  const [dados, setDados] = useState<DadosFinanceiros>(DADOS_VAZIOS);
  const [historicoClientes, setHistoricoClientes] = useState<Set<string>>(() => new Set());
```

Troque `useState<Periodo>('mes')` (mantém) e o tipo de `periodoOpts` para `useMemo<OpcoesPeriodo>`; o formato do objeto é o mesmo. Em `atualizarCustomFim`, troque `format(new Date(), 'yyyy-MM-dd')` por `hojeBRT()`. No `<input type="date">` final, troque `max={format(new Date(), 'yyyy-MM-dd')}` por `max={hojeBRT()}`.

Substitua o `carregar` inteiro:

```ts
  /**
   * Carrega o período e o anterior (deltas) numa busca só, pelas consultas
   * únicas de shared. A lista detalhada de comissões (aba Comissões) continua
   * aqui; os TOTAIS vêm de calcularKpisFinanceiros.
   */
  const carregar = useCallback(async (empId: string, per: Periodo, opts: OpcoesPeriodo) => {
    setLoading(true);
    const { atual: lAtual, anterior: lAnterior } = limitesDoPeriodo(per, hojeBRT(), opts);
    try {
      const [d, rCom] = await Promise.all([
        carregarDadosFinanceiros(supabase, empId, uniaoLimites(lAnterior, lAtual)),
        buscarTodasPaginas<Comissao>(async (from, to) => {
          const r = await supabase.from('comissoes')
            .select(`id, profissional_id, valor_comissao, status, percentual, created_at,
              profissional:users!comissoes_profissional_id_fkey(nome),
              agendamento:agendamentos(
                data_hora_inicio, valor,
                servico:servicos(nome),
                cliente:clientes!agendamentos_cliente_id_fkey(nome)
              )`)
            .eq('empresa_id', empId)
            .gte('created_at', lAtual.startIso)
            .lte('created_at', lAtual.endIso)
            .order('created_at').order('id')
            .range(from, to);
          if (r.error) throw new Error(r.error.message);
          return r;
        }),
      ]);
      const ids = clientesAtendidosNoPeriodo(recortarDados(d, lAtual).agendamentos);
      const hist = await carregarClientesComHistoricoAntes(supabase, empId, ids, lAtual.startIso);
      setDados(d);
      setComissoes(rCom as unknown as Comissao[]);
      setHistoricoClientes(hist);
    } catch (e) {
      showErro(`Erro ao carregar o relatório: ${(e as Error).message}`);
    }
    setLoading(false);
  }, []);
```

Substitua o `useEffect` das retiradas:

```ts
  // Retiradas/empréstimos da dona (owner-only). O total do período sai de retiradasDoPeriodo.
  useEffect(() => {
    if (!empresaId || !isOwner) { setRetiradasRows([]); setRetiradasDevsRows([]); return; }
    carregarRetiradas(supabase, empresaId)
      .then(r => { setRetiradasRows(r.rows); setRetiradasDevsRows(r.devs); })
      .catch(e => showErro(`Erro ao carregar retiradas: ${(e as Error).message}`));
  }, [empresaId, isOwner]);
```

Nos efeitos das abas Estoque e Avaliações, faça três trocas:
- `const { inicio, fim } = periodoParaDatas(periodo, periodoOpts);` → remova;
- `inicio.toISOString()` → `atual.startIso`;
- `fim.toISOString()` → `atual.endIso`.

Acrescente `atual` às dependências.

- [ ] **Step 6: Derivados**

Substitua do `// ── Label do período selecionado` até o fim de `rankClientes`. Pule `rankEstoque` e `notaMedia/rankAvaliacoes`, que ficam como estão. Substitua também `rankDespCat`, `serieGrafico` e o bloco de métricas de clientes, pelo conjunto abaixo. Posicione cada parte no lugar da antiga:

```ts
  // ── Período (Brasília) e comparação
  const { atual, anterior } = useMemo(
    () => limitesDoPeriodo(periodo, hojeBRT(), periodoOpts),
    [periodo, periodoOpts],
  );
  const labelPeriodo = rotuloDoPeriodo(periodo, atual);

  // ── Números únicos (mesmas funções do Financeiro, Dashboard e app mobile)
  const dadosPeriodo = useMemo(() => recortarDados(dados, atual), [dados, atual]);
  const kpis    = useMemo(() => calcularKpisFinanceiros(dados, atual),    [dados, atual]);
  const kpisAnt = useMemo(() => calcularKpisFinanceiros(dados, anterior), [dados, anterior]);
  const ags = useMemo(() => dadosPeriodo.agendamentos.map(a => ({
    ...a, valor: Number(a.valor ?? 0),
    servico: a.servico ?? null, profissional: a.profissional ?? null, cliente: a.cliente ?? null,
  })) as Ag[], [dadosPeriodo]);
  const despesas = useMemo<Despesa[]>(
    () => dadosPeriodo.despesas.map(d => ({ valor: Number(d.valor ?? 0), categoria: d.categoria })),
    [dadosPeriodo],
  );
  const concluidos = useMemo(() => ags.filter(a => a.status === 'concluido'), [ags]);

  const { bruto, taxasCartao, liquidoAposTaxas, lucro } = kpis;
  const brutoServicos = kpis.receitaServicos;
  const brutoVendas   = kpis.receitaVendas;
  const brutoTaxas    = kpis.receitaTaxasCancelamento;
  const brutoReserva  = kpis.receitaTaxasReserva;
  const comTot  = kpis.comissoes;
  const despTot = kpis.despesas;
  const ticket  = kpis.ticketMedio;
  const taxa    = kpis.pctComparecimento;
  const dBruto  = variacaoPercentual(kpis.bruto, kpisAnt.bruto);
  const dAtend  = variacaoPercentual(kpis.atendimentos, kpisAnt.atendimentos);
  const dTicket = variacaoPercentual(kpis.ticketMedio, kpisAnt.ticketMedio);

  // Retiradas da dona no período — linha ADITIVA, não muda o "Lucro real".
  const retiradasPeriodo = useMemo(
    () => (isOwner ? retiradasDoPeriodo(retiradasRows, retiradasDevsRows, atual) : 0),
    [isOwner, retiradasRows, retiradasDevsRows, atual],
  );
  const resultadoAposRetiradas = calcularAposRetiradas(lucro, retiradasPeriodo);

  // ── Rankings (quantidade = concluídos; receita = só sem pacote)
  const paraRank = (lista: ItemRanking[]): RankItem[] =>
    lista.map(r => ({ nome: r.nome, valor: r.receita, qtd: r.quantidade, pct: r.percentual }));
  const rankServicos = useMemo(() => paraRank(rankingAtendimentos(dadosPeriodo.agendamentos, 'servico')), [dadosPeriodo]);
  const rankEquipe = useMemo<(RankItem & { comissao: number })[]>(() => {
    const comPorProf: Record<string, number> = {};
    for (const c of comissoes) comPorProf[c.profissional_id] = (comPorProf[c.profissional_id] ?? 0) + c.valor_comissao;
    return rankingAtendimentos(dadosPeriodo.agendamentos, 'profissional').map(r => ({
      nome: r.nome, valor: r.receita, qtd: r.quantidade, pct: r.percentual, comissao: comPorProf[r.chave] ?? 0,
    }));
  }, [dadosPeriodo, comissoes]);
  const rankClientes = useMemo(
    () => paraRank(rankingAtendimentos(dadosPeriodo.agendamentos, 'cliente').slice(0, 10)),
    [dadosPeriodo],
  );
```

Mantenha `rankEstoque`, avaliações e `rankDespCat`. `rankDespCat` continua lendo `despesas`, que agora é o derivado acima. Substitua `serieGrafico` e as métricas de clientes:

```ts
  // ── Série do gráfico (bruto completo, com vendas e taxas; semana no domingo)
  const serieGrafico = useMemo(
    () => serieFaturamento(dados, atual).map(p => ({ label: p.rotulo, valor: p.valor })),
    [dados, atual],
  );

  // ── Retenção: "retornou" = atendida no período E antes dele (regra única web + mobile)
  const { atendidas: clientesUnicos, retornaram, novas } = useMemo(
    () => metricasRetorno(dadosPeriodo.agendamentos, historicoClientes),
    [dadosPeriodo, historicoClientes],
  );
```

Apague os memos `concluidosFaturaveis`, `faltaram` e `cancelados`, e o antigo `useMemo` de `{ bruto, comTot, taxasCartao }`. Os cards passam a usar `kpis`.

- [ ] **Step 7: JSX dos KPIs, do resumo e da retenção**

1. `tabs={PERIODOS}` → `tabs={PERIODOS_RELATORIO}`.
2. Cards:
   - "Faturamento bruto": `delta={dBruto} rotuloDelta={ROTULO_COMPARACAO[periodo]}`.
   - "Atendimentos": `value={String(kpis.atendimentos)} delta={dAtend} rotuloDelta={ROTULO_COMPARACAO[periodo]}`.
   - "Ticket médio": `delta={dTicket} rotuloDelta={ROTULO_COMPARACAO[periodo]}`.
3. Card "Taxa de cancelamento":

```tsx
        <KpiCard icon={XCircle} label="Taxa de cancelamento"
          value={kpis.totalAgendamentos > 0 ? `${kpis.pctCancelamento.toFixed(1)}%` : '—'}
          sub={kpis.perdidos > 0 ? `${kpis.perdidos} perdido(s)` : undefined}
          cor="#DC2626" loading={loading} />
```

4. Card "Total comissões": o `sub` passa a ser `kpis.comissoesPendentes > 0 ? \`${fmtBRL(kpis.comissoesPendentes)} pendentes\` : 'Em dia'`.
5. No "Resumo financeiro", substitua do comentário `{/* Linha de total bruto — só se tiver vendas */}` até o array de `(−) Comissões/(−) Despesas`, inclusive, por:

```tsx
                  {(brutoTaxas + brutoReserva) > 0 && (
                    <div className="flex items-center justify-between py-2.5 border-b border-border">
                      <span className="text-sm text-text-2">Taxas (cancel. + reserva)</span>
                      <span className="text-sm font-semibold" style={{ color: '#7C3AED' }}><Secret>{fmtBRL(brutoTaxas + brutoReserva)}</Secret></span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-2.5 border-b border-border bg-bg/50 px-1 rounded">
                    <span className="text-sm font-semibold text-text">= Faturamento bruto</span>
                    <span className="text-sm font-bold" style={{ color: '#7C3AED' }}><Secret>{fmtBRL(bruto)}</Secret></span>
                  </div>
                  {kpis.mesesComFechamento.length > 0 && (
                    <p className="text-xs text-text-3 py-1.5">Inclui fechamento importado de {kpis.mesesComFechamento.join(', ')}.</p>
                  )}
                  {([
                    { label: '(−) Taxas de cartão', v: taxasCartao, cor: '#DC2626' },
                    { label: '(−) Comissões',       v: comTot,      cor: '#D4608A' },
                    { label: '(−) Despesas',        v: despTot,     cor: '#DC2626' },
                  ] as const).map(({ label, v, cor }) => (
                    <div key={label} className="flex items-center justify-between py-2.5 border-b border-border">
                      <span className="text-sm text-text-2">{label}</span>
                      <span className="text-sm font-semibold" style={{ color: cor }}>
                        <Secret>{v > 0 ? '− ' : ''}{fmtBRL(v)}</Secret>
                      </span>
                    </div>
                  ))}
```

6. No painel de retenção, troque `{visitaramOnce}` por `{novas}` e o rótulo `Única visita` por `Novas`. O parágrafo fica `<p className="text-xs text-text-3 mt-1">Novas</p>`.

- [ ] **Step 8: tsc, testes e commit**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: zero erros, suíte verde. Continuam valendo:
- `ui-ajustes`: `if (loading) return <KpiCardSkeleton />;`;
- `ui-lote`: `flex items-stretch gap-2` e ChartBar com `self-stretch`.

```bash
git add web/app/(app)/relatorios/page.tsx web/tests/unit/paridade-fase2a-web-relatorios.test.ts
git commit -m "fix(web): Relatorios com periodos unicos, KPIs de shared, deltas e retorno de clientes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Mobile — Financeiro

**Files:**
- Modify: `mobile/hooks/useFinanceiro.ts` (reescrita), `mobile/app/(empresa)/financeiro.tsx`
- Test: `web/tests/unit/paridade-fase2a-mobile-financeiro.test.ts`

**Interfaces:**
- Produces: `useFinanceiro(mesRef)` mantém o retorno:
  - `resumo`, `metodos`, `topServicos`, `despesas`, `despesasHistorico`, `taxasCancelamento`, `taxasReserva`, `evolucao`;
  - `isOwner`, `retiradas` (só a lista do mês), `retiradasDevs`, `aDonaDeve`, `retiradasPeriodo`;
  - `isLoading`, `refetch`.

  `ResumoMes` ganha os campos `taxasCartao`, `liquidoAposTaxas`, `comissoes`, `comissoesAnterior`, `taxasCancelamento`, `taxasReserva`, `aposRetiradas` e `mesesComFechamento`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/paridade-fase2a-mobile-financeiro.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const hook = readFileSync(join(raiz, 'mobile/hooks/useFinanceiro.ts'), 'utf8');
const tela = readFileSync(join(raiz, 'mobile/app/(empresa)/financeiro.tsx'), 'utf8');

describe('mobile Financeiro = web Financeiro', () => {
  it('receita não vem mais de pagamentos', () => {
    expect(hook).not.toMatch(/from\('pagamentos'\)/);
    expect(hook).toContain('carregarDadosFinanceiros(');
    expect(hook).toContain('calcularKpisFinanceiros(');
  });
  it('evolução, top serviços e formas de pagamento pelas funções únicas', () => {
    for (const t of ['evolucaoMensal(', 'rankingAtendimentos(', 'resumoMetodosPagamento(']) expect(hook).toContain(t);
  });
  it('limites do mês em Brasília (nada de endOfMonth(...).toISOString())', () => {
    expect(hook).toContain("from '@shared/periodos'");
    expect(hook).not.toMatch(/(startOfMonth|endOfMonth)\([^)]*\)\.toISOString\(\)/);
    expect(hook).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(hook).not.toContain("code: 'pt-BR'");
  });
  it('"A dona deve" sobre todas as retiradas; lista e total do mês recortados', () => {
    expect(hook).toContain('carregarRetiradas(');
    expect(hook).toContain('listarRetiradasDoPeriodo(');
    expect(hook).toContain('retiradasDoPeriodo(');
  });
  it('tela mostra taxa de cartão, líquido e comissões; lucro já os desconta', () => {
    expect(tela).toContain("label: 'Taxas de cartão'");
    expect(tela).toContain("label: 'Líquido após taxas'");
    expect(tela).toContain("label: 'Comissões'");
    expect(tela).toContain('variacaoPercentual(');
    expect(tela).not.toMatch(/function deltaPercent\(/);
    expect(tela).toContain('resumo?.aposRetiradas');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/paridade-fase2a-mobile-financeiro.test.ts`
Expected: FAIL.

- [ ] **Step 3: Reescrever `mobile/hooks/useFinanceiro.ts` inteiro**

```ts
/**
 * @file useFinanceiro.ts
 * Dados do Financeiro do app. Os números vêm de @shared/kpis-financeiros sobre
 * as linhas de @shared/kpis-financeiros-consultas — exatamente as mesmas
 * funções do Financeiro web. Receita NÃO vem de `pagamentos` (só taxa de
 * cartão e formas de pagamento). Mês em Brasília (@shared/periodos).
 */
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { PagamentoMetodo, TaxaCancelamento, TaxaReserva } from '@/types';
import type { OcorrenciaHistorico } from '@shared/despesas';
import { limitesMes, somarMeses, uniaoLimites } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, evolucaoMensal, rankingAtendimentos,
  resumoMetodosPagamento, retiradasDoPeriodo, listarRetiradasDoPeriodo, resultadoAposRetiradas,
  DADOS_VAZIOS,
} from '@shared/kpis-financeiros';
import {
  carregarDadosFinanceiros, carregarRetiradas, filtroDespesasDoMes,
} from '@shared/kpis-financeiros-consultas';
import { somaDevolucoesPorRetirada, saldoDevedorTotal } from '@shared/retiradas-socia';

// ── Tipos ────────────────────────────────────────────────────

export interface ResumoMes {
  /** Faturamento bruto (mesmo número do web). */
  receita: number;
  receitaAnterior: number;
  taxasCartao: number;
  liquidoAposTaxas: number;
  comissoes: number;
  comissoesAnterior: number;
  gastos: number;
  gastosAnterior: number;
  lucro: number;
  /** Lucro − retiradas da dona no mês (só faz sentido para a dona). */
  aposRetiradas: number;
  taxasCancelamento: number;
  taxasReserva: number;
  mesesComFechamento: string[];
}

export interface MetodoPagamento {
  metodo: PagamentoMetodo;
  valor: number;
  quantidade: number;
  percentual: number;
}

export interface TopServico {
  servico_id: string;
  nome: string;
  quantidade: number;
  receita: number;
  percentual: number;
}

export interface DespesaItem {
  id: string;
  descricao: string;
  categoria?: string;
  valor: number;
  recorrente: boolean;
  periodicidade?: string;
  data_vencimento?: string;
  recorrencia_ate?: string;
  parcela_atual?: number;
  total_parcelas?: number;
  valor_total_compra?: number;
  data_pagamento?: string;
  created_at?: string;
  status: 'pendente' | 'pago';
}

export interface EvolucaoMes {
  mes: string;       // 'jan', 'fev' … (rotuloMesCurto)
  receita: number;
  gastos: number;
}

// ── Hook principal ───────────────────────────────────────────

export function useFinanceiro(mesRef: Date) {
  const { empresaAtiva, isOwner } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const chave   = format(mesRef, 'yyyy-MM');           // mês que a tela mostra
  const periodo = limitesMes(chave);                   // limites em Brasília
  const chaves6 = Array.from({ length: 6 }, (_, i) => somarMeses(chave, i - 5));

  // KPIs do mês, do anterior e os 6 meses do gráfico: uma busca só.
  // (a chave 'fin-resumo' é a que as telas já invalidam após salvar)
  const dadosQ = useQuery({
    queryKey: ['fin-resumo', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarDadosFinanceiros(supabase, empresaId!, uniaoLimites(limitesMes(chaves6[0]), periodo)),
  });

  // ── Despesas do mês (vencimento OU pagamento no mês — mesmo filtro do web)
  const despesas = useQuery<DespesaItem[]>({
    queryKey: ['fin-despesas', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('despesas')
        .select('*')
        .eq('empresa_id', empresaId!)
        .or(filtroDespesasDoMes(periodo))
        .order('data_vencimento', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DespesaItem[];
    },
  });

  // ── Histórico de despesas recorrentes mensais (para contagem derivada)
  const despesasHistorico = useQuery<OcorrenciaHistorico[]>({
    queryKey: ['fin-despesas-historico', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('despesas')
        .select('descricao, categoria, data_vencimento, recorrencia_ate')
        .eq('empresa_id', empresaId!)
        .eq('recorrente', true)
        .eq('periodicidade', 'mensal')
        .lt('data_vencimento', periodo.startDate)
        .order('data_vencimento', { ascending: true });
      if (error) throw error;
      return (data ?? []) as OcorrenciaHistorico[];
    },
  });

  // ── Taxas de cancelamento do mês
  const taxasCancelamento = useQuery<(TaxaCancelamento & { cliente: { nome: string } | null })[]>({
    queryKey: ['fin-taxas-cancelamento', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxas_cancelamento')
        .select('*, cliente:clientes(nome)')
        .eq('empresa_id', empresaId!)
        .neq('status', 'cancelada')
        .gte('created_at', periodo.startIso).lte('created_at', periodo.endIso)
        .order('status').order('created_at');
      if (error) throw error;
      return (data ?? []) as (TaxaCancelamento & { cliente: { nome: string } | null })[];
    },
  });

  // ── Taxas de reserva do mês
  const taxasReserva = useQuery<(TaxaReserva & { cliente: { nome: string } | null })[]>({
    queryKey: ['fin-taxas-reserva', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxas_reserva')
        .select('*, cliente:clientes(nome)')
        .eq('empresa_id', empresaId!)
        .neq('status', 'cancelada')   // encerradas ao concluir o atendimento (migration 061)
        .gte('created_at', periodo.startIso).lte('created_at', periodo.endIso)
        .order('status').order('created_at');
      if (error) throw error;
      return (data ?? []) as (TaxaReserva & { cliente: { nome: string } | null })[];
    },
  });

  // ── Retiradas/empréstimos da dona (owner-only): TODAS, o saldo é histórico
  const retiradasQ = useQuery({
    queryKey: ['fin-retiradas', empresaId],
    enabled: !!empresaId && isOwner,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarRetiradas(supabase, empresaId!),
  });

  // ── Números (mesmas funções do web)
  const dados   = dadosQ.data ?? DADOS_VAZIOS;
  const kpis    = calcularKpisFinanceiros(dados, periodo);
  const kpisAnt = calcularKpisFinanceiros(dados, limitesMes(somarMeses(chave, -1)));
  const doMes   = recortarDados(dados, periodo);

  const todasRetiradas   = retiradasQ.data?.rows ?? [];
  const retiradasDevs    = retiradasQ.data?.devs ?? [];
  const retiradas        = listarRetiradasDoPeriodo(todasRetiradas, periodo);
  const aDonaDeve        = saldoDevedorTotal(todasRetiradas, somaDevolucoesPorRetirada(retiradasDevs));
  const retiradasPeriodo = retiradasDoPeriodo(todasRetiradas, retiradasDevs, periodo);

  const resumo: ResumoMes | undefined = dadosQ.data ? {
    receita: kpis.bruto,
    receitaAnterior: kpisAnt.bruto,
    taxasCartao: kpis.taxasCartao,
    liquidoAposTaxas: kpis.liquidoAposTaxas,
    comissoes: kpis.comissoes,
    comissoesAnterior: kpisAnt.comissoes,
    gastos: kpis.despesas,
    gastosAnterior: kpisAnt.despesas,
    lucro: kpis.lucro,
    aposRetiradas: resultadoAposRetiradas(kpis.lucro, retiradasPeriodo),
    taxasCancelamento: kpis.receitaTaxasCancelamento,
    taxasReserva: kpis.receitaTaxasReserva,
    mesesComFechamento: kpis.mesesComFechamento,
  } : undefined;

  const metodos: MetodoPagamento[] = resumoMetodosPagamento(doMes.pagamentos)
    .map(m => ({ ...m, metodo: m.metodo as PagamentoMetodo }));

  const topServicos: TopServico[] = rankingAtendimentos(doMes.agendamentos, 'servico').slice(0, 5)
    .map(s => ({ servico_id: s.chave, nome: s.nome, quantidade: s.quantidade, receita: s.receita, percentual: Math.round(s.percentual) }));

  const evolucao: EvolucaoMes[] = dadosQ.data
    ? evolucaoMensal(dados, chaves6).map(p => ({ mes: p.rotulo, receita: p.bruto, gastos: p.despesas }))
    : [];

  return {
    resumo,
    metodos,
    topServicos,
    despesas:          despesas.data ?? [],
    despesasHistorico: despesasHistorico.data ?? [],
    taxasCancelamento: taxasCancelamento.data ?? [],
    taxasReserva:      taxasReserva.data ?? [],
    evolucao,
    isOwner,
    retiradas,
    retiradasDevs,
    aDonaDeve,
    retiradasPeriodo,
    isLoading: dadosQ.isLoading,
    refetch: () => {
      dadosQ.refetch();
      despesas.refetch();
      despesasHistorico.refetch();
      taxasCancelamento.refetch();
      taxasReserva.refetch();
      retiradasQ.refetch();
    },
  };
}
```

A chave `['fin-evolucao']`, que `financeiro.tsx` e `nova-despesa.tsx` ainda invalidam, passa a não existir. A invalidação vira no-op. A evolução é recalculada pela `['fin-resumo']`, que essas telas já invalidam.

- [ ] **Step 4: Tela `mobile/app/(empresa)/financeiro.tsx`**

1. Apague a função `deltaPercent` (linhas ~95–98). Acrescente o import `import { variacaoPercentual } from '@shared/kpis-financeiros';`.
2. Substitua as linhas de `deltaReceita`/`deltaGastos` por:

```ts
  const deltaReceita   = resumo ? variacaoPercentual(resumo.receita,   resumo.receitaAnterior)   : null;
  const deltaGastos    = resumo ? variacaoPercentual(resumo.gastos,    resumo.gastosAnterior)    : null;
  const deltaComissoes = resumo ? variacaoPercentual(resumo.comissoes, resumo.comissoesAnterior) : null;
```

3. No item "Lucro" do Resumo, troque o `sub` por:

```ts
              sub: isOwner && retiradasPeriodo > 0 ? `Após retiradas ${formatBRL(resumo?.aposRetiradas ?? 0)}` : null,
```

4. Logo depois do `</MotiView>` que fecha o bloco "── Resumo ──", insira:

```tsx
        {/* ── Taxa de cartão, líquido e comissões (mesmos números do web) ── */}
        <View style={{ marginHorizontal: 24, marginBottom: 12, flexDirection: 'row', gap: 8 }}>
          {[
            { label: 'Taxas de cartão',    value: resumo?.taxasCartao ?? 0,      delta: null as number | null, color: C.red,     invertDelta: false },
            { label: 'Líquido após taxas', value: resumo?.liquidoAposTaxas ?? 0, delta: null as number | null, color: C.primary, invertDelta: false },
            { label: 'Comissões',          value: resumo?.comissoes ?? 0,        delta: deltaComissoes,        color: C.amber,   invertDelta: true },
          ].map((s) => (
            <View key={s.label} style={{
              flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 16, padding: 14,
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                {s.label}
              </Text>
              <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: s.color, letterSpacing: -0.5, lineHeight: 20, marginBottom: 5 }}>
                {formatBRL(s.value)}
              </SecretText>
              {s.delta !== null && (
                <Text style={{
                  fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9,
                  color: (s.invertDelta ? s.delta < 0 : s.delta >= 0) ? C.green : C.red,
                }}>
                  {s.delta >= 0 ? '+' : ''}{s.delta}%
                </Text>
              )}
            </View>
          ))}
        </View>
        {((resumo?.taxasCancelamento ?? 0) > 0 || (resumo?.taxasReserva ?? 0) > 0) && (
          <View style={{ marginHorizontal: 24, marginBottom: 12, flexDirection: 'row', gap: 8 }}>
            {[
              { label: 'Taxas de cancelamento', value: resumo?.taxasCancelamento ?? 0 },
              { label: 'Taxas de reserva',      value: resumo?.taxasReserva ?? 0 },
            ].filter(t => t.value > 0).map(t => (
              <View key={t.label} style={{ flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{t.label}</Text>
                <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.accent }}>{formatBRL(t.value)}</SecretText>
              </View>
            ))}
          </View>
        )}
```

O gráfico `GraficoEvolucao` e o fallback de meses vazios continuam como estão. O fallback usa `format(..., { locale: ptBR })`, que é válido. A lista de retiradas (`retiradas.map`) continua igual: `retiradas` agora é a lista recortada do mês.

- [ ] **Step 5: tsc, testes e commit**

Run:
```bash
cd mobile && npx tsc --noEmit 2>&1 | grep "error TS"
cd ../web && npx tsc --noEmit && npx vitest run
```
Expected: mobile com os 8 do baseline, sem erro novo; web verde. Continua valendo `ui-lote-2026-09.test.ts`: a fileira Receita/Gastos/Lucro em `flexDirection: 'row', gap: 8`.

```bash
git add mobile/hooks/useFinanceiro.ts "mobile/app/(empresa)/financeiro.tsx" web/tests/unit/paridade-fase2a-mobile-financeiro.test.ts
git commit -m "fix(mobile): Financeiro com a mesma fonte do web (sem somar pagamentos; comissao, cartao e fechamento completos)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Mobile — Dashboard

**Files:**
- Modify: `mobile/hooks/useDashboard.ts` (reescrita), `mobile/app/(empresa)/dashboard.tsx`
- Modify (teste existente): `web/tests/unit/mobile-dashboard-commissions.test.ts`
- Test: `web/tests/unit/paridade-fase2a-mobile-dashboard.test.ts`

**Interfaces:**
- Produces: `useDashboard()` devolve:
  - `agendamentosHoje`;
  - `receitaHoje`: bruto de hoje, na regra única;
  - `receitaMes`: bruto do mês atual, com fechamento;
  - `variacaoReceitaMes`: `number | null`;
  - `comissoesPendentes`: `{ quantidade, total }`, todas as pendentes;
  - `estoqueBaixo`, `comandasNaoFechadas`, `isLoading`, `refetch`.

- [ ] **Step 1: Reescrever o teste antigo e escrever o novo**

Substitua o conteúdo inteiro de `web/tests/unit/mobile-dashboard-commissions.test.ts`. A regra anterior ("pendentes do mês") foi revogada pela decisão 10 do dono:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const hookPath = resolve(__dirname, '../../../mobile/hooks/useDashboard.ts');

describe('mobile dashboard — comissões pendentes (todas, de qualquer mês — regra do web)', () => {
  it('usa carregarComissoesPendentes, sem filtro de mês', () => {
    const source = readFileSync(hookPath, 'utf8');
    expect(source).toContain('carregarComissoesPendentes(');
    expect(source).toContain("queryKey: ['comissoes-pendentes', empresaId]");
    expect(source).not.toMatch(/from\('comissoes'\)[\s\S]{0,300}gte\('created_at'/);
  });
});
```

```ts
// web/tests/unit/paridade-fase2a-mobile-dashboard.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const hook = readFileSync(join(raiz, 'mobile/hooks/useDashboard.ts'), 'utf8');
const tela = readFileSync(join(raiz, 'mobile/app/(empresa)/dashboard.tsx'), 'utf8');

describe('mobile Dashboard = web Dashboard', () => {
  it('receita do mês e de hoje pela regra única (não soma pagamentos)', () => {
    expect(hook).not.toMatch(/from\('pagamentos'\)/);
    expect(hook).toContain('carregarDadosFinanceiros(');
    expect(hook).toContain('calcularKpisFinanceiros(');
    expect(hook).toContain('variacaoPercentual(');
  });
  it('limites em Brasília', () => {
    expect(hook).toContain('hojeBRT()');
    expect(hook).not.toMatch(/(startOfMonth|endOfMonth|startOfDay|endOfDay)\([^)]*\)\.toISOString\(\)/);
  });
  it('sem "+12% vs mês anterior" fixo; delta real', () => {
    expect(tela).not.toContain('+12% vs mês anterior');
    expect(tela).toContain('variacaoReceitaMes');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/mobile-dashboard-commissions.test.ts tests/unit/paridade-fase2a-mobile-dashboard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Reescrever `mobile/hooks/useDashboard.ts` inteiro**

```ts
/**
 * @file useDashboard.ts
 * Dados do Dashboard do app. Receita do mês e de hoje pelas funções únicas de
 * @shared/kpis-financeiros (mesmo número do Dashboard e do Financeiro web, com
 * fechamento importado). Comissões pendentes: TODAS, de qualquer mês.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { Agendamento, Produto } from '@/types';
import { hojeBRT, limitesDias, limitesMes, somarMeses, uniaoLimites } from '@shared/periodos';
import {
  calcularKpisFinanceiros, variacaoPercentual, resumoComissoesPendentes, DADOS_VAZIOS,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarComissoesPendentes } from '@shared/kpis-financeiros-consultas';

export function useDashboard() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const hoje     = hojeBRT();
  const chaveMes = hoje.slice(0, 7);
  const limHoje  = limitesDias(hoje, hoje);
  const limMes   = limitesMes(chaveMes);
  const limAnt   = limitesMes(somarMeses(chaveMes, -1));

  // Agendamentos de hoje com joins
  const agendamentosHoje = useQuery({
    queryKey: ['agendamentos-hoje', empresaId, hoje],
    enabled: !!empresaId,
    staleTime: 1000 * 60, // 1 min
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, duracao_minutos)
        `)
        .eq('empresa_id', empresaId!)
        .gte('data_hora_inicio', limHoje.startIso)
        .lte('data_hora_inicio', limHoje.endIso)
        .neq('status', 'cancelado')
        .order('data_hora_inicio', { ascending: true });

      if (error) throw error;
      return data as (Agendamento & {
        cliente: { id: string; nome: string; foto_url?: string };
        profissional: { id: string; nome: string };
        servico: { id: string; nome: string; duracao_minutos: number };
      })[];
    },
  });

  // Mês atual + anterior (delta) numa busca só; hoje está dentro do mês atual.
  const financeiro = useQuery({
    queryKey: ['dash-financeiro', empresaId, chaveMes],
    enabled: !!empresaId,
    staleTime: 1000 * 60,
    queryFn: () => carregarDadosFinanceiros(supabase, empresaId!, uniaoLimites(limAnt, limMes)),
  });

  // Comissões pendentes — TODAS, de qualquer mês (mesma regra do alerta do web)
  const comissoesPendentes = useQuery({
    queryKey: ['comissoes-pendentes', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => resumoComissoesPendentes(await carregarComissoesPendentes(supabase, empresaId!)),
  });

  // Produtos com estoque baixo
  const estoqueBaixo = useQuery({
    queryKey: ['estoque-baixo', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_produtos_estoque_baixo')
        .select('id, nome, estoque_atual, estoque_minimo')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true);

      if (error) throw error;
      return data as Pick<Produto, 'id' | 'nome' | 'estoque_atual' | 'estoque_minimo'>[];
    },
  });

  // Comandas não fechadas — atendimentos já ocorridos (data_hora_fim passada),
  // sem comanda_id, que não foram cancelados/faltaram.
  const comandasNaoFechadas = useQuery({
    queryKey: ['comandas-nao-fechadas', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select('id, data_hora_inicio')
        .eq('empresa_id', empresaId!)
        .is('comanda_id', null)
        .not('status', 'in', '("cancelado","faltou")')
        .lt('data_hora_fim', new Date().toISOString())
        .order('data_hora_inicio', { ascending: true })
        .limit(500);

      if (error) throw error;
      return data as { id: string; data_hora_inicio: string }[];
    },
  });

  const dados    = financeiro.data ?? DADOS_VAZIOS;
  const kpisMes  = calcularKpisFinanceiros(dados, limMes);
  const kpisAnt  = calcularKpisFinanceiros(dados, limAnt);
  const kpisHoje = calcularKpisFinanceiros(dados, limHoje);

  return {
    agendamentosHoje: agendamentosHoje.data ?? [],
    receitaHoje: kpisHoje.bruto,
    receitaMes: kpisMes.bruto,
    variacaoReceitaMes: financeiro.data ? variacaoPercentual(kpisMes.bruto, kpisAnt.bruto) : null,
    comissoesPendentes: comissoesPendentes.data ?? { quantidade: 0, total: 0 },
    estoqueBaixo: estoqueBaixo.data ?? [],
    comandasNaoFechadas: comandasNaoFechadas.data ?? [],
    isLoading: agendamentosHoje.isLoading || financeiro.isLoading,
    refetch: () => {
      agendamentosHoje.refetch();
      financeiro.refetch();
      comissoesPendentes.refetch();
      estoqueBaixo.refetch();
      comandasNaoFechadas.refetch();
    },
  };
}
```

- [ ] **Step 4: Tela `mobile/app/(empresa)/dashboard.tsx`**

1. Acrescente `variacaoReceitaMes,` à desestruturação de `useDashboard()`.
2. Acrescente `TrendingDown` ao import de `lucide-react-native`.
3. Substitua a `<View>` da pílula que contém `+12% vs mês anterior` (linhas ~386–406) por:

```tsx
                  {variacaoReceitaMes !== null && (
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.08)',
                      borderRadius: 20,
                      paddingVertical: 4,
                      paddingHorizontal: 10,
                    }}>
                      {variacaoReceitaMes >= 0
                        ? <TrendingUp size={10} color="#A8F0D4" strokeWidth={2.5} />
                        : <TrendingDown size={10} color="#F4B8CE" strokeWidth={2.5} />}
                      <Text style={{
                        fontFamily: 'PlusJakartaSans_700Bold',
                        fontSize: 11,
                        color: variacaoReceitaMes >= 0 ? '#A8F0D4' : '#F4B8CE',
                      }}>
                        <SecretText>{`${variacaoReceitaMes >= 0 ? '+' : ''}${variacaoReceitaMes}%`}</SecretText> vs mês anterior
                      </Text>
                    </View>
                  )}
```

- [ ] **Step 5: tsc, testes e commit**

Run:
```bash
cd mobile && npx tsc --noEmit 2>&1 | grep "error TS"
cd ../web && npx tsc --noEmit && npx vitest run
```
Expected: mobile com os 8 do baseline; web verde. Continua valendo `mobile-cliente-entidade.test.ts`: o hook mantém `clientes!agendamentos_cliente_id_fkey`.

```bash
git add mobile/hooks/useDashboard.ts "mobile/app/(empresa)/dashboard.tsx" web/tests/unit/mobile-dashboard-commissions.test.ts web/tests/unit/paridade-fase2a-mobile-dashboard.test.ts
git commit -m "fix(mobile): Dashboard com a receita do web (fechamento, Brasilia), delta real e todas as comissoes pendentes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Mobile — Relatórios

**Files:**
- Modify: `mobile/hooks/useRelatorios.ts` (reescrita), `mobile/app/(empresa)/relatorios.tsx`
- Test: `web/tests/unit/paridade-fase2a-mobile-relatorios.test.ts`

**Interfaces:**
- Produces: `useRelatorios(periodo: PeriodoRelatorio, opcoes: OpcoesPeriodo)`, que devolve:
  - `resumo`, `clientes` (`MetricasCliente` com `pctRetorno`), `servicos`, `profissionais`;
  - `atual: Limites`, `isLoading`, `refetch`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/paridade-fase2a-mobile-relatorios.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const hook = readFileSync(join(raiz, 'mobile/hooks/useRelatorios.ts'), 'utf8');
const tela = readFileSync(join(raiz, 'mobile/app/(empresa)/relatorios.tsx'), 'utf8');

describe('mobile Relatórios = web Relatórios', () => {
  it('mesma lista de períodos, semana no domingo, limites em Brasília', () => {
    expect(tela).toContain('PERIODOS_RELATORIO');
    expect(hook).toContain('limitesDoPeriodo(');
    expect(tela + hook).not.toMatch(/weekStartsOn:\s*1/);
    expect(hook).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(hook).not.toContain('startOfQuarter');
  });
  it('faturamento e ticket pela regra única (sem pagamentos)', () => {
    expect(hook).not.toMatch(/from\('pagamentos'\)/);
    expect(hook).toContain('calcularKpisFinanceiros(');
    expect(hook).toContain('carregarDadosFinanceiros(');
    expect(hook).not.toContain('async function buscarTodasPaginas');
    expect(hook).not.toMatch(/\.slice\(0,\s*7\)/);
  });
  it('retorno de clientes e rankings pelas funções únicas', () => {
    for (const t of ['metricasRetorno(', 'carregarClientesComHistoricoAntes(', 'rankingAtendimentos(']) expect(hook).toContain(t);
  });
  it('deltas pela função única, legenda comum', () => {
    expect(tela).toContain('variacaoPercentual(');
    expect(tela).toContain('ROTULO_COMPARACAO[periodo]');
    expect(tela).not.toMatch(/function delta\(/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/paridade-fase2a-mobile-relatorios.test.ts`
Expected: FAIL.

- [ ] **Step 3: Reescrever `mobile/hooks/useRelatorios.ts` inteiro**

```ts
/**
 * @file useRelatorios.ts
 * Relatórios do app. Períodos, limites (Brasília, semana no domingo) e números
 * vêm de @shared — as mesmas funções dos Relatórios web. Faturamento NÃO vem de
 * `pagamentos`. "Retornaram" = atendida no período e também antes dele.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { buscarTodasPaginas } from '@shared/paginacao';
import {
  limitesDoPeriodo, uniaoLimites, hojeBRT,
  type PeriodoRelatorio, type OpcoesPeriodo,
} from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, rankingAtendimentos, clientesAtendidosNoPeriodo, metricasRetorno,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarClientesComHistoricoAntes } from '@shared/kpis-financeiros-consultas';

export type { PeriodoRelatorio };

export interface ResumoRelatorio {
  faturamento: number;
  faturamentoAnterior: number;
  atendimentos: number;
  atendimentosAnterior: number;
  ticketMedio: number;
  ticketMedioAnterior: number;
  totalAgendamentos: number;
  perdidos: number;
  pctCancelamento: number;
}

export interface MetricasCliente {
  novos: number;
  retornaram: number;
  sumidos: number; // sem visita há +60 dias (só no app por enquanto — Fase 2B)
  totalAtendidas: number;
  pctRetorno: number;
}

export interface ServicoRelatorio {
  servico_id: string;
  nome: string;
  quantidade: number;
  receita: number;
  percentual: number;
}

export interface ProfissionalRelatorio {
  profissional_id: string;
  nome: string;
  foto_url?: string;
  especialidades: string;
  atendimentos: number;
  faturamento: number;
}

export function useRelatorios(periodo: PeriodoRelatorio, opcoes: OpcoesPeriodo) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const { atual, anterior } = limitesDoPeriodo(periodo, hojeBRT(), opcoes);
  const chave = `${periodo}_${atual.startDate}_${atual.endDate}`;

  // Período + anterior (deltas) numa busca só, e o histórico de retorno.
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

  // Clientes sumidas: último atendimento antes do período há +60 dias.
  const sumidosQ = useQuery({
    queryKey: ['rel-sumidos', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const linhas = await buscarTodasPaginas<{ cliente_id: string; data_hora_inicio: string }>(async (from, to) => {
        const r = await supabase
          .from('agendamentos')
          .select('cliente_id, data_hora_inicio')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .lt('data_hora_inicio', atual.startIso)
          .order('data_hora_inicio', { ascending: false }).order('id')
          .range(from, to);
        if (r.error) throw r.error;
        return r;
      });
      const ultimo: Record<string, string> = {};
      for (const a of linhas) if (!ultimo[a.cliente_id]) ultimo[a.cliente_id] = a.data_hora_inicio;
      return Object.values(ultimo).filter(d => differenceInDays(new Date(), new Date(d)) > 60).length;
    },
  });

  const calculado = useMemo(() => {
    if (!dadosQ.data) return null;
    const { dados, historico } = dadosQ.data;
    const k  = calcularKpisFinanceiros(dados, atual);
    const ka = calcularKpisFinanceiros(dados, anterior);
    const ags = recortarDados(dados, atual).agendamentos;
    const retorno = metricasRetorno(ags, historico);

    const resumo: ResumoRelatorio = {
      faturamento: k.bruto,
      faturamentoAnterior: ka.bruto,
      atendimentos: k.atendimentos,
      atendimentosAnterior: ka.atendimentos,
      ticketMedio: k.ticketMedio,
      ticketMedioAnterior: ka.ticketMedio,
      totalAgendamentos: k.totalAgendamentos,
      perdidos: k.perdidos,
      pctCancelamento: k.pctCancelamento,
    };

    const servicos: ServicoRelatorio[] = rankingAtendimentos(ags, 'servico').slice(0, 5).map(s => ({
      servico_id: s.chave, nome: s.nome, quantidade: s.quantidade, receita: s.receita, percentual: Math.round(s.percentual),
    }));

    const extras: Record<string, { foto_url?: string; cats: Set<string> }> = {};
    for (const a of ags) {
      if (a.status !== 'concluido' || !a.profissional_id) continue;
      const e = (extras[a.profissional_id] ??= { foto_url: a.profissional?.foto_url ?? undefined, cats: new Set() });
      if (a.servico?.categoria) e.cats.add(a.servico.categoria);
    }
    const profissionais: ProfissionalRelatorio[] = rankingAtendimentos(ags, 'profissional').map(p => ({
      profissional_id: p.chave,
      nome: p.nome,
      foto_url: extras[p.chave]?.foto_url,
      especialidades: [...(extras[p.chave]?.cats ?? [])].slice(0, 2).join(' · ') || 'Geral',
      atendimentos: p.quantidade,
      faturamento: p.receita,
    }));

    return { resumo, retorno, servicos, profissionais };
    // `chave` resume `atual`/`anterior` (objetos novos a cada render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dadosQ.data, chave]);

  const clientes: MetricasCliente | undefined = calculado ? {
    novos: calculado.retorno.novas,
    retornaram: calculado.retorno.retornaram,
    sumidos: sumidosQ.data ?? 0,
    totalAtendidas: calculado.retorno.atendidas,
    pctRetorno: calculado.retorno.pctRetorno,
  } : undefined;

  return {
    resumo:        calculado?.resumo,
    clientes,
    servicos:      calculado?.servicos ?? [],
    profissionais: calculado?.profissionais ?? [],
    atual,
    isLoading: dadosQ.isLoading,
    refetch: () => { dadosQ.refetch(); sumidosQ.refetch(); },
  };
}
```

- [ ] **Step 4: Tela `mobile/app/(empresa)/relatorios.tsx`**

1. Troque o import de date-fns por nenhum, removendo o import se nada sobrar. Troque o import do hook por `import { useRelatorios, type ServicoRelatorio, type ProfissionalRelatorio } from '@/hooks/useRelatorios';`. Acrescente:

```ts
import { useMemo } from 'react';
import {
  PERIODOS_RELATORIO, ROTULO_COMPARACAO, rotuloDoPeriodo, hojeBRT, type PeriodoRelatorio,
} from '@shared/periodos';
import { variacaoPercentual } from '@shared/kpis-financeiros';
```

Junte `useMemo` ao import existente de `react`: `import { useState, useCallback, useMemo } from 'react';`.

2. Apague `PERIODOS`, `PERIODO_LABEL`, `parseDataBR` e `delta`. Acrescente o conversor:

```ts
/** 'DD/MM/AAAA' → 'yyyy-MM-dd'; null enquanto a digitação estiver incompleta. */
function paraIsoBR(v: string): string | null {
  const p = v.split('/');
  if (p.length !== 3 || p[0].length !== 2 || p[1].length !== 2 || p[2].length !== 4) return null;
  const iso = `${p[2]}-${p[1]}-${p[0]}`;
  return Number.isNaN(new Date(`${iso}T12:00:00`).getTime()) ? null : iso;
}
```

3. No componente, substitua do `const [periodo, setPeriodo] = …` até a chamada de `useRelatorios(...)`, inclusive, por:

```ts
  const [periodo, setPeriodo] = useState<PeriodoRelatorio>('mes');
  const [semanaOffset, setSemanaOffset] = useState(0);   // só em 'semana'
  const [anoOffset, setAnoOffset] = useState(0);         // só em 'ano'
  const hoje = hojeBRT();
  const [customIniStr, setCustomIniStr] = useState(() => `01/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`);
  const [customFimStr, setCustomFimStr] = useState(() => `${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`);
  const opcoes = useMemo(() => ({
    semanaOffset,
    anoOffset,
    custom: { ini: paraIsoBR(customIniStr) ?? `${hoje.slice(0, 7)}-01`, fim: paraIsoBR(customFimStr) ?? hoje },
  }), [semanaOffset, anoOffset, customIniStr, customFimStr, hoje]);

  const { resumo, clientes, servicos, profissionais, atual, isLoading, refetch } = useRelatorios(periodo, opcoes);
  const rotuloAtual = rotuloDoPeriodo(periodo, atual);
```

4. Deltas:

```ts
  const dFat    = resumo ? variacaoPercentual(resumo.faturamento, resumo.faturamentoAnterior) : null;
  const dAtend  = resumo ? variacaoPercentual(resumo.atendimentos, resumo.atendimentosAnterior) : null;
  const dTicket = resumo ? variacaoPercentual(resumo.ticketMedio, resumo.ticketMedioAnterior) : null;
```

5. Seletor de período (8 opções, rola na horizontal):

```tsx
            <SmoothTabs
              variant="pill"
              tabs={PERIODOS_RELATORIO}
              active={periodo}
              onChange={key => {
                setPeriodo(key as PeriodoRelatorio);
                if (key === 'semana') setSemanaOffset(0);
                if (key === 'ano') setAnoOffset(0);
              }}
              activeColor="#fff"
              activeTextColor={C.primary}
              inactiveTextColor="rgba(255,255,255,0.5)"
              trackBg="rgba(255,255,255,0.1)"
              trackBorder="rgba(255,255,255,0.1)"
              style={{ marginBottom: periodo === 'semana' || periodo === 'custom' || periodo === 'ano' ? 12 : 20 }}
            />
```

6. Navegação:
   - Em "semana", troque `periodo === '7d'` por `periodo === 'semana'`.
   - Voltar: `onPress={() => setSemanaOffset(o => o - 1)}`.
   - Avançar: `onPress={() => semanaOffset < 0 && setSemanaOffset(o => o + 1)}`, com `disabled={semanaOffset >= 0}` e `opacity: semanaOffset >= 0 ? 0.3 : 1`.
   - Rótulo `{rotuloAtual}`.
   - Em "ano", troque `periodo === '1y'` por `periodo === 'ano'` e faça o mesmo com `anoOffset`. O rótulo é `{rotuloAtual}`.
7. `{PERIODO_LABEL[periodo]}` → `{ROTULO_COMPARACAO[periodo]}`.
8. Card "Taxa retorno": `valor={clientes && clientes.totalAtendidas > 0 ? \`${clientes.pctRetorno}%\` : '—'}`.

- [ ] **Step 5: tsc, testes e commit**

Run:
```bash
cd mobile && npx tsc --noEmit 2>&1 | grep "error TS"
cd ../web && npx tsc --noEmit && npx vitest run
```

Expected no mobile: só erros do baseline. O `relatorios.tsx … TS2322` do `CategoriaIcon categoria={item.nome}` pode aparecer em outra linha ou sumir; os dois casos são aceitos.

Expected no web: verde. Continua valendo `ui-lote-2026-09.test.ts`: sem "Funil de atendimentos" e sem linha de comissão no `ProfissionalRow`.

```bash
git add mobile/hooks/useRelatorios.ts "mobile/app/(empresa)/relatorios.tsx" web/tests/unit/paridade-fase2a-mobile-relatorios.test.ts
git commit -m "fix(mobile): Relatorios com os periodos e numeros do web (semana no domingo, sem somar pagamentos)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Área da profissional — web e mobile

**Files:**
- Modify: `web/app/(app)/dashboard/DashboardProfissionalView.tsx`, `mobile/hooks/useProfissional.ts`, `mobile/app/(profissional)/agenda.tsx`
- Test: `web/tests/unit/paridade-fase2a-profissional.test.ts`

**Interfaces:**
- Consumes: `hojeBRT`, `limitesDias`, `limitesMes`, `resumoComissoesProfissional`, `faturamentoPrevistoDia`, `resumoComissoesPendentes`.
- Produces: `useKpisDiaProfissional(dia)` devolve `{ total, receitaDia, comissaoDia, totalPendente }`. O campo `percentual` sai.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/tests/unit/paridade-fase2a-profissional.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const web = readFileSync(join(raiz, 'web/app/(app)/dashboard/DashboardProfissionalView.tsx'), 'utf8');
const hook = readFileSync(join(raiz, 'mobile/hooks/useProfissional.ts'), 'utf8');
const agenda = readFileSync(join(raiz, 'mobile/app/(profissional)/agenda.tsx'), 'utf8');

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
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd web && npx vitest run tests/unit/paridade-fase2a-profissional.test.ts`
Expected: FAIL.

- [ ] **Step 3: `DashboardProfissionalView.tsx`**

1. Import de date-fns: `import { format } from 'date-fns';`.
2. Acrescente:

```ts
import { hojeBRT, limitesDias, limitesMes } from '@shared/periodos';
import { resumoComissoesProfissional, faturamentoPrevistoDia } from '@shared/kpis-financeiros';
```

3. Substitua do comentário `// Brazil is UTC-3` até `const fimMes = …` por:

```ts
  // Datas em Brasília (o servidor roda em UTC) — @shared/periodos.
  const hojeStr  = hojeBRT();
  const diaLabel = format(new Date(`${hojeStr}T12:00:00`), "EEEE, d 'de' MMMM", { locale: ptBR });
  const limHoje  = limitesDias(hojeStr, hojeStr);
  const limMes   = limitesMes(hojeStr.slice(0, 7));
```

4. Na consulta da agenda de hoje:
   - acrescente `pacote_cliente_id` ao `select`;
   - use `.gte('data_hora_inicio', limHoje.startIso).lte('data_hora_inicio', limHoje.endIso)`.
5. Na consulta de comissões, use `.gte('created_at', limMes.startIso).lte('created_at', limMes.endIso)`.
6. Substitua o bloco `fatHoje` … `atendimentosMes` por:

```ts
  const ags       = (agendaHoje ?? []) as any[];
  // Previsto do dia: sem cancelados, faltas nem sessões de pacote (mesma regra do app).
  const fatHoje   = faturamentoPrevistoDia(ags);
  const resumoMes = resumoComissoesProfissional(comissoesMes ?? []);
  const faturamentoBrutoMes = resumoMes.faturamentoBruto;
  const comissaoPendenteMes = resumoMes.comissaoPendente;
  const atendimentosMes     = resumoMes.atendimentos;
```

7. No card "Comissão do mês", troque `fmt(comissaoPagaMes + comissaoPendenteMes)` por `fmt(resumoMes.comissaoTotal)`. Atualize o JSDoc do componente para citar `@shared/kpis-financeiros`.

- [ ] **Step 4: `mobile/hooks/useProfissional.ts`**

1. Acrescente os imports:

```ts
import { limitesDias, limitesMes } from '@shared/periodos';
import {
  resumoComissoesProfissional, faturamentoPrevistoDia, resumoComissoesPendentes,
} from '@shared/kpis-financeiros';
```

2. Substitua o `queryFn` de `useKpisDiaProfissional`:

```ts
    queryFn: async () => {
      // Dia exibido (calendário local) → limites em Brasília.
      const lim = limitesDias(chave, chave);
      const [agsRes, comDiaRes, pendRes] = await Promise.all([
        supabase.from('agendamentos')
          .select('valor, status, pacote_cliente_id')
          .eq('empresa_id', empresaId!)
          .eq('profissional_id', userId!)
          .gte('data_hora_inicio', lim.startIso)
          .lte('data_hora_inicio', lim.endIso)
          .neq('status', 'cancelado'),
        // Comissão do dia = comissões GERADAS hoje (tabela comissoes), nunca percentual × valor.
        supabase.from('comissoes')
          .select('valor_servico, valor_comissao, status')
          .eq('empresa_id', empresaId!)
          .eq('profissional_id', userId!)
          .gte('created_at', lim.startIso)
          .lte('created_at', lim.endIso),
        supabase.from('comissoes')
          .select('valor_comissao')
          .eq('empresa_id', empresaId!)
          .eq('profissional_id', userId!)
          .eq('status', 'pendente'),
      ]);
      if (agsRes.error) throw agsRes.error;
      if (comDiaRes.error) throw comDiaRes.error;
      if (pendRes.error) throw pendRes.error;

      const ags = agsRes.data ?? [];
      return {
        total: ags.length,
        receitaDia: faturamentoPrevistoDia(ags),
        comissaoDia: resumoComissoesProfissional(comDiaRes.data ?? []).comissaoTotal,
        totalPendente: resumoComissoesPendentes(pendRes.data ?? []).total,
      };
    },
```

3. Em `useComissoesProfissional`, troque:
   - `.gte('created_at', startOfMonth(mesRef).toISOString())` → `.gte('created_at', limitesMes(chave).startIso)`;
   - `.lte(... endOfMonth ...)` → `.lte('created_at', limitesMes(chave).endIso)`.

4. Em `useResumoComissoes`, troque os limites do mesmo jeito. Troque também o cálculo pelo resumo único:

```ts
      const { data, error } = await supabase
        .from('comissoes')
        .select('valor_servico, valor_comissao, status')
        .eq('profissional_id', userId!)
        .eq('empresa_id', empresaId!)
        .gte('created_at', limitesMes(chave).startIso)
        .lte('created_at', limitesMes(chave).endIso);
      if (error) throw error;

      const r = resumoComissoesProfissional(data ?? []);
      return {
        total: r.comissaoTotal, pago: r.comissaoPaga, pendente: r.comissaoPendente,
        atendimentos: r.atendimentos, ticketMedio: r.comissaoMedia, faturamentoBruto: r.faturamentoBruto,
      } as ResumoComissoes;
```

5. Remova `startOfMonth`/`endOfMonth` do import de date-fns só se ficarem sem uso. `useDiasProfissional` e a agenda **não** mudam nesta fase; ficam para a fase Agenda.

- [ ] **Step 5: `mobile/app/(profissional)/agenda.tsx`**

Troque o rótulo `'Comissão prev.'` por `'Comissão hoje'`.

- [ ] **Step 6: tsc, testes e commit**

Run:
```bash
cd mobile && npx tsc --noEmit 2>&1 | grep "error TS"
cd ../web && npx tsc --noEmit && npx vitest run
```
Expected: mobile com o baseline e sem erros novos. Se algum lugar lia `kpis.percentual`, o tsc aponta; remova o uso. Web verde.

```bash
git add "web/app/(app)/dashboard/DashboardProfissionalView.tsx" mobile/hooks/useProfissional.ts "mobile/app/(profissional)/agenda.tsx" web/tests/unit/paridade-fase2a-profissional.test.ts
git commit -m "fix(paridade): dinheiro da profissional igual no web e no app (comissao da tabela, sem pacote/falta, Brasilia)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verificação cruzada, conferência em produção e registro

**Files:**
- Create: `web/tests/unit/paridade-fase2a-cruzada.test.ts`
- Delete: `web/lib/financeiro/fechamentos-mensais.ts` (se sem uso)
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md`

- [ ] **Step 1: Escrever o teste cruzado**

```ts
// web/tests/unit/paridade-fase2a-cruzada.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { limitesMes, limitesDoPeriodo, getMonthQueryBounds, uniaoLimites, somarMeses } from '@shared/periodos';
import { calcularKpisFinanceiros } from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, type ClienteDb } from '@shared/kpis-financeiros-consultas';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

/**
 * Banco falso que devolve TODAS as linhas da fixture, ignorando filtros — cada
 * tela busca uma janela diferente, e o número tem de sair igual mesmo assim.
 */
function dbDaFixture(): ClienteDb {
  const fx = fixtureSetembro();
  const porTabela: Record<string, unknown[]> = {
    agendamentos: fx.agendamentos, vendas: fx.vendas, taxas_cancelamento: fx.taxasCancelamento,
    taxas_reserva: fx.taxasReserva, pagamentos: fx.pagamentos, comissoes: fx.comissoes,
    despesas: fx.despesas.filter(d => d.status === 'pago'), financeiro_ajustes_mensais: fx.fechamentos,
  };
  return {
    from(tabela: string) {
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') return undefined;
          return (...args: unknown[]) => {
            if (prop === 'range') {
              const [de, ate] = args as [number, number];
              return Promise.resolve({ data: (porTabela[tabela] ?? []).slice(de, ate + 1), error: null });
            }
            return builder;
          };
        },
      });
      return builder;
    },
  };
}

describe('mesma entrada → mesmos números em todas as telas', () => {
  const SET = limitesMes('2026-09');
  const relMes = limitesDoPeriodo('mes', '2026-09-30');
  // Janelas que cada tela busca (Tasks 5–10)
  const janelas: Record<string, ReturnType<typeof limitesMes>> = {
    'Financeiro web e mobile (6 meses)': uniaoLimites(limitesMes(somarMeses('2026-09', -5)), SET),
    'Dashboard web e mobile (mês + anterior)': uniaoLimites(limitesMes('2026-08'), SET),
    'Relatórios web e mobile (Mês + anterior)': uniaoLimites(relMes.anterior, relMes.atual),
  };

  it('o período "Mês" dos Relatórios é o mesmo mês do Financeiro e do Dashboard', () => {
    expect(relMes.atual).toEqual(SET);
    expect(getMonthQueryBounds(new Date(2026, 8, 1))).toEqual(SET);
  });

  it('bruto, cartão, comissões, despesas, lucro e ticket idênticos em todas as janelas', async () => {
    const resultados = await Promise.all(Object.values(janelas).map(async j =>
      calcularKpisFinanceiros(await carregarDadosFinanceiros(dbDaFixture(), 'emp', j), SET)));
    for (const r of resultados) expect(r).toEqual(resultados[0]);
    expect(resultados[0]).toMatchObject({ bruto: 560, taxasCartao: 7.5, comissoes: 140, despesas: 295.5, lucro: 117, ticketMedio: 175 });
  });
});

describe('todas as telas usam as funções únicas e nenhum cálculo antigo sobrou', () => {
  const TELAS: Record<string, string[]> = {
    'web/app/(app)/financeiro/page.tsx':  ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'web/app/(app)/dashboard/page.tsx':   ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'web/app/(app)/relatorios/page.tsx':  ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'web/app/(app)/dashboard/DashboardProfissionalView.tsx': ['resumoComissoesProfissional(', 'faturamentoPrevistoDia('],
    'mobile/hooks/useFinanceiro.ts':      ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'mobile/hooks/useDashboard.ts':       ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'mobile/hooks/useRelatorios.ts':      ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'mobile/hooks/useProfissional.ts':    ['resumoComissoesProfissional(', 'faturamentoPrevistoDia('],
  };
  const PROIBIDOS_TODOS: [RegExp, string][] = [
    [/percentual_comissao/, 'comissão recalculada pelo percentual atual'],
    [/from\('pagamentos'\)\s*\.select\('valor'/, 'receita somando pagamentos'],
    [/async function buscarTodasPaginas/, 'paginação duplicada (usar @shared/paginacao)'],
    [/\+12% vs mês anterior/, 'delta fixo no código'],
    [/code:\s*'pt-BR'/, 'locale inválido do date-fns'],
    [/somarPeriodoComFechamentos|resolveFinanceiroKpis/, 'fechamento aplicado fora de calcularKpisFinanceiros'],
  ];
  // useProfissional ainda tem limites de AGENDA (fase Agenda); as regras de data valem para o resto.
  const PROIBIDOS_DATA: [RegExp, string][] = [
    [/(startOfMonth|endOfMonth|startOfDay|endOfDay)\([^)]*\)\.toISOString\(\)/, 'limite no fuso do aparelho/servidor'],
    [/toISOString\(\)\.slice\(0,\s*10\)/, 'data de fim de mês em UTC'],
    [/weekStartsOn:\s*1/, 'semana começando na segunda'],
  ];

  for (const [arquivo, exigidos] of Object.entries(TELAS)) {
    it(arquivo, () => {
      const src = ler(arquivo);
      for (const e of exigidos) expect(src, `${arquivo} deveria usar ${e}`).toContain(e);
      const proibidos = arquivo.endsWith('useProfissional.ts') ? PROIBIDOS_TODOS : [...PROIBIDOS_TODOS, ...PROIBIDOS_DATA];
      for (const [re, motivo] of proibidos) expect(re.test(src), `${arquivo}: ${motivo}`).toBe(false);
    });
  }

  it('telas mobile de Relatórios e Dashboard sem semana na segunda nem delta fixo', () => {
    expect(ler('mobile/app/(empresa)/relatorios.tsx')).not.toMatch(/weekStartsOn:\s*1/);
    expect(ler('mobile/app/(empresa)/dashboard.tsx')).not.toContain('+12% vs mês anterior');
  });
});
```

- [ ] **Step 2: Rodar**

Run: `cd web && npx vitest run tests/unit/paridade-fase2a-cruzada.test.ts`
Expected: PASS. Se algo falhar, a mensagem aponta o arquivo e o motivo. Corrija na tela correspondente, sem relaxar o teste.

- [ ] **Step 3: Remover o que ficou sem uso**

```bash
grep -rn "lib/financeiro/fechamentos-mensais\|somarPeriodoComFechamentos\|resolveFinanceiroKpis" web mobile shared --include=*.ts --include=*.tsx | grep -v node_modules
```

- Se só aparecerem `web/lib/financeiro/fechamentos-mensais.ts`, `shared/fechamentos-mensais.ts` e `web/tests/unit/financeiro-fechamentos-mensais.test.ts`, rode: `git rm web/lib/financeiro/fechamentos-mensais.ts`.
- `shared/fechamentos-mensais.ts` fica (`getFechamentoForMonth` é usado por `kpis-financeiros.ts`).
- `somarPeriodoComFechamentos`/`resolveFinanceiroKpis` ficam, com seus testes, porque documentam a regra do fechamento. Registre na Fase 2B a remoção deles.

- [ ] **Step 4: Verificação completa**

Run:
```bash
cd web && npx tsc --noEmit && npx vitest run
cd ../mobile && npx tsc --noEmit 2>&1 | grep "error TS"
```
Expected:
- web com zero erros e tudo verde;
- mobile com os erros do baseline (8, ou 7 se o `relatorios.tsx` sumiu), comparados por arquivo + código. Nenhum erro novo.

- [ ] **Step 5: Conferência em produção (somente leitura)**

O controlador tem um script de leitura no scratchpad. Ele usa a service role pela variável de ambiente `SUPABASE_SERVICE_ROLE_KEY`, fora do repositório; **nunca** commitar chaves.

O script faz o seguinte:
1. Cria um client supabase-js.
2. Chama `carregarDadosFinanceiros(db, EMPRESA_ID, limitesMes('2026-09'))` e `calcularKpisFinanceiros(..., limitesMes('2026-09'))`.
3. Imprime `bruto`, `receitaServicos`, `receitaVendas`, `receitaTaxasCancelamento`, `receitaTaxasReserva`, `taxasCartao`, `comissoes`, `despesas`, `lucro`, `ticketMedio` e `mesesComFechamento`.

Rode-o com `npx tsx <scratchpad>/conferir-setembro.ts`. Depois rode no SQL Editor a consulta independente abaixo, trocando `<EMPRESA_ID>`:

```sql
-- Setembro/2026 em Brasília: [2026-09-01 03:00Z, 2026-10-01 03:00Z)
with p as (
  select '<EMPRESA_ID>'::uuid as emp,
         timestamptz '2026-09-01 03:00:00+00' as ini,
         timestamptz '2026-10-01 03:00:00+00' as fim
)
select
  (select coalesce(sum(a.valor),0) from agendamentos a, p
    where a.empresa_id = p.emp and a.status = 'concluido' and a.pacote_cliente_id is null
      and a.data_hora_inicio >= p.ini and a.data_hora_inicio < p.fim)                         as servicos,
  (select coalesce(sum(v.valor_final),0) from vendas v, p
    where v.empresa_id = p.emp and v.created_at >= p.ini and v.created_at < p.fim)               as vendas,
  (select coalesce(sum(t.valor),0) from taxas_cancelamento t, p
    where t.empresa_id = p.emp and t.status = 'pago' and t.paga_em >= p.ini and t.paga_em < p.fim) as taxas_canc,
  (select coalesce(sum(r.valor),0) from taxas_reserva r, p
    where r.empresa_id = p.emp and r.paga_em is not null and r.paga_em >= p.ini and r.paga_em < p.fim) as taxas_reserva,
  (select coalesce(sum(g.valor - g.valor_liquido),0) from pagamentos g, p
    where g.empresa_id = p.emp and g.status = 'pago' and g.valor_liquido is not null
      and g.created_at >= p.ini and g.created_at < p.fim)                                       as taxa_cartao,
  (select coalesce(sum(c.valor_comissao),0) from comissoes c, p
    where c.empresa_id = p.emp and c.created_at >= p.ini and c.created_at < p.fim)               as comissoes_created_at,
  (select coalesce(sum(c.valor_comissao),0) from comissoes c join agendamentos a on a.id = c.agendamento_id, p
    where c.empresa_id = p.emp and a.data_hora_inicio >= p.ini and a.data_hora_inicio < p.fim)   as comissoes_data_atendimento,
  (select coalesce(sum(d.valor),0) from despesas d, p
    where d.empresa_id = p.emp and d.status = 'pago'
      and d.data_pagamento between date '2026-09-01' and date '2026-09-30')                     as despesas,
  (select count(*) from financeiro_ajustes_mensais f, p
    where f.empresa_id = p.emp and f.mes = date '2026-09-01')                                   as tem_fechamento;
```

Expected:
- **Sem fechamento** (`tem_fechamento = 0`):
  - `bruto` do script = `servicos + vendas + taxas_canc + taxas_reserva`;
  - `taxasCartao` = `taxa_cartao`;
  - `comissoes` = `comissoes_created_at`;
  - `despesas` = `despesas`;
  - `lucro` = bruto − taxa_cartao − comissoes_created_at − despesas.
- **Com fechamento** (`tem_fechamento = 1`): bruto e comissões = `receita_bruta` e `comissao_paga` do fechamento, e taxa de cartão = 0.
- **Informativo:** a diferença `comissoes_created_at − comissoes_data_atendimento`. Se for maior que R$ 1, registre o valor na Fase 2B (item "datar comissão pelo atendimento?").

Abra as telas web e mobile de Financeiro, Dashboard e Relatórios (período "Mês anterior" em outubro, ou "Mês" em setembro) e confira que mostram o mesmo `bruto`/`comissões`/`lucro`.

- [ ] **Step 6: Registrar**

No `CLAUDE.md`, na seção "📊 HISTÓRICO DE AUDITORIAS", acrescente a entrada "Sessão 2026-09-30 — Paridade Fase 2A (números financeiros únicos)". Use o formato das sessões anteriores: tabela de critérios e bugs encontrados. A entrada lista:
- as 12 decisões do dono;
- a interpretação do fechamento em mês parcial;
- os números de setembro/2026 conferidos (script × SQL) e a diferença de datas das comissões;
- os bugs corrigidos:
  - receita do mobile somando `pagamentos`;
  - comissão por percentual no web;
  - lucro do Dashboard sem taxa de cartão;
  - limites em UTC ou fuso do servidor;
  - semana na segunda;
  - "+12%" fixo;
  - locale do gráfico;
  - "A dona deve" só do mês.

No inventário (`docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md`), logo abaixo do título "### Financeiro / Relatórios / Dashboard", acrescente:

```markdown
> **Status (2026-09-30): números entregues** pela Fase 2A (`docs/superpowers/plans/2026-09-30-paridade-fase2a-kpis-financeiros.md`) — fonte de receita, lucro, comissão da tabela, Brasília, fechamento no mobile, deltas, "Após retiradas", ticket médio, retorno de clientes, código morto. Telas/funções ainda ausentes no mobile ficam na Fase 2B.
```

- [ ] **Step 7: Commit**

```bash
git add web/tests/unit/paridade-fase2a-cruzada.test.ts CLAUDE.md docs/superpowers/specs/2026-09-29-paridade-total-web-mobile-inventario.md
git commit -m "test(paridade): verificacao cruzada dos numeros financeiros web x mobile e registro da fase 2A" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (resultado)

| Item | Onde | OK |
|---|---|---|
| Decisão 1 — receita (sem pacote, vendas, taxas; sem `pagamentos`) | Task 2 (`calcularKpisFinanceiros`), Task 4 (consultas), Tasks 8–10 (mobile deixa de somar `pagamentos`), Task 12 (proibido `from('pagamentos').select('valor'`) | ✔ |
| Decisão 2 — comissões da tabela, por `created_at` (justificado) | Global Constraints; Task 2; Tasks 5, 6, 11 removem `percentual_comissao`; Task 12 mede a diferença de data em produção | ✔ |
| Decisão 3 — lucro com cartão; "Após retiradas"; saldo da dona histórico | Task 2 (`lucro`, `resultadoAposRetiradas`, `retiradasDoPeriodo`, `listarRetiradasDoPeriodo`); Task 4 (`carregarRetiradas` sem filtro); Tasks 5, 6, 8 | ✔ |
| Decisão 4 — fechamento substitui receita + comissão e zera o cartão, em todas as telas (inclusive Dashboard mobile) | Task 2 (regra de mês inteiro, testada); Task 9 | ✔ (interpretação de mês parcial marcada para confirmação) |
| Decisão 5 — Brasília, sem `toISOString().slice`, sem fuso do servidor, agrupamento BRT | Task 1; Tasks 5–11; Task 12 (varredura) | ✔ |
| Decisão 6 — semana no domingo, lista única de períodos | Task 1 (`PERIODOS_RELATORIO`, `limitesDoPeriodo`); Tasks 7 e 10 | ✔ |
| Decisão 7 — ticket médio sem pacote nas duas bases | Task 2 (`ticketMedio`), Tasks 7 e 10 | ✔ |
| Decisão 8 — "retornaram" = antes do período, função única | Task 3 (`metricasRetorno`), Task 4 (`carregarClientesComHistoricoAntes`), Tasks 7 e 10 | ✔ |
| Decisão 9 — deltas nas duas plataformas | Task 2 (`variacaoPercentual`, base zero → null), Tasks 5, 6, 7, 8, 9, 10 | ✔ |
| Decisão 10 — alerta de comissões = todas as pendentes | Task 4 (`carregarComissoesPendentes`), Tasks 6 e 9 (teste antigo reescrito) | ✔ |
| Decisão 11 — código morto e enganoso | Task 1 (ajustes-mensais), Task 5 (periodo-mensal), Task 9 (+12%), Task 8 (locale), Task 12 (fechamentos-mensais do web) | ✔ |
| Casos de borda testados | Fixture com: pacote; despesa pendente com e sem data; fechamento em mês inteiro, parcial e em vários meses; 21:00–23:59 BRT do último dia; período vazio; delta com base zero e negativa | ✔ |
| Paginação | Todas as consultas de shared usam `buscarTodasPaginas` com `.order('id')`; web Relatórios e mobile Relatórios sem cópias locais | ✔ |
| Placeholders | Nenhum; `<EMPRESA_ID>` é um valor de execução do SQL de conferência | ✔ |
| Consistência de nomes | As funções de shared citadas nas Tasks 5–12 são exatamente as exportadas nas Tasks 1–4 (`resultadoAposRetiradas` importado como `calcularAposRetiradas` só nos Relatórios web, por conflito de nome) | ✔ |

## Fase 2B — fora do escopo desta fase (não são tasks aqui)

- **Relatórios mobile:** abas que faltam (Financeiro detalhado com gráfico, Equipe com comissão, Clientes top 10, Estoque, Comissões, Avaliações), resumo financeiro com lucro/"após retiradas" e exportação.
- **→ web:** card "Sumidas +60d" e "Taxa de retorno" (hoje só no app).
- **Financeiro mobile:**
  - lançamento automático de despesas recorrentes (as parcelas não avançam);
  - calendário do mês (`FinanceMonthCalendar`);
  - exportação (botões de Download mortos).
- **Dashboard mobile:**
  - navegação de mês;
  - meta mensal;
  - cards de reconquista, aniversariantes e clientes inativos;
  - alerta de despesas vencendo.
- **→ web:** alerta de "comandas não fechadas".
- **Comissões:**
  - tela de Comissões (gestor e profissional) nas duas plataformas com a mesma fonte, os mesmos limites em Brasília e a mesma semana;
  - escopo de "Pagar" (todas × do período);
  - Comissões no menu do app;
  - decidir se a comissão passa a ser datada pelo atendimento, conforme a diferença medida na Task 12.
- **Formatação:** padronizar a formatação monetária. Hoje o app abrevia em "k" nos Relatórios.
- **Limpeza:** remover `somarPeriodoComFechamentos` e `resolveFinanceiroKpis` de `shared/fechamentos-mensais.ts` e os testes deles, já sem uso nas telas.
- **Agenda (fase própria):** `weekStartsOn: 1` e limites locais em `mobile/app/(empresa)/agenda.tsx`, `(profissional)/agenda.tsx`, `novo-agendamento.tsx` e nos hooks de agenda de `useProfissional.ts`.
- **Clientes inativos do Dashboard web:** consulta com `.limit(3000)` sem paginação.
- **Paridade de Comanda/PDV, Estoque e Equipe** (seções próprias do inventário).

