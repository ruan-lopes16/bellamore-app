# Responsividade Mobile Web — Parte 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 5 achados novos reportados por screenshot real do PWA no iPhone — todos documentados na Parte 2 de `docs/superpowers/specs/2026-07-13-responsividade-mobile-web-design.md` — sem tocar no trabalho da Parte 1, que já está implementado e mergeado.

**Architecture:** Cada achado é independente e vive num arquivo diferente (viewport global, modal de agendamento, tabela de estoque, seletor de visão da agenda, card de dashboard) — por isso cada um vira uma task isolada, sem dependência entre elas. Todas as mudanças são aditivas ou de estilo/markup local; nenhuma query, RLS ou migration muda.

**Tech Stack:** Next.js (App Router), React, Tailwind CSS, TypeScript, Vitest.

## Global Constraints

- Nenhuma consulta, política RLS ou migration muda.
- Desktop (`md:` e acima) preserva o comportamento e o layout atuais em todas as tasks.
- Toda comunicação de commit/PR e comentários novos em Português — sem inglês, exceto onde a
  sintaxe da linguagem/framework exigir (nomes de propriedades CSS, JSX, APIs).
- `npx tsc --noEmit` sem erros novos ao final de cada task.

---

### Task 1: `viewport-fit=cover` ausente neutraliza todo `env(safe-area-inset-*)`

**Files:**
- Modify: `web/app/layout.tsx:1,24-33`
- Test: `web/tests/unit/mobile-layout-regressions.test.ts`

**Interfaces:**
- Não produz nem consome interface — mudança isolada de configuração global do Next.js.

- [ ] **Passo 1: Escrever o teste que falha**

Adicionar ao final do `describe('mobile layout regressions', ...)` em `web/tests/unit/mobile-layout-regressions.test.ts`:

```ts
  it('declara viewport-fit=cover para env(safe-area-inset-*) funcionar no PWA iOS', () => {
    const layout = read('app/layout.tsx');

    expect(layout).toMatch(/export const viewport/);
    expect(layout).toContain("viewportFit: 'cover'");
  });
```

- [ ] **Passo 2: Rodar o teste e confirmar falha**

Run: `cd web && npx vitest run tests/unit/mobile-layout-regressions.test.ts`
Expected: FAIL no teste novo ("declara viewport-fit=cover...") — `layout.tsx` ainda não tem `export const viewport`.

- [ ] **Passo 3: Adicionar o viewport em `web/app/layout.tsx`**

No topo do arquivo, trocar:

```ts
import type { Metadata } from 'next';
```

por:

```ts
import type { Metadata, Viewport } from 'next';
```

Depois do bloco `export const metadata: Metadata = { ... };` (linhas 24-33), adicionar:

```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
```

- [ ] **Passo 4: Rodar o teste de novo e confirmar sucesso**

Run: `cd web && npx vitest run tests/unit/mobile-layout-regressions.test.ts`
Expected: PASS em todos os testes do arquivo, incluindo o novo.

- [ ] **Passo 5: Commit**

```bash
git add web/app/layout.tsx web/tests/unit/mobile-layout-regressions.test.ts
git commit -m "fix: declara viewport-fit=cover para safe-area funcionar no PWA iOS"
```

---

### Task 2: Modal "Detalhes" do agendamento no mobile — de folha cortada para modal centralizado

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx:1330-1349`

**Interfaces:**
- Não muda a assinatura de `AgCard`, `agSel`, `onStatus` ou `onEditar` — só o container visual ao redor.

- [ ] **Passo 1: Ler o bloco atual para confirmar contexto antes de editar**

Confirmar que `web/app/(app)/agenda/page.tsx:1330-1349` ainda contém exatamente:

```tsx
      {/* ── Painel lateral — detalhes do agendamento ── */}
      {agSel && (
        <>
          {/* Mobile: backdrop + bottom sheet ancorado acima do bottom nav */}
          <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setAgSel(null)} />
          <div className="md:hidden fixed left-3 right-3 z-50 bg-surface border border-border rounded-2xl shadow-xl"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}>
            <div className="flex items-center justify-between p-3 border-b border-border">
              <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhes</p>
              <button onClick={() => setAgSel(null)}
                className="w-7 h-7 rounded-lg hover:bg-bg flex items-center justify-center text-text-4 transition">
                <X size={14} />
              </button>
            </div>
            <div className="p-3 max-h-[50vh] overflow-y-auto">
              <AgCard ag={agSel} empresaId={empresaId}
                onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}
                onEditar={onEditar ? ag => { setAgSel(null); onEditar(ag); } : undefined}/>
            </div>
          </div>
