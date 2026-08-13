# Despesas recorrentes: quantidade de parcelas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff define when a recurring monthly expense ends by entering a total installment count (and, for a contract already in progress, which installment is being registered now) instead of always typing an end date — the system computes `recorrencia_ate` automatically, and the monthly auto-launch increments a running "parcela X de Y" counter.

**Architecture:** A pure function `calcularRecorrenciaAtePorParcelas` (mirroring `shared/despesas.ts`'s existing pure-helper pattern) computes the existing `recorrencia_ate` column's value from a due date, a total installment count, and the current installment number — no new end-date storage mechanism, no change to the already-tested `recorrenciaAindaAtiva`/`templatesRecorrentesParaLancar` auto-launch-stop logic. Two new nullable columns (`parcela_atual`, `total_parcelas`) carry the running counter, purely for display and for the auto-launch step to increment. The UI adds a mode toggle ("Por data" / "Por quantidade de parcelas") to the existing "Repetir até" field in all four despesa forms — additive only, nothing existing removed.

**Tech Stack:** Next.js 15 App Router + Supabase (Postgres/RLS) for web; Expo/React Native for mobile; Vitest for unit tests and migration static-content tests.

## Global Constraints

- Migrations go in `supabase/migrations/NNN_descricao.sql`, sequential; next available is `059` (058 is the current max).
- No RLS changes needed — `parcela_atual`/`total_parcelas` are plain columns on `despesas`, already covered by the existing `despesas: gestor pode atualizar` policy (migration 003) that restricts ALL despesa inserts/updates to gestor/owner.
- The "por quantidade de parcelas" mode is only offered when periodicidade = mensal — no other periodicidade has auto-launch, so a parcela counter would never advance for them.
- Unlike the taxa-de-reserva "Já foi cobrada?" toggle (create-only), these new fields must be editable both on creation AND on editing an existing despesa — no create-only restriction.
- pt-BR for all UI copy, commit messages, and code comments (existing project convention).
- Web and mobile ship together — every user-facing change in this plan has a task on both platforms.
- Run `npx tsc --noEmit` from `web/` and from `mobile/` after touching files in each, respectively.
- `mobile/` has ~10 pre-existing TypeScript errors in files this plan never touches (`comissoes.tsx`, `configuracoes.tsx`, `estoque.tsx`, `novo-cliente.tsx`, `relatorios.tsx`, `useAgenda.ts`, `useNotificacoes.ts`) — confirmed against the base branch in a prior session. Do not treat these as caused by this plan; only flag genuinely new errors.

---

### Task 1: Migration — `despesas.parcela_atual` + `despesas.total_parcelas`

**Files:**
- Create: `supabase/migrations/059_despesas_parcelas.sql`
- Create: `web/tests/unit/despesas-parcelas-migration.test.ts`
- Modify: `web/types/index.ts` (`Despesa` interface)
- Modify: `mobile/types/index.ts` (`Despesa` interface)
- Modify: `mobile/hooks/useFinanceiro.ts:34-46` (`DespesaItem` interface)

**Interfaces:**
- Produces: columns `public.despesas.parcela_atual` (`integer`, nullable) and `public.despesas.total_parcelas` (`integer`, nullable) — consumed by Task 2 (helper doesn't touch the DB, but Tasks 3-6 read/write these columns).

- [ ] **Step 1: Write the failing migration-content test**

```ts
// web/tests/unit/despesas-parcelas-migration.test.ts
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

describe('Migration: despesas.parcela_atual / despesas.total_parcelas', () => {
  const migrations = readAllMigrations();

  it('adiciona as colunas parcela_atual e total_parcelas na tabela despesas', () => {
    expect(migrations).toMatch(/alter table public\.despesas\s+add column parcela_atual integer,\s+add column total_parcelas integer/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npm run test -- despesas-parcelas-migration`
Expected: FAIL — `supabase/migrations/059_despesas_parcelas.sql` doesn't exist yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/059_despesas_parcelas.sql
-- ============================================================
-- DESPESAS — quantidade de parcelas para recorrencia mensal
--
-- Alternativa a digitar `recorrencia_ate` diretamente: informando o
-- total de parcelas (e, se o contrato ja estava em andamento, em qual
-- parcela o cadastro comeca), o app calcula `recorrencia_ate` sozinho
-- e guarda aqui o progresso, incrementado em +1 a cada auto-lancamento
-- mensal, so para exibicao ("Parcela 6 de 12"). `recorrencia_ate`
-- continua sendo o unico campo que decide quando o auto-lancamento
-- para (logica inalterada).
-- ============================================================

alter table public.despesas
  add column parcela_atual integer,
  add column total_parcelas integer;
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npm run test -- despesas-parcelas-migration`
Expected: PASS

- [ ] **Step 5: Add the fields to `web/types/index.ts`**

Read the current `Despesa` interface in this file first (search for `interface Despesa`) — it already has `recorrencia_ate?: string;` from a prior feature. Add these two lines right after it, inside the same interface:

```ts
  parcela_atual?: number;
  total_parcelas?: number;
```

- [ ] **Step 6: Add the fields to `mobile/types/index.ts`**

Same as Step 5, in this file's `Despesa` interface (search for `interface Despesa`) — add right after the existing `recorrencia_ate?: string;` line:

```ts
  parcela_atual?: number;
  total_parcelas?: number;
```

- [ ] **Step 7: Add the fields to `mobile/hooks/useFinanceiro.ts`**

Current (lines 34-46):
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
  parcela_atual?: number;
  total_parcelas?: number;
  data_pagamento?: string;
  created_at?: string;
  status: 'pendente' | 'pago';
}
```

- [ ] **Step 8: Verify types compile**

Run (from `web/`): `npx tsc --noEmit` — expect no errors.
Run (from `mobile/`): `npx tsc --noEmit` — expect only the ~10 known pre-existing errors, nothing new.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/059_despesas_parcelas.sql web/tests/unit/despesas-parcelas-migration.test.ts web/types/index.ts mobile/types/index.ts mobile/hooks/useFinanceiro.ts
git commit -m "feat: adiciona colunas parcela_atual e total_parcelas em despesas"
```

---

### Task 2: Shared helper — `calcularRecorrenciaAtePorParcelas`

**Files:**
- Modify: `shared/despesas.ts`
- Modify: `web/tests/unit/despesas.test.ts`

**Interfaces:**
- Produces: `calcularRecorrenciaAtePorParcelas(dataVencimento: string, totalParcelas: number, parcelaAtual: number): string` — consumed by Task 3 (web modals) and Task 5/6 (mobile modals).

- [ ] **Step 1: Write the failing tests**

Add to the import at the top of `web/tests/unit/despesas.test.ts` (extends the existing import from `@shared/despesas`):

```ts
import {
  buildDespesaPagamentoUpdate,
  calcularRecorrenciaAtePorParcelas,
  diasParaVencimento,
  formatValorMonetarioInput,
  parseValorMonetario,
  progressoVencimento,
  recorrenciaAindaAtiva,
  templatesRecorrentesParaLancar,
} from '@shared/despesas';
```

Add inside the existing `describe('despesas helpers', ...)` block:

```ts
  describe('calcularRecorrenciaAtePorParcelas', () => {
    it('contrato novo: parcela 1 de 12, conta 11 meses a partir do vencimento', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-08-13', 12, 1)).toBe('2027-07-13');
    });

    it('contrato ja em andamento: parcela 5 de 12, conta 7 meses a partir do vencimento (exemplo do pedido original)', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-08-13', 12, 5)).toBe('2027-03-13');
    });

    it('ultima parcela: parcela atual igual ao total, recorrencia_ate e o proprio vencimento', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-08-13', 12, 12)).toBe('2026-08-13');
    });

    it('faz o clamp do dia quando o mes calculado tem menos dias (31 de janeiro + 1 mes cai em fevereiro)', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-01-31', 2, 1)).toBe('2026-02-28');
    });

    it('atravessa a virada de ano corretamente', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-11-10', 6, 4)).toBe('2027-01-10');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `web/`): `npm run test -- despesas`
Expected: FAIL — `calcularRecorrenciaAtePorParcelas` doesn't exist in `shared/despesas.ts` yet (import error).

- [ ] **Step 3: Implement the helper**

Add to `shared/despesas.ts`, after `progressoVencimento` (at the end of the file):

```ts
/**
 * Calcula a data de vencimento da ultima parcela a partir da data de
 * vencimento da parcela sendo cadastrada agora, do total de parcelas do
 * contrato e de qual parcela essa e (1 = primeira). Usado para preencher
 * `recorrencia_ate` automaticamente quando o usuario escolhe informar
 * quantidade de parcelas em vez de digitar uma data.
 */
export function calcularRecorrenciaAtePorParcelas(
  dataVencimento: string,
  totalParcelas: number,
  parcelaAtual: number,
): string {
  const mesesRestantes = totalParcelas - parcelaAtual;
  const [ano, mes, dia] = dataVencimento.split('-').map(Number);
  const anoAlvo = ano + Math.floor((mes - 1 + mesesRestantes) / 12);
  const mesAlvo = (mes - 1 + mesesRestantes) % 12;
  const ultimoDia = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  const diaAlvo = Math.min(dia, ultimoDia);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${anoAlvo}-${pad(mesAlvo + 1)}-${pad(diaAlvo)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `web/`): `npm run test -- despesas`
Expected: PASS (all tests in `despesas.test.ts`, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add shared/despesas.ts web/tests/unit/despesas.test.ts
git commit -m "feat: adiciona calculo de recorrencia_ate a partir de quantidade de parcelas"
```

---

### Task 3: Web UI — Nova/Editar despesa modals

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `calcularRecorrenciaAtePorParcelas` from `@shared/despesas` (Task 2).
- Produces: `despesas.parcela_atual`/`despesas.total_parcelas` populated on insert/update from these two modals — Task 4 (auto-launch) reads `RecorrenteTemplate.parcela_atual`/`total_parcelas` back via the same local type.

- [ ] **Step 1: Import the helper**

Current (line 51):
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento, templatesRecorrentesParaLancar } from '@shared/despesas';
```

New:
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento, templatesRecorrentesParaLancar, calcularRecorrenciaAtePorParcelas } from '@shared/despesas';
```

