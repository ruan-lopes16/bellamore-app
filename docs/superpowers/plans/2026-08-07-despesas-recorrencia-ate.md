# Despesas recorrentes: data de término opcional + progresso de vencimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two related, independent additions to despesas in Financeiro: (1) despesas recorrentes gain an optional end date, after which the web auto-launch flow stops suggesting that recurrence; (2) any pending despesa with a due date shows how many days remain (or how overdue it is) plus a thin progress bar, with a pending-total summary above the list. Both ship on web and mobile.

**Architecture:** One new nullable `date` column (`recorrencia_ate`) on `despesas` — no other schema change; the progress feature reuses the existing `created_at`/`data_vencimento` columns. Four pure, unit-tested helpers in `shared/despesas.ts`: `recorrenciaAindaAtiva` (used by the web auto-launch loop), and `diasParaVencimento`/`progressoVencimento` (used by both apps' despesa list rendering). UI changes are additive only — new fields/text/bars alongside existing markup, nothing removed or restructured — added to the existing "Despesa recorrente" section of four forms (web Nova/Editar, mobile Nova/Editar) and the existing despesa list row/header in both apps, following the exact style already used for `data_vencimento` in each file.

**Tech Stack:** Next.js 15 App Router + Supabase (Postgres/RLS) for web; Expo/React Native + `@tanstack/react-query` for mobile; Vitest for unit tests and migration static-content tests.

## Global Constraints

- Migrations go in `supabase/migrations/NNN_descricao.sql`, sequential; next available is `056` (055 is the current max).
- No RLS changes needed — `recorrencia_ate` is a plain column on `despesas`, already covered by the existing gestor/owner policies in `supabase/migrations/003_despesas_policies.sql`.
- Column is nullable with no CHECK constraint, matching how `periodicidade` already works (not enforced as dependent on `recorrente` at the DB level).
- Date comparisons use `YYYY-MM-DD` string lexicographic comparison — the same convention already used throughout `web/app/(app)/financeiro/page.tsx` (`periodo.startDate` etc.).
- pt-BR for all UI copy, commit messages, and code comments (existing project convention).
- Run `npx tsc --noEmit` from `web/` and from `mobile/` after touching files in each, respectively.

---

### Task 1: Migration — `recorrencia_ate` column

**Files:**
- Create: `supabase/migrations/056_despesas_recorrencia_ate.sql`
- Create: `web/tests/unit/despesas-recorrencia-migration.test.ts`

**Interfaces:**
- Produces: column `public.despesas.recorrencia_ate` (`date`, nullable) — consumed by Tasks 4 and 5 via Supabase queries.

- [ ] **Step 1: Write the failing migration-content test**

```ts
// web/tests/unit/despesas-recorrencia-migration.test.ts
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

describe('Migration: despesas.recorrencia_ate', () => {
  const migrations = readAllMigrations();

  it('adiciona a coluna recorrencia_ate na tabela despesas', () => {
    expect(migrations).toMatch(/alter table public\.despesas\s+add column recorrencia_ate date/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npm run test -- despesas-recorrencia-migration`
Expected: FAIL — `supabase/migrations/056_despesas_recorrencia_ate.sql` doesn't exist yet, so the migrations text has no match.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/056_despesas_recorrencia_ate.sql
-- ============================================================
-- DESPESAS — data de término opcional para recorrência
--
-- Quando preenchida, o auto-lançamento mensal (web) continua sugerindo
-- a despesa até o mês em que a data cai (inclusive); a partir do mês
-- seguinte, para de sugerir. Sem data, a recorrência não tem fim
-- (comportamento anterior, inalterado).
-- ============================================================

alter table public.despesas
  add column recorrencia_ate date;
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npm run test -- despesas-recorrencia-migration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/056_despesas_recorrencia_ate.sql web/tests/unit/despesas-recorrencia-migration.test.ts
git commit -m "feat: adiciona coluna recorrencia_ate em despesas"
```

---

### Task 2: Shared helper `recorrenciaAindaAtiva`

**Files:**
- Modify: `shared/despesas.ts`
- Modify: `web/tests/unit/despesas.test.ts`

**Interfaces:**
- Consumes: nothing new (pure function, no dependencies beyond string comparison).
- Produces: `recorrenciaAindaAtiva(recorrenciaAte: string | null | undefined, periodoInicioIso: string): boolean` — consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/unit/despesas.test.ts`, inside the existing `describe('despesas helpers', ...)` block (add the import alongside the existing ones at the top of the file):

```ts
import {
  buildDespesaPagamentoUpdate,
  formatValorMonetarioInput,
  parseValorMonetario,
  recorrenciaAindaAtiva,
} from '@shared/despesas';
```

```ts
  it('considera recorrencia sem data de termino sempre ativa', () => {
    expect(recorrenciaAindaAtiva(null, '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva(undefined, '2026-08-01')).toBe(true);
  });

  it('considera ativa quando o termino cai no mes visualizado ou depois', () => {
    expect(recorrenciaAindaAtiva('2026-08-01', '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva('2026-08-15', '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva('2026-12-01', '2026-08-01')).toBe(true);
  });

  it('considera encerrada quando o termino ja passou antes do mes visualizado', () => {
    expect(recorrenciaAindaAtiva('2026-07-31', '2026-08-01')).toBe(false);
    expect(recorrenciaAindaAtiva('2026-01-01', '2026-08-01')).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `web/`): `npm run test -- despesas`
Expected: FAIL with `recorrenciaAindaAtiva is not a function` (or import error), since it doesn't exist in `shared/despesas.ts` yet.

- [ ] **Step 3: Implement the helper**

Add to `shared/despesas.ts`, after `buildDespesaPagamentoUpdate`:

```ts
/**
 * Indica se uma recorrencia mensal ainda deve ser sugerida para o mes
 * cujo inicio (YYYY-MM-DD) e `periodoInicioIso`. Sem data de termino,
 * a recorrencia nunca encerra.
 */
export function recorrenciaAindaAtiva(
  recorrenciaAte: string | null | undefined,
  periodoInicioIso: string,
): boolean {
  if (!recorrenciaAte) return true;
  return recorrenciaAte >= periodoInicioIso;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `web/`): `npm run test -- despesas`
Expected: PASS (all tests in `despesas.test.ts`, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add shared/despesas.ts web/tests/unit/despesas.test.ts
git commit -m "feat: adiciona recorrenciaAindaAtiva para checar termino de recorrencia"
```

---

### Task 3: Domain types — web and mobile

**Files:**
- Modify: `web/types/index.ts:163-165`
- Modify: `mobile/types/index.ts:181-183`
- Modify: `mobile/hooks/useFinanceiro.ts:39-41`

**Interfaces:**
- Consumes: nothing (type-only change).
- Produces: `recorrencia_ate?: string` field on the `Despesa` type (web and mobile) and `DespesaItem` interface (mobile) — consumed by Task 7 (`ModalEditarDespesa` reads `item.recorrencia_ate`).

- [ ] **Step 1: Add the field to `web/types/index.ts`**

Current (lines 163-165):
```ts
  recorrente: boolean;
  periodicidade?: 'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual';
  data_vencimento?: string;
```

New:
```ts
  recorrente: boolean;
  periodicidade?: 'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual';
  data_vencimento?: string;
  recorrencia_ate?: string;
```

- [ ] **Step 2: Add the field to `mobile/types/index.ts`**

Current (lines 181-183):
```ts
  recorrente: boolean;
  periodicidade?: 'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual';
  data_vencimento?: string;
```

New:
```ts
  recorrente: boolean;
  periodicidade?: 'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual';
  data_vencimento?: string;
  recorrencia_ate?: string;
```

- [ ] **Step 3: Add the field to `mobile/hooks/useFinanceiro.ts`**

Current (lines 34-44):
```ts
export interface DespesaItem {
  id: string;
  descricao: string;
  categoria?: string;
  valor: number;
  recorrente: boolean;
  periodicidade?: string;
  data_vencimento?: string;
  data_pagamento?: string;
  status: 'pendente' | 'pago';
}
```

New:
```ts
export interface DespesaItem {
  id: string;
  descricao: string;
  categoria?: string;
  valor: number;
  recorrente: boolean;
  periodicidade?: string;
  data_vencimento?: string;
  recorrencia_ate?: string;
  data_pagamento?: string;
  status: 'pendente' | 'pago';
}
```

- [ ] **Step 4: Verify types compile**

Run (from `web/`): `npx tsc --noEmit`
Expected: no errors.

Run (from `mobile/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/types/index.ts mobile/types/index.ts mobile/hooks/useFinanceiro.ts
git commit -m "feat: adiciona recorrencia_ate aos tipos de Despesa"
```

---

### Task 4: Web UI — Nova/Editar despesa modals

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx:64-72` (local types)
- Modify: `web/app/(app)/financeiro/page.tsx:109-222` (`NovaDespesaModal`)
- Modify: `web/app/(app)/financeiro/page.tsx:286-420` (`EditarDespesaModal`)

**Interfaces:**
- Consumes: `inputClass`, `labelClass` (already defined at module scope in this file, lines 104-105); `Despesa` and `RecorrenteTemplate` local types (this task).
- Produces: `despesas.recorrencia_ate` populated on insert/update from these two modals — Task 5 (auto-launch) reads it back via `RecorrenteTemplate.recorrencia_ate`.

- [ ] **Step 1: Update local types**

Current (lines 64-72):
```tsx
type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string;
  status: 'pendente' | 'pago';
};
type TopServico = { nome: string; quantidade: number; receita: number; percentual: number };
type MetodoPag  = { metodo: string; valor: number; quantidade: number; percentual: number };
type RecorrenteTemplate = { descricao: string; categoria?: string; valor: number; periodicidade?: string; data_vencimento?: string };
```

New:
```tsx
type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string; recorrencia_ate?: string;
  status: 'pendente' | 'pago';
};
type TopServico = { nome: string; quantidade: number; receita: number; percentual: number };
type MetodoPag  = { metodo: string; valor: number; quantidade: number; percentual: number };
type RecorrenteTemplate = { descricao: string; categoria?: string; valor: number; periodicidade?: string; data_vencimento?: string; recorrencia_ate?: string };
```

- [ ] **Step 2: `NovaDespesaModal` — add state**

Current (line 117):
```tsx
  const [vencimento,    setVencimento]    = useState('');
```

New (add the line right after it):
```tsx
  const [vencimento,    setVencimento]    = useState('');
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
```

- [ ] **Step 3: `NovaDespesaModal` — include in insert payload**

Current (lines 127-136):
```tsx
    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaId,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      status:          'pendente',
    });
```

New:
```tsx
    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaId,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAte || null) : null,
      status:          'pendente',
    });
```

- [ ] **Step 4: `EditarDespesaModal` — add state initialized from `despesa`**

Current (line 296):
```tsx
  const [vencimento,    setVencimento]    = useState(despesa.data_vencimento ?? '');
```

New (add the line right after it):
```tsx
  const [vencimento,    setVencimento]    = useState(despesa.data_vencimento ?? '');
  const [recorrenciaAte, setRecorrenciaAte] = useState(despesa.recorrencia_ate ?? '');
```

- [ ] **Step 5: `EditarDespesaModal` — include in update payload**

Current (lines 308-315):
```tsx
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
    }).eq('id', despesa.id);
```

New:
```tsx
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAte || null) : null,
    }).eq('id', despesa.id);
```

- [ ] **Step 6: Add the field to both modals' form**

`NovaDespesaModal` (lines 195-206) and `EditarDespesaModal` (lines 381-392)
render the exact same periodicidade-chips block, byte-for-byte identical —
they're separate components but that one block was copy-pasted. Because the
text is identical in both places, this old_string will match twice in the
file; apply this edit with **replace all occurrences** (not just the first
match) so both modals get the field in one pass. The replacement text is the
same in both places, so a single "replace all" edit is correct here — do not
try to give the two occurrences different replacements.

Current (appears twice, inside each modal's `recorrente &&` block):
```tsx
            {recorrente && (
              <div className="flex flex-wrap gap-2 mt-3">
                {PERIODICIDADES.map(p => (
                  <button key={p.key} type="button" onClick={() => setPeriodicidade(p.key)}
                    className={`flex-1 min-w-[90px] py-2 rounded-xl text-xs font-semibold border transition ${
                      periodicidade === p.key
                        ? 'bg-amber-soft border-amber/30 text-amber'
                        : 'bg-bg border-border text-text-3'
                    }`}>{p.label}</button>
                ))}
              </div>
            )}
```

New (both occurrences):
```tsx
            {recorrente && (
              <div className="flex flex-wrap gap-2 mt-3">
                {PERIODICIDADES.map(p => (
                  <button key={p.key} type="button" onClick={() => setPeriodicidade(p.key)}
                    className={`flex-1 min-w-[90px] py-2 rounded-xl text-xs font-semibold border transition ${
                      periodicidade === p.key
                        ? 'bg-amber-soft border-amber/30 text-amber'
                        : 'bg-bg border-border text-text-3'
                    }`}>{p.label}</button>
                ))}
                <div className="w-full mt-1">
                  <label className={labelClass}>Repetir até (opcional)</label>
                  <input value={recorrenciaAte} onChange={e => setRecorrenciaAte(e.target.value)}
                    type="date" className={inputClass}/>
                </div>
              </div>
            )}
```

- [ ] **Step 7: Verify types compile**

Run (from `web/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: adiciona campo repetir ate aos modais de despesa (web)"
```

---

### Task 5: Web auto-launch logic

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx:51` (import)
- Modify: `web/app/(app)/financeiro/page.tsx:536-541` (query select)
- Modify: `web/app/(app)/financeiro/page.tsx:698-712` (filter + group loop)
- Modify: `web/app/(app)/financeiro/page.tsx:722-741` (insert on launch)

**Interfaces:**
- Consumes: `recorrenciaAindaAtiva` from `@shared/despesas` (Task 2); `RecorrenteTemplate.recorrencia_ate` (Task 4).
- Produces: `recorrentesParaLancar` excludes templates whose recurrence already ended; newly launched despesas carry `recorrencia_ate` forward.

- [ ] **Step 1: Import the helper**

Current (line 51):
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput } from '@shared/despesas';
```

New:
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, recorrenciaAindaAtiva } from '@shared/despesas';
```

- [ ] **Step 2: Select `recorrencia_ate` in the template-history query**

Current (lines 536-541):
```tsx
      // Histórico de despesas mensais recorrentes (para auto-lançamento robusto)
      supabase.from('despesas')
        .select('descricao, categoria, valor, periodicidade, data_vencimento')
        .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
        .lt('data_vencimento', periodo.startDate)   // somente meses passados
        .order('data_vencimento', { ascending: false }),
```

New:
```tsx
      // Histórico de despesas mensais recorrentes (para auto-lançamento robusto)
      supabase.from('despesas')
        .select('descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate')
        .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
        .lt('data_vencimento', periodo.startDate)   // somente meses passados
        .order('data_vencimento', { ascending: false }),
```

- [ ] **Step 3: Skip templates whose recurrence already ended**

Current (lines 698-712):
```tsx
    // Auto-lançamento robusto: pega o template mais recente por (descricao+categoria),
    // independente de quantos meses foram pulados.
    const todasMensais = (recMesAnt.data ?? []) as RecorrenteTemplate[];
    // Agrupa por chave composta — preserva a versão mais recente (já vem desc por data)
    const porChave: Record<string, RecorrenteTemplate> = {};
    for (const r of todasMensais) {
      const chave = `${r.descricao}||${r.categoria ?? ''}`;
      if (!porChave[chave]) porChave[chave] = r;   // primeiro = mais recente
    }
    // Compara com o mês atual pela mesma chave composta
    const despAtual = (despLista.data ?? []) as { descricao: string; categoria?: string }[];
    const chavesMesAtual = new Set(despAtual.map(d => `${d.descricao}||${d.categoria ?? ''}`));
    setRecorrentesParaLancar(Object.values(porChave).filter(r =>
      !chavesMesAtual.has(`${r.descricao}||${r.categoria ?? ''}`)
    ));
```

New:
```tsx
    // Auto-lançamento robusto: pega o template mais recente por (descricao+categoria),
    // independente de quantos meses foram pulados.
    const todasMensais = (recMesAnt.data ?? []) as RecorrenteTemplate[];
    // Agrupa por chave composta — preserva a versão mais recente (já vem desc por data)
    // e ignora templates cuja recorrência já terminou antes do mês visualizado.
    const porChave: Record<string, RecorrenteTemplate> = {};
    for (const r of todasMensais) {
      if (!recorrenciaAindaAtiva(r.recorrencia_ate, periodo.startDate)) continue;
      const chave = `${r.descricao}||${r.categoria ?? ''}`;
      if (!porChave[chave]) porChave[chave] = r;   // primeiro = mais recente
    }
    // Compara com o mês atual pela mesma chave composta
    const despAtual = (despLista.data ?? []) as { descricao: string; categoria?: string }[];
    const chavesMesAtual = new Set(despAtual.map(d => `${d.descricao}||${d.categoria ?? ''}`));
    setRecorrentesParaLancar(Object.values(porChave).filter(r =>
      !chavesMesAtual.has(`${r.descricao}||${r.categoria ?? ''}`)
    ));
```

- [ ] **Step 4: Carry `recorrencia_ate` forward when auto-launching**

Current (lines 722-741):
```tsx
    await supabase.from('despesas').insert(
      recorrentesParaLancar.map(r => ({
        empresa_id:      empresaId,
        descricao:       r.descricao,
        categoria:       r.categoria ?? null,
        valor:           r.valor,
        recorrente:      true,
        periodicidade:   r.periodicidade ?? 'mensal',
        data_vencimento: (() => {
          // Preserva o dia do template, mas força o ano/mês atual visualizado
          const dia = r.data_vencimento ? parseInt(r.data_vencimento.slice(8, 10)) : 1;
          const ano  = mesRef.getFullYear();
          const mes  = mesRef.getMonth(); // 0-based
          // Clamp: dia 31 em fevereiro → último dia do mês
          const ultimo = new Date(ano, mes + 1, 0).getDate();
          return format(new Date(ano, mes, Math.min(dia, ultimo)), 'yyyy-MM-dd');
        })(),
        status:          'pendente',
      }))
    );
```

New:
```tsx
    await supabase.from('despesas').insert(
      recorrentesParaLancar.map(r => ({
        empresa_id:      empresaId,
        descricao:       r.descricao,
        categoria:       r.categoria ?? null,
        valor:           r.valor,
        recorrente:      true,
        periodicidade:   r.periodicidade ?? 'mensal',
        data_vencimento: (() => {
          // Preserva o dia do template, mas força o ano/mês atual visualizado
          const dia = r.data_vencimento ? parseInt(r.data_vencimento.slice(8, 10)) : 1;
          const ano  = mesRef.getFullYear();
          const mes  = mesRef.getMonth(); // 0-based
          // Clamp: dia 31 em fevereiro → último dia do mês
          const ultimo = new Date(ano, mes + 1, 0).getDate();
          return format(new Date(ano, mes, Math.min(dia, ultimo)), 'yyyy-MM-dd');
        })(),
        recorrencia_ate: r.recorrencia_ate ?? null,
        status:          'pendente',
      }))
    );
```

- [ ] **Step 5: Verify types compile and existing tests still pass**

Run (from `web/`): `npx tsc --noEmit`
Expected: no errors.

Run (from `web/`): `npm run test -- despesas`
Expected: PASS (unchanged — this task doesn't touch `shared/despesas.ts`, just wires the already-tested helper into the component).

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: auto-lancamento mensal respeita data de termino da recorrencia"
```

---

### Task 6: Mobile UI — Nova despesa

**Files:**
- Modify: `mobile/app/(empresa)/nova-despesa.tsx`

**Interfaces:**
- Consumes: `mascaraData`, `dataParaBanco` (already defined in this file, lines 88-99); `Campo` component (line 52).
- Produces: `despesas.recorrencia_ate` populated on insert from this screen.

- [ ] **Step 1: Add state**

Current (line 75):
```tsx
  const [vencimento, setVencimento]     = useState('');
```

New (add the line right after it):
```tsx
  const [vencimento, setVencimento]     = useState('');
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
```

- [ ] **Step 2: Include in insert payload**

Current (lines 107-116):
```tsx
    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaAtiva.id,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           parseFloat(valor.replace(',', '.')),
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: dataParaBanco(vencimento),
      status:          'pendente',
    });
```

New:
```tsx
    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaAtiva.id,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           parseFloat(valor.replace(',', '.')),
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: dataParaBanco(vencimento),
      recorrencia_ate: recorrente ? dataParaBanco(recorrenciaAte) : null,
      status:          'pendente',
    });
```

- [ ] **Step 3: Add the field to the form**

Current (lines 254-275, the `recorrente &&` block that renders the periodicidade chips):
```tsx
          {recorrente && (
            <MotiView from={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ type: 'timing', duration: 250 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {PERIODICIDADES.map((p) => (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setPeriodicidade(p.key as any)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                      backgroundColor: periodicidade === p.key ? C.amberSoft : C.surface,
                      borderWidth: 1, borderColor: periodicidade === p.key ? C.amber : C.border,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: periodicidade === p.key ? C.amber : C.text3 }}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </MotiView>
          )}
```

New:
```tsx
          {recorrente && (
            <MotiView from={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ type: 'timing', duration: 250 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {PERIODICIDADES.map((p) => (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setPeriodicidade(p.key as any)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                      backgroundColor: periodicidade === p.key ? C.amberSoft : C.surface,
                      borderWidth: 1, borderColor: periodicidade === p.key ? C.amber : C.border,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: periodicidade === p.key ? C.amber : C.text3 }}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ marginTop: 16 }}>
                <Campo label="Repetir até (opcional)">
                  <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
                    <Calendar size={16} color={C.text4} strokeWidth={1.8} style={{ marginRight: 10 }} />
                    <TextInput
                      value={recorrenciaAte}
                      onChangeText={(v) => setRecorrenciaAte(mascaraData(v))}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor={C.text4}
                      keyboardType="numeric"
                      style={{ flex: 1, paddingVertical: 14, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text }}
                    />
                  </View>
                </Campo>
              </View>
            </MotiView>
          )}
```

- [ ] **Step 4: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(empresa)/nova-despesa.tsx"
git commit -m "feat: adiciona campo repetir ate na criacao de despesa (mobile)"
```

---

### Task 7: Mobile UI — Editar despesa

**Files:**
- Modify: `mobile/app/(empresa)/financeiro.tsx`

**Interfaces:**
- Consumes: `DespesaItem.recorrencia_ate` (Task 3); `mascaraData`, `dataParaBanco` (already defined in `ModalEditarDespesa`, lines 613-625).
- Produces: `despesas.recorrencia_ate` populated on update from this modal.

- [ ] **Step 1: Add state**

Current (line 592):
```tsx
  const [vencimento,    setVencimento]    = useState('');
```

New (add the line right after it):
```tsx
  const [vencimento,    setVencimento]    = useState('');
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
```

- [ ] **Step 2: Initialize from `item` in the existing `useEffect`**

Current (lines 597-611):
```tsx
  useEffect(() => {
    if (!item) return;
    setDescricao(item.descricao);
    setValor(formatValorMonetarioInput(Number(item.valor)));
    setCategoria(item.categoria ?? '');
    setRecorrente(item.recorrente);
    setPeriodicidade(item.periodicidade ?? 'mensal');
    if (item.data_vencimento) {
      const [y, m, d] = item.data_vencimento.split('-');
      setVencimento(`${d}/${m}/${y}`);
    } else {
      setVencimento('');
    }
    setConfirmDelete(false);
  }, [item]);
```

New:
```tsx
  useEffect(() => {
    if (!item) return;
    setDescricao(item.descricao);
    setValor(formatValorMonetarioInput(Number(item.valor)));
    setCategoria(item.categoria ?? '');
    setRecorrente(item.recorrente);
    setPeriodicidade(item.periodicidade ?? 'mensal');
    if (item.data_vencimento) {
      const [y, m, d] = item.data_vencimento.split('-');
      setVencimento(`${d}/${m}/${y}`);
    } else {
      setVencimento('');
    }
    if (item.recorrencia_ate) {
      const [y, m, d] = item.recorrencia_ate.split('-');
      setRecorrenciaAte(`${d}/${m}/${y}`);
    } else {
      setRecorrenciaAte('');
    }
    setConfirmDelete(false);
  }, [item]);
```

- [ ] **Step 3: Include in update payload**

Current (lines 634-641):
```tsx
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: dataParaBanco(vencimento),
    }).eq('id', item.id);
```

New:
```tsx
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: dataParaBanco(vencimento),
      recorrencia_ate: recorrente ? dataParaBanco(recorrenciaAte) : null,
    }).eq('id', item.id);
