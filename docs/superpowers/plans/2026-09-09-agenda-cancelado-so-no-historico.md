# Agendamento cancelado some da agenda e fica só no histórico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agendamento com `status = 'cancelado'` deixa de aparecer na agenda web (desktop + PWA) e passa a aparecer no histórico da cliente no app nativo, igualando o comportamento já existente no web.

**Architecture:** Duas mudanças pequenas e independentes, sem migration. (1) Na agenda web, filtrar `cancelado` nas duas queries que carregam agendamentos (`fetchDia`, `fetchMes`) e derivar uma lista visível com `useMemo` para o painel de detalhes não deixar a linha recém-cancelada na tela durante o update otimista. (2) No hook `useClienteDetalhe` do app nativo, remover o filtro que hoje esconde `cancelado` do histórico.

**Tech Stack:** Next.js 15 (App Router, Client Component) + Supabase JS no web; React Native + `@tanstack/react-query` + Supabase JS no mobile. Testes de regressão por varredura de source com **vitest** em `web/tests/unit/` (padrão já usado no projeto, inclusive para arquivos do `mobile/`).

## Global Constraints

- `cd web && npx tsc --noEmit` — zero erros, antes e depois.
- `cd web && npx vitest run` — suíte inteira verde ao fim de cada task.
- `cd mobile && npx tsc --noEmit` — mantém exatamente os ~10 erros pré-existentes (baseline), zero novos.
- `faltou` **não muda de comportamento** em lugar nenhum. Só `cancelado` é afetado.
- Sem migration, sem RLS, sem arquivo de componente novo.
- Filtro de status no Supabase JS escrito exatamente como o resto do projeto: `.neq('status', 'cancelado')` (aspas simples, um espaço após a vírgula).
- Testes vitest ficam em **um** arquivo: `web/tests/unit/agenda-cancelado-so-no-historico.test.ts` — Task 1 cria com o `describe` do web, Task 2 acrescenta o `describe` do mobile.

---

### Task 1: Agenda web — cancelado some de todas as views

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`
  - `fetchDia` (query de `agendamentos` do dia — hoje termina em `.order('data_hora_inicio')`, ~linha 2068)
  - `fetchMes` (query de contagem por dia — hoje `.select('data_hora_inicio')` … `.lte('data_hora_inicio', endOfMonth(mes).toISOString())`, ~linhas 2084-2089)
  - Bloco de `useState` do componente `AgendaPage` — inserir `agsVisiveis` logo após `const ehGestao = …` (~linha 2015)
  - 3 call sites que passam a prop `ags`: `<ListaDia ags={ags} …>` em `view === 'semana'` (~linha 2331) e em `view === 'mes'` (~linha 2368); `<TimelineView … ags={ags} …>` (~linha 2334)
- Test: `web/tests/unit/agenda-cancelado-so-no-historico.test.ts` (criar)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: cria o arquivo de teste `web/tests/unit/agenda-cancelado-so-no-historico.test.ts` com um `describe('agenda web — cancelado oculto', …)`. A Task 2 vai **acrescentar** um segundo `describe` nesse mesmo arquivo (não recriá-lo).

---

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/tests/unit/agenda-cancelado-so-no-historico.test.ts` com este conteúdo:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readWeb = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