- [ ] **Step 2: Update local types**

Current (lines 64-73):
```tsx
type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string; recorrencia_ate?: string;
  created_at?: string;
  status: 'pendente' | 'pago';
};
type TopServico = { nome: string; quantidade: number; receita: number; percentual: number };
type MetodoPag  = { metodo: string; valor: number; quantidade: number; percentual: number };
type RecorrenteTemplate = { descricao: string; categoria?: string; valor: number; periodicidade?: string; data_vencimento?: string; recorrencia_ate?: string };
```

New:
```tsx
type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string; recorrencia_ate?: string;
  parcela_atual?: number; total_parcelas?: number;
  created_at?: string;
  status: 'pendente' | 'pago';
};
type TopServico = { nome: string; quantidade: number; receita: number; percentual: number };
type MetodoPag  = { metodo: string; valor: number; quantidade: number; percentual: number };
type RecorrenteTemplate = { descricao: string; categoria?: string; valor: number; periodicidade?: string; data_vencimento?: string; recorrencia_ate?: string; parcela_atual?: number; total_parcelas?: number };
```

- [ ] **Step 3: `NovaDespesaModal` — add state**

Current (lines 118-119):
```tsx
  const [vencimento,    setVencimento]    = useState('');
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
```

New:
```tsx
  const [vencimento,    setVencimento]    = useState('');
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
  const [modoRepeticao, setModoRepeticao] = useState<'data' | 'parcelas'>('data');
  const [quantidadeParcelas, setQuantidadeParcelas] = useState('');
  const [contratoEmAndamento, setContratoEmAndamento] = useState(false);
  const [parcelaAtualInput, setParcelaAtualInput] = useState('');
```

