# Retiradas e empréstimos da dona — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a dona (owner) registre dinheiro tirado do estúdio como empréstimo (devolvível, avulso ou parcelado) ou como retirada definitiva, numa seção própria do Financeiro, sem alterar nenhum cálculo de lucro existente.

**Architecture:** Duas tabelas novas (`retiradas_socia` + `retiradas_socia_devolucoes`), owner-only por RLS. Toda a lógica de saldo/parcela/agregado vive em funções puras em `shared/retiradas-socia.ts` (TDD completo). A UI (web + mobile) consome essas funções e segue os padrões de seção/modal já usados por Despesas e Taxas no Financeiro. Relatórios e Dashboard ganham linhas **aditivas** ("Retiradas da dona", "Resultado após retiradas", card "A dona deve") calculadas a partir das tabelas novas — nenhuma query de `despesas`/`pagamentos`/`agendamentos`/`vendas`/`comissoes` é tocada.

**Tech Stack:** Next.js 15 App Router (TypeScript), Supabase (PostgreSQL + RLS), React Native/Expo (mobile), Vitest, date-fns, Tailwind CSS.

## Global Constraints

- **Português** em toda copy visível ao usuário, comentários e mensagens de commit.
- **TypeScript:** `cd web && npx tsc --noEmit` DEVE terminar com zero erros ao fim de cada task que toca `web/`. Mobile mantém os ~10 erros pré-existentes (rodar `cd mobile && npx tsc --noEmit` e comparar contra a baseline antes de começar) — **nenhum erro novo**.
- **Testes:** `cd web && npm test` (Vitest) DEVE passar 100% ao fim de cada task que toca `web/` ou `shared/`.
- **Migrations:** arquivo em `supabase/migrations/NNN_descricao.sql`, `NNN` = próximo sequencial. O último é `062`; este plano usa **`063`**. Habilitar RLS em toda tabela nova; policies via checagem de `empresas.owner_id = auth.uid()`.
- **Enum de método de pagamento:** reaproveitar `public.pagamento_metodo` (`'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia'`) — NÃO criar domínio novo.
- **Aritmética de dinheiro:** centavos inteiros (`Math.round(x*100)` / dividir no fim), nunca somar/dividir floats de reais diretamente — mesma lição de `dividirValorCompra` em `shared/despesas.ts`.
- **`.select()` obrigatório** depois de todo `.insert()`/`.update()`/`.delete()` nas tabelas novas, com tratamento de erro visível (um miss de RLS não pode "dar sucesso" mudo — lição de `marcarReservaPaga`).
- **Guarda `isOwner` no cliente:** a seção do Financeiro, a linha nos Relatórios e o card do Dashboard só renderizam quando o usuário atual é o owner. Nunca renderizar "R$ 0" para não-owner — não renderizar nada.
- **Não regressão:** nenhuma tabela/coluna/policy/trigger/índice existente é alterado ou removido. Migration é 100% aditiva.
- Imports compartilhados usam o alias `@shared/...` (web e mobile já têm esse alias configurado).

## File Structure

**Novos:**
- `supabase/migrations/063_retiradas_socia.sql` — enum + 2 tabelas + 2 índices + RLS (4-verbo `for all`, owner-only).
- `shared/retiradas-socia.ts` — funções puras: tipos de domínio, `somaDevolucoesPorRetirada`, `saldoEmprestimo`, `retiradasNoPeriodo`, `saldoDevedorTotal`, `statusParcela`, `somarMesesIso`, `montarRetiradaSociaInsert`, `montarDevolucaoInsert`.
- `web/tests/unit/retiradas-socia.test.ts` — unit tests das funções puras.
- `web/tests/unit/retiradas-socia-migration.test.ts` — teste do texto da migration (segue o padrão de `despesas-parcelas-migration.test.ts`).
- `mobile/app/(empresa)/nova-retirada.tsx` — tela de registrar/editar retirada no mobile (espelha `nova-despesa.tsx`).

**Modificados:**
- `web/app/(app)/financeiro/page.tsx` — nova seção "Retiradas da dona" (card + lista + modais registrar/editar/devolução/converter/excluir), fetch de `isOwner`, query de carga.
- `web/app/(app)/relatorios/page.tsx` — query owner-guarded, KPI "Resultado após retiradas", linha no detalhamento, export.
- `web/app/(app)/dashboard/page.tsx` — queries owner-guarded no `Promise.all`, sub-linha "Após retiradas", card "Empréstimos da dona em aberto".
- `web/types/index.ts` — `RetiradaSocia`, `RetiradaSociaDevolucao` (re-export dos tipos de `@shared/retiradas-socia`).
- `mobile/app/(empresa)/financeiro.tsx` — nova seção "Retiradas da dona" + modais/ações (mirror do web).
- `mobile/hooks/useFinanceiro.ts` — agregados `retiradasPeriodo` e `saldoDevedorTotal` no retorno do hook.
- `mobile/types/index.ts` (ou equivalente) — tipos de linha, se o mobile tiver arquivo de tipos próprio; senão importar de `@shared`.
- Telas mobile de dashboard/relatórios que mostram "lucro" — sub-linha "Após retiradas" (paridade).

---

## Task 1: Migration 063 — schema + RLS

**Files:**
- Create: `supabase/migrations/063_retiradas_socia.sql`
- Test: `web/tests/unit/retiradas-socia-migration.test.ts`

**Interfaces:**
- Consumes: enum `public.pagamento_metodo` (já existe), tabela `public.empresas(id, owner_id)`, `public.users(id)`, função `uuid_generate_v4()`.
- Produces: tabelas `public.retiradas_socia` e `public.retiradas_socia_devolucoes` com as colunas usadas por todas as tasks seguintes (ver DDL abaixo — os nomes de coluna são contrato).

- [ ] **Step 1: Write the failing migration test**

Create `web/tests/unit/retiradas-socia-migration.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function readAllMigrations(): string {
  const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
    .join('\n---\n');
}

describe('Migration 063: retiradas_socia', () => {
  const migrations = readAllMigrations();

  it('cria o enum retirada_socia_tipo com emprestimo e retirada', () => {
    expect(migrations).toMatch(/create type retirada_socia_tipo as enum \('emprestimo', 'retirada'\)/);
  });

  it('cria a tabela retiradas_socia com as colunas do contrato', () => {
    expect(migrations).toMatch(/create table public\.retiradas_socia/);
    for (const col of [
      'tipo', 'valor', 'data', 'descricao', 'metodo', 'parcelado',
      'total_parcelas', 'valor_parcela', 'primeira_parcela_em', 'convertido_em',
      'criado_por',
    ]) {
      expect(migrations).toContain(col);
    }
  });

  it('cria a tabela retiradas_socia_devolucoes ligada por retirada_id com cascade', () => {
    expect(migrations).toMatch(/create table public\.retiradas_socia_devolucoes/);
    expect(migrations).toMatch(/retirada_id\s+uuid not null references public\.retiradas_socia\(id\) on delete cascade/);
  });

  it('habilita RLS e cria policy owner-only nas duas tabelas', () => {
    expect(migrations).toMatch(/alter table public\.retiradas_socia enable row level security/);
    expect(migrations).toMatch(/alter table public\.retiradas_socia_devolucoes enable row level security/);
    const ownerCheck = /owner_id = auth\.uid\(\)/g;
    const matches = migrations.match(ownerCheck) ?? [];
    // pelo menos 4: using + with check, nas 2 tabelas
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run tests/unit/retiradas-socia-migration.test.ts`
Expected: FAIL — nenhuma migration casa os padrões.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/063_retiradas_socia.sql`:

```sql
-- ============================================================
-- MIGRATION 063 — retiradas e empréstimos da dona
--
-- A dona (owner) precisa registrar dinheiro tirado do estúdio como:
--   - emprestimo: devolve depois (avulso ou parcelado). Gera saldo devedor.
--   - retirada:   tira parte do lucro, sem gerar dívida.
--
-- Um registro em retiradas_socia; as devoluções de um empréstimo ficam em
-- retiradas_socia_devolucoes. Saldo, "quitado" e "parcela X de Y" são
-- SEMPRE derivados na exibição — nada disso é coluna.
--
-- 100% aditivo: nenhuma tabela/coluna/policy/trigger existente é tocada.
-- Nenhuma query de despesas/pagamentos/agendamentos/vendas/comissoes muda —
-- as linhas "Retiradas da dona" / "Resultado após retiradas" nos relatórios
-- leem só estas tabelas novas.
--
-- RLS: owner-only (mais restrito que despesas, que libera gestor). Um gestor
-- NÃO vê as retiradas da dona — decisão de produto, não bug.
--
-- metodo: reaproveita o enum public.pagamento_metodo (dinheiro/pix/credito/
-- debito/cortesia), igual à migration 062. Opcional nos dois sentidos.
-- ============================================================

create type retirada_socia_tipo as enum ('emprestimo', 'retirada');

create table public.retiradas_socia (
  id                  uuid primary key default uuid_generate_v4(),
  empresa_id          uuid not null references public.empresas(id) on delete cascade,
  tipo                retirada_socia_tipo not null,
  valor               numeric(10,2) not null check (valor > 0),
  data                date not null default current_date,
  descricao           text,
  metodo              public.pagamento_metodo,
  parcelado           boolean not null default false,
  total_parcelas      int  check (total_parcelas is null or total_parcelas >= 2),
  valor_parcela       numeric(10,2) check (valor_parcela is null or valor_parcela > 0),
  primeira_parcela_em date,
  convertido_em       date,
  criado_por          uuid references public.users(id),
  created_at          timestamptz default now()
);

