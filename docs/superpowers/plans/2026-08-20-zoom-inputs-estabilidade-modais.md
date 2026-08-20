# Zoom em inputs e estabilidade dos modais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar o zoom automático do iOS ao focar campos no web/PWA e remover as movimentações desnecessárias dos modais (redimensionamento por `vh`, deslocamento de 5px no desktop, perda da posição de rolagem).

**Architecture:** Quatro mudanças de CSS/configuração global (fonte dos campos, viewport, `dvh`, `scrollbar-gutter`) mais um hook novo `useScrollLock` com contador de referência em nível de módulo, aplicado nos 21 componentes que renderizam modal. Nenhuma migration, nenhuma query, nenhuma mudança de comportamento de dados.

**Tech Stack:** Next.js 15 App Router, Tailwind CSS v4 (tokens em `@theme`, sem `tailwind.config.js`), Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-20-zoom-inputs-estabilidade-modais-design.md`

## Global Constraints

- **Escopo é 100% web.** Nenhum arquivo em `mobile/` pode ser tocado — React Native não tem viewport HTML nem zoom de foco do iOS.
- **Sem migration, sem RLS, sem query nova.** Nenhuma tabela ou política é criada ou alterada.
- **Nenhuma funcionalidade some.** Nenhum campo, botão, texto ou tela perde comportamento.
- `npx tsc --noEmit` rodado de dentro de `web/` precisa terminar **zerado**.
- `npm test` (vitest) rodado de dentro de `web/` precisa terminar **verde**, incluindo os testes que já existiam.
- Comentários e JSDoc em **português**, sem acentos dentro de blocos JSDoc (padrão já usado em `shared/despesas.ts` e `shared/taxa-reserva.ts`).
- Mensagens de commit em português, prefixo `fix:` / `feat:` / `test:`, e sempre terminando com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Nunca usar `--no-verify`.
- Todos os comandos rodam a partir de `web/` (ex.: `cd web && npm test`).

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `web/app/globals.css` | Regra de fonte 16px, `scrollbar-gutter` | Modificar |
| `web/app/layout.tsx` | `viewport` com `maximumScale` / `userScalable` | Modificar |
| `web/lib/useScrollLock.ts` | Hook de trava de scroll com contador de referência | **Criar** |
| 9 páginas + 2 componentes | Trocar `vh` por `dvh` e chamar o hook | Modificar |
| `web/tests/unit/zoom-inputs-modais.test.ts` | Asserções de CSS/viewport/`dvh` | **Criar** |
| `web/tests/unit/use-scroll-lock.test.ts` | Testes de comportamento do hook | **Criar** |
| `web/tests/unit/scroll-lock-modais.test.ts` | Asserções de que cada modal chama o hook | **Criar** |

---

### Task 1: Bloqueio de zoom (fonte 16px + viewport + scrollbar-gutter)

**Files:**
- Modify: `web/app/globals.css:129-137` (bloco `html, body`), `web/app/globals.css:275-278` (regra de fonte)
- Modify: `web/app/layout.tsx:35-39`
- Test: `web/tests/unit/zoom-inputs-modais.test.ts` (criar)

**Interfaces:**
- Consumes: nada (primeira task)
- Produces: nada consumido por outras tasks — é mudança de CSS/config isolada

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/tests/unit/zoom-inputs-modais.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

describe('bloqueio de zoom em inputs (web/PWA)', () => {
  it('trava a fonte dos campos em 16px no mobile, vencendo as classes do Tailwind', () => {
    const css = read('app/globals.css');

    // O seletor precisa excluir checkbox/radio (fonte altera o tamanho da caixa)
    // e a declaracao precisa ser !important para vencer `text-sm` (13px no mobile).
    expect(css).toMatch(
      /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\),[\s\S]{0,120}font-size:\s*16px\s*!important/,
    );

    // A regra antiga era inerte (perdia para a classe do Tailwind na cascata)
    // e nao pode sobreviver ao lado da nova.
    expect(css).not.toContain('font-size: max(16px, var(--text-base))');
  });

  it('desliga o pinch-zoom no PWA instalado sem perder o viewport-fit', () => {
    const layout = read('app/layout.tsx');

    expect(layout).toMatch(/maximumScale:\s*1/);
    expect(layout).toMatch(/userScalable:\s*false/);
    // viewportFit sustenta todos os env(safe-area-inset-*) do app — nao pode sumir.
    expect(layout).toContain("viewportFit: 'cover'");
  });

  it('reserva a calha da scrollbar para o modal nao deslocar a pagina no desktop', () => {
    expect(read('app/globals.css')).toMatch(/scrollbar-gutter:\s*stable/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/zoom-inputs-modais.test.ts
```

Esperado: 3 testes FALHANDO. O primeiro por não encontrar o seletor com `!important`; o segundo por não encontrar `maximumScale`; o terceiro por não encontrar `scrollbar-gutter`.