```

- [ ] **Step 4: Add the field to the form**

Current (lines 798-821, the `recorrente &&` block that renders the periodicidade chips):
```tsx
            {recorrente && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {PERIODICIDADES_MOBILE.map(p => (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setPeriodicidade(p.key)}
                    style={{
                      flex: 1, minWidth: 80, paddingVertical: 8,
                      borderRadius: 12, borderWidth: 1,
                      borderColor: periodicidade === p.key ? C.amber : C.border,
                      backgroundColor: periodicidade === p.key ? C.amberSoft : C.bg,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11,
                      color: periodicidade === p.key ? C.amber : C.text3,
                    }}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
```

New:
```tsx
            {recorrente && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {PERIODICIDADES_MOBILE.map(p => (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setPeriodicidade(p.key)}
                    style={{
                      flex: 1, minWidth: 80, paddingVertical: 8,
                      borderRadius: 12, borderWidth: 1,
                      borderColor: periodicidade === p.key ? C.amber : C.border,
                      backgroundColor: periodicidade === p.key ? C.amberSoft : C.bg,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11,
                      color: periodicidade === p.key ? C.amber : C.text3,
                    }}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
                <View style={{ width: '100%', marginTop: 4 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
                    Repetir até (opcional)
                  </Text>
                  <View style={{
                    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                    borderRadius: 12, paddingHorizontal: 14, height: 48,
                    justifyContent: 'center',
                  }}>
                    <TextInput
                      value={recorrenciaAte}
                      onChangeText={v => setRecorrenciaAte(mascaraData(v))}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor={C.text4}
                      keyboardType="numeric"
                      style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                    />
                  </View>
                </View>
              </View>
            )}
```

- [ ] **Step 5: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(empresa)/financeiro.tsx"
git commit -m "feat: adiciona campo repetir ate na edicao de despesa (mobile)"
```

---

### Task 8: Shared helpers `diasParaVencimento` + `progressoVencimento`

**Files:**
- Modify: `shared/despesas.ts`
- Modify: `web/tests/unit/despesas.test.ts`

**Interfaces:**
- Consumes: nothing new (pure functions).
- Produces: `diasParaVencimento(dataVencimento: string, hojeIso: string): number` and `progressoVencimento(criadaEmIso: string, dataVencimento: string, hojeIso: string): number` — consumed by Task 9 (web) and Task 10 (mobile).

- [ ] **Step 1: Write the failing tests**

Add to the import at the top of `web/tests/unit/despesas.test.ts` (extends the import already updated in Task 2):

```ts
import {
  buildDespesaPagamentoUpdate,
  diasParaVencimento,
  formatValorMonetarioInput,
  parseValorMonetario,
  progressoVencimento,
  recorrenciaAindaAtiva,
} from '@shared/despesas';
```

Add inside the existing `describe('despesas helpers', ...)` block:

```ts
  it('calcula dias restantes ate o vencimento (negativo quando atrasada)', () => {
    expect(diasParaVencimento('2026-08-15', '2026-08-07')).toBe(8);
    expect(diasParaVencimento('2026-08-07', '2026-08-07')).toBe(0);
    expect(diasParaVencimento('2026-08-01', '2026-08-07')).toBe(-6);
  });

  it('calcula o progresso entre a criacao e o vencimento, limitado entre 0 e 1', () => {
    expect(progressoVencimento('2026-08-01T10:00:00.000Z', '2026-08-11', '2026-08-06')).toBe(0.5);
    expect(progressoVencimento('2026-08-01T10:00:00.000Z', '2026-08-11', '2026-07-30')).toBe(0);
    expect(progressoVencimento('2026-08-01T10:00:00.000Z', '2026-08-11', '2026-08-20')).toBe(1);
  });

  it('nao divide por zero quando o vencimento e anterior ou igual a criacao', () => {
    expect(progressoVencimento('2026-08-05T00:00:00.000Z', '2026-08-05', '2026-08-05')).toBe(1);
    expect(progressoVencimento('2026-08-05T00:00:00.000Z', '2026-08-01', '2026-08-05')).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `web/`): `npm run test -- despesas`
Expected: FAIL — `diasParaVencimento`/`progressoVencimento` don't exist in `shared/despesas.ts` yet.

- [ ] **Step 3: Implement the helpers**

Add to `shared/despesas.ts`, after `recorrenciaAindaAtiva`:

```ts
/**
 * Dias entre hoje e o vencimento (YYYY-MM-DD). Negativo quando ja atrasada.
 */
export function diasParaVencimento(
  dataVencimento: string,
  hojeIso: string,
): number {
  const venc = new Date(dataVencimento + 'T00:00:00');
  const hoje = new Date(hojeIso + 'T00:00:00');
  return Math.round((venc.getTime() - hoje.getTime()) / 86_400_000);
}

/**
 * Fracao (0 a 1) do caminho percorrido entre a criacao e o vencimento de uma
 * despesa. Usada para preencher a barra de progresso na listagem.
 */
export function progressoVencimento(
  criadaEmIso: string,
  dataVencimento: string,
  hojeIso: string,
): number {
  const inicio = new Date(criadaEmIso.slice(0, 10) + 'T00:00:00').getTime();
  const fim    = new Date(dataVencimento + 'T00:00:00').getTime();
  const hoje   = new Date(hojeIso + 'T00:00:00').getTime();
  if (fim <= inicio) return 1;
  const fracao = (hoje - inicio) / (fim - inicio);
  return Math.min(1, Math.max(0, fracao));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `web/`): `npm run test -- despesas`
Expected: PASS (all tests in `despesas.test.ts`, including the 3 new ones from this task and the 3 from Task 2).

- [ ] **Step 5: Commit**

```bash
git add shared/despesas.ts web/tests/unit/despesas.test.ts
git commit -m "feat: adiciona calculo de dias e progresso ate o vencimento"
```

---

### Task 9: Web UI — resumo e barra de progresso na listagem de despesas

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `diasParaVencimento`, `progressoVencimento` from `@shared/despesas` (Task 8).
- Produces: visual only — no new exports, no new consumers.

- [ ] **Step 1: Import the new helpers**

Current (this line was set by Task 5, Step 1):
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, recorrenciaAindaAtiva } from '@shared/despesas';
```

New:
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, recorrenciaAindaAtiva, diasParaVencimento, progressoVencimento } from '@shared/despesas';
```

- [ ] **Step 2: Add `created_at` to the local `Despesa` type**

Current (this block was set by Task 4, Step 1):
```tsx
type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string; recorrencia_ate?: string;
  status: 'pendente' | 'pago';
};
```

New:
```tsx
type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string; recorrencia_ate?: string;
  created_at?: string;
  status: 'pendente' | 'pago';
};
```

- [ ] **Step 3: Compute the pending summary**

Current (lines 763-767):
```tsx
  const liquidoAposTaxas = receita - taxasCartao;
  const lucro            = liquidoAposTaxas - comissoes - gastos;
  const dReceita         = delta(receita,   receitaAnt);
  const dComissoes       = delta(comissoes, comissoesAnt);
  const dGastos          = delta(gastos,    gastosAnt);
```

New (append after):
```tsx
  const liquidoAposTaxas = receita - taxasCartao;
  const lucro            = liquidoAposTaxas - comissoes - gastos;
  const dReceita         = delta(receita,   receitaAnt);
  const dComissoes       = delta(comissoes, comissoesAnt);
  const dGastos          = delta(gastos,    gastosAnt);
  const hojeIso           = format(new Date(), 'yyyy-MM-dd');
  const despesasPendentes = despesas.filter(d => d.status === 'pendente');
  const totalPendente     = despesasPendentes.reduce((soma, d) => soma + Number(d.valor), 0);
```

- [ ] **Step 4: Show the summary in the "Despesas" header**

Current (lines 1029-1032):
```tsx
        {/* Despesas */}
        <div className={`bg-surface border border-border rounded-2xl overflow-hidden shadow-sm ${metodos.length > 0 ? '' : 'md:col-span-2'}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <p className="font-serif text-lg text-text">Despesas</p>
```

New:
```tsx
        {/* Despesas */}
        <div className={`bg-surface border border-border rounded-2xl overflow-hidden shadow-sm ${metodos.length > 0 ? '' : 'md:col-span-2'}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <p className="font-serif text-lg text-text">Despesas</p>
              {despesasPendentes.length > 0 && (
                <p className="text-[10px] text-text-4 mt-0.5">
                  {fmtBRL(totalPendente)} pendente · {despesasPendentes.length} despesa{despesasPendentes.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
```

- [ ] **Step 5: Add the complementary text and progress bar to each pending row**

Current (lines 1070-1108):
```tsx
            despesas.map((d, i) => (
              <div key={d.id}
                className={`flex items-center gap-2 px-4 py-3 ${i < despesas.length - 1 ? 'border-b border-border' : ''}`}>
                <div
                  className={`flex items-center gap-3 flex-1 min-w-0 rounded-lg ${d.status === 'pendente' ? 'cursor-pointer hover:bg-bg transition' : ''}`}
                  onClick={() => d.status === 'pendente' && setMarcarPago(d)}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${d.status === 'pago' ? 'bg-green-soft' : 'bg-amber-soft'}`}>
                    {d.status === 'pago'
                      ? <CheckCircle2 size={14} strokeWidth={2} className="text-green"/>
                      : <AlertTriangle size={14} strokeWidth={2} className="text-amber"/>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text truncate">{d.descricao}</p>
                    <p className="text-[10px] text-text-4 mt-0.5">
                      {d.status === 'pago'
                        ? `Pago ${d.data_pagamento ? format(new Date(d.data_pagamento + 'T12:00'), 'dd/MM') : ''}`
                        : `Vence ${d.data_vencimento ? format(new Date(d.data_vencimento + 'T12:00'), 'dd/MM') : 'sem data'}`
                      }
                      {d.recorrente && ' · Recorrente'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-red">{fmtBRL(d.valor)}</p>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                      d.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'
                    }`}>
                      {d.status === 'pago' ? 'Pago' : 'Toque p/ pagar'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setEditarDespesa(d)}
                  title="Editar despesa"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:bg-bg hover:text-text-2 transition flex-shrink-0">
                  <Pencil size={12} strokeWidth={2}/>
                </button>
              </div>
            ))
```

New:
```tsx
            despesas.map((d, i) => {
              const dias = d.status === 'pendente' && d.data_vencimento
                ? diasParaVencimento(d.data_vencimento, hojeIso)
                : null;
              const progresso = d.status === 'pendente' && d.data_vencimento
                ? progressoVencimento(d.created_at ?? hojeIso, d.data_vencimento, hojeIso)
                : null;
              const labelDias = dias === null ? '' :
                dias < 0 ? `atrasada há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}` :
                dias === 0 ? 'vence hoje' :
                `faltam ${dias} dia${dias === 1 ? '' : 's'}`;

              return (
                <div key={d.id}
                  className={`relative flex items-center gap-2 px-4 py-3 ${i < despesas.length - 1 ? 'border-b border-border' : ''}`}>
                  <div
                    className={`flex items-center gap-3 flex-1 min-w-0 rounded-lg ${d.status === 'pendente' ? 'cursor-pointer hover:bg-bg transition' : ''}`}
                    onClick={() => d.status === 'pendente' && setMarcarPago(d)}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${d.status === 'pago' ? 'bg-green-soft' : 'bg-amber-soft'}`}>
                      {d.status === 'pago'
                        ? <CheckCircle2 size={14} strokeWidth={2} className="text-green"/>
                        : <AlertTriangle size={14} strokeWidth={2} className="text-amber"/>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-text truncate">{d.descricao}</p>
                      <p className="text-[10px] text-text-4 mt-0.5">
                        {d.status === 'pago'
                          ? `Pago ${d.data_pagamento ? format(new Date(d.data_pagamento + 'T12:00'), 'dd/MM') : ''}`
                          : `Vence ${d.data_vencimento ? format(new Date(d.data_vencimento + 'T12:00'), 'dd/MM') : 'sem data'}`
                        }
                        {d.recorrente && ' · Recorrente'}
                        {labelDias && ` · ${labelDias}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-red">{fmtBRL(d.valor)}</p>
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                        d.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'
                      }`}>
                        {d.status === 'pago' ? 'Pago' : 'Toque p/ pagar'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditarDespesa(d)}
                    title="Editar despesa"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:bg-bg hover:text-text-2 transition flex-shrink-0">
                    <Pencil size={12} strokeWidth={2}/>
                  </button>
                  {progresso !== null && (
                    <div className="absolute left-4 right-4 bottom-0 h-0.5 rounded-full overflow-hidden bg-border">
                      <div className={`h-full ${dias !== null && dias < 0 ? 'bg-red' : 'bg-amber'}`} style={{ width: `${progresso * 100}%` }}/>
                    </div>
                  )}
                </div>
              );
            })
```

- [ ] **Step 6: Verify types compile**

Run (from `web/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: mostra resumo e progresso de vencimento nas despesas (web)"
```

---

### Task 10: Mobile UI — resumo e barra de progresso na listagem de despesas

**Files:**
- Modify: `mobile/hooks/useFinanceiro.ts` (`DespesaItem.created_at`)
- Modify: `mobile/app/(empresa)/financeiro.tsx` (import, `DespesaRow`, section header, pending summary)

**Interfaces:**
- Consumes: `diasParaVencimento`, `progressoVencimento` from `@shared/despesas` (Task 8); `DespesaItem.created_at` (this task, Step 1).
- Produces: visual only.

- [ ] **Step 1: Add `created_at` to `DespesaItem`**

Current (this block was set by Task 3, Step 3):
```ts
export interface DespesaItem {
  id: string;
  descricao: string;
  categoria?: string;
  valor: number;
  recorrente: boolean;
  periodicidade?: string;
  data_vencimento?: string;
  recorrencia_ate?: string;
  data_pagamento?: string;
  status: 'pendente' | 'pago';
}
```

New:
```ts
export interface DespesaItem {
  id: string;
  descricao: string;
  categoria?: string;
  valor: number;
  recorrente: boolean;
  periodicidade?: string;
  data_vencimento?: string;
  recorrencia_ate?: string;
  data_pagamento?: string;
  created_at?: string;
  status: 'pendente' | 'pago';
}
```

- [ ] **Step 2: Import the new helpers in `financeiro.tsx`**

Current (line 39):
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput } from '@shared/despesas';
```

New:
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento } from '@shared/despesas';
```

- [ ] **Step 3: Add the complementary text and progress bar to `DespesaRow`**

Current (lines 197-269, full component):
```tsx
function DespesaRow({
  item, isLast, onMarcarPago, onEditar,
}: {
  item: DespesaItem;
  isLast: boolean;
  onMarcarPago: (item: DespesaItem) => void;
  onEditar: (item: DespesaItem) => void;
}) {
  const pago = item.status === 'pago';

  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
    }}>
      <TouchableOpacity
        activeOpacity={pago ? 1 : 0.7}
        onPress={() => !pago && onMarcarPago(item)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <View style={{
          width: 32, height: 32, borderRadius: 9,
          backgroundColor: pago ? C.greenSoft : C.amberSoft,
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {pago
            ? <CheckCircle2 size={14} color={C.green} strokeWidth={2} />
            : <AlertTriangle size={14} color={C.amber} strokeWidth={2} />
          }
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
            {item.descricao}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
            {pago
              ? `Pago ${item.data_pagamento ? format(new Date(item.data_pagamento + 'T12:00:00'), 'dd/MM') : ''}`
              : `Vence ${item.data_vencimento ? format(new Date(item.data_vencimento + 'T12:00:00'), 'dd/MM') : 'sem data'}`
            }
            {item.recorrente ? ' · Recorrente' : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.red }}>
            {formatBRL(item.valor)}
          </Text>
          <View style={{
            marginTop: 3,
            backgroundColor: pago ? C.greenSoft : C.amberSoft,
            borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
          }}>
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9,
              color: pago ? C.green : C.amber,
              textTransform: 'uppercase',
            }}>
              {pago ? 'Pago' : 'Toque p/ pagar'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onEditar(item)}
        style={{
          width: 28, height: 28, borderRadius: 8,
          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Pencil size={12} color={C.text3} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}
```

New:
```tsx
function DespesaRow({
  item, isLast, onMarcarPago, onEditar,
}: {
  item: DespesaItem;
  isLast: boolean;
  onMarcarPago: (item: DespesaItem) => void;
  onEditar: (item: DespesaItem) => void;
}) {
  const pago = item.status === 'pago';
  const hojeIso = format(new Date(), 'yyyy-MM-dd');
  const dias = !pago && item.data_vencimento
    ? diasParaVencimento(item.data_vencimento, hojeIso)
    : null;
  const progresso = !pago && item.data_vencimento
    ? progressoVencimento(item.created_at ?? hojeIso, item.data_vencimento, hojeIso)
    : null;
  const labelDias = dias === null ? '' :
    dias < 0 ? `atrasada há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}` :
    dias === 0 ? 'vence hoje' :
    `faltam ${dias} dia${dias === 1 ? '' : 's'}`;

  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
      position: 'relative',
    }}>
      <TouchableOpacity
        activeOpacity={pago ? 1 : 0.7}
        onPress={() => !pago && onMarcarPago(item)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <View style={{
          width: 32, height: 32, borderRadius: 9,
          backgroundColor: pago ? C.greenSoft : C.amberSoft,
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {pago
            ? <CheckCircle2 size={14} color={C.green} strokeWidth={2} />
            : <AlertTriangle size={14} color={C.amber} strokeWidth={2} />
          }
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
            {item.descricao}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
            {pago
              ? `Pago ${item.data_pagamento ? format(new Date(item.data_pagamento + 'T12:00:00'), 'dd/MM') : ''}`
              : `Vence ${item.data_vencimento ? format(new Date(item.data_vencimento + 'T12:00:00'), 'dd/MM') : 'sem data'}`
            }
            {item.recorrente ? ' · Recorrente' : ''}
            {labelDias ? ` · ${labelDias}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.red }}>
            {formatBRL(item.valor)}
          </Text>
          <View style={{
            marginTop: 3,
            backgroundColor: pago ? C.greenSoft : C.amberSoft,
            borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
          }}>
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9,
              color: pago ? C.green : C.amber,
              textTransform: 'uppercase',
            }}>
              {pago ? 'Pago' : 'Toque p/ pagar'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onEditar(item)}
        style={{
          width: 28, height: 28, borderRadius: 8,
          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Pencil size={12} color={C.text3} strokeWidth={2} />
      </TouchableOpacity>
      {progresso !== null && (
        <View style={{
          position: 'absolute', left: 16, right: 16, bottom: 0,
          height: 2, borderRadius: 1, backgroundColor: C.border, overflow: 'hidden',
        }}>
          <View style={{
            width: `${progresso * 100}%`, height: '100%',
            backgroundColor: dias !== null && dias < 0 ? C.red : C.amber,
          }} />
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Show the pending summary in the "Despesas" section header**

Current (lines 1255-1258):
```tsx
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>
              Despesas
            </Text>
```

New:
```tsx
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <View>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>
                Despesas
              </Text>
              {despesasPendentes.length > 0 && (
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                  {formatBRL(totalPendente)} pendente · {despesasPendentes.length} despesa{despesasPendentes.length !== 1 ? 's' : ''}
                </Text>
              )}
            </View>
```

- [ ] **Step 5: Compute the pending summary values**

Current (the destructuring of `useFinanceiro` — search for `const { resumo, metodos, topServicos, despesas` in this file):
```tsx
  const { resumo, metodos, topServicos, despesas, taxasCancelamento, taxasReserva, evolucao, isLoading, refetch } = useFinanceiro(mesRef);
```

New (add the two lines right after):
```tsx
  const { resumo, metodos, topServicos, despesas, taxasCancelamento, taxasReserva, evolucao, isLoading, refetch } = useFinanceiro(mesRef);
  const despesasPendentes = despesas.filter(d => d.status === 'pendente');
  const totalPendente     = despesasPendentes.reduce((soma, d) => soma + Number(d.valor), 0);
```

- [ ] **Step 6: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/hooks/useFinanceiro.ts "mobile/app/(empresa)/financeiro.tsx"
git commit -m "feat: mostra resumo e progresso de vencimento nas despesas (mobile)"
```

---

### Task 11: Full verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full web unit test suite**

Run (from `web/`): `npm run test`
Expected: PASS, all suites — including the migration test, the 3
`recorrenciaAindaAtiva` tests, and the 3 `diasParaVencimento`/
`progressoVencimento` tests.

- [ ] **Step 2: Full TypeScript check — web**

Run (from `web/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Full TypeScript check — mobile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual walkthrough (web) — recorrência com data de término**

1. Start the web dev server, open Financeiro.
2. Create a despesa recorrente mensal with "Repetir até" set to a date in the *current* viewed month.
3. Navigate to the following month — confirm the "lançar agora" banner still offers this despesa (end date is still ≥ that month's start).
4. Navigate one more month forward — confirm the banner no longer offers it (end date is now before that month's start).
5. Edit an existing despesa recorrente, set "Repetir até" to a past date, save, reload — confirm the field persists and the banner behavior matches step 4 for the currently viewed month.

- [ ] **Step 5: Manual walkthrough (web) — progresso de vencimento**

1. In the same Financeiro page, confirm the "Despesas" card header now shows "R$ X pendente · Y despesas" matching the sum/count of pending rows.
2. Create a despesa avulsa (not recorrente) with `data_vencimento` a few days out — confirm its row shows "· faltam N dias" and a thin amber bar under the row, partially filled.
3. Edit that despesa's `data_vencimento` to today — confirm the row shows "· vence hoje".
4. Edit it to a past date — confirm the row shows "· atrasada há N dias" and the bar turns red and full.
5. Mark a pending despesa as paid — confirm the bar and days text disappear (only pending despesas with a due date show them).

- [ ] **Step 6: Manual walkthrough (mobile)**

1. Open the mobile app, go to Financeiro → Nova despesa, mark "Despesa recorrente", fill "Repetir até" with a date.
2. Save, then open the same despesa in "Editar despesa" — confirm the date shows correctly (DD/MM/AAAA) and can be edited.
3. On the Financeiro screen, confirm the "Despesas" section header shows the pending summary, and that pending rows with a due date show the days-remaining text and progress bar (mirroring the web behavior from Step 5 above).

- [ ] **Step 7: Update CLAUDE.md audit log**

Add an entry to the "HISTÓRICO DE AUDITORIAS" section following the existing format (see the 2026-06-06 sessions), summarizing this feature's delivery. This step has no code — just document what shipped, matching the project's existing self-audit convention.