```

Se o conteúdo divergir (linhas deslocadas por outra mudança), localizar o bloco pelo comentário
`{/* Mobile: backdrop + bottom sheet ancorado acima do bottom nav */}` antes de prosseguir.

- [ ] **Passo 2: Substituir o bloco mobile por um modal centralizado**

Trocar o trecho acima (do comentário `{/* Mobile: ... */}` até o `</div>` que fecha a folha, mantendo
o `{agSel && ( <> ... )}` e o painel `{/* Desktop: painel lateral */}` que vem depois intactos) por:

```tsx
          {/* Mobile: modal centralizado — mesmo padrão dos modais de despesa */}
          <div className="md:hidden bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAgSel(null)} />
            <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
                <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhes</p>
                <button onClick={() => setAgSel(null)}
                  className="w-7 h-7 rounded-lg hover:bg-bg flex items-center justify-center text-text-4 transition">
                  <X size={14} />
                </button>
              </div>
              <div className="p-3 overflow-y-auto flex-1">
                <AgCard ag={agSel} empresaId={empresaId}
                  onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}
                  onEditar={onEditar ? ag => { setAgSel(null); onEditar(ag); } : undefined}/>
              </div>
            </div>
          </div>
```

Notas sobre a troca:
- `bm-modal` é a mesma classe usada pelos outros modais do app (`html:has(.bm-modal) { overflow: hidden; }`
  em `globals.css:281`) — trava o scroll de fundo enquanto o modal está aberto, algo que a folha antiga não
  fazia.
- `max-h-[85vh]` substitui o `max-h-[50vh]` da folha — dobra o espaço vertical disponível para o `AgCard`.
- O `style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}` da folha antiga não é mais necessário —
  o modal agora fica centralizado com `flex items-center justify-center`, sem precisar calcular distância
  até a bottom nav.
- O painel de desktop (`{/* Desktop: painel lateral */}`, `hidden md:block`, linhas seguintes) **não muda**.

> **Nota da revisão final de branch (17/08):** a troca de `max-h-[50vh]` para
> `max-h-[85vh]` não é, sozinha, a correção do sintoma relatado. O conteúdo do
> `AgCard` é pequeno (~130-175px) e nunca chegava perto do teto de 50vh — o
> teto nunca foi o fator limitante. A centralização e a trava de scroll de
> fundo são ganhos reais, mas o corte do dropdown de status (que abre para
> baixo via `position: absolute` e pode ser clipado pelo wrapper
> `overflow-y-auto`) provavelmente continua acontecendo, igual a antes da
> branch. Não corrigido aqui — precisa de validação em dispositivo real antes
> de escolher entre reservar espaço no wrapper ou inverter a direção do
> dropdown.

- [ ] **Passo 3: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 4: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx"
git commit -m "fix: modal de Detalhes do agendamento vira modal centralizado no mobile"
```

---

### Task 3: Tabela do Estoque — corrigir conflito de overflow que trava a rolagem lateral

**Files:**
- Modify: `web/app/(app)/estoque/page.tsx:1013`
- Modify: `web/app/(app)/estoque/loading.tsx:61`
- Test: `web/tests/unit/mobile-layout-regressions.test.ts`

**Interfaces:**
- Não produz nem consome interface — mudança de classes CSS num único elemento em cada arquivo.

