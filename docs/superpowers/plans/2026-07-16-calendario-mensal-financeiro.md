# Calendario Mensal No Financeiro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir uma grade mensal recolhivel no topo do Financeiro, mantendo o filtro mensal existente.

**Architecture:** A tela do Financeiro continua controlando `mesRef`, carregamento e navegacao entre meses. Um componente novo e reutilizavel renderiza apenas a grade visual do mes e recebe estado/handlers por props, sem consultar Supabase.

**Tech Stack:** Next.js App Router, React client components, date-fns, Vitest, Testing Library.

## Global Constraints

- O calendario e apenas uma visualizacao mensal; clicar em dias nao muda o Financeiro para filtro diario.
- O proximo mes permanece bloqueado quando `mesRef` esta no mes atual.
- A UI deve seguir o visual da Agenda e manter alvos de toque de pelo menos 44px.
- Nao adicionar dependencias.
- Nao alterar queries, schema ou regras financeiras.

---

### Task 1: Componente FinanceMonthCalendar

**Files:**
- Create: `web/components/FinanceMonthCalendar.tsx`
- Test: `web/tests/unit/finance-month-calendar.test.tsx`

**Interfaces:**
- Produces: `FinanceMonthCalendar(props: FinanceMonthCalendarProps): JSX.Element`
- `FinanceMonthCalendarProps`:
  - `month: Date`
  - `isOpen: boolean`
  - `isNextDisabled: boolean`
  - `onToggle: () => void`
  - `onPreviousMonth: () => void`
  - `onNextMonth: () => void`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/finance-month-calendar.test.tsx` asserting that the compact selector renders `Julho 2026`, the calendar is hidden by default, the toggle reveals weekday headers/days, outside-month days are dimmed, and the next button is disabled when requested.

Run: `npm.cmd test -- tests/unit/finance-month-calendar.test.tsx`
Expected: FAIL because `@/components/FinanceMonthCalendar` does not exist.

- [ ] **Step 2: Implement minimal component**

Create `web/components/FinanceMonthCalendar.tsx` with:
- Compact selector containing previous, toggle and next controls.
- Collapsible calendar panel below the selector.
- 6-week grid generated from `startOfWeek(startOfMonth(month))`.
- The date contained in `month` marked with `aria-current="date"` to mirror the Agenda highlight without changing daily filtering.

- [ ] **Step 3: Verify focused test**

Run: `npm.cmd test -- tests/unit/finance-month-calendar.test.tsx`
Expected: PASS.

### Task 2: Wire Into Financeiro

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `FinanceMonthCalendar` from `@/components/FinanceMonthCalendar`.
- Keeps existing `mesRef` state and `carregar(empId, mesRef)` effect unchanged.

- [ ] **Step 1: Add open/close state**

Add `const [calendarioAberto, setCalendarioAberto] = useState(false);` near the Financeiro page UI state.

- [ ] **Step 2: Replace the month selector markup**

Replace the current selector block with `FinanceMonthCalendar`, passing:
- `month={mesRef}`
- `isOpen={calendarioAberto}`
- `isNextDisabled={isHoje}`
- `onToggle={() => setCalendarioAberto(open => !open)}`
- `onPreviousMonth={() => setMesRef(m => subMonths(m, 1))}`
- `onNextMonth={() => !isHoje && setMesRef(m => addMonths(m, 1))}`

- [ ] **Step 3: Verify page typecheck**

Run: `npx.cmd tsc --noEmit`
Expected: exit 0.

### Task 3: Final Verification

**Files:**
- Modify: `AGENTS.md` only if the audit history is updated after successful verification.

- [ ] **Step 1: Run focused test**

Run: `npm.cmd test -- tests/unit/finance-month-calendar.test.tsx`
Expected: PASS.

- [ ] **Step 2: Run TypeScript auditor**

Run: `npx.cmd tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Inspect diff**

Run: `git diff --stat`
Expected: only the new docs, component, test and Financeiro page are changed.
