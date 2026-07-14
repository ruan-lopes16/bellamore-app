# Acoes de Cabecalho Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposicionar e destacar os controles de exportacao no mobile, corrigir a distribuicao das acoes de Estoque, e ampliar a leitura da Comanda e da Timeline da Agenda.

**Architecture:** A exportacao continua concentrada em `ExportButton`; uma variante visual e classes responsivas reutilizaveis separam o posicionamento mobile da aparencia desktop. As paginas apenas aplicam a variante e marcam seus cabecalhos, enquanto ajustes especificos permanecem em Estoque, Comanda e Agenda.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest e Lucide.

## Global Constraints

- Sem novas tabelas, migrations, chamadas Supabase ou bibliotecas.
- Preservar os formatos PDF/XLSX e os dados exportados hoje.
- Manter alvos de toque com no minimo 44 px no mobile.
- Aplicar o layout em 375 px, respeitando a navegacao inferior existente.
- Nao alterar o posicionamento ou a aparencia desktop atuais.

---

### Task 1: Atualizar a base da branch e escrever as regressões de layout

**Files:**
- Create: `web/tests/unit/mobile-header-actions.test.ts`
- Modify: `web/tests/unit/mobile-layout-regressions.test.ts`
- Source baseline: `origin/main`

**Interfaces:**
- Consumes: arquivos-fonte das paginas e `ExportButton` por meio de leitura textual nos testes Vitest existentes.
- Produces: testes que falham enquanto a variante `mobileHeader` e as classes de layout ainda nao existem.

- [ ] **Step 1: Criar uma branch nova baseada na main remota**

Run:

```powershell
git switch --create codex/mobile-header-actions origin/main
git cherry-pick 1d1e2c2
```

Expected: a branch `codex/mobile-header-actions` contem a `main` atual e a especificacao aprovada, sem os commits ja mesclados da PR #80.

- [ ] **Step 2: Escrever o teste que deve falhar**

Create `web/tests/unit/mobile-header-actions.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const headerPages = [
  'app/(app)/clientes/page.tsx',
  'app/(app)/financeiro/page.tsx',
  'app/(app)/servicos/page.tsx',
  'app/(app)/pacotes/page.tsx',
  'app/(app)/equipe/page.tsx',
  'app/(app)/comissoes/page.tsx',
  'app/(app)/relatorios/page.tsx',
  'app/(app)/estoque/page.tsx',
  'app/(app)/agenda/page.tsx',
];

describe('mobile header actions', () => {
  it('uses the shared pink export variant in every requested header', () => {
    const exportButton = read('components/ExportButton.tsx');
    expect(exportButton).toContain("variant?: 'default' | 'mobileHeader'");
    expect(exportButton).toContain('bm-mobile-header-export-button');
    for (const page of headerPages) {
      expect(read(page)).toContain('variant="mobileHeader"');
      expect(read(page)).toContain('bm-mobile-page-header');
    }
  });

  it('keeps the stock controls readable and gives the agenda timeline more content width', () => {
    const stock = read('app/(app)/estoque/page.tsx');
    const agenda = read('app/(app)/agenda/page.tsx');
    expect(stock).toContain('bm-mobile-stock-actions');
    expect(stock).toContain('Histórico geral');
    expect(agenda).toContain('w-10 md:w-12');
    expect(agenda).toContain('whitespace-nowrap');
  });

  it('aligns the Comanda view selector to the right edge of its title row', () => {
    expect(read('app/(app)/comanda/page.tsx')).toContain('bm-comanda-view-toggle');
  });
});
```

- [ ] **Step 3: Executar o teste para confirmar a falha**

Run: `npm.cmd run test -- tests/unit/mobile-header-actions.test.ts`

Expected: FAIL porque `ExportButton` ainda nao aceita `variant="mobileHeader"` e as paginas nao possuem as classes requeridas.

- [ ] **Step 4: Atualizar a regressao anterior sem mudar sua responsabilidade**

Add to `web/tests/unit/mobile-layout-regressions.test.ts` a final expectation that `app/globals.css` contains `bm-mobile-page-header` and `bm-mobile-stock-actions`.

- [ ] **Step 5: Commitar somente os testes vermelhos**