create table public.retiradas_socia_devolucoes (
  id           uuid primary key default uuid_generate_v4(),
  retirada_id  uuid not null references public.retiradas_socia(id) on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  valor        numeric(10,2) not null check (valor > 0),
  data         date not null default current_date,
  metodo       public.pagamento_metodo,
  created_at   timestamptz default now()
);

create index idx_retiradas_socia_empresa_data on public.retiradas_socia(empresa_id, data);
create index idx_retiradas_socia_dev_retirada on public.retiradas_socia_devolucoes(retirada_id);

alter table public.retiradas_socia enable row level security;
alter table public.retiradas_socia_devolucoes enable row level security;

create policy "retiradas_socia: owner full"
  on public.retiradas_socia
  for all
  using (exists (
    select 1 from public.empresas e
    where e.id = retiradas_socia.empresa_id and e.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.empresas e
    where e.id = retiradas_socia.empresa_id and e.owner_id = auth.uid()
  ));

create policy "retiradas_socia_devolucoes: owner full"
  on public.retiradas_socia_devolucoes
  for all
  using (exists (
    select 1 from public.empresas e
    where e.id = retiradas_socia_devolucoes.empresa_id and e.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.empresas e
    where e.id = retiradas_socia_devolucoes.empresa_id and e.owner_id = auth.uid()
  ));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run tests/unit/retiradas-socia-migration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/063_retiradas_socia.sql web/tests/unit/retiradas-socia-migration.test.ts
git commit -m "feat(financeiro): migration 063 — tabelas de retiradas/empréstimos da dona (owner-only RLS)"
```

---

## Task 2: `shared/retiradas-socia.ts` — funções puras + testes

**Files:**
- Create: `shared/retiradas-socia.ts`
- Test: `web/tests/unit/retiradas-socia.test.ts`

**Interfaces:**
- Consumes: `dividirValorCompra` de `@shared/despesas` (para o valor-base da parcela).
- Produces (contrato para todas as tasks de UI):
  - `type MetodoPagamentoRetirada = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia'`
  - `type RetiradaSociaTipo = 'emprestimo' | 'retirada'`
  - `interface RetiradaSociaRow { id: string; tipo: RetiradaSociaTipo; valor: number; data: string; descricao: string | null; metodo: MetodoPagamentoRetirada | null; parcelado: boolean; total_parcelas: number | null; valor_parcela: number | null; primeira_parcela_em: string | null; convertido_em: string | null; created_at?: string }`
  - `interface RetiradaSociaDevolucaoRow { id: string; retirada_id: string; valor: number; data: string; metodo: MetodoPagamentoRetirada | null }`
  - `interface RetiradaSociaInsert { empresa_id: string; tipo: RetiradaSociaTipo; valor: number; data: string; descricao: string | null; metodo: MetodoPagamentoRetirada | null; parcelado: boolean; total_parcelas: number | null; valor_parcela: number | null; primeira_parcela_em: string | null; criado_por: string | null }`
  - `interface DevolucaoInsert { retirada_id: string; empresa_id: string; valor: number; data: string; metodo: MetodoPagamentoRetirada | null }`
  - `somaDevolucoesPorRetirada(devs: { retirada_id: string; valor: number }[]): Record<string, number>`
  - `saldoEmprestimo(valor: number, devolvido: number): number`
  - `retiradasNoPeriodo(rows: Pick<RetiradaSociaRow,'id'|'tipo'|'valor'|'data'|'convertido_em'>[], devolvidoPorRetirada: Record<string, number>, inicioIso: string, fimIso: string): number`
  - `saldoDevedorTotal(rows: Pick<RetiradaSociaRow,'id'|'tipo'|'valor'|'convertido_em'>[], devolvidoPorRetirada: Record<string, number>): number`
  - `somarMesesIso(iso: string, meses: number): string`
  - `statusParcela(valorParcela: number, primeiraParcelaEm: string, totalParcelas: number, devolvido: number, hojeIso: string): { parcelasQuitadas: number; proximaParcelaEm: string | null; atrasada: boolean }`
  - `montarRetiradaSociaInsert(form: RetiradaFormInput, criadoPor: string | null): { ok: true; payload: RetiradaSociaInsert } | { ok: false; erro: string }`
  - `montarDevolucaoInsert(retiradaId: string, empresaId: string, valorInput: string, data: string, metodo: MetodoPagamentoRetirada | null): { ok: true; payload: DevolucaoInsert } | { ok: false; erro: string }`
  - `type RetiradaFormInput = { empresaId: string; tipo: RetiradaSociaTipo; valorInput: string; data: string; descricao: string; metodo: MetodoPagamentoRetirada | null; parcelado: boolean; totalParcelasInput: string; valorParcelaInput: string; primeiraParcelaEm: string }`

- [ ] **Step 1: Write the failing tests**

