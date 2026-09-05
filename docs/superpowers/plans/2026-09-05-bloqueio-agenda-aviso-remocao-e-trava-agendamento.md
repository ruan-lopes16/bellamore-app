# Bloqueio de agenda: aviso ao remover + trava real do agendamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a Agenda pedir confirmação antes de remover um bloqueio (web e mobile) e impedir de fato — não só visualmente — que se agende uma cliente em cima de um bloqueio, aprovado ou pendente.

**Architecture:** Uma regra pura compartilhada (`shared/bloqueios.ts`) decide colisão agendamento×bloqueio; um trigger `BEFORE INSERT/UPDATE` em `agendamentos` (migration 074, `SECURITY DEFINER`) é a trava real no servidor, servindo web e mobile igual; os clientes usam a regra pura só para UX (bloquear clique, desabilitar botão, mensagem clara) e para o passo de confirmação de remoção.

**Tech Stack:** Next.js 15 App Router + React 19 (web), Expo React Native (mobile), Supabase/PostgreSQL + RLS, date-fns, lucide-react / lucide-react-native, Vitest (só web).

## Global Constraints

- **Idioma:** todo texto de UI e todo comentário/JSDoc em **português (pt-BR)**. Nunca inglês.
- **Web verde obrigatório:** `cd web && npx tsc --noEmit` com **zero** erros e `cd web && npm test` **tudo passando** ao fim de cada task.
- **Mobile sem regressão de tipos:** `cd mobile && npx tsc --noEmit` deve permanecer **exatamente** na baseline pré-existente (~10 erros conhecidos, não relacionados). **Zero** erros novos. Capturar a baseline antes da Task 6.
- **Datas:** lógica de intervalo em função pura no `shared/`, comparando por `Date.parse`; sobreposição **meia-aberta** (`inicio < fimOutro && fim > inicioOutro`) — encostar não é colisão.
- **Migrations aditivas.** Trigger que lê tabela com RLS restritiva usa `SECURITY DEFINER SET search_path = public` (padrão das migrations 069 e 073). Próximo número sequencial: **074**.
- **Não** ressuscitar a trava de conflito agendamento×agendamento removida na migration 020 — este trabalho trata **só** o caso bloqueio.
- **Sem Supabase Realtime.**
- **Commits frequentes.** Rodapé de cada commit:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- Reusar componentes existentes: no web, o `ConfirmDialog` (`web/components/ConfirmDialog.tsx`) já é o padrão de confirmação da tela (usado no "Excluir agendamento").

---

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `web/app/(app)/agenda/page.tsx` — `NovoBloqueioModal` | corrige alinhamento (campos estourando a borda no PWA iOS) e reduz a largura de Início/Fim | 0 |
| `web/lib/formNav.ts` + `web/tests/unit/form-nav.test.tsx` | helper `avancarComEnter` (Enter avança campo, no fim foca o submit) + teste jsdom | 0b |
| `web/app/(app)/{agenda,clientes,clientes/[id],equipe,financeiro,pacotes}/page.tsx` | `onKeyDown={avancarComEnter}` nos 11 `<form>` de modal | 0c |
| `shared/bloqueios.ts` | + `BlocoParaChecagem`, `bloqueioEmConflito`, `bloqueioNoInstante` (funções puras) | 1 |
| `web/tests/unit/bloqueios.test.ts` | + casos das 2 funções novas | 1 |
| `supabase/migrations/074_agendamentos_recusa_bloqueio.sql` | trigger `BEFORE INSERT/UPDATE` em `agendamentos` que recusa horário coberto por bloqueio | 2 |
| `web/app/(app)/agenda/page.tsx` | Timeline: clique bloqueado + `stopPropagation` no corpo do bloco (T3); `NovoAgModal`: carga de bloqueios do dia, faixa vermelha, submit desabilitado, guarda em `salvar()` (T4); confirmação de remoção via `ConfirmDialog` + fio do `X` (T5) | 3, 4, 5 |
| `mobile/hooks/useAgenda.ts` | + `useRemoverBloqueio` (delete + guarda de zero-linhas + invalida as 3 query keys de bloqueio) | 6 |
| `mobile/components/ConfirmarRemoverBloqueio.tsx` | modal nativo centralizado de confirmação de remoção | 7 |
| `mobile/app/(empresa)/agenda.tsx` | `X` no bloco (regra de papel) + modal + guarda no `SlotVazio` | 8 |
| `mobile/app/(profissional)/agenda.tsx` | `X` no bloco (só o próprio pendente) + modal + guarda no `SlotVazio` | 9 |
| `mobile/app/(empresa)/novo-agendamento.tsx` | ramo de erro que reconhece a mensagem do trigger | 10 |
| `docs/superpowers/plans/…` + verificação final | tsc/test/baseline + checklist manual | 11 |

---

## Task 0: Web — alinhar o modal "Bloquear horário" e encolher Início/Fim

**Contexto:** bug reportado por screenshot do PWA no iPhone. O `NovoAgModal`
(agendamento) já recebeu `min-w-0 max-w-full` na classe do input + `min-w-0`
no `<form>` (commit `4deffa5`); o `NovoBloqueioModal` **não**. No iOS,
`<input type="date">` / `type="time"` têm largura intrínseca grande e, sem
`min-width: 0`, estouram a borda direita do card. Além disso Início/Fim estão
num `grid grid-cols-2` — cada um ocupa 50% do modal (~150px) só para mostrar
`HH:MM`. Esta task é independente das demais; roda **primeiro** para as tasks
web seguintes já editarem um arquivo alinhado.

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` — `NovoBloqueioModal` (linhas ~1227, ~1233, ~1246, ~1297–1306)

**Interfaces:**
- Consumes: nada novo.
- Produces: nada para outras tasks (só CSS/markup).

- [ ] **Step 1: `inputCls` ganha `min-w-0 max-w-full` (igual ao `NovoAgModal`)**

Trocar a linha ~1227:

```tsx
  const inputCls = "w-full min-w-0 max-w-full h-10 px-3 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
```

- [ ] **Step 2: card do modal com `overflow-hidden` + `<form>` com `min-w-0`**

Linha ~1233:

```tsx
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
```

Linha ~1246:

```tsx
        <form onSubmit={salvar} className="p-5 flex flex-col gap-3 min-w-0">
```

- [ ] **Step 3: Início/Fim lado a lado, mas estreitos**

Substituir o bloco das linhas ~1297–1306:

```tsx
          <div className="flex gap-3 min-w-0">
            <div className="w-28 min-w-0">
              <label className={labelCls}>Início</label>
              <input type="time" value={horaIni} onChange={e => setHoraIni(e.target.value)} className={inputCls}/>
            </div>
            <div className="w-28 min-w-0">
              <label className={labelCls}>Fim</label>
              <input type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)} className={inputCls}/>
            </div>
          </div>
```

- [ ] **Step 4: tsc + testes**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros; suíte verde (nenhum teste cobre esse markup — é só não regredir).

- [ ] **Step 5: Verificação visual**

Se houver navegador disponível na sessão: abrir a Agenda, `resize_window` para `mobile` (375×812), abrir "Bloquear horário" e conferir que Data / Início / Fim não passam da borda direita do card e que Início/Fim ficam compactos à esquerda. Sem conta de teste para login local, a conferência fica por leitura do markup (espelha o `NovoAgModal`, que já se comporta certo no mesmo aparelho).

- [ ] **Step 6: Commit**

```bash
git add web/app/(app)/agenda/page.tsx
git commit -m "fix(agenda): alinha modal de bloqueio e encolhe Início/Fim (web)

NovoBloqueioModal ganha min-w-0/max-w-full no input, min-w-0 no form e
overflow-hidden no card (espelha o NovoAgModal, fix 4deffa5) — campos de
data/hora deixam de estourar a borda no PWA iOS. Início/Fim passam de
grid-cols-2 (50% cada) para largura fixa w-28 alinhados à esquerda.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 0b: Web — helper `avancarComEnter` (navegação por Enter nos modais)

**Contexto:** pedido do usuário — nos modais, **Enter** deve avançar para o
próximo campo (não enviar) e, no último campo, focar o botão de ação (sem
enviar). **Tab** continua nativo. Vale para todos os `<form>` dentro de
`.bm-modal` do web (Task 0c aplica). Mobile nativo fica de fora (RN não tem
Tab; ver spec §2 "Não entra").

**Files:**
- Create: `web/lib/formNav.ts`
- Test: `web/tests/unit/form-nav.test.tsx`

**Interfaces:**
- Consumes: `React` (só o tipo `React.KeyboardEvent`).
- Produces: `export function avancarComEnter(e: React.KeyboardEvent<HTMLFormElement>): void` — usar como `<form onKeyDown={avancarComEnter}>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/tests/unit/form-nav.test.tsx`. Cada teste monta seu próprio
`<form>` (o DOM muda conforme o caso — não há helper compartilhado com
`<textarea>` fixo, senão o teste do "foca o submit" nunca alcançaria o
botão). `fireEvent.keyDown` devolve `false` quando algum handler chamou
`preventDefault` (evento cancelado) e `true` caso contrário — é assim que
os casos "avançou" vs "ignorou" são distinguidos.

