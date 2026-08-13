# Taxa de reserva cobrada e descontada na comanda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff mark a taxa de reserva as already-charged right when creating an appointment, and have the comanda (checkout) automatically deduct any already-paid reservation fees from the amount the client owes at close-out — on both web and mobile.

**Architecture:** Three pure, unit-tested functions in a new `shared/taxa-reserva.ts` (mirroring the existing `shared/despesas.ts` pattern): one builds the `taxas_reserva` insert payload from a "was it charged now?" flag, one sums paid reservation fees scoped to a set of appointment IDs, one applies that sum as a floor-at-zero discount alongside the existing manual discount. A new nullable-with-default `comandas.desconto_reserva` column tracks how much of the total discount came from reservation fees (audit-only — the existing generated `valor_final = valor_total - desconto` column keeps working unchanged because the reservation deduction is folded into `desconto` itself). Every touch point is additive: nothing existing is removed, renamed, or restructured.

**Tech Stack:** Next.js 15 App Router + Supabase (Postgres/RLS) for web; Expo/React Native for mobile; Vitest for unit tests and migration static-content tests.

## Global Constraints

- Migrations go in `supabase/migrations/NNN_descricao.sql`, sequential; next available is `057` (056 is the current max).
- No RLS changes needed — `desconto_reserva` is a plain column on `comandas`, covered by whatever policy already governs `comandas` inserts/updates.
- pt-BR for all UI copy, commit messages, and code comments (existing project convention).
- Web and mobile ship together — every user-facing change in this plan has a task on both platforms (matches the existing `taxas_reserva` feature's own stated scope: "web e mobile juntos, mesma entrega").
- The "Já foi cobrada?" toggle only appears on appointment **creation**, never on edit — matches the existing taxa de reserva field's own visibility rule (`!agEditar` on web; the mobile screen has no edit mode at all for this field).
- Run `npx tsc --noEmit` from `web/` and from `mobile/` after touching files in each, respectively.
- `mobile/` has ~10 pre-existing TypeScript errors in files this plan never touches (`comissoes.tsx`, `configuracoes.tsx`, `estoque.tsx`, `novo-cliente.tsx`, `relatorios.tsx`, `useAgenda.ts`, `useNotificacoes.ts`) — confirmed against the base branch in a prior session. Do not treat these as caused by this plan; only flag genuinely new errors.

---

### Task 1: Migration — `comandas.desconto_reserva` column

**Files:**
- Create: `supabase/migrations/057_comandas_desconto_reserva.sql`
- Create: `web/tests/unit/comandas-desconto-reserva-migration.test.ts`
- Modify: `web/types/index.ts:102-112` (`Comanda` interface)
- Modify: `mobile/types/index.ts:111-121` (`Comanda` interface)

**Interfaces:**
- Produces: column `public.comandas.desconto_reserva` (`numeric(10,2)`, `not null default 0`) — consumed by Task 6 (web comanda) and Task 7 (mobile comanda) via Supabase insert/update payloads.

- [ ] **Step 1: Write the failing migration-content test**

```ts
// web/tests/unit/comandas-desconto-reserva-migration.test.ts
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

describe('Migration: comandas.desconto_reserva', () => {
  const migrations = readAllMigrations();

  it('adiciona a coluna desconto_reserva na tabela comandas', () => {
    expect(migrations).toMatch(/alter table public\.comandas\s+add column desconto_reserva numeric\(10,\s*2\)\s+not null default 0/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npm run test -- comandas-desconto-reserva-migration`
Expected: FAIL — `supabase/migrations/057_comandas_desconto_reserva.sql` doesn't exist yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/057_comandas_desconto_reserva.sql
-- ============================================================
-- COMANDAS — rastreio de quanto do desconto veio de taxa de reserva
--
-- Quando uma comanda desconta taxas de reserva já pagas dos
-- agendamentos que a compõem, o valor descontado entra somado na
-- coluna `desconto` já existente (para `valor_final` continuar
-- correto sem precisar mexer na coluna gerada) e, separadamente,
-- nesta coluna nova — só para auditoria/rastreio de quanto foi
-- desconto manual vs. taxa de reserva já paga.
-- ============================================================

alter table public.comandas
  add column desconto_reserva numeric(10,2) not null default 0;
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npm run test -- comandas-desconto-reserva-migration`
Expected: PASS

- [ ] **Step 5: Add the field to `web/types/index.ts`**

Current (lines 102-112):
```ts
export interface Comanda {
  id: string;
  empresa_id: string;
  cliente_id: string;
  profissional_id?: string;
  status: ComandaStatus;
  valor_total: number;
  desconto: number;
  valor_final: number;
  observacao?: string;
  fechada_at?: string;
```

New:
```ts
export interface Comanda {
  id: string;
  empresa_id: string;
  cliente_id: string;
  profissional_id?: string;
  status: ComandaStatus;
  valor_total: number;
  desconto: number;
  desconto_reserva?: number;
  valor_final: number;
  observacao?: string;
  fechada_at?: string;
```

- [ ] **Step 6: Add the field to `mobile/types/index.ts`**

Current (lines 111-121):
```ts
export interface Comanda {
  id: string;
  empresa_id: string;
  cliente_id: string;
  profissional_id?: string;
  status: ComandaStatus;
  valor_total: number;
  desconto: number;
  valor_final: number;
  observacao?: string;
  fechada_at?: string;
```

New:
```ts
export interface Comanda {
  id: string;
  empresa_id: string;
  cliente_id: string;
  profissional_id?: string;
  status: ComandaStatus;
  valor_total: number;
  desconto: number;
  desconto_reserva?: number;
  valor_final: number;
  observacao?: string;
  fechada_at?: string;
```

- [ ] **Step 7: Verify types compile**

Run (from `web/`): `npx tsc --noEmit` — expect no errors.
Run (from `mobile/`): `npx tsc --noEmit` — expect only the ~10 known pre-existing errors, nothing new.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/057_comandas_desconto_reserva.sql web/tests/unit/comandas-desconto-reserva-migration.test.ts web/types/index.ts mobile/types/index.ts
git commit -m "feat: adiciona coluna desconto_reserva em comandas"
```

---

### Task 2: Shared helpers — `shared/taxa-reserva.ts`

**Files:**
- Create: `shared/taxa-reserva.ts`
- Create: `web/tests/unit/taxa-reserva.test.ts`

**Interfaces:**
- Produces:
  - `buildTaxaReservaInsert(params: { empresaId: string; agendamentoId: string; clienteId: string | null; valor: number; jaCobrada: boolean }, agoraIso: string): TaxaReservaInsertPayload | null` — consumed by Task 3, 4, 5.
  - `somarTaxasReservaPagas(agendamentoIds: string[], taxasPagas: { agendamento_id: string; valor: number }[]): number` — consumed by Task 6, 7.
  - `aplicarDescontoReserva(subtotal: number, descontoManual: number, descontoReserva: number): { total: number; descontoReservaAplicado: number }` — consumed by Task 6, 7.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/unit/taxa-reserva.test.ts
import { describe, expect, it } from 'vitest';
import {
  aplicarDescontoReserva,
  buildTaxaReservaInsert,
  somarTaxasReservaPagas,
} from '@shared/taxa-reserva';

describe('taxa de reserva helpers', () => {
  describe('buildTaxaReservaInsert', () => {
    const base = { empresaId: 'emp1', agendamentoId: 'ag1', clienteId: 'cli1', valor: 50 };

    it('retorna null quando o valor e zero ou negativo', () => {
      expect(buildTaxaReservaInsert({ ...base, valor: 0, jaCobrada: false }, '2026-08-12T10:00:00.000Z')).toBeNull();
      expect(buildTaxaReservaInsert({ ...base, valor: -5, jaCobrada: true }, '2026-08-12T10:00:00.000Z')).toBeNull();
    });

    it('marca como paga com paga_em quando ja foi cobrada', () => {
      expect(buildTaxaReservaInsert({ ...base, jaCobrada: true }, '2026-08-12T10:00:00.000Z')).toEqual({
        empresa_id: 'emp1',
        agendamento_id: 'ag1',
        cliente_id: 'cli1',
        valor: 50,
        status: 'pago',
        paga_em: '2026-08-12T10:00:00.000Z',
      });
    });

    it('marca como pendente sem paga_em quando ainda nao foi cobrada', () => {
      expect(buildTaxaReservaInsert({ ...base, jaCobrada: false }, '2026-08-12T10:00:00.000Z')).toEqual({
        empresa_id: 'emp1',
        agendamento_id: 'ag1',
        cliente_id: 'cli1',
        valor: 50,
        status: 'pendente',
        paga_em: null,
      });
    });
  });

  describe('somarTaxasReservaPagas', () => {
    it('soma so as taxas cujo agendamento esta na lista informada', () => {
      const taxas = [
        { agendamento_id: 'a1', valor: 30 },
        { agendamento_id: 'a3', valor: 20 },
      ];
      expect(somarTaxasReservaPagas(['a1', 'a2'], taxas)).toBe(30);
    });

    it('soma multiplas taxas quando varios agendamentos da comanda tem taxa paga', () => {
      const taxas = [
        { agendamento_id: 'a1', valor: 30 },
        { agendamento_id: 'a2', valor: 20 },
      ];
      expect(somarTaxasReservaPagas(['a1', 'a2'], taxas)).toBe(50);
    });

    it('retorna zero quando nao ha ids ou nao ha taxas', () => {
      expect(somarTaxasReservaPagas([], [{ agendamento_id: 'a1', valor: 30 }])).toBe(0);
      expect(somarTaxasReservaPagas(['a1'], [])).toBe(0);
    });
  });

  describe('aplicarDescontoReserva', () => {
    it('desconta a taxa de reserva paga do total, exemplo do usuario (100 - 30 = 70)', () => {
      expect(aplicarDescontoReserva(100, 0, 30)).toEqual({ total: 70, descontoReservaAplicado: 30 });
    });

    it('limita o desconto de reserva ao que sobra depois do desconto manual', () => {
      expect(aplicarDescontoReserva(100, 80, 30)).toEqual({ total: 0, descontoReservaAplicado: 20 });
    });

    it('nunca deixa o total negativo quando a reserva paga e maior que o subtotal', () => {
      expect(aplicarDescontoReserva(50, 0, 80)).toEqual({ total: 0, descontoReservaAplicado: 50 });
    });

    it('nao aplica nada quando o subtotal ja e zero', () => {
      expect(aplicarDescontoReserva(0, 0, 30)).toEqual({ total: 0, descontoReservaAplicado: 0 });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `web/`): `npm run test -- taxa-reserva`
Expected: FAIL — `shared/taxa-reserva.ts` doesn't exist yet (import error).

- [ ] **Step 3: Implement the helpers**

```ts
// shared/taxa-reserva.ts

export type TaxaReservaInsertPayload = {
  empresa_id: string;
  agendamento_id: string;
  cliente_id: string | null;
  valor: number;
  status: 'pendente' | 'pago';
  paga_em: string | null;
};

/**
 * Monta o payload de insert de taxas_reserva a partir de um valor e da
 * indicacao explicita, feita na hora do agendamento, de que a taxa ja foi
 * cobrada. Retorna null quando o valor e zero ou negativo (nenhuma linha
 * deve ser criada, mesma regra ja usada para a taxa de cancelamento).
 */
export function buildTaxaReservaInsert(
  params: {
    empresaId: string;
    agendamentoId: string;
    clienteId: string | null;
    valor: number;
    jaCobrada: boolean;
  },
  agoraIso: string,
): TaxaReservaInsertPayload | null {
  if (params.valor <= 0) return null;
  return {
    empresa_id: params.empresaId,
    agendamento_id: params.agendamentoId,
    cliente_id: params.clienteId,
    valor: params.valor,
    status: params.jaCobrada ? 'pago' : 'pendente',
    paga_em: params.jaCobrada ? agoraIso : null,
  };
}

/**
 * Soma o valor das taxas de reserva pagas cujo agendamento_id esta entre os
 * agendamentos presentes numa comanda.
 */
export function somarTaxasReservaPagas(
  agendamentoIds: string[],
  taxasPagas: { agendamento_id: string; valor: number }[],
): number {
  const idsNaComanda = new Set(agendamentoIds);
  return taxasPagas
    .filter(t => idsNaComanda.has(t.agendamento_id))
    .reduce((soma, t) => soma + t.valor, 0);
}

/**
 * Aplica o desconto de taxa de reserva ja paga sobre o total da comanda,
 * depois do desconto manual. Limitado ao que sobra do subtotal (nunca deixa
 * o total negativo, mesma regra ja usada pelo desconto manual).
 */
export function aplicarDescontoReserva(
  subtotal: number,
  descontoManual: number,
  descontoReserva: number,
): { total: number; descontoReservaAplicado: number } {
  const descontoReservaAplicado = Math.min(
    descontoReserva,
    Math.max(subtotal - descontoManual, 0),
  );
  const total = Math.max(subtotal - descontoManual - descontoReservaAplicado, 0);
  return { total, descontoReservaAplicado };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `web/`): `npm run test -- taxa-reserva`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/taxa-reserva.ts web/tests/unit/taxa-reserva.test.ts
git commit -m "feat: adiciona helpers de taxa de reserva (cobranca e desconto na comanda)"
```

---

### Task 3: Web UI — "Já foi cobrada?" no agendamento (`agenda/page.tsx`)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: `buildTaxaReservaInsert` from `@shared/taxa-reserva` (Task 2).
- Produces: `taxas_reserva` rows created with `status: 'pago'` when marked as already charged — read back by Task 6's comanda deduction.

- [ ] **Step 1: Import the helper**

Find the existing imports near the top of the file (search for an existing `@shared/` import, or add a new one near the other `@/` imports if none exists yet):

```tsx
import { buildTaxaReservaInsert } from '@shared/taxa-reserva';
```

- [ ] **Step 2: Add state for the toggle**

Current (line 220):
```tsx
  const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
```

New (add the line right after):
```tsx
  const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
  const [taxaReservaCobrada, setTaxaReservaCobrada] = useState(false);
```

- [ ] **Step 3: Replace the taxa de reserva insert with the shared helper**

Current (lines 450-463):
```tsx
      const taxaReservaValorNum = parseFloat(taxaReserva.replace(',', '.')) || 0;
      if (taxaReservaValorNum > 0) {
        const { error: erroReserva } = await supabase.from('taxas_reserva').insert({
          empresa_id: empresaId,
          agendamento_id: agId,
          cliente_id: clienteId,
          valor: taxaReservaValorNum,
          status: 'pendente',
        });
        if (erroReserva) {
          console.error('Erro ao registrar taxa de reserva:', erroReserva.message);
          setAvisoTaxaReserva('Agendamento criado, mas a taxa de reserva não pôde ser registrada.');
        }
      }
```

New:
```tsx
      const taxaReservaValorNum = parseFloat(taxaReserva.replace(',', '.')) || 0;
      const taxaReservaPayload = buildTaxaReservaInsert({
        empresaId, agendamentoId: agId, clienteId, valor: taxaReservaValorNum,
        jaCobrada: taxaReservaCobrada,
      }, new Date().toISOString());
      if (taxaReservaPayload) {
        const { error: erroReserva } = await supabase.from('taxas_reserva').insert(taxaReservaPayload);
        if (erroReserva) {
          console.error('Erro ao registrar taxa de reserva:', erroReserva.message);
          setAvisoTaxaReserva('Agendamento criado, mas a taxa de reserva não pôde ser registrada.');
        }
      }
```

- [ ] **Step 4: Add the toggle to the form**

Current (lines 792-805):
```tsx
          {taxaReservaCfg.ativa && !agEditar && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Taxa de reserva</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input
                  value={taxaReserva}
                  onChange={e => { setTaxaReserva(e.target.value); setTaxaReservaEditada(true); }}
                  inputMode="decimal" placeholder="0,00"
                  className={`${inputClass} pl-9`}
                />
              </div>
            </div>
          )}
```

New:
```tsx
          {taxaReservaCfg.ativa && !agEditar && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Taxa de reserva</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input
                  value={taxaReserva}
                  onChange={e => { setTaxaReserva(e.target.value); setTaxaReservaEditada(true); }}
                  inputMode="decimal" placeholder="0,00"
                  className={`${inputClass} pl-9`}
                />
              </div>
              {(parseFloat(taxaReserva.replace(',', '.')) || 0) > 0 && (
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={taxaReservaCobrada}
                    onChange={e => setTaxaReservaCobrada(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-accent"
                  />
                  <span className="text-xs text-text-2">Já foi cobrada?</span>
                </label>
              )}
            </div>
          )}
```

- [ ] **Step 5: Verify types compile**

Run (from `web/`): `npx tsc --noEmit` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx"
git commit -m "feat: adiciona toggle 'ja foi cobrada' na taxa de reserva do agendamento (web/agenda)"
```

---

### Task 4: Web UI — "Já foi cobrada?" no agendamento rápido (`clientes/[id]/page.tsx`)

**Files:**
- Modify: `web/app/(app)/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: `buildTaxaReservaInsert` from `@shared/taxa-reserva` (Task 2).
- Produces: same as Task 3, for the quick-schedule modal on the client profile page.

- [ ] **Step 1: Import the helper**

```tsx
import { buildTaxaReservaInsert } from '@shared/taxa-reserva';
```

- [ ] **Step 2: Add state for the toggle**

Current (line 124):
```tsx
  const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
```

New (add the line right after):
```tsx
  const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
  const [taxaReservaCobrada, setTaxaReservaCobrada] = useState(false);
```

- [ ] **Step 3: Replace the taxa de reserva insert with the shared helper**

Current (lines 181-193):
```tsx
    const taxaReservaValorNum = parseFloat(taxaReserva.replace(',', '.')) || 0;
    if (taxaReservaValorNum > 0) {
      const { error: erroReserva } = await supabase.from('taxas_reserva').insert({
        empresa_id: empresaId,
        agendamento_id: ag.id,
        cliente_id: clienteId,
        valor: taxaReservaValorNum,
        status: 'pendente',
      });
      if (erroReserva) {
        console.error('Erro ao registrar taxa de reserva:', erroReserva.message);
      }
    }
```

New:
```tsx
    const taxaReservaValorNum = parseFloat(taxaReserva.replace(',', '.')) || 0;
    const taxaReservaPayload = buildTaxaReservaInsert({
      empresaId, agendamentoId: ag.id, clienteId, valor: taxaReservaValorNum,
      jaCobrada: taxaReservaCobrada,
    }, new Date().toISOString());
    if (taxaReservaPayload) {
      const { error: erroReserva } = await supabase.from('taxas_reserva').insert(taxaReservaPayload);
      if (erroReserva) {
        console.error('Erro ao registrar taxa de reserva:', erroReserva.message);
      }
    }
```

- [ ] **Step 4: Add the toggle to the form**

Current (lines 251-264):
```tsx
          {taxaReservaCfg.ativa && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Taxa de reserva</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input
                  value={taxaReserva}
                  onChange={e => { setTaxaReserva(e.target.value); setTaxaReservaEditada(true); }}
                  inputMode="decimal" placeholder="0,00"
                  className={`${inputCls} pl-9`}
                />
              </div>
            </div>
          )}
```

New:
```tsx
          {taxaReservaCfg.ativa && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Taxa de reserva</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input
                  value={taxaReserva}
                  onChange={e => { setTaxaReserva(e.target.value); setTaxaReservaEditada(true); }}
                  inputMode="decimal" placeholder="0,00"
                  className={`${inputCls} pl-9`}
                />
              </div>
              {(parseFloat(taxaReserva.replace(',', '.')) || 0) > 0 && (
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={taxaReservaCobrada}
                    onChange={e => setTaxaReservaCobrada(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-accent"
                  />
                  <span className="text-xs text-text-2">Já foi cobrada?</span>
                </label>
              )}
            </div>
          )}
```

- [ ] **Step 5: Verify types compile**

Run (from `web/`): `npx tsc --noEmit` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/clientes/[id]/page.tsx"
git commit -m "feat: adiciona toggle 'ja foi cobrada' na taxa de reserva do agendamento rapido (web/clientes)"
```

---

### Task 5: Mobile UI — "Já foi cobrada?" no agendamento (`novo-agendamento.tsx`)

**Files:**
- Modify: `mobile/app/(empresa)/novo-agendamento.tsx`

**Interfaces:**
- Consumes: `buildTaxaReservaInsert` from `@shared/taxa-reserva` (Task 2).
- Produces: same as Task 3/4, for the mobile "Novo agendamento" screen.

- [ ] **Step 1: Import the helper**

Find the existing `import { supabase } from '@/lib/supabase';` line (or similar) near the top and add, on its own line nearby:

```tsx
import { buildTaxaReservaInsert } from '@shared/taxa-reserva';
```

- [ ] **Step 2: Add state for the toggle**

Current (line 136):
```tsx
  const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
```

New (add the line right after):
```tsx
  const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
  const [taxaReservaCobrada, setTaxaReservaCobrada] = useState(false);
```

- [ ] **Step 3: Replace the taxa de reserva insert with the shared helper**

Current (lines 362-375):
```tsx
    const taxaReservaValorNum = parseFloat(taxaReserva.replace(',', '.')) || 0;
    if (taxaReservaValorNum > 0 && novoAg) {
      const { error: erroReserva } = await supabase.from('taxas_reserva').insert({
        empresa_id:     empresaAtiva.id,
        agendamento_id: novoAg.id,
        cliente_id:     clienteSelecionado!.id,
        valor:          taxaReservaValorNum,
        status:         'pendente',
      });
      if (erroReserva) {
        console.error('Erro ao registrar taxa de reserva:', erroReserva.message);
        setAvisoTaxaReserva('Agendamento criado, mas a taxa de reserva não pôde ser registrada.');
      }
    }
```

New:
```tsx
    const taxaReservaValorNum = parseFloat(taxaReserva.replace(',', '.')) || 0;
    if (novoAg) {
      const taxaReservaPayload = buildTaxaReservaInsert({
        empresaId: empresaAtiva.id, agendamentoId: novoAg.id,
        clienteId: clienteSelecionado!.id, valor: taxaReservaValorNum,
        jaCobrada: taxaReservaCobrada,
      }, new Date().toISOString());
      if (taxaReservaPayload) {
        const { error: erroReserva } = await supabase.from('taxas_reserva').insert(taxaReservaPayload);
        if (erroReserva) {
          console.error('Erro ao registrar taxa de reserva:', erroReserva.message);
          setAvisoTaxaReserva('Agendamento criado, mas a taxa de reserva não pôde ser registrada.');
        }
      }
    }
```

- [ ] **Step 4: Add the toggle to the form**

Current (lines 790-811):
```tsx
          {taxaReservaAtiva && (
            <View style={{
              marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingHorizontal: 14,
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <DollarSign size={16} color={C.text4} strokeWidth={1.8} />
              <TextInput
                value={taxaReserva}
                onChangeText={v => { setTaxaReserva(v); setTaxaReservaEditada(true); }}
                placeholder="Taxa de reserva (0,00)"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                style={{
                  flex: 1, paddingVertical: 14,
                  fontFamily: 'PlusJakartaSans_600SemiBold',
                  fontSize: 16, color: C.text,
                }}
              />
            </View>
          )}
```

New:
```tsx
          {taxaReservaAtiva && (
            <View style={{
              marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingHorizontal: 14,
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <DollarSign size={16} color={C.text4} strokeWidth={1.8} />
              <TextInput
                value={taxaReserva}
                onChangeText={v => { setTaxaReserva(v); setTaxaReservaEditada(true); }}
                placeholder="Taxa de reserva (0,00)"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                style={{
                  flex: 1, paddingVertical: 14,
                  fontFamily: 'PlusJakartaSans_600SemiBold',
                  fontSize: 16, color: C.text,
                }}
              />
            </View>
          )}
          {taxaReservaAtiva && (parseFloat(taxaReserva.replace(',', '.')) || 0) > 0 && (
            <TouchableOpacity
              onPress={() => setTaxaReservaCobrada(v => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}
            >
              <View style={{
                width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                borderColor: taxaReservaCobrada ? C.primary : C.border,
                backgroundColor: taxaReservaCobrada ? C.primary : C.surface,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {taxaReservaCobrada && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 14 }}>✓</Text>}
              </View>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>
                Já foi cobrada?
              </Text>
            </TouchableOpacity>
          )}
```

- [ ] **Step 5: Confirm `TouchableOpacity` is imported**

Check the file's existing `import { ... } from 'react-native';` line. If `TouchableOpacity` isn't already in that list (it almost certainly is, given the rest of the screen uses buttons), add it. Read the import line first — don't assume.

- [ ] **Step 6: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit` — expect only the ~10 known pre-existing errors, nothing new.

- [ ] **Step 7: Commit**

```bash
git add "mobile/app/(empresa)/novo-agendamento.tsx"
git commit -m "feat: adiciona toggle 'ja foi cobrada' na taxa de reserva do agendamento (mobile)"
```

---

### Task 6: Web UI — desconto automático na comanda (`comanda/page.tsx`)

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`

**Interfaces:**
- Consumes: `somarTaxasReservaPagas`, `aplicarDescontoReserva` from `@shared/taxa-reserva` (Task 2).
- Produces: `comandas.desconto`/`desconto_reserva` written with the reservation-fee deduction folded in — closes the loop the spec opened; nothing downstream depends on this beyond the DB row itself.

- [ ] **Step 1: Import the helpers**

Find the file's existing imports (there should already be a `@shared/` import or a cluster of `@/lib`/`@/components` imports near the top) and add:

```tsx
import { aplicarDescontoReserva, somarTaxasReservaPagas } from '@shared/taxa-reserva';
```

- [ ] **Step 2: Add state for fetched paid reservation fees**

Current (around line 186, alongside the other catalog state):
```tsx
  const [agDia,             setAgDia]             = useState<AgDia[]>([]);
```

New (add the line right after):
```tsx
  const [agDia,             setAgDia]             = useState<AgDia[]>([]);
  const [taxasReservaPagas, setTaxasReservaPagas] = useState<{ agendamento_id: string; valor: number }[]>([]);
```

- [ ] **Step 3: Fetch paid reservation fees alongside the other catalogs**

Current (lines 241-262):
```tsx
    Promise.all([
      // Agendamentos do dia (exceto cancelados)
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, data_hora_fim, status, valor, comanda_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco),
          agendamento_servicos(servico_id,valor,duracao_minutos,ordem,servico:servicos(id,nome))`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(dataComanda).toISOString())
        .lte('data_hora_inicio', endOfDay(dataComanda).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),

      // Catálogos
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      supabase.from('empresa_membros')
        .select('user_id, users:users!empresa_membros_user_id_fkey(nome)')
        .eq('empresa_id', empresaId).eq('ativo', true),
      supabase.from('pacotes').select('id, nome, preco, validade_dias').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([rAgs, rServs, rProds, rMembros, rPacotes]) => {
      setAgDia((rAgs.data ?? []) as unknown as AgDia[]);
      setServicos((rServs.data ?? []) as { id: string; nome: string; preco: number }[]);
      setProdutos((rProds.data ?? []) as { id: string; nome: string; preco_venda: number }[]);
      setMembros((rMembros.data ?? []).map((m: any) => ({
        id: m.user_id, nome: m.users?.nome ?? 'Profissional',
      })));
      setPacotesCat((rPacotes.data ?? []) as { id: string; nome: string; preco: number; validade_dias: number | null }[]);
      setLoading(false);
    });
```

New:
```tsx
    Promise.all([
      // Agendamentos do dia (exceto cancelados)
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, data_hora_fim, status, valor, comanda_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco),
          agendamento_servicos(servico_id,valor,duracao_minutos,ordem,servico:servicos(id,nome))`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(dataComanda).toISOString())
        .lte('data_hora_inicio', endOfDay(dataComanda).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),

      // Catálogos
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      supabase.from('empresa_membros')
        .select('user_id, users:users!empresa_membros_user_id_fkey(nome)')
        .eq('empresa_id', empresaId).eq('ativo', true),
      supabase.from('pacotes').select('id, nome, preco, validade_dias').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),

      // Taxas de reserva já pagas — usadas para descontar da comanda
      supabase.from('taxas_reserva').select('agendamento_id, valor')
        .eq('empresa_id', empresaId).eq('status', 'pago'),
    ]).then(([rAgs, rServs, rProds, rMembros, rPacotes, rTaxasReserva]) => {
      setAgDia((rAgs.data ?? []) as unknown as AgDia[]);
      setServicos((rServs.data ?? []) as { id: string; nome: string; preco: number }[]);
      setProdutos((rProds.data ?? []) as { id: string; nome: string; preco_venda: number }[]);
      setMembros((rMembros.data ?? []).map((m: any) => ({
        id: m.user_id, nome: m.users?.nome ?? 'Profissional',
      })));
      setPacotesCat((rPacotes.data ?? []) as { id: string; nome: string; preco: number; validade_dias: number | null }[]);
      setTaxasReservaPagas((rTaxasReserva.data ?? []) as { agendamento_id: string; valor: number }[]);
      setLoading(false);
    });
```

- [ ] **Step 4: Compute the reservation-fee deduction alongside the existing totals**

Current (lines 555-561):
```tsx
  // ── Totais
  const subtotal  = itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
  const descontoPctN = parseFloat(descontoPct.replace(',', '.')) || 0;
  const descontoN    = subtotal * (descontoPctN / 100);
  const total        = Math.max(subtotal - descontoN, 0);
  const recebido  = splits.reduce((s, x) => s + (parseFloat(x.valor.replace(',', '.')) || 0), 0);
  const restante  = total - recebido;
```

New:
```tsx
  // ── Totais
  const subtotal  = itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
  const descontoPctN = parseFloat(descontoPct.replace(',', '.')) || 0;
  const descontoN    = subtotal * (descontoPctN / 100);
  const agendamentoIdsNaComanda = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);
  const descontoReservaN = somarTaxasReservaPagas(agendamentoIdsNaComanda, taxasReservaPagas);
  const { total, descontoReservaAplicado } = aplicarDescontoReserva(subtotal, descontoN, descontoReservaN);
  const recebido  = splits.reduce((s, x) => s + (parseFloat(x.valor.replace(',', '.')) || 0), 0);
  const restante  = total - recebido;
```

- [ ] **Step 5: Show the deduction in the summary UI**

Current (lines 1201-1217):
```tsx
                {/* ── Seção: Resumo de valores ── */}
                <section className="bg-bg rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-sm text-text-2">Subtotal</span>
                    <span className="text-sm font-semibold text-text">{fmtBRL(subtotal)}</span>
                  </div>
                  {descontoN > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <span className="text-sm text-text-2">(−) Desconto <span className="text-xs text-text-4">{descontoPctN}%</span></span>
                      <span className="text-sm font-semibold text-red">− {fmtBRL(descontoN)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-4">
                    <span className="text-base font-bold text-text">Total</span>
                    <span className="text-2xl font-bold text-text" style={{ letterSpacing: '-0.02em' }}>{fmtBRL(total)}</span>
                  </div>
                </section>
```

New:
```tsx
                {/* ── Seção: Resumo de valores ── */}
                <section className="bg-bg rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-sm text-text-2">Subtotal</span>
                    <span className="text-sm font-semibold text-text">{fmtBRL(subtotal)}</span>
                  </div>
                  {descontoReservaAplicado > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <span className="text-sm text-text-2">Taxa de reserva paga</span>
                      <span className="text-sm font-semibold text-red">− {fmtBRL(descontoReservaAplicado)}</span>
                    </div>
                  )}
                  {descontoN > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <span className="text-sm text-text-2">(−) Desconto <span className="text-xs text-text-4">{descontoPctN}%</span></span>
                      <span className="text-sm font-semibold text-red">− {fmtBRL(descontoN)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-4">
                    <span className="text-base font-bold text-text">Total</span>
                    <span className="text-2xl font-bold text-text" style={{ letterSpacing: '-0.02em' }}>{fmtBRL(total)}</span>
                  </div>
                </section>
```

- [ ] **Step 6: Persist the deduction when closing a new comanda**

Current (lines 590-599):
```tsx
    // 1. Criar comanda no banco
    const { data: comanda, error: errComanda } = await supabase
      .from('comandas').insert({
        empresa_id:  empresaId,
        clientes_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: subtotal,
        desconto:    descontoN,
        status:      'fechada',
        fechada_at:  new Date().toISOString(),
      }).select('id').single();
```

New:
```tsx
    // 1. Criar comanda no banco
    const { data: comanda, error: errComanda } = await supabase
      .from('comandas').insert({
        empresa_id:  empresaId,
        clientes_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: subtotal,
        desconto:    descontoN + descontoReservaAplicado,
        desconto_reserva: descontoReservaAplicado,
        status:      'fechada',
        fechada_at:  new Date().toISOString(),
      }).select('id').single();
```

- [ ] **Step 7: Fix the receipt to reflect the real amount charged (new comanda path)**

Current (lines 508-512, inside `fecharComanda`):
```tsx
    const reciboDesconto = descontoN;
    setClienteSel(null);
    setComandaExistenteId(null);
    setSucesso({ nome: nomeCliente, valor: subtotal - descontoN, telefone: telefoneCliente, itens: reciboItens, splits: reciboSplits, desconto: reciboDesconto, data: new Date() });
```

New:
```tsx
    const reciboDesconto = descontoN + descontoReservaAplicado;
    setClienteSel(null);
    setComandaExistenteId(null);
    setSucesso({ nome: nomeCliente, valor: total, telefone: telefoneCliente, itens: reciboItens, splits: reciboSplits, desconto: reciboDesconto, data: new Date() });
```

- [ ] **Step 8: Persist the deduction when editing an already-closed comanda**

Current (lines 457-459, inside `editarComanda`):
```tsx
    const { error: errCmd } = await supabase.from('comandas')
      .update({ valor_total: subtotal, desconto: descontoN })
      .eq('id', comandaId);
```

New:
```tsx
    const { error: errCmd } = await supabase.from('comandas')
      .update({ valor_total: subtotal, desconto: descontoN + descontoReservaAplicado, desconto_reserva: descontoReservaAplicado })
      .eq('id', comandaId);
```

- [ ] **Step 9: Fix the receipt to reflect the real amount charged (edit-comanda path)**

Current (lines 509-512, inside `editarComanda` — same variable names as Step 7 but a separate function, edit separately):
```tsx
    const reciboDesconto = descontoN;
    setClienteSel(null);
    setComandaExistenteId(null);
    setSucesso({ nome: nomeCliente, valor: subtotal - descontoN, telefone: telefoneCliente, itens: reciboItens, splits: reciboSplits, desconto: reciboDesconto, data: new Date() });
```

New:
```tsx
    const reciboDesconto = descontoN + descontoReservaAplicado;
    setClienteSel(null);
    setComandaExistenteId(null);
    setSucesso({ nome: nomeCliente, valor: total, telefone: telefoneCliente, itens: reciboItens, splits: reciboSplits, desconto: reciboDesconto, data: new Date() });
```

**Note:** Steps 7 and 9 target textually identical code in two different functions (`fecharComanda` and `editarComanda`) — the same duplicate-`old_string` situation encountered in a prior plan. Apply this edit with **replace all occurrences** (both call sites get the identical change), rather than trying to match them one at a time.

- [ ] **Step 10: Verify types compile and existing tests still pass**

Run (from `web/`): `npx tsc --noEmit` — expect no errors.
Run (from `web/`): `npm run test -- taxa-reserva` — expect PASS (unchanged, this task doesn't touch `shared/taxa-reserva.ts`).

- [ ] **Step 11: Commit**

```bash
git add "web/app/(app)/comanda/page.tsx"
git commit -m "feat: desconta taxa de reserva paga automaticamente na comanda (web)"
```

---

### Task 7: Mobile UI — desconto automático na comanda (`nova-comanda.tsx`)

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`

**Interfaces:**
- Consumes: `somarTaxasReservaPagas`, `aplicarDescontoReserva` from `@shared/taxa-reserva` (Task 2).
- Produces: same as Task 6, for the mobile comanda screen (create-only — no edit-comanda path on mobile).

- [ ] **Step 1: Import the helpers**

```tsx
import { aplicarDescontoReserva, somarTaxasReservaPagas } from '@shared/taxa-reserva';
```

- [ ] **Step 2: Add state for fetched paid reservation fees**

Current (line 113):
```tsx
  const [agDia, setAgDia] = useState<AgDia[]>([]);
```

New (add the line right after):
```tsx
  const [agDia, setAgDia] = useState<AgDia[]>([]);
  const [taxasReservaPagas, setTaxasReservaPagas] = useState<{ agendamento_id: string; valor: number }[]>([]);
```

- [ ] **Step 3: Fetch paid reservation fees alongside the other catalogs**

Current (lines 142-160):
```tsx
    Promise.all([
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, status, valor,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco)`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(hoje).toISOString())
        .lte('data_hora_inicio', endOfDay(hoje).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
    ]).then(([rAgs, rServs, rProds]) => {
      setAgDia((rAgs.data ?? []) as unknown as AgDia[]);
      setServicos((rServs.data ?? []) as any[]);
      setProdutos((rProds.data ?? []) as any[]);
      setLoading(false);
    });
```

New:
```tsx
    Promise.all([
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, status, valor,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco)`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(hoje).toISOString())
        .lte('data_hora_inicio', endOfDay(hoje).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      supabase.from('taxas_reserva').select('agendamento_id, valor')
        .eq('empresa_id', empresaId).eq('status', 'pago'),
    ]).then(([rAgs, rServs, rProds, rTaxasReserva]) => {
      setAgDia((rAgs.data ?? []) as unknown as AgDia[]);
      setServicos((rServs.data ?? []) as any[]);
      setProdutos((rProds.data ?? []) as any[]);
      setTaxasReservaPagas((rTaxasReserva.data ?? []) as { agendamento_id: string; valor: number }[]);
      setLoading(false);
    });
```

- [ ] **Step 4: Compute the reservation-fee deduction alongside the existing totals**

Current (lines 226-230):
```tsx
  const subtotal  = itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
  const descontoN = parseFloat(desconto.replace(',', '.')) || 0;
  const total     = Math.max(subtotal - descontoN, 0);
```

New:
```tsx
  const subtotal  = itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
  const descontoN = parseFloat(desconto.replace(',', '.')) || 0;
  const agendamentoIdsNaComanda = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);
  const descontoReservaN = somarTaxasReservaPagas(agendamentoIdsNaComanda, taxasReservaPagas);
  const { total, descontoReservaAplicado } = aplicarDescontoReserva(subtotal, descontoN, descontoReservaN);
```

- [ ] **Step 5: Show the deduction in the summary UI**

Current (lines 647-663):
```tsx
          {/* ── Resumo ── */}
          <View style={{ backgroundColor: C.bg, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Subtotal</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{fmtBRL(subtotal)}</Text>
            </View>
            {descontoN > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>(−) Desconto</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.red }}>− {fmtBRL(descontoN)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.text }}>Total</Text>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 24, color: C.text }}>{fmtBRL(total)}</Text>
            </View>
          </View>
```

New:
```tsx
          {/* ── Resumo ── */}
          <View style={{ backgroundColor: C.bg, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Subtotal</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{fmtBRL(subtotal)}</Text>
            </View>
            {descontoReservaAplicado > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Taxa de reserva paga</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.red }}>− {fmtBRL(descontoReservaAplicado)}</Text>
              </View>
            )}
            {descontoN > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>(−) Desconto</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.red }}>− {fmtBRL(descontoN)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.text }}>Total</Text>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 24, color: C.text }}>{fmtBRL(total)}</Text>
            </View>
          </View>
```

- [ ] **Step 6: Persist the deduction when closing the comanda**

Current (lines 242-248):
```tsx
    const { data: comanda, error: errComanda } = await supabase
      .from('comandas').insert({
        empresa_id: empresaId,
        clientes_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: subtotal, desconto: descontoN,
        status: 'fechada', fechada_at: new Date().toISOString(),
      }).select('id').single();
```

New:
```tsx
    const { data: comanda, error: errComanda } = await supabase
      .from('comandas').insert({
        empresa_id: empresaId,
        clientes_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: subtotal, desconto: descontoN + descontoReservaAplicado,
        desconto_reserva: descontoReservaAplicado,
        status: 'fechada', fechada_at: new Date().toISOString(),
      }).select('id').single();
```

- [ ] **Step 7: Fix the receipt discount to reflect the combined amount**

Current (lines 316-319):
```tsx
    setSucessoData({
      nome: clienteSel.nome, valor: total, telefone: clienteSel.telefone,
      splits: splitsValidos, itensCount: itens.length, desconto: descontoN,
    });
```

New:
```tsx
    setSucessoData({
      nome: clienteSel.nome, valor: total, telefone: clienteSel.telefone,
      splits: splitsValidos, itensCount: itens.length, desconto: descontoN + descontoReservaAplicado,
    });
```

Note: `valor: total` already needs no change — `total` now includes the reservation deduction automatically from Step 4's recomputation.

- [ ] **Step 8: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit` — expect only the ~10 known pre-existing errors, nothing new.

- [ ] **Step 9: Commit**

```bash
git add "mobile/app/(empresa)/nova-comanda.tsx"
git commit -m "feat: desconta taxa de reserva paga automaticamente na comanda (mobile)"
```

---

### Task 8: Full verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full web unit test suite**

Run (from `web/`): `npm run test`
Expected: PASS, all suites — including the new migration test and the 10 new `taxa-reserva` helper tests.

- [ ] **Step 2: Full TypeScript check — web**

Run (from `web/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Full TypeScript check — mobile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: only the ~10 known pre-existing errors in unrelated files, nothing new.

- [ ] **Step 4: Manual walkthrough (web) — cobrar taxa e ver desconto**

1. Em Configurações, confirme que "Taxa de reserva" está ativa para a empresa de teste.
2. Crie um novo agendamento (Agenda ou perfil do cliente) com um serviço de valor conhecido (ex: R$ 100), deixe a taxa de reserva sugerida (ex: R$ 30), marque "Já foi cobrada?" e salve.
3. Confirme no Financeiro que a taxa de reserva já aparece como "Paga" (sem precisar clicar em "marcar como paga").
4. Abra a Comanda para esse cliente no mesmo dia — confirme que aparece a linha "Taxa de reserva paga: −R$ 30,00" e que o total mostra R$ 70,00 (100 − 30).
5. Feche a comanda recebendo R$ 70,00 — confirme que o recibo mostra o valor e o desconto corretos.
6. Repita criando um agendamento SEM marcar "Já foi cobrada?" — confirme que a comanda não aplica nenhum desconto de reserva para esse agendamento (segue pendente, sem linha no resumo).

- [ ] **Step 5: Manual walkthrough (mobile) — mesmo fluxo**

1. Repita os passos 2, 4 e 5 do walkthrough web no app mobile (Novo agendamento com "Já foi cobrada?" marcado → Nova comanda mostrando o desconto e o total correto).

- [ ] **Step 6: Update CLAUDE.md audit log**

Add an entry to the "HISTÓRICO DE AUDITORIAS" section following the existing format (see the most recent prior session entries), summarizing this feature's delivery: taxa de reserva cobrada no agendamento + descontada automaticamente na comanda, web e mobile, com helpers testados em `shared/taxa-reserva.ts`. This step has no code — just document what shipped, matching the project's existing self-audit convention.