- [ ] **Step 3: Trocar a regra de fonte em `web/app/globals.css`**

Substituir o bloco atual (linhas 275-278):

```css
/* ── Mobile: previne zoom automático do iOS ao focar inputs ── */
@media (max-width: 767px) {
  input, select, textarea { font-size: max(16px, var(--text-base)); }
}
```

por:

```css
/* ── Mobile: previne zoom automático do iOS ao focar inputs ──
   O iOS Safari dá zoom em qualquer campo com fonte < 16px e não desfaz ao
   desfocar. O !important é necessário: os inputClass do projeto usam a classe
   `text-sm` do Tailwind, que vale 13px no mobile (--text-sm em @theme) e vence
   qualquer seletor de elemento na cascata — era por isso que a regra anterior,
   sem !important, nunca teve efeito. Verificado que nenhum campo do projeto usa
   fonte maior que a base, então travar em 16px não encolhe nada. Checkbox e
   radio ficam de fora: não têm texto e a fonte altera o tamanho da caixa. */
@media (max-width: 767px) {
  input:not([type='checkbox']):not([type='radio']),
  select,
  textarea {
    font-size: 16px !important;
  }
}
```

- [ ] **Step 4: Adicionar `scrollbar-gutter` em `web/app/globals.css`**

Logo **depois** do bloco `html, body { ... }` que termina na linha 137, inserir:

```css
/* Reserva a calha da scrollbar permanentemente. Sem isso, a trava de fundo dos
   modais (html:has(.bm-modal){overflow:hidden}) remove a scrollbar de 5px
   definida abaixo e desloca a página inteira 5px ao abrir qualquer modal. */
html { scrollbar-gutter: stable; }
```

- [ ] **Step 5: Ajustar o viewport em `web/app/layout.tsx`**

Substituir (linhas 35-39):

```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
```

por:

```ts
/**
 * maximumScale + userScalable desligam o pinch-zoom. O iOS ignora os dois no
 * Safari em aba normal (decisao de acessibilidade da Apple desde o iOS 10), mas
 * respeita no PWA instalado na tela de inicio — que e como o app e usado. Quem
 * de fato resolve o zoom de foco em todos os contextos e a regra de 16px em
 * globals.css; isto aqui e reforco.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

```bash
cd web && npx vitest run tests/unit/zoom-inputs-modais.test.ts
```

Esperado: 3 testes PASSANDO.

- [ ] **Step 7: Rodar a suíte inteira e o TypeScript**

```bash
cd web && npm test && npx tsc --noEmit
```

Esperado: toda a suíte verde (incluindo `mobile-layout-regressions.test.ts`, que também lê `app/layout.tsx` e `app/globals.css`) e `tsc` sem nenhuma saída.

- [ ] **Step 8: Commit**

```bash
git add web/app/globals.css web/app/layout.tsx web/tests/unit/zoom-inputs-modais.test.ts
git commit -m "fix: trava fonte dos campos em 16px e desliga pinch-zoom no PWA

A regra preventiva de 16px existia desde a sessao de responsividade mas era
inerte: seletor de elemento perde para a classe text-sm do Tailwind (13px no
mobile), entao todos os ~142 campos do web davam zoom ao focar no iOS.