```tsx
import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { avancarComEnter } from '@/lib/formNav';

/** Monta um <form onKeyDown={avancarComEnter}> com os filhos dados. */
function montarForm(...filhos: ReactNode[]) {
  const { container } = render(
    createElement('form', { onKeyDown: avancarComEnter }, ...filhos),
  );
  return container.querySelector('form') as HTMLFormElement;
}
const inp = (id: string, extra: Record<string, unknown> = {}) =>
  createElement('input', { key: id, id, type: 'text', defaultValue: '', ...extra });
const submitBtn = () => createElement('button', { key: 's', type: 'submit' }, 'Salvar');

describe('avancarComEnter', () => {
  it('Enter num input move o foco para o próximo, pulando o disabled', () => {
    const form = montarForm(inp('a'), inp('b', { disabled: true }), inp('c'), submitBtn());
    const a = form.querySelector('#a') as HTMLInputElement;
    a.focus();
    const naoCancelado = fireEvent.keyDown(a, { key: 'Enter' });
    expect(naoCancelado).toBe(false); // preventDefault foi chamado
    expect(document.activeElement).toBe(form.querySelector('#c'));
  });

  it('Enter no último campo foca o button[type=submit] e NÃO envia', () => {
    const form = montarForm(inp('a'), inp('c'), submitBtn());
    let enviou = false;
    form.addEventListener('submit', (e) => { enviou = true; e.preventDefault(); });
    const c = form.querySelector('#c') as HTMLInputElement;
    c.focus();
    fireEvent.keyDown(c, { key: 'Enter' });
    expect(document.activeElement).toBe(form.querySelector('button[type=submit]'));
    expect(enviou).toBe(false);
  });

  it('Shift+Enter é ignorado (evento não cancelado)', () => {
    const form = montarForm(inp('a'), inp('c'), submitBtn());
    const a = form.querySelector('#a') as HTMLInputElement;
    a.focus();
    const naoCancelado = fireEvent.keyDown(a, { key: 'Enter', shiftKey: true });
    expect(naoCancelado).toBe(true);
    expect(document.activeElement).toBe(a); // foco não mudou
  });

  it('Enter em <textarea> não é interceptado (quebra de linha normal)', () => {
    const form = montarForm(inp('a'), createElement('textarea', { key: 't', id: 't' }), submitBtn());
    const t = form.querySelector('#t') as HTMLTextAreaElement;
    t.focus();
    const naoCancelado = fireEvent.keyDown(t, { key: 'Enter' });
    expect(naoCancelado).toBe(true);
    expect(document.activeElement).toBe(t);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/form-nav.test.tsx`
Expected: FAIL — `Cannot find module '@/lib/formNav'`.

- [ ] **Step 3: Implementar o helper**

Criar `web/lib/formNav.ts` exatamente assim (o filtro de visibilidade usa
`hidden`/`[hidden]` — **não** `offsetWidth`, que é sempre 0 no jsdom e
quebraria o teste):

```ts
import type React from 'react';

/**
 * Handler de `onKeyDown` para <form> de modal: Enter move o foco para o
 * próximo campo focável (input/select/textarea habilitado e não escondido
 * via `hidden`) em vez de enviar o formulário. No último campo, foca o
 * botão `type="submit"` — não envia; exige um Enter/clique explícito nele.
 * Tab continua nativo. Enter em <textarea> e em <button> mantém o
 * comportamento padrão (quebra de linha / clique).
 *
 * Uso: <form onKeyDown={avancarComEnter}>
 */
export function avancarComEnter(e: React.KeyboardEvent<HTMLFormElement>): void {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const alvo = e.target as HTMLElement;
  if (alvo.tagName === 'TEXTAREA' || alvo.tagName === 'BUTTON') return;
  e.preventDefault();

  const campos = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea'),
  ).filter((el) => {
    if (el.hasAttribute('disabled') || el.tabIndex < 0) return false;
    if ((el as HTMLElement).hidden || el.closest('[hidden]')) return false;
    return true;
  });

  const prox = campos[campos.indexOf(alvo) + 1];
  if (prox) {
    prox.focus();
    (prox as HTMLInputElement).select?.();
  } else {
    e.currentTarget.querySelector<HTMLElement>('button[type="submit"]')?.focus();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run tests/unit/form-nav.test.tsx`
Expected: PASS nos 4 casos.

- [ ] **Step 5: tsc + suíte cheia**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros; tudo verde.

- [ ] **Step 6: Commit**

```bash
git add web/lib/formNav.ts web/tests/unit/form-nav.test.tsx
git commit -m "feat(ui): helper avancarComEnter — Enter navega os campos do modal (web)

Enter move o foco pro próximo campo; no último, foca o button[type=submit]
sem enviar. Tab segue nativo. Textarea/button mantêm o Enter padrão. TDD (jsdom).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 0c: Web — aplicar `avancarComEnter` nos 11 `<form>` de modal

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` (`<form>` do `NovoAgModal` ~782 e do `NovoBloqueioModal` ~1246)
- Modify: `web/app/(app)/clientes/page.tsx` (~97)
- Modify: `web/app/(app)/clientes/[id]/page.tsx` (~223)
- Modify: `web/app/(app)/equipe/page.tsx` (~124, ~254)
- Modify: `web/app/(app)/financeiro/page.tsx` (~204, ~403, ~871)
- Modify: `web/app/(app)/pacotes/page.tsx` (~206, ~418)

**Interfaces:**
- Consumes: `avancarComEnter` de `@/lib/formNav` (Task 0b).
- Produces: nada.

Regra mecânica para **cada** `<form onSubmit={...} className="...">`:
1. Garantir o import no topo do arquivo: `import { avancarComEnter } from '@/lib/formNav';`
2. Acrescentar a prop: `<form onSubmit={...} onKeyDown={avancarComEnter} className="...">`
3. Não mexer em mais nada no form.

- [ ] **Step 1: `agenda/page.tsx` — 2 forms**

Import no topo (junto dos outros de `@/`):

```tsx
import { avancarComEnter } from '@/lib/formNav';
```

`NovoAgModal` (linha ~782):

```tsx
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-4 min-w-0">
```

`NovoBloqueioModal` (linha ~1246):

```tsx
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-3 min-w-0">
```

(o `min-w-0` no `NovoBloqueioModal` já foi adicionado na Task 0.)

- [ ] **Step 2: `clientes/page.tsx` (~97) e `clientes/[id]/page.tsx` (~223)**

Import `import { avancarComEnter } from '@/lib/formNav';` em cada arquivo, e:

```tsx
// clientes/page.tsx ~97
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-3">
```
```tsx
// clientes/[id]/page.tsx ~223
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-4">
```

- [ ] **Step 3: `equipe/page.tsx` (~124 e ~254)**

Import uma vez no topo; nas duas linhas:

```tsx
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-4">
```

- [ ] **Step 4: `financeiro/page.tsx` (~204, ~403, ~871)**

Import uma vez no topo; nas três linhas:

```tsx
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
```

- [ ] **Step 5: `pacotes/page.tsx` (~206 e ~418)**

Import uma vez no topo; nas duas linhas (as classes diferem — preservar cada uma, só somar a prop):

```tsx
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
```
```tsx
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-4">
```

- [ ] **Step 6: tsc + testes**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros; suíte verde.

- [ ] **Step 7: Verificação (por leitura + `grep`)**

Run: `cd web && grep -rn "onKeyDown={avancarComEnter}" app | wc -l`
Expected: **11**.
Run: `cd web && grep -rLn "from '@/lib/formNav'" $(grep -rl "avancarComEnter" app)`
Expected: nenhum arquivo listado (todo arquivo que usa também importa).

Conferir mentalmente: nenhum desses 11 forms é de autenticação nem de página
inteira; todos vivem dentro de `.bm-modal`.

- [ ] **Step 8: Commit**

```bash
git add web/app
git commit -m "feat(ui): Enter navega os campos em todos os modais de cadastro (web)

onKeyDown={avancarComEnter} nos 11 <form> de modal (agenda, clientes, equipe,
financeiro, pacotes). Fora: configurações (página inteira) e autenticação.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 1: Regra pura de colisão agendamento × bloqueio

**Files:**
- Modify: `shared/bloqueios.ts` (acrescentar ao fim, antes de nada não — ao fim do arquivo)
- Test: `web/tests/unit/bloqueios.test.ts` (acrescentar `describe`s ao fim)

**Interfaces:**
- Consumes: `EscopoBloqueio`, `SituacaoBloqueio` (já exportados no mesmo arquivo).
- Produces:
  - `interface BlocoParaChecagem { escopo: EscopoBloqueio; profissional_id: string | null; situacao: SituacaoBloqueio; data_inicio: string; data_fim: string; motivo?: string | null; titulo?: string | null }`
  - `bloqueioEmConflito(blocos: readonly BlocoParaChecagem[], profissionalId: string, inicioISO: string, fimISO: string): BlocoParaChecagem | null`
  - `bloqueioNoInstante(blocos: readonly BlocoParaChecagem[], profissionalId: string, instanteISO: string): BlocoParaChecagem | null`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `web/tests/unit/bloqueios.test.ts`:

```ts
import { bloqueioEmConflito, bloqueioNoInstante, type BlocoParaChecagem } from '@shared/bloqueios';

