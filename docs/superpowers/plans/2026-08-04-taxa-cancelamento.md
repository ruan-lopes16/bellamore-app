# Taxa de Cancelamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company configure a cancellation/no-show fee (percentage or fixed amount) that is automatically registered as a pending financial charge when an appointment is cancelled or marked as a no-show, plus a "% agendamentos perdidos" metric — shipped in both the web (Next.js) and mobile (Expo) apps.

**Architecture:** A DB trigger on `agendamentos` (mirroring the existing `gerar_comissao()` trigger) computes and inserts the fee row automatically on status transition, so both apps get identical behavior for free. Web and mobile then each get: a settings section, a financeiro list + KPI, a client-profile history section, and a "% cancelamento" report metric — all reading/writing the same `taxas_cancelamento` table directly via Supabase, no new API layer.

**Tech Stack:** Next.js 15 App Router + Supabase (Postgres/RLS) for web; Expo/React Native + `@tanstack/react-query` for mobile; Vitest for unit/static tests (web only — mobile has no test runner configured, matches existing project convention).

## Global Constraints

- Migrations go in `supabase/migrations/NNN_descricao.sql`, sequential numbering; next available is `047`.
- Every new table needs RLS enabled with policies using `is_gestor_ou_owner()` or `minha_empresas()` (see `supabase/migrations/003_despesas_policies.sql`, `046_rls_vendas_gestor_owner.sql`).
- `agendamentos.cliente_id` references `public.clientes(id)` (not `users.id`) — confirmed in `supabase/migrations/001_initial_schema.sql`.
- Client Components: `createClient()` at module level (singleton). Server Components: `await createClient()` inside the function.
- Queries in `Promise.all`, never sequential waterfalls.
- `npx tsc --noEmit` (run from `web/`) must be zero-error before considering any task done.
- pt-BR for all UI copy, commit messages.

---

### Task 1: Migration — schema (`empresas` columns + `taxas_cancelamento` table + RLS)

**Files:**
- Create: `supabase/migrations/047_taxa_cancelamento_schema.sql`
- Test: `web/tests/unit/taxa-cancelamento-migrations.test.ts`

**Interfaces:**
- Produces: table `public.taxas_cancelamento(id, empresa_id, agendamento_id, cliente_id, valor, status, created_at, paga_em)` with `status in ('pendente','pago','cancelada')` and `unique(agendamento_id)`; columns `public.empresas.taxa_cancelamento_ativa|modo|valor|aplica_cancelado|aplica_faltou`. Task 2's trigger inserts into this table.

- [ ] **Step 1: Write the failing test (static content check)**

```typescript
// web/tests/unit/taxa-cancelamento-migrations.test.ts
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

describe('Migration: taxa de cancelamento — schema', () => {
  const migrations = readAllMigrations();

  it('adiciona as colunas de configuracao em empresas', () => {
    expect(migrations).toContain('taxa_cancelamento_ativa');
    expect(migrations).toContain('taxa_cancelamento_modo');
    expect(migrations).toContain('taxa_cancelamento_valor');
    expect(migrations).toContain('taxa_cancelamento_aplica_cancelado');
    expect(migrations).toContain('taxa_cancelamento_aplica_faltou');
  });

  it('cria a tabela taxas_cancelamento com RLS habilitado', () => {
    expect(migrations).toContain('create table public.taxas_cancelamento');
    expect(migrations).toMatch(/alter table public\.taxas_cancelamento\s+enable row level security/);
  });

  it('restringe select/update a gestor ou owner', () => {
    expect(migrations).toMatch(/taxas_cancelamento[\s\S]{0,400}is_gestor_ou_owner/);
  });

  it('impede duas taxas para o mesmo agendamento', () => {
    expect(migrations).toMatch(/unique\s*\(agendamento_id\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npm run test -- taxa-cancelamento-migrations`
Expected: FAIL — migration file doesn't exist yet, so `migrations` string won't contain the expected tokens.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/047_taxa_cancelamento_schema.sql

-- ============================================================
-- TAXA DE CANCELAMENTO — configuração por empresa + tabela de cobranças
-- ============================================================

alter table public.empresas
  add column taxa_cancelamento_ativa boolean not null default false,
  add column taxa_cancelamento_modo text not null default 'percentual',
  add column taxa_cancelamento_valor numeric(10,2) not null default 0,
  add column taxa_cancelamento_aplica_cancelado boolean not null default true,
  add column taxa_cancelamento_aplica_faltou boolean not null default true;

alter table public.empresas
  add constraint empresas_taxa_cancelamento_modo_check
  check (taxa_cancelamento_modo in ('percentual', 'fixo'));

create table public.taxas_cancelamento (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  valor          numeric(10,2) not null,
  status         text not null default 'pendente',
  created_at     timestamptz not null default now(),
  paga_em        timestamptz,
  constraint taxas_cancelamento_status_check check (status in ('pendente', 'pago', 'cancelada')),
  constraint taxas_cancelamento_agendamento_id_key unique (agendamento_id)
);

alter table public.taxas_cancelamento enable row level security;

create policy "taxas_cancelamento: gestor ou owner ve"
  on public.taxas_cancelamento for select
  using (is_gestor_ou_owner(empresa_id));

create policy "taxas_cancelamento: gestor ou owner atualiza"
  on public.taxas_cancelamento for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npm run test -- taxa-cancelamento-migrations`
Expected: PASS (all 4 assertions)

- [ ] **Step 5: Apply the migration to the Supabase project**

Run: `npx supabase db push` (or the project's existing migration-apply command — check `README.md` / `supabase/` for the exact workflow already used by prior migrations before running).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/047_taxa_cancelamento_schema.sql web/tests/unit/taxa-cancelamento-migrations.test.ts
git commit -m "feat: adiciona schema da taxa de cancelamento (config + tabela)"
```

---

### Task 2: Migration — trigger `gerar_taxa_cancelamento()`

**Files:**
- Create: `supabase/migrations/048_taxa_cancelamento_trigger.sql`
- Modify: `web/tests/unit/taxa-cancelamento-migrations.test.ts` (add trigger assertions)