Tambem reserva a calha da scrollbar, que sumia ao abrir modal e deslocava a
pagina 5px no desktop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `vh` → `dvh` nos modais e áreas roláveis

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx:567,1155,1336`
- Modify: `web/app/(app)/clientes/page.tsx:90`
- Modify: `web/app/(app)/clientes/[id]/page.tsx:202`
- Modify: `web/app/(app)/equipe/page.tsx:113,240`
- Modify: `web/app/(app)/estoque/page.tsx:205,484`
- Modify: `web/app/(app)/financeiro/page.tsx:189,351,473`
- Modify: `web/app/(app)/pacotes/page.tsx:189,382,497`
- Modify: `web/app/(app)/servicos/page.tsx:234`
- Modify: `web/app/(app)/vendas/page.tsx:358,361`
- Test: `web/tests/unit/zoom-inputs-modais.test.ts` (adicionar bloco)

**Interfaces:**
- Consumes: nada da Task 1 (arquivos disjuntos)
- Produces: nada consumido por outras tasks

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `web/tests/unit/zoom-inputs-modais.test.ts` (dentro do arquivo, como um novo `describe` irmão):

```ts
describe('modais ancorados no viewport dinamico', () => {
  const arquivos = [
    'app/(app)/agenda/page.tsx',
    'app/(app)/clientes/page.tsx',
    'app/(app)/clientes/[id]/page.tsx',
    'app/(app)/equipe/page.tsx',
    'app/(app)/estoque/page.tsx',
    'app/(app)/financeiro/page.tsx',
    'app/(app)/pacotes/page.tsx',
    'app/(app)/servicos/page.tsx',
    'app/(app)/vendas/page.tsx',
  ];

  // `vh` mede o viewport grande no iOS (barra de URL escondida): o modal fica
  // mais alto que a area visivel e muda de altura sozinho quando a barra
  // aparece/some. O padrao \dvh casa "90vh" (digito antes de "vh") mas nao
  // casa "90dvh" (o caractere antes de "vh" e o "d").
  it.each(arquivos)('%s nao usa mais unidades vh', (arquivo) => {
    expect(read(arquivo)).not.toMatch(/\dvh/);
  });

  it('preserva as alturas originais, agora em dvh', () => {
    const agenda = read('app/(app)/agenda/page.tsx');
    expect(agenda).toContain('max-h-[90dvh]');
    expect(agenda).toContain('max-h-[85dvh]');
    expect(agenda).toContain("maxHeight: '62dvh'");

    expect(read('app/(app)/financeiro/page.tsx')).toContain('max-h-[90dvh]');
    expect(read('app/(app)/pacotes/page.tsx')).toContain('max-h-[94dvh]');

    const vendas = read('app/(app)/vendas/page.tsx');
    expect(vendas).toContain('max-h-[50dvh]');
    expect(vendas).toContain('md:h-[calc(100dvh-220px)]');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/zoom-inputs-modais.test.ts
```

Esperado: os 9 casos do `it.each` FALHANDO (todos os arquivos ainda contêm `vh`), mais o teste de alturas FALHANDO.

- [ ] **Step 3: Fazer as 19 substituições**

São 19 ocorrências. Trocar **exatamente** estes textos, sem alterar mais nada da linha:

| Arquivo | Linha | De | Para |
|---|---|---|---|
| `web/app/(app)/agenda/page.tsx` | 567 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/agenda/page.tsx` | 1155 | `maxHeight: '62vh'` | `maxHeight: '62dvh'` |
| `web/app/(app)/agenda/page.tsx` | 1336 | `max-h-[85vh]` | `max-h-[85dvh]` |
| `web/app/(app)/clientes/page.tsx` | 90 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/clientes/[id]/page.tsx` | 202 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/equipe/page.tsx` | 113 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/equipe/page.tsx` | 240 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/estoque/page.tsx` | 205 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/estoque/page.tsx` | 484 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/financeiro/page.tsx` | 189 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/financeiro/page.tsx` | 351 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/financeiro/page.tsx` | 473 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/pacotes/page.tsx` | 189 | `max-h-[94vh]` **e** `max-h-[90vh]` (duas na mesma linha, num ternário) | `max-h-[94dvh]` e `max-h-[90dvh]` |
| `web/app/(app)/pacotes/page.tsx` | 382 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/pacotes/page.tsx` | 497 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/servicos/page.tsx` | 234 | `max-h-[90vh]` | `max-h-[90dvh]` |
| `web/app/(app)/vendas/page.tsx` | 358 | `md:h-[calc(100vh-220px)]` | `md:h-[calc(100dvh-220px)]` |
| `web/app/(app)/vendas/page.tsx` | 361 | `max-h-[50vh]` | `max-h-[50dvh]` |

Dois pontos de atenção:

1. `web/app/(app)/pacotes/page.tsx:189` é uma linha só com **duas** ocorrências, dentro de um ternário:
   ```tsx
   <div className={`relative bg-surface rounded-2xl shadow-xl w-full flex flex-col transition-all duration-200 ${addindoServico ? 'max-w-lg max-h-[94vh]' : 'max-w-md max-h-[90vh]'}`}>
   ```
   O `transition-all duration-200` dessa linha é **intencional** (anima a troca de largura ao abrir o sub-formulário de serviço) e **fica como está** — não é uma das movimentações a remover.

2. `web/app/(app)/vendas/page.tsx:358` está atrás do prefixo `md:` (só desktop, onde `vh` e `dvh` são idênticos). Converte junto por consistência; não tem efeito prático.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd web && npx vitest run tests/unit/zoom-inputs-modais.test.ts
```

Esperado: todos os testes do arquivo PASSANDO (3 da Task 1 + 9 do `it.each` + 1 de alturas).

- [ ] **Step 5: Confirmar que não sobrou nenhum `vh`**

```bash
cd web && grep -rEn "[0-9]vh" "app/(app)/agenda/page.tsx" "app/(app)/clientes/page.tsx" "app/(app)/clientes/[id]/page.tsx" "app/(app)/equipe/page.tsx" "app/(app)/estoque/page.tsx" "app/(app)/financeiro/page.tsx" "app/(app)/pacotes/page.tsx" "app/(app)/servicos/page.tsx" "app/(app)/vendas/page.tsx"
```

Esperado: **nenhuma linha de saída** (exit code 1 do grep é o resultado correto aqui).

- [ ] **Step 6: Rodar a suíte inteira e o TypeScript**

```bash
cd web && npm test && npx tsc --noEmit
```

Esperado: suíte verde, `tsc` sem saída.

- [ ] **Step 7: Commit**

```bash
git add web/app web/tests/unit/zoom-inputs-modais.test.ts
git commit -m "fix: ancora modais no viewport dinamico (vh -> dvh)

vh mede o viewport grande no iOS, com a barra de URL escondida. Os modais
ficavam mais altos que a area visivel (botao de salvar atras da barra do
Safari) e mudavam de altura sozinhos quando a barra aparecia ou sumia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Hook `useScrollLock`

**Files:**
- Create: `web/lib/useScrollLock.ts`
- Test: `web/tests/unit/use-scroll-lock.test.ts` (criar)

**Interfaces:**
- Consumes: nada
- Produces: `useScrollLock(ativo?: boolean, opcoes?: { apenasMobile?: boolean }): void`, exportado de `web/lib/useScrollLock.ts`, importado como `import { useScrollLock } from '@/lib/useScrollLock';`. As Tasks 4 e 5 dependem exatamente dessa assinatura.

- [ ] **Step 1: Escrever os testes que falham**

Criar `web/tests/unit/use-scroll-lock.test.ts`:

```tsx
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScrollLock } from '@/lib/useScrollLock';

function definirScroll(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
}

function definirLargura(w: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, writable: true, configurable: true });
}

describe('useScrollLock', () => {
  beforeEach(() => {
    // O cleanup automatico do @testing-library/react (ativo porque o vitest roda
    // com globals: true) desmonta os hooks entre os testes, zerando o contador
    // de referencia do modulo. Aqui so limpamos o que sobra no DOM.
    document.body.style.cssText = '';
    definirScroll(0);
    definirLargura(1024);
    // jsdom nao implementa scrollTo — sem o stub ele emite "Not implemented".
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it('fixa o body no offset da rolagem atual', () => {
    definirScroll(320);

    renderHook(() => useScrollLock());

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-320px');
    expect(document.body.style.width).toBe('100%');
  });

  it('restaura a posicao exata ao desmontar', () => {
    definirScroll(320);

    const { unmount } = renderHook(() => useScrollLock());
    unmount();

    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 320);
  });

  it('nao destrava enquanto outro modal continuar aberto', () => {
    definirScroll(150);

    const debaixo = renderHook(() => useScrollLock());
    const emCima  = renderHook(() => useScrollLock());

    emCima.unmount();
    expect(document.body.style.position).toBe('fixed');
    expect(window.scrollTo).not.toHaveBeenCalled();

    debaixo.unmount();
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 150);
  });

  it('nao faz nada quando inativo', () => {
    definirScroll(80);

    renderHook(() => useScrollLock(false));

    expect(document.body.style.position).toBe('');
  });

  it('trava quando ativo passa de false para true', () => {
    definirScroll(80);

    const { rerender } = renderHook(({ aberto }) => useScrollLock(aberto), {
      initialProps: { aberto: false },
    });
    expect(document.body.style.position).toBe('');

    rerender({ aberto: true });
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-80px');
  });

  it('com apenasMobile, ignora larguras de desktop', () => {
    definirScroll(80);
    definirLargura(1280);

    renderHook(() => useScrollLock(true, { apenasMobile: true }));

    expect(document.body.style.position).toBe('');
  });

  it('com apenasMobile, trava abaixo do breakpoint', () => {
    definirScroll(80);
    definirLargura(390);

    renderHook(() => useScrollLock(true, { apenasMobile: true }));

    expect(document.body.style.position).toBe('fixed');
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
cd web && npx vitest run tests/unit/use-scroll-lock.test.ts
```

Esperado: falha de resolução do módulo — `Failed to resolve import "@/lib/useScrollLock"`.

- [ ] **Step 3: Implementar o hook**

Criar `web/lib/useScrollLock.ts`:

```ts
'use client';

import { useEffect } from 'react';

/** Mesmo breakpoint usado pelas media queries de mobile em globals.css. */
const BREAKPOINT_MOBILE = 767;

/**
 * Quantos modais estao com a trava aplicada agora. Vive no modulo (nao no
 * componente) porque dois modais podem estar abertos ao mesmo tempo — ex.: um
 * ConfirmDialog por cima de um formulario — e fechar o de cima nao pode
 * destravar a pagina enquanto o de baixo continuar aberto.
 */
let travas = 0;

/**
 * Posicao de rolagem no instante em que a primeira trava foi aplicada. Tambem
 * vive no modulo: se ficasse no componente, o modal de cima restauraria a
 * posicao errada ao fechar.
 */
let scrollSalvo = 0;

function aplicarTrava() {
  scrollSalvo = window.scrollY;
  const { style } = document.body;
  style.position = 'fixed';
  style.top = `-${scrollSalvo}px`;
  style.left = '0';
  style.right = '0';
  style.width = '100%';
}

function removerTrava() {
  const { style } = document.body;
  style.position = '';
  style.top = '';
  style.left = '';
  style.right = '';
  style.width = '';
  window.scrollTo(0, scrollSalvo);
}

/**
 * Trava a rolagem da pagina de fundo enquanto um modal esta aberto e restaura a
 * posicao exata ao fechar.
 *
 * Usa `position: fixed` no body com offset negativo, em vez de apenas
 * `overflow: hidden` no html: essa e a unica tecnica que *garante* a
 * restauracao da posicao no iOS, em vez de depender do comportamento do
 * browser. A regra CSS `html:has(.bm-modal){overflow:hidden}` continua no
 * globals.css como rede de seguranca e nao conflita com esta trava.
 *
 * @param ativo Quando false, o hook nao faz nada. Necessario para componentes
 *   que fazem `if (!open) return null`: o hook precisa rodar em toda
 *   renderizacao (regras dos hooks) mas so deve agir com o modal visivel. Em
 *   modais que o componente pai monta e desmonta condicionalmente, chamar sem
 *   argumento basta.
 * @param opcoes.apenasMobile Quando true, so trava abaixo de 768px. Usado pelos
 *   modais marcados com `md:hidden`, que nem existem no desktop — travar a
 *   pagina la seria um bug (foi exatamente o que aconteceu com o painel
 *   Detalhes da Agenda antes da variante `.bm-modal-mobile`).
 */
export function useScrollLock(
  ativo: boolean = true,
  opcoes?: { apenasMobile?: boolean },
): void {
  const apenasMobile = opcoes?.apenasMobile ?? false;

  useEffect(() => {
    if (!ativo) return;
    if (apenasMobile && window.innerWidth > BREAKPOINT_MOBILE) return;

    if (travas === 0) aplicarTrava();
    travas += 1;

    return () => {
      travas -= 1;
      if (travas === 0) removerTrava();
    };
  }, [ativo, apenasMobile]);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
cd web && npx vitest run tests/unit/use-scroll-lock.test.ts
```

Esperado: 7 testes PASSANDO.

- [ ] **Step 5: Rodar a suíte inteira e o TypeScript**

```bash
cd web && npm test && npx tsc --noEmit
```

Esperado: suíte verde, `tsc` sem saída.

- [ ] **Step 6: Commit**

```bash
git add web/lib/useScrollLock.ts web/tests/unit/use-scroll-lock.test.ts
git commit -m "feat: adiciona hook useScrollLock com contador de referencia

Trava a rolagem de fundo com position:fixed + offset negativo no body, que
garante a restauracao da posicao no iOS em vez de depender do comportamento
do browser. O contador em nivel de modulo cobre modais empilhados.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Aplicar o hook nos 16 modais autônomos

Modais que o componente pai monta e desmonta condicionalmente (`{estado && <Modal .../>}`) — para esses, `useScrollLock()` sem argumento na primeira linha do corpo do componente é suficiente.

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` (`NovoAgModal`, `NovoBloqueioModal`, `AvaliacaoModal`)
- Modify: `web/app/(app)/clientes/page.tsx` (`NovoClienteModal`)
- Modify: `web/app/(app)/clientes/[id]/page.tsx` (`NovoAgModal`)
- Modify: `web/app/(app)/equipe/page.tsx` (`NovoProfModal`, `EditInfoModal`)
- Modify: `web/app/(app)/estoque/page.tsx` (`ProdutoModal`, `MovModal`)
- Modify: `web/app/(app)/financeiro/page.tsx` (`NovaDespesaModal`, `MarcarPagoModal`, `EditarDespesaModal`)
- Modify: `web/app/(app)/pacotes/page.tsx` (`PacoteModal`, `VenderModal`, `SessaoModal`)
- Modify: `web/app/(app)/servicos/page.tsx` (`ServicoModal`)
- Test: `web/tests/unit/scroll-lock-modais.test.ts` (criar)

**Interfaces:**
- Consumes: `useScrollLock(ativo?: boolean, opcoes?: { apenasMobile?: boolean }): void` de `@/lib/useScrollLock` (Task 3)
- Produces: nada consumido por outras tasks

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/tests/unit/scroll-lock-modais.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

/**
 * Recorta o inicio do corpo de um componente para checar que a chamada do hook
 * esta nele, e nao em outro componente do mesmo arquivo. A janela de 3000
 * caracteres cobre com folga a assinatura mais longa do projeto (NovoAgModal da
 * Agenda) ate a primeira linha do corpo.
 */
function inicioDoComponente(src: string, nome: string): string {
  const inicio = src.indexOf(`function ${nome}(`);
  expect(inicio, `componente ${nome} nao encontrado no arquivo`).toBeGreaterThan(-1);
  return src.slice(inicio, inicio + 3000);
}

const modaisAutonomos: [string, string[]][] = [
  ['app/(app)/agenda/page.tsx',        ['NovoAgModal', 'NovoBloqueioModal', 'AvaliacaoModal']],
  ['app/(app)/clientes/page.tsx',      ['NovoClienteModal']],
  ['app/(app)/clientes/[id]/page.tsx', ['NovoAgModal']],
  ['app/(app)/equipe/page.tsx',        ['NovoProfModal', 'EditInfoModal']],
  ['app/(app)/estoque/page.tsx',       ['ProdutoModal', 'MovModal']],
  ['app/(app)/financeiro/page.tsx',    ['NovaDespesaModal', 'MarcarPagoModal', 'EditarDespesaModal']],
  ['app/(app)/pacotes/page.tsx',       ['PacoteModal', 'VenderModal', 'SessaoModal']],
  ['app/(app)/servicos/page.tsx',      ['ServicoModal']],
];

describe('trava de scroll nos modais autonomos', () => {
  it.each(modaisAutonomos)('%s importa o hook', (arquivo) => {
    expect(read(arquivo)).toContain("import { useScrollLock } from '@/lib/useScrollLock';");
  });

  it.each(modaisAutonomos.flatMap(([arquivo, comps]) =>
    comps.map((comp) => [arquivo, comp] as [string, string]),
  ))('%s: %s chama useScrollLock()', (arquivo, componente) => {
    expect(inicioDoComponente(read(arquivo), componente)).toContain('useScrollLock();');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/scroll-lock-modais.test.ts
```

Esperado: os 8 casos de import FALHANDO e os 16 casos de chamada FALHANDO.

- [ ] **Step 3: Adicionar o import nos 8 arquivos**

Em cada um dos 8 arquivos listados, adicionar junto aos outros imports de `@/lib` / `@/components`:

```ts
import { useScrollLock } from '@/lib/useScrollLock';
```

- [ ] **Step 4: Adicionar a chamada como primeira linha do corpo de cada um dos 16 componentes**

Padrão a aplicar — exemplo real com `NovaDespesaModal` de `web/app/(app)/financeiro/page.tsx:110`:

```tsx
function NovaDespesaModal({ empresaId, onClose, onSalvo }: {
  empresaId: string; onClose: () => void; onSalvo: () => void;
}) {
  useScrollLock();
  const [descricao, setDescricao] = useState('');
  // ... resto do componente, inalterado
```

A chamada vai **antes de qualquer `useState`**, como primeira instrução do corpo. Repetir literalmente nos 16 componentes:

| Arquivo | Componentes |
|---|---|
| `web/app/(app)/agenda/page.tsx` | `NovoAgModal` (linha 195), `NovoBloqueioModal` (911), `AvaliacaoModal` (1836) |
| `web/app/(app)/clientes/page.tsx` | `NovoClienteModal` (30) |
| `web/app/(app)/clientes/[id]/page.tsx` | `NovoAgModal` (106) |
| `web/app/(app)/equipe/page.tsx` | `NovoProfModal` (62), `EditInfoModal` (200) |
| `web/app/(app)/estoque/page.tsx` | `ProdutoModal` (125), `MovModal` (406) |
| `web/app/(app)/financeiro/page.tsx` | `NovaDespesaModal` (110), `MarcarPagoModal` (326), `EditarDespesaModal` (385) |
| `web/app/(app)/pacotes/page.tsx` | `PacoteModal` (98), `VenderModal` (303), `SessaoModal` (458) |
| `web/app/(app)/servicos/page.tsx` | `ServicoModal` (83) |

Atenção: `agenda/page.tsx` e `clientes/[id]/page.tsx` **ambos** têm um componente chamado `NovoAgModal` — são componentes diferentes, em arquivos diferentes, e os dois precisam da chamada.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
cd web && npx vitest run tests/unit/scroll-lock-modais.test.ts
```

Esperado: 24 casos PASSANDO (8 de import + 16 de chamada).

- [ ] **Step 6: Rodar a suíte inteira e o TypeScript**

```bash
cd web && npm test && npx tsc --noEmit
```

Esperado: suíte verde, `tsc` sem saída.

- [ ] **Step 7: Commit**

```bash
git add web/app web/tests/unit/scroll-lock-modais.test.ts
git commit -m "fix: aplica useScrollLock nos 16 modais autonomos

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Aplicar o hook nos 5 modais embutidos

Modais renderizados dentro de um componente maior, atrás de uma condição — para esses a chamada precisa receber o estado que abre o modal. Dois deles são `md:hidden` (só existem no mobile) e precisam de `apenasMobile: true`, senão travariam a página no desktop.

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx` (`TimelineView`, estado `agSel` declarado na linha 1053)
- Modify: `web/app/(app)/clientes/[id]/page.tsx` (`ClientePerfilPage`, estado `modalRemover`)
- Modify: `web/app/(app)/comissoes/ComissoesGestorView.tsx` (estado `pagando`)
- Modify: `web/components/Sidebar.tsx` (estado `maisAberto`)
- Modify: `web/components/ConfirmDialog.tsx` (prop `open`)
- Test: `web/tests/unit/scroll-lock-modais.test.ts` (adicionar bloco)

**Interfaces:**
- Consumes: `useScrollLock(ativo?: boolean, opcoes?: { apenasMobile?: boolean }): void` de `@/lib/useScrollLock` (Task 3)
- Produces: nada consumido por outras tasks

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `web/tests/unit/scroll-lock-modais.test.ts`:

```ts
describe('trava de scroll nos modais embutidos', () => {
  it('condiciona a trava ao estado que abre cada modal', () => {
    // md:hidden — o modal nem existe no desktop, travar la seria bug
    expect(read('app/(app)/agenda/page.tsx'))
      .toContain('useScrollLock(!!agSel, { apenasMobile: true })');
    expect(read('components/Sidebar.tsx'))
      .toContain('useScrollLock(maisAberto, { apenasMobile: true })');

    expect(read('app/(app)/clientes/[id]/page.tsx'))
      .toContain('useScrollLock(modalRemover)');
    expect(read('app/(app)/comissoes/ComissoesGestorView.tsx'))
      .toContain('useScrollLock(!!pagando)');
    // ConfirmDialog faz `if (!open) return null` — o hook fica acima do early
    // return, senao viola as regras dos hooks.
    expect(read('components/ConfirmDialog.tsx'))
      .toContain('useScrollLock(open)');
  });

  it('nenhum componente com .bm-modal ficou sem a trava', () => {
    // 21 componentes no total: 16 autonomos (Task 4) + 5 embutidos.
    const porArquivo: Record<string, number> = {
      'app/(app)/agenda/page.tsx':                  4,
      'app/(app)/clientes/page.tsx':                1,
      'app/(app)/clientes/[id]/page.tsx':           2,
      'app/(app)/comissoes/ComissoesGestorView.tsx': 1,
      'app/(app)/equipe/page.tsx':                  2,
      'app/(app)/estoque/page.tsx':                 2,
      'app/(app)/financeiro/page.tsx':              3,
      'app/(app)/pacotes/page.tsx':                 3,
      'app/(app)/servicos/page.tsx':                1,
      'components/ConfirmDialog.tsx':               1,
      'components/Sidebar.tsx':                     1,
    };

    for (const [arquivo, esperado] of Object.entries(porArquivo)) {
      const src = read(arquivo);
      expect(src, `${arquivo} nao importa o hook`)
        .toContain("import { useScrollLock } from '@/lib/useScrollLock';");
      // A linha de import nao casa: ela nao tem parentese depois do nome.
      const chamadas = src.match(/useScrollLock\(/g) ?? [];
      expect(chamadas.length, `${arquivo} deveria ter ${esperado} chamada(s)`)
        .toBe(esperado);
    }
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd web && npx vitest run tests/unit/scroll-lock-modais.test.ts
```

Esperado: os 2 testes novos FALHANDO. Os 24 da Task 4 continuam passando.

- [ ] **Step 3: `TimelineView` em `web/app/(app)/agenda/page.tsx`**

O import já foi adicionado na Task 4. Logo depois da declaração de `agSel` (linha 1053):

```tsx
  const [agSel,     setAgSel]     = useState<Ag | null>(null);
  // O painel Detalhes so vira modal no mobile (md:hidden). No desktop ele e um
  // painel lateral e travar a pagina seria bug — foi exatamente o problema que
  // motivou a variante .bm-modal-mobile no globals.css.
  useScrollLock(!!agSel, { apenasMobile: true });
  const [hoverInfo, setHoverInfo] = useState<{ profId: string; y: number; horaStr: string } | null>(null);
```

- [ ] **Step 4: `ClientePerfilPage` em `web/app/(app)/clientes/[id]/page.tsx`**

O import já foi adicionado na Task 4. Junto aos demais hooks do componente (que começa na linha 299), depois da declaração do estado `modalRemover`:

```tsx
  useScrollLock(modalRemover);
```

- [ ] **Step 5: `ComissoesGestorView` em `web/app/(app)/comissoes/ComissoesGestorView.tsx`**

Adicionar o import:

```ts
import { useScrollLock } from '@/lib/useScrollLock';
```

E, junto aos hooks do componente (que começa na linha 148), depois da declaração do estado `pagando`:

```tsx
  useScrollLock(!!pagando);
```

- [ ] **Step 6: `Sidebar` em `web/components/Sidebar.tsx`**

Adicionar o import:

```ts
import { useScrollLock } from '@/lib/useScrollLock';
```

E, depois da declaração do estado `maisAberto`:

```tsx
  // O drawer "Mais" e md:hidden — so existe no mobile.
  useScrollLock(maisAberto, { apenasMobile: true });
```

- [ ] **Step 7: `ConfirmDialog` em `web/components/ConfirmDialog.tsx`**

Adicionar o import:

```ts
import { useScrollLock } from '@/lib/useScrollLock';
```

E a chamada **acima** do early return existente (linha 22), porque hooks não podem ficar depois de um `return` condicional:

```tsx
export function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirmar',
  variant = 'danger',
  loading = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  useScrollLock(open);

  if (!open) return null;
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

```bash
cd web && npx vitest run tests/unit/scroll-lock-modais.test.ts
```

Esperado: 26 casos PASSANDO (24 da Task 4 + 2 novos).

- [ ] **Step 9: Rodar a suíte inteira e o TypeScript**

```bash
cd web && npm test && npx tsc --noEmit
```

Esperado: suíte verde, `tsc` sem saída.

- [ ] **Step 10: Commit**

```bash
git add web/app web/components web/tests/unit/scroll-lock-modais.test.ts
git commit -m "fix: aplica useScrollLock nos 5 modais embutidos

Os dois modais md:hidden (Detalhes da Agenda e drawer Mais do Sidebar) usam
apenasMobile para nao travar a pagina no desktop, onde o elemento nem existe.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final da branch

Revisão de costura — o tipo de falha que nenhuma task isolada consegue enxergar, seguindo o que o `CLAUDE.md` registra das sessões anteriores.

**Files:**
- Modify: apenas se a verificação encontrar algo
- Test: nenhum arquivo novo; roda a suíte inteira

**Interfaces:**
- Consumes: resultado das Tasks 1-5
- Produces: nada

- [ ] **Step 1: Suíte completa e TypeScript**

```bash
cd web && npm test && npx tsc --noEmit
```

Esperado: toda a suíte verde, `tsc` sem nenhuma saída.

- [ ] **Step 2: Confirmar que `mobile/` não foi tocado**

```bash
git diff --name-only main...HEAD -- mobile/
```

Esperado: **nenhuma linha de saída**.

- [ ] **Step 3: Confirmar que todo `.bm-modal` tem trava**

```bash
cd web && for f in $(grep -rln "bm-modal" app components --include=*.tsx); do grep -q "useScrollLock" "$f" || echo "SEM TRAVA: $f"; done
```

Esperado: **nenhuma linha de saída**. Qualquer arquivo listado renderiza modal sem trava de scroll.

- [ ] **Step 4: Confirmar que nenhum campo ficou abaixo de 16px no mobile**

```bash
cd web && grep -rEn "<(input|select|textarea)[^>]{0,400}text-(xs|sm)" app components --include=*.tsx | head -20
```

Ocorrências aqui são **esperadas e aceitáveis** — a regra de `globals.css` sobrepõe todas com `!important`. O que importa é confirmar que nenhum campo usa `style={{ fontSize: ... }}` inline, que venceria o `!important` de uma folha de estilo:

```bash
cd web && grep -rEn "<(input|select|textarea)[^>]{0,400}fontSize" app components --include=*.tsx
```

Esperado: **nenhuma linha de saída**. Se aparecer alguma, esse campo precisa perder o `fontSize` inline ou receber no mínimo 16px.

- [ ] **Step 5: Revisar o diff completo**

```bash
git diff main...HEAD --stat
```

Conferir que só aparecem: `web/app/globals.css`, `web/app/layout.tsx`, `web/lib/useScrollLock.ts`, os 9 arquivos de página, `web/components/ConfirmDialog.tsx`, `web/components/Sidebar.tsx`, os 3 arquivos de teste e os 2 documentos em `docs/superpowers/`.

- [ ] **Step 6: Commit (só se a verificação exigiu correção)**

```bash
git add -A
git commit -m "fix: corrige achados da verificacao final da branch

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Se nada precisou de correção, pular este passo e registrar que a verificação passou limpa.

---

## Cobertura da spec

| Requisito da spec | Task |
|---|---|
| Parte 1 — fonte 16px com prioridade na cascata | Task 1 |
| Parte 2 — `maximumScale` / `userScalable` no viewport | Task 1 |
| Parte 3 — 19 ocorrências de `vh` → `dvh` | Task 2 |
| Parte 4 — `scrollbar-gutter: stable` | Task 1 |
| Parte 5 — hook `useScrollLock` com contador de referência | Task 3 |
| Parte 5 — hook aplicado em todo componente com `.bm-modal` | Tasks 4 e 5 |
| Critério 1 — `tsc` zerado, `mobile/` intocado | Tasks 1-5 (step de verificação), Task 6 |
| Critério 2 — regra de 16px vence `text-sm` | Task 1 (teste de cascata) + Task 6 (step 4) |
| Critério 3 — nenhum `vh` restante | Task 2 (steps 4 e 5) |
| Critério 4 — nenhum componente de modal sem trava | Task 5 (teste de contagem) + Task 6 (step 3) |
| Critério 5 — checkbox/radio preservados | Task 1 (seletor `:not([type='checkbox']):not([type='radio'])`) |
| Critérios 6 e 7 | Pendentes de iPhone real — fora do alcance automatizável, já documentado na spec |