describe('agenda web — cancelado oculto', () => {
  const src = readWeb('app/(app)/agenda/page.tsx');

  it('filtra cancelado nas duas queries de agendamentos (dia e mês)', () => {
    // fetchDia + fetchMes → duas ocorrências do filtro.
    const ocorrencias = src.match(/\.neq\('status', 'cancelado'\)/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });

  it('deriva a lista visível sem os cancelados', () => {
    expect(src).toMatch(/const agsVisiveis\s*=\s*useMemo\(/);
    expect(src).toMatch(/ags\.filter\(\s*a\s*=>\s*a\.status !== 'cancelado'\s*\)/);
    // O filtro NÃO pode tocar em 'faltou'.
    expect(src).not.toMatch(/agsVisiveis[\s\S]{0,120}'faltou'/);
  });

  it('as três chamadas de view recebem agsVisiveis, não o ags cru', () => {
    // ListaDia (semana + mês) e TimelineView.
    const comFiltro = src.match(/ags=\{agsVisiveis\}/g) ?? [];
    expect(comFiltro.length).toBeGreaterThanOrEqual(3);
    // Nenhum call site pode continuar passando ags={ags}.
    expect(src).not.toMatch(/ags=\{ags\}/);
  });

  it('mantém "faltou" visível e riscado na timeline', () => {
    // A expressão `inativo` continua reconhecendo faltou.
    expect(src).toMatch(/ag\.status === 'faltou'/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd web && npx vitest run tests/unit/agenda-cancelado-so-no-historico.test.ts`
Expected: FAIL — `agsVisiveis` não existe, o filtro `.neq('status', 'cancelado')` aparece 0 vezes, e `ags={ags}` ainda está presente.

- [ ] **Step 3: Filtrar cancelado no `fetchDia`**

Em `web/app/(app)/agenda/page.tsx`, na query de `agendamentos` dentro de `fetchDia`, acrescentar `.neq('status', 'cancelado')` imediatamente antes de `.order('data_hora_inicio')`:

```ts
      supabase
        .from('agendamentos')
        .select(`id,data_hora_inicio,data_hora_fim,status,valor,observacao,pacote_cliente_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id,nome,telefone),
          profissional:users!agendamentos_profissional_id_fkey(id,nome),
          servico:servicos(id,nome,duracao_minutos,categoria,categoria_id),
          agendamento_servicos(servico_id,valor,duracao_minutos,ordem,servico:servicos(id,nome,categoria,categoria_id))`)
        .eq('empresa_id', empId)
        .gte('data_hora_inicio', iniDia)
        .lte('data_hora_inicio', fimDia)
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),
```

- [ ] **Step 4: Filtrar cancelado no `fetchMes`**

Ainda em `web/app/(app)/agenda/page.tsx`, na query de `fetchMes`, acrescentar `.neq('status', 'cancelado')` logo após `.eq('empresa_id', empId)` (mesma ordem que o mobile já usa em `useDiasComAgendamento`):

```ts
    const { data: rows } = await supabase
      .from('agendamentos')
      .select('data_hora_inicio')
      .eq('empresa_id', empId)
      .neq('status', 'cancelado')
      .gte('data_hora_inicio', startOfMonth(mes).toISOString())
      .lte('data_hora_inicio', endOfMonth(mes).toISOString());
```

- [ ] **Step 5: Derivar `agsVisiveis` com `useMemo`**

Em `web/app/(app)/agenda/page.tsx`, logo após a linha `const ehGestao = meuRole === 'owner' || meuRole === 'gestor';`, inserir:

```ts
  // Cancelado não aparece na agenda — vive só no histórico da cliente.
  // `ags` cru continua sendo a fonte de verdade do revert otimista em
  // `mudarStatus`; toda renderização passa por `agsVisiveis`.
  const agsVisiveis = useMemo(
    () => ags.filter(a => a.status !== 'cancelado'),
    [ags],
  );
```

(`useMemo` já está importado no topo do arquivo — nada a acrescentar no import.)

- [ ] **Step 6: Passar `agsVisiveis` para as três views**

Em `web/app/(app)/agenda/page.tsx`, trocar a prop `ags` nos três call sites:

1. `view === 'semana'`:
```tsx
      {view === 'semana' ? (
        <ListaDia ags={agsVisiveis} loading={loading} dataSel={dataSel} empresaId={empresaId ?? ''} onNovo={() => setModal(true)} onStatus={mudarStatus} onEditar={ag => setAgEditar(ag)}/>
```

2. `view === 'timeline'`:
```tsx
        <TimelineView
          ags={agsVisiveis}
```

3. bloco `else` (`view === 'mes'`), a `<ListaDia>` abaixo do `<MesView>`:
```tsx
          <ListaDia ags={agsVisiveis} loading={loading} dataSel={dataSel} empresaId={empresaId ?? ''} onNovo={() => setModal(true)} onStatus={mudarStatus} onEditar={ag => setAgEditar(ag)}/>
```

Não tocar em `mudarStatus` — ele continua lendo/gravando `ags` cru (busca `ags.find(a => a.id === id)` e reverte `statusOriginal`). Não tocar em `TimelineView`, `ListaDia` nem `AgCard` por dentro (os ramos que estilizam `cancelado` viram inalcançáveis, mas são inofensivos e ficam como estão).

- [ ] **Step 7: Rodar o teste e confirmar que passa**

Run: `cd web && npx vitest run tests/unit/agenda-cancelado-so-no-historico.test.ts`
Expected: PASS — 4 testes verdes.

- [ ] **Step 8: Rodar a suíte inteira + tsc**

Run: `cd web && npx vitest run`
Expected: PASS — suíte inteira verde (nenhum teste de `agenda/page.tsx` — `mobile-header-actions`, `mobile-layout-regressions`, `scroll-lock-modais`, `ui-lote-2026-09`, `ui-ajustes-2026-09-05`, `zoom-inputs-modais` — quebra; nenhum deles depende da prop `ags`).

Run: `cd web && npx tsc --noEmit`
Expected: sem saída (zero erros).

- [ ] **Step 9: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx" web/tests/unit/agenda-cancelado-so-no-historico.test.ts
git commit -m "fix(agenda): agendamento cancelado some de todas as views da agenda web"
```

---

### Task 2: Histórico da cliente no app nativo — cancelado volta a aparecer

**Files:**
- Modify: `mobile/hooks/useClientes.ts` — dentro de `useClienteDetalhe`, a sub-query de `agendamentos` no `Promise.all` (hoje contém `.neq('status', 'cancelado')` na ~linha 225)
- Test: `web/tests/unit/agenda-cancelado-so-no-historico.test.ts` (acrescentar um `describe`, sem recriar o arquivo)

**Interfaces:**
- Consumes: o arquivo `web/tests/unit/agenda-cancelado-so-no-historico.test.ts` já existe (criado na Task 1) e tem um `describe('agenda web — cancelado oculto', …)`. Esta task **acrescenta** um segundo `describe` ao final do arquivo, preservando o import `readFileSync`/`resolve` já presente e adicionando um leitor para o repo root.
- Produces: nada para tasks futuras.

---

- [ ] **Step 1: Acrescentar o teste que falha**

Ao final de `web/tests/unit/agenda-cancelado-so-no-historico.test.ts`, acrescentar:

```ts
const readRepo = (f: string) => readFileSync(resolve(__dirname, '../../..', f), 'utf8');

describe('histórico da cliente no app nativo — cancelado visível', () => {
  const src = readRepo('mobile/hooks/useClientes.ts');

  it('useClienteDetalhe não filtra cancelado no histórico de agendamentos', () => {
    // 'cancelado' (masculino) só existia nessa query; 'cancelada' (feminino,
    // das taxas) continua permitido.
    expect(src).not.toMatch(/\.neq\('status', 'cancelado'\)/);
  });

  it('contagem de visitas e total gasto seguem só sobre concluído', () => {
    expect(src).toContain("historicoCompleto.filter((a: any) => a.status === 'concluido')");
  });

  it('a query de histórico continua escopada à cliente', () => {
    expect(src).toMatch(/\.from\('agendamentos'\)[\s\S]{0,400}\.eq\('cliente_id', clienteId\)/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd web && npx vitest run tests/unit/agenda-cancelado-so-no-historico.test.ts`
Expected: FAIL no primeiro `it` do novo `describe` — `.neq('status', 'cancelado')` ainda está em `mobile/hooks/useClientes.ts`. Os `describe` da Task 1 continuam verdes.

- [ ] **Step 3: Remover o filtro no `useClienteDetalhe`**

Em `mobile/hooks/useClientes.ts`, na sub-query de `agendamentos` dentro do `Promise.all` de `useClienteDetalhe`, apagar a linha `.neq('status', 'cancelado')`. O resultado fica:

```ts
        buscarTodasPaginas<any>((from, to) =>
          supabase
            .from('agendamentos')
            .select(`*, comanda_id,
              servico:servicos(nome),
              agendamento_servicos(ordem, servico:servicos(nome)),
              profissional:users!agendamentos_profissional_id_fkey(nome)`)
            .eq('empresa_id', empresaId!)
            .eq('cliente_id', clienteId)
            .order('data_hora_inicio', { ascending: false })
            .range(from, to) as any
        ),
```

Não mexer em mais nada do arquivo: `linhasDeVisita` (filtro `=== 'concluido'`), as queries de `taxas_cancelamento`/`taxas_reserva` (`.neq('status', 'cancelada')`, feminino — outra coisa) e a query de resumo (`.eq('status', 'concluido')`) ficam como estão.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd web && npx vitest run tests/unit/agenda-cancelado-so-no-historico.test.ts`
Expected: PASS — os dois `describe` (web da Task 1 + mobile desta task) verdes.

- [ ] **Step 5: Rodar a suíte inteira + os dois tsc**

Run: `cd web && npx vitest run`
Expected: PASS — suíte inteira verde. Em especial `web/tests/unit/historico-cliente.test.ts` continua passando (nenhuma das suas asserções sobre `mobile/hooks/useClientes.ts` menciona o filtro de cancelado).

Run: `cd web && npx tsc --noEmit`
Expected: sem saída (zero erros).

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma baseline de ~10 erros pré-existentes, nenhum novo e nenhum em `hooks/useClientes.ts`. (Se não souber a baseline exata, comparar com `git stash && npx tsc --noEmit` na `main` antes — mas como a mudança só remove uma linha de um método encadeado, não há tipo novo em jogo.)

- [ ] **Step 6: Commit**

```bash
git add mobile/hooks/useClientes.ts web/tests/unit/agenda-cancelado-so-no-historico.test.ts
git commit -m "fix(mobile): histórico da cliente volta a mostrar agendamento cancelado"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §4.1 item 1 (`fetchDia` filtra cancelado) → Task 1 Step 3. ✅
- Spec §4.1 item 2 (`fetchMes` filtra cancelado) → Task 1 Step 4. ✅
- Spec §4.1 item 3 (`agsVisiveis` memo + wiring nas 3 views) → Task 1 Steps 5-6. ✅
- Spec §4.1 item 4 (não mexer em TimelineView/AgCard/ListaDia internos, `mudarStatus` intacto) → Task 1 Step 6 (nota explícita). ✅
- Spec §4.2 (remover `.neq('status','cancelado')` de `useClienteDetalhe`) → Task 2 Step 3. ✅
- Spec §3 (`faltou` não muda) → Task 1 Step 1 (asserção `não toca 'faltou'` + `faltou visível`) e Task 1 Step 6 nota. ✅
- Spec §6 (verificação: tsc web, vitest, tsc mobile baseline, checagem manual) → Global Constraints + Steps 7-8 (Task 1) e 4-5 (Task 2). ✅
- Spec §5 (fora de escopo: app do cliente final, agenda nativa, histórico web, conflito) → nenhuma task toca esses arquivos. ✅

**2. Placeholder scan:** Sem "TBD"/"TODO"/"handle edge cases". Todo step de código mostra o código final. As referências a número de linha vêm com `~` e âncora textual (o trecho de código a procurar), porque o arquivo `page.tsx` tem 124 KB e os números podem deslizar. ✅

**3. Type consistency:** Nenhum tipo novo. `agsVisiveis: Ag[]` (mesmo tipo de `ags`, via `Array.prototype.filter`). A prop `ags` de `ListaDia` e `TimelineView` já é `Ag[]` — passar `agsVisiveis` não muda assinatura nenhuma. O teste da Task 1 é criado por ela e só estendido (não reescrito) pela Task 2; ambas usam `readFileSync`/`resolve` importados uma vez no topo. ✅

## Execution Handoff

Plano pequeno (2 tasks, 1 arquivo de produção cada, mais 1 arquivo de teste compartilhado). Sem dependência de estado entre as tasks além do arquivo de teste que a Task 2 estende.
