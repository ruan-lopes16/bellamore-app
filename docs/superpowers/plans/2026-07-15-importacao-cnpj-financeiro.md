# Importacao CNPJ no Financeiro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer os dados do bloco `CNPJ - ANA` da planilha aparecerem no Financeiro como despesas pagas de Jan-Mai/2026, com preview e confirmacao antes de gravar.

**Architecture:** A importacao fica dentro do app web e usa a sessao Supabase do usuario logado, preservando RLS. Um parser puro converte workbook em despesas tipadas; um componente client-side le o `.xlsx`, mostra preview, detecta duplicidades e insere apenas linhas novas.

**Tech Stack:** Next.js/React, Supabase browser client, `xlsx` ja presente no `web/package.json`, Vitest.

## Global Constraints

- Fonte: somente o bloco `CNPJ - ANA`.
- Meses importados: `01-Jan`, `02-Fev`, `03-Mar`, `04-Abr` e `05-Mai` de 2026.
- Nao importar `06-Jun`, `07-Jul`, demais meses, `Resumo Anual`, `Dashboard`, dados pessoais ou `CNPJ - RUAN`.
- Todas as despesas entram com `status: pago`, `recorrente: false`, `data_pagamento` e `data_vencimento` no primeiro dia do mes.
- `PRO-LABORE` deve entrar como categoria `Comissao`.
- Nenhuma gravacao acontece antes da confirmacao do usuario.
- Detectar duplicidades por `empresa_id`, `descricao`, `categoria`, `valor`, `data_pagamento` e `status`.

---

### Task 1: Parser Puro Da Planilha

**Files:**
- Create: `web/lib/import/cnpj-financeiro.ts`
- Test: `web/tests/unit/cnpj-financeiro-import.test.ts`

**Interfaces:**
- Produces: `parseCnpjFinanceiroRowsBySheet(sheets: Record<string, unknown[][]>): CnpjImportPreview`
- Produces: `parseCnpjFinanceiroWorkbook(workbook: WorkBook): CnpjImportPreview`
- Produces: `buildCnpjDespesaDuplicateKey(item: CnpjImportDespesa): string`

- [ ] **Step 1: Write the failing parser tests**

Run: `npm.cmd test -- tests/unit/cnpj-financeiro-import.test.ts`
Expected: FAIL because `@/lib/import/cnpj-financeiro` does not exist yet.

- [ ] **Step 2: Implement the parser**

Implement month filtering, CNPJ ANA column mapping, operational expenses, pro-labore as `Comissao`, totals, warnings and duplicate keys.

- [ ] **Step 3: Run focused tests**

Run: `npm.cmd test -- tests/unit/cnpj-financeiro-import.test.ts`
Expected: PASS.

### Task 2: Importador Client-Side No Financeiro

**Files:**
- Create: `web/components/CnpjFinanceiroImporter.tsx`
- Modify: `web/app/(app)/financeiro/page.tsx`

**Interfaces:**
- Consumes: `parseCnpjFinanceiroWorkbook` and `buildCnpjDespesaDuplicateKey`.
- Produces: modal/preview with file input, duplicate detection, confirm import and `onImported()`.

- [ ] **Step 1: Add importer component**

Use dynamic `import('xlsx')`, parse selected workbook, query existing expenses for Jan-Mai/2026, flag duplicates, and insert only non-duplicates after confirmation.

- [ ] **Step 2: Wire into Financeiro**

Add an `Importar CNPJ` action beside `Nova` in the Despesas panel and refresh the current month after import.

- [ ] **Step 3: Typecheck**

Run: `npm.cmd exec tsc --noEmit`
Expected: exit 0.

### Task 3: PR Update

**Files:**
- Modify: PR branch `codex-despesas-recorrentes-valor-mensal`

- [ ] **Step 1: Review diff**

Run: `git diff --stat` and `git diff --check`.

- [ ] **Step 2: Commit scoped changes**

Stage only the importer, tests, plan/spec updates and commit in Portuguese.

- [ ] **Step 3: Push branch**

Run: `git push`.
