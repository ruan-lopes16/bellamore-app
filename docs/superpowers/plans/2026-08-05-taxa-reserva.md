# Taxa de Reserva Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company charge a configurable booking/reservation fee at the moment a new appointment is created, with a value pre-filled from settings (% or fixed) but editable per booking, tracked to a "retained" state if the appointment is later cancelled — shipped in web and mobile.

**Architecture:** Unlike the sibling "taxa de cancelamento" feature (fully trigger-generated), this fee is created client-side by the app the moment staff saves a new appointment (an explicit `taxas_reserva` insert right after the `agendamentos` insert succeeds). A separate, small DB trigger (`reter_taxa_reserva()`) only handles the "retain on cancel" transition — it never generates rows, only flips status. Both apps get: a Configurações section, a "taxa de reserva" field on the novo-agendamento form, a Financeiro list + KPI, and a client-profile history section.

**Tech Stack:** Next.js 15 App Router + Supabase (Postgres/RLS) for web; Expo/React Native + `@tanstack/react-query` for mobile; Vitest for migration static-content tests.

## Global Constraints

- Migrations go in `supabase/migrations/NNN_descricao.sql`, sequential; next available is `054` (053 is the current max).
- Every new table needs RLS enabled with policies using `is_gestor_ou_owner()` or `minha_empresas()` (see `supabase/migrations/003_despesas_policies.sql`, `047_taxa_cancelamento_schema.sql`).
- `agendamentos.cliente_id` is nullable — mirror that in `taxas_reserva.cliente_id`.
- Client Components: `createClient()` at module level. Server Components: `await createClient()` inside the function.
- Queries in `Promise.all`, never sequential waterfalls.
- `npx tsc --noEmit` zero-error in `web/`; zero **new** errors in `mobile/` (mobile has a known, pre-existing, unrelated baseline of ~8 errors in other files — do not try to fix those).
- pt-BR UI copy.
- Taxa de reserva is registered manually at booking time (no auto-generation trigger); taxa de cancelamento (already shipped) and taxa de reserva are independent and can both apply to the same appointment.
- A `taxas_reserva` row with `status = 'retida'` is never reverted automatically if the appointment is un-cancelled (documented product decision, unlike `taxas_cancelamento`).

---

### Task 1: Migration — schema (`empresas` columns + `taxas_reserva` table + RLS)

**Files:**
- Create: `supabase/migrations/054_taxa_reserva_schema.sql`
- Create: `web/tests/unit/taxa-reserva-migrations.test.ts`

**Interfaces:**
- Produces: table `public.taxas_reserva(id, empresa_id, agendamento_id, cliente_id, valor, status, created_at, paga_em)` with `status in ('pendente','pago','retida')` and `unique(agendamento_id)`; columns `public.empresas.taxa_reserva_ativa|modo|valor`.

**Note on the INSERT policy:** unlike `taxas_cancelamento` (whose only writer is a `SECURITY DEFINER` trigger, so it needs no INSERT policy), `taxas_reserva` rows are inserted directly by the app when staff creates an appointment. The `agendamentos` table itself has no INSERT/UPDATE policy in the tracked migrations (only a SELECT policy exists, added in `001_initial_schema.sql` and refined in `042_rls_reforco_leitura_por_role.sql`) — appointment creation evidently works via a policy configured outside the tracked migration history (e.g. via the Supabase dashboard) or a broader grant not captured here. Rather than guess at that, this plan uses the same permissive pattern already used elsewhere in this codebase for "any active member of the empresa" writes (`supabase/migrations/033_agenda_bloqueios.sql`: `for insert with check (empresa_id = any(minha_empresas()))`) for the INSERT policy on `taxas_reserva`, and restricts UPDATE (marking as paid) to gestor/owner, matching `taxas_cancelamento`'s pattern. **Flag this for the user to confirm against the live project** — if `agendamentos` INSERT is actually more restricted than "any active member," this policy should match that instead.

- [ ] **Step 1: Write the failing test**

```typescript
// web/tests/unit/taxa-reserva-migrations.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readAllMigrations(): string {
  const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
    .join('\n');
}

describe('Migration: taxa de reserva — schema', () => {
  const migrations = readAllMigrations();

  it('adiciona as colunas de configuracao em empresas', () => {
    expect(migrations).toContain('taxa_reserva_ativa');
    expect(migrations).toContain('taxa_reserva_modo');
    expect(migrations).toContain('taxa_reserva_valor');
  });

  it('cria a tabela taxas_reserva com RLS habilitado', () => {
    expect(migrations).toContain('create table public.taxas_reserva');
    expect(migrations).toMatch(/alter table public\.taxas_reserva\s+enable row level security/);
  });

  it('restringe select/update a gestor ou owner, e insert a membro da empresa', () => {
    expect(migrations).toMatch(/taxas_reserva[\s\S]{0,400}is_gestor_ou_owner/);
    expect(migrations).toMatch(/taxas_reserva[\s\S]{0,600}for insert[\s\S]{0,200}minha_empresas/);
  });

  it('impede duas taxas de reserva para o mesmo agendamento', () => {
    expect(migrations).toMatch(/create table public\.taxas_reserva[\s\S]{0,600}unique\s*\(agendamento_id\)/);
  });

  it('aceita apenas os status pendente, pago ou retida', () => {
    expect(migrations).toMatch(/taxas_reserva[\s\S]{0,400}status in \('pendente', 'pago', 'retida'\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npm run test -- taxa-reserva-migrations`
Expected: FAIL — migration file doesn't exist yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/054_taxa_reserva_schema.sql

-- ============================================================
-- TAXA DE RESERVA — configuração por empresa + tabela de cobranças
--
-- Diferente de taxas_cancelamento (gerada automaticamente por trigger),
-- taxas_reserva é inserida diretamente pelo app no momento em que um
-- agendamento é criado (o valor pode ser negociado por agendamento).
-- ============================================================

alter table public.empresas
  add column taxa_reserva_ativa boolean not null default false,
  add column taxa_reserva_modo text not null default 'percentual',
  add column taxa_reserva_valor numeric(10,2) not null default 0;

alter table public.empresas
  add constraint empresas_taxa_reserva_modo_check
  check (taxa_reserva_modo in ('percentual', 'fixo'));