**Interfaces:**
- Consumes: `public.taxas_cancelamento` and `public.empresas.taxa_cancelamento_*` columns from Task 1.
- Produces: trigger `trg_gerar_taxa_cancelamento` on `public.agendamentos`, `AFTER UPDATE`, that inserts a `pendente` row into `taxas_cancelamento` when status transitions into `cancelado`/`faltou` (per the empresa's config), and flips an existing `pendente` row to `cancelada` if the status is reverted away from `cancelado`/`faltou`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/tests/unit/taxa-cancelamento-migrations.test.ts — append inside the existing describe block
  it('cria o trigger que gera a taxa ao cancelar/faltar', () => {
    expect(migrations).toContain('function public.gerar_taxa_cancelamento');
    expect(migrations).toContain('trg_gerar_taxa_cancelamento');
    expect(migrations).toMatch(/after update on public\.agendamentos/);
    expect(migrations).toContain('security definer');
  });

  it('reverte a taxa pendente quando o agendamento sai de cancelado/faltou', () => {
    expect(migrations).toMatch(/status\s*=\s*'cancelada'/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npm run test -- taxa-cancelamento-migrations`
Expected: FAIL on the two new assertions (migration 048 doesn't exist yet).

- [ ] **Step 3: Write the trigger migration**

```sql
-- supabase/migrations/048_taxa_cancelamento_trigger.sql

-- ============================================================
-- TAXA DE CANCELAMENTO — trigger de geração automática
--
-- Espelha o padrão de gerar_comissao() (024_fix_comissao_security_definer.sql):
-- SECURITY DEFINER para rodar independente de RLS, disparado em
-- AFTER UPDATE OF status em agendamentos.
-- ============================================================

create or replace function public.gerar_taxa_cancelamento()
returns trigger as $$
declare
  v_empresa      public.empresas%rowtype;
  v_valor        numeric(10,2);
  v_deve_aplicar boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  -- Reverteu de cancelado/faltou para outro status: anula a taxa pendente
  if old.status in ('cancelado', 'faltou') and new.status not in ('cancelado', 'faltou') then
    update public.taxas_cancelamento
      set status = 'cancelada'
      where agendamento_id = new.id and status = 'pendente';
    return new;
  end if;

  if new.status not in ('cancelado', 'faltou') then
    return new;
  end if;

  select * into v_empresa from public.empresas where id = new.empresa_id;
  if not found or not v_empresa.taxa_cancelamento_ativa then
    return new;
  end if;

  v_deve_aplicar := (new.status = 'cancelado' and v_empresa.taxa_cancelamento_aplica_cancelado)
                  or (new.status = 'faltou'    and v_empresa.taxa_cancelamento_aplica_faltou);
  if not v_deve_aplicar then
    return new;
  end if;

  v_valor := case v_empresa.taxa_cancelamento_modo
    when 'fixo' then v_empresa.taxa_cancelamento_valor
    else round(coalesce(new.valor, 0) * v_empresa.taxa_cancelamento_valor / 100, 2)
  end;

  insert into public.taxas_cancelamento (empresa_id, agendamento_id, cliente_id, valor, status)
  values (new.empresa_id, new.id, new.cliente_id, v_valor, 'pendente')
  on conflict (agendamento_id) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_gerar_taxa_cancelamento on public.agendamentos;

create trigger trg_gerar_taxa_cancelamento
  after update on public.agendamentos
  for each row
  execute function public.gerar_taxa_cancelamento();
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npm run test -- taxa-cancelamento-migrations`
Expected: PASS (6 assertions total)

- [ ] **Step 5: Apply and manually verify against a real (dev) empresa**

Run: `npx supabase db push`, then in the Supabase SQL editor for the project:
```sql
update public.empresas set taxa_cancelamento_ativa = true, taxa_cancelamento_modo = 'percentual', taxa_cancelamento_valor = 30
where id = '<uma empresa de teste>';

update public.agendamentos set status = 'cancelado'
where id = '<um agendamento de teste com valor > 0>';

select * from public.taxas_cancelamento where agendamento_id = '<o mesmo id>';
-- esperado: 1 linha, status='pendente', valor = 30% do valor do agendamento
```
Expected: one `pendente` row with the correct computed `valor`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/048_taxa_cancelamento_trigger.sql web/tests/unit/taxa-cancelamento-migrations.test.ts
git commit -m "feat: gera taxa de cancelamento automaticamente via trigger"
```

---

### Task 3: Web types

**Files:**
- Modify: `web/types/index.ts`

**Interfaces:**
- Produces: `Empresa.taxa_cancelamento_ativa: boolean`, `.taxa_cancelamento_modo: 'percentual' | 'fixo'`, `.taxa_cancelamento_valor: number`, `.taxa_cancelamento_aplica_cancelado: boolean`, `.taxa_cancelamento_aplica_faltou: boolean`; new `TaxaCancelamentoStatus = 'pendente' | 'pago' | 'cancelada'`; new `TaxaCancelamento` interface. Used by Tasks 5–9.

- [ ] **Step 1: Add the status type and extend `Empresa`**

In `web/types/index.ts`, change line 7 area (after `export type DespesaStatus = 'pendente' | 'pago';`):

```typescript
export type DespesaStatus     = 'pendente' | 'pago';
export type TaxaCancelamentoStatus = 'pendente' | 'pago' | 'cancelada';
```

Then extend the `Empresa` interface (currently lines 23-35):

```typescript
export interface Empresa {
  id: string;
  owner_id: string;
  nome: string;
  segmento?: string;
  cnpj?: string;
  endereco?: string;
  telefone?: string;
  logo_url?: string;
  horario_funcionamento?: Record<string, { inicio: string; fim: string }>;
  ativo: boolean;
  created_at: string;
  taxa_cancelamento_ativa: boolean;
  taxa_cancelamento_modo: 'percentual' | 'fixo';
  taxa_cancelamento_valor: number;
  taxa_cancelamento_aplica_cancelado: boolean;
  taxa_cancelamento_aplica_faltou: boolean;
}
```

- [ ] **Step 2: Add the `TaxaCancelamento` interface**

Right after the `Despesa` interface (currently ends at line 159), add:

```typescript
export interface TaxaCancelamento {
  id: string;
  empresa_id: string;
  agendamento_id: string;
  cliente_id: string;
  valor: number;
  status: TaxaCancelamentoStatus;
  created_at: string;
  paga_em?: string;
  cliente?: { nome: string };
}
```

- [ ] **Step 3: Verify types compile**

Run (from `web/`): `npx tsc --noEmit`
Expected: no new errors (nothing consumes these fields yet, so this is purely additive).

- [ ] **Step 4: Commit**

```bash
git add web/types/index.ts
git commit -m "feat: adiciona tipos de taxa de cancelamento no web"
```

---

### Task 4: Mobile types

**Files:**
- Modify: `mobile/types/index.ts`

**Interfaces:**
- Produces: same shapes as Task 3, mirrored for the mobile app (`Empresa` fields, `TaxaCancelamentoStatus`, `TaxaCancelamento`).

- [ ] **Step 1: Add the status type and extend `Empresa`**

In `mobile/types/index.ts`, after line 17 (`export type DespesaStatus   = 'pendente' | 'pago';`):

```typescript
export type DespesaStatus   = 'pendente' | 'pago';
export type TaxaCancelamentoStatus = 'pendente' | 'pago' | 'cancelada';
```

Extend the `Empresa` interface (currently lines 34-45):

```typescript
export interface Empresa {
  id: string;
  owner_id: string;
  nome: string;
  cnpj?: string;
  endereco?: string;
  telefone?: string;
  logo_url?: string;
  horario_funcionamento?: Record<string, { inicio: string; fim: string }>;
  ativo: boolean;
  created_at: string;
  taxa_cancelamento_ativa: boolean;
  taxa_cancelamento_modo: 'percentual' | 'fixo';
  taxa_cancelamento_valor: number;
  taxa_cancelamento_aplica_cancelado: boolean;
  taxa_cancelamento_aplica_faltou: boolean;
}
```

- [ ] **Step 2: Add the `TaxaCancelamento` interface**

Right after the `Despesa` interface in the same file (mirrors the `status: DespesaStatus` block around line 175), add:

```typescript
export interface TaxaCancelamento {
  id: string;
  empresa_id: string;
  agendamento_id: string;
  cliente_id: string;
  valor: number;
  status: TaxaCancelamentoStatus;
  created_at: string;
  paga_em?: string;
  agendamento?: { data_hora_inicio: string; servico?: { nome: string } | null };
}
```

- [ ] **Step 3: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/types/index.ts
git commit -m "feat: adiciona tipos de taxa de cancelamento no mobile"
```

---

### Task 5: Web — Configurações section

**Files:**
- Modify: `web/app/(app)/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `Empresa` fields from Task 3.
- Produces: a "Taxa de cancelamento" `SectionCard` editable by owner or gestor; saved via the existing `salvarEmpresa()` `.update()` call.

The rest of `configuracoes/page.tsx` gates every field on `isOwner` (`empresa.owner_id === user.id`, line 184) — stricter than the RLS policy for this table (`is_gestor_ou_owner`, which also allows `role='gestor'`). Since the design requires owner **or** gestor to edit this specific setting, add a small parallel `podeEditarTaxa` flag fetched alongside the existing load, without touching the gating of any other field on the page.

- [ ] **Step 1: Add state for the new config fields and the gestor/owner flag**

Near the existing state block (around line 106-108, next to `empresaId`/`userId`/`isOwner`), add:

```typescript
const [podeEditarTaxa, setPodeEditarTaxa] = useState(false);
const [taxaAtiva, setTaxaAtiva] = useState(false);
const [taxaModo, setTaxaModo] = useState<'percentual' | 'fixo'>('percentual');
const [taxaValor, setTaxaValor] = useState('0');
const [taxaAplicaCancelado, setTaxaAplicaCancelado] = useState(true);
const [taxaAplicaFaltou, setTaxaAplicaFaltou] = useState(true);
```

- [ ] **Step 2: Populate the new state and the role flag in the load effect**

In the load `useEffect` (lines 155-223), where the `empresas` row is fetched and `isOwner` is set (around line 184), add right after `setIsOwner(...)`:

```typescript
setTaxaAtiva(empresa.taxa_cancelamento_ativa ?? false);
setTaxaModo((empresa.taxa_cancelamento_modo as 'percentual' | 'fixo') ?? 'percentual');
setTaxaValor(String(empresa.taxa_cancelamento_valor ?? 0).replace('.', ','));
setTaxaAplicaCancelado(empresa.taxa_cancelamento_aplica_cancelado ?? true);
setTaxaAplicaFaltou(empresa.taxa_cancelamento_aplica_faltou ?? true);

const { data: membro } = await supabase.from('empresa_membros').select('role')
  .eq('user_id', user.id).eq('empresa_id', empresa.id).eq('ativo', true).limit(1).maybeSingle();
setPodeEditarTaxa(empresa.owner_id === user.id || membro?.role === 'gestor');
```

(`user` and `empresa` are the variables already in scope at that point in the effect — confirm their exact names by reading the surrounding code before inserting; they hold the authenticated user and the freshly-fetched `empresas` row respectively.)

- [ ] **Step 3: Include the new fields in `salvarEmpresa()`**

In `salvarEmpresa()` (lines 313-336), change the guard and the update payload:

```typescript
async function salvarEmpresa(e: React.FormEvent) {
  e.preventDefault();
  if (!isOwner && !podeEditarTaxa) { setErro('Você não tem permissão para editar as configurações.'); return; }
  if (cnpj.trim() && !validaCNPJ(cnpj)) { setErro('CNPJ inválido. Verifique os dígitos.'); return; }
  setSalvando(true); setErro('');

  const enderecoFinal = [rua, numero, complemento, bairro, localidade].filter(Boolean).join(', ');

  const { error } = await supabase.from('empresas').update({
    nome:                  nome.trim(),
    segmento:              segmento        || 'Estúdio',
    cnpj:                  cnpj.trim()     || null,
    telefone:              telefone.trim() || null,
    endereco:              enderecoFinal   || null,
    logo_url:              logoUrl         || null,
    horario_funcionamento: horarios,
    meta_mensal:           parseFloat(metaMensal.replace(',', '.')) || 0,
    taxa_cancelamento_ativa:             taxaAtiva,
    taxa_cancelamento_modo:              taxaModo,
    taxa_cancelamento_valor:             parseFloat(taxaValor.replace(',', '.')) || 0,
    taxa_cancelamento_aplica_cancelado:  taxaAplicaCancelado,
    taxa_cancelamento_aplica_faltou:     taxaAplicaFaltou,
  }).eq('id', empresaId);

  setSalvando(false);
  if (error) { setErro(error.message); return; }
  showToast('Configurações salvas!');
  setTimeout(() => window.location.reload(), 1000);
}
```

Note: `isOwner`-only fields (nome, cnpj, horários, etc.) still submit through this same call for a gestor with `podeEditarTaxa = true` — since those inputs are `disabled={!isOwner}`, their state simply holds the values loaded from the DB unchanged, so this is safe (no accidental overwrite of owner-only fields).

- [ ] **Step 4: Add the SectionCard UI**

Right after the "Meta mensal" `SectionCard` closes (line 577, `</SectionCard>`) and before the "Horários" card, insert:

```tsx
{/* Taxa de cancelamento */}
<SectionCard title="Taxa de cancelamento" icon={Ban} color="rose">
  <p className="text-xs text-text-3 -mt-2">
    Quando ativada, uma cobrança pendente é lançada automaticamente no Financeiro
    sempre que um agendamento é cancelado ou o cliente falta.
  </p>
  <div className="flex items-center gap-3">
    <button type="button"
      onClick={() => podeEditarTaxa && setTaxaAtiva(v => !v)}
      disabled={!podeEditarTaxa}
      className={`relative w-10 h-5 rounded-full transition flex-shrink-0 ${taxaAtiva ? 'bg-primary' : 'bg-border'} ${!podeEditarTaxa ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${taxaAtiva ? 'left-[22px]' : 'left-0.5'}`}/>
    </button>
    <span className="text-sm text-text font-semibold">Cobrar taxa automaticamente</span>
  </div>
  {taxaAtiva && (
    <>
      <div>
        <label className={labelCls}>Modo de cobrança</label>
        <div className="flex gap-2">
          <button type="button" disabled={!podeEditarTaxa}
            onClick={() => setTaxaModo('percentual')}
            className={`flex-1 h-10 rounded-xl border text-sm font-semibold transition ${taxaModo === 'percentual' ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2'}`}>
            % do serviço
          </button>
          <button type="button" disabled={!podeEditarTaxa}
            onClick={() => setTaxaModo('fixo')}
            className={`flex-1 h-10 rounded-xl border text-sm font-semibold transition ${taxaModo === 'fixo' ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2'}`}>
            Valor fixo (R$)
          </button>
        </div>
      </div>
      <div>
        <label className={labelCls}>{taxaModo === 'percentual' ? 'Percentual da taxa' : 'Valor da taxa'}</label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">
            {taxaModo === 'percentual' ? '%' : 'R$'}
          </span>
          <input value={taxaValor} onChange={e => setTaxaValor(e.target.value)}
            inputMode="decimal" placeholder="0,00" disabled={!podeEditarTaxa}
            className={`${inputCls} pl-9`}/>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input type="checkbox" checked={taxaAplicaCancelado} disabled={!podeEditarTaxa}
            onChange={e => setTaxaAplicaCancelado(e.target.checked)}
            className="w-4 h-4 rounded border-border accent-primary"/>
          Aplicar quando o agendamento for cancelado
        </label>
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input type="checkbox" checked={taxaAplicaFaltou} disabled={!podeEditarTaxa}
            onChange={e => setTaxaAplicaFaltou(e.target.checked)}
            className="w-4 h-4 rounded border-border accent-primary"/>
          Aplicar quando o cliente faltar
        </label>
      </div>
    </>
  )}
</SectionCard>
```

- [ ] **Step 5: Import the `Ban` icon**

In the `lucide-react` import at the top of the file, add `Ban` to the existing destructured import list.

- [ ] **Step 6: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/configuracoes/page.tsx"
git commit -m "feat: adiciona configuracao de taxa de cancelamento"
```

---

### Task 6: Web — Financeiro section, KPI, and bruto inclusion

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `TaxaCancelamento` type from Task 3.
- Produces: `taxasCancelamento: TaxaCancelamento[]` state, a "Taxas de cancelamento" list section with a "marcar como paga" action, and a KPI card; `taxas pagas no mês` gets added into `receitaVal`.

- [ ] **Step 1: Add state and fetch the month's `taxas_cancelamento`**

Add state near line 441 (`const [despesas, setDespesas] = useState<Despesa[]>([]);`):

```typescript
const [taxasCancelamento, setTaxasCancelamento] = useState<TaxaCancelamento[]>([]);
const [taxasCancelamentoPagas, setTaxasCancelamentoPagas] = useState(0);
```

Import the type at the top: `import type { TaxaCancelamento } from '@/types';` (add near the other top-level imports, e.g. after line 53).

In the `Promise.all` block (lines 481-538), add two queries — one for the month's pending+paid list (mirrors the despesas list query at lines 513-517), one for the sum of fees paid in the month (mirrors the despesas-pagas query at lines 497-500):

```typescript
// (inside the same Promise.all array, alongside despLista)
supabase.from('taxas_cancelamento')
  .select('*, cliente:clientes(nome)')
  .eq('empresa_id', empId)
  .neq('status', 'cancelada')
  .gte('created_at', ini).lte('created_at', fim)
  .order('status').order('created_at'),
// taxas pagas no mês (para somar ao bruto)
supabase.from('taxas_cancelamento').select('valor')
  .eq('empresa_id', empId).eq('status', 'pago')
  .gte('paga_em', ini).lte('paga_em', fim),
```

Destructure the two new results from the array (append `taxasLista, taxasPagasMes` to the existing destructuring list at line 481).

- [ ] **Step 2: Fold paid fees into `receitaVal` and set the new state**

Change lines 553-555:

```typescript
type TaxaRow = { valor: number };
const brutoServicos   = ((agsMes.data ?? []) as ValRow[]).reduce((s, a) => s + Number(a.valor), 0);
const brutoVendas     = ((vendasMes.data ?? []) as VendaRow[]).reduce((s, v) => s + Number(v.valor_final), 0);
const brutoTaxasCanc  = ((taxasPagasMes.data ?? []) as TaxaRow[]).reduce((s, t) => s + Number(t.valor), 0);
const receitaVal      = brutoServicos + brutoVendas + brutoTaxasCanc;
```

After the existing `setTaxasCartao(kpisMes.taxasCartao);` line (586), add:

```typescript
setTaxasCancelamento((taxasLista.data ?? []) as TaxaCancelamento[]);
setTaxasCancelamentoPagas(brutoTaxasCanc);
```

- [ ] **Step 3: Add "marcar como paga"**

Add a handler function near `lancarRecorrentes` (used by the despesas banner) — place it in the component body:

```typescript
async function marcarTaxaPaga(taxa: TaxaCancelamento) {
  const { error } = await supabase.from('taxas_cancelamento')
    .update({ status: 'pago', paga_em: new Date().toISOString() })
    .eq('id', taxa.id);
  if (error) { showErro(`Erro ao marcar taxa como paga: ${error.message}`); return; }
  await carregar(empresaId!, mesRef);
}
```

(`showErro` and `carregar`/`empresaId`/`mesRef` are already defined/in scope in this component — reuse them, don't redefine.)

- [ ] **Step 4: Render the section**

Insert a new card right after the "Despesas" section closes (after line 1040-ish, the despesas card's closing `</div>`, inside the same `md:grid-cols-2` grid as Despesas) — only when there's at least one row, otherwise the app stays uncluttered for companies that never enabled the fee:

```tsx
{/* Taxas de cancelamento */}
{taxasCancelamento.length > 0 && (
  <div className="md:col-span-2 bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <p className="font-serif text-lg text-text">Taxas de Cancelamento</p>
      <span className="text-xs text-text-4">{taxasCancelamento.length} lançamento(s)</span>
    </div>
    {taxasCancelamento.map((t, i) => (
      <div key={t.id}
        className={`flex items-center gap-2 px-4 py-3 ${i < taxasCancelamento.length - 1 ? 'border-b border-border' : ''}`}>
        <div
          className={`flex items-center gap-3 flex-1 min-w-0 rounded-lg ${t.status === 'pendente' ? 'cursor-pointer hover:bg-bg transition' : ''}`}
          onClick={() => t.status === 'pendente' && marcarTaxaPaga(t)}>
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

In the KPI cards grid (lines 780-802, "Linha 2"), conditionally add a fourth stat when `taxasCancelamentoPagas > 0` — change the grid to `sm:grid-cols-3` normally and add a card, or simplest: append the card to the array and let it wrap. Use the array-mapped pattern already there:

```tsx
{[
  { label: 'Comissões',           value: comissoes, d: dComissoes, cor: 'text-amber',                                    invertDelta: true  },
  { label: 'Gastos Operacionais', value: gastos,    d: dGastos,   cor: 'text-rose',                                     invertDelta: true  },
  { label: 'Lucro Real',          value: lucro,     d: null,      cor: lucro >= 0 ? 'text-primary' : 'text-red',        invertDelta: false },
  ...(taxasCancelamentoPagas > 0
    ? [{ label: 'Taxas de Cancelamento', value: taxasCancelamentoPagas, d: null, cor: 'text-rose', invertDelta: false }]
    : []),
].map(({ label, value, d, cor, invertDelta }) => (
```

(Only the array literal changes; the `.map(...)` body below it stays exactly as-is.)

- [ ] **Step 6: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: exibe taxas de cancelamento no financeiro"
```

---

### Task 7: Web — Cliente perfil history section

**Files:**
- Modify: `web/app/(app)/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: `TaxaCancelamento` type from Task 3.
- Produces: a "Taxas de cancelamento" card inside the "Histórico" tab, listing that client's fee history.

- [ ] **Step 1: Add state and type import**

Add `import type { TaxaCancelamento } from '@/types';` near the top (alongside the existing `Cliente` type import at line 7).

Add state near line 264 (`const [vendas, setVendas] = useState<HistVenda[]>([]);`):

```typescript
const [taxas, setTaxas] = useState<TaxaCancelamento[]>([]);
```

- [ ] **Step 2: Fetch the client's fee history**

In `carregarHistorico()` (lines 345-373), add a third parallel query to the existing `Promise.all([ags, vds])`:

```typescript
async function carregarHistorico() {
  if (histCarregado) return;
  setLoadingHist(true);
  const [ags, vds, txs] = await Promise.all([
    buscarTodasPaginas<HistAg>((from, to) =>
      supabase
        .from('agendamentos')
        .select(`id, data_hora_inicio, data_hora_fim, status, valor, observacao,
          servico:servicos(nome),
          profissional:users!agendamentos_profissional_id_fkey(nome)`)
        .eq('cliente_id', id)
        .order('data_hora_inicio', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: HistAg[] | null; error: unknown }>
    ),
    buscarTodasPaginas<HistVenda>((from, to) =>
      supabase
        .from('vendas')
        .select(`id, created_at, valor_final, observacao,
          venda_itens(quantidade, preco_unitario, produto:produtos(nome))`)
        .eq('cliente_id', id)
        .order('created_at', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: HistVenda[] | null; error: unknown }>
    ),
    buscarTodasPaginas<TaxaCancelamento>((from, to) =>
      supabase
        .from('taxas_cancelamento')
        .select('id, empresa_id, agendamento_id, cliente_id, valor, status, created_at, paga_em')
        .eq('cliente_id', id)
        .neq('status', 'cancelada')
        .order('created_at', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: TaxaCancelamento[] | null; error: unknown }>
    ),
  ]);
  setHistorico(ags);
  setVendas(vds);
  setTaxas(txs);
  setLoadingHist(false);
  setHistCarregado(true);
}
```

- [ ] **Step 3: Render the section**

Right after the "Vendas avulsas" card closes (after line 919, `</div>`, still inside the `historico` tab's wrapper that closes at line 920), insert:

```tsx
{/* ── Taxas de cancelamento ── */}
{taxas.length > 0 && (
  <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <p className="font-semibold text-text text-sm">Taxas de cancelamento</p>
      <span className="text-xs text-text-4">{taxas.length} {taxas.length === 1 ? 'taxa' : 'taxas'}</span>
    </div>
    <div className="divide-y divide-border">
      {taxas.map(t => {
        const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(n);
        const dataFmt = format(parseISO(t.created_at), "dd/MM/yyyy 'às' HH:mm");
        return (
          <div key={t.id} className="flex items-start gap-3 px-5 py-4 hover:bg-bg transition">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-rose-soft">
              <XCircle size={14} strokeWidth={2} className="text-rose"/>
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

`XCircle` is already imported at the top of this file (line 5). Confirm the class `bg-rose-soft`/`text-rose` exist in the project's Tailwind tokens by checking how they're used elsewhere in this same file (e.g. `STATUS_CFG.cancelado`, if present) before relying on them — otherwise reuse `bg-red-soft`/`text-red`, which are already used elsewhere on this page (e.g. the exclusion-confirmation banner).

- [ ] **Step 4: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/clientes/[id]/page.tsx"
git commit -m "feat: mostra historico de taxas de cancelamento no perfil do cliente"
```

---

### Task 8: Web — Dashboard "% cancelamento" KPI

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Produces: a 5th card in the "KPIs do mês" grid showing `% de agendamentos cancelados + faltas` for the current month.

- [ ] **Step 1: Add a query for all-status appointments this month**

In the `Promise.all` array (lines 93-143), add one more query (it needs status only, keep it light):

```typescript
supabase.from('agendamentos').select('status')
  .eq('empresa_id', empresaId)
  .gte('data_hora_inicio', inicioMes).lte('data_hora_inicio', fimMes),
```

Add `agsStatusMes` to the destructured result list (append it to the array at line 94-97, e.g. right after `agsMesAnt`).

- [ ] **Step 2: Compute the percentage**

After `const totalAlertas = ...` (line 172), add:

```typescript
const agsStatusList   = agsStatusMes.data ?? [];
const totalAgsMes      = agsStatusList.length;
const perdidosMes       = agsStatusList.filter(a => a.status === 'cancelado' || a.status === 'faltou').length;
const pctCancelamento   = totalAgsMes > 0 ? (perdidosMes / totalAgsMes) * 100 : 0;
```

- [ ] **Step 3: Append the card**

In the "KPIs do mês" array (lines 300-304), add a 5th entry:

```tsx
{[
  { label: 'Fat. Bruto',    value: fmt(bruto),       color: 'var(--color-green)',   delta: pctBruto, sub: null,         icon: TrendingUp      },
  { label: 'Fat. Líquido',  value: fmt(liquido),     color: 'var(--color-primary)', delta: null,     sub: null,         icon: Wallet          },
  { label: 'Lucro do mês',  value: fmt(lucro),       color: lucro >= 0 ? 'var(--color-primary)' : 'var(--color-rose)', delta: pctLucro, sub: null, icon: Wallet },
  { label: 'Comissões',     value: fmt(totalComMes), color: 'var(--color-amber)',   delta: null,     sub: comPendenteMes > 0 ? `${fmt(comPendenteMes)} pend.` : 'Em dia', icon: BadgeDollarSign },
  { label: '% Cancelamento', value: `${pctCancelamento.toFixed(1)}%`, color: 'var(--color-rose)', delta: null, sub: perdidosMes > 0 ? `${perdidosMes} perdido(s)` : null, icon: XCircle },
].map(({ label, value, color, delta, sub, icon: Icon }, i) => (
```

(The `.map(...)` body stays unchanged.)

- [ ] **Step 4: Import `XCircle`**

Add `XCircle` to the existing `lucide-react` import at the top of the file.

- [ ] **Step 5: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/dashboard/page.tsx"
git commit -m "feat: adiciona kpi de % de cancelamento no dashboard"
```

---

### Task 9: Web — Relatórios "% cancelamento" KPI

**Files:**
- Modify: `web/app/(app)/relatorios/page.tsx`

**Interfaces:**
- Consumes: `ags`, `cancelados`, `faltaram` (already computed via `useMemo` at lines 525-527).
- Produces: a `KpiCard` in the main KPI grid showing `% = (cancelados + faltaram) / ags.length`.

- [ ] **Step 1: Add the KpiCard**

In the KPI grid (lines 912-929), add one more `<KpiCard .../>` — place it after "Taxa comparecimento" (line 923):

```tsx
<KpiCard icon={Users} label="Taxa comparecimento"  value={`${taxa.toFixed(1)}%`}       cor="#1D4ED8" loading={loading} />
<KpiCard icon={XCircle} label="Taxa de cancelamento"
  value={ags.length > 0 ? `${(((cancelados.length + faltaram.length) / ags.length) * 100).toFixed(1)}%` : '—'}
  sub={cancelados.length + faltaram.length > 0 ? `${cancelados.length + faltaram.length} perdido(s)` : undefined}
  cor="#DC2626" loading={loading} />
```

- [ ] **Step 2: Import `XCircle` if not already present**

Check the existing `lucide-react` import at the top of the file; add `XCircle` if it isn't already imported (it may already be, since the "Funil de atendimentos" section uses red tones for `Cancelados`/`Faltaram` tiles but check the actual icon imports before assuming).

- [ ] **Step 3: Verify**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/relatorios/page.tsx"
git commit -m "feat: adiciona kpi de taxa de cancelamento nos relatorios"
```

---

### Task 10: Mobile — Configurações section

**Files:**
- Modify: `mobile/app/(empresa)/configuracoes.tsx`

**Interfaces:**
- Consumes: `Empresa` fields from Task 4; `useAuthStore()` for `roleAtivo`/`isOwner` (already available globally — this page currently doesn't gate any field by role, this task introduces the first such gate, scoped only to this new section).
- Produces: a settings block equivalent to Task 5, saved through this screen's existing "save" call to `empresas`.

- [ ] **Step 1: Add state**

This screen (`export default function Configuracoes()`, from line 114) initializes its form state directly from `empresaAtiva` (from `useAuthStore()`, line 116) — there is no separate load effect/fetch. Add the new state right after the existing `horarios` state (lines 125-130):

```typescript
const { roleAtivo, isOwner: souOwner } = useAuthStore();
const podeEditarTaxa = souOwner || roleAtivo === 'gestor';

const [taxaAtiva, setTaxaAtiva] = useState(empresaAtiva?.taxa_cancelamento_ativa ?? false);
const [taxaModo, setTaxaModo] = useState<'percentual' | 'fixo'>(
  (empresaAtiva?.taxa_cancelamento_modo as 'percentual' | 'fixo') ?? 'percentual'
);
const [taxaValor, setTaxaValor] = useState(
  formatValorMonetarioInput(Number(empresaAtiva?.taxa_cancelamento_valor ?? 0))
);
const [taxaAplicaCancelado, setTaxaAplicaCancelado] = useState(empresaAtiva?.taxa_cancelamento_aplica_cancelado ?? true);
const [taxaAplicaFaltou, setTaxaAplicaFaltou] = useState(empresaAtiva?.taxa_cancelamento_aplica_faltou ?? true);
```

(Note `useAuthStore()` is already destructured once at line 116 as `const { empresaAtiva, user, signOut } = useAuthStore();` — merge `roleAtivo` and `isOwner: souOwner` into that same destructure rather than calling the hook twice.) Import `formatValorMonetarioInput` from `@shared/despesas` at the top of the file.

- [ ] **Step 2: Include the fields in `salvar()`**

In `salvar()` (lines 159-177), add the five fields to the existing `supabase.from('empresas').update({...})` call:

```typescript
async function salvar() {
  if (!empresaAtiva || !user) return;
  setSalvando(true);

  const ops: Promise<any>[] = [
    // Atualiza empresa
    supabase.from('empresas').update({
      nome:                 nomeEmpresa.trim(),
      telefone:             telefoneEmp.trim() || null,
      endereco:             endereco.trim() || null,
      cnpj:                 cnpj.trim() || null,
      horario_funcionamento: horarios,
      taxa_cancelamento_ativa:            taxaAtiva,
      taxa_cancelamento_modo:             taxaModo,
      taxa_cancelamento_valor:            parseValorMonetario(taxaValor) ?? 0,
      taxa_cancelamento_aplica_cancelado: taxaAplicaCancelado,
      taxa_cancelamento_aplica_faltou:    taxaAplicaFaltou,
    }).eq('id', empresaAtiva.id),

    // Atualiza perfil do usuário
    supabase.from('users').update({
      nome:     nomeUser.trim(),
      telefone: telefoneUser.trim() || null,
    }).eq('id', user.id),
  ];
  // ... rest of the function (novaSenha handling, Promise.all, error handling) stays unchanged
}
```

Import `parseValorMonetario` from `@shared/despesas` alongside `formatValorMonetarioInput`.

- [ ] **Step 3: Render the section**

Add a new settings block using the same visual pattern as the existing "Horários" section (`Switch` component per the `toggleDia` pattern at lines 149-150/331-338): a card with a title, a `Switch` for `taxaAtiva`, and — when active — two mode buttons, a value `TextInput`, and two toggles for `taxaAplicaCancelado`/`taxaAplicaFaltou`. Match this file's existing card container style (look at how the "Horários de funcionamento" block is wrapped — same `View` with `backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16` pattern used throughout this screen) and disable every control when `!podeEditarTaxa`:

```tsx
<View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18, marginBottom: 16, gap: 14 }}>
  <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 16, color: C.text }}>
    Taxa de cancelamento
  </Text>
  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
    Gera uma cobrança pendente no Financeiro ao cancelar um agendamento ou registrar falta.
  </Text>
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
    <Switch
      value={taxaAtiva}
      onValueChange={v => podeEditarTaxa && setTaxaAtiva(v)}
      disabled={!podeEditarTaxa}
      trackColor={{ false: C.border, true: C.primary }}
      thumbColor="#fff"
    />
    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
      Cobrar taxa automaticamente
    </Text>
  </View>
  {taxaAtiva && (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity disabled={!podeEditarTaxa} onPress={() => setTaxaModo('percentual')}
          style={{
            flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: taxaModo === 'percentual' ? C.primary : C.border,
            backgroundColor: taxaModo === 'percentual' ? C.primarySoft : 'transparent',
          }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: taxaModo === 'percentual' ? C.primary : C.text3 }}>
            % do serviço
          </Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={!podeEditarTaxa} onPress={() => setTaxaModo('fixo')}
          style={{
            flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: taxaModo === 'fixo' ? C.primary : C.border,
            backgroundColor: taxaModo === 'fixo' ? C.primarySoft : 'transparent',
          }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: taxaModo === 'fixo' ? C.primary : C.text3 }}>
            Valor fixo (R$)
          </Text>
        </TouchableOpacity>
      </View>
      <Campo
        label={taxaModo === 'percentual' ? 'Percentual da taxa' : 'Valor da taxa'}
        icon={<Percent size={16} color={C.text3} />}
        value={taxaValor}
        onChange={setTaxaValor}
        placeholder="0,00"
        keyboardType="decimal-pad"
      />
      <TouchableOpacity disabled={!podeEditarTaxa} onPress={() => setTaxaAplicaCancelado(v => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Switch value={taxaAplicaCancelado} onValueChange={v => podeEditarTaxa && setTaxaAplicaCancelado(v)}
          disabled={!podeEditarTaxa} trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text2 }}>
          Aplicar quando cancelado
        </Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={!podeEditarTaxa} onPress={() => setTaxaAplicaFaltou(v => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Switch value={taxaAplicaFaltou} onValueChange={v => podeEditarTaxa && setTaxaAplicaFaltou(v)}
          disabled={!podeEditarTaxa} trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text2 }}>
          Aplicar quando o cliente faltar
        </Text>
      </TouchableOpacity>
    </>
  )}
</View>
```

Place this block near the existing "Horários de funcionamento" section. Import `Percent` from `lucide-react-native` (add to the existing icon import list at the top of the file).

- [ ] **Step 4: Verify**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(empresa)/configuracoes.tsx"
git commit -m "feat: adiciona configuracao de taxa de cancelamento no mobile"
```

---

### Task 11: Mobile — Financeiro section

**Files:**
- Modify: `mobile/hooks/useFinanceiro.ts`
- Modify: `mobile/app/(empresa)/financeiro.tsx`

**Interfaces:**
- Consumes: `TaxaCancelamento` type from Task 4.
- Consumes/Produces: extends `useFinanceiro(mesRef)`'s return shape with `taxasCancelamento: (TaxaCancelamento & { cliente: { nome: string } | null })[]`.
- Produces: a "Taxas de cancelamento" list section mirroring `DespesaRow`, with a tap-to-mark-paid action; no modal needed (unlike despesas, the fee amount is fixed by the trigger, not user-editable).

- [ ] **Step 1: Add the query to `useFinanceiro.ts`**

This screen's data all flows through `useFinanceiro(mesRef)` (`mobile/hooks/useFinanceiro.ts`), which already computes `inicio`/`fim` ISO bounds for the month (lines 58-62) and exposes a `despesas` query (lines 154-169) as the template to follow. Import `TaxaCancelamento` from `@/types` at the top of the file, then add a new query right after the `despesas` query (after line 169, before the `evolucao` query):

```typescript
// ── Taxas de cancelamento do mês ─────────────────────────
const taxasCancelamento = useQuery<(TaxaCancelamento & { cliente: { nome: string } | null })[]>({
  queryKey: ['fin-taxas-cancelamento', empresaId, chave],
  enabled: !!empresaId,
  staleTime: 1000 * 60 * 5,
  queryFn: async () => {
    const { data } = await supabase
      .from('taxas_cancelamento')
      .select('*, cliente:clientes(nome)')
      .eq('empresa_id', empresaId!)
      .neq('status', 'cancelada')
      .gte('created_at', inicio).lte('created_at', fim)
      .order('status').order('created_at');

    return (data ?? []) as (TaxaCancelamento & { cliente: { nome: string } | null })[];
  },
});
```

Then add it to the returned object (lines 201-215):

```typescript
return {
  resumo:              resumo.data,
  metodos:             metodos.data ?? [],
  topServicos:         topServicos.data ?? [],
  despesas:            despesas.data ?? [],
  taxasCancelamento:   taxasCancelamento.data ?? [],
  evolucao:            evolucao.data ?? [],
  isLoading,
  refetch: () => {
    resumo.refetch();
    metodos.refetch();
    topServicos.refetch();
    despesas.refetch();
    taxasCancelamento.refetch();
    evolucao.refetch();
  },
  // ... rest of the returned object stays unchanged
};
```

- [ ] **Step 2: Add the row component**

Add near `DespesaRow` (after it closes, around line 271):

```tsx
function TaxaCancelamentoRow({
  item, isLast, onMarcarPago,
}: {
  item: TaxaCancelamento & { cliente: { nome: string } | null };
  isLast: boolean;
  onMarcarPago: (item: TaxaCancelamento) => void;
}) {
  const pago = item.status === 'pago';

  return (
    <TouchableOpacity
      activeOpacity={pago ? 1 : 0.7}
      onPress={() => !pago && onMarcarPago(item)}
      style={{
        paddingVertical: 11, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
      }}
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
          {item.cliente?.nome ?? 'Cliente'}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
          {pago
            ? `Pago ${item.paga_em ? format(new Date(item.paga_em), 'dd/MM') : ''}`
            : `Gerada ${format(new Date(item.created_at), 'dd/MM')}`
          }
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
            {pago ? 'Paga' : 'Toque p/ pagar'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
```

- [ ] **Step 3: Destructure the new field, add the mark-as-paid handler, and render the section**

At line 767, add `taxasCancelamento` to the existing destructure:

```typescript
const { resumo, metodos, topServicos, despesas, taxasCancelamento, evolucao, isLoading, refetch } = useFinanceiro(mesRef);
```

Then add the handler (`qc` is the `useQueryClient()` instance already assigned at line 766 — reuse it, and invalidate the exact query key added to `useFinanceiro.ts` in Step 1):

```typescript
async function marcarTaxaPaga(item: TaxaCancelamento) {
  const { error } = await supabase
    .from('taxas_cancelamento')
    .update({ status: 'pago', paga_em: new Date().toISOString() })
    .eq('id', item.id);
  if (error) { Alert.alert('Erro', error.message); return; }
  qc.invalidateQueries({ queryKey: ['fin-taxas-cancelamento'] });
}
```

Render a card, following the same section-header + list pattern used for despesas in this file, conditioned on `(taxasCancelamento ?? []).length > 0`:

```tsx
{(taxasCancelamento ?? []).length > 0 && (
  <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, marginBottom: 16, overflow: 'hidden' }}>
    <View style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 15, color: C.text }}>
        Taxas de Cancelamento
      </Text>
    </View>
    {(taxasCancelamento ?? []).map((item, i, arr) => (
      <TaxaCancelamentoRow
        key={item.id}
        item={item}
        isLast={i === arr.length - 1}
        onMarcarPago={marcarTaxaPaga}
      />
    ))}
  </View>
)}
```

Place it near where the despesas card renders (right after it, in the same scroll body).

- [ ] **Step 4: Verify**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(empresa)/financeiro.tsx"
git commit -m "feat: exibe taxas de cancelamento no financeiro mobile"
```

---

### Task 12: Mobile — Cliente perfil history section

**Files:**
- Modify: `mobile/hooks/useClientes.ts`
- Modify: `mobile/app/(empresa)/cliente/[id].tsx`

**Interfaces:**
- Consumes: `TaxaCancelamento` type from Task 4.
- Produces: `ClienteDetalhe.taxasCancelamento` array; a rendered section in the client's "Histórico" tab.

- [ ] **Step 1: Extend `useClienteDetalhe`**

In `mobile/hooks/useClientes.ts`, add `TaxaCancelamento` to the type imports (line 5), extend `ClienteDetalhe` (currently lines 20-28):

```typescript
export interface ClienteDetalhe extends ClienteResumo {
  email?: string;
  endereco?: string;
  anamnese?: AnamneseFicha;
  historico?: (Agendamento & {
    servico: { nome: string };
    profissional: { nome: string };
  })[];
  taxasCancelamento?: TaxaCancelamento[];
}
```

In `useClienteDetalhe` (lines 202-248), add a fourth parallel query:

```typescript
const [userRes, agRes, anamneseRes, taxasRes] = await Promise.all([
  supabase.from('users').select('*').eq('id', clienteId).single(),
  supabase
    .from('agendamentos')
    .select(`*, servico:servicos(nome), profissional:users!agendamentos_profissional_id_fkey(nome)`)
    .eq('empresa_id', empresaId!)
    .eq('cliente_id', clienteId)
    .neq('status', 'cancelado')
    .order('data_hora_inicio', { ascending: false })
    .limit(20),
  supabase
    .from('anamnese_fichas')
    .select('*')
    .eq('empresa_id', empresaId!)
    .eq('cliente_id', clienteId)
    .single(),
  supabase
    .from('taxas_cancelamento')
    .select('*')
    .eq('empresa_id', empresaId!)
    .eq('cliente_id', clienteId)
    .neq('status', 'cancelada')
    .order('created_at', { ascending: false }),
]);
```

Add `taxasCancelamento: (taxasRes.data ?? []) as TaxaCancelamento[],` to the returned object (alongside `historico: agendamentos,` at line 243).

- [ ] **Step 2: Render the section**

In `mobile/app/(empresa)/cliente/[id].tsx`, inside the "Aba: Histórico" block (lines 499-562), right after the appointments list's closing `</View>` (line 560) but still inside the outer `<View style={{ paddingHorizontal: 24, gap: 6 }}>` (opened at line 502), add:

```tsx
{(cliente.taxasCancelamento ?? []).length > 0 && (
  <>
    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3, marginTop: 14, marginBottom: 4 }}>
      TAXAS DE CANCELAMENTO
    </Text>
    {(cliente.taxasCancelamento ?? []).map(t => (
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
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/hooks/useClientes.ts "mobile/app/(empresa)/cliente/[id].tsx"
git commit -m "feat: mostra historico de taxas de cancelamento no perfil do cliente mobile"
```

---

### Task 13: Mobile — Relatórios "% cancelamento" KPI

**Scope note:** the design calls for the metric on "Dashboard e Relatórios." Web gets both (Tasks 8 and 9). On mobile, `mobile/app/(empresa)/dashboard.tsx` has no existing stat-card infrastructure (unlike `relatorios.tsx`, which already has a `KpiCard` component and a resumo hook) — building one just for this single metric would be a disproportionate addition. Mobile users reach the same number one tab away, in Relatórios. This task covers mobile Relatórios only; mobile Dashboard is intentionally out of scope for this feature.

**Files:**
- Modify: `mobile/hooks/useRelatorios.ts`
- Modify: `mobile/app/(empresa)/relatorios.tsx`

**Interfaces:**
- Consumes: `ResumoRelatorio` shape from `useRelatorios.ts`.
- Produces: `ResumoRelatorio.pctCancelamento` and `.perdidos`; a `KpiCard` rendering it.

- [ ] **Step 1: Extend `ResumoRelatorio` and the query**

In `mobile/hooks/useRelatorios.ts`, extend the interface (lines 16-23):

```typescript
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
```

In the `resumo` query's `queryFn` (lines 143-184), add a fifth parallel fetch alongside `agAtual`:

```typescript
const [pagAtual, pagAnt, agAtual, agAnt, agStatusAtual] = await Promise.all([
  buscarTodasPaginas<{ valor: number }>((from, to) =>
    supabase.from('pagamentos').select('valor')
      .eq('empresa_id', empresaId!).eq('status', 'pago')
      .gte('created_at', iniISO).lte('created_at', fimISO)
      .range(from, to)
  ),
  buscarTodasPaginas<{ valor: number }>((from, to) =>
    supabase.from('pagamentos').select('valor')
      .eq('empresa_id', empresaId!).eq('status', 'pago')
      .gte('created_at', iniAntISO).lte('created_at', fimAntISO)
      .range(from, to)
  ),
  buscarTodasPaginas<{ id: string }>((from, to) =>
    supabase.from('agendamentos').select('id')
      .eq('empresa_id', empresaId!).eq('status', 'concluido')
      .gte('data_hora_inicio', iniISO).lte('data_hora_inicio', fimISO)
      .range(from, to)
  ),
  buscarTodasPaginas<{ id: string }>((from, to) =>
    supabase.from('agendamentos').select('id')
      .eq('empresa_id', empresaId!).eq('status', 'concluido')
      .gte('data_hora_inicio', iniAntISO).lte('data_hora_inicio', fimAntISO)
      .range(from, to)
  ),
  buscarTodasPaginas<{ status: string }>((from, to) =>
    supabase.from('agendamentos').select('status')
      .eq('empresa_id', empresaId!)
      .gte('data_hora_inicio', iniISO).lte('data_hora_inicio', fimISO)
      .range(from, to)
  ),
]);

const fat    = pagAtual.reduce((s, p) => s + Number(p.valor), 0);
const fatAnt = pagAnt.reduce((s, p) => s + Number(p.valor), 0);
const atend    = agAtual.length;
const atendAnt = agAnt.length;
const totalAgendamentos = agStatusAtual.length;
const perdidos = agStatusAtual.filter(a => a.status === 'cancelado' || a.status === 'faltou').length;

return {
  faturamento:        fat,
  faturamentoAnterior: fatAnt,
  atendimentos:        atend,
  atendimentosAnterior: atendAnt,
  ticketMedio:        atend  > 0 ? fat    / atend    : 0,
  ticketMedioAnterior: atendAnt > 0 ? fatAnt / atendAnt : 0,
  totalAgendamentos,
  perdidos,
  pctCancelamento: totalAgendamentos > 0 ? (perdidos / totalAgendamentos) * 100 : 0,
};
```

- [ ] **Step 2: Render the KPI card**

In `mobile/app/(empresa)/relatorios.tsx`, add a third row to the KPI section (after the "Novos clientes / Taxa retorno" row, lines 472-488):

```tsx
<View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
  <KpiCard
    icon={<View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: C.roseSoft, alignItems: 'center', justifyContent: 'center' }}><XCircle size={13} color={C.rose} strokeWidth={1.8} /></View>}
    label="Taxa cancelamento"
    valor={resumo ? `${resumo.pctCancelamento.toFixed(1)}%` : '—'}
    deltaVal={null}
  />
</View>
```

Import `XCircle` from `lucide-react-native` if not already imported (check the existing icon import block at the top of the file first).

- [ ] **Step 3: Verify**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/hooks/useRelatorios.ts "mobile/app/(empresa)/relatorios.tsx"
git commit -m "feat: adiciona kpi de taxa de cancelamento nos relatorios mobile"
```

---

### Task 14: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full TypeScript check — web**

Run (from `web/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Full TypeScript check — mobile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Run the full web unit test suite**

Run (from `web/`): `npm run test`
Expected: all tests pass, including the new `taxa-cancelamento-migrations.test.ts`.

- [ ] **Step 4: Manual QA in the browser (web)**

Start the web dev server via the project's preview tooling, then walk through:
1. Configurações → activate the fee (e.g. 30% percentual, both checkboxes on) → save.
2. Agenda → cancel a test appointment with `valor > 0`.
3. Financeiro → confirm the "Taxas de Cancelamento" card shows one `pendente` row with the correct amount; click it → confirm it flips to `pago` and the KPI/bruto update.
4. Clientes → that client's profile → Histórico tab → confirm the fee shows up.
5. Relatórios → confirm "Taxa de cancelamento" KPI reflects the cancellation.
6. Dashboard → confirm "% Cancelamento" card shows a non-zero value for the month.

Take a screenshot of the Financeiro page showing the new section as evidence.

- [ ] **Step 5: Report status**

Summarize pass/fail for each of the above checks before considering the feature complete. Any failure means a task above needs a fix-and-recommit cycle, not a silent skip.
