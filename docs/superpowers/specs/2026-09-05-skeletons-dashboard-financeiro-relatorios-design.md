# Alinhamento de skeletons — Dashboard, Financeiro, Relatórios

**Data:** 2026-09-05
**Escopo:** só `web/` (as três telas são o app web; o print do usuário é o PWA no iPhone,
identificado pela barra inferior `Sidebar.tsx`). O app nativo `mobile/` não tem tela de
skeleton (usa `RefreshControl` / `ActivityIndicator`), então não entra.
"mobile e desktop web" = o mesmo `web/` responsivo nos dois viewports.

---

## Problema

Três telas mostram um skeleton de carregamento que não corresponde ao conteúdo real:

| Tela | Tipo | Sintoma |
|---|---|---|
| Dashboard | Server Component (só `loading.tsx`) | Skeleton com 4 cards de KPI-mês em `sm:grid-cols-4`; a tela real tem 5 cards em `lg:grid-cols-4`, cards mais altos (linha de sub-texto) e o bloco **"Meta do mês"** que o skeleton não desenha. A tela "pula" ao carregar. |
| Financeiro | Client (`'use client'`) | **Dois** skeletons que discordam: o `loading.tsx` (Server, exibido na navegação) tem 7 cards em grade única; o skeleton interno do `page.tsx` (gate `useState(loading)` do fetch) tem 6 cards forçados em 2 linhas de `grid-cols-2 lg:grid-cols-3` de 3 → **célula órfã no mobile** (é o print 1). Nenhum bate com o real (6–8 cards, grade única, último `col-span-2` no mobile quando ímpar). |
| Relatórios | Client (`'use client'`) | Mesma divisão em dois: `loading.tsx` (KPIs `grid-cols-2 md:grid-cols-3`, pills-`Sk`, 1 gráfico, 2 cards laterais) **≠** skeleton interno (KPIs no grid real `grid-cols-2 md:grid-cols-4`, `SmoothTabs` de período reais, card do gráfico, cards laterais escondidos enquanto `loading`). Os dois aparecem em sequência rápida — o "flash" que o usuário relatou e não conseguiu printar. |

**Causa raiz:** cada tela Client mantém o skeleton em dois lugares (o `loading.tsx` do
App Router + o gate interno de `loading` do fetch) que saem de sincronia. O Dashboard,
sendo Server Component, tem um só — que simplesmente ficou defasado do `page.tsx`.

---

## Solução — um skeleton por tela, casado com o layout real

### Dashboard

Sem dedup (é um skeleton só). Duas mudanças:

1. **`web/app/(app)/dashboard/page.tsx`**
   - Remover o item `{ label: 'Fat. Bruto', … }` do array "KPIs do mês" (linha ~411).
     Motivo: repete exatamente o valor `bruto` já exibido no card hero logo acima.
     Restam 4 cards: **Fat. Líquido · Lucro do mês · Comissões · % Cancelamento**
     → preenchem `grid-cols-2 lg:grid-cols-4` sem folga (2×2 mobile, 1×4 desktop).
   - Remover `TrendingUp` do import `lucide-react` (fica sem uso). `pctBruto` continua
     usado pelo card hero — mantém.
   - Defensivo (1 classe): no caso só-da-dona em que aparece o 5º card "A dona deve"
     (quando `isOwner && emprestimosAbertos > 0`), o último card ganha
     `max-lg:col-span-2` para não reabrir a célula órfã no mobile.

2. **`web/app/(app)/dashboard/loading.tsx`** — resync com o `page.tsx` real:
   - KPIs do mês: **4** cards, grade `grid-cols-2 lg:grid-cols-4` (hoje é `sm:grid-cols-4`
     — no tablet o skeleton mostra 4 colunas e a tela real mostra 2). Cada card ganha
     uma barra de sub-texto para aproximar a altura real.
   - **Adicionar** o bloco "Meta do mês" (card com ícone + label + valor, barra de
     progresso, linha de texto) entre os KPIs do dia e "Ações rápidas".
   - Ajustar o header (linha do seletor de mês com 2 chevrons + linha h1/ícone de olho)
     e o hero (`rounded-3xl`, padding equivalente, linha "Lucro").
   - **Não** desenhar "Reconquistar / Aniversariantes" — é condicional e some com
     frequência; desenhar causaria o pulo inverso.

### Financeiro

Extrair **`web/app/(app)/financeiro/FinanceiroSkeleton.tsx`** (componente co-localizado,
não roteável no App Router). Estrutura = o layout real de `page.tsx`:

- Header (label "Visão Geral" + h1 "Financeiro" + toggle de privacidade + botão Exportar).
- Seletor de mês (`FinanceMonthCalendar` fechado — placeholder da barra).
- Grade de KPIs: `grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6`, **7** cards
  placeholder, o último com `col-span-2 lg:col-span-1` (mesma regra órfã do real:
  `i === arr.length - 1 && arr.length % 2 === 1`). Cada card: `p-3 sm:p-5`, barra de
  label + barra de valor + barra de delta.
- Grid de 2 colunas `grid-cols-1 md:grid-cols-2 gap-6`: card "Evolução" (barras) +
  card "Top serviços" (linhas com barra de progresso).
- Lista de despesas (cabeçalho + 3 linhas com avatar + 2 textos + valor/badge).

Consumo:
- `web/app/(app)/financeiro/loading.tsx` → `return <FinanceiroSkeleton />`.
- `web/app/(app)/financeiro/page.tsx` → logo no início do `return`,
  `if (loading) return <FinanceiroSkeleton />;` e **apagar** os blocos
  `{loading ? (<skeleton/>) : (…)}` do carregamento **inicial** (KPIs, evolução/top
  serviços, despesas). Estados que não são o fetch inicial (ex.: paginação de histórico
  de despesas, se houver) continuam como estão.

Resultado: uma definição só → o skeleton de navegação e o de fetch são idênticos e
batem com a grade real.

### Relatórios

Extrair **`web/app/(app)/relatorios/RelatoriosSkeleton.tsx`**. Estrutura = 1º paint real:

- Header (label "Análise" + h1 "Relatórios" + toggle + controles de exportação/período
  à direita como placeholders).
- Linha de pills de período (`SmoothTabs variant="pill"` → placeholder de 4–5 pills).
- Grade de KPIs no grid **real**: `grid grid-cols-2 md:grid-cols-4 gap-3 mb-6`,
  ~8 cards no formato `KpiCard` (quadrado de ícone `w-9 h-9` + 2 linhas de texto),
  reaproveitando o próprio branch `if (loading)` do componente `KpiCard` (ou um
  placeholder equivalente).
- Linha das abas (`SmoothTabs variant="underline"` → placeholder da barra de abas).
- Card do gráfico "Evolução de faturamento" (título + barras `height:140`).
- **Sem** os cards "Resumo financeiro / Despesas por categoria" — a tela real os
  esconde enquanto `loading` (`{!loading && …}`), então o skeleton também não os mostra.

Consumo:
- `web/app/(app)/relatorios/loading.tsx` → `return <RelatoriosSkeleton />`.
- `web/app/(app)/relatorios/page.tsx` → logo no início do `return`,
  `if (loading) return <RelatoriosSkeleton />;`. Os `<Sk>` inline restantes ficam
  para o estado **`loadingAba`** (troca de aba após o load inicial), que é outro
  estado e continua válido — não mexer nele.

---

## Fora de escopo

- App nativo `mobile/` (sem skeleton screens).
- Blocos condicionais citados acima (Reconquistar/Aniversariantes; Resumo/Categorias).
- Qualquer mudança de lógica de cálculo de KPI — só layout de skeleton + a remoção do
  card redundante "Fat. Bruto" do Dashboard.

## Verificação

- `cd web && npx tsc --noEmit` — zero erros.
- `cd web && npm test` — suíte atual não tem teste que renderize esses skeletons;
  rodar mesmo assim para garantir que nada quebrou.
- Visual no preview (dev server): navegar para `/dashboard`, `/financeiro`, `/relatorios`
  em viewport mobile (~375px) e desktop, com throttle de rede, e confirmar que a
  transição skeleton→conteúdo não desloca o layout (mesma contagem/grade de cards,
  mesmos blocos na mesma ordem).

## Arquivos tocados

| Arquivo | Ação |
|---|---|
| `web/app/(app)/dashboard/page.tsx` | remover KPI "Fat. Bruto" + import `TrendingUp` + classe defensiva |
| `web/app/(app)/dashboard/loading.tsx` | resync (4 KPIs, breakpoint, "Meta do mês", header/hero) |
| `web/app/(app)/financeiro/FinanceiroSkeleton.tsx` | **novo** — skeleton único |
| `web/app/(app)/financeiro/loading.tsx` | usar `<FinanceiroSkeleton />` |
| `web/app/(app)/financeiro/page.tsx` | `if (loading) return <FinanceiroSkeleton />` + remover skeletons inline do load inicial |
| `web/app/(app)/relatorios/RelatoriosSkeleton.tsx` | **novo** — skeleton único |
| `web/app/(app)/relatorios/loading.tsx` | usar `<RelatoriosSkeleton />` |
| `web/app/(app)/relatorios/page.tsx` | `if (loading) return <RelatoriosSkeleton />` (mantém `loadingAba` inline) |