const blocoBase: BlocoParaChecagem = {
  escopo: 'profissional',
  profissional_id: 'u-prof',
  situacao: 'aprovado',
  data_inicio: '2026-09-10T14:00:00.000Z',
  data_fim:    '2026-09-10T15:00:00.000Z',
  motivo: 'folga',
  titulo: 'Folga',
};

describe('bloqueioEmConflito', () => {
  it('bloqueio do próprio profissional que sobrepõe o intervalo => devolve o bloco', () => {
    const r = bloqueioEmConflito([blocoBase], 'u-prof',
      '2026-09-10T14:30:00.000Z', '2026-09-10T15:30:00.000Z');
    expect(r).toBe(blocoBase);
  });

  it('bloqueio de OUTRO profissional (escopo profissional) => null', () => {
    const r = bloqueioEmConflito([blocoBase], 'u-outra',
      '2026-09-10T14:30:00.000Z', '2026-09-10T15:30:00.000Z');
    expect(r).toBeNull();
  });

  it('bloqueio escopo "geral" colide com qualquer profissional', () => {
    const geral: BlocoParaChecagem = { ...blocoBase, escopo: 'geral', profissional_id: null };
    const r = bloqueioEmConflito([geral], 'qualquer-um',
      '2026-09-10T14:10:00.000Z', '2026-09-10T14:20:00.000Z');
    expect(r).toBe(geral);
  });

  it('situacao "pendente" também colide (não só aprovado)', () => {
    const pend: BlocoParaChecagem = { ...blocoBase, situacao: 'pendente' };
    const r = bloqueioEmConflito([pend], 'u-prof',
      '2026-09-10T14:00:00.000Z', '2026-09-10T14:30:00.000Z');
    expect(r).toBe(pend);
  });

  it('encostar não é colisão: agendamento termina exatamente quando o bloqueio começa', () => {
    const r = bloqueioEmConflito([blocoBase], 'u-prof',
      '2026-09-10T13:00:00.000Z', '2026-09-10T14:00:00.000Z');
    expect(r).toBeNull();
  });

  it('encostar não é colisão: agendamento começa exatamente quando o bloqueio termina', () => {
    const r = bloqueioEmConflito([blocoBase], 'u-prof',
      '2026-09-10T15:00:00.000Z', '2026-09-10T16:00:00.000Z');
    expect(r).toBeNull();
  });

  it('vários blocos colidindo => devolve o de menor data_inicio', () => {
    const cedo:  BlocoParaChecagem = { ...blocoBase, data_inicio: '2026-09-10T13:30:00.000Z', data_fim: '2026-09-10T14:30:00.000Z', motivo: 'reuniao' };
    const tarde: BlocoParaChecagem = { ...blocoBase };
    const r = bloqueioEmConflito([tarde, cedo], 'u-prof',
      '2026-09-10T14:00:00.000Z', '2026-09-10T15:00:00.000Z');
    expect(r).toBe(cedo);
  });

  it('lista vazia => null', () => {
    expect(bloqueioEmConflito([], 'u-prof',
      '2026-09-10T14:00:00.000Z', '2026-09-10T15:00:00.000Z')).toBeNull();
  });
});