Create `web/tests/unit/retiradas-socia.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  somaDevolucoesPorRetirada,
  saldoEmprestimo,
  retiradasNoPeriodo,
  saldoDevedorTotal,
  somarMesesIso,
  statusParcela,
  montarRetiradaSociaInsert,
  montarDevolucaoInsert,
} from '@shared/retiradas-socia';

describe('saldoEmprestimo', () => {
  it('subtrai o devolvido do valor', () => {
    expect(saldoEmprestimo(1000, 300)).toBe(700);
  });
  it('nunca fica negativo (pagamento a mais)', () => {
    expect(saldoEmprestimo(1000, 1200)).toBe(0);
  });
  it('arredonda para centavos', () => {
    expect(saldoEmprestimo(100, 33.333)).toBe(66.67);
  });
});

describe('somaDevolucoesPorRetirada', () => {
  it('agrupa e soma por retirada_id', () => {
    expect(somaDevolucoesPorRetirada([
      { retirada_id: 'a', valor: 100 },
      { retirada_id: 'a', valor: 50 },
      { retirada_id: 'b', valor: 20 },
    ])).toEqual({ a: 150, b: 20 });
  });
  it('lista vazia vira objeto vazio', () => {
    expect(somaDevolucoesPorRetirada([])).toEqual({});
  });
});

describe('retiradasNoPeriodo', () => {
  const devs = { emp1: 400 };
  const rows = [
    { id: 'ret1', tipo: 'retirada' as const,   valor: 500,  data: '2026-08-10', convertido_em: null },
    { id: 'ret2', tipo: 'retirada' as const,   valor: 999,  data: '2026-07-31', convertido_em: null }, // fora do período
    { id: 'emp1', tipo: 'emprestimo' as const, valor: 1000, data: '2026-05-01', convertido_em: '2026-08-20' }, // saldo 600 conta em ago
    { id: 'emp2', tipo: 'emprestimo' as const, valor: 300,  data: '2026-08-02', convertido_em: null }, // empréstimo aberto: não conta
  ];
  it('soma retiradas do período + saldo de empréstimos convertidos no período', () => {
    expect(retiradasNoPeriodo(rows, devs, '2026-08-01', '2026-08-31')).toBe(1100); // 500 + (1000-400)
  });
  it('ignora empréstimo convertido fora do período', () => {
    expect(retiradasNoPeriodo(rows, devs, '2026-09-01', '2026-09-30')).toBe(0);
  });
  it('período sem nada retorna 0', () => {
    expect(retiradasNoPeriodo([], {}, '2026-08-01', '2026-08-31')).toBe(0);
  });
});

describe('saldoDevedorTotal', () => {
  it('soma só empréstimos abertos (não convertidos), líquido das devoluções', () => {
    const rows = [
      { id: 'emp1', tipo: 'emprestimo' as const, valor: 1000, convertido_em: null },
      { id: 'emp2', tipo: 'emprestimo' as const, valor: 500,  convertido_em: null },
      { id: 'emp3', tipo: 'emprestimo' as const, valor: 800,  convertido_em: '2026-08-01' }, // convertido: fora
      { id: 'ret1', tipo: 'retirada' as const,   valor: 300,  convertido_em: null },          // retirada: fora
    ];
    expect(saldoDevedorTotal(rows, { emp1: 250 })).toBe(1250); // (1000-250) + 500
  });
  it('empréstimo totalmente quitado não soma', () => {
    const rows = [{ id: 'emp1', tipo: 'emprestimo' as const, valor: 1000, convertido_em: null }];
    expect(saldoDevedorTotal(rows, { emp1: 1000 })).toBe(0);
  });
});

describe('somarMesesIso', () => {
  it('soma meses mantendo o dia', () => {
    expect(somarMesesIso('2026-01-15', 2)).toBe('2026-03-15');
  });
  it('vira o ano', () => {
    expect(somarMesesIso('2026-11-10', 3)).toBe('2027-02-10');
  });
  it('faz clamp do dia em meses curtos', () => {
    expect(somarMesesIso('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('meses = 0 devolve a própria data', () => {
    expect(somarMesesIso('2026-06-05', 0)).toBe('2026-06-05');
  });
});

describe('statusParcela', () => {
  // empréstimo de 1200 em 3x de 400, 1ª parcela 2026-09-10
  it('nada devolvido: próxima parcela é a 1ª, atrasada se hoje já passou', () => {
    expect(statusParcela(400, '2026-09-10', 3, 0, '2026-09-15'))
      .toEqual({ parcelasQuitadas: 0, proximaParcelaEm: '2026-09-10', atrasada: true });
  });
  it('nada devolvido e ainda não venceu: não atrasada', () => {
    expect(statusParcela(400, '2026-09-10', 3, 0, '2026-09-01'))
      .toEqual({ parcelasQuitadas: 0, proximaParcelaEm: '2026-09-10', atrasada: false });
  });
  it('1 parcela paga: próxima vence 1 mês depois da 1ª', () => {
    expect(statusParcela(400, '2026-09-10', 3, 400, '2026-10-01'))
      .toEqual({ parcelasQuitadas: 1, proximaParcelaEm: '2026-10-10', atrasada: false });
  });
  it('pulou meses: conta as parcelas realmente cobertas pelo devolvido', () => {
    expect(statusParcela(400, '2026-09-10', 3, 800, '2026-12-01'))
      .toEqual({ parcelasQuitadas: 2, proximaParcelaEm: '2026-11-10', atrasada: true });
  });
  it('tudo quitado: sem próxima parcela, não atrasada', () => {
    expect(statusParcela(400, '2026-09-10', 3, 1200, '2027-01-01'))
      .toEqual({ parcelasQuitadas: 3, proximaParcelaEm: null, atrasada: false });
  });
  it('devolvido acima do total não passa de totalParcelas', () => {
    expect(statusParcela(400, '2026-09-10', 3, 5000, '2027-01-01').parcelasQuitadas).toBe(3);
  });
  it('valor não divisível: floor por parcela (R$1000 em 3x de 333,33)', () => {
    expect(statusParcela(333.33, '2026-09-10', 3, 333.33, '2026-09-01').parcelasQuitadas).toBe(1);
  });
});

describe('montarRetiradaSociaInsert', () => {
  const base = {
    empresaId: 'e1', data: '2026-08-30', descricao: 'uso pessoal',
    metodo: 'pix' as const, parcelado: false,
    totalParcelasInput: '', valorParcelaInput: '', primeiraParcelaEm: '',
  };
  it('retirada simples: zera todos os campos de parcela', () => {
    const r = montarRetiradaSociaInsert({ ...base, tipo: 'retirada', valorInput: '500,00' }, 'u1');
    expect(r).toEqual({ ok: true, payload: {
      empresa_id: 'e1', tipo: 'retirada', valor: 500, data: '2026-08-30',
      descricao: 'uso pessoal', metodo: 'pix', parcelado: false,
      total_parcelas: null, valor_parcela: null, primeira_parcela_em: null, criado_por: 'u1',
    }});
  });
  it('empréstimo avulso: parcelado false, campos de parcela null', () => {
    const r = montarRetiradaSociaInsert({ ...base, tipo: 'emprestimo', valorInput: '1000' }, 'u1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({ tipo: 'emprestimo', parcelado: false, total_parcelas: null });
  });
  it('empréstimo parcelado: valor_parcela default = valor-base (centavos)', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '3', valorParcelaInput: '', primeiraParcelaEm: '2026-09-10',
    }, 'u1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({
      parcelado: true, total_parcelas: 3, valor_parcela: 333.33, primeira_parcela_em: '2026-09-10',
    });
  });
  it('empréstimo parcelado respeita valor_parcela informado', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '4', valorParcelaInput: '250,00', primeiraParcelaEm: '2026-09-10',
    }, 'u1');
    if (r.ok) expect(r.payload.valor_parcela).toBe(250);
    else throw new Error('esperava ok');
  });
  it('rejeita valor <= 0', () => {
    expect(montarRetiradaSociaInsert({ ...base, tipo: 'retirada', valorInput: '0' }, 'u1'))
      .toEqual({ ok: false, erro: expect.stringContaining ? expect.any(String) : expect.any(String) });
  });
  it('rejeita parcelado sem total de parcelas', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '', primeiraParcelaEm: '2026-09-10',
    }, 'u1');
    expect(r.ok).toBe(false);
  });
  it('rejeita parcelado com menos de 2 parcelas', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '1', primeiraParcelaEm: '2026-09-10',
    }, 'u1');
    expect(r.ok).toBe(false);
  });
  it('rejeita parcelado sem data da 1ª parcela', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '3', primeiraParcelaEm: '',
    }, 'u1');
    expect(r.ok).toBe(false);
  });
  it('descrição vazia vira null', () => {
    const r = montarRetiradaSociaInsert({ ...base, descricao: '  ', tipo: 'retirada', valorInput: '10' }, 'u1');
    if (r.ok) expect(r.payload.descricao).toBeNull();
  });
});

describe('montarDevolucaoInsert', () => {
  it('monta payload de devolução', () => {
    expect(montarDevolucaoInsert('r1', 'e1', '150,00', '2026-08-30', 'dinheiro')).toEqual({
      ok: true, payload: { retirada_id: 'r1', empresa_id: 'e1', valor: 150, data: '2026-08-30', metodo: 'dinheiro' },
    });
  });
  it('rejeita valor invalido', () => {
    expect(montarDevolucaoInsert('r1', 'e1', 'abc', '2026-08-30', null).ok).toBe(false);
  });
  it('rejeita valor zero', () => {
    expect(montarDevolucaoInsert('r1', 'e1', '0', '2026-08-30', null).ok).toBe(false);
  });
});
```

> Nota: no teste de "rejeita valor <= 0" acima, simplifique a asserção para `expect(r.ok).toBe(false)` — o `expect.stringContaining` ternário foi escrito só para não travar em detalhe de mensagem. O que importa é `ok === false` e `erro` ser uma string não vazia.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run tests/unit/retiradas-socia.test.ts`
Expected: FAIL — `Cannot find module '@shared/retiradas-socia'`.

- [ ] **Step 3: Write the implementation**

Create `shared/retiradas-socia.ts`:

```typescript
import { parseValorMonetario } from './despesas';
import { dividirValorCompra } from './despesas';

export type MetodoPagamentoRetirada = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
export type RetiradaSociaTipo = 'emprestimo' | 'retirada';

export interface RetiradaSociaRow {
  id: string;
  tipo: RetiradaSociaTipo;
  valor: number;
  data: string;                       // YYYY-MM-DD
  descricao: string | null;
  metodo: MetodoPagamentoRetirada | null;
  parcelado: boolean;
  total_parcelas: number | null;
  valor_parcela: number | null;
  primeira_parcela_em: string | null; // YYYY-MM-DD
  convertido_em: string | null;       // YYYY-MM-DD
  created_at?: string;
}

export interface RetiradaSociaDevolucaoRow {
  id: string;
  retirada_id: string;
  valor: number;
  data: string;
  metodo: MetodoPagamentoRetirada | null;
}

export interface RetiradaSociaInsert {
  empresa_id: string;
  tipo: RetiradaSociaTipo;
  valor: number;
  data: string;
  descricao: string | null;
  metodo: MetodoPagamentoRetirada | null;
  parcelado: boolean;
  total_parcelas: number | null;
  valor_parcela: number | null;
  primeira_parcela_em: string | null;
  criado_por: string | null;
}

export interface DevolucaoInsert {
  retirada_id: string;
  empresa_id: string;
  valor: number;
  data: string;
  metodo: MetodoPagamentoRetirada | null;
}

export type RetiradaFormInput = {
  empresaId: string;
  tipo: RetiradaSociaTipo;
  valorInput: string;
  data: string;
  descricao: string;
  metodo: MetodoPagamentoRetirada | null;
  parcelado: boolean;
  totalParcelasInput: string;
  valorParcelaInput: string;
  primeiraParcelaEm: string;
};

const cent = (v: number) => Math.round(v * 100) / 100;

/** Soma as devoluções por retirada_id. */
export function somaDevolucoesPorRetirada(
  devs: { retirada_id: string; valor: number }[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const d of devs) map[d.retirada_id] = cent((map[d.retirada_id] ?? 0) + d.valor);
  return map;
}

/** Saldo de um empréstimo: valor − devolvido, nunca negativo. */
export function saldoEmprestimo(valor: number, devolvido: number): number {
  return Math.max(0, cent(valor - devolvido));
}

/**
 * Total que conta como "retirada da dona" no período:
 *   - retiradas definitivas com `data` no período;
 *   - empréstimos convertidos em retirada (`convertido_em` no período): entra o
 *     saldo em aberto no momento da conversão (valor − devolvido).
 * Empréstimos ainda abertos NÃO entram aqui (ver saldoDevedorTotal).
 */
export function retiradasNoPeriodo(
  rows: Pick<RetiradaSociaRow, 'id' | 'tipo' | 'valor' | 'data' | 'convertido_em'>[],
  devolvidoPorRetirada: Record<string, number>,
  inicioIso: string,
  fimIso: string,
): number {
  let total = 0;
  for (const r of rows) {
    if (r.tipo === 'retirada') {
      if (r.data >= inicioIso && r.data <= fimIso) total += r.valor;
    } else if (r.convertido_em && r.convertido_em >= inicioIso && r.convertido_em <= fimIso) {
      total += Math.max(0, r.valor - (devolvidoPorRetirada[r.id] ?? 0));
    }
  }
  return cent(total);
}