- [ ] **Step 4: `NovaDespesaModal` — compute and include in insert payload**

Current (lines 123-139):
```tsx
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const valorN = parseFloat(valor.replace(',', '.'));
    if (isNaN(valorN) || valorN <= 0) {
      setErro('Informe um valor maior que zero.'); setSalvando(false); return;
    }
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
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }
```

New:
```tsx
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const valorN = parseFloat(valor.replace(',', '.'));
    if (isNaN(valorN) || valorN <= 0) {
      setErro('Informe um valor maior que zero.'); setSalvando(false); return;
    }
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNum  = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const usaParcelas = modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimento;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimento, totalParcelasNum, parcelaAtualNum)
      : recorrenciaAte;
    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaId,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAteFinal || null) : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      status:          'pendente',
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }
```

- [ ] **Step 5: `EditarDespesaModal` — add state initialized from `despesa`**

Current (lines 304-305):
```tsx
  const [vencimento,    setVencimento]    = useState(despesa.data_vencimento ?? '');
  const [recorrenciaAte, setRecorrenciaAte] = useState(despesa.recorrencia_ate ?? '');
```

New:
```tsx
  const [vencimento,    setVencimento]    = useState(despesa.data_vencimento ?? '');
  const [recorrenciaAte, setRecorrenciaAte] = useState(despesa.recorrencia_ate ?? '');
  const [modoRepeticao, setModoRepeticao] = useState<'data' | 'parcelas'>(despesa.total_parcelas ? 'parcelas' : 'data');
  const [quantidadeParcelas, setQuantidadeParcelas] = useState(despesa.total_parcelas ? String(despesa.total_parcelas) : '');
  const [contratoEmAndamento, setContratoEmAndamento] = useState((despesa.parcela_atual ?? 1) > 1);
  const [parcelaAtualInput, setParcelaAtualInput] = useState(despesa.parcela_atual ? String(despesa.parcela_atual) : '');
```