describe('bloqueioNoInstante', () => {
  it('instante dentro do bloqueio => devolve o bloco', () => {
    expect(bloqueioNoInstante([blocoBase], 'u-prof', '2026-09-10T14:30:00.000Z')).toBe(blocoBase);
  });
  it('instante == data_inicio => colide (meia-aberto inclui o início)', () => {
    expect(bloqueioNoInstante([blocoBase], 'u-prof', '2026-09-10T14:00:00.000Z')).toBe(blocoBase);
  });
  it('instante == data_fim => não colide (meia-aberto exclui o fim)', () => {
    expect(bloqueioNoInstante([blocoBase], 'u-prof', '2026-09-10T15:00:00.000Z')).toBeNull();
  });
  it('bloqueio de outro profissional => null', () => {
    expect(bloqueioNoInstante([blocoBase], 'u-outra', '2026-09-10T14:30:00.000Z')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/bloqueios.test.ts`
Expected: FAIL — `bloqueioEmConflito is not a function` / `bloqueioNoInstante is not a function`.

- [ ] **Step 3: Implementar as funções puras**

Acrescentar ao fim de `shared/bloqueios.ts`:

```ts
/**
 * Forma mínima de um bloqueio para checagem de colisão com agendamento.
 * Tanto o tipo `Bloqueio` do web quanto `BloqueioAgenda` do mobile são
 * estruturalmente compatíveis com esta interface.
 */
export interface BlocoParaChecagem {
  escopo: EscopoBloqueio;
  profissional_id: string | null;
  situacao: SituacaoBloqueio;
  /** ISO string. */
  data_inicio: string;
  /** ISO string. */
  data_fim: string;
  motivo?: string | null;
  titulo?: string | null;
}

/** Um bloqueio vale para este profissional se é geral ou aponta para ele. */
function blocoAlcancaProfissional(b: BlocoParaChecagem, profissionalId: string): boolean {
  return b.escopo === 'geral' || b.profissional_id === profissionalId;
}

/** Bloqueio ativo = aprovado OU pendente (pendente também trava o agendamento). */
function blocoAtivo(b: BlocoParaChecagem): boolean {
  return b.situacao === 'aprovado' || b.situacao === 'pendente';
}

/**
 * Primeiro bloqueio (menor `data_inicio`) que colide com o intervalo
 * meia-aberto [inicioISO, fimISO) para o profissional dado, ou `null`.
 * Considera bloqueio "geral" e o do próprio profissional; aprovado OU
 * pendente. Encostar (fim de um == início do outro) NÃO é colisão.
 * Fonte única de verdade para web, mobile e o pré-check que espelha o
 * trigger `check_agendamento_bloqueio` do banco.
 */
export function bloqueioEmConflito(
  blocos: readonly BlocoParaChecagem[],
  profissionalId: string,
  inicioISO: string,
  fimISO: string,
): BlocoParaChecagem | null {
  const ini = Date.parse(inicioISO);
  const fim = Date.parse(fimISO);
  if (Number.isNaN(ini) || Number.isNaN(fim)) return null;

  let achado: BlocoParaChecagem | null = null;
  let achadoIni = Infinity;
  for (const b of blocos) {
    if (!blocoAtivo(b) || !blocoAlcancaProfissional(b, profissionalId)) continue;
    const bIni = Date.parse(b.data_inicio);
    const bFim = Date.parse(b.data_fim);
    if (Number.isNaN(bIni) || Number.isNaN(bFim)) continue;
    if (bIni < fim && bFim > ini && bIni < achadoIni) {
      achado = b;
      achadoIni = bIni;
    }
  }
  return achado;
}

/**
 * Bloqueio que cobre um instante pontual (usado no clique da Timeline).
 * Meia-aberto: `data_inicio <= instante < data_fim`.
 */
export function bloqueioNoInstante(
  blocos: readonly BlocoParaChecagem[],
  profissionalId: string,
  instanteISO: string,
): BlocoParaChecagem | null {
  const t = Date.parse(instanteISO);
  if (Number.isNaN(t)) return null;
  for (const b of blocos) {
    if (!blocoAtivo(b) || !blocoAlcancaProfissional(b, profissionalId)) continue;
    const bIni = Date.parse(b.data_inicio);
    const bFim = Date.parse(b.data_fim);
    if (Number.isNaN(bIni) || Number.isNaN(bFim)) continue;
    if (bIni <= t && t < bFim) return b;
  }
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run tests/unit/bloqueios.test.ts`
Expected: PASS — todos os `describe`s, inclusive os pré-existentes.

- [ ] **Step 5: tsc + suíte cheia**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros de tipo; toda a suíte verde.

- [ ] **Step 6: Commit**

```bash
git add shared/bloqueios.ts web/tests/unit/bloqueios.test.ts
git commit -m "feat(bloqueios): regra pura de colisão agendamento × bloqueio

bloqueioEmConflito / bloqueioNoInstante em shared/bloqueios.ts, meia-aberto,
considera escopo geral + próprio profissional, aprovado OU pendente. TDD.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Migration 074 — trigger que recusa agendamento sobre bloqueio

**Files:**
- Create: `supabase/migrations/074_agendamentos_recusa_bloqueio.sql`

**Interfaces:**
- Produces: função `public.check_agendamento_bloqueio()` + trigger `trg_check_agendamento_bloqueio` em `public.agendamentos`. Mensagem de erro estável começando por **`Horário bloqueado`** (a Task 10 casa por essa substring).
- Consumes: tabela `public.agenda_bloqueios` (colunas `empresa_id, escopo, profissional_id, situacao, motivo, data_inicio, data_fim`, todas já existentes desde a migration 068).

- [ ] **Step 1: Criar o arquivo da migration**

Criar `supabase/migrations/074_agendamentos_recusa_bloqueio.sql` com exatamente:

```sql
-- ============================================================
-- MIGRATION 074 — agendamentos: recusa horário coberto por bloqueio
--
-- Contexto: a migration 020 removeu o trigger de conflito
-- agendamento×agendamento (virou aviso client-side, que permite
-- "agendar mesmo assim"). Com isso, bloqueio de agenda ficou SÓ
-- visual — nada no servidor impede um INSERT em agendamentos sobre
-- um bloqueio. Esta migration cria a trava real, APENAS para o caso
-- bloqueio; NÃO ressuscita a trava agendamento×agendamento.
--
-- Comportamento:
--   • BEFORE INSERT OR UPDATE ON agendamentos, FOR EACH ROW.
--   • Ignora NEW.status IN ('cancelado','faltou').
--   • Em UPDATE, só valida se data_hora_inicio, data_hora_fim OU
--     profissional_id mudaram — não trava troca de status de um
--     agendamento que já existia quando o bloqueio foi criado depois.
--   • Colisão = existe agenda_bloqueios na MESMA empresa, com
--     situacao IN ('aprovado','pendente') (pendente também trava),
--     escopo 'geral' OU profissional_id = NEW.profissional_id, e
--     sobreposição meia-aberta com [NEW.data_hora_inicio,
--     NEW.data_hora_fim).
--   • Colidiu => RAISE EXCEPTION com texto que começa por
--     'Horário bloqueado' (os apps casam por substring).
--
-- SECURITY DEFINER + search_path = public: o trigger precisa enxergar
-- bloqueios 'pendente', que a policy "bloqueios: ver" (068) esconde de
-- quem não é gestor/owner nem autor. Mesmo padrão das migrations 069 e
-- 073.
--
-- Aditivo: nenhuma linha existente é alterada. Só INSERT/UPDATE novos
-- que caiam sobre bloqueio passam a falhar — que é o pedido.
--
-- Rollback: drop trigger trg_check_agendamento_bloqueio on
-- public.agendamentos;  drop function public.check_agendamento_bloqueio();
-- ============================================================

create or replace function public.check_agendamento_bloqueio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text;
begin
  if NEW.status in ('cancelado', 'faltou') then
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and NEW.data_hora_inicio is not distinct from OLD.data_hora_inicio
     and NEW.data_hora_fim    is not distinct from OLD.data_hora_fim
     and NEW.profissional_id  is not distinct from OLD.profissional_id then
    return NEW;
  end if;

  select coalesce(b.motivo, 'bloqueio')
    into v_motivo
  from public.agenda_bloqueios b
  where b.empresa_id = NEW.empresa_id
    and b.situacao in ('aprovado', 'pendente')
    and (b.escopo = 'geral' or b.profissional_id = NEW.profissional_id)
    and b.data_inicio < NEW.data_hora_fim
    and b.data_fim    > NEW.data_hora_inicio
  order by b.data_inicio
  limit 1;

  if found then
    raise exception
      'Horário bloqueado na agenda (%). Remova o bloqueio para agendar nesse período.',
      v_motivo
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_check_agendamento_bloqueio on public.agendamentos;
create trigger trg_check_agendamento_bloqueio
  before insert or update on public.agendamentos
  for each row execute function public.check_agendamento_bloqueio();
```

- [ ] **Step 2: Conferência de consistência (não há runner de SQL no projeto)**

Run: `cd "$(git rev-parse --show-toplevel)" && grep -n "trg_check_agendamento_bloqueio\|check_agendamento_bloqueio\|Horário bloqueado" supabase/migrations/074_agendamentos_recusa_bloqueio.sql`
Expected: nome da função e do trigger batem entre `create`/`drop`/`create trigger`; a string `Horário bloqueado` aparece uma vez no `raise`.

Checklist manual (marcar mentalmente):
- `security definer` **e** `set search_path = public` presentes.
- `NEW.status in ('cancelado','faltou')` sai cedo.
- guarda de `TG_OP = 'UPDATE'` com `is not distinct from` nos 3 campos.
- sobreposição usa `<` e `>` (meia-aberta), não `<=`/`>=`.
- `order by b.data_inicio limit 1` — motivo do bloqueio mais cedo.

- [ ] **Step 3: Registrar a pendência de aplicação**

Confirmar que `docs/superpowers/specs/2026-09-05-bloqueio-agenda-aviso-remocao-e-trava-agendamento-design.md` §10 já lista aplicar a `074` via `supabase db push`. Se o texto não citar a 074 explicitamente, ajustar a linha. (Já cita — só conferir.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/074_agendamentos_recusa_bloqueio.sql
git commit -m "feat(agenda): trigger recusa agendamento sobre bloqueio (migration 074)

BEFORE INSERT/UPDATE em agendamentos; recusa quando o horário cai sobre
agenda_bloqueios (geral ou do profissional; aprovado OU pendente).
SECURITY DEFINER para enxergar pendentes. Não mexe no conflito
agendamento×agendamento.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Web — clique bloqueado na Timeline

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`
  - import de `@shared/bloqueios` (linhas ~47–50)
  - `TimelineView` props (linha ~1427) e `onClick` da coluna (linha ~1579) e container do bloco (linha ~1641)
  - render de `<TimelineView .../>` na página (linha ~2264)

**Interfaces:**
- Consumes: `bloqueioNoInstante` (Task 1); `showErro(msg: string)` (já existe na página, linha ~1948); prop `bloqueios: Bloqueio[]` e `dataSel: Date` (já recebidas pelo `TimelineView`).
- Produces: nova prop `onAvisoBloqueio: (msg: string) => void` no `TimelineView`.

- [ ] **Step 1: Importar as funções puras**

Trocar o import (linhas ~47–50):

```tsx
import {
  MOTIVOS_BLOQUEIO, motivoBloqueioLabel, podeSelecionarEscopoGeral,
  montarInsertBloqueio, bloqueioEmConflito, bloqueioNoInstante,
  type EscopoBloqueio,
} from '@shared/bloqueios';
```

- [ ] **Step 2: Adicionar a prop `onAvisoBloqueio` ao `TimelineView`**

Na assinatura de `TimelineView` (linha ~1428), acrescentar `onAvisoBloqueio` à lista desestruturada e ao tipo:

```tsx
function TimelineView({
  ags, bloqueios, profissionaisEmpresa, loading, empresaId, categoriasCustom, onStatus, dataSel, onEditar, onNovo, onDeletarBloqueio, onAvisoBloqueio, meuRole, meuUserId,
}: {
  ags: Ag[]; bloqueios: Bloqueio[]; profissionaisEmpresa: { id: string; nome: string }[];
  loading: boolean; empresaId: string;
  categoriasCustom: CategoriaCustom[];
  onStatus: (id: string, s: string) => void;
  dataSel: Date;
  onEditar?: (ag: Ag) => void;
  onNovo: (params: { hora: string; profId: string }) => void;
  onDeletarBloqueio: (id: string) => void;
  onAvisoBloqueio: (msg: string) => void;
  meuRole: string; meuUserId: string;
}) {
```

- [ ] **Step 3: Bloquear o clique da coluna quando o instante está bloqueado**

Substituir o `onClick` da `<div>` da coluna do profissional (linha ~1579):

```tsx
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const horaStr = calcHoraTimeline(e.clientY - rect.top);
                    const [hh, mm] = horaStr.split(':').map(Number);
                    const instante = new Date(dataSel);
                    instante.setHours(hh, mm, 0, 0);
                    const bl = bloqueioNoInstante(bloqueios, prof.id, instante.toISOString());
                    if (bl) {
                      onAvisoBloqueio(`Horário bloqueado (${motivoBloqueioLabel(bl.motivo)}). Remova o bloqueio para agendar aqui.`);
                      return;
                    }
                    onNovo({ hora: horaStr, profId: prof.id });
                  }}
```

- [ ] **Step 4: Impedir que clique no corpo do bloco borbulhe para a coluna**

No `<div key={bl.id} ...>` do bloco (linha ~1641), acrescentar `onClick` que só barra a propagação (o botão `X` interno já tem o seu próprio `stopPropagation`):

```tsx
                      <div key={bl.id}
                        onClick={e => e.stopPropagation()}
                        className="absolute overflow-hidden z-5 flex flex-col"
```

- [ ] **Step 5: Passar `onAvisoBloqueio` no uso do `TimelineView`**

No render (linha ~2264), acrescentar a prop logo após `onDeletarBloqueio`:

```tsx
          onDeletarBloqueio={deletarBloqueio}
          onAvisoBloqueio={showErro}
```

- [ ] **Step 6: tsc + testes**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros; suíte verde.

- [ ] **Step 7: Verificação manual (descrever, não exige app rodando)**

Confirmar por leitura: (a) clicar numa faixa de horário coberta por bloqueio geral OU do profissional daquela coluna chama `onAvisoBloqueio` e **não** `onNovo`; (b) clicar no corpo vermelho do bloco não abre o modal; (c) clicar num horário livre continua abrindo o modal normalmente.

- [ ] **Step 8: Commit**

```bash
git add web/app/(app)/agenda/page.tsx
git commit -m "feat(agenda): clique em horário bloqueado não abre novo agendamento (web)

Timeline usa bloqueioNoInstante; horário coberto por bloqueio (geral ou do
profissional, aprovado ou pendente) mostra aviso em vez de abrir o modal.
Clique no corpo do bloco deixa de borbulhar.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Web — `NovoAgModal` recusa salvar sobre bloqueio

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`
  - `NovoAgModal` (começa na linha ~289): novo estado + `useEffect` de carga; cálculo do conflito; faixa vermelha; `disabled` do submit; guarda em `salvar()`.

**Interfaces:**
- Consumes: `bloqueioEmConflito` (Task 1); tipo `Bloqueio` (módulo-scoped, linha ~97); `supabase` (módulo-level); `addMinutes`, `format`, `parseISO` (já importados no arquivo); `motivoBloqueioLabel` (import da Task 3).
- Produces: nada para outras tasks.

- [ ] **Step 1: Estado dos bloqueios do dia no `NovoAgModal`**

Logo após o estado `const [conflitos, setConflitos] = useState<ConflitoDet[]>([]);` (linha ~395), adicionar:

```tsx
  // Bloqueios de agenda do dia selecionado — para impedir agendar em cima.
  const [bloqueiosDia, setBloqueiosDia] = useState<Bloqueio[]>([]);
```

- [ ] **Step 2: Carregar os bloqueios quando muda o dia**

Adicionar um `useEffect` dedicado logo depois do `useEffect` que carrega clientes/serviços (após a linha ~422, `}, [empresaId]);`):

```tsx
  // Recarrega ao trocar a data dentro do modal (o campo de data é editável).
  useEffect(() => {
    const d0 = new Date(dataSel); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(dataSel); d1.setHours(23, 59, 59, 999);
    supabase
      .from('agenda_bloqueios')
      .select('id, escopo, profissional_id, situacao, motivo, titulo, data_inicio, data_fim')
      .eq('empresa_id', empresaId)
      .lt('data_inicio', d1.toISOString())
      .gt('data_fim', d0.toISOString())
      .then(({ data }: { data: any[] | null }) => {
        setBloqueiosDia((data ?? []) as Bloqueio[]);
      });
  }, [empresaId, dataSel]);
```

- [ ] **Step 3: Calcular o bloqueio em conflito com o intervalo atual do formulário**

Logo antes de `const inputClass = ...` (linha ~694), adicionar:

```tsx
  // Bloqueio que colide com o intervalo que o formulário representa agora.
  const bloqueioConflitante = (() => {
    if (!profId || !hora) return null;
    const [bh, bm] = hora.split(':').map(Number);
    if (Number.isNaN(bh) || Number.isNaN(bm)) return null;
    const ini = new Date(dataSel); ini.setHours(bh, bm, 0, 0);
    const fim = addMinutes(ini, totalDuracao || 60);
    return bloqueioEmConflito(bloqueiosDia, profId, ini.toISOString(), fim.toISOString());
  })();
```

- [ ] **Step 4: Guardar em `salvar()`**

No começo de `async function salvar(e)` (linha ~654), logo após `setConflitos([]);`:

```tsx
    if (bloqueioConflitante) {
      setErro(`Horário bloqueado (${motivoBloqueioLabel(bloqueioConflitante.motivo)}). Remova o bloqueio para agendar nesse horário.`);
      return;
    }
```

- [ ] **Step 5: Faixa vermelha acima do formulário**

Logo antes do bloco `{/* Aviso de conflito de horário */}` (linha ~753), adicionar:

```tsx
        {/* Aviso de horário bloqueado — trava dura, sem opção de forçar */}
        {bloqueioConflitante && (
          <div className="mx-5 mt-5 rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--color-rose)', background: 'var(--color-rose-soft)' }}>
            <div className="flex items-center gap-2 px-4 pt-4 pb-1">
              <AlertTriangle size={15} strokeWidth={2.5} style={{ color: 'var(--color-rose)' }}/>
              <p className="text-sm font-bold" style={{ color: 'var(--color-rose)' }}>Horário bloqueado</p>
            </div>
            <p className="text-xs text-text-2 px-4 pb-4">
              {motivoBloqueioLabel(bloqueioConflitante.motivo)} ·{' '}
              {format(parseISO(bloqueioConflitante.data_inicio), 'HH:mm')}–{format(parseISO(bloqueioConflitante.data_fim), 'HH:mm')}.
              {' '}Remova o bloqueio na agenda para poder agendar nesse horário.
            </p>
          </div>
        )}
```

(`AlertTriangle` já é importado no arquivo — usado no aviso de conflito.)

- [ ] **Step 6: Desabilitar o botão de salvar**

No `<button type="submit" ...>` (linha ~1070), trocar o `disabled`:

```tsx
            <button type="submit" disabled={salvando || !!bloqueioConflitante} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
              {salvando ? 'Salvando...' : agEditar ? 'Salvar alterações' : 'Agendar'}
            </button>
```

- [ ] **Step 7: tsc + testes**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros; suíte verde.

- [ ] **Step 8: Verificação manual (por leitura)**

(a) Escolher profissional + horário que caia num bloqueio → faixa vermelha aparece, botão "Agendar" fica desabilitado; (b) `salvar()` chamado por qualquer via retorna cedo com `setErro`; (c) trocar a data do modal recarrega `bloqueiosDia`; (d) horário livre → faixa some, botão habilita. O aviso amber de conflito agendamento×agendamento e o "Agendar mesmo assim" continuam intactos.

- [ ] **Step 9: Commit**

```bash
git add web/app/(app)/agenda/page.tsx
git commit -m "feat(agenda): modal de agendamento não deixa salvar sobre bloqueio (web)

NovoAgModal carrega os bloqueios do dia, mostra faixa vermelha e desabilita
Agendar quando o intervalo cai sobre bloqueio (bloqueioEmConflito). Guarda
também em salvar(). Sem opção de forçar.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Web — confirmação ao remover bloqueio (`ConfirmDialog`)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`
  - `TimelineView`: nova prop `onPedirRemoverBloqueio`; `onClick` do botão `X` (linha ~1657)
  - Página `Agenda`: estado `bloqueioParaRemover`, render de `<ConfirmDialog>`, prop no `<TimelineView>`

**Interfaces:**
- Consumes: `ConfirmDialog` (já importado, linha ~51); `deletarBloqueio(id)` (função da página, linha ~2116); `profissionaisEmpresa` (array em escopo da página); `motivoBloqueioLabel`, `format`, `parseISO`; tipo `Bloqueio`.
- Produces: prop `onPedirRemoverBloqueio: (b: Bloqueio) => void` no `TimelineView` (substitui a chamada direta a `onDeletarBloqueio` no `X`; `onDeletarBloqueio` continua existindo e é chamado pelo `ConfirmDialog`).

- [ ] **Step 1: Nova prop no `TimelineView`**

Na assinatura (linha ~1428) acrescentar `onPedirRemoverBloqueio` à desestruturação e ao tipo:

```tsx
  onDeletarBloqueio: (id: string) => void;
  onPedirRemoverBloqueio: (b: Bloqueio) => void;
  onAvisoBloqueio: (msg: string) => void;
```

- [ ] **Step 2: O `X` pede confirmação em vez de apagar direto**

No botão `X` do bloco (linha ~1657), trocar o `onClick`:

```tsx
                              <button
                                onClick={e => { e.stopPropagation(); onPedirRemoverBloqueio(bl); }}
                                className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-rose-soft transition"
                                title="Remover bloqueio">
```

- [ ] **Step 3: Estado + `ConfirmDialog` na página**

Na página `Agenda`, junto dos outros `useState` de modal (perto da linha ~1944, `const [bloqueiosPendentes, ...]`):

```tsx
  const [bloqueioParaRemover, setBloqueioParaRemover] = useState<Bloqueio | null>(null);
```

Adicionar o render do diálogo logo antes do fechamento do JSX da página, junto dos outros modais (perto da linha ~2331, antes de `{/* Modal de bloqueio */}`):

```tsx
      {bloqueioParaRemover && (() => {
        const b = bloqueioParaRemover;
        const alvo = b.escopo === 'geral'
          ? 'Toda a agenda'
          : (profissionaisEmpresa.find(p => p.id === b.profissional_id)?.nome ?? 'Profissional');
        const intervalo =
          `${format(parseISO(b.data_inicio), "dd/MM 'às' HH:mm")}–${format(parseISO(b.data_fim), 'HH:mm')}`;
        const pend = b.situacao === 'pendente' ? ' Este pedido ainda aguarda aprovação.' : '';
        return (
          <ConfirmDialog
            open
            variant="danger"
            title="Remover bloqueio?"
            message={`${alvo} · ${motivoBloqueioLabel(b.motivo)} · ${intervalo}.${pend}`}
            confirmLabel="Remover"
            onConfirm={() => { deletarBloqueio(b.id); setBloqueioParaRemover(null); }}
            onCancel={() => setBloqueioParaRemover(null)}
          />
        );
      })()}
```

- [ ] **Step 4: Passar a prop no `<TimelineView>`**

No render (linha ~2264), logo após `onDeletarBloqueio={deletarBloqueio}`:

```tsx
          onDeletarBloqueio={deletarBloqueio}
          onPedirRemoverBloqueio={setBloqueioParaRemover}
          onAvisoBloqueio={showErro}
```

- [ ] **Step 5: tsc + testes**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros; suíte verde.

- [ ] **Step 6: Verificação manual (por leitura)**

(a) Clicar no `X` de um bloco abre o `ConfirmDialog` com escopo + motivo + intervalo (e a frase de "aguarda aprovação" quando pendente); (b) "Cancelar" fecha sem apagar; (c) "Remover" chama `deletarBloqueio` (que mantém o optimistic + guarda de zero-linhas já existente) e fecha; (d) a regra `podeRemover` que decide se o `X` aparece não mudou.

- [ ] **Step 7: Commit**

```bash
git add web/app/(app)/agenda/page.tsx
git commit -m "feat(agenda): confirmação ao remover bloqueio (web)

O X na Timeline abre ConfirmDialog (escopo + motivo + intervalo) em vez de
apagar direto. Remover chama o deletarBloqueio existente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Mobile — hook `useRemoverBloqueio`

**Files:**
- Modify: `mobile/hooks/useAgenda.ts` (acrescentar após `useRecusarBloqueio`, linha ~361)

**Interfaces:**
- Consumes: `supabase`, `useMutation`, `useQueryClient` (já importados no arquivo).
- Produces: `export function useRemoverBloqueio(): UseMutationResult<string, Error, string>` — `mutateAsync(id)` resolve com o `id` ou lança `Error('Sem permissão para remover este bloqueio.')` quando a RLS zera as linhas. Invalida `['bloqueios-dia']`, `['bloqueios-pendentes']` e `['bloqueios-prof-dia']`.

- [ ] **Step 1: Capturar a baseline de tsc do mobile (antes de qualquer mudança mobile)**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -20; echo "---"; cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: anotar o número (ex.: `10`) e a lista. É a baseline; nenhuma task mobile pode aumentá-la.

- [ ] **Step 2: Implementar o hook**

Acrescentar ao fim de `mobile/hooks/useAgenda.ts` (depois de `useRecusarBloqueio`):

```ts
/**
 * Remove um bloqueio de agenda (dona/gestora: qualquer um;
 * profissional: só o próprio pendente — a policy "bloqueios: excluir"
 * da migration 068 já decide). O `.select('id')` depois do `.delete()`
 * confirma que a linha existia e a RLS deixou passar: zero linhas vira
 * erro de permissão em vez de sucesso silencioso. Invalida as três
 * query keys de bloqueio usadas nas telas (empresa, pendentes, e a da
 * agenda da profissional).
 */
export function useRemoverBloqueio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para remover este bloqueio.');
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloqueios-dia'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-pendentes'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-prof-dia'] });
    },
  });
}
```

- [ ] **Step 3: tsc mobile na baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: mesmo número da baseline (Step 1). Zero erros novos.

- [ ] **Step 4: Commit**

```bash
git add mobile/hooks/useAgenda.ts
git commit -m "feat(agenda): hook useRemoverBloqueio (mobile)

delete + .select('id') com guarda de zero-linhas; invalida bloqueios-dia,
bloqueios-pendentes e bloqueios-prof-dia.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Mobile — componente `ConfirmarRemoverBloqueio`

**Files:**
- Create: `mobile/components/ConfirmarRemoverBloqueio.tsx`

**Interfaces:**
- Consumes: `react-native` (`Modal`, `View`, `Text`, `TouchableOpacity`), `date-fns` `format`, `@shared/bloqueios` `motivoBloqueioLabel`, `BloqueioAgenda` de `@/hooks/useAgenda`.
- Produces:
  ```ts
  export function ConfirmarRemoverBloqueio(props: {
    visible: boolean;
    bloqueio: BloqueioAgenda | null;
    profNome: string | null;   // nome do profissional quando escopo = 'profissional'
    removendo?: boolean;
    onCancelar: () => void;
    onConfirmar: () => void;
  }): JSX.Element | null
  ```

- [ ] **Step 1: Criar o componente**

Criar `mobile/components/ConfirmarRemoverBloqueio.tsx`:

```tsx
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { format } from 'date-fns';
import { motivoBloqueioLabel } from '@shared/bloqueios';
import type { BloqueioAgenda } from '@/hooks/useAgenda';

const C = {
  surface: '#FFFFFF', border: '#E8E2DC', bg2: '#F4F1EE',
  ink: '#1A1228', ink2: '#4A3F63', ink3: '#8878A6', rose: '#C9527F',
};

/**
 * Diálogo nativo centralizado de confirmação para remover um bloqueio
 * de agenda — equivalente ao ConfirmDialog usado no web. Mostra escopo
 * ("Toda a agenda" ou o nome do profissional), motivo e intervalo, e um
 * aviso extra quando o bloqueio ainda está pendente de aprovação.
 */
export function ConfirmarRemoverBloqueio({
  visible, bloqueio, profNome, removendo = false, onCancelar, onConfirmar,
}: {
  visible: boolean;
  bloqueio: BloqueioAgenda | null;
  profNome: string | null;
  removendo?: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  if (!bloqueio) return null;

  const alvo = bloqueio.escopo === 'geral' ? 'Toda a agenda' : (profNome ?? 'Profissional');
  const intervalo =
    `${format(new Date(bloqueio.data_inicio), "dd/MM 'às' HH:mm")}–${format(new Date(bloqueio.data_fim), 'HH:mm')}`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 360, backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 20 }}>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 17, color: C.ink }}>
            Remover bloqueio?
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.ink2, marginTop: 8 }}>
            {alvo} · {motivoBloqueioLabel(bloqueio.motivo)} · {intervalo}.
          </Text>
          {bloqueio.situacao === 'pendente' && (
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.ink3, marginTop: 6 }}>
              Este pedido ainda aguarda aprovação.
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
            <TouchableOpacity onPress={onCancelar} disabled={removendo}
              style={{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2, alignItems: 'center', justifyContent: 'center', opacity: removendo ? 0.5 : 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.ink2 }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirmar} disabled={removendo}
              style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: C.rose, alignItems: 'center', justifyContent: 'center', opacity: removendo ? 0.5 : 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>
                {removendo ? 'Removendo...' : 'Remover'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: tsc mobile na baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: mesmo número da baseline. (O componente ainda não é importado por ninguém — só precisa compilar.)

- [ ] **Step 3: Commit**

```bash
git add mobile/components/ConfirmarRemoverBloqueio.tsx
git commit -m "feat(agenda): componente nativo ConfirmarRemoverBloqueio (mobile)

Diálogo centralizado equivalente ao ConfirmDialog do web: escopo, motivo,
intervalo e aviso de pendente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Mobile — remover bloqueio + guarda no `SlotVazio` na agenda `(empresa)`

**Files:**
- Modify: `mobile/app/(empresa)/agenda.tsx`
  - imports (linhas ~32–40)
  - `SlotVazio` (linha ~176) — receber e respeitar `bloqueado`
  - estado da tela + render do bloco (linha ~578) + render do `SlotVazio` (linha ~576) + montar o modal

**Interfaces:**
- Consumes: `useRemoverBloqueio` (Task 6); `ConfirmarRemoverBloqueio` (Task 7); `bloqueioNoInstante` (Task 1); `bloqueios` de `useBloqueiosDia` (já na tela); `user`, `meuRole` (já na tela); `profissionais` de `useProfissionais` (já na tela).
- Produces: nada para outras tasks.

- [ ] **Step 1: Imports**

Acrescentar aos imports do topo:

```tsx
import { X } from 'lucide-react-native';
import { bloqueioNoInstante } from '@shared/bloqueios';
import { ConfirmarRemoverBloqueio } from '@/components/ConfirmarRemoverBloqueio';
```

E incluir `useRemoverBloqueio` na lista já importada de `@/hooks/useAgenda`:

```tsx
  useBloqueiosDia, useBloqueiosPendentes, useCriarBloqueio,
  useAprovarBloqueio, useRecusarBloqueio, useRemoverBloqueio,
```

(Se `X` já estiver importado de `lucide-react-native` no arquivo, não duplicar — apenas garantir que está na lista.)

- [ ] **Step 2: `SlotVazio` respeita `bloqueado`**

Trocar a assinatura e o corpo de `SlotVazio` (linha ~176):

```tsx
function SlotVazio({ hora, dia, bloqueado }: { hora: number; dia: Date; bloqueado?: boolean }) {
  const horaISO = format(new Date(dia.setHours(hora, 0, 0, 0)), "yyyy-MM-dd'T'HH:mm");
  if (bloqueado) return null;

  return (
    <TouchableOpacity
      onPress={() => router.push(`/(empresa)/novo-agendamento?hora=${horaISO}` as any)}
```

- [ ] **Step 3: Estado do modal na tela**

Junto dos outros `useState` da tela (perto da linha ~216):

```tsx
  const remover = useRemoverBloqueio();
  const [bloqueioParaRemover, setBloqueioParaRemover] = useState<typeof bloqueios[number] | null>(null);
```

(`remover` — instância da mutação; usar `remover.isPending` para desabilitar.)

- [ ] **Step 4: Botão `X` no bloco + `SlotVazio bloqueado`**

No trecho que renderiza a hora (linha ~573–592), passar `bloqueado` ao `SlotVazio` e adicionar o `X` no bloco:

```tsx
                  {ags.length > 0 ? (
                    ags.map((ag, i) => <AgendamentoCard key={ag.id} ag={ag} index={i} />)
                  ) : bloqueiosPorHora[hora]?.length ? null : (
                    <SlotVazio
                      hora={hora}
                      dia={new Date(diaSelecionado)}
                      bloqueado={!!bloqueioNoInstante(
                        bloqueios,
                        profFiltro ?? (bloqueios[0]?.profissional_id ?? ''),
                        new Date(new Date(diaSelecionado).setHours(hora, 0, 0, 0)).toISOString(),
                      )}
                    />
                  )}
                  {(bloqueiosPorHora[hora] ?? []).map((b) => {
                    const podeRemover =
                      meuRole === 'owner' || meuRole === 'gestor'
                      || (b.situacao === 'pendente' && b.criado_por === user?.id);
                    return (
                      <View key={b.id} style={{
                        borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,82,127,0.35)',
                        backgroundColor: b.situacao === 'pendente' ? 'rgba(201,82,127,0.06)' : '#FDF0F5',
                        padding: 10, marginBottom: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 8,
                      }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C9527F' }}>
                            {b.titulo || motivoBloqueioLabel(b.motivo)}
                          </Text>
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: '#8878A6' }}>
                            {format(new Date(b.data_inicio), 'HH:mm')}–{format(new Date(b.data_fim), 'HH:mm')}
                            {b.situacao === 'pendente' ? '  · aguardando aprovação' : ''}
                          </Text>
                        </View>
                        {podeRemover && (
                          <TouchableOpacity
                            onPress={() => setBloqueioParaRemover(b)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{ padding: 2 }}>
                            <X size={14} color="#C9527F" strokeWidth={2.5} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
```

- [ ] **Step 5: Montar o modal de confirmação**

Junto dos outros modais no fim do JSX (perto do `<BloqueioModal .../>`, linha ~600):

```tsx
      <ConfirmarRemoverBloqueio
        visible={!!bloqueioParaRemover}
        bloqueio={bloqueioParaRemover}
        profNome={
          bloqueioParaRemover && bloqueioParaRemover.escopo === 'profissional'
            ? (profissionais.find((p) => p.id === bloqueioParaRemover.profissional_id)?.nome ?? null)
            : null
        }
        removendo={remover.isPending}
        onCancelar={() => setBloqueioParaRemover(null)}
        onConfirmar={() => {
          if (!bloqueioParaRemover) return;
          remover.mutate(bloqueioParaRemover.id, {
            onSuccess: () => setBloqueioParaRemover(null),
            onError: (e: any) => {
              setBloqueioParaRemover(null);
              Alert.alert('Erro', e?.message ?? 'Não foi possível remover o bloqueio.');
            },
          });
        }}
      />
```

(`Alert` já é importado no arquivo — usado no aprovar/recusar. `profissionais` vem de `useProfissionais()`, já na tela; conferir o nome do campo — se for `{ id, nome }` usar como acima.)

- [ ] **Step 6: tsc mobile na baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: mesmo número da baseline. Zero erros novos. Se `typeof bloqueios[number]` reclamar, trocar por `import type { BloqueioAgenda } from '@/hooks/useAgenda'` e usar `BloqueioAgenda | null`.

- [ ] **Step 7: Verificação manual (por leitura)**

(a) Como dona/gestora, todo bloco mostra o `X`; como… (a tela `(empresa)` só é acessível a gestão, então o ramo `profissional` do `podeRemover` quase nunca dispara aqui — mas fica correto); (b) tocar no `X` abre o modal centralizado com escopo/motivo/intervalo; (c) confirmar chama `remover.mutate`, erro cai em `Alert`; (d) hora coberta por bloqueio não mostra o `SlotVazio`.

- [ ] **Step 8: Commit**

```bash
git add mobile/app/(empresa)/agenda.tsx
git commit -m "feat(agenda): remover bloqueio com confirmação + slot bloqueado (mobile empresa)

X no bloco (regra de papel) abre ConfirmarRemoverBloqueio; SlotVazio não
aparece em hora coberta por bloqueio.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Mobile — remover bloqueio + guarda no `SlotVazio` na agenda `(profissional)`

**Files:**
- Modify: `mobile/app/(profissional)/agenda.tsx`
  - imports (linhas ~27–34)
  - `SlotVazio` (linha ~151)
  - estado + render do bloco (linha ~409) + `SlotVazio` (linha ~407) + modal

**Interfaces:**
- Consumes: `useRemoverBloqueio` (Task 6); `ConfirmarRemoverBloqueio` (Task 7); `bloqueioNoInstante` (Task 1); `bloqueios` de `useBloqueiosProfissionalDia` (já na tela); `user` (já na tela).
- Produces: nada.

- [ ] **Step 1: Imports**

```tsx
import { X } from 'lucide-react-native';
import { bloqueioNoInstante, motivoBloqueioLabel } from '@shared/bloqueios';
import { ConfirmarRemoverBloqueio } from '@/components/ConfirmarRemoverBloqueio';
import { useRemoverBloqueio } from '@/hooks/useAgenda';
```

(`motivoBloqueioLabel` já é importado no arquivo na linha ~34 — não duplicar; apenas somar `bloqueioNoInstante` ao mesmo import. `X` — conferir se já vem de `lucide-react-native`.)

- [ ] **Step 2: `SlotVazio` respeita `bloqueado`**

Mesma mudança da Task 8 Step 2, aplicada ao `SlotVazio` deste arquivo (linha ~151): novo parâmetro `bloqueado?: boolean` e `if (bloqueado) return null;` logo após a linha do `horaISO`.

- [ ] **Step 3: Estado do modal**

Junto dos `useState` da tela (perto da linha ~181–193):

```tsx
  const remover = useRemoverBloqueio();
  const [bloqueioParaRemover, setBloqueioParaRemover] = useState<typeof bloqueios[number] | null>(null);
```

- [ ] **Step 4: `X` no bloco (só o próprio pendente) + `SlotVazio bloqueado`**

No trecho da hora (linha ~405–430):

```tsx
                  {ags.length > 0
                    ? ags.map((ag, i) => <AgendamentoCard key={ag.id} ag={ag} percentual={percentual} index={i} />)
                    : (bloqueiosPorHora[hora]?.length ? null : (
                        <SlotVazio
                          hora={hora}
                          dia={diaSelecionado}
                          bloqueado={!!bloqueioNoInstante(
                            bloqueios,
                            user?.id ?? '',
                            new Date(new Date(diaSelecionado).setHours(hora, 0, 0, 0)).toISOString(),
                          )}
                        />
                      ))
                  }
                  {(bloqueiosPorHora[hora] ?? []).map((b) => {
                    const podeRemover = b.situacao === 'pendente' && b.criado_por === user?.id;
                    return (
                      <View
                        key={b.id}
                        style={{
                          borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,82,127,0.35)',
                          backgroundColor: b.situacao === 'pendente' ? 'rgba(201,82,127,0.06)' : '#FDF0F5',
                          padding: 10, marginBottom: 6,
                          opacity: b.situacao === 'pendente' ? 0.6 : 1,
                          flexDirection: 'row', alignItems: 'flex-start', gap: 8,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C9527F' }}>
                            {b.titulo || motivoBloqueioLabel(b.motivo)}
                          </Text>
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
                            {format(new Date(b.data_inicio), 'HH:mm')}–{format(new Date(b.data_fim), 'HH:mm')}
                            {b.situacao === 'pendente' ? '  · aguardando aprovação' : ''}
                          </Text>
                        </View>
                        {podeRemover && (
                          <TouchableOpacity
                            onPress={() => setBloqueioParaRemover(b)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{ padding: 2 }}>
                            <X size={14} color="#C9527F" strokeWidth={2.5} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
```

- [ ] **Step 5: Modal**

Junto do `<BloqueioModal .../>` (linha ~435):

```tsx
      <ConfirmarRemoverBloqueio
        visible={!!bloqueioParaRemover}
        bloqueio={bloqueioParaRemover}
        profNome={null}
        removendo={remover.isPending}
        onCancelar={() => setBloqueioParaRemover(null)}
        onConfirmar={() => {
          if (!bloqueioParaRemover) return;
          remover.mutate(bloqueioParaRemover.id, {
            onSuccess: () => setBloqueioParaRemover(null),
            onError: (e: any) => {
              setBloqueioParaRemover(null);
              Alert.alert('Erro', e?.message ?? 'Não foi possível remover o bloqueio.');
            },
          });
        }}
      />
```

(Se `Alert` não estiver importado neste arquivo, somar `Alert` ao import de `react-native`.)

- [ ] **Step 6: tsc mobile na baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: mesmo número da baseline.

- [ ] **Step 7: Verificação manual (por leitura)**

(a) A profissional só vê `X` no **próprio** bloqueio **pendente**; bloqueio aprovado (ou geral) não tem `X`; (b) tocar abre o modal; confirmar remove; (c) hora coberta por bloqueio não mostra `SlotVazio`.

- [ ] **Step 8: Commit**

```bash
git add mobile/app/(profissional)/agenda.tsx
git commit -m "feat(agenda): remover próprio bloqueio pendente + slot bloqueado (mobile profissional)

X só no próprio bloqueio pendente, abre ConfirmarRemoverBloqueio; SlotVazio
não aparece em hora coberta por bloqueio.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Mobile — `novo-agendamento.tsx` reconhece o erro do trigger

**Files:**
- Modify: `mobile/app/(empresa)/novo-agendamento.tsx` (bloco de tratamento de erro do insert, linha ~395–402)

**Interfaces:**
- Consumes: mensagem do trigger da Task 2 (começa por `Horário bloqueado`); `Alert` (já importado).
- Produces: nada.

- [ ] **Step 1: Adicionar o ramo do erro de bloqueio**

Trocar o bloco (linha ~395):

```tsx
    if (error) {
      if (error.message.includes('Conflito')) {
        Alert.alert('Conflito de horário', 'Este profissional já tem um agendamento nesse período.');
      } else if (error.message.includes('Horário bloqueado')) {
        Alert.alert('Horário bloqueado', 'Esse horário está bloqueado na agenda. Remova o bloqueio para agendar nesse período.');
      } else {
        Alert.alert('Erro', error.message);
      }
      return;
    }
```

- [ ] **Step 2: tsc mobile na baseline**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: mesmo número da baseline.

- [ ] **Step 3: Verificação manual (por leitura)**

Salvar um agendamento cujo horário caia sobre bloqueio → o `insert` falha com a mensagem do trigger → cai no ramo novo → `Alert` amigável, sem vazar o texto cru do Postgres.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/(empresa)/novo-agendamento.tsx
git commit -m "feat(agenda): erro do trigger de bloqueio vira alerta amigável (mobile)

Novo ramo em novo-agendamento.tsx para 'Horário bloqueado' vindo do
trigger 074.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Verificação final do branch + documentação

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-bloqueio-agenda-aviso-remocao-e-trava-agendamento-design.md` (só se algum item de §2/§10 tiver mudado na execução)

- [ ] **Step 1: Web — tipos e suíte**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: zero erros de tipo; **toda** a suíte verde (inclui os casos novos da Task 1).

- [ ] **Step 2: Mobile — baseline intacta**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: **igual** ao número da baseline capturado na Task 6 Step 1. Se subiu, comparar a lista e corrigir os erros novos.

- [ ] **Step 3: Varredura de acento na mensagem do trigger**

Run: `cd "$(git rev-parse --show-toplevel)" && grep -rn "Horário bloqueado" supabase/migrations/074_agendamentos_recusa_bloqueio.sql mobile/app/(empresa)/novo-agendamento.tsx`
Expected: a substring casa exatamente (mesmo acento) entre o `raise` e o `includes`.

- [ ] **Step 4: Checklist manual de costura (por leitura do diff completo do branch)**

- Web Timeline: clique em bloqueio (geral **e** do profissional; aprovado **e** pendente) não abre modal; corpo do bloco não borbulha; `X` abre `ConfirmDialog`; `podeRemover` inalterado.
- Web `NovoAgModal`: faixa vermelha + botão desabilitado quando o intervalo cai em bloqueio; recarrega ao trocar a data; `salvar()` tem a guarda; conflito agendamento×agendamento e "Agendar mesmo assim" **intactos**.
- Mobile: `X` só aparece conforme papel (`(empresa)`: gestão sempre; `(profissional)`: só o próprio pendente); modal centralizado; `remover.mutate` com `onError` em `Alert`; guarda de duplo-toque via `removendo`/`isPending`.
- Mobile `novo-agendamento`: ramo `Horário bloqueado`.
- Trigger 074: `security definer` + `search_path`; meia-aberto; ignora `cancelado/faltou`; guarda de `UPDATE` sem mudança de horário.
- Parte C: `grep -rn "onKeyDown={avancarComEnter}" web/app | wc -l` = **11**; nenhum form de `configuracoes` nem de autenticação tocado; `web/lib/formNav.ts` e `web/tests/unit/form-nav.test.tsx` presentes e verdes.

- [ ] **Step 5: Atualizar a spec se algo divergiu**

Se durante a execução algum ponto de §2 ("Não entra") ou §10 ("Pendências") mudou, editar a spec para refletir. Caso contrário, sem mudança.

- [ ] **Step 6: Commit (se houve edição de doc)**

```bash
git add docs/superpowers/specs/2026-09-05-bloqueio-agenda-aviso-remocao-e-trava-agendamento-design.md
git commit -m "docs(spec): ajustes pós-execução do bloqueio de agenda

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Encerrar o branch**

Usar a skill `superpowers:finishing-a-development-branch` para abrir o PR (lembrar: `gh auth switch --user ruan-lopes16` antes de qualquer push/PR). **Não** fazer merge sem pedido explícito do usuário.

---

## Self-Review (feito pelo autor do plano)

**1. Cobertura da spec**

| Requisito da spec | Task |
|---|---|
| §3 funções puras `bloqueioEmConflito` / `bloqueioNoInstante` + TDD | 1 |
| §4 migration 074 (trigger `SECURITY DEFINER`, meia-aberto, ignora cancelado/faltou, guarda de UPDATE) | 2 |
| §5.1 clique bloqueado na Timeline + `stopPropagation` no corpo do bloco | 3 |
| §5.2 `NovoAgModal`: carga dos bloqueios do dia, faixa vermelha, submit desabilitado, guarda em `salvar()` | 4 |
| §5.3 conflito agendamento×agendamento intacto | 3, 4 (não tocam esse caminho) + 11 (checklist) |
| §6 confirmação centralizada ao remover (web) — reusa `ConfirmDialog` | 5 |
| §7 `useRemoverBloqueio` + modal centralizado mobile + fio nas 2 telas | 6, 7, 8, 9 |
| §8.1 `SlotVazio` reforçado | 8, 9 |
| §8.2 erro do trigger amigável no `novo-agendamento.tsx` | 10 |
| §9 RLS sem novidade (usa a policy 068) | 6 (comentário do hook) |
| §10 pendências de produção (aplicar 074 + antigas) | 2 Step 3, 11 Step 5 |

Decisões tomadas no plano (dentro do que a spec deixou aberto):
- Web: reusar `ConfirmDialog` em vez de criar `ConfirmarRemoverBloqueioModal` novo — DRY, é o padrão já usado no "Excluir agendamento". (A spec previa componente novo; a reutilização é estritamente melhor e não muda o comportamento.)
- Mobile `novo-agendamento.tsx`: **sem** pré-check reativo (a spec marcou como opcional). Trigger + `Alert` amigável, igual ao tratamento de `Conflito` que já existe.

Fora da spec original (pedidos feitos durante o planejamento, aceitos na mesma branch):
- **Task 0** — alinhamento do `NovoBloqueioModal` no PWA iOS + Início/Fim compactos. Não tem relação com a lógica de bloqueio; entra por ser o mesmo arquivo/feature e roda primeiro.
- **Tasks 0b/0c** — Parte C da spec (§12): helper `avancarComEnter` + aplicação nos 11 `<form>` de modal do web. Enter avança campo, no último foca o submit sem enviar. Fora: `configuracoes` (página inteira) e autenticação; e o app nativo (RN não tem Tab).

**2. Placeholders:** nenhum "TBD"/"etc." — todo passo tem código ou comando completo.

**3. Consistência de tipos:** `BlocoParaChecagem` (T1) é consumido por T3/T4 via os tipos `Bloqueio` (web) e `BloqueioAgenda` (mobile), estruturalmente compatíveis. `useRemoverBloqueio` (T6) → `remover.mutate(id, {onSuccess,onError})` e `remover.isPending` usados igual em T8/T9. `ConfirmarRemoverBloqueio` (T7) props (`visible`, `bloqueio`, `profNome`, `removendo`, `onCancelar`, `onConfirmar`) batem com T8/T9. Mensagem `Horário bloqueado` definida em T2 e casada em T10/T11.