/**
 * Saldo devedor total da dona: soma dos empréstimos ainda abertos (não
 * convertidos) líquidos das devoluções. Não é preso a período — é um saldo.
 */
export function saldoDevedorTotal(
  rows: Pick<RetiradaSociaRow, 'id' | 'tipo' | 'valor' | 'convertido_em'>[],
  devolvidoPorRetirada: Record<string, number>,
): number {
  let total = 0;
  for (const r of rows) {
    if (r.tipo === 'emprestimo' && !r.convertido_em) {
      total += Math.max(0, r.valor - (devolvidoPorRetirada[r.id] ?? 0));
    }
  }
  return cent(total);
}

/**
 * Soma `meses` a uma data YYYY-MM-DD, mantendo o dia e fazendo clamp quando o
 * mês alvo é mais curto (31/01 + 1 mês → 28/02). Mesma lógica de clamp de
 * `calcularRecorrenciaAtePorParcelas` em shared/despesas.ts — mantida aqui
 * para não acoplar os dois módulos por um primitivo de data de 5 linhas.
 */
export function somarMesesIso(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const anoAlvo = ano + Math.floor((mes - 1 + meses) / 12);
  const mesAlvo = (((mes - 1 + meses) % 12) + 12) % 12;
  const ultimoDia = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  const diaAlvo = Math.min(dia, ultimoDia);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${anoAlvo}-${pad(mesAlvo + 1)}-${pad(diaAlvo)}`;
}

/**
 * Estado do cronograma de um empréstimo parcelado, derivado do total devolvido.
 * `parcelasQuitadas = floor(devolvido / valorParcela)` (com epsilon p/ float),
 * limitado a `totalParcelas`. A próxima parcela vence `parcelasQuitadas` meses
 * depois da 1ª (robusto a meses pulados — conta pelo que foi devolvido, não
 * incrementa fixo). `atrasada` quando hoje já passou dessa data.
 */
export function statusParcela(
  valorParcela: number,
  primeiraParcelaEm: string,
  totalParcelas: number,
  devolvido: number,
  hojeIso: string,
): { parcelasQuitadas: number; proximaParcelaEm: string | null; atrasada: boolean } {
  const quitadas = Math.min(
    Math.floor(devolvido / valorParcela + 1e-6),
    totalParcelas,
  );
  if (quitadas >= totalParcelas) {
    return { parcelasQuitadas: totalParcelas, proximaParcelaEm: null, atrasada: false };
  }
  const proximaParcelaEm = somarMesesIso(primeiraParcelaEm, quitadas);
  return {
    parcelasQuitadas: quitadas,
    proximaParcelaEm,
    atrasada: hojeIso > proximaParcelaEm,
  };
}

/**
 * Valida e monta o payload de insert de retiradas_socia a partir do formulário.
 * Retorna `{ ok: false, erro }` com mensagem em pt-BR quando algo impede o
 * registro — a UI mostra `erro` e não salva (mesmo padrão das validações de
 * despesas parceladas). Campos de parcela só valem para tipo='emprestimo'
 * com `parcelado = true`; em qualquer outro caso vão zerados.
 */
export function montarRetiradaSociaInsert(
  form: RetiradaFormInput,
  criadoPor: string | null,
): { ok: true; payload: RetiradaSociaInsert } | { ok: false; erro: string } {
  const valor = parseValorMonetario(form.valorInput);
  if (valor === null) return { ok: false, erro: 'Informe um valor maior que zero.' };
  if (!form.data) return { ok: false, erro: 'Informe a data.' };

  const ehEmprestimoParcelado = form.tipo === 'emprestimo' && form.parcelado;

  let total_parcelas: number | null = null;
  let valor_parcela: number | null = null;
  let primeira_parcela_em: string | null = null;

  if (ehEmprestimoParcelado) {
    const n = Number(form.totalParcelasInput);
    if (!Number.isInteger(n) || n < 2) {
      return { ok: false, erro: 'O número de parcelas deve ser 2 ou mais.' };
    }
    if (!form.primeiraParcelaEm) {
      return { ok: false, erro: 'Informe a data da primeira parcela.' };
    }
    total_parcelas = n;
    primeira_parcela_em = form.primeiraParcelaEm;
    const informado = parseValorMonetario(form.valorParcelaInput);
    valor_parcela = informado ?? dividirValorCompra(valor, n).valorBase;
  }

  return {
    ok: true,
    payload: {
      empresa_id: form.empresaId,
      tipo: form.tipo,
      valor,
      data: form.data,
      descricao: form.descricao.trim() || null,
      metodo: form.metodo,
      parcelado: ehEmprestimoParcelado,
      total_parcelas,
      valor_parcela,
      primeira_parcela_em,
      criado_por: criadoPor,
    },
  };
}

/** Valida e monta o payload de uma devolução de empréstimo. */
export function montarDevolucaoInsert(
  retiradaId: string,
  empresaId: string,
  valorInput: string,
  data: string,
  metodo: MetodoPagamentoRetirada | null,
): { ok: true; payload: DevolucaoInsert } | { ok: false; erro: string } {
  const valor = parseValorMonetario(valorInput);
  if (valor === null) return { ok: false, erro: 'Informe um valor maior que zero.' };
  if (!data) return { ok: false, erro: 'Informe a data.' };
  return { ok: true, payload: { retirada_id: retiradaId, empresa_id: empresaId, valor, data, metodo } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run tests/unit/retiradas-socia.test.ts`
Expected: PASS. Fix the one asserção frágil citada na nota (`expect(r.ok).toBe(false)`).

- [ ] **Step 5: Run the full suite + tsc**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: tudo passa, zero erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add shared/retiradas-socia.ts web/tests/unit/retiradas-socia.test.ts
git commit -m "feat(financeiro): funções puras de saldo/parcela/agregado de retiradas da dona"
```

---

## Task 3: Web — tipos compartilhados + fetch de `isOwner` no Financeiro

**Files:**
- Modify: `web/types/index.ts` (adicionar re-exports)
- Modify: `web/app/(app)/financeiro/page.tsx` (state `isOwner` + fetch)

**Interfaces:**
- Consumes: `RetiradaSociaRow`, `RetiradaSociaDevolucaoRow` de `@shared/retiradas-socia` (Task 2).
- Produces: `RetiradaSocia`, `RetiradaSociaDevolucao` exportados de `@/types`; estado `isOwner: boolean` e `ownerId` disponíveis no componente `FinanceiroPage`.

- [ ] **Step 1: Add the type re-exports**

Em `web/types/index.ts`, adicionar perto dos outros exports de domínio:

```typescript
export type {
  RetiradaSociaRow as RetiradaSocia,
  RetiradaSociaDevolucaoRow as RetiradaSociaDevolucao,
  RetiradaSociaTipo,
  MetodoPagamentoRetirada,
} from '@shared/retiradas-socia';
```

- [ ] **Step 2: Add `isOwner` fetch in Financeiro**

Em `web/app/(app)/financeiro/page.tsx`:

1. Adicionar estado perto de `const [empresaId,setEmpresaId]= useState<string | null>(null);` (linha ~689):

```typescript
  const [isOwner, setIsOwner] = useState(false);
```

2. No `useEffect` de bootstrap (linhas ~722-730), depois de `setEmpresaId(membro.empresa_id)`, buscar o `owner_id`:

```typescript
      if (membro) {
        setEmpresaId(membro.empresa_id);
        const { data: emp } = await supabase.from('empresas')
          .select('owner_id').eq('id', membro.empresa_id).single();
        setIsOwner(!!emp && emp.owner_id === user.id);
      }
```

- [ ] **Step 3: Verify tsc**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros. (Ainda não há UI nova; `isOwner` fica não-usado até a Task 4 — o TS não reclama de state não lido, mas se algum lint falhar, seguir para a Task 4 no mesmo commit.)

- [ ] **Step 4: Commit**

```bash
git add web/types/index.ts web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): expõe tipos de retirada da dona e detecta owner na página"
```

---

## Task 4: Web — seção "Retiradas da dona" no Financeiro (leitura)

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `isOwner`, `empresaId`, `mesRef` (já no componente); `somaDevolucoesPorRetirada`, `saldoEmprestimo`, `saldoDevedorTotal`, `retiradasNoPeriodo`, `statusParcela` de `@shared/retiradas-socia`; `METODO_CFG` (já no arquivo, linha ~98); `getMonthQueryBounds` (já importado).
- Produces: state `retiradas: RetiradaSocia[]`, `retiradasDevs: RetiradaSociaDevolucao[]`; a seção `<section>` renderizada só quando `isOwner`; função `carregarRetiradas()` chamável pelo `recarregar()`.

- [ ] **Step 1: Add state + load**

1. State perto dos outros (linha ~705):

```typescript
  const [retiradas,      setRetiradas]      = useState<RetiradaSocia[]>([]);
  const [retiradasDevs,  setRetiradasDevs]  = useState<RetiradaSociaDevolucao[]>([]);
