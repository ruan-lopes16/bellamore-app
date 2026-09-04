# Lote de ajustes de UI + lembretes de atendimento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar 13 correções de UI a partir de screenshots do PWA e reformular os lembretes de atendimento (push por atendimento via `pg_cron` + prune de alertas passados), com espelho no app Expo onde houver equivalente.

**Architecture:** Correções de UI são cirúrgicas nos arquivos existentes (`agenda/page.tsx`, `financeiro/`, `relatorios/page.tsx`, `SearchSelect.tsx`, `Sidebar.tsx`). O motor de lembretes extrai lógica pura para `shared/lembretes.ts` (testável), reescreve `web/app/api/cron/lembretes/route.ts` para enviar push por atendimento, e agenda a rota via 3 migrations novas (`066`–`068`). O Expo usa agendamento local (`expo-notifications`), não o servidor.

**Tech Stack:** Next.js 16 (App Router) + React 19, Tailwind, Supabase (Postgres + RLS + `pg_cron`/`pg_net`), `web-push`, Vitest (jsdom), Expo Router + `expo-notifications`, date-fns.

## Global Constraints

- `npx tsc --noEmit` no diretório `web/` deve terminar com **zero erros** ao fim de cada tarefa que toca `web/`.
- `cd mobile && npx tsc --noEmit`: a baseline de **~10 erros pré-existentes** do mobile deve ficar **idêntica** — nenhum erro novo. Rodar antes de começar qualquer tarefa mobile e comparar.
- Toda cópia de UI, comentário de código e JSDoc em **português (pt-BR)**. Nunca inglês.
- **Verificação no navegador é obrigatória** (não só `tsc`) para as tarefas: **3 (A3), 8 (B2), 7 (B1), 10 (C1), 19 (E5)**. Usar o Browser pane: `preview_start` no dev server do `web/`, `resize_window` para 320/375/1280, `read_page`/`computer`/screenshot.
- As migrations **066, 067, 068 são novas** (a última no repo é `065`) e são **entregues, não aplicadas** — o usuário roda `supabase db push` e troca os placeholders `APP_URL`/`CRON_SECRET` da `067`. As migrations de push que já existem e são só consumidas: `005_push_token.sql`, `019_web_push_subscriptions.sql`.
- **Menu inferior do Expo (`mobile/app/(empresa)/_layout.tsx`) NÃO é tocado** nesta leva (item D é web-only).
- Commits pequenos e frequentes, um por tarefa no mínimo. Mensagens em pt-BR. Rodapé de commit:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- Spec de referência: `docs/superpowers/specs/2026-09-03-ajustes-ui-e-lembretes-agendamento-design.md`.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `web/components/SearchSelect.tsx` | Modificar | Empilhar `label`/`sub` no estado fechado (A1) |
| `web/app/(app)/agenda/page.tsx` | Modificar | Rótulo "Pacote" (A2), scroll-x do modal (A3), `AgCard` status inline (A4), bloco de timeline (A5) |
| `web/app/(app)/financeiro/loading.tsx` | Reescrever | Skeleton espelhando o layout real (B1) |
| `web/app/(app)/financeiro/page.tsx` | Modificar | Grid único de KPIs sem célula órfã (B2) |
| `web/app/(app)/relatorios/page.tsx` | Modificar | `ChartBar` com altura resolvível (C1), cor da comissão (C2), remover Funil (C3) |
| `web/components/Sidebar.tsx` | Modificar | Swap Comanda/Financeiro em `MOBILE_NAV` e `MAIS_NAV` (D) |
| `shared/lembretes.ts` | Criar | Funções puras: janela de lembrete, resumo de véspera, destinatários (E2) |
| `web/app/api/cron/lembretes/route.ts` | Reescrever | Motor de push por atendimento (E2) |
| `supabase/migrations/066_agendamento_lembretes.sql` | Criar | Colunas `lembrete_vespera_em`, `lembrete_30min_em` (E1) |
| `supabase/migrations/067_cron_lembretes_pg_cron.sql` | Criar | Job `pg_cron` a cada 5 min (E3) |
| `supabase/migrations/068_prune_notificacoes_agendamento.sql` | Criar | Job diário de limpeza (E4) |
| `web/vercel.json` | Modificar | Remover o bloco `crons` diário (E3) |
| `web/app/(app)/notificacoes/page.tsx` | Modificar | Alertas de agendamento colapsados em 1 linha expansível (E5) |
| `mobile/app/(empresa)/novo-agendamento.tsx` | Modificar | Rótulos "Pacote" / "Pacote do cliente" (A2) |
| `mobile/app/(empresa)/agenda.tsx` | Modificar | Card da timeline concatena todos os serviços (A5) |
| `mobile/app/(empresa)/financeiro.tsx` | Modificar | Skeleton e grid de KPIs equivalentes (B1/B2) |
| `mobile/app/(empresa)/relatorios.tsx` | Modificar | Gráfico proporcional, cor da comissão, remover Funil (C1/C2/C3) |
| `mobile/lib/notifications.ts` | Modificar | `agendarLembretesLocais()` com `expo-notifications` (E6) |
| `web/tests/unit/lembretes.test.ts` | Criar | Testes das funções puras (E2) |
| `web/tests/unit/lembretes-migrations.test.ts` | Criar | Asserções sobre as migrations 066–068 |
| `web/tests/unit/ui-lote-2026-09.test.ts` | Criar | Asserções de regressão de fonte para as correções de UI |

---

## Task 1: A1 — SearchSelect empilha nome + telefone

**Files:**
- Modify: `web/components/SearchSelect.tsx` (bloco "Modo exibição", ~L131-146)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts` (criar)

**Interfaces:**
- Consumes: nada.
- Produces: nenhuma API nova. O componente continua com a mesma prop `SelectOpt { value; label; sub? }`.

- [ ] **Step 1: Escrever o teste de regressão de fonte (falha)**

Criar `web/tests/unit/ui-lote-2026-09.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

