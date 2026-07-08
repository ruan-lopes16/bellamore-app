# Performance Inicial Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** reduzir TTFB e carregamento inicial duplicado nas rotas protegidas da web.

**Architecture:** o Proxy passa a fazer checagem otimista de cookie e refresh condicional de sessao, sem `getUser()` remoto em toda requisicao. A validacao segura permanece no server layout e nas rotas/API. Um helper server cacheado centraliza usuario/empresa para evitar chamadas duplicadas no mesmo render.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase SSR, Vitest, TypeScript.

## Global Constraints

- Nao reverter mudancas pendentes ja existentes no branch.
- Nao adicionar dependencia nova.
- Manter API routes com autorizacao propria.
- Seguir TDD para regras novas.

---

### Task 1: Proxy leve por cookie

**Files:**
- Create: `web/lib/auth/proxy-rules.ts`
- Test: `web/tests/unit/proxy-rules.test.ts`
- Modify: `web/proxy.ts`

**Interfaces:**
- Produces: `hasSupabaseAuthCookie(cookieNames, supabaseUrl?)`
- Produces: `shouldRedirectToLogin({ pathname, cookieNames, supabaseUrl })`

- [ ] Write failing tests for cookie detection, protected paths, public auth paths and API exclusion.
- [ ] Run `npm.cmd test -- tests/unit/proxy-rules.test.ts` and confirm failure before implementation.
- [ ] Implement pure proxy rules.
- [ ] Replace remote `getUser()` in `web/proxy.ts` with pure redirect rule plus conditional `getSession()` for refresh.
- [ ] Run targeted test and TypeScript.

### Task 2: Server app context cache

**Files:**
- Create: `web/lib/auth/server-context.ts`
- Modify: `web/components/AppLayout.tsx`
- Modify: `web/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Produces: `getAppContext(): Promise<AppContext>`
- `AppContext` includes `supabase`, `user`, `empresaId`, `empresa`.

- [ ] Add helper with React `cache`.
- [ ] Update `AppLayout` to consume helper.
- [ ] Update dashboard to reuse helper instead of repeating auth and member lookup.
- [ ] Run TypeScript.

### Task 3: Sidebar initial calls

**Files:**
- Modify: `web/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `empresaId` prop from `AppLayout`.

- [ ] Add `empresaId` to Sidebar props.
- [ ] Remove client-side `getUser()` and `empresa_membros` lookup from Sidebar effect.
- [ ] Keep count queries parallel and scoped by `empresaId`.
- [ ] Run TypeScript and tests.

### Task 4: Final verification and audit

**Files:**
- Read: `AGENTS.md`

- [ ] Run `npm.cmd test`.
- [ ] Run `npx.cmd tsc --noEmit`.
- [ ] Report performance impact, residual risk and AGENTS.md audit score.