**Causa raiz confirmada:** ambos os elementos combinam `overflow-hidden` (shorthand, define
`overflow-x` e `overflow-y` como `hidden`) com `overflow-x-auto` na mesma `className`. As duas
classes têm a mesma especificidade CSS; qual delas vence no eixo X depende da ordem em que o
Tailwind as emite no CSS compilado — uma disputa de cascata que não deveria existir. A correção é
trocar `overflow-hidden` por `overflow-y-hidden`, que só afeta o eixo vertical (suficiente para o
`rounded-2xl` recortar cantos corretamente) e elimina qualquer ambiguidade no eixo horizontal, onde
`overflow-x-auto` passa a ser a única regra em jogo.

> **Nota da revisão final de branch (17/08):** a alegação de "disputa de cascata"
> acima não se sustentou. Inspeção do CSS compilado de produção
> (`web/.next/static/chunks/*.css`) mostra que `.overflow-x-auto` já era emitido
> DEPOIS de `.overflow-hidden` no bundle antes desta branch — ou seja, o eixo X
> já estava em `auto`, não `hidden`, mesmo com as duas classes juntas. A troca
> para `overflow-y-hidden` continua sendo uma correção válida (remove uma
> ambiguidade real de especificidade, mesmo que ela não estivesse decidindo a
> favor do bug), mas **não está confirmado que ela resolve o sintoma relatado**
> (arrastar não revela as colunas cortadas no iPhone). A causa real do sintoma
> continua desconhecida — não foi possível descartar `touch-action` herdado,
> conflito de gesto com scroll vertical, ou outra causa sem um dispositivo real
> para testar.

- [ ] **Passo 1: Escrever o teste que falha**

Adicionar ao final do `describe('mobile layout regressions', ...)` em `web/tests/unit/mobile-layout-regressions.test.ts`:

```ts
  it('nao usa overflow-hidden junto de overflow-x-auto na tabela do Estoque (ambiguidade de cascata)', () => {
    const pagina  = read('app/(app)/estoque/page.tsx');
    const loading = read('app/(app)/estoque/loading.tsx');

    expect(pagina).not.toMatch(/overflow-hidden[^"]*overflow-x-auto/);
    expect(pagina).toMatch(/overflow-y-hidden[^"]*overflow-x-auto/);
    expect(pagina).toContain('max-md:shadow-[inset_-12px_0_12px_-12px_rgba(0,0,0,0.15)]');
    expect(loading).not.toMatch(/overflow-hidden[^"]*overflow-x-auto/);
    expect(loading).toMatch(/overflow-y-hidden[^"]*overflow-x-auto/);
  });
```

- [ ] **Passo 2: Rodar o teste e confirmar falha**

Run: `cd web && npx vitest run tests/unit/mobile-layout-regressions.test.ts`
Expected: FAIL no teste novo — as duas classes ainda usam `overflow-hidden`.

- [ ] **Passo 3: Corrigir `web/app/(app)/estoque/page.tsx:1013` e adicionar a pista visual de rolagem**

Trocar:

```tsx
        <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm overflow-x-auto">
```

por:

```tsx
        <div className="bg-surface border border-border rounded-2xl overflow-y-hidden shadow-sm overflow-x-auto max-md:shadow-[inset_-12px_0_12px_-12px_rgba(0,0,0,0.15)]">
```

O `max-md:shadow-[...]` some acima do breakpoint `md` — é a sombra sutil na borda direita que indica
que há mais colunas fora da tela, visível só no mobile (onde a tabela sempre excede a largura, dado
o `min-w-[720px]`). No desktop a tabela cabe inteira, então não faz sentido mostrar a sombra lá.

- [ ] **Passo 4: Corrigir `web/app/(app)/estoque/loading.tsx:61`**

Trocar:

```tsx
      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm overflow-x-auto">
```

por:

```tsx
      <div className="bg-surface border border-border rounded-2xl overflow-y-hidden shadow-sm overflow-x-auto">
```

- [ ] **Passo 5: Rodar o teste de novo e confirmar sucesso**

Run: `cd web && npx vitest run tests/unit/mobile-layout-regressions.test.ts`
Expected: PASS em todos os testes do arquivo, incluindo o novo.

- [ ] **Passo 6: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 7: Commit**

```bash
git add "web/app/(app)/estoque/page.tsx" "web/app/(app)/estoque/loading.tsx" web/tests/unit/mobile-layout-regressions.test.ts
git commit -m "fix: remove ambiguidade de overflow que travava a rolagem lateral do Estoque"
```