```

2. Import no topo (junto do import de `@shared/despesas`):

```typescript
import {
  somaDevolucoesPorRetirada, saldoEmprestimo, saldoDevedorTotal,
  retiradasNoPeriodo, statusParcela,
} from '@shared/retiradas-socia';
import type { RetiradaSocia, RetiradaSociaDevolucao } from '@/types';
```

3. Dentro de `carregar(...)` (a função que roda no `useEffect` de `[empresaId, mesRef]`), adicionar ao `Promise.all` existente duas queries — **guardadas por owner**. Como o `Promise.all` já existe, o jeito mais simples é: logo após o `Promise.all` principal, um bloco condicional:

```typescript
    // Retiradas/empréstimos da dona — só o owner enxerga (RLS + guarda de UI).
    if (isOwner) {
      const { inicio, fim } = getMonthQueryBounds(mesRef); // mesmos limites usados no resto da página
      const dateIni = inicio.slice(0, 10);
      const dateFim = fim.slice(0, 10);
      const [rRet, rDev] = await Promise.all([
        supabase.from('retiradas_socia')
          .select('id,tipo,valor,data,descricao,metodo,parcelado,total_parcelas,valor_parcela,primeira_parcela_em,convertido_em,created_at')
          .eq('empresa_id', empId)
          .or(`and(data.gte.${dateIni},data.lte.${dateFim}),and(convertido_em.gte.${dateIni},convertido_em.lte.${dateFim})`)
          .order('data', { ascending: false }),
        // devoluções de TODOS os empréstimos (o saldo devedor é histórico, não do mês)
        supabase.from('retiradas_socia_devolucoes')
          .select('id,retirada_id,valor,data,metodo')
          .eq('empresa_id', empId),
      ]);
      setRetiradas((rRet.data ?? []) as RetiradaSocia[]);
      setRetiradasDevs((rDev.data ?? []) as RetiradaSociaDevolucao[]);
    } else {
      setRetiradas([]);
      setRetiradasDevs([]);
    }
```

> Se `getMonthQueryBounds` não retornar strings ISO, usar o mesmo cálculo de limites que a página já faz para `despesas` (procure `data_pagamento` no `carregar` e reaproveite `dateIni`/`dateFim`). O importante: a lista mostra retiradas com `data` **ou** `convertido_em` no mês selecionado; as devoluções vêm todas (sem filtro de mês), porque o card "a dona deve" é histórico.

4. Fazer `carregar` depender de `isOwner`: adicionar `isOwner` ao array de deps do `useEffect` que chama `carregar` (linha ~732-735).

- [ ] **Step 2: Add derived values (no render body, antes do `return`)**

```typescript
  const devPorRetirada   = somaDevolucoesPorRetirada(retiradasDevs);
  const aDonaDeve        = saldoDevedorTotal(retiradas, devPorRetirada);
  const retiradasMes     = (() => {
    const b = getMonthQueryBounds(mesRef);
    return retiradasNoPeriodo(retiradas, devPorRetirada, b.inicio.slice(0,10), b.fim.slice(0,10));
  })();