- [ ] **Step 6: `EditarDespesaModal` — compute and include in update payload**

Current (lines 311-325):
```tsx
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const valorN = parseFloat(valor.replace(',', '.'));
    if (isNaN(valorN) || valorN <= 0) {
      setErro('Informe um valor maior que zero.'); setSalvando(false); return;
    }
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAte || null) : null,
    }).eq('id', despesa.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }
```

New:
```tsx
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const valorN = parseFloat(valor.replace(',', '.'));
    if (isNaN(valorN) || valorN <= 0) {
      setErro('Informe um valor maior que zero.'); setSalvando(false); return;
    }
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNum  = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const usaParcelas = modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimento;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimento, totalParcelasNum, parcelaAtualNum)
      : recorrenciaAte;
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAteFinal || null) : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
    }).eq('id', despesa.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }
```

- [ ] **Step 7: Add the mode toggle and quantity fields to both modals' form**

`NovaDespesaModal` and `EditarDespesaModal` render the exact same "Repetir até" block (byte-for-byte identical — same situation encountered in a prior plan for this file). Apply this edit with **replace all occurrences** so both modals get the field in one pass — the replacement text is identical in both places.

Current (appears twice, inside each modal's `recorrente &&` block, right after the periodicidade chips):
```tsx
                <div className="w-full mt-1">
                  <label className={labelClass}>Repetir até (opcional)</label>
                  <input value={recorrenciaAte} onChange={e => setRecorrenciaAte(e.target.value)}
                    type="date" className={inputClass}/>
                </div>
```

New (both occurrences):
```tsx
                <div className="w-full mt-1">
                  <label className={labelClass}>Repetir até (opcional)</label>
                  {periodicidade === 'mensal' && (
                    <div className="flex gap-2 mb-2">
                      <button type="button" onClick={() => setModoRepeticao('data')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          modoRepeticao === 'data' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                        }`}>Por data</button>
                      <button type="button" onClick={() => setModoRepeticao('parcelas')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          modoRepeticao === 'parcelas' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                        }`}>Por quantidade de parcelas</button>
                    </div>
                  )}
                  {periodicidade === 'mensal' && modoRepeticao === 'parcelas' ? (
                    <div className="flex flex-col gap-2">
                      <input value={quantidadeParcelas} onChange={e => setQuantidadeParcelas(e.target.value)}
                        inputMode="numeric" placeholder="Quantidade de parcelas" className={inputClass}/>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setContratoEmAndamento(false)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            !contratoEmAndamento ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Novo</button>
                        <button type="button" onClick={() => setContratoEmAndamento(true)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            contratoEmAndamento ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Já em andamento</button>
                      </div>
                      {contratoEmAndamento && (
                        <input value={parcelaAtualInput} onChange={e => setParcelaAtualInput(e.target.value)}
                          inputMode="numeric" placeholder="Parcela atual" className={inputClass}/>
                      )}
                    </div>
                  ) : (
                    <input value={recorrenciaAte} onChange={e => setRecorrenciaAte(e.target.value)}
                      type="date" className={inputClass}/>
                  )}
                </div>
```