---

### Task 4: Seletor Semana/Mês/Timeline — reduzir o tamanho no mobile

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx:1666-1670`

**Interfaces:**
- Não muda `view`/`setView` nem a lista de opções — só o `style` inline dos botões.

- [ ] **Passo 1: Confirmar o bloco atual**

Confirmar que `web/app/(app)/agenda/page.tsx:1666-1670` contém exatamente:

```tsx
              <button key={key} onClick={() => setView(key)}
                style={view === key
                  ? { background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: 12, padding: '8px 14px' }
                  : { color: 'var(--color-ink3)', fontWeight: 600, fontFamily: 'var(--font-sans)', fontSize: 12, padding: '8px 14px' }}
                className="transition">{label}</button>
```

- [ ] **Passo 2: Reduzir o padding para o mesmo padrão compacto já usado em outros toggles do app**

Trocar por (padding e `fontSize` alinhados ao toggle "Por data"/"Por quantidade de parcelas" de
`web/app/(app)/financeiro/page.tsx`, que usa `py-1.5` + `text-xs` = 6px de padding vertical e 12px
de fonte):

```tsx
              <button key={key} onClick={() => setView(key)}
                style={view === key
                  ? { background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: 12, padding: '6px 12px' }
                  : { color: 'var(--color-ink3)', fontWeight: 600, fontFamily: 'var(--font-sans)', fontSize: 12, padding: '6px 12px' }}
                className="transition">{label}</button>
```

- [ ] **Passo 3: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 4: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx"
git commit -m "fix: reduz padding do seletor Semana/Mes/Timeline no mobile"
```

---

### Task 5: Dashboard — deixar explícita a relação entre comissão total e pendente

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx:357`

**Interfaces:**
- Não muda `totalComMes` nem `comPendenteMes` — só o texto do `sub`.

- [ ] **Passo 1: Confirmar a linha atual**

Confirmar que `web/app/(app)/dashboard/page.tsx:357` contém exatamente:

```tsx
          { label: 'Comissões',     value: fmt(totalComMes), color: 'var(--color-amber)',   delta: null,     sub: comPendenteMes > 0 ? `${fmt(comPendenteMes)} pend.` : 'Em dia', icon: BadgeDollarSign },
```

- [ ] **Passo 2: Trocar o texto do `sub` para deixar a relação explícita**

Trocar por:

```tsx
          { label: 'Comissões',     value: fmt(totalComMes), color: 'var(--color-amber)',   delta: null,     sub: comPendenteMes > 0 ? `${fmt(comPendenteMes)} de ${fmt(totalComMes)} pendente` : 'Em dia', icon: BadgeDollarSign },
```

- [ ] **Passo 3: Rodar TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 4: Commit**

```bash
git add "web/app/(app)/dashboard/page.tsx"
git commit -m "fix: deixa explicita a relacao entre comissao total e pendente no Dashboard"
```

---

### Task 6: Verificação completa

**Files:**
- Nenhum arquivo novo — só validação.

- [ ] **Passo 1: Rodar a suite completa de testes unitários**

Run: `cd web && npx vitest run`
Expected: todos os testes passando, incluindo os 3 novos de `mobile-layout-regressions.test.ts`.

- [ ] **Passo 2: Rodar TypeScript no projeto inteiro**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Passo 3: Rodar lint**

Run: `cd web && npm run lint`
Expected: zero erros novos (avisos pré-existentes não relacionados a este plano não bloqueiam).

- [ ] **Passo 4: Rodar build**

Run: `cd web && npm run build`
Expected: build conclui sem erros.

- [ ] **Passo 5: Atualizar o spec com o status final**

Em `docs/superpowers/specs/2026-07-13-responsividade-mobile-web-design.md`, na seção "Parte 2",
adicionar uma nota confirmando que os 5 itens (6-10) foram implementados e commitados, com o link
para este plano.

- [ ] **Passo 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-13-responsividade-mobile-web-design.md
git commit -m "docs: marca parte 2 do spec de responsividade mobile como implementada"
```