```powershell
git add -- web/tests/unit/mobile-header-actions.test.ts web/tests/unit/mobile-layout-regressions.test.ts
git commit -m "testa acoes de cabecalho mobile"
```

### Task 2: Criar a variante compartilhada e reposicionar Exportar nos cabecalhos

**Files:**
- Modify: `web/components/ExportButton.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/app/(app)/clientes/page.tsx`
- Modify: `web/app/(app)/financeiro/page.tsx`
- Modify: `web/app/(app)/servicos/page.tsx`
- Modify: `web/app/(app)/pacotes/page.tsx`
- Modify: `web/app/(app)/equipe/page.tsx`
- Modify: `web/app/(app)/comissoes/page.tsx`
- Modify: `web/app/(app)/relatorios/page.tsx`

**Interfaces:**
- Consumes: `ExportButtonProps<T>` e os `filename`, `title`, `columns` e `getData` ja fornecidos por cada pagina.
- Produces: `variant="mobileHeader"` e `className="bm-mobile-header-export"`, sem alterar a API de exportacao.

- [ ] **Step 1: Estender a interface do componente sem alterar a exportacao**

Add the following optional props to `ExportButtonProps<T>`:

```ts
variant?: 'default' | 'mobileHeader';
className?: string;
```

Default `variant` to `default`, apply `className` to the outer `div`, and compute the button class from the variant. The mobile header variant must contain the class `bm-mobile-header-export-button`, have `min-h-11`, use `var(--color-rose)` with white text on mobile, and restore the existing surface, border and text colors from the `sm` breakpoint onward. Keep the existing loading state and PDF/XLSX menu unchanged.

- [ ] **Step 2: Adicionar as regras responsivas globais**

Add this mobile-only layout contract in `web/app/globals.css`:

```css
@media (max-width: 639px) {
  .bm-mobile-page-header { position: relative; }
  .bm-mobile-page-header > :first-child { min-height: 44px; padding-right: 9.5rem; }
  .bm-mobile-header-export { position: absolute; top: 0; right: 0; z-index: 2; }
  .bm-mobile-page-actions { width: 100%; display: flex; justify-content: flex-end; gap: 0.5rem; }
}
```

Add a desktop media rule that restores `position: static` for `.bm-mobile-header-export`, ensuring the existing desktop flow remains unchanged.

- [ ] **Step 3: Marcar cada cabecalho solicitado**

On the root header of Clientes, Financeiro, Servicos, Pacotes, Equipe, Comissoes and Relatorios, add `bm-mobile-page-header`. Add the following props to each existing export component, including all three conditional exports in Pacotes:

```tsx
variant="mobileHeader"
className="bm-mobile-header-export"
```

For headers that also contain a primary action, add `bm-mobile-page-actions` to the existing action wrapper so the remaining action remains right-aligned below the title on mobile. Do not change `filename`, `title`, `columns`, `getData`, click handlers or desktop classes.

- [ ] **Step 4: Executar os testes para confirmar verde**

Run: `npm.cmd run test -- tests/unit/mobile-header-actions.test.ts tests/unit/mobile-layout-regressions.test.ts`

Expected: PASS with all header-variant assertions satisfied.

- [ ] **Step 5: Commitar a variante e os cabecalhos compartilhados**

```powershell
git add -- web/components/ExportButton.tsx web/app/globals.css web/app/(app)/clientes/page.tsx web/app/(app)/financeiro/page.tsx web/app/(app)/servicos/page.tsx web/app/(app)/pacotes/page.tsx web/app/(app)/equipe/page.tsx web/app/(app)/comissoes/page.tsx web/app/(app)/relatorios/page.tsx
git commit -m "reposiciona exportacao no mobile"
```

### Task 3: Corrigir Estoque, Comanda e Timeline da Agenda

**Files:**
- Modify: `web/app/(app)/estoque/page.tsx`
- Modify: `web/app/(app)/agenda/page.tsx`
- Modify: `web/app/(app)/comanda/page.tsx`
- Modify: `web/app/globals.css`
- Test: `web/tests/unit/mobile-header-actions.test.ts`

**Interfaces:**
- Consumes: os botoes existentes de Estoque, `SmoothTabs` da Comanda e a lista `profissionais` da Timeline.
- Produces: distribuicao sem rotulos espremidos, seletor da Comanda alinhado e nomes completos na Timeline.