- [ ] **Step 8: Verify types compile**

Run (from `web/`): `npx tsc --noEmit` — expect no errors.

- [ ] **Step 9: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: adiciona quantidade de parcelas aos modais de despesa (web)"
```

---

### Task 4: Web — auto-lançamento carrega parcelas + rótulo na listagem

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `RecorrenteTemplate.parcela_atual`/`total_parcelas` (Task 3).
- Produces: newly auto-launched despesas carry `total_parcelas` forward and `parcela_atual` incremented by 1; despesa rows with `total_parcelas` set show "Parcela X de Y".

- [ ] **Step 1: Select the new columns in the template-history query**

Current (lines 551-556):
```tsx
      // Histórico de despesas mensais recorrentes (para auto-lançamento robusto)
      supabase.from('despesas')
        .select('descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate')
        .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
        .lt('data_vencimento', periodo.startDate)   // somente meses passados
        .order('data_vencimento', { ascending: false }),
```

New:
```tsx
      // Histórico de despesas mensais recorrentes (para auto-lançamento robusto)
      supabase.from('despesas')
        .select('descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate, parcela_atual, total_parcelas')
        .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
        .lt('data_vencimento', periodo.startDate)   // somente meses passados
        .order('data_vencimento', { ascending: false }),
```

- [ ] **Step 2: Carry `total_parcelas` forward and increment `parcela_atual` on auto-launch**

Current (lines 733-753):
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
        total_parcelas:  r.total_parcelas ?? null,
        parcela_atual:   r.total_parcelas != null && r.parcela_atual != null
          ? r.parcela_atual + 1
          : null,
        status:          'pendente',
      }))
    );
```

- [ ] **Step 3: Show "Parcela X de Y" in the despesa row**