describe('A1 — SearchSelect empilha label e sub', () => {
  const src = read('components/SearchSelect.tsx');

  it('não usa mais truncate numa linha só quando há sub selecionado', () => {
    // o novo layout empilha: label em bloco, sub embaixo
    expect(src).toContain('data-testid="select-valor-empilhado"');
  });

  it('o campo cresce de altura quando há sub (min-h em vez de h fixo no wrapper de exibição)', () => {
    expect(src).toMatch(/selecionado\?\.sub/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts`
Expected: FAIL (`data-testid="select-valor-empilhado"` não existe).

- [ ] **Step 3: Implementar o empilhamento**

Em `web/components/SearchSelect.tsx`, no ramo `// Modo exibição: mostra opção selecionada ou placeholder` (hoje):

```tsx
        ) : (
          // Modo exibição: mostra opção selecionada ou placeholder
          <>
            <span className={`flex-1 truncate ${selecionado ? 'text-text' : 'text-text-4'}`}>
              {selecionado ? (
                <>
                  {selecionado.label}
                  {selecionado.sub && (
                    <span className="text-text-4 ml-1.5 text-xs">{selecionado.sub}</span>
                  )}
                </>
              ) : placeholder}
            </span>
            <ChevronDown size={14} className="text-text-4 flex-shrink-0" strokeWidth={2}/>
          </>
        )}
```

trocar por:

```tsx
        ) : selecionado && selecionado.sub ? (
          // Exibição com sub (ex.: cliente + telefone): empilha em 2 linhas para
          // não truncar nem o nome nem o telefone.
          <>
            <span data-testid="select-valor-empilhado" className="flex-1 min-w-0 flex flex-col justify-center py-1.5 leading-tight">
              <span className="truncate text-text text-sm">{selecionado.label}</span>
              <span className="truncate text-text-4 text-xs">{selecionado.sub}</span>
            </span>
            <ChevronDown size={14} className="text-text-4 flex-shrink-0" strokeWidth={2}/>
          </>
        ) : (
          // Exibição simples (1 linha): opção sem sub, ou placeholder.
          <>
            <span className={`flex-1 truncate ${selecionado ? 'text-text' : 'text-text-4'}`}>
              {selecionado ? selecionado.label : placeholder}
            </span>
            <ChevronDown size={14} className="text-text-4 flex-shrink-0" strokeWidth={2}/>
          </>
        )}
```

Em seguida, no `div` do campo principal (`const base = "w-full h-10 rounded-xl ..."`), trocar `h-10` por `min-h-10` para o campo crescer quando empilhado:

```tsx
  const base = "w-full min-h-10 rounded-xl border border-border bg-bg text-sm transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20";
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts`
Expected: PASS (a suíte `A1`).

- [ ] **Step 5: `tsc`**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 6: Verificação no navegador**

`preview_start` no dev server do `web/`. Abrir `/agenda`, `resize_window` 375px, abrir "Editar agendamento" de um agendamento cujo cliente tenha nome longo. Confirmar por `read_page` que o nome completo e o telefone completo aparecem (2 linhas, sem `…`). Screenshot.

- [ ] **Step 7: Commit**

```bash
git add web/components/SearchSelect.tsx web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(agenda): nome e telefone do cliente não são mais cortados no SearchSelect"
```

---

## Task 2: A2 — Rótulo "Pacote" (web + mobile)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` (~L723 e ~L781)
- Modify: `mobile/app/(empresa)/novo-agendamento.tsx` (~L559 e ~L635)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts` (adicionar `describe`)

**Interfaces:**
- Consumes: nada. Produces: nada.

- [ ] **Step 1: Adicionar teste (falha)**

Em `web/tests/unit/ui-lote-2026-09.test.ts`, adicionar:

```ts
describe('A2 — rótulo do pacote encurtado', () => {
  it('web: label "Pacote" sem o parêntese explicativo', () => {
    const src = read('app/(app)/agenda/page.tsx');
    expect(src).not.toContain('preenche os serviços e vende na hora');
    expect(src).not.toContain('consome 1 sessão ao concluir');
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A2"`
Expected: FAIL.

- [ ] **Step 3: Editar o web**

Em `web/app/(app)/agenda/page.tsx`:

- ~L723-725, trocar:
```tsx
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Pacote do cliente <span className="text-text-4 normal-case font-normal">(opcional — consome 1 sessão ao concluir)</span>
              </label>
```
por:
```tsx
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Pacote do cliente
              </label>
```

- ~L780-782, trocar:
```tsx
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Vender pacote agora <span className="text-text-4 normal-case font-normal">(opcional — preenche os serviços e vende na hora)</span>
              </label>
```
por:
```tsx
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Pacote
              </label>
```

- [ ] **Step 4: Editar o mobile**

Em `mobile/app/(empresa)/novo-agendamento.tsx`:
- ~L559: `Pacote do cliente — consome 1 sessão` → `Pacote do cliente`
- ~L635: `Vender pacote agora` → `Pacote`

- [ ] **Step 5: Testes + tsc (web e mobile)**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A2" && npx tsc --noEmit`
Expected: PASS + zero erros.
Run: `cd mobile && npx tsc --noEmit`
Expected: baseline inalterada.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx" "mobile/app/(empresa)/novo-agendamento.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(agenda): rótulo do pacote vira apenas \"Pacote\" (web + mobile)"
```

---

## Task 3: A3 — Elimina scroll horizontal no modal "Editar agendamento"

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` — `inputClass` (~L586) e o grid de serviço (~L826)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts` (adicionar `describe`)

**Interfaces:**
- Consumes: nada. Produces: nada.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('A3 — modal de agendamento sem scroll horizontal', () => {
  const src = read('app/(app)/agenda/page.tsx');
  it('grid de duração/valor tem min-w-0 nas células', () => {
    expect(src).toContain('grid grid-cols-2 gap-2 min-w-0');
  });
  it('inputClass permite encolher (min-w-0)', () => {
    expect(src).toMatch(/const inputClass = "[^"]*min-w-0[^"]*"/);
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A3"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `web/app/(app)/agenda/page.tsx`:

- ~L586, trocar:
```tsx
  const inputClass = "w-full h-10 px-3 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
```
por:
```tsx
  const inputClass = "w-full min-w-0 max-w-full h-10 px-3 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
```

- ~L826, no bloco de serviço, trocar:
```tsx
                  {l.servico_id && (
                    <div className="grid grid-cols-2 gap-2">
```
por:
```tsx
                  {l.servico_id && (
                    <div className="grid grid-cols-2 gap-2 min-w-0">
```

E nas duas `<div>` internas (Duração / Valor) desse grid, adicionar `min-w-0`:
```tsx
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide mb-1">Duração (min)</p>
```
```tsx
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide mb-1">Valor (R$)</p>
```

- [ ] **Step 4: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A3" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 5: Verificação no navegador (obrigatória)**

`preview_start`. Abrir `/agenda`, `resize_window` **320px** e **375px**. Abrir "Editar agendamento" (agendamento com 1+ serviço, para o grid Duração/Valor aparecer). Rodar via `javascript_tool`:
```js
({ doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
   modal: (() => { const m = document.querySelector('.bm-modal .overflow-y-auto'); return m ? m.scrollWidth <= m.clientWidth : null; })() })
```
Expected: `{ doc: true, modal: true }` nos dois tamanhos. Screenshot em 320px.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(agenda): elimina scroll horizontal no modal de editar agendamento"
```

---

## Task 4: A4 — Modal "Detalhes" com status inline (sem dropdown flutuante)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` — `AgCard` (~L140-226) e o modal mobile de Detalhes (~L1448-1464)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `AgCard` ganha prop opcional `statusInline?: boolean` (default `false`). Assinatura: `function AgCard({ ag, empresaId, onStatus, onEditar, statusInline }: { ag: Ag; empresaId: string; onStatus: (id: string, s: string) => void; onEditar?: (ag: Ag) => void; statusInline?: boolean })`.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('A4 — modal Detalhes com status inline', () => {
  const src = read('app/(app)/agenda/page.tsx');
  it('AgCard aceita a prop statusInline', () => {
    expect(src).toContain('statusInline');
  });
  it('o modal mobile de Detalhes passa statusInline', () => {
    expect(src).toMatch(/AgCard[\s\S]{0,400}statusInline/);
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A4"`
Expected: FAIL.

- [ ] **Step 3: Adicionar a prop e o ramo inline no `AgCard`**

Em `web/app/(app)/agenda/page.tsx`, mudar a assinatura de `AgCard`:

```tsx
function AgCard({ ag, empresaId, onStatus, onEditar, statusInline = false }: {
  ag: Ag;
  empresaId: string;
  onStatus: (id: string, s: string) => void;
  onEditar?: (ag: Ag) => void;
  statusInline?: boolean;
}) {
```

Dentro do `AgCard`, no bloco `{/* Badge de status clicável */}` (a `<div className="relative">` que hoje contém o botão `{st.label} ▾` e o menu `{menuAberto && ...}`), envolver com o condicional: quando `statusInline` for `true`, renderizar só o badge atual (sem botão de abrir menu), e a lista de status vai para o rodapé do card.

Trocar:
```tsx
              {/* Badge de status clicável */}
              <div className="relative">
              <button
                onClick={() => setMenuAberto(v => !v)}
                className={`text-xs font-semibold px-2 py-0.5 rounded-lg transition hover:opacity-80 ${st.bg} ${st.text}`}>
                {st.label} ▾
              </button>
              {menuAberto && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)}/>
                  <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-xl shadow-lg py-1 min-w-[130px]">
                    {STATUS_OPCOES.map(({ key, label, cor }) => (
                      <button key={key} onClick={() => selecionarStatus(key)}
                        className={`w-full text-left px-3 py-2 text-xs font-semibold hover:bg-bg transition flex items-center gap-2 ${
                          ag.status === key ? 'opacity-40 cursor-default' : cor
                        }`}>
                        {ag.status === key && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0"/>}
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              </div>{/* /relative (status) */}
```

por:
```tsx
              {/* Badge de status — clicável (dropdown) no desktop, estático no modo inline */}
              {statusInline ? (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${st.bg} ${st.text}`}>
                  {st.label}
                </span>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => setMenuAberto(v => !v)}
                    className={`text-xs font-semibold px-2 py-0.5 rounded-lg transition hover:opacity-80 ${st.bg} ${st.text}`}>
                    {st.label} ▾
                  </button>
                  {menuAberto && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)}/>
                      <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-xl shadow-lg py-1 min-w-[130px]">
                        {STATUS_OPCOES.map(({ key, label, cor }) => (
                          <button key={key} onClick={() => selecionarStatus(key)}
                            className={`w-full text-left px-3 py-2 text-xs font-semibold hover:bg-bg transition flex items-center gap-2 ${
                              ag.status === key ? 'opacity-40 cursor-default' : cor
                            }`}>
                            {ag.status === key && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0"/>}
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
```

Depois, logo antes do fechamento do card (após o `<div className="flex items-center gap-3 text-xs text-text-3">...</div>` que mostra horário/profissional/valor, e antes de `</div></div></div>`), adicionar o seletor inline:

```tsx
          {statusInline && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide mb-1.5">Mudar status</p>
              <div className="flex flex-col gap-1.5">
                {STATUS_OPCOES.map(({ key, label, cor }) => (
                  <button key={key} type="button" onClick={() => selecionarStatus(key)}
                    disabled={ag.status === key}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border transition flex items-center gap-2 ${
                      ag.status === key
                        ? 'border-accent bg-accent/10 text-text opacity-60 cursor-default'
                        : `border-border bg-surface hover:bg-bg ${cor}`
                    }`}>
                    {ag.status === key && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0"/>}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
```

- [ ] **Step 4: Passar `statusInline` no modal mobile de Detalhes**

No `TimelineView`, no bloco `{/* Mobile: modal centralizado ... */}` (~L1448), o `<AgCard>` dentro de `<div className="p-3 overflow-y-auto flex-1">`:

```tsx
                <AgCard ag={agSel} empresaId={empresaId} statusInline
                  onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}
                  onEditar={onEditar ? ag => { setAgSel(null); onEditar(ag); } : undefined}/>
```

Dar mais respiro ao corpo do modal: trocar `className="p-3 overflow-y-auto flex-1"` por `className="p-4 overflow-y-auto flex-1"` e, no wrapper do modal, `max-w-sm` continua; trocar `max-h-[85dvh]` por `max-h-[88dvh]`.

O `<AgCard>` do painel **desktop** (bloco `{/* Desktop: painel lateral */}`) permanece **sem** `statusInline`.

- [ ] **Step 5: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A4" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 6: Verificação no navegador**

`preview_start`. `/agenda` na visão Timeline, `resize_window` 375px. Tocar num bloco de agendamento → o modal "Detalhes" abre. Confirmar por `read_page` que as 5 opções de status aparecem como lista dentro do modal (sem corte) e que trocar o status fecha o modal e atualiza. Screenshot.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(agenda): modal Detalhes mostra status como lista inline no mobile"
```

---

## Task 5: A5 (web) — Timeline sempre mostra horário e todos os serviços

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` — bloco de agendamento do `TimelineView` (~L1406-1432)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts`

**Interfaces:**
- Consumes: `Ag` já tem `agendamento_servicos?: { ordem: number; servico?: { nome } }[]` e `servico?: { nome }`.
- Produces: nada.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('A5 web — timeline mostra horário e todos os serviços', () => {
  const src = read('app/(app)/agenda/page.tsx');
  it('bloco da timeline concatena agendamento_servicos', () => {
    // helper reutilizado do AgCard: junta nomes por " + "
    expect(src).toContain('nomesServicosDoAg(ag)');
  });
  it('horário do bloco não depende mais de h >= 54', () => {
    expect(src).not.toContain('{h >= 54 && (');
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A5 web"`
Expected: FAIL.

- [ ] **Step 3: Extrair helper de nomes de serviço**

Perto do topo do arquivo (após `fmtBRL`, ~L122), adicionar:

```tsx
/** Nomes de todos os serviços de um agendamento, unidos por " + " (fallback: serviço legado). */
function nomesServicosDoAg(ag: { agendamento_servicos?: { ordem: number; servico?: { nome?: string | null } | null }[]; servico?: { nome?: string | null } | null }): string {
  const multi = ag.agendamento_servicos ?? [];
  if (multi.length > 0) {
    return [...multi].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ') || '—';
  }
  return ag.servico?.nome ?? '—';
}
```

Trocar, no `AgCard` (~L208-212), o bloco que já faz esse join manualmente por `{nomesServicosDoAg(ag)}` (mesma saída — evita duplicação).

- [ ] **Step 4: Reescrever o conteúdo do bloco da timeline**

No `TimelineView`, dentro do `<button key={ag.id} ...>`, o `<div className="px-1.5 py-1 h-full flex flex-col justify-start">` hoje tem: linha do nome (+check+dots), depois `{h >= 38 && (<p>serviço</p>)}`, depois `{h >= 54 && (<p>horário</p>)}`.

Trocar o miolo por:

```tsx
                        <div className="px-1.5 py-1 h-full flex flex-col justify-start gap-0.5 min-w-0">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className={`text-[10px] font-bold leading-none flex-shrink-0 ${inativo ? 'text-text-4' : 'text-text-3'}`}>
                              {format(parseISO(ag.data_hora_inicio), 'HH:mm')}
                            </span>
                            <p className={`text-[11px] font-bold leading-tight truncate flex-1 ${inativo ? 'text-text-3 line-through' : 'text-text'}`}>
                              {ag.cliente?.nome ?? '—'}
                            </p>
                            {ag.status === 'concluido' && (
                              <Check size={10} strokeWidth={3} className="flex-shrink-0" style={{ color: 'var(--color-green)' }}/>
                            )}
                            {cats.length > 1 && (
                              <div className="flex gap-0.5 flex-shrink-0">
                                {cats.slice(0, 3).map(c => (
                                  <span key={c} className="w-1.5 h-1.5 rounded-full" style={{ background: infoCategoria(c, categoriasCustom).cor }}/>
                                ))}
                              </div>
                            )}
                          </div>
                          {h >= 34 && (
                            <p className="text-[10px] text-text-3 leading-tight truncate">
                              {nomesServicosDoAg(ag)}
                            </p>
                          )}
                        </div>
```

(Horário agora sempre visível junto do nome; serviço só se houver ~1 linha de espaço.)

- [ ] **Step 5: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A5 web" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 6: Verificação no navegador**

`preview_start`. `/agenda` visão Timeline, dia com agendamentos de durações variadas (um de 30 min, um de 1h+). `read_page` / screenshot: todo bloco mostra `HH:mm` ao lado do nome; blocos com 2+ serviços mostram os nomes unidos por ` + `.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(agenda): timeline sempre mostra horário e concatena todos os serviços"
```

---

## Task 6: A5 (mobile) — Card da timeline concatena todos os serviços

**Files:**
- Modify: `mobile/app/(empresa)/agenda.tsx` — `AgendamentoCard` (linha do serviço, ~L124-127) e a query do hook se necessário
- Modify: `mobile/hooks/useAgenda.ts` — garantir que `agendamento_servicos` vem no select de `useAgendamentoDia`
- Test: `web/tests/unit/ui-lote-2026-09.test.ts` (asserção de fonte do mobile)

**Interfaces:**
- Consumes: `AgendamentoCompleto`.
- Produces: nada.

- [ ] **Step 1: Conferir a baseline do mobile**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`
Anotar a contagem/lista de erros (baseline).

- [ ] **Step 2: Teste de fonte (falha)**

```ts
describe('A5 mobile — card da timeline concatena serviços', () => {
  const src = read('../mobile/app/(empresa)/agenda.tsx');
  it('não usa mais só ag.servico?.nome isolado no card', () => {
    expect(src).toContain('nomesServicos(ag)');
  });
});
```

- [ ] **Step 3: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A5 mobile"`
Expected: FAIL.

- [ ] **Step 4: Garantir `agendamento_servicos` no hook**

Em `mobile/hooks/useAgenda.ts`, no `select(...)` de `useAgendamentoDia` (a query que alimenta a timeline), se ainda não tiver, acrescentar:
`agendamento_servicos(ordem, servico:servicos(nome))`
ao lado do `servico:servicos(...)` já existente. Ajustar o tipo `AgendamentoCompleto` para incluir `agendamento_servicos?: { ordem: number; servico: { nome: string } | null }[]`.

- [ ] **Step 5: Helper + uso no card**

Em `mobile/app/(empresa)/agenda.tsx`, perto de `horaStr` (~L77), adicionar:

```tsx
/** Nomes de todos os serviços do agendamento, unidos por " + " (fallback: serviço único). */
function nomesServicos(ag: AgendamentoCompleto): string {
  const multi = ag.agendamento_servicos ?? [];
  if (multi.length > 0) {
    return [...multi].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ') || '—';
  }
  return ag.servico?.nome ?? '—';
}
```

No `AgendamentoCard`, trocar (~L125-127):
```tsx
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 8 }} numberOfLines={1}>
          {ag.servico?.nome}
        </Text>
```
por:
```tsx
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 8 }} numberOfLines={1}>
          {nomesServicos(ag)}
        </Text>
```

- [ ] **Step 6: Teste + tsc mobile**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "A5 mobile"`
Expected: PASS.
Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`
Expected: baseline **idêntica** à do Step 1 (nenhum erro novo).

- [ ] **Step 7: Commit**

```bash
git add "mobile/app/(empresa)/agenda.tsx" mobile/hooks/useAgenda.ts web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(mobile/agenda): card da timeline mostra todos os serviços do agendamento"
```

---

## Task 7: B1 — Reescreve o skeleton de Financeiro para bater com o layout real

**Files:**
- Rewrite: `web/app/(app)/financeiro/loading.tsx`
- Reference (não modificar): `web/app/(app)/financeiro/page.tsx` (~L1477-1547, grid real de KPIs)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts`

**Interfaces:**
- Consumes: `Sk` de `@/components/Skeleton`.
- Produces: nada.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('B1 — skeleton de Financeiro espelha o layout real', () => {
  const sk = read('app/(app)/financeiro/loading.tsx');
  it('usa a mesma grade de KPIs da tela real (grid-cols-2 lg:grid-cols-3)', () => {
    expect(sk).toContain('grid grid-cols-2 lg:grid-cols-3');
    expect(sk).not.toContain('sm:grid-cols-3'); // padrão antigo, empilhado
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "B1"`
Expected: FAIL.

- [ ] **Step 3: Reescrever `web/app/(app)/financeiro/loading.tsx`**

```tsx
import { Sk } from '@/components/Skeleton';

/**
 * Skeleton da tela de Financeiro — espelha o layout real de `page.tsx`:
 * header + seletor de mês + grade única de 7 KPIs (grid-cols-2 lg:grid-cols-3,
 * último ocupando a linha inteira no mobile) + grid de 2 colunas
 * (evolução / top serviços) + lista de despesas.
 */
export default function FinanceiroLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Sk className="h-3 w-20 mb-2" />
          <Sk className="h-8 w-36" />
        </div>
        <Sk className="h-10 w-28 rounded-xl" />
      </div>

      {/* Seletor de mês (centralizado) */}
      <div className="flex items-center justify-center mb-6">
        <div className="bg-surface border border-border rounded-2xl p-3 flex items-center gap-3 shadow-sm">
          <Sk className="w-8 h-8 rounded-lg" />
          <div className="w-36 flex flex-col items-center gap-1.5">
            <Sk className="h-4 w-24" />
            <Sk className="h-3 w-20" />
          </div>
          <Sk className="w-8 h-8 rounded-lg" />
        </div>
      </div>

      {/* KPIs — grade única, 7 cards (o último ocupa a linha no mobile) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {[1,2,3,4,5,6,7].map((i, idx, arr) => (
          <div key={i}
            className={`bg-surface border border-border rounded-2xl p-3 sm:p-5 shadow-sm min-w-0 ${
              idx === arr.length - 1 && arr.length % 2 === 1 ? 'col-span-2 lg:col-span-1' : ''
            }`}>
            <Sk className="h-3 w-1/3 mb-3 max-w-[100px]" />
            <Sk className="h-7 w-2/3 mb-3 max-w-[140px]" />
            <Sk className="h-3 w-1/2 max-w-[120px]" />
          </div>
        ))}
      </div>

      {/* Grid de 2 colunas: Evolução + Top Serviços */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <Sk className="h-5 w-36 mb-5" />
          <div className="flex items-end gap-3 h-24">
            {[60,80,45,90,70,100].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <Sk className="w-full rounded-t-sm" style={{ height: `${h}%` }} />
                <Sk className="h-2.5 w-6" />
              </div>
            ))}
          </div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <Sk className="h-5 w-1/3 max-w-[140px] mb-4" />
          <div className="flex flex-col gap-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Sk className="h-5 w-5 flex-shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="flex justify-between gap-2">
                    <Sk className="h-3 flex-1 max-w-[140px]" />
                    <Sk className="h-3 w-14 flex-shrink-0" />
                  </div>
                  <Sk className="h-1.5 w-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Despesas (cabeçalho + lista) */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border gap-3">
          <Sk className="h-5 w-1/3 max-w-[100px]" />
          <Sk className="h-4 w-16 flex-shrink-0" />
        </div>
        {[1,2,3].map(i => (
          <div key={i} className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0">
            <Sk className="w-8 h-8 rounded-lg flex-shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <Sk className="h-4 w-2/3 max-w-[180px]" />
              <Sk className="h-3 w-1/2 max-w-[120px]" />
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <Sk className="h-4 w-16" />
              <Sk className="h-4 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "B1" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 5: Verificação no navegador (obrigatória)**

`preview_start`. `resize_window` 375px. Navegar para `/financeiro` e observar o skeleton (recarregar com throttling ou via `navigate` para forçar o `loading.tsx`). Comparar com a tela carregada: mesma quantidade de cards em 2 colunas, sem célula órfã, seletor de mês centralizado. Screenshot do skeleton.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/financeiro/loading.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(financeiro): skeleton de loading passa a espelhar o grid real de KPIs"
```

---

## Task 8: B2 — Grid de KPIs de Financeiro sem célula vazia no mobile

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx` (~L1490-1547 — o bloco `) : (` do estado carregado)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts`

**Interfaces:**
- Consumes: as variáveis já calculadas (`receita`, `taxasCartao`, `liquidoAposTaxas`, `comissoes`, `gastos`, `lucro`, `taxasCancelamentoPagas`, `taxasReservaPagas`, `dReceita`, `dComissoes`, `dGastos`).
- Produces: nada.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('B2 — grid único de KPIs no Financeiro', () => {
  const src = read('app/(app)/financeiro/page.tsx');
  it('há um único array de KPIs (kpisFinanceiro) em vez de duas linhas separadas', () => {
    expect(src).toContain('const kpisFinanceiro = [');
  });
  it('o último card ocupa a linha inteira no mobile quando a contagem é ímpar', () => {
    expect(src).toContain('col-span-2 lg:col-span-1');
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "B2"`
Expected: FAIL.

- [ ] **Step 3: Unir as duas linhas num grid só**

Em `web/app/(app)/financeiro/page.tsx`, substituir o bloco do estado carregado (o `) : (` que hoje tem `<div className="flex flex-col gap-3 mb-6">` com **dois** `<div className="grid grid-cols-2 lg:grid-cols-3 ...">`) por:

```tsx
      ) : (() => {
        // Grade única de KPIs — evita a 4ª célula órfã que sobrava quando a
        // primeira linha tinha 3 itens num grid de 2 colunas (anexo 7).
        const kpisFinanceiro = [
          { label: 'Faturamento Bruto',   value: receita,          d: dReceita,   cor: 'text-green',   invertDelta: false },
          { label: 'Taxas de Cartão',     value: taxasCartao,      d: null,       cor: 'text-rose',    invertDelta: false },
          { label: 'Líquido após Taxas',  value: liquidoAposTaxas, d: null,       cor: 'text-primary', invertDelta: false },
          { label: 'Comissões',           value: comissoes,        d: dComissoes, cor: 'text-amber',   invertDelta: true  },
          { label: 'Gastos Operacionais', value: gastos,           d: dGastos,    cor: 'text-rose',    invertDelta: true  },
          { label: 'Lucro Real',          value: lucro,            d: null,       cor: lucro >= 0 ? 'text-primary' : 'text-red', invertDelta: false },
          ...(taxasCancelamentoPagas > 0
            ? [{ label: 'Taxas de Cancelamento', value: taxasCancelamentoPagas, d: null, cor: 'text-rose', invertDelta: false }]
            : []),
          ...(taxasReservaPagas > 0
            ? [{ label: 'Taxas de Reserva', value: taxasReservaPagas, d: null, cor: 'text-accent', invertDelta: false }]
            : []),
        ];
        return (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
          {kpisFinanceiro.map(({ label, value, d, cor, invertDelta }, i, arr) => (
            <div key={label}
              className={`bg-surface border border-border rounded-2xl p-3 sm:p-5 shadow-sm min-w-0 ${
                i === arr.length - 1 && arr.length % 2 === 1 ? 'col-span-2 lg:col-span-1' : ''
              }`}>
              <p className="text-[10px] sm:text-xs text-text-4 uppercase tracking-wide font-semibold mb-1.5 sm:mb-2 truncate">{label}</p>
              <p className={`text-lg sm:text-2xl font-bold leading-none mb-1.5 sm:mb-2 whitespace-nowrap tabular-nums ${cor}`}><Secret>{fmtBRL(value)}</Secret></p>
              {d !== null && (
                <div className="flex items-center gap-1 min-w-0">
                  {(invertDelta ? d < 0 : d >= 0)
                    ? <TrendingUp  size={11} className="text-green flex-shrink-0" strokeWidth={2.5}/>
                    : <TrendingDown size={11} className="text-red flex-shrink-0"  strokeWidth={2.5}/>
                  }
                  <span className={`text-[10px] sm:text-xs font-bold truncate ${(invertDelta ? d < 0 : d >= 0) ? 'text-green' : 'text-red'}`}>
                    <Secret>{d >= 0 ? '+' : ''}{d}%</Secret> vs mês anterior
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        );
      })()}
```

Garantir que o `loading` acima (o ternário `{loading ? (...) : (...)}`) continua bem formado — o `) : (` original vira `) : (() => { ... return (...); })()`.

- [ ] **Step 4: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "B2" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 5: Verificação no navegador (obrigatória)**

`preview_start`. `/financeiro`. `resize_window` 375px → confirmar (screenshot + `read_page`) que **não há célula vazia** — os cards preenchem 2 colunas e o último, se sobrar ímpar, ocupa a largura toda. `resize_window` 1280px → grade de 3 colunas intacta.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/financeiro/page.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(financeiro): grade única de KPIs elimina célula vazia no mobile"
```

---

## Task 9: B1/B2 (mobile) — Skeleton e grid de KPIs de Financeiro no Expo

**Files:**
- Modify: `mobile/app/(empresa)/financeiro.tsx` — bloco de skeleton (`SkeletonFinanceiro` / estado `loading`) e a linha de KPIs (~L1517, `flexDirection: 'row', gap: 8` com `.map`)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts` (asserção de fonte)

**Interfaces:**
- Consumes: `resumo` do `useFinanceiro`.
- Produces: nada.

- [ ] **Step 1: Baseline do mobile**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`
Anotar baseline.

- [ ] **Step 2: Ler o layout real dos KPIs**

Ler `mobile/app/(empresa)/financeiro.tsx` em volta de L1517-1560 (o `.map` que renderiza os cards de KPI) e o skeleton correspondente. Identificar: quantos KPIs são renderizados, se o container é `flexDirection: 'row'` com largura fixa por card (`width: '48%'` etc.) e se sobra buraco quando ímpar.

- [ ] **Step 3: Teste de fonte (falha)**

```ts
describe('B1/B2 mobile — KPIs de Financeiro', () => {
  const src = read('../mobile/app/(empresa)/financeiro.tsx');
  it('último KPI ocupa a linha inteira quando a contagem é ímpar', () => {
    expect(src).toContain("width: kpisFin.length % 2 === 1 && i === kpisFin.length - 1 ? '100%' : '48%'");
  });
});
```

- [ ] **Step 4: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "B1/B2 mobile"`
Expected: FAIL.

- [ ] **Step 5: Implementar**

No `mobile/app/(empresa)/financeiro.tsx`:
- Extrair a lista de KPIs para uma const `kpisFin` (array de `{ label, value, delta, cor }`) imediatamente antes do `.map`.
- No `style` de cada card, calcular a largura: `width: kpisFin.length % 2 === 1 && i === kpisFin.length - 1 ? '100%' : '48%'` (o container já é `flexDirection: 'row', flexWrap: 'wrap', gap`). Passar `i` no `.map((kpi, i) => ...)`.
- No skeleton (`loading`), replicar a mesma contagem/formato de cards (mesmo `width` e `flexWrap`), removendo qualquer layout empilhado que não corresponda.

- [ ] **Step 6: Teste + tsc mobile**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "B1/B2 mobile"`
Expected: PASS.
Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`
Expected: baseline **idêntica**.

- [ ] **Step 7: Commit**

```bash
git add "mobile/app/(empresa)/financeiro.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(mobile/financeiro): KPIs sem buraco e skeleton alinhado ao layout real"
```

---

## Task 10: C1 — Corrige o gráfico "Evolução de faturamento" (barras não escalavam)

**Files:**
- Modify: `web/app/(app)/relatorios/page.tsx` — `ChartBar` (~L294-316) e o container (~L1111)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts`

**Interfaces:**
- Consumes: `serieGrafico: { label; valor }[]`, `maxGrafico: number`.
- Produces: nada. `ChartBar` mantém a assinatura `{ label: string; value: number; maxValue: number }`.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('C1 — ChartBar com altura resolvível', () => {
  const src = read('app/(app)/relatorios/page.tsx');
  it('ChartBar raiz estica na altura do container (self-stretch/h-full)', () => {
    expect(src).toMatch(/function ChartBar[\s\S]{0,220}(self-stretch|h-full)/);
  });
  it('container das barras usa items-stretch, não items-end', () => {
    // as duas ocorrências do gráfico real (não o skeleton) passam a items-stretch
    expect(src).toContain('flex items-stretch gap-2');
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "C1"`
Expected: FAIL.

- [ ] **Step 3: Corrigir `ChartBar` e o container**

Causa: `height: ${heightPct}%` era resolvido contra um wrapper sem altura definida (o container usava `items-end`, que não estica os filhos). Correção — dar altura à cadeia:

`ChartBar` (~L294-316), trocar por:

```tsx
/** Barra vertical para o gráfico de evolução de faturamento */
function ChartBar({ label, value, maxValue }: { label: string; value: number; maxValue: number }) {
  const heightPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="flex-1 self-stretch flex flex-col items-center gap-1 min-w-0">
      {value > 0 && (
        <span className="text-[9px] text-text-3 truncate w-full text-center">
          <Secret>{fmtBRL(value)}</Secret>
        </span>
      )}
      <div className="flex-1 min-h-0 flex flex-col justify-end w-full">
        <div className="w-full rounded-t-md transition-all duration-500"
          style={{
            height: `${heightPct}%`,
            minHeight: value > 0 ? 4 : 0,
            background: 'linear-gradient(to top, #7C3AED, #A855F7)',
          }}
        />
      </div>
      <span className="text-[10px] text-text-3 truncate w-full text-center">{label}</span>
    </div>
  );
}
```

Container do gráfico **real** (o `{serieGrafico.map(...)}`, ~L1111) — trocar `flex items-end gap-2` por `flex items-stretch gap-2`:

```tsx
              <div className="flex items-stretch gap-2" style={{ height: 140 }}>
                {serieGrafico.map((s, i) => (
                  <ChartBar key={i} label={s.label} value={s.valor} maxValue={maxGrafico} />
                ))}
              </div>
```

**Não** mexer no bloco `loading` do gráfico (~L1103, os `Sk` diretos) — lá o `%` já resolve. **Não** mexer no skeleton de `financeiro/loading.tsx`.

- [ ] **Step 4: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "C1" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 5: Verificação no navegador (obrigatória)**

`preview_start`. `/relatorios`, aba Financeiro. Escolher um período com valores bem diferentes entre meses (ex.: jul/ago altos, set baixo). `read_page`/screenshot + medir via `javascript_tool`:
```js
[...document.querySelectorAll('h2')].find(h=>h.textContent.includes('Evolução de faturamento'))
  .closest('.rounded-2xl').querySelectorAll('.rounded-t-md')
  ? [...document.querySelectorAll('.rounded-t-md')].map(b=>b.getBoundingClientRect().height)
  : 'n/a'
```
Expected: alturas **proporcionais** aos valores (a barra do mês de ~R$930 ≈ 10% da altura da barra de ~R$9.600), não todas iguais a ~4px.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/relatorios/page.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(relatorios): barras de Evolução de faturamento voltam a escalar pelo valor"
```

---

## Task 11: C2 + C3 — Cor da comissão neutra e remoção do "Funil de atendimentos"

**Files:**
- Modify: `web/app/(app)/relatorios/page.tsx` — aba Equipe (~L1312, ~L1324) e bloco do Funil (~L1204-1227)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts`

**Interfaces:**
- Consumes: nada. Produces: nada.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('C2/C3 — comissão neutra + sem Funil', () => {
  const src = read('app/(app)/relatorios/page.tsx');
  it('comissão do profissional não usa mais text-pink-500', () => {
    expect(src).not.toContain('text-pink-500');
  });
  it('o card "Funil de atendimentos" foi removido', () => {
    expect(src).not.toContain('Funil de atendimentos');
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "C2/C3"`
Expected: FAIL.

- [ ] **Step 3: C2 — cor neutra**

Em `web/app/(app)/relatorios/page.tsx`:
- ~L1311-1315, trocar:
```tsx
                      {prof.comissao > 0 && (
                        <span className="text-xs font-semibold text-pink-500">
                          Comissão: {fmtBRL(prof.comissao)}
                        </span>
                      )}
```
por:
```tsx
                      {prof.comissao > 0 && (
                        <span className="text-xs font-semibold text-text-2">
                          Comissão: {fmtBRL(prof.comissao)}
                        </span>
                      )}
```
- ~L1321-1326, trocar:
```tsx
              {comTot > 0 && (
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-text-3">Total comissões no período</span>
                  <span className="text-sm font-bold text-pink-500"><Secret>{fmtBRL(comTot)}</Secret></span>
                </div>
              )}
```
por:
```tsx
              {comTot > 0 && (
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-text-3">Total comissões no período</span>
                  <span className="text-sm font-bold text-text"><Secret>{fmtBRL(comTot)}</Secret></span>
                </div>
              )}
```

- [ ] **Step 4: C3 — remover o Funil**

Remover **todo** o bloco `{/* Funil de atendimentos */}` (o `{!loading && (<div className="bg-surface ... "><h2 ...>Funil de atendimentos</h2> ... </div>)}`, ~L1204-1227), dentro de `{aba === 'financeiro' && (...)}`. Conferir que `concluidos`, `cancelados`, `faltaram` continuam usados em outro lugar (KPIs no topo) — não remover esses cálculos.

- [ ] **Step 5: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "C2/C3" && npx tsc --noEmit`
Expected: PASS + zero erros (atenção a variável não usada — se `ags`/`faltaram` ficar órfã, o `tsc` acusa; nesse caso manter só o que ainda é referenciado).

- [ ] **Step 6: Verificação no navegador**

`preview_start`. `/relatorios` aba Financeiro → sem card "Funil de atendimentos". Aba Equipe → "Comissão: …" e "Total comissões no período" em cor neutra (não rosa). Screenshot.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/relatorios/page.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(relatorios): comissão em cor neutra e remove card Funil redundante"
```

---

## Task 12: C1/C2/C3 (mobile) — Relatórios no Expo

**Files:**
- Modify: `mobile/app/(empresa)/relatorios.tsx` — gráfico de evolução, aba Equipe (cor da comissão), bloco do Funil
- Test: `web/tests/unit/ui-lote-2026-09.test.ts` (asserções de fonte)

**Interfaces:**
- Consumes: dados do `useRelatorios`.
- Produces: nada.

- [ ] **Step 1: Baseline do mobile**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 2: Ler o gráfico + Funil + comissão no mobile**

Ler `mobile/app/(empresa)/relatorios.tsx`: localizar (a) o gráfico "Evolução de faturamento" e como calcula a altura das barras (RN usa `height` numérico, não `%` — pode não ter o mesmo bug; **só corrigir se as barras realmente não escalarem**: se a altura for `valor / max * alturaMax` já está certo e essa parte é no-op), (b) a cor da comissão na aba Equipe (`C.rose`/`#D4608A`), (c) o bloco "Funil de atendimentos".

- [ ] **Step 3: Teste de fonte (falha)**

```ts
describe('C2/C3 mobile — Relatórios', () => {
  const src = read('../mobile/app/(empresa)/relatorios.tsx');
  it('sem card Funil de atendimentos', () => {
    expect(src).not.toContain('Funil de atendimentos');
  });
  it('comissão da equipe não usa a cor rose/de alerta', () => {
    expect(src).toContain('// comissão em cor neutra');
  });
});
```

- [ ] **Step 4: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "C2/C3 mobile"`
Expected: FAIL.

- [ ] **Step 5: Implementar**

Em `mobile/app/(empresa)/relatorios.tsx`:
- **C3:** remover o bloco/`View` do "Funil de atendimentos" inteiro.
- **C2:** trocar a cor do texto de comissão do profissional e do total de comissões de `C.rose`/`#D4608A` para `C.text2`/`C.text`; adicionar o comentário `// comissão em cor neutra` na linha do estilo.
- **C1:** só se o gráfico realmente não escalar — ajustar o cálculo de altura da barra para `Math.round((valor / Math.max(max, 1)) * ALTURA_MAX)` com `ALTURA_MAX` fixo (ex.: 120). Se já estiver correto, registrar no commit que C1 no mobile era no-op.

- [ ] **Step 6: Teste + tsc mobile**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "C2/C3 mobile"`
Expected: PASS.
Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`
Expected: baseline **idêntica**.

- [ ] **Step 7: Commit**

```bash
git add "mobile/app/(empresa)/relatorios.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(mobile/relatorios): comissão neutra, remove Funil e confere escala do gráfico"
```

---

## Task 13: D — Menu inferior: Comanda no lugar de Financeiro (web)

**Files:**
- Modify: `web/components/Sidebar.tsx` — `MOBILE_NAV` (~L43-49) e `MAIS_NAV` (~L52-63)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts`

**Interfaces:**
- Consumes: `Receipt`, `DollarSign` de `lucide-react` (ambos já importados no arquivo).
- Produces: nada.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('D — menu inferior troca Financeiro por Comanda', () => {
  const src = read('components/Sidebar.tsx');
  it('MOBILE_NAV tem /comanda e não tem /financeiro', () => {
    const bloco = src.split('const MOBILE_NAV')[1].split('];')[0];
    expect(bloco).toContain("href: '/comanda'");
    expect(bloco).not.toContain("href: '/financeiro'");
  });
  it('MAIS_NAV tem /financeiro e não tem /comanda', () => {
    const bloco = src.split('const MAIS_NAV')[1].split('];')[0];
    expect(bloco).toContain("href: '/financeiro'");
    expect(bloco).not.toContain("href: '/comanda'");
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "D —"`
Expected: FAIL.

- [ ] **Step 3: Editar `MOBILE_NAV`**

```tsx
const MOBILE_NAV: { href: string; label: string; icon: React.ElementType; permissao?: Permissao }[] = [
  { href: '/dashboard',  label: 'Início',   icon: LayoutDashboard, permissao: 'ver_resumo_financeiro' },
  { href: '/agenda',     label: 'Agenda',   icon: CalendarDays    },
  { href: '/clientes',   label: 'Clientes', icon: Users           },
  { href: '/comanda',    label: 'Comanda',  icon: Receipt         },
  { href: '/mais',       label: 'Mais',     icon: MoreHorizontal  },
];
```

- [ ] **Step 4: Editar `MAIS_NAV`**

Remover a linha `{ href: '/comanda', ... }` do topo e adicionar `/financeiro` logo no início:

```tsx
const MAIS_NAV: { href: string; label: string; icon: React.ElementType; permissao?: Permissao }[] = [
  { href: '/financeiro',   label: 'Financeiro',    icon: DollarSign,   permissao: 'ver_resumo_financeiro' },
  { href: '/vendas',       label: 'Vendas',        icon: ShoppingCart, permissao: 'gerenciar_vendas'        },
  { href: '/servicos',     label: 'Serviços',      icon: Scissors,     permissao: 'gerenciar_servicos'     },
  { href: '/pacotes',      label: 'Pacotes',       icon: Gift         },
  { href: '/equipe',       label: 'Equipe',        icon: UserCog,      permissao: 'gerenciar_profissionais' },
  { href: '/comissoes',    label: 'Comissões',     icon: Banknote,     permissao: 'ver_propria_comissao'   },
  { href: '/estoque',      label: 'Estoque',       icon: Package,      permissao: 'gerenciar_estoque'      },
  { href: '/relatorios',   label: 'Relatórios',    icon: BarChart2,    permissao: 'ver_resumo_financeiro'  },
  { href: '/notificacoes', label: 'Notificações',  icon: Bell         },
  { href: '/configuracoes',label: 'Configurações', icon: Settings,     permissao: 'configurar_empresa'     },
];
```

Conferir se o comentário `// Financeiro some do bottom nav quando restrito` acima do `MOBILE_NAV` ainda faz sentido — ajustar para `// Comanda no bottom nav; Financeiro fica em "Mais" e some de lá quando restrito`.

- [ ] **Step 5: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "D —" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 6: Verificação no navegador**

`preview_start`. `resize_window` 375px. Confirmar que o menu inferior mostra **Comanda** (não Financeiro) e que abrir "Mais" lista **Financeiro**. Navegar em ambos e conferir que carregam. Screenshot do menu.

- [ ] **Step 7: Commit**

```bash
git add web/components/Sidebar.tsx web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "feat(nav): menu inferior mobile troca Financeiro por Comanda"
```

---

## Task 14: E1 — Migration 066 (colunas de rastreio de lembrete)

**Files:**
- Create: `supabase/migrations/066_agendamento_lembretes.sql`
- Create/Modify: `web/tests/unit/lembretes-migrations.test.ts`

**Interfaces:**
- Produces: colunas `agendamentos.lembrete_vespera_em timestamptz` e `agendamentos.lembrete_30min_em timestamptz`, ambas nulas.

- [ ] **Step 1: Escrever o teste da migration (falha)**

Criar `web/tests/unit/lembretes-migrations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = join(process.cwd(), '..', 'supabase', 'migrations');
const all = readdirSync(dir).filter(f => f.endsWith('.sql'))
  .map(f => readFileSync(join(dir, f), 'utf8').toLowerCase()).join('\n---\n');

describe('Migration 066 — colunas de lembrete em agendamentos', () => {
  it('adiciona lembrete_vespera_em e lembrete_30min_em', () => {
    expect(all).toMatch(/alter table public\.agendamentos\s+add column if not exists lembrete_vespera_em timestamptz/);
    expect(all).toMatch(/add column if not exists lembrete_30min_em\s+timestamptz/);
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/lembretes-migrations.test.ts -t "066"`
Expected: FAIL.

- [ ] **Step 3: Criar `supabase/migrations/066_agendamento_lembretes.sql`**

```sql
-- ============================================================
-- 066 — Rastreio de lembretes de atendimento
-- ============================================================
-- Duas colunas de marca-tempo em agendamentos. O cron de lembretes
-- (/api/cron/lembretes) roda a cada 5 min e usa estas colunas como
-- ledger de idempotência: preenche ao enviar o push e nunca reenvia.
--
-- Nulas por padrão. Sem policy nova — a cobertura de RLS de
-- agendamentos já vale para colunas novas, e o cron usa service_role.
--
-- Rollback:
--   alter table public.agendamentos
--     drop column if exists lembrete_vespera_em,
--     drop column if exists lembrete_30min_em;

alter table public.agendamentos
  add column if not exists lembrete_vespera_em timestamptz,
  add column if not exists lembrete_30min_em   timestamptz;
```

- [ ] **Step 4: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/lembretes-migrations.test.ts -t "066" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/066_agendamento_lembretes.sql web/tests/unit/lembretes-migrations.test.ts
git commit -m "feat(lembretes): migration 066 — colunas de rastreio em agendamentos"
```

---

## Task 15: E2 — Funções puras de lembrete (`shared/lembretes.ts`)

**Files:**
- Create: `shared/lembretes.ts`
- Create: `web/tests/unit/lembretes.test.ts`

**Interfaces:**
- Produces (exportado de `@shared/lembretes`):
  - `type AgLembrete = { id: string; profissional_id: string; data_hora_inicio: string; cliente_nome: string | null; servico_nome: string | null; lembrete_vespera_em: string | null; lembrete_30min_em: string | null }`
  - `function ehHoraDaVespera(agora: Date): boolean`
  - `function selecionar30min(ags: AgLembrete[], agora: Date): AgLembrete[]`
  - `function selecionarVespera(ags: AgLembrete[]): AgLembrete[]`
  - `function corpo30min(ag: AgLembrete): string`
  - `function resumosVespera(ags: AgLembrete[]): { profissionalId: string; corpo: string }[]`
  - `function destinatarios(profissionalIdDoAg: string, membros: { user_id: string; role: string }[]): string[]`

- [ ] **Step 1: Escrever os testes (falha)**

Criar `web/tests/unit/lembretes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ehHoraDaVespera, selecionar30min, selecionarVespera,
  corpo30min, resumosVespera, destinatarios, type AgLembrete,
} from '@shared/lembretes';

const base: AgLembrete = {
  id: 'a1', profissional_id: 'p1', data_hora_inicio: '2026-09-04T17:30:00-03:00',
  cliente_nome: 'Lazara', servico_nome: 'Design com tintura',
  lembrete_vespera_em: null, lembrete_30min_em: null,
};

describe('ehHoraDaVespera (America/Sao_Paulo, corte 18:00)', () => {
  it('true às 18:30 de SP', () => {
    expect(ehHoraDaVespera(new Date('2026-09-03T21:30:00Z'))).toBe(true); // 18:30 -03
  });
  it('false às 17:30 de SP', () => {
    expect(ehHoraDaVespera(new Date('2026-09-03T20:30:00Z'))).toBe(false); // 17:30 -03
  });
});

describe('selecionar30min', () => {
  const agora = new Date('2026-09-04T17:05:00-03:00');
  it('inclui atendimento que começa em 25 min e ainda não avisado', () => {
    expect(selecionar30min([base], agora).map(a => a.id)).toEqual(['a1']);
  });
  it('exclui quem já tem lembrete_30min_em', () => {
    expect(selecionar30min([{ ...base, lembrete_30min_em: '2026-09-04T16:00:00-03:00' }], agora)).toEqual([]);
  });
  it('exclui quem começa daqui a 2 h', () => {
    expect(selecionar30min([{ ...base, data_hora_inicio: '2026-09-04T19:05:00-03:00' }], agora)).toEqual([]);
  });
  it('exclui quem já começou', () => {
    expect(selecionar30min([{ ...base, data_hora_inicio: '2026-09-04T16:50:00-03:00' }], agora)).toEqual([]);
  });
});

describe('selecionarVespera', () => {
  it('filtra os que já têm véspera enviada', () => {
    const b2 = { ...base, id: 'a2', lembrete_vespera_em: '2026-09-03T18:00:00-03:00' };
    expect(selecionarVespera([base, b2]).map(a => a.id)).toEqual(['a1']);
  });
});

describe('corpo30min', () => {
  it('formata "Em 30 min: <cliente> — <serviço> · HH:mm"', () => {
    expect(corpo30min(base)).toBe('Em 30 min: Lazara — Design com tintura · 17:30');
  });
});

describe('resumosVespera', () => {
  it('1 resumo por profissional, com contagem e 1º horário', () => {
    const ags: AgLembrete[] = [
      { ...base, id: 'x1', profissional_id: 'p1', data_hora_inicio: '2026-09-04T09:00:00-03:00', cliente_nome: 'Ana' },
      { ...base, id: 'x2', profissional_id: 'p1', data_hora_inicio: '2026-09-04T14:00:00-03:00', cliente_nome: 'Bia' },
      { ...base, id: 'x3', profissional_id: 'p2', data_hora_inicio: '2026-09-04T10:00:00-03:00', cliente_nome: 'Cida' },
    ];
    const r = resumosVespera(ags);
    expect(r).toEqual([
      { profissionalId: 'p1', corpo: 'Amanhã: 2 atendimentos · 1º às 09:00 — Ana' },
      { profissionalId: 'p2', corpo: 'Amanhã: 1 atendimento · 1º às 10:00 — Cida' },
    ]);
  });
});

describe('destinatarios', () => {
  it('profissional do ag + owners/gestores, sem duplicar', () => {
    const membros = [
      { user_id: 'p1', role: 'profissional' },
      { user_id: 'owner1', role: 'owner' },
      { user_id: 'g1', role: 'gestor' },
      { user_id: 'p2', role: 'profissional' },
    ];
    expect(destinatarios('p1', membros).sort()).toEqual(['g1', 'owner1', 'p1'].sort());
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/lembretes.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `shared/lembretes.ts`**

```ts
/**
 * @file shared/lembretes.ts
 * Funções puras do motor de lembretes de atendimento. Sem I/O — o chamador
 * (a rota /api/cron/lembretes) faz as queries e os envios de push.
 *
 * Cadência: 1 resumo na véspera (a partir das 18:00, fuso America/Sao_Paulo)
 * + 1 push individual 30 min antes de cada atendimento.
 */

export type AgLembrete = {
  id: string;
  profissional_id: string;
  /** ISO com offset — ex.: "2026-09-04T17:30:00-03:00" */
  data_hora_inicio: string;
  cliente_nome: string | null;
  servico_nome: string | null;
  lembrete_vespera_em: string | null;
  lembrete_30min_em: string | null;
};

/** Hora local (0–23) em America/Sao_Paulo para um instante qualquer. */
function horaSaoPaulo(agora: Date): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false,
  }).format(agora);
  // "24" aparece em alguns motores para meia-noite; normaliza para 0.
  const h = parseInt(s, 10);
  return h === 24 ? 0 : h;
}

/** HH:mm de um ISO com offset, sem depender de timezone da máquina. */
function hhmm(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '--:--';
}

/** true quando já passou das 18:00 no fuso de São Paulo — hora de mandar a véspera. */
export function ehHoraDaVespera(agora: Date): boolean {
  return horaSaoPaulo(agora) >= 18;
}

/**
 * Atendimentos que devem receber o push de "30 min antes" agora:
 * começam na janela [agora, agora + 35 min] e ainda não foram avisados.
 * A janela de 35 min cobre o intervalo de 5 min do cron com folga.
 */
export function selecionar30min(ags: AgLembrete[], agora: Date): AgLembrete[] {
  const ini = agora.getTime();
  const fim = ini + 35 * 60_000;
  return ags.filter(a => {
    if (a.lembrete_30min_em) return false;
    const t = new Date(a.data_hora_inicio).getTime();
    return t >= ini && t <= fim;
  });
}

/** Dos agendamentos de amanhã (o chamador já filtrou por data), os sem véspera enviada. */
export function selecionarVespera(ags: AgLembrete[]): AgLembrete[] {
  return ags.filter(a => !a.lembrete_vespera_em);
}

/** Corpo do push individual de 30 min. */
export function corpo30min(ag: AgLembrete): string {
  const serv = ag.servico_nome ?? 'Atendimento';
  const cli = ag.cliente_nome ?? 'Cliente';
  return `Em 30 min: ${cli} — ${serv} · ${hhmm(ag.data_hora_inicio)}`;
}

/**
 * Um resumo de véspera por profissional que tem atendimento amanhã.
 * Ordena por horário; o corpo cita a contagem e o 1º atendimento.
 * A ordem dos profissionais segue a 1ª aparição no array de entrada.
 */
export function resumosVespera(ags: AgLembrete[]): { profissionalId: string; corpo: string }[] {
  const porProf = new Map<string, AgLembrete[]>();
  for (const a of ags) {
    const arr = porProf.get(a.profissional_id) ?? [];
    arr.push(a);
    porProf.set(a.profissional_id, arr);
  }
  const out: { profissionalId: string; corpo: string }[] = [];
  for (const [profissionalId, lista] of porProf) {
    const ordenada = [...lista].sort((x, y) => x.data_hora_inicio.localeCompare(y.data_hora_inicio));
    const n = ordenada.length;
    const primeiro = ordenada[0];
    const plural = n === 1 ? 'atendimento' : 'atendimentos';
    out.push({
      profissionalId,
      corpo: `Amanhã: ${n} ${plural} · 1º às ${hhmm(primeiro.data_hora_inicio)} — ${primeiro.cliente_nome ?? 'Cliente'}`,
    });
  }
  return out;
}

/** IDs de usuário que recebem o push de um agendamento: o profissional + owners/gestores. */
export function destinatarios(
  profissionalIdDoAg: string,
  membros: { user_id: string; role: string }[],
): string[] {
  const set = new Set<string>([profissionalIdDoAg]);
  for (const m of membros) {
    if (m.role === 'owner' || m.role === 'gestor') set.add(m.user_id);
  }
  return [...set];
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd web && npx vitest run tests/unit/lembretes.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: `tsc` (web e — como `shared` é compartilhado — mobile)**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.
Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`
Expected: baseline inalterada (o novo arquivo `shared/` não deve introduzir erro).

- [ ] **Step 6: Commit**

```bash
git add shared/lembretes.ts web/tests/unit/lembretes.test.ts
git commit -m "feat(lembretes): funções puras de janela, resumo de véspera e destinatários"
```

---

## Task 16: E2 — Reescreve `/api/cron/lembretes` como motor por atendimento

**Files:**
- Rewrite: `web/app/api/cron/lembretes/route.ts`
- Test: `web/tests/unit/ui-lote-2026-09.test.ts` (asserção de fonte da rota)

**Interfaces:**
- Consumes: `@shared/lembretes` (`AgLembrete`, `ehHoraDaVespera`, `selecionar30min`, `selecionarVespera`, `corpo30min`, `resumosVespera`, `destinatarios`).
- Produces: comportamento novo da rota `GET /api/cron/lembretes` (auth `Bearer CRON_SECRET` mantida).

- [ ] **Step 1: Teste de fonte da rota (falha)**

Em `web/tests/unit/ui-lote-2026-09.test.ts`:

```ts
describe('E2 — rota de lembretes usa as funções puras', () => {
  const src = read('app/api/cron/lembretes/route.ts');
  it('importa de @shared/lembretes', () => {
    expect(src).toContain("from '@shared/lembretes'");
  });
  it('marca as colunas de rastreio após enviar', () => {
    expect(src).toContain('lembrete_30min_em');
    expect(src).toContain('lembrete_vespera_em');
  });
  it('grava linha em notificacoes tipo agendamento', () => {
    expect(src).toMatch(/from\('notificacoes'\)[\s\S]{0,120}insert/);
    expect(src).toContain("tipo: 'agendamento'");
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "E2 —"`
Expected: FAIL.

- [ ] **Step 3: Reescrever `web/app/api/cron/lembretes/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import {
  ehHoraDaVespera, selecionar30min, selecionarVespera,
  corpo30min, resumosVespera, destinatarios, type AgLembrete,
} from '@shared/lembretes';

export const dynamic = 'force-dynamic';

/**
 * Motor de lembretes de atendimento. Chamado a cada ~5 min pelo pg_cron
 * (migration 067). Idempotente: usa agendamentos.lembrete_vespera_em /
 * lembrete_30min_em como ledger para nunca reenviar.
 *
 * - Véspera: a partir das 18:00 (America/Sao_Paulo), 1 push-resumo por
 *   profissional com atendimento amanhã.
 * - 30 min antes: 1 push individual por atendimento.
 * Cada envio também grava uma linha em notificacoes (tipo 'agendamento').
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const agora = new Date();

  // Janela "amanhã" e "hoje" em America/Sao_Paulo, como YYYY-MM-DD.
  const fmtDia = (d: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const hojeStr   = fmtDia(agora);
  const amanhaStr = fmtDia(new Date(agora.getTime() + 24 * 3600_000));

  const { data: empresas } = await db.from('empresas').select('id').eq('ativo', true);

  let enviados = 0;

  // Colunas comuns das queries de agendamento
  const SEL = `id, profissional_id, data_hora_inicio, lembrete_vespera_em, lembrete_30min_em,
    cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)`;

  const mapAg = (r: any): AgLembrete => ({
    id: r.id,
    profissional_id: r.profissional_id,
    data_hora_inicio: r.data_hora_inicio,
    cliente_nome: r.cliente?.nome ?? null,
    servico_nome: r.servico?.nome ?? null,
    lembrete_vespera_em: r.lembrete_vespera_em,
    lembrete_30min_em: r.lembrete_30min_em,
  });

  for (const empresa of empresas ?? []) {
    const empId = empresa.id;

    const [{ data: membros }, { data: subs }] = await Promise.all([
      db.from('empresa_membros').select('user_id, role').eq('empresa_id', empId).eq('ativo', true),
      db.from('web_push_subscriptions').select('user_id, endpoint, p256dh, auth').eq('empresa_id', empId),
    ]);
    const subsPorUser = new Map<string, typeof subs>();
    for (const s of subs ?? []) {
      const arr = subsPorUser.get(s.user_id) ?? [];
      arr.push(s);
      subsPorUser.set(s.user_id, arr as any);
    }

    async function enviar(userIds: string[], titulo: string, body: string, empresaId: string) {
      const vistos = new Set<string>();
      for (const uid of userIds) {
        for (const sub of subsPorUser.get(uid) ?? []) {
          if (vistos.has(sub.endpoint)) continue;
          vistos.add(sub.endpoint);
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: titulo, body, url: '/agenda' }),
            );
            enviados++;
          } catch {
            await db.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
        }
        // Histórico na central de notificações
        await db.from('notificacoes').insert({
          user_id: uid, empresa_id: empresaId, tipo: 'agendamento',
          titulo, mensagem: body,
        });
      }
    }

    // ── 30 min antes ────────────────────────────────────────────
    const { data: agsHoje } = await db.from('agendamentos')
      .select(SEL)
      .eq('empresa_id', empId)
      .gte('data_hora_inicio', `${hojeStr}T00:00:00-03:00`)
      .lte('data_hora_inicio', `${hojeStr}T23:59:59-03:00`)
      .in('status', ['agendado', 'confirmado']);

    for (const ag of selecionar30min((agsHoje ?? []).map(mapAg), agora)) {
      await enviar(destinatarios(ag.profissional_id, membros ?? []), 'Lembrete de atendimento', corpo30min(ag), empId);
      await db.from('agendamentos').update({ lembrete_30min_em: agora.toISOString() }).eq('id', ag.id);
    }

    // ── Véspera (a partir das 18:00) ────────────────────────────
    if (ehHoraDaVespera(agora)) {
      const { data: agsAmanha } = await db.from('agendamentos')
        .select(SEL)
        .eq('empresa_id', empId)
        .gte('data_hora_inicio', `${amanhaStr}T00:00:00-03:00`)
        .lte('data_hora_inicio', `${amanhaStr}T23:59:59-03:00`)
        .in('status', ['agendado', 'confirmado']);

      const pendentes = selecionarVespera((agsAmanha ?? []).map(mapAg));
      if (pendentes.length > 0) {
        for (const { profissionalId, corpo } of resumosVespera(pendentes)) {
          await enviar(destinatarios(profissionalId, membros ?? []), 'Atendimentos de amanhã', corpo, empId);
        }
        await db.from('agendamentos')
          .update({ lembrete_vespera_em: agora.toISOString() })
          .in('id', pendentes.map(a => a.id));
      }
    }
  }

  return NextResponse.json({ ok: true, enviados });
}
```

- [ ] **Step 4: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "E2 —" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 5: Sanidade local da rota (opcional, sem push real)**

Rodar o dev server e chamar a rota com o segredo (sem VAPID configurado ela retorna erro no `sendNotification`, mas a árvore de queries roda). Ou apenas confiar no `tsc` + teste de fonte. Registrar no commit que o envio real só é validável em produção com VAPID + assinaturas.

- [ ] **Step 6: Commit**

```bash
git add web/app/api/cron/lembretes/route.ts web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "feat(lembretes): rota /api/cron/lembretes vira motor de push por atendimento"
```

---

## Task 17: E3 — Migration 067 (pg_cron a cada 5 min) + remove cron do vercel.json

**Files:**
- Create: `supabase/migrations/067_cron_lembretes_pg_cron.sql`
- Modify: `web/vercel.json`
- Test: `web/tests/unit/lembretes-migrations.test.ts`

**Interfaces:**
- Produces: job `pg_cron` `lembretes-atendimento` (`*/5 * * * *`) chamando `<APP_URL>/api/cron/lembretes`.

- [ ] **Step 1: Adicionar teste (falha)**

```ts
describe('Migration 067 — agendador pg_cron', () => {
  it('cria as extensões e agenda o job a cada 5 min', () => {
    expect(all).toContain('create extension if not exists pg_cron');
    expect(all).toContain('create extension if not exists pg_net');
    expect(all).toMatch(/cron\.schedule\(\s*'lembretes-atendimento',\s*'\*\/5 \* \* \* \*'/);
    expect(all).toContain('/api/cron/lembretes');
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/lembretes-migrations.test.ts -t "067"`
Expected: FAIL.

- [ ] **Step 3: Criar `supabase/migrations/067_cron_lembretes_pg_cron.sql`**

```sql
-- ============================================================
-- 067 — Agendador dos lembretes de atendimento (pg_cron + pg_net)
-- ============================================================
-- Chama GET <APP_URL>/api/cron/lembretes a cada 5 minutos. A rota é
-- idempotente (ver migration 066). Substitua os DOIS placeholders antes
-- de aplicar:
--   <APP_URL>      → origem pública do app web, ex.: https://app.bellamore.com.br
--   <CRON_SECRET>  → mesmo valor de process.env.CRON_SECRET na Vercel
--
-- Pré-requisitos no projeto Supabase: extensões pg_cron e pg_net
-- disponíveis (Dashboard → Database → Extensions).
--
-- Rollback:
--   select cron.unschedule('lembretes-atendimento');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'lembretes-atendimento',
  '*/5 * * * *',
  $$
    select net.http_get(
      url     := '<APP_URL>/api/cron/lembretes',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
    );
  $$
);
```

- [ ] **Step 4: Remover o cron do `web/vercel.json`**

Trocar o conteúdo de `web/vercel.json` por:

```json
{}
```

(O único bloco era o `crons` diário; o `pg_cron` assume.)

- [ ] **Step 5: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/lembretes-migrations.test.ts -t "067" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/067_cron_lembretes_pg_cron.sql web/vercel.json web/tests/unit/lembretes-migrations.test.ts
git commit -m "feat(lembretes): migration 067 agenda a rota via pg_cron; remove cron do vercel.json"
```

---

## Task 18: E4 — Migration 068 (limpeza diária de alertas de agendamento passados)

**Files:**
- Create: `supabase/migrations/068_prune_notificacoes_agendamento.sql`
- Test: `web/tests/unit/lembretes-migrations.test.ts`

**Interfaces:**
- Produces: job `pg_cron` `prune-notificacoes-agendamento` (`0 5 * * *`).

- [ ] **Step 1: Adicionar teste (falha)**

```ts
describe('Migration 068 — prune de notificações de agendamento', () => {
  it('agenda delete diário só para tipo agendamento', () => {
    expect(all).toMatch(/cron\.schedule\(\s*'prune-notificacoes-agendamento',\s*'0 5 \* \* \*'/);
    expect(all).toMatch(/delete from public\.notificacoes\s+where tipo = 'agendamento'/);
    expect(all).toContain("date_trunc('day', now())");
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/lembretes-migrations.test.ts -t "068"`
Expected: FAIL.

- [ ] **Step 3: Criar `supabase/migrations/068_prune_notificacoes_agendamento.sql`**

```sql
-- ============================================================
-- 068 — Limpeza diária de alertas de agendamento passados
-- ============================================================
-- "depois que passou o dia, essas notificações de alerta podem ser
--  excluídas — apenas as de agendamento" (pedido do usuário).
--
-- Todo dia às 05:00 apaga as linhas de notificacoes com tipo
-- 'agendamento' criadas antes do início do dia atual. Notificações de
-- estoque, despesas, comissões e aniversário NÃO são tocadas.
--
-- Pré-requisito: pg_cron (já criado na migration 067).
--
-- Rollback:
--   select cron.unschedule('prune-notificacoes-agendamento');

select cron.schedule(
  'prune-notificacoes-agendamento',
  '0 5 * * *',
  $$
    delete from public.notificacoes
    where tipo = 'agendamento'
      and created_at < date_trunc('day', now());
  $$
);
```

- [ ] **Step 4: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/lembretes-migrations.test.ts && npx tsc --noEmit`
Expected: PASS (todas) + zero erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/068_prune_notificacoes_agendamento.sql web/tests/unit/lembretes-migrations.test.ts
git commit -m "feat(lembretes): migration 068 — limpa alertas de agendamento passados diariamente"
```

---

## Task 19: E5 — Notificações: alertas de agendamento colapsados numa linha expansível

**Files:**
- Modify: `web/app/(app)/notificacoes/page.tsx` — construção dos alertas `ag-*` (~L142-160) e render da lista (~L333-355)
- Test: `web/tests/unit/ui-lote-2026-09.test.ts`

**Interfaces:**
- Consumes: `rAgs.data` (agendamentos de hoje não concluídos), já buscado.
- Produces: nada.

- [ ] **Step 1: Teste de fonte (falha)**

```ts
describe('E5 — alertas de agendamento colapsados', () => {
  const src = read('app/(app)/notificacoes/page.tsx');
  it('há um estado de expandir o grupo de agendamentos', () => {
    expect(src).toContain('agsExpandido');
  });
  it('a linha-resumo mostra a contagem e o próximo horário', () => {
    expect(src).toContain('atendimento') ;
    expect(src).toContain('próximo');
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "E5"`
Expected: FAIL.

- [ ] **Step 3: Implementar o grupo colapsável**

Em `web/app/(app)/notificacoes/page.tsx`:

Adicionar estado, junto aos outros `useState`:
```tsx
  const [agsExpandido, setAgsExpandido] = useState(false);
```

Na montagem dos alertas, **separar** os alertas de agendamento dos demais. Onde hoje o `forEach` de `agsHoje` faz `lista.push({... id: 'ag-...' ...})`, manter esses num array próprio `alertasAg` e os demais em `lista`. Guardar ambos em estado:
```tsx
  const [alertas,   setAlertas]   = useState<Alerta[]>([]);
  const [alertasAg, setAlertasAg] = useState<Alerta[]>([]);
```
(setar `setAlertasAg(alertasAgLocal)` ao lado de `setAlertas(lista)`.)

No render da seção "Alertas ativos", **antes** do `.map(alertas)`, inserir o grupo colapsável quando `alertasAg.length > 0`:

```tsx
            {alertasAg.length > 0 && (
              <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                <button type="button" onClick={() => setAgsExpandido(v => !v)}
                  className="press w-full flex items-center gap-3 p-4 text-left">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: '#F3EFFE' }}>
                    <CalendarDays size={18} style={{ color: '#7C3AED' }}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-ink">
                      {alertasAg.length} {alertasAg.length === 1 ? 'atendimento' : 'atendimentos'} hoje
                    </p>
                    <p className="text-xs text-ink3 mt-0.5 truncate">
                      próximo {alertasAg[0].titulo.replace(/ — .*/, '')} — {alertasAg[0].titulo.replace(/^.* — /, '')}
                    </p>
                  </div>
                  <ChevronRight size={14} className={`text-ink4 flex-shrink-0 transition-transform ${agsExpandido ? 'rotate-90' : ''}`}/>
                </button>
                {agsExpandido && (
                  <div className="border-t border-border flex flex-col">
                    {alertasAg.map(a => (
                      <Link key={a.id} href={a.link}
                        className="press flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-ink truncate">{a.titulo}</p>
                          <p className="text-xs text-ink3 truncate">{a.descricao}</p>
                        </div>
                        <ChevronRight size={14} className="text-ink4 flex-shrink-0"/>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
```

O `.map` de `alertas` (os **demais** — estoque, despesas, comissões, aniversários) continua igual, logo abaixo. O contador do cabeçalho ("Alertas ativos" badge) passa a somar `alertas.length + alertasAg.length`.

- [ ] **Step 4: Teste + tsc**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "E5" && npx tsc --noEmit`
Expected: PASS + zero erros.

- [ ] **Step 5: Verificação no navegador (obrigatória)**

`preview_start`. `/notificacoes` num dia com vários agendamentos pendentes. Confirmar: uma única linha "N atendimentos hoje · próximo HH:MM — Fulana"; clicar expande a lista; os outros alertas (estoque/despesas/etc.) seguem linha a linha. Screenshot fechado e aberto.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/notificacoes/page.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "fix(notificacoes): agrupa alertas de agendamento do dia numa linha expansível"
```

---

## Task 20: E6 — Lembrete local no app Expo (`expo-notifications`)

**Files:**
- Modify: `mobile/lib/notifications.ts` — adicionar `agendarLembretesLocais()`
- Modify: `mobile/app/(empresa)/agenda.tsx` — chamar após carregar a agenda
- Test: `web/tests/unit/ui-lote-2026-09.test.ts` (asserção de fonte do mobile)

**Interfaces:**
- Consumes: `expo-notifications` (já em `package.json`), lista de agendamentos futuros do usuário.
- Produces: `export async function agendarLembretesLocais(ags: { id: string; dataHoraInicio: string; clienteNome: string | null; servicoNome: string | null }[]): Promise<void>`

- [ ] **Step 1: Baseline do mobile**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 2: Teste de fonte (falha)**

```ts
describe('E6 mobile — lembrete local', () => {
  const src = read('../mobile/lib/notifications.ts');
  it('exporta agendarLembretesLocais e usa scheduleNotificationAsync', () => {
    expect(src).toContain('export async function agendarLembretesLocais');
    expect(src).toContain('scheduleNotificationAsync');
    expect(src).toContain('cancelAllScheduledNotificationsAsync');
  });
});
```

- [ ] **Step 3: Ver falhar**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "E6 mobile"`
Expected: FAIL.

- [ ] **Step 4: Implementar `agendarLembretesLocais` em `mobile/lib/notifications.ts`**

```ts
/**
 * Agenda lembretes LOCAIS (sem servidor) para os atendimentos futuros do
 * usuário: 1 disparo às 18:00 da véspera + 1 disparo 30 min antes.
 * Recria tudo a cada chamada — chamar quando a agenda recarrega.
 */
export async function agendarLembretesLocais(
  ags: { id: string; dataHoraInicio: string; clienteNome: string | null; servicoNome: string | null }[],
): Promise<void> {
  if (!Device.isDevice) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Limpa os agendados e reprograma do zero (evita duplicar / manter obsoletos).
  await Notifications.cancelAllScheduledNotificationsAsync();

  const agora = Date.now();

  for (const ag of ags) {
    const inicio = new Date(ag.dataHoraInicio).getTime();
    if (Number.isNaN(inicio) || inicio <= agora) continue;

    const cli = ag.clienteNome ?? 'Cliente';
    const serv = ag.servicoNome ?? 'Atendimento';
    const hhmm = new Date(ag.dataHoraInicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // 30 min antes
    const t30 = new Date(inicio - 30 * 60_000);
    if (t30.getTime() > agora) {
      await Notifications.scheduleNotificationAsync({
        identifier: `ag-${ag.id}-30`,
        content: { title: 'Lembrete de atendimento', body: `Em 30 min: ${cli} — ${serv} · ${hhmm}` },
        trigger: t30,
      });
    }

    // Véspera às 18:00
    const vespera = new Date(inicio);
    vespera.setDate(vespera.getDate() - 1);
    vespera.setHours(18, 0, 0, 0);
    if (vespera.getTime() > agora) {
      await Notifications.scheduleNotificationAsync({
        identifier: `ag-${ag.id}-vespera`,
        content: { title: 'Atendimento amanhã', body: `Amanhã às ${hhmm}: ${cli} — ${serv}` },
        trigger: vespera,
      });
    }
  }
}
```

- [ ] **Step 5: Chamar da agenda**

Em `mobile/app/(empresa)/agenda.tsx`, após o hook que traz os agendamentos (ex.: `useAgendamentoDia` ou um hook de semana), adicionar um `useEffect` que chama `agendarLembretesLocais` com os agendamentos futuros mapeados:

```tsx
import { agendarLembretesLocais } from '@/lib/notifications';
// ...
useEffect(() => {
  const futuros = agendamentos
    .filter(a => new Date(a.data_hora_inicio) > new Date() && (a.status === 'agendado' || a.status === 'confirmado'))
    .map(a => ({
      id: a.id,
      dataHoraInicio: a.data_hora_inicio,
      clienteNome: a.cliente?.nome ?? null,
      servicoNome: nomesServicos(a),
    }));
  agendarLembretesLocais(futuros).catch(() => {});
}, [agendamentos]);
```

(Se a tela só carrega 1 dia, tudo bem — o efeito reprograma a cada troca de dia; para cobertura melhor, usar o hook de semana se já existir.)

- [ ] **Step 6: Teste + tsc mobile**

Run: `cd web && npx vitest run tests/unit/ui-lote-2026-09.test.ts -t "E6 mobile"`
Expected: PASS.
Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`
Expected: baseline **idêntica** (nenhum erro novo — atenção ao tipo do `trigger`: se o `tsc` reclamar, usar `{ type: Notifications.SchedulableTriggerInputTypes.DATE, date: t30 }`).

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/notifications.ts "mobile/app/(empresa)/agenda.tsx" web/tests/unit/ui-lote-2026-09.test.ts
git commit -m "feat(mobile/lembretes): agenda notificações locais de véspera e 30 min antes"
```

---

## Task 21: Fechamento — suíte completa + revisão de baseline

**Files:** nenhum (só verificação).

- [ ] **Step 1: Suíte de testes do web**

Run: `cd web && npx vitest run`
Expected: todos os testes passam (incluindo os pré-existentes).

- [ ] **Step 2: `tsc` web**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 3: `tsc` mobile vs baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -15`
Expected: exatamente a mesma lista de ~10 erros pré-existentes registrada no início — nenhum novo.

- [ ] **Step 4: Revisão final de branch**

Rodar `superpowers:requesting-code-review` sobre o diff completo do branch antes de abrir o PR. Focar em: (a) o ternário reestruturado do grid de KPIs (Task 8) não quebrou o ramo `loading`; (b) `nomesServicosDoAg`/`nomesServicos` produzem a mesma saída do join manual que substituíram; (c) a rota de lembretes não envia em duplicidade quando o cron roda 2× no mesmo minuto; (d) nenhuma variável órfã após remover o Funil (Task 11).

- [ ] **Step 5: Commit de fechamento (se a revisão pedir ajustes)**

Aplicar os ajustes da revisão em commits próprios e re-rodar Steps 1–3.

---

## Self-review (feito pelo autor do plano)

**Cobertura da spec:**
- A1 → Task 1 · A2 → Task 2 · A3 → Task 3 · A4 → Task 4 · A5 → Tasks 5 (web) + 6 (mobile) ✓
- B1 → Task 7 (web) + Task 9 (mobile) · B2 → Task 8 (web) + Task 9 (mobile) ✓
- C1 → Task 10 (web) + Task 12 (mobile) · C2 → Task 11 + 12 · C3 → Task 11 + 12 ✓
- D → Task 13 (web; Expo fora de escopo, conforme spec) ✓
- E1 → Task 14 · E2 → Tasks 15 + 16 · E3 → Task 17 · E4 → Task 18 · E5 → Task 19 · E6 → Task 20 ✓
- Verificação/baseline → Task 21 ✓

**Placeholders:** `<APP_URL>`/`<CRON_SECRET>` na migration 067 são placeholders **intencionais e documentados** (a spec e a Global Constraint dizem que o usuário substitui ao aplicar). Nenhum outro `TBD`/`TODO`.

**Consistência de tipos:** `AgLembrete` e as 6 funções de `shared/lembretes.ts` (Task 15) são consumidas com os mesmos nomes/assinaturas na Task 16. `nomesServicosDoAg` (web, Task 5) e `nomesServicos` (mobile, Tasks 6 e 20) são helpers distintos por plataforma, citados com o nome certo em cada tarefa. `AgCard` ganha `statusInline?: boolean` na Task 4 e não é reusado depois.