- [ ] **Step 1: Aplicar a variante no Estoque e liberar a linha de acoes**

Mark the Estoque header with `bm-mobile-page-header`, set both conditional `ExportButton` instances to `variant="mobileHeader" className="bm-mobile-header-export"`, and set its action wrapper to `bm-mobile-page-actions bm-mobile-stock-actions`.

In the mobile CSS, make the two product-tab actions fill equal columns:

```css
@media (max-width: 639px) {
  .bm-mobile-stock-actions > button { flex: 1 1 0; min-width: 0; white-space: nowrap; justify-content: center; }
}
```

Keep `Histórico geral` and `Novo produto` as their complete existing labels and click handlers.

- [ ] **Step 2: Mover o seletor da Comanda sem alterar a navegacao de dias**

Replace the title row with a layout that explicitly preserves the right edge:

```tsx
<div className="flex items-start gap-3 mb-2">
  <div className="min-w-0">
    <p className="capitalize" style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
      {format(dataComanda, 'MMMM yyyy', { locale: ptBR })}
    </p>
    <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Comanda</h1>
  </div>
  <div className="bm-comanda-view-toggle ml-auto flex-shrink-0">
    <SmoothTabs variant="pill" tabs={[{ key: 'semana', label: 'Semana' }, { key: 'mes', label: 'Mês' }]} active={view} onChange={key => setView(key as 'semana' | 'mes')} />
  </div>
</div>
```

Keep `navDia`, `navMes`, `selecionarDia` and the week strip unchanged.

- [ ] **Step 3: Ajustar o cabecalho e a Timeline da Agenda**

Mark the Agenda header and its action wrapper with `bm-mobile-page-header` and `bm-mobile-page-actions`; set its `ExportButton` to the shared mobile variant. Preserve the Semana/Mês/Timeline toggle, Bloquear and Novo.

In the Timeline header, remove the abbreviation calculation and render the full name:

```tsx
<p className="text-xs font-bold text-text-2 whitespace-nowrap leading-none">{prof.nome}</p>
```

Use `min-w-[140px]` for each professional column and replace both matching `w-12` gutter classes with `w-10 md:w-12`, so the time gutter shrinks only on mobile and the horizontal scroll retains full names.

- [ ] **Step 4: Executar o teste de regressao focado**

Run: `npm.cmd run test -- tests/unit/mobile-header-actions.test.ts`

Expected: PASS, including the Estoque, Agenda and Comanda assertions.

- [ ] **Step 5: Commitar os ajustes especificos**

```powershell
git add -- web/app/(app)/estoque/page.tsx web/app/(app)/agenda/page.tsx web/app/(app)/comanda/page.tsx web/app/globals.css web/tests/unit/mobile-header-actions.test.ts
git commit -m "ajusta controles mobile de agenda e estoque"
```

### Task 4: Documentar e verificar a entrega

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Verify: `web/tests/unit/mobile-header-actions.test.ts`

**Interfaces:**
- Consumes: implementacao e comandos de verificacao anteriores.
- Produces: documentacao do comportamento responsivo e auditoria de qualidade da entrega.

- [ ] **Step 1: Atualizar a documentacao de UX mobile**

Add to `README.md` a concise bullet stating that mobile headers reserve a pink Exportar action at the title edge and keep the desktop presentation unchanged. Add to `AGENTS.md` a new dated audit entry that records the test, TypeScript, visual-validation and build results for this feature.

- [ ] **Step 2: Executar a verificacao completa**

Run:

```powershell
npm.cmd run test
npx.cmd tsc --noEmit
git diff --check
```

Expected: all Vitest tests pass, TypeScript exits with code 0, and `git diff --check` has no output.

- [ ] **Step 3: Verificar o viewport mobile**

Open Clientes, Estoque, Agenda, Comanda and Relatorios at 375 px. Confirm the pink Exportar button is at the title edge, Estoque has full action labels, Comanda's selector reaches the right edge, and Agenda shows full professional names with a narrower time gutter.

- [ ] **Step 4: Commitar documentacao e auditoria**

```powershell
git add -- README.md AGENTS.md
git commit -m "documenta ajustes mobile"
```