create table public.taxas_reserva (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  cliente_id     uuid references public.clientes(id) on delete cascade,
  valor          numeric(10,2) not null,
  status         text not null default 'pendente',
  created_at     timestamptz not null default now(),
  paga_em        timestamptz,
  constraint taxas_reserva_status_check check (status in ('pendente', 'pago', 'retida')),
  constraint taxas_reserva_agendamento_id_key unique (agendamento_id)
);

alter table public.taxas_reserva enable row level security;

create policy "taxas_reserva: membro insere"
  on public.taxas_reserva for insert
  with check (empresa_id = any(minha_empresas()));

create policy "taxas_reserva: gestor ou owner ve"
  on public.taxas_reserva for select
  using (is_gestor_ou_owner(empresa_id));

create policy "taxas_reserva: gestor ou owner atualiza"
  on public.taxas_reserva for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npm run test -- taxa-reserva-migrations`
Expected: PASS (5 assertions)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/054_taxa_reserva_schema.sql web/tests/unit/taxa-reserva-migrations.test.ts
git commit -m "feat: adiciona schema da taxa de reserva (config + tabela)"
```

---

### Task 2: Migration — trigger `reter_taxa_reserva()`

**Files:**
- Create: `supabase/migrations/055_taxa_reserva_trigger_retencao.sql`
- Modify: `web/tests/unit/taxa-reserva-migrations.test.ts`

**Interfaces:**
- Consumes: `public.taxas_reserva` from Task 1.
- Produces: trigger `trg_reter_taxa_reserva` on `public.agendamentos`, `AFTER UPDATE`, that flips an existing `taxas_reserva` row's status to `retida` when the appointment's status transitions to `cancelado`/`faltou`. Unlike `gerar_taxa_cancelamento()`, this trigger never INSERTs — the row already exists from the novo-agendamento form (Tasks 6/11). It also never reverts `retida` back if the appointment is un-cancelled (documented product decision).

- [ ] **Step 1: Write the failing test**

```typescript
// web/tests/unit/taxa-reserva-migrations.test.ts — append inside the existing describe block
  it('cria o trigger que retem a taxa de reserva ao cancelar/faltar', () => {
    expect(migrations).toContain('function public.reter_taxa_reserva');
    expect(migrations).toContain('trg_reter_taxa_reserva');
    expect(migrations).toMatch(/after update on public\.agendamentos[\s\S]{0,200}execute function public\.reter_taxa_reserva/);
    expect(migrations).toMatch(/reter_taxa_reserva[\s\S]{0,600}status = 'retida'/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npm run test -- taxa-reserva-migrations`
Expected: FAIL on the new assertion.

- [ ] **Step 3: Write the trigger migration**

```sql
-- supabase/migrations/055_taxa_reserva_trigger_retencao.sql

-- ============================================================
-- TAXA DE RESERVA — retenção automática ao cancelar/faltar
--
-- A linha em taxas_reserva já existe (inserida pelo app na criação do
-- agendamento). Este trigger só muda o status para 'retida' quando o
-- agendamento é cancelado ou o cliente falta — não gera nem reverte.
-- ============================================================

create or replace function public.reter_taxa_reserva()
returns trigger as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if new.status not in ('cancelado', 'faltou') then
    return new;
  end if;

  update public.taxas_reserva
    set status = 'retida'
    where agendamento_id = new.id and status in ('pendente', 'pago');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_reter_taxa_reserva on public.agendamentos;

create trigger trg_reter_taxa_reserva
  after update on public.agendamentos
  for each row
  execute function public.reter_taxa_reserva();
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npm run test -- taxa-reserva-migrations`
Expected: PASS (6 assertions total)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/055_taxa_reserva_trigger_retencao.sql web/tests/unit/taxa-reserva-migrations.test.ts
git commit -m "feat: retem taxa de reserva automaticamente ao cancelar/faltar"
```

---

### Task 3: Web types

**Files:**
- Modify: `web/types/index.ts`

**Interfaces:**
- Produces: `Empresa.taxa_reserva_ativa: boolean`, `.taxa_reserva_modo: 'percentual' | 'fixo'`, `.taxa_reserva_valor: number`; new `TaxaReservaStatus = 'pendente' | 'pago' | 'retida'`; new `TaxaReserva` interface. Used by Tasks 5–8.

- [ ] **Step 1: Add the status type and extend `Empresa`**

Read the current `Empresa` interface first (it already has `taxa_cancelamento_*` fields from the sibling feature) and add, alongside the existing `TaxaCancelamentoStatus` type declaration:

```typescript
export type TaxaReservaStatus = 'pendente' | 'pago' | 'retida';
```

Extend `Empresa` with three more fields (alongside the existing `taxa_cancelamento_*` ones):

```typescript
taxa_reserva_ativa: boolean;
taxa_reserva_modo: 'percentual' | 'fixo';
taxa_reserva_valor: number;
```

- [ ] **Step 2: Add the `TaxaReserva` interface**

Right after the `TaxaCancelamento` interface, add:

```typescript
export interface TaxaReserva {
  id: string;
  empresa_id: string;
  agendamento_id: string;
  cliente_id: string | null;
  valor: number;
  status: TaxaReservaStatus;
  created_at: string;
  paga_em?: string;
  cliente?: { nome: string };
}
```

- [ ] **Step 3: Verify types compile**

Run (from `web/`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add web/types/index.ts
git commit -m "feat: adiciona tipos de taxa de reserva no web"
```

---

### Task 4: Mobile types

**Files:**
- Modify: `mobile/types/index.ts`

**Interfaces:**
- Produces: same shapes as Task 3, mirrored for mobile.

- [ ] **Step 1: Add the status type and extend `Empresa`**

```typescript
export type TaxaReservaStatus = 'pendente' | 'pago' | 'retida';
```

Extend `Empresa` (alongside existing `taxa_cancelamento_*` fields):

```typescript
taxa_reserva_ativa: boolean;
taxa_reserva_modo: 'percentual' | 'fixo';
taxa_reserva_valor: number;
```

- [ ] **Step 2: Add the `TaxaReserva` interface**

Right after `TaxaCancelamento`:

```typescript
export interface TaxaReserva {
  id: string;
  empresa_id: string;
  agendamento_id: string;
  cliente_id: string | null;
  valor: number;
  status: TaxaReservaStatus;
  created_at: string;
  paga_em?: string;
}
```