```

- [ ] **Step 3: Render the section**

Logo depois do bloco `{taxasReserva.length > 0 && ( ... )}` (termina ~linha 1520), adicionar. Seguir **exatamente** o padrão visual da seção "Taxas de Reserva" (card branco, header `font-serif text-lg`, linhas com `border-b border-border`):

```tsx
        {isOwner && (
          <section className="bm-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <p className="font-serif text-lg text-text">Retiradas da dona</p>
                <span className="text-xs text-text-4">
                  {aDonaDeve > 0
                    ? `A dona deve ao estúdio: ${fmtBRL(aDonaDeve)}`
                    : 'Nenhum empréstimo em aberto'}
                  {retiradasMes > 0 && ` · Retiradas definitivas no mês: ${fmtBRL(retiradasMes)}`}
                </span>
              </div>
              <button
                onClick={() => setModalRetirada(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-accent text-white text-sm font-semibold">
                <Plus size={16} /> Registrar
              </button>
            </div>

            {retiradas.length === 0 ? (
              <p className="px-4 py-6 text-sm text-text-4">Nenhuma retirada ou empréstimo neste mês.</p>
            ) : retiradas.map((r, i) => {
              const devolvido = devPorRetirada[r.id] ?? 0;
              const saldo = saldoEmprestimo(r.valor, devolvido);
              const parc = (r.tipo === 'emprestimo' && r.parcelado && r.valor_parcela && r.primeira_parcela_em)
                ? statusParcela(r.valor_parcela, r.primeira_parcela_em, r.total_parcelas ?? 0, devolvido, new Date().toISOString().slice(0,10))
                : null;
              const quitado = r.tipo === 'emprestimo' && (!!r.convertido_em || saldo <= 0);
              return (
                <div key={r.id} className={`px-4 py-3 ${i < retiradas.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded ${r.tipo === 'emprestimo' ? 'bg-indigo-50 text-indigo-700' : 'bg-rose-50 text-rose-700'}`}>
                        {r.tipo === 'emprestimo' ? 'Empréstimo' : 'Retirada'}
                      </span>
                      <span className="ml-2 font-semibold text-text">{fmtBRL(r.valor)}</span>
                      <span className="ml-2 text-xs text-text-4">
                        {format(new Date(r.data + 'T00:00:00'), 'dd/MM/yyyy')}
                        {r.metodo && METODO_CFG[r.metodo] && ` · ${METODO_CFG[r.metodo].label}`}
                      </span>
                      {r.descricao && <p className="text-xs text-text-3 truncate">{r.descricao}</p>}
                      {r.tipo === 'emprestimo' && !r.convertido_em && (
                        <p className="text-xs text-text-4 mt-0.5">
                          Devolvido {fmtBRL(devolvido)} de {fmtBRL(r.valor)} · saldo {fmtBRL(saldo)}
                          {parc && ` · Parcela ${parc.parcelasQuitadas + (parc.proximaParcelaEm ? 1 : 0)}/${r.total_parcelas}`}
                          {parc?.atrasada && <span className="ml-1 text-rose-600 font-semibold">atrasada</span>}
                        </p>
                      )}
                      {r.convertido_em && (
                        <p className="text-xs text-text-4 mt-0.5">
                          Convertido em retirada ({format(new Date(r.convertido_em + 'T00:00:00'), 'dd/MM/yyyy')})
                        </p>
                      )}
                      {quitado && !r.convertido_em && <p className="text-xs text-emerald-600 font-semibold mt-0.5">Quitado</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {r.tipo === 'emprestimo' && !quitado && (
                        <>
                          <button onClick={() => setDevolucaoDe(r)} title="Registrar devolução"
                            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-bg-2"><RefreshCw size={15} /></button>
                          <button onClick={() => setConverterEmRetirada(r)} title="Converter saldo em retirada"
                            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-bg-2"><Ban size={15} /></button>
                        </>
                      )}
                      <button onClick={() => setEditarRetirada(r)} title="Editar"
                        className="h-8 w-8 grid place-items-center rounded-lg hover:bg-bg-2"><Pencil size={15} /></button>
                      <button onClick={() => setExcluirRetirada(r)} title="Excluir"
                        className="h-8 w-8 grid place-items-center rounded-lg hover:bg-bg-2 text-rose-600"><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}
```

> Os `setModalRetirada` / `setDevolucaoDe` / `setConverterEmRetirada` / `setEditarRetirada` / `setExcluirRetirada` são criados na Task 5/6. Para esta task compilar sozinha, declare os states agora (todos default `null`/`false`) e deixe os modais para as próximas tasks — a seção já renderiza a lista, o card e o estado vazio.

```typescript
  const [modalRetirada,       setModalRetirada]       = useState(false);
  const [editarRetirada,      setEditarRetirada]      = useState<RetiradaSocia | null>(null);
  const [devolucaoDe,         setDevolucaoDe]         = useState<RetiradaSocia | null>(null);
  const [converterEmRetirada, setConverterEmRetirada] = useState<RetiradaSocia | null>(null);
  const [excluirRetirada,     setExcluirRetirada]     = useState<RetiradaSocia | null>(null);
```

- [ ] **Step 4: Wire `recarregar()`**

Garantir que `recarregar()` (linha ~979) re-dispara a carga de retiradas — como ela chama `carregar(empresaId, mesRef)` e a query nova está dentro de `carregar`, já funciona. Confirmar lendo a função.

- [ ] **Step 5: Verify**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros, testes passam.

Verificação visual (preview): subir o dev server (`preview_start` com o nome do dev server em `.claude/launch.json`), abrir o Financeiro. Sem login de teste disponível, a verificação fica limitada — registrar na PR que a seção compila e segue o padrão das outras, e que o teste visual real depende de conta.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): seção 'Retiradas da dona' — card de saldo devedor + lista do mês"
```

---

## Task 5: Web — modais "Registrar" e "Editar" retirada

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `montarRetiradaSociaInsert` de `@shared/retiradas-socia`; `parseValorMonetario`, `formatValorMonetarioInput`, `dividirValorCompra` de `@shared/despesas`; `inputClass`, `labelClass`, `METODO_CFG` (no arquivo); `useScrollLock` (importado); states `modalRetirada`, `editarRetirada` (Task 4).
- Produces: componentes `RetiradaModal` (usado tanto para novo quanto edição) montado no JSX quando `modalRetirada || editarRetirada`.

- [ ] **Step 1: Build the modal component**

Adicionar um componente `RetiradaModal` no arquivo (perto de `NovaDespesaModal`, ~linha 111). Seguir a estrutura visual de `NovaDespesaModal` (overlay `fixed inset-0 bg-black/40`, card centralizado, `useScrollLock()`, botão X, footer com Cancelar/Salvar, `erro` em vermelho). Campos:

- Toggle **Empréstimo / Retirada** — dois botões estilo "chip" (mesmo visual do toggle de `modoRepeticao`/`PERIODICIDADES` em `NovaDespesaModal`). Desabilitado quando `editando` (não deixa trocar tipo — ver Global Constraints).
- **Valor** — `inputClass`, máscara BRL (reusar o mesmo `onChange` que `NovaDespesaModal` usa: dígitos → `formatValorMonetarioInput`).
- **Data** — `<input type="date">`, default `new Date().toISOString().slice(0,10)`.
- **Descrição** — `inputClass`, opcional.
- **Método** — `<select>` com `''` + as 5 chaves de `METODO_CFG` (`METODO_CFG[k].label`), opcional.
- Se `tipo === 'emprestimo'`: toggle **"Devolução avulsa" / "Em parcelas"** (`parcelado` bool).
  - Se `parcelado`: **Nº de parcelas** (`type="number"`, min 2), **Valor da parcela** (`inputClass`, default = `dividirValorCompra(valorNum, n).valorBase` formatado, editável), **1ª parcela em** (`type="date"`, default = mesmo dia do mês seguinte à `data`).

Ao salvar:

```typescript
    const criadoPor = (await supabase.auth.getUser()).data.user?.id ?? null;
    const built = montarRetiradaSociaInsert({
      empresaId, tipo, valorInput: valor, data, descricao, metodo: metodo || null,
      parcelado: tipo === 'emprestimo' && parcelado,
      totalParcelasInput: totalParcelas, valorParcelaInput: valorParcela,
      primeiraParcelaEm: primeiraParcela,
    }, criadoPor);
    if (!built.ok) { setErro(built.erro); return; }

    setSalvando(true);
    if (editando) {
      // edição: NÃO reenvia tipo nem criado_por
      const { tipo: _t, criado_por: _c, empresa_id: _e, ...upd } = built.payload;
      const { error } = await supabase.from('retiradas_socia')
        .update(upd).eq('id', editando.id).select('id');
      if (error) { setErro('Não foi possível salvar. Verifique se você é a dona da conta.'); setSalvando(false); return; }
    } else {
      const { error } = await supabase.from('retiradas_socia').insert(built.payload).select('id');
      if (error) { setErro('Não foi possível salvar. Verifique se você é a dona da conta.'); setSalvando(false); return; }
    }
    setSalvando(false);
    onSalvo(); // = () => { setModalRetirada(false); setEditarRetirada(null); recarregar(); }
```

Ao abrir em modo edição, pré-preencher os campos a partir de `editarRetirada` (`formatValorMonetarioInput(r.valor)`, `r.data`, `r.descricao ?? ''`, `r.metodo ?? ''`, `r.parcelado`, `String(r.total_parcelas ?? '')`, `r.valor_parcela ? formatValorMonetarioInput(r.valor_parcela) : ''`, `r.primeira_parcela_em ?? ''`).

- [ ] **Step 2: Mount in JSX**

Perto dos outros modais no final do `return` (onde estão `{modalDespesa && <NovaDespesaModal .../>}` etc.):

```tsx
      {(modalRetirada || editarRetirada) && (
        <RetiradaModal
          empresaId={empresaId!}
          editando={editarRetirada}
          onClose={() => { setModalRetirada(false); setEditarRetirada(null); }}
          onSalvo={() => { setModalRetirada(false); setEditarRetirada(null); recarregar(); }}
        />
      )}
```

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros, testes passam.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): modal de registrar/editar retirada e empréstimo da dona"
```

---

## Task 6: Web — devolução, converter em retirada, excluir

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `montarDevolucaoInsert`, `saldoEmprestimo` de `@shared/retiradas-socia`; states `devolucaoDe`, `converterEmRetirada`, `excluirRetirada` (Task 4); `devPorRetirada` (Task 4).
- Produces: 3 modais montados no JSX.

- [ ] **Step 1: Modal "Registrar devolução"**

Componente `DevolucaoModal` (props: `retirada: RetiradaSocia`, `saldo: number`, `onClose`, `onSalvo`). Campos: **Valor** (default = `retirada.valor_parcela && saldo > 0 ? formatValorMonetarioInput(Math.min(retirada.valor_parcela, saldo)) : formatValorMonetarioInput(saldo)`), **Data** (default hoje), **Método** (opcional). Aviso quando `parseValorMonetario(valor)! > saldo`: texto "Isso quita o empréstimo e sobra R$ X." (não bloqueia).

Salvar:

```typescript
    const built = montarDevolucaoInsert(retirada.id, empresaId, valor, data, metodo || null);
    if (!built.ok) { setErro(built.erro); return; }
    setSalvando(true);
    const { error } = await supabase.from('retiradas_socia_devolucoes').insert(built.payload).select('id');
    if (error) { setErro('Não foi possível salvar. Verifique se você é a dona da conta.'); setSalvando(false); return; }
    setSalvando(false); onSalvo();
```

- [ ] **Step 2: Modal "Converter saldo em retirada"**

Componente `ConverterModal` (props: `retirada`, `saldo`, `onClose`, `onSalvo`). Confirmação simples: "O saldo de R$ {saldo} deste empréstimo vira uma retirada definitiva na data de hoje. Isso sai do 'a dona deve' e passa a contar em 'Retiradas da dona' no mês atual. Continuar?"

Confirmar:

```typescript
    const { error } = await supabase.from('retiradas_socia')
      .update({ convertido_em: new Date().toISOString().slice(0,10) })
      .eq('id', retirada.id).select('id');
    if (error) { setErro('Não foi possível converter. Verifique se você é a dona da conta.'); return; }
    onSalvo();
```

- [ ] **Step 3: Modal "Excluir"**

Reusar o padrão de confirmação de exclusão de despesa. Confirmar:

```typescript
    const { error } = await supabase.from('retiradas_socia').delete().eq('id', retirada.id).select('id');
    if (error) { setErro('Não foi possível excluir. Verifique se você é a dona da conta.'); return; }
    onSalvo(); // recarregar()
```

(`on delete cascade` remove as devoluções.)

- [ ] **Step 4: Mount all three in JSX**

```tsx
      {devolucaoDe && (
        <DevolucaoModal retirada={devolucaoDe}
          saldo={saldoEmprestimo(devolucaoDe.valor, devPorRetirada[devolucaoDe.id] ?? 0)}
          onClose={() => setDevolucaoDe(null)}
          onSalvo={() => { setDevolucaoDe(null); recarregar(); }} />
      )}
      {converterEmRetirada && (
        <ConverterModal retirada={converterEmRetirada}
          saldo={saldoEmprestimo(converterEmRetirada.valor, devPorRetirada[converterEmRetirada.id] ?? 0)}
          onClose={() => setConverterEmRetirada(null)}
          onSalvo={() => { setConverterEmRetirada(null); recarregar(); }} />
      )}
      {excluirRetirada && (
        <ExcluirRetiradaModal retirada={excluirRetirada}
          onClose={() => setExcluirRetirada(null)}
          onSalvo={() => { setExcluirRetirada(null); recarregar(); }} />
      )}
```

- [ ] **Step 5: Verify**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros, testes passam.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat(financeiro): devolução, conversão em retirada e exclusão de empréstimo da dona"
```

---

## Task 7: Web — Relatórios: "Resultado após retiradas"

**Files:**
- Modify: `web/app/(app)/relatorios/page.tsx`

**Interfaces:**
- Consumes: `retiradasNoPeriodo`, `somaDevolucoesPorRetirada` de `@shared/retiradas-socia`; `empresaId`, `inicio`, `fim` (no componente); `lucro` (linha 582).
- Produces: `retiradasPeriodo` (número), KPI "Resultado após retiradas", linha no detalhamento, coluna no export — todos guardados por `isOwner`.

- [ ] **Step 1: Detectar owner**

No `useEffect` que busca `empresa_membros` (linha ~367), buscar também `owner_id` e guardar `isOwner`:

```typescript
      if (data) {
        setEmpresaId(data.empresa_id);
        const { data: emp } = await supabase.from('empresas').select('owner_id').eq('id', data.empresa_id).single();
        setIsOwner(!!emp && emp.owner_id === /* user.id do escopo acima */ userId);
      }
```

(adicionar `const [isOwner, setIsOwner] = useState(false);` perto de `empresaId`.)

- [ ] **Step 2: Query owner-guarded**

Dentro de `carregar(...)` (linha ~412), adicionar ao `Promise.all` (linha ~420) — ou logo após — duas queries condicionais a `isOwner`, buscando `retiradas_socia` com `data` OU `convertido_em` no período e `retiradas_socia_devolucoes` (todas). Guardar em state `retiradasRows` / `retiradasDevsRows` (default `[]`). Quando `!isOwner`, setar `[]`.

- [ ] **Step 3: Derived value + KPI**

Perto de `const lucro = liquidoAposTaxas - comTot - despTot;` (linha 582):

```typescript
  const retiradasPeriodo = useMemo(() => {
    if (!isOwner) return 0;
    const devMap = somaDevolucoesPorRetirada(retiradasDevsRows);
    return retiradasNoPeriodo(retiradasRows, devMap, format(inicio, 'yyyy-MM-dd'), format(fim, 'yyyy-MM-dd'));
  }, [isOwner, retiradasRows, retiradasDevsRows, inicio, fim]);
  const resultadoAposRetiradas = lucro - retiradasPeriodo;
```

Adicionar um `KpiCard` logo depois do de "Lucro real" (linha 960), só quando `isOwner && retiradasPeriodo > 0`:

```tsx
        {isOwner && retiradasPeriodo > 0 && (
          <KpiCard icon={Activity} label="Resultado após retiradas"
            value={fmtBRL(resultadoAposRetiradas)}
            cor={resultadoAposRetiradas >= 0 ? '#0D7E5F' : '#DC2626'} loading={loading} />
        )}
```

- [ ] **Step 4: Linha no detalhamento + export**

No bloco de detalhamento perto da linha "Lucro real" (linha ~1050), adicionar, quando `isOwner && retiradasPeriodo > 0`, uma linha "(−) Retiradas da dona" com `fmtBRL(retiradasPeriodo)` e, abaixo, "Resultado após retiradas" com `fmtBRL(resultadoAposRetiradas)`.

Se a página monta linhas de export (procure onde `lucro` entra no array do `ExportButton`/`export.ts`), adicionar as duas linhas no mesmo array, condicionais a `isOwner`.

- [ ] **Step 5: Verify**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros, testes passam.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/relatorios/page.tsx
git commit -m "feat(relatorios): KPI 'Resultado após retiradas' + linha de retiradas da dona (owner)"
```

---

## Task 8: Web — Dashboard: "Após retiradas" + card de empréstimos

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `retiradasNoPeriodo`, `saldoDevedorTotal`, `somaDevolucoesPorRetirada` de `@shared/retiradas-socia`; `empresaId`, `user`, `inicioMes`, `fimMes` (Server Component, linhas ~120-210); `lucro` (linha 204).
- Produces: `retiradasMes`, `emprestimosAbertos`; sub-linha "Após retiradas: R$ Y" abaixo do KPI "Lucro do mês"; card "Empréstimos da dona em aberto: R$ X".

- [ ] **Step 1: Detectar owner (server)**

O Dashboard já resolve `empresaId` e tem `user`. Buscar `owner_id` da empresa (uma query a mais, ou incluir no fetch de empresa que já existe). `const isOwner = empresa?.owner_id === user.id;`

- [ ] **Step 2: Queries owner-guarded**

Adicionar ao `Promise.all` interno (linha ~124-181) — **só quando `isOwner`** (se `!isOwner`, empurrar `Promise.resolve({ data: [] })` para manter as posições do array, ou usar um `Promise.all` separado depois). Buscar:

```typescript
      isOwner ? supabase.from('retiradas_socia')
        .select('id,tipo,valor,data,convertido_em')
        .eq('empresa_id', empresaId) : Promise.resolve({ data: [] as any[] }),
      isOwner ? supabase.from('retiradas_socia_devolucoes')
        .select('retirada_id,valor')
        .eq('empresa_id', empresaId) : Promise.resolve({ data: [] as any[] }),
```

- [ ] **Step 3: Derived**

Perto de `const lucro = liquido - gastos;` (linha 204):

```typescript
  const devMapRet         = somaDevolucoesPorRetirada(retiradasRows.data ?? []);
  const retiradasMes       = retiradasNoPeriodo(retiradasRows.data ?? [], devMapRet, inicioMes.slice(0,10), fimMes.slice(0,10));
  const emprestimosAbertos = saldoDevedorTotal(retiradasRows.data ?? [], devMapRet);
  const lucroAposRetiradas = lucro - retiradasMes;
```

- [ ] **Step 4: Render**

- Abaixo do KPI "Lucro do mês" (procure `label: 'Lucro do mês'`, linha ~356): adicionar `sub` ou uma linha extra "Após retiradas {fmt(lucroAposRetiradas)}" quando `isOwner && retiradasMes > 0`.
- Um card/linha "Empréstimos da dona em aberto: {fmt(emprestimosAbertos)}" quando `isOwner && emprestimosAbertos > 0` — perto dos cards de "despesas pendentes"/"comissões pendentes".

- [ ] **Step 5: Verify**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros, testes passam.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/dashboard/page.tsx
git commit -m "feat(dashboard): 'Após retiradas' e card de empréstimos da dona em aberto (owner)"
```

---

## Task 9: Mobile — seção "Retiradas da dona" no Financeiro (leitura)

**Files:**
- Modify: `mobile/app/(empresa)/financeiro.tsx`
- Modify: `mobile/hooks/useFinanceiro.ts`

**Interfaces:**
- Consumes: `@shared/retiradas-socia` (mesmas funções da Task 2); `useAuthStore` (user); `supabase`; padrão de seção das linhas ~1620+ (Despesas / Taxas).
- Produces: no hook, `retiradas`, `retiradasDevs`, `retiradasPeriodo`, `saldoDevedorTotal` (número), `isOwner`; na tela, a seção renderizada só quando `isOwner`.

- [ ] **Step 1: Baseline mobile tsc**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -20`
Anotar a contagem de erros pré-existentes (esperado ~10). Nenhum erro novo nas tasks 9-11.

- [ ] **Step 2: Hook — carregar retiradas + owner**

Em `mobile/hooks/useFinanceiro.ts`:
- Buscar `owner_id` da empresa uma vez (ou ler do `authStore` se já tiver) → `isOwner`.
- Nova `useQuery` (`queryKey: ['fin-retiradas', empresaId, chave]`, `enabled: !!empresaId && isOwner`): busca `retiradas_socia` (`data`/`convertido_em` no mês) e `retiradas_socia_devolucoes` (todas). Retornar `{ rows, devs }`.
- No objeto de retorno do hook, expor:

```typescript
    retiradas:        retiradasQ.data?.rows ?? [],
    retiradasDevs:    retiradasQ.data?.devs ?? [],
    isOwner,
```

- Adicionar `retiradasPeriodo` e `aDonaDeve` calculados com `retiradasNoPeriodo` / `saldoDevedorTotal` (mesmo cálculo do web) — ou expor os arrays crus e calcular na tela. Preferir calcular no hook e expor números prontos.
- Incluir `retiradasQ.refetch()` no `refetchAll` do hook (procure onde `resumo.refetch()` etc. são chamados, linha ~284).

- [ ] **Step 3: Tela — seção**

Em `mobile/app/(empresa)/financeiro.tsx`, depois do bloco "Taxas de reserva" (linha ~1706-1721), adicionar a seção "Retiradas da dona" seguindo o mesmo componente de card/linha das seções vizinhas (React Native `<View>`, `<Text>`, `<Pressable>`). Conteúdo equivalente ao web:
- Header "Retiradas da dona" + resumo ("A dona deve: R$ X" / "Nenhum empréstimo em aberto" + "· Retiradas no mês: R$ Y") + botão "Registrar" → `router.push('/(empresa)/nova-retirada')`.
- Lista das `retiradas` do mês: badge do tipo, valor, data, método, descrição; para empréstimo, "Devolvido/Saldo" + "Parcela n/N" + "atrasada"; chip "Convertido"/"Quitado".
- Ações por linha: devolução, converter, editar (`router.push({ pathname: '/(empresa)/nova-retirada', params: { id: r.id } })`), excluir.
- Só renderiza `if (isOwner)`.

- [ ] **Step 4: Verify**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -20`
Expected: mesma contagem de erros da baseline (Step 1), zero novos.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(empresa\)/financeiro.tsx mobile/hooks/useFinanceiro.ts
git commit -m "feat(mobile/financeiro): seção 'Retiradas da dona' — leitura, card de saldo devedor"
```

---

## Task 10: Mobile — tela `nova-retirada` + ações (devolução, converter, excluir)

**Files:**
- Create: `mobile/app/(empresa)/nova-retirada.tsx`
- Modify: `mobile/app/(empresa)/financeiro.tsx` (modais/sheets de devolução, converter, excluir)

**Interfaces:**
- Consumes: `montarRetiradaSociaInsert`, `montarDevolucaoInsert`, `saldoEmprestimo` de `@shared/retiradas-socia`; `mascaraData`/`dataParaBanco` (helpers de data do mobile, usados por `nova-despesa.tsx`); padrão de formulário de `nova-despesa.tsx`.
- Produces: fluxo completo de escrita no mobile.

- [ ] **Step 1: Tela `nova-retirada.tsx`**

Espelhar `mobile/app/(empresa)/nova-despesa.tsx`: mesma estrutura de `ScrollView` + campos + botão salvar fixo. Campos idênticos aos do `RetiradaModal` web (Task 5). Param opcional `id` (via `useLocalSearchParams`) → modo edição: buscar a linha, pré-preencher, `update` sem `tipo`/`criado_por`. Sem `id` → `insert`. Sempre `.select('id')` + tratamento de erro visível ("Verifique se você é a dona da conta."). Ao concluir, `router.back()` e invalidar a query (`queryClient.invalidateQueries({ queryKey: ['fin-retiradas'] })`).

- [ ] **Step 2: Sheets de devolução / converter / excluir**

Em `financeiro.tsx`, seguindo o padrão de modal/sheet que a tela já usa para "marcar despesa como paga" (procure `ModalMarcarPago` / o sheet de método). Um sheet de **devolução** (valor, data, método, aviso de troco), um de **converter** (confirmação), um de **excluir** (confirmação). Cada um faz o `update`/`insert`/`delete` com `.select('id')` e trata erro. Ao concluir, invalidar `['fin-retiradas']` e `['fin-resumo']`.

- [ ] **Step 3: Verify**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -20`
Expected: mesma contagem da baseline, zero novos.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/\(empresa\)/nova-retirada.tsx mobile/app/\(empresa\)/financeiro.tsx
git commit -m "feat(mobile/financeiro): registrar/editar retirada + devolução, conversão e exclusão"
```

---

## Task 11: Mobile — paridade de "Após retiradas" em resumo/dashboard/relatórios

**Files:**
- Modify: `mobile/hooks/useFinanceiro.ts` (se `ResumoMes` for usado no dashboard/relatórios)
- Modify: telas mobile que exibem "Lucro" (dashboard e/ou relatórios mobile — localizar via grep por `lucro`)

**Interfaces:**
- Consumes: `retiradasPeriodo` / `aDonaDeve` já expostos pelo hook (Task 9).
- Produces: sub-linha "Após retiradas" onde o mobile mostra lucro; card opcional de empréstimos em aberto no dashboard mobile.

- [ ] **Step 1: Localizar**

Run: `cd mobile && grep -rn "lucro\|Lucro" app/ components/ | grep -iv "test"`
Mapear onde "Lucro" é exibido (card de KPI no financeiro mobile já mostra — linha ~1429 de `financeiro.tsx`; verificar dashboard mobile).

- [ ] **Step 2: Render**

Em cada ponto que mostra "Lucro" para o owner: adicionar "Após retiradas: {formatBRL(lucro - retiradasPeriodo)}" quando `isOwner && retiradasPeriodo > 0`. No dashboard mobile, card "Empréstimos da dona em aberto: {formatBRL(aDonaDeve)}" quando `isOwner && aDonaDeve > 0`.

- [ ] **Step 3: Verify**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -20`
Expected: mesma contagem da baseline, zero novos.

- [ ] **Step 4: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): 'Após retiradas' e empréstimos em aberto onde o lucro aparece (owner)"
```

---

## Task 12: Verificação final de branch + QA

**Files:** nenhum (a menos que a revisão ache algo).

- [ ] **Step 1: Suite completa web**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros de tipo; 100% dos testes passam.

- [ ] **Step 2: tsc mobile vs baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -20`
Expected: contagem de erros == baseline anotada na Task 9 Step 1. **Se subiu, encontrar e corrigir o erro novo.**

- [ ] **Step 3: Revisão de costura (fresh eyes) — checklist**

Ler o diff inteiro do branch e confirmar:
- [ ] Nenhuma query de `despesas`/`pagamentos`/`agendamentos`/`vendas`/`comissoes` foi alterada. O `lucro`/"Lucro real"/"Lucro do mês" calcula exatamente igual a antes para qualquer usuário.
- [ ] Toda leitura/escrita de `retiradas_socia*` está atrás de `isOwner` na UI **e** a query nunca roda (ou roda e retorna `[]`) para não-owner. Nenhum "R$ 0" aparece para gestor — a seção/linha/card simplesmente não renderiza.
- [ ] Todo `.insert`/`.update`/`.delete` em `retiradas_socia*` tem `.select(...)` e trata `error` com mensagem visível.
- [ ] `tipo` não pode ser editado depois de criado (modal de edição desabilita o toggle e o `update` não manda `tipo`).
- [ ] A condição que **mostra** cada linha/KPI novo é idêntica à condição que **calcula** o valor (evita mostrar um número e salvar/derivar outro — lição recorrente do projeto).
- [ ] `retiradasNoPeriodo` e `saldoDevedorTotal` recebem o **mesmo** `devMap` (de `somaDevolucoesPorRetirada` sobre TODAS as devoluções, não só as do mês).
- [ ] Empréstimo convertido: sai do card "a dona deve" e entra em "Retiradas da dona" no mês da conversão — conferir com um caso manual (ou teste extra em `retiradas-socia.test.ts` se faltar cobertura).
- [ ] Mobile: `nova-retirada.tsx` em modo edição não reenvia `tipo` nem `criado_por`.

- [ ] **Step 4: Verificação visual (best-effort)**

Subir o dev server web (`preview_start`), abrir `/financeiro`, `/relatorios`, `/dashboard`. Sem conta de teste local, documentar na PR: compila, segue o padrão visual das seções vizinhas, verificação visual real pendente de conta de teste (mesma limitação das sessões anteriores — ver CLAUDE.md).

- [ ] **Step 5: Aplicar a migration (lembrete ao usuário)**

A migration `063` **não é aplicada automaticamente**. Deixar explícito na descrição da PR: rodar `063_retiradas_socia.sql` no Supabase antes de usar a feature em produção (a UI quebra silenciosamente — RLS/tabela ausente — até lá). Ver memória `migrations_nao_aplicadas`.

- [ ] **Step 6: Commit (se a revisão mudou algo) e finalizar**

```bash
git add -A && git commit -m "fix(financeiro): ajustes da revisão final de branch — retiradas da dona"
```

Invocar `superpowers:finishing-a-development-branch` para abrir a PR.

---

## Self-Review (preenchido pelo autor do plano)

**1. Spec coverage:**
- Modelo de dados (enum + 2 tabelas + índices) → Task 1. ✔
- RLS owner-only → Task 1. ✔
- Derivados (saldo, quitado) → Task 2 (`saldoEmprestimo`, `statusParcela`). ✔
- Semântica A (retiradas do período / "Resultado após retiradas") → Task 2 (`retiradasNoPeriodo`) + Task 7 (Relatórios) + Task 8 (Dashboard) + Task 11 (mobile). ✔
- Semântica B (saldo devedor / card "a dona deve") → Task 2 (`saldoDevedorTotal`) + Task 4 (Financeiro card) + Task 8 (Dashboard card) + Task 9/11 (mobile). ✔
- "Lucro real" intacto → Global Constraints + Task 12 Step 3. ✔
- Seção no Financeiro (card + lista + badges + progresso + chips) → Task 4. ✔
- Modal Registrar (toggle tipo, parcelado, validações) → Task 5 + Task 2 (`montarRetiradaSociaInsert`). ✔
- Modal devolução (default valor, clamp, aviso) → Task 6 + Task 2 (`montarDevolucaoInsert`, `saldoEmprestimo`). ✔
- Modal editar (sem trocar tipo) → Task 5. ✔
- Excluir (cascade) → Task 6. ✔
- Converter empréstimo → retirada → Task 6 + Task 2 (`retiradasNoPeriodo` trata `convertido_em`). ✔
- Mobile (seção + tela + hook + paridade) → Tasks 9, 10, 11. ✔
- `isOwner` guard em todo lugar → Tasks 3, 7, 8, 9; verificado na Task 12. ✔
- Export PDF/XLSX → Task 7 Step 4. ✔
- Parcela atrasada (meses pulados) → Task 2 (`statusParcela`, testes de "pulou meses"). ✔
- Casos de borda (devolução > saldo, quitado, converter parcial, data futura, mês vazio) → Task 2 tests + Tasks 4/6. ✔
- Testes (`shared/retiradas-socia.ts` + migration test) → Tasks 1, 2. ✔
- Aritmética em centavos → Global Constraints + Task 2 (`cent()`, reuso de `dividirValorCompra`). ✔
- YAGNI (sem caixa, sem juros, sem profissionais) → não há task para isso; nada no plano os adiciona. ✔

**Gap:** nenhum requisito da spec sem task.

**2. Placeholder scan:** As tasks de UI (4-11) descrevem código real e apontam âncoras exatas, mas não reproduzem cada linha dos arquivos de 1500+ linhas — mostram os trechos novos, o componente-modelo a seguir (`NovaDespesaModal`, seção "Taxas de Reserva", `nova-despesa.tsx`) e o ponto de montagem. Isso é o teto de precisão viável para edições nesses arquivos e está alinhado com "follow existing patterns" da skill. As tasks de lógica (1-2), que carregam o risco real, têm código e testes completos.

**3. Type consistency:** Nomes conferidos entre tasks — `RetiradaSociaRow`/`RetiradaSocia` (alias em `@/types`), `montarRetiradaSociaInsert`, `montarDevolucaoInsert`, `retiradasNoPeriodo`, `saldoDevedorTotal`, `saldoEmprestimo`, `somaDevolucoesPorRetirada`, `statusParcela`, `somarMesesIso` — idênticos no bloco Interfaces da Task 2 e nos usos das Tasks 3-11. `statusParcela` tem 5 parâmetros (`valorParcela, primeiraParcelaEm, totalParcelas, devolvido, hojeIso`) de forma consistente (a spec cita 4 no texto ilustrativo; o plano é a autoridade e usa 5). Payload de `update` na edição remove `tipo`/`criado_por`/`empresa_id` — consistente entre Task 5 (web) e Task 10 (mobile).