Current (line 1124, inside the row's subtitle `<p>`):
```tsx
                        {d.recorrente && ' · Recorrente'}
```

New (add the line right after it):
```tsx
                        {d.recorrente && ' · Recorrente'}
                        {d.total_parcelas ? ` · Parcela ${d.parcela_atual ?? 1} de ${d.total_parcelas}` : ''}
```

- [ ] **Step 4: Verify types compile and existing tests still pass**

Run (from `web/`): `npx tsc --noEmit` — expect no errors.
Run (from `web/`): `npm run test -- despesas` — expect PASS (unchanged, this task doesn't touch `shared/despesas.ts`).

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx"
git commit -m "feat: auto-lancamento incrementa parcela atual e listagem mostra progresso"
```

---

### Task 5: Mobile UI — Nova despesa (`nova-despesa.tsx`)

**Files:**
- Modify: `mobile/app/(empresa)/nova-despesa.tsx`

**Interfaces:**
- Consumes: `calcularRecorrenciaAtePorParcelas` from `@shared/despesas` (Task 2).
- Produces: `despesas.parcela_atual`/`total_parcelas` populated on insert from this screen.

- [ ] **Step 1: Import the helper**

Find this file's existing `@shared/despesas` import if present, or add one near the other imports (search for `from '@/lib/supabase'` for a nearby anchor):

```tsx
import { calcularRecorrenciaAtePorParcelas } from '@shared/despesas';
```

- [ ] **Step 2: Add state**

Current (line 76):
```tsx
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
```

New (add the lines right after):
```tsx
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
  const [modoRepeticao, setModoRepeticao] = useState<'data' | 'parcelas'>('data');
  const [quantidadeParcelas, setQuantidadeParcelas] = useState('');
  const [contratoEmAndamento, setContratoEmAndamento] = useState(false);
  const [parcelaAtualInput, setParcelaAtualInput] = useState('');
```

- [ ] **Step 3: Compute and include in insert payload**

Current (lines 104-118):
```tsx
  async function salvar() {
    if (!podeSalvar || !empresaAtiva) return;
    setSalvando(true);

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

New:
```tsx
  async function salvar() {
    if (!podeSalvar || !empresaAtiva) return;
    setSalvando(true);

    const vencimentoBanco = dataParaBanco(vencimento);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNum  = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const usaParcelas = modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimentoBanco;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimentoBanco!, totalParcelasNum, parcelaAtualNum)
      : dataParaBanco(recorrenciaAte);

    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaAtiva.id,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           parseFloat(valor.replace(',', '.')),
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimentoBanco,
      recorrencia_ate: recorrente ? recorrenciaAteFinal : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      status:          'pendente',
    });
```

- [ ] **Step 4: Add the mode toggle and quantity fields to the form**

Current (lines 276-289, the "Repetir até" `Campo` block):
```tsx
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
```

New:
```tsx
              <View style={{ marginTop: 16 }}>
                <Campo label="Repetir até (opcional)">
                  {periodicidade === 'mensal' && (
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                      <TouchableOpacity
                        onPress={() => setModoRepeticao('data')}
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                          backgroundColor: modoRepeticao === 'data' ? C.amberSoft : C.surface,
                          borderWidth: 1, borderColor: modoRepeticao === 'data' ? C.amber : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: modoRepeticao === 'data' ? C.amber : C.text3 }}>
                          Por data
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setModoRepeticao('parcelas')}
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                          backgroundColor: modoRepeticao === 'parcelas' ? C.amberSoft : C.surface,
                          borderWidth: 1, borderColor: modoRepeticao === 'parcelas' ? C.amber : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: modoRepeticao === 'parcelas' ? C.amber : C.text3 }}>
                          Por quantidade de parcelas
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {periodicidade === 'mensal' && modoRepeticao === 'parcelas' ? (
                    <View style={{ gap: 8 }}>
                      <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14 }}>
                        <TextInput
                          value={quantidadeParcelas}
                          onChangeText={setQuantidadeParcelas}
                          placeholder="Quantidade de parcelas"
                          placeholderTextColor={C.text4}
                          keyboardType="numeric"
                          style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text }}
                        />
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => setContratoEmAndamento(false)}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: !contratoEmAndamento ? C.amberSoft : C.surface,
                            borderWidth: 1, borderColor: !contratoEmAndamento ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: !contratoEmAndamento ? C.amber : C.text3 }}>
                            Novo
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setContratoEmAndamento(true)}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: contratoEmAndamento ? C.amberSoft : C.surface,
                            borderWidth: 1, borderColor: contratoEmAndamento ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: contratoEmAndamento ? C.amber : C.text3 }}>
                            Já em andamento
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {contratoEmAndamento && (
                        <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14 }}>
                          <TextInput
                            value={parcelaAtualInput}
                            onChangeText={setParcelaAtualInput}
                            placeholder="Parcela atual"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
                            style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text }}
                          />
                        </View>
                      )}
                    </View>
                  ) : (
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
                  )}
                </Campo>
              </View>
```

- [ ] **Step 5: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit` — expect only the ~10 known pre-existing errors, nothing new.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(empresa)/nova-despesa.tsx"
git commit -m "feat: adiciona quantidade de parcelas na criacao de despesa (mobile)"
```

---

### Task 6: Mobile UI — Editar despesa + rótulo na listagem (`financeiro.tsx`)

**Files:**
- Modify: `mobile/app/(empresa)/financeiro.tsx`

**Interfaces:**
- Consumes: `calcularRecorrenciaAtePorParcelas` from `@shared/despesas` (Task 2); `DespesaItem.parcela_atual`/`total_parcelas` (Task 1).
- Produces: `despesas.parcela_atual`/`total_parcelas` populated on update from this modal; despesa rows with `total_parcelas` set show "Parcela X de Y".

- [ ] **Step 1: Import the helper**

Find this file's existing `@shared/despesas` import (search for `from '@shared/despesas'`) and extend it:

Current:
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento } from '@shared/despesas';
```

New:
```tsx
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento, calcularRecorrenciaAtePorParcelas } from '@shared/despesas';
```

- [ ] **Step 2: Add state**

Current (line 618):
```tsx
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
```

New (add the lines right after):
```tsx
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
  const [modoRepeticao, setModoRepeticao] = useState<'data' | 'parcelas'>('data');
  const [quantidadeParcelas, setQuantidadeParcelas] = useState('');
  const [contratoEmAndamento, setContratoEmAndamento] = useState(false);
  const [parcelaAtualInput, setParcelaAtualInput] = useState('');
```

- [ ] **Step 3: Initialize the new state from `item` in the existing `useEffect`**

Current (lines 623-643):
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
    setModoRepeticao(item.total_parcelas ? 'parcelas' : 'data');
    setQuantidadeParcelas(item.total_parcelas ? String(item.total_parcelas) : '');
    setContratoEmAndamento((item.parcela_atual ?? 1) > 1);
    setParcelaAtualInput(item.parcela_atual ? String(item.parcela_atual) : '');
    setConfirmDelete(false);
  }, [item]);
```

- [ ] **Step 4: Compute and include in update payload**

Current (lines 659-679):
```tsx
  async function salvar() {
    if (!item) return;
    const valorN = parseFloat(valor.replace(',', '.'));
    if (isNaN(valorN) || valorN <= 0) {
      Alert.alert('Valor inválido', 'Informe um valor maior que zero.'); return;
    }
    setSalvando(true);
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: dataParaBanco(vencimento),
      recorrencia_ate: recorrente ? dataParaBanco(recorrenciaAte) : null,
    }).eq('id', item.id);
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    onSalvo();
    onClose();
  }
```

New:
```tsx
  async function salvar() {
    if (!item) return;
    const valorN = parseFloat(valor.replace(',', '.'));
    if (isNaN(valorN) || valorN <= 0) {
      Alert.alert('Valor inválido', 'Informe um valor maior que zero.'); return;
    }
    setSalvando(true);
    const vencimentoBanco = dataParaBanco(vencimento);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNum  = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const usaParcelas = modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimentoBanco;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimentoBanco!, totalParcelasNum, parcelaAtualNum)
      : dataParaBanco(recorrenciaAte);
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimentoBanco,
      recorrencia_ate: recorrente ? recorrenciaAteFinal : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
    }).eq('id', item.id);
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    onSalvo();
    onClose();
  }
```

- [ ] **Step 5: Add the mode toggle and quantity fields to the form**

Current (lines 853-871, the "Repetir até" block):
```tsx
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
```

New:
```tsx
                <View style={{ width: '100%', marginTop: 4 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
                    Repetir até (opcional)
                  </Text>
                  {periodicidade === 'mensal' && (
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                      <TouchableOpacity
                        onPress={() => setModoRepeticao('data')}
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                          backgroundColor: modoRepeticao === 'data' ? C.amberSoft : C.bg,
                          borderWidth: 1, borderColor: modoRepeticao === 'data' ? C.amber : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: modoRepeticao === 'data' ? C.amber : C.text3 }}>
                          Por data
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setModoRepeticao('parcelas')}
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                          backgroundColor: modoRepeticao === 'parcelas' ? C.amberSoft : C.bg,
                          borderWidth: 1, borderColor: modoRepeticao === 'parcelas' ? C.amber : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: modoRepeticao === 'parcelas' ? C.amber : C.text3 }}>
                          Por quantidade de parcelas
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {periodicidade === 'mensal' && modoRepeticao === 'parcelas' ? (
                    <View style={{ gap: 8 }}>
                      <View style={{
                        backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                        borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center',
                      }}>
                        <TextInput
                          value={quantidadeParcelas}
                          onChangeText={setQuantidadeParcelas}
                          placeholder="Quantidade de parcelas"
                          placeholderTextColor={C.text4}
                          keyboardType="numeric"
                          style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                        />
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => setContratoEmAndamento(false)}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: !contratoEmAndamento ? C.amberSoft : C.bg,
                            borderWidth: 1, borderColor: !contratoEmAndamento ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: !contratoEmAndamento ? C.amber : C.text3 }}>
                            Novo
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setContratoEmAndamento(true)}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: contratoEmAndamento ? C.amberSoft : C.bg,
                            borderWidth: 1, borderColor: contratoEmAndamento ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: contratoEmAndamento ? C.amber : C.text3 }}>
                            Já em andamento
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {contratoEmAndamento && (
                        <View style={{
                          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                          borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center',
                        }}>
                          <TextInput
                            value={parcelaAtualInput}
                            onChangeText={setParcelaAtualInput}
                            placeholder="Parcela atual"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
                            style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                          />
                        </View>
                      )}
                    </View>
                  ) : (
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
                  )}
                </View>
```

- [ ] **Step 6: Show "Parcela X de Y" in `DespesaRow`**

Current (line 250, inside `DespesaRow`'s subtitle `<Text>`):
```tsx
            {item.recorrente ? ' · Recorrente' : ''}
```

New (add the line right after it):
```tsx
            {item.recorrente ? ' · Recorrente' : ''}
            {item.total_parcelas ? ` · Parcela ${item.parcela_atual ?? 1} de ${item.total_parcelas}` : ''}
```

- [ ] **Step 7: Verify types compile**

Run (from `mobile/`): `npx tsc --noEmit` — expect only the ~10 known pre-existing errors, nothing new.

- [ ] **Step 8: Commit**

```bash
git add "mobile/app/(empresa)/financeiro.tsx"
git commit -m "feat: adiciona quantidade de parcelas na edicao de despesa e na listagem (mobile)"
```

---

### Task 7: Full verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full web unit test suite**

Run (from `web/`): `npm run test`
Expected: PASS, all suites — including the new migration test and the 5 new `calcularRecorrenciaAtePorParcelas` tests.

- [ ] **Step 2: Full TypeScript check — web**

Run (from `web/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Full TypeScript check — mobile**

Run (from `mobile/`): `npx tsc --noEmit`
Expected: only the ~10 known pre-existing errors in unrelated files, nothing new.

- [ ] **Step 4: Manual walkthrough (web) — reproduz o exemplo do pedido original**

1. Start the web dev server, open Financeiro.
2. Crie uma despesa recorrente mensal, marque "Por quantidade de parcelas", informe 12 parcelas, marque "Já em andamento", informe parcela atual 5, data de vencimento 13/08/2026.
3. Salve e confirme que a despesa foi criada com `recorrencia_ate` = 13/03/2027 (visível ao reabrir em "Editar despesa" e olhar o campo de data, ou consultando o banco) e que a listagem mostra "Parcela 5 de 12".
4. Avance o mês visualizado no Financeiro e clique em "Lançar agora" no banner de recorrentes — confirme que a nova despesa lançada mostra "Parcela 6 de 12".
5. Edite uma despesa recorrente existente (criada só com data, sem parcelas) e confirme que o modo padrão é "Por data" com o valor atual preservado — nada quebrou para despesas antigas.

- [ ] **Step 5: Manual walkthrough (mobile)**

1. Repita o passo 2-3 do walkthrough web na tela "Nova despesa" do app mobile.
2. Edite a mesma despesa em "Editar despesa" (mobile) e confirme que os campos de quantidade de parcelas aparecem preenchidos corretamente.

- [ ] **Step 6: Update CLAUDE.md audit log**

Add an entry to the "HISTÓRICO DE AUDITORIAS" section following the existing format (see the most recent prior session entries), summarizing this feature's delivery: quantidade de parcelas em despesas recorrentes, web e mobile, com cálculo automático de `recorrencia_ate` e contador incrementado pelo auto-lançamento. This step has no code — just document what shipped, matching the project's existing self-audit convention.