- [ ] **Step 3: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: no new errors (mobile's known ~8-error baseline is unaffected — this is a purely additive change).

- [ ] **Step 4: Commit**

```bash
git add mobile/types/index.ts
git commit -m "feat: adiciona tipos de taxa de reserva no mobile"
```

---

### Task 5: Web — Configurações section

**Files:**
- Modify: `web/app/(app)/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `Empresa` fields from Task 3.
- Produces: a "Taxa de reserva" `SectionCard`, sibling to the existing "Taxa de cancelamento" card, editable by owner or gestor (reuse the `podeEditarTaxa` flag already computed for the cancellation-fee section — do not recompute it).

- [ ] **Step 1: Add state**

Alongside the existing `taxaAtiva`/`taxaModo`/`taxaValor`/etc. state for taxa de cancelamento, add:

```typescript
const [reservaAtiva, setReservaAtiva] = useState(false);
const [reservaModo, setReservaModo] = useState<'percentual' | 'fixo'>('percentual');
const [reservaValor, setReservaValor] = useState('0');
```

- [ ] **Step 2: Populate state in the load effect**

Read the load effect that already hydrates `taxaAtiva`/`taxaModo`/`taxaValor` from the fetched `empresa` row (Task 5 of the taxa-de-cancelamento plan added this) and add, in the same place, using the same select-list-must-include-the-new-columns lesson from that earlier task (confirm the `empresas` select query includes `taxa_reserva_ativa, taxa_reserva_modo, taxa_reserva_valor` — add them if missing):

```typescript
setReservaAtiva(empresa.taxa_reserva_ativa ?? false);
setReservaModo((empresa.taxa_reserva_modo as 'percentual' | 'fixo') ?? 'percentual');
setReservaValor(String(empresa.taxa_reserva_valor ?? 0).replace('.', ','));
```

- [ ] **Step 3: Include the new fields in `salvarEmpresa()`**

Add to the same `supabase.from('empresas').update({...})` payload that already includes `taxa_cancelamento_*`:

```typescript
taxa_reserva_ativa: reservaAtiva,
taxa_reserva_modo:  reservaModo,
taxa_reserva_valor: parseFloat(reservaValor.replace(',', '.')) || 0,
```

- [ ] **Step 4: Add the SectionCard UI**

Right after the "Taxa de cancelamento" `SectionCard` closes, insert a sibling card (same visual pattern, no "aplica quando cancelado/faltou" checkboxes since this fee isn't tied to a status transition):

```tsx
{/* Taxa de reserva */}
<SectionCard title="Taxa de reserva" icon={Banknote} color="accent">
  <p className="text-xs text-text-3 -mt-2">
    Quando ativada, o formulário de novo agendamento sugere um valor de
    taxa de reserva (editável) a ser cobrado do cliente no momento da
    marcação.
  </p>
  <div className="flex items-center gap-3">
    <button type="button"
      onClick={() => podeEditarTaxa && setReservaAtiva(v => !v)}
      disabled={!podeEditarTaxa}
      className={`relative w-10 h-5 rounded-full transition flex-shrink-0 ${reservaAtiva ? 'bg-primary' : 'bg-border'} ${!podeEditarTaxa ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${reservaAtiva ? 'left-[22px]' : 'left-0.5'}`}/>
    </button>
    <span className="text-sm text-text font-semibold">Sugerir taxa de reserva ao agendar</span>
  </div>
  {reservaAtiva && (
    <>
      <div>
        <label className={labelCls}>Modo de cobrança</label>
        <div className="flex gap-2">
          <button type="button" disabled={!podeEditarTaxa}
            onClick={() => setReservaModo('percentual')}
            className={`flex-1 h-10 rounded-xl border text-sm font-semibold transition ${reservaModo === 'percentual' ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2'}`}>
            % do serviço
          </button>
          <button type="button" disabled={!podeEditarTaxa}
            onClick={() => setReservaModo('fixo')}
            className={`flex-1 h-10 rounded-xl border text-sm font-semibold transition ${reservaModo === 'fixo' ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2'}`}>
            Valor fixo (R$)
          </button>
        </div>
      </div>
      <div>
        <label className={labelCls}>{reservaModo === 'percentual' ? 'Percentual sugerido' : 'Valor sugerido'}</label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">
            {reservaModo === 'percentual' ? '%' : 'R$'}
          </span>
          <input value={reservaValor} onChange={e => setReservaValor(e.target.value)}
            inputMode="decimal" placeholder="0,00" disabled={!podeEditarTaxa}
            className={`${inputCls} pl-9`}/>
        </div>
      </div>
    </>
  )}
</SectionCard>
```

- [ ] **Step 5: Import the `Banknote` icon**

Add `Banknote` to the existing `lucide-react` import list if not already present (check first — `Banknote` may already be imported elsewhere in this file).

- [ ] **Step 6: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/configuracoes/page.tsx"
git commit -m "feat: adiciona configuracao de taxa de reserva"
```

---

### Task 6: Web — novo agendamento form: taxa de reserva field + insert

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: `Empresa.taxa_reserva_*` (fetched already for the page, or fetch fresh — see Step 1), `TaxaReserva` type from Task 3.
- Produces: a "Taxa de reserva" input in `NovoAgModal`, pre-filled when a serviço is selected, and a `taxas_reserva` insert right after a NEW agendamento is created (not on edit).

- [ ] **Step 1: Load the empresa's taxa de reserva config into `NovoAgModal`**

`NovoAgModal` (component starting at the line that reads `function NovoAgModal(...)`) needs the current `empresa.taxa_reserva_ativa/modo/valor` to compute the suggested value. Check whether this component already receives an `empresa` prop or fetches `empresas` itself; if it doesn't have this data in scope, add a small fetch in this component's mount effect:

```typescript
const [taxaReservaCfg, setTaxaReservaCfg] = useState<{ ativa: boolean; modo: 'percentual' | 'fixo'; valor: number }>({ ativa: false, modo: 'percentual', valor: 0 });

useEffect(() => {
  (async () => {
    const { data } = await supabase.from('empresas')
      .select('taxa_reserva_ativa, taxa_reserva_modo, taxa_reserva_valor')
      .eq('id', empresaId).single();
    if (data) {
      setTaxaReservaCfg({
        ativa: data.taxa_reserva_ativa,
        modo: data.taxa_reserva_modo as 'percentual' | 'fixo',
        valor: Number(data.taxa_reserva_valor),
      });
    }
  })();
}, [empresaId]);
```

(`empresaId` is already a prop/variable in scope in this modal — confirm its exact name by reading the component signature before using it.)

- [ ] **Step 2: Add taxa de reserva state and pre-fill logic**

```typescript
const [taxaReserva, setTaxaReserva] = useState('0');
const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
```

In `onServicoChange` (the function that already sets `valor` from the selected serviço's `preco`), add, without overwriting a value the user already edited manually:

```typescript
function onServicoChange(uid: string, id: string) {
  const s = servicos.find(x => x.id === id);
  setLinhas(prev => prev.map(l =>
    l.uid === uid
      ? { ...l, servico_id: id, duracao: s?.duracao_minutos ?? 60, valor: s?.preco ?? 0 }
      : l
  ));
  if (taxaReservaCfg.ativa && !taxaReservaEditada && s) {
    const sugerido = taxaReservaCfg.modo === 'fixo'
      ? taxaReservaCfg.valor
      : Math.round((s.preco * taxaReservaCfg.valor / 100) * 100) / 100;
    setTaxaReserva(String(sugerido).replace('.', ','));
  }
}
```

(Merge this into the existing `onServicoChange` function body — don't create a duplicate function. Read the current function first, since it may have grown since this brief was written.)

- [ ] **Step 3: Render the field**

In the serviço/valor rows section of the form (where the serviço `SearchSelect` and `valor` input already render), add — only when `taxaReservaCfg.ativa` — a "Taxa de reserva" input below the rows, before the observação field:

```tsx
{taxaReservaCfg.ativa && (
  <div>
    <label className={labelClass}>Taxa de reserva</label>
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

(`labelClass`/`inputClass` are the module-level style constants already used throughout this file — reuse them, don't redefine. Confirm their exact names by checking the file, since different pages in this codebase name them `labelCls`/`inputCls` vs `labelClass`/`inputClass` inconsistently.)

- [ ] **Step 4: Insert into `taxas_reserva` after a successful creation**

In `executarSalvar()`, in the non-edit (creation) branch, right after `agId = ag.id;` is set (i.e. after the `agendamentos` insert succeeds and before/alongside the `agendamento_servicos` insert), add:

```typescript
const taxaReservaValorNum = parseFloat(taxaReserva.replace(',', '.')) || 0;
if (taxaReservaValorNum > 0) {
  await supabase.from('taxas_reserva').insert({
    empresa_id: empresaId,
    agendamento_id: agId,
    cliente_id: clienteId,
    valor: taxaReservaValorNum,
    status: 'pendente',
  });
}
```

Guard this so it only runs on the creation path (the `else` branch that creates a new `agendamentos` row), not on the edit path — read the surrounding `if (agEditar) { ... } else { ... }` structure first to place this correctly inside the `else` branch, after `agId` is assigned.

- [ ] **Step 5: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Manual smoke check**

This step can't be automated without a live Supabase project; note in the task report that a live-DB check (create an agendamento with the fee active, confirm one `taxas_reserva` row appears) is deferred to the final verification task.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx"
git commit -m "feat: adiciona campo de taxa de reserva ao criar agendamento"
```

---

### Task 7: Web — Financeiro section, KPI, and bruto inclusion

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `TaxaReserva` type from Task 3.
- Produces: `taxasReserva: TaxaReserva[]` state, a "Taxas de Reserva" list section with a "marcar como paga" action, a KPI card, and `taxas_reserva` with `status='pago'` folded into `receitaVal`/`receitaAntVal` — following the EXACT same pattern already used for `taxas_cancelamento` in this file (read that code first, mirror its structure one-to-one, including the earlier-fixed `receitaAntVal` symmetry).

- [ ] **Step 1: Add state and fetch queries**

Add state alongside `taxasCancelamento`/`taxasCancelamentoPagas`:

```typescript
const [taxasReserva, setTaxasReserva] = useState<TaxaReserva[]>([]);
const [taxasReservaPagas, setTaxasReservaPagas] = useState(0);
```

Import `TaxaReserva` alongside the existing `TaxaCancelamento` import.

In the `Promise.all` block, add three queries mirroring the `taxas_cancelamento` ones exactly (list for current month, paid-this-month sum, paid-last-month sum for the delta):

```typescript
// (alongside the taxasLista/taxasPagasMes/taxasPagasAnt queries)
supabase.from('taxas_reserva')
  .select('*, cliente:clientes(nome)')
  .eq('empresa_id', empId)
  .neq('status', 'retida')
  .gte('created_at', ini).lte('created_at', fim)
  .order('status').order('created_at'),
supabase.from('taxas_reserva').select('valor')
  .eq('empresa_id', empId).eq('status', 'pago')
  .gte('paga_em', ini).lte('paga_em', fim),
supabase.from('taxas_reserva').select('valor')
  .eq('empresa_id', empId).eq('status', 'pago')
  .gte('paga_em', iniA).lte('paga_em', fimA),
```

Add the three corresponding destructured names (e.g. `reservaLista, reservaPagasMes, reservaPagasAnt`) to the `Promise.all` destructuring list — append them last, do not reorder any existing entry.

- [ ] **Step 2: Fold into `receitaVal`/`receitaAntVal` and set state**

Add a `brutoReservaCanc`-style sum (name it `brutoReserva`) into `receitaVal`, and its "anterior" counterpart into `receitaAntVal`, exactly the way `brutoTaxasCanc`/`brutoTaxasCancAnt` were already folded in:

```typescript
const brutoReserva    = ((reservaPagasMes.data ?? []) as { valor: number }[]).reduce((s, t) => s + Number(t.valor), 0);
const brutoReservaAnt = ((reservaPagasAnt.data ?? []) as { valor: number }[]).reduce((s, t) => s + Number(t.valor), 0);
```

Add `+ brutoReserva` to `receitaVal`'s existing expression, and `+ brutoReservaAnt` to `receitaAntVal`'s. After the existing `setTaxasCancelamentoPagas(...)` line, add:

```typescript
setTaxasReserva((reservaLista.data ?? []) as TaxaReserva[]);
setTaxasReservaPagas(brutoReserva);
```

- [ ] **Step 3: Add "marcar como paga"**

```typescript
async function marcarReservaPaga(taxa: TaxaReserva) {
  const { error } = await supabase.from('taxas_reserva')
    .update({ status: 'pago', paga_em: new Date().toISOString() })
    .eq('id', taxa.id);
  if (error) { alert(`Erro ao marcar taxa de reserva como paga: ${error.message}`); return; }
  await carregar(empresaId!, mesRef);
}
```

(Match whatever error-display mechanism the sibling `marcarTaxaPaga` function actually uses in the current file — it may be `alert()` per an earlier task's adaptation, or something else if that's since changed; mirror it exactly rather than introducing a second pattern.)

- [ ] **Step 4: Render the section**

Right after the "Taxas de Cancelamento" section closes, insert a sibling section (same structure, only the label/icon/data source differ), conditioned on `taxasReserva.length > 0`. Status labels: `pendente` → "Pendente", `pago` → "Paga", and this section additionally needs to render `retida` rows if any slip through (they shouldn't, since the list query excludes `retida`, but keep the status badge logic generic in case a future change surfaces them):

```tsx
{taxasReserva.length > 0 && (
  <div className="md:col-span-2 bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <p className="font-serif text-lg text-text">Taxas de Reserva</p>
      <span className="text-xs text-text-4">{taxasReserva.length} lançamento(s)</span>
    </div>
    {taxasReserva.map((t, i) => (
      <div key={t.id}
        className={`flex items-center gap-2 px-4 py-3 ${i < taxasReserva.length - 1 ? 'border-b border-border' : ''}`}>
        <div
          className={`flex items-center gap-3 flex-1 min-w-0 rounded-lg ${t.status === 'pendente' ? 'cursor-pointer hover:bg-bg transition' : ''}`}
          onClick={() => t.status === 'pendente' && marcarReservaPaga(t)}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${t.status === 'pago' ? 'bg-green-soft' : 'bg-amber-soft'}`}>
            {t.status === 'pago'
              ? <CheckCircle2 size={14} strokeWidth={2} className="text-green"/>
              : <AlertTriangle size={14} strokeWidth={2} className="text-amber"/>
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text truncate">{t.cliente?.nome ?? 'Cliente'}</p>
            <p className="text-[10px] text-text-4 mt-0.5">
              {t.status === 'pago'
                ? `Pago ${t.paga_em ? format(new Date(t.paga_em), 'dd/MM') : ''}`
                : `Gerada ${format(new Date(t.created_at), 'dd/MM')}`
              }
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-bold text-red">{fmtBRL(t.valor)}</p>
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
              t.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'
            }`}>
              {t.status === 'pago' ? 'Paga' : 'Pendente'}
            </span>
          </div>
        </div>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Add a KPI card when there's fee revenue**

Mirror the conditional `taxasCancelamentoPagas > 0` card in the KPI grid array — add a sibling entry:

```tsx
...(taxasReservaPagas > 0
  ? [{ label: 'Taxas de Reserva', value: taxasReservaPagas, d: null, cor: 'text-accent', invertDelta: false }]
  : []),
```

- [ ] **Step 6: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: exibe taxas de reserva no financeiro"
```

---

### Task 8: Web — Relatórios and Dashboard: fold paid taxas de reserva into bruto

**Files:**
- Modify: `web/app/(app)/relatorios/page.tsx`
- Modify: `web/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Produces: `bruto` on both pages now includes paid `taxas_reserva` for the period, following the exact pattern already used there for `taxas_cancelamento` (added in an earlier fix round of the sibling feature — read that code first, mirror it one-to-one for the new table).

- [ ] **Step 1: Relatórios — add a parallel query and fold into `bruto`**

In the `Promise.all` array (already includes an `rTaxas` query fetching paid `taxas_cancelamento` for the period, added by an earlier task), add a sibling `rReserva` query:

```typescript
supabase.from('taxas_reserva')
  .select('valor, paga_em')
  .eq('empresa_id', empId).eq('status', 'pago')
  .gte('paga_em', isoIni).lte('paga_em', isoFim),
```

Append `rReserva` to the destructuring list (last position, don't reorder existing entries). Store its result in a new state variable (mirror however `taxas` state was set from `rTaxas.data`), add a `brutoReserva = useMemo(() => reserva.reduce((s, t) => s + Number(t.valor), 0), [reserva])`, and fold it into `bruto = brutoServicos + brutoVendas + brutoTaxas + brutoReserva`.

- [ ] **Step 2: Dashboard — add a parallel query and fold into `bruto`**

This file already has a paginated-or-direct query for `taxas_cancelamento` paid this month (added by an earlier fix, using full ISO bounds `inicioMes`/`fimMes`, NOT `.slice(0,10)` — that was a bug fixed earlier in the sibling feature; do not reintroduce it). Add a sibling query for `taxas_reserva`:

```typescript
supabase.from('taxas_reserva').select('valor')
  .eq('empresa_id', empresaId).eq('status', 'pago')
  .gte('paga_em', inicioMes).lte('paga_em', fimMes),
```

Insert it into the existing `Promise.all` (or the outer paired-`Promise.all` structure if the taxas_cancelamento query was hoisted out into its own paginated fetch alongside the main array — read the current file structure first to see exactly how the sibling query is wired in, and mirror that, not the older un-paginated pattern). Destructure it (e.g. `taxasReservaPagasMes`) at the matching position — trace the array-to-destructuring mapping side by side before inserting, this file's `Promise.all` is long and positional. Add `const brutoReserva = (taxasReservaPagasMes.data ?? []).reduce((s, t) => s + Number(t.valor), 0);` and fold it into the existing `bruto = brutoConcluido + brutoVendas + brutoTaxas` expression as a fourth term.

- [ ] **Step 3: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Self-review**

Trace both files' `Promise.all` arrays position-by-position against their destructuring to confirm no existing query shifted position.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/relatorios/page.tsx" "web/app/(app)/dashboard/page.tsx"
git commit -m "feat: inclui taxas de reserva pagas no faturamento bruto"
```

---

### Task 9: Web — Cliente perfil history section

**Files:**
- Modify: `web/app/(app)/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: `TaxaReserva` type from Task 3.
- Produces: a "Taxas de reserva" card inside the "Histórico" tab, sibling to the existing "Taxas de cancelamento" card.

- [ ] **Step 1: Add state and type import**

```typescript
const [taxasReserva, setTaxasReserva] = useState<TaxaReserva[]>([]);
```

Add `TaxaReserva` to the existing `import type { ... } from '@/types';` line.

- [ ] **Step 2: Fetch the client's fee history**

In `carregarHistorico()`, add a fourth parallel query alongside the existing `[ags, vds, txs]` (which becomes `[ags, vds, txs, trs]`):

```typescript
buscarTodasPaginas<TaxaReserva>((from, to) =>
  supabase
    .from('taxas_reserva')
    .select('id, empresa_id, agendamento_id, cliente_id, valor, status, created_at, paga_em')
    .eq('cliente_id', id)
    .neq('status', 'retida')
    .order('created_at', { ascending: false })
    .range(from, to) as unknown as PromiseLike<{ data: TaxaReserva[] | null; error: unknown }>
),
```

Add `setTaxasReserva(trs);` alongside the existing `setTaxas(txs);`.

- [ ] **Step 3: Render the section**

Right after the "Taxas de cancelamento" card closes (still inside the `historico` tab's wrapper), insert a sibling card, conditioned on `taxasReserva.length > 0`, with status label mapping `pendente` → "Taxa pendente", `pago` → "Taxa paga" (this list already excludes `retida` via the query filter, so no third label is needed here):

```tsx
{taxasReserva.length > 0 && (
  <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <p className="font-semibold text-text text-sm">Taxas de reserva</p>
      <span className="text-xs text-text-4">{taxasReserva.length} {taxasReserva.length === 1 ? 'taxa' : 'taxas'}</span>
    </div>
    <div className="divide-y divide-border">
      {taxasReserva.map(t => {
        const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(n);
        const dataFmt = format(parseISO(t.created_at), "dd/MM/yyyy 'às' HH:mm");
        return (
          <div key={t.id} className="flex items-start gap-3 px-5 py-4 hover:bg-bg transition">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-accent-soft">
              <Banknote size={14} strokeWidth={2} className="text-accent"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text truncate">
                {t.status === 'pago' ? 'Taxa paga' : 'Taxa pendente'}
              </p>
              <p className="text-xs text-text-3 mt-0.5">{dataFmt}</p>
            </div>
            <span className="text-xs font-bold text-text-2 flex-shrink-0">{fmtBRL(t.valor)}</span>
          </div>
        );
      })}
    </div>
  </div>
)}
```

Import `Banknote` from `lucide-react` if not already present in this file's import list.

- [ ] **Step 4: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/clientes/[id]/page.tsx"
git commit -m "feat: mostra historico de taxas de reserva no perfil do cliente"
```

---

### Task 10: Mobile — Configurações section

**Files:**
- Modify: `mobile/app/(empresa)/configuracoes.tsx`

**Interfaces:**
- Consumes: `Empresa.taxa_reserva_*` from Task 4.
- Produces: a settings block sibling to the existing "Taxa de cancelamento" card, editable by owner/gestor (reuse the existing `podeEditarTaxa` flag, don't recompute it).

- [ ] **Step 1: Add state**

Alongside the existing `taxaAtiva`/`taxaModo`/`taxaValor` state (for taxa de cancelamento):

```typescript
const [reservaAtiva, setReservaAtiva] = useState(empresaAtiva?.taxa_reserva_ativa ?? false);
const [reservaModo, setReservaModo] = useState<'percentual' | 'fixo'>(
  (empresaAtiva?.taxa_reserva_modo as 'percentual' | 'fixo') ?? 'percentual'
);
const [reservaValor, setReservaValor] = useState(
  formatValorMonetarioInput(Number(empresaAtiva?.taxa_reserva_valor ?? 0))
);
```

- [ ] **Step 2: Include the fields in `salvar()`**

Add to the existing `supabase.from('empresas').update({...})` payload (alongside the `taxa_cancelamento_*` fields):

```typescript
taxa_reserva_ativa: reservaAtiva,
taxa_reserva_modo:  reservaModo,
taxa_reserva_valor: parseValorMonetario(reservaValor) ?? 0,
```

- [ ] **Step 3: Render the section**

Add a card sibling to the existing "Taxa de cancelamento" card (same container style), right after it:

```tsx
<View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18, marginBottom: 16, gap: 14 }}>
  <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 16, color: C.text }}>
    Taxa de reserva
  </Text>
  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
    Sugere um valor de taxa de reserva (editável) ao criar um novo agendamento.
  </Text>
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
    <Switch
      value={reservaAtiva}
      onValueChange={v => { if (podeEditarTaxa) setReservaAtiva(v); }}
      disabled={!podeEditarTaxa}
      trackColor={{ false: C.border, true: C.primary }}
      thumbColor="#fff"
    />
    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
      Sugerir taxa de reserva ao agendar
    </Text>
  </View>
  {reservaAtiva && (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity disabled={!podeEditarTaxa} onPress={() => setReservaModo('percentual')}
          style={{
            flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: reservaModo === 'percentual' ? C.primary : C.border,
            backgroundColor: reservaModo === 'percentual' ? C.primarySoft : 'transparent',
          }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: reservaModo === 'percentual' ? C.primary : C.text3 }}>
            % do serviço
          </Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={!podeEditarTaxa} onPress={() => setReservaModo('fixo')}
          style={{
            flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: reservaModo === 'fixo' ? C.primary : C.border,
            backgroundColor: reservaModo === 'fixo' ? C.primarySoft : 'transparent',
          }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: reservaModo === 'fixo' ? C.primary : C.text3 }}>
            Valor fixo (R$)
          </Text>
        </TouchableOpacity>
      </View>
      <Campo
        label={reservaModo === 'percentual' ? 'Percentual sugerido' : 'Valor sugerido'}
        icon={<Percent size={16} color={C.text3} />}
        value={reservaValor}
        onChange={setReservaValor}
        placeholder="0,00"
        keyboardType="decimal-pad"
      />
    </>
  )}
</View>
```

`Switch`, `Campo`, `Percent`, `podeEditarTaxa`, `C`, `formatValorMonetarioInput`/`parseValorMonetario` are all already available in this file from the taxa-de-cancelamento task — reuse them, don't reimport/redefine.

- [ ] **Step 4: Verify**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero NEW errors vs. the known baseline.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(empresa)/configuracoes.tsx"
git commit -m "feat: adiciona configuracao de taxa de reserva no mobile"
```

---

### Task 11: Mobile — novo-agendamento: taxa de reserva field + insert

**Files:**
- Modify: `mobile/app/(empresa)/novo-agendamento.tsx`

**Interfaces:**
- Consumes: `TaxaReserva` type from Task 4.
- Produces: a "Taxa de reserva" field pre-filled on serviço selection, and a `taxas_reserva` insert after a successful `agendamentos` insert.

**Important pre-existing gotcha:** this file's current `supabase.from('agendamentos').insert({...})` call has NO `.select().single()`, so the new row's `id` is never returned. This task must fix that as part of adding the taxa de reserva insert (the two changes are inseparable — the reserva insert needs the new agendamento's id).

- [ ] **Step 1: Load the empresa's taxa de reserva config**

Check whether `empresaAtiva` (from `useAuthStore()`, already used elsewhere in this file) already carries `taxa_reserva_ativa/modo/valor` (it should, per Task 4's type extension, if this screen reads from the same store object populated at login). If so, read it directly:

```typescript
const taxaReservaAtiva = empresaAtiva?.taxa_reserva_ativa ?? false;
const taxaReservaModo  = (empresaAtiva?.taxa_reserva_modo as 'percentual' | 'fixo') ?? 'percentual';
const taxaReservaCfgValor = Number(empresaAtiva?.taxa_reserva_valor ?? 0);
```

If `empresaAtiva` does NOT carry fresh config (e.g. it's cached from login and this screen needs live data), add a fetch instead, following whatever pattern this file already uses for other empresa-level lookups — read the file first to confirm which situation applies.

- [ ] **Step 2: Add taxa de reserva state and pre-fill in `selecionarServico`**

```typescript
const [taxaReserva, setTaxaReserva] = useState('');
const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
```

In `selecionarServico(s)` (which already sets `servicoSelecionado` and pre-fills `valor`), add:

```typescript
function selecionarServico(s: typeof servicos[0]) {
  setServicoSelecionado({ id: s.id, nome: s.nome, preco: s.preco, duracao_minutos: s.duracao_minutos });
  setValor(s.preco.toFixed(2));
  if (taxaReservaAtiva && !taxaReservaEditada) {
    const sugerido = taxaReservaModo === 'fixo'
      ? taxaReservaCfgValor
      : Math.round((s.preco * taxaReservaCfgValor / 100) * 100) / 100;
    setTaxaReserva(sugerido.toFixed(2));
  }
}
```

(Merge into the existing function, don't duplicate it — read the current function body first, it may have changed since this brief was written.)

- [ ] **Step 3: Render the field**

Near the existing `valor` `TextInput` and its "usar valor sugerido" convenience button, add (only when `taxaReservaAtiva`):

```tsx
{taxaReservaAtiva && (
  <View style={{ marginTop: 16 }}>
    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 6 }}>
      Taxa de reserva
    </Text>
    <TextInput
      value={taxaReserva}
      onChangeText={v => { setTaxaReserva(v); setTaxaReservaEditada(true); }}
      keyboardType="decimal-pad"
      placeholder="0,00"
      style={{
        height: 44, borderWidth: 1, borderColor: C.border, borderRadius: 12,
        paddingHorizontal: 14, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text,
      }}
    />
  </View>
)}
```

(Match this file's actual existing `TextInput` styling exactly — read the sibling `valor` input's style object first and mirror it, rather than inventing new values; the snippet above is illustrative.)

- [ ] **Step 4: Fix the missing `.select().single()` and insert the taxa de reserva row**

In `confirmar()`, change:

```typescript
const { error } = await supabase.from('agendamentos').insert({
  empresa_id:        empresaAtiva.id,
  profissional_id:   profSelecionado!.id,
  cliente_id:        clienteSelecionado!.id,
  servico_id:        servicoSelecionado!.id,
  data_hora_inicio:  inicio.toISOString(),
  data_hora_fim:     fim.toISOString(),
  valor:             valorFinal,
  observacao:        obs || null,
  status:            'agendado',
  pacote_cliente_id: pacoteClienteIdFinal,
});
```

to:

```typescript
const { data: novoAg, error } = await supabase.from('agendamentos').insert({
  empresa_id:        empresaAtiva.id,
  profissional_id:   profSelecionado!.id,
  cliente_id:        clienteSelecionado!.id,
  servico_id:        servicoSelecionado!.id,
  data_hora_inicio:  inicio.toISOString(),
  data_hora_fim:     fim.toISOString(),
  valor:             valorFinal,
  observacao:        obs || null,
  status:            'agendado',
  pacote_cliente_id: pacoteClienteIdFinal,
}).select('id').single();
```

Right after the existing `if (error) { ... return; }` check (so we only proceed with a confirmed successful insert), add:

```typescript
const taxaReservaValorNum = parseFloat(taxaReserva.replace(',', '.')) || 0;
if (taxaReservaValorNum > 0 && novoAg) {
  await supabase.from('taxas_reserva').insert({
    empresa_id: empresaAtiva.id,
    agendamento_id: novoAg.id,
    cliente_id: clienteSelecionado!.id,
    valor: taxaReservaValorNum,
    status: 'pendente',
  });
}
```

- [ ] **Step 5: Verify**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero NEW errors vs. baseline.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(empresa)/novo-agendamento.tsx"
git commit -m "feat: adiciona campo de taxa de reserva ao criar agendamento no mobile"
```

---

### Task 12: Mobile — Financeiro section and bruto inclusion

**Files:**
- Modify: `mobile/hooks/useFinanceiro.ts`
- Modify: `mobile/app/(empresa)/financeiro.tsx`

**Interfaces:**
- Consumes: `TaxaReserva` type from Task 4.
- Produces: `useFinanceiro(mesRef)`'s `resumo.receita`/`receitaAnterior` now also include paid `taxas_reserva`; a `taxasReserva` query and a "Taxas de Reserva" section, sibling to `taxasCancelamento`'s.

- [ ] **Step 1: Fold paid taxas de reserva into `resumo.receita`**

In the `resumo` query's `queryFn` (which already fetches `taxasPagasMes`/`taxasPagasAnt` for `taxas_cancelamento` and folds them into `receita`/`receitaAnterior`), add two sibling queries for `taxas_reserva`:

```typescript
supabase.from('taxas_reserva').select('valor').eq('empresa_id', empresaId!).eq('status','pago').gte('paga_em', inicio).lte('paga_em', fim),
supabase.from('taxas_reserva').select('valor').eq('empresa_id', empresaId!).eq('status','pago').gte('paga_em', inicioAnterior).lte('paga_em', fimAnterior),
```

Append them to the existing `Promise.all` in the `resumo` query, add their sums to `receita`/`receitaAnterior` alongside the existing taxas de cancelamento sums. Trace the array-to-destructuring mapping to confirm correct positioning.

- [ ] **Step 2: Add the `taxasReserva` query**

Mirror the `taxasCancelamento` query added to this hook by the sibling feature (same `queryKey` pattern, e.g. `['fin-taxas-reserva', empresaId, chave]`, same `enabled`/`staleTime`, filtering `.neq('status','retida')` for the current month), add it to the returned object and `refetch`.

- [ ] **Step 3: Add the row component and section in `financeiro.tsx`**

Add `TaxaReservaRow`, mirroring `TaxaCancelamentoRow`'s structure exactly (icon badge, cliente nome, date, valor, status pill saying "Paga"/"Toque p/ pagar"). Add `marcarReservaPaga` handler (mirrors `marcarTaxaPaga`, updates `taxas_reserva`, invalidates `['fin-taxas-reserva']`). Destructure `taxasReserva` from `useFinanceiro(mesRef)`. Render the section right after the "Taxas de Cancelamento" card, conditioned on `(taxasReserva ?? []).length > 0`.

- [ ] **Step 4: Verify**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero NEW errors vs. baseline.

- [ ] **Step 5: Self-review**

Trace the `resumo` query's `Promise.all` position-by-position after adding two new entries.

- [ ] **Step 6: Commit**

```bash
git add mobile/hooks/useFinanceiro.ts "mobile/app/(empresa)/financeiro.tsx"
git commit -m "feat: exibe taxas de reserva no financeiro mobile"
```

---

### Task 13: Mobile — Cliente perfil history section

**Files:**
- Modify: `mobile/hooks/useClientes.ts`
- Modify: `mobile/app/(empresa)/cliente/[id].tsx`

**Interfaces:**
- Consumes: `TaxaReserva` type from Task 4.
- Produces: `ClienteDetalhe.taxasReserva` array; a rendered section in the client's "Histórico" tab, sibling to `taxasCancelamento`'s.

- [ ] **Step 1: Extend `useClienteDetalhe`**

Add `TaxaReserva` to the `@/types` import. Extend `ClienteDetalhe` with `taxasReserva?: TaxaReserva[];`. In `useClienteDetalhe`'s `Promise.all` (which already has 4 entries: `userRes, agRes, anamneseRes, taxasRes`), add a 5th:

```typescript
supabase
  .from('taxas_reserva')
  .select('*')
  .eq('empresa_id', empresaId!)
  .eq('cliente_id', clienteId)
  .neq('status', 'retida')
  .order('created_at', { ascending: false }),
```

Destructure it (e.g. `reservaRes`) at the matching position (append last). Add `taxasReserva: (reservaRes.data ?? []) as TaxaReserva[],` to the returned object.

- [ ] **Step 2: Render the section**

In `cliente/[id].tsx`'s "Aba: Histórico" block, right after the "TAXAS DE CANCELAMENTO" section (added by the sibling feature) closes, add a sibling block, conditioned on `(cliente.taxasReserva ?? []).length > 0`, following the exact same row layout:

```tsx
{(cliente.taxasReserva ?? []).length > 0 && (
  <>
    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3, marginTop: 14, marginBottom: 4 }}>
      TAXAS DE RESERVA
    </Text>
    {(cliente.taxasReserva ?? []).map(t => (
      <View
        key={t.id}
        style={{
          backgroundColor: C.surface, borderWidth: 1,
          borderColor: C.border, borderRadius: 14,
          padding: 13, flexDirection: 'row',
          alignItems: 'center', gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 2 }}>
            {t.status === 'pago' ? 'Taxa paga' : 'Taxa pendente'}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
            {format(new Date(t.created_at), 'dd/MM/yyyy')}
          </Text>
        </View>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
          {formatBRL(t.valor)}
        </Text>
      </View>
    ))}
  </>
)}
```

- [ ] **Step 3: Verify**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero NEW errors vs. baseline.

- [ ] **Step 4: Commit**

```bash
git add mobile/hooks/useClientes.ts "mobile/app/(empresa)/cliente/[id].tsx"
git commit -m "feat: mostra historico de taxas de reserva no perfil do cliente mobile"
```

---

### Task 14: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full TypeScript check — web**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Full TypeScript check — mobile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero NEW errors vs. the known ~8-error pre-existing baseline.

- [ ] **Step 3: Run the full web unit test suite**

Run (from `web/`): `npm run test`
Expected: all tests pass, including the new `taxa-reserva-migrations.test.ts`.

- [ ] **Step 4: Manual QA in the browser (web)**

Requires a live Supabase project with migrations 054/055 applied (in order, after the already-applied 047-053). Walk through:
1. Configurações → activate taxa de reserva (e.g. 20% percentual) → save.
2. Agenda → create a new appointment for a serviço with a price > 0 → confirm the taxa de reserva field pre-fills, edit it, save.
3. Financeiro → confirm the "Taxas de Reserva" card shows one `pendente` row with the edited amount; click it → confirm it flips to `pago` and the KPI/bruto update; confirm Relatórios and Dashboard now show a matching bruto figure.
4. Cancel that same appointment → confirm the `taxas_reserva` row's status becomes `retida` (check via Supabase SQL editor, since `retida` rows are filtered out of the UI lists by design) and does NOT come back if the appointment is un-cancelled.
5. Clientes → that client's profile → Histórico tab → confirm the fee shows up (until it becomes `retida`, per the filter).

- [ ] **Step 5: Report status**

Summarize pass/fail for each check. Also explicitly confirm/deny the RLS INSERT-policy assumption flagged in Task 1 (whether `empresa_id = any(minha_empresas())` was the right call for `taxas_reserva`'s INSERT policy, or whether it needs tightening/loosening to match how `agendamentos` itself is actually gated on the live project).
