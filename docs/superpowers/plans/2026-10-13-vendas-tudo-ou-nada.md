# Vendas tudo ou nada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a venda avulsa (web e app) passa a ser gravada numa única função do banco (tudo ou nada, estoque nunca negativo), e a tela de Vendas do app recarrega ao voltar, não pisca "Sem permissão" e pagina clientes.

**Architecture:** migration 087 cria `public.registrar_venda_avulsa` (plpgsql, security invoker, uma transação). `shared/venda.ts → gravarVenda` chama a função via `db.rpc`; se ela ainda não existir (`PGRST202`), usa o caminho atual em 4 passos. Telas não mudam o tratamento de erro.

**Tech Stack:** Supabase/Postgres (plpgsql), PostgREST rpc, TypeScript em `shared/`, Next.js (web), Expo/React Native + expo-router (app), Vitest (`web/tests/unit`).

**Spec:** `docs/superpowers/specs/2026-10-13-vendas-tudo-ou-nada-design.md`

## Global Constraints

- Comunicação, comentários, mensagens de tela e commits em português.
- O web NUNCA importa nada de `mobile/` (teste `web-nao-importa-mobile.test.ts`).
- Testes rodam em `web/`: `cd web && npx vitest run <arquivo>`; tsc: `cd web && npx tsc --noEmit` (0 erros) e `cd mobile && npx tsc --noEmit` (baseline: exatamente 6 erros pré-existentes, nenhum novo).
- Migrations NÃO são aplicadas por CI e NUNCA com `supabase db push`; o dono roda no SQL Editor. Toda migration idempotente e terminando em `notify pgrst, 'reload schema';`.
- Função nova: **sem** `security definer`; `revoke all … from public, anon` + `grant execute … to authenticated`.
- Mensagens de erro do banco em português; permissão negada com `errcode = '42501'` (vira "Você não tem permissão para …" por `mensagemErroBanco`).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca commitar `.superpowers/`.

---

### Task 1: Migration 087 — `registrar_venda_avulsa`

**Files:**
- Create: `supabase/migrations/087_registrar_venda_avulsa.sql`
- Test: `web/tests/unit/venda-rpc-migration.test.ts`

**Interfaces:**
- Produces: função SQL `public.registrar_venda_avulsa(p_empresa uuid, p_cliente uuid, p_desconto numeric, p_itens jsonb, p_pagamentos jsonb) returns uuid`.
  - `p_itens`: `[{ "produto_id": uuid, "quantidade": number, "preco_unitario": number }]`
  - `p_pagamentos`: `[{ "valor", "metodo", "bandeira", "parcelas", "taxa_perc", "valor_liquido", "maquininha_id"? , "status" }]` (as linhas de `montarPagamentos` sem `venda_id`; `maquininha_id` pode faltar)
  - devolve o id da venda criada.

- [ ] **Step 1: Write the failing test** — `web/tests/unit/venda-rpc-migration.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '087_registrar_venda_avulsa.sql'), 'utf8').toLowerCase();
// Corpo sem comentários: as checagens não podem passar por causa de um texto no cabeçalho.
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

describe('migration 087 — registrar_venda_avulsa', () => {
  it('cria a função com a assinatura combinada e devolve uuid', () => {
    expect(corpo).toMatch(/create or replace function public\.registrar_venda_avulsa\(\s*p_empresa uuid,\s*p_cliente uuid,\s*p_desconto numeric,\s*p_itens jsonb,\s*p_pagamentos jsonb\s*\)\s*returns uuid/);
  });
  it('roda com as permissões de quem chama (RLS vale), nunca security definer', () => {
    expect(corpo).not.toContain('security definer');
    expect(corpo).toContain('security invoker');
  });
  it('exige vendas.acessar e comanda.desconto para desconto/cortesia', () => {
    expect(corpo).toContain("tem_permissao(p_empresa, 'vendas.acessar')");
    expect(corpo).toContain("tem_permissao(p_empresa, 'comanda.desconto')");
    expect(corpo).toContain("errcode = '42501'");
  });
  it('calcula o valor_total na função (soma dos itens), não recebe da tela', () => {
    expect(corpo).not.toMatch(/p_valor_total/);
    expect(corpo).toMatch(/sum\(round\(i\.preco_unitario, 2\) \* i\.quantidade\)/);
  });
  it('trava o estoque por produto e recusa saldo insuficiente', () => {
    expect(corpo).toContain('pg_advisory_xact_lock');
    expect(corpo).toContain('estoque insuficiente');
    expect(corpo).not.toMatch(/for update/);
  });
  it('gera o id da venda na função (sem returning, que exigiria a policy de select)', () => {
    expect(corpo).toContain('v_venda := gen_random_uuid()');
    expect(corpo).not.toMatch(/returning id into/);
  });
  it('grava venda, itens, saída de estoque e pagamentos', () => {
    expect(corpo).toContain('insert into public.vendas');
    expect(corpo).toContain('insert into public.venda_itens');
    expect(corpo).toContain('insert into public.estoque_movimentos');
    expect(corpo).toContain('insert into public.pagamentos');
    expect(corpo).toContain("'venda avulsa'");
  });
  it('execução só para authenticated e recarrega o schema', () => {
    expect(corpo).toMatch(/revoke all on function public\.registrar_venda_avulsa\(uuid, uuid, numeric, jsonb, jsonb\) from public, anon/);
    expect(corpo).toMatch(/grant execute on function public\.registrar_venda_avulsa\(uuid, uuid, numeric, jsonb, jsonb\) to authenticated/);
    expect(corpo).toContain("notify pgrst, 'reload schema'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/unit/venda-rpc-migration.test.ts`
Expected: FAIL (ENOENT — arquivo 087 não existe)

- [ ] **Step 3: Write the migration** — `supabase/migrations/087_registrar_venda_avulsa.sql`

```sql
-- ============================================================
-- MIGRATION 087 — Venda avulsa gravada tudo ou nada
-- Spec: docs/superpowers/specs/2026-10-13-vendas-tudo-ou-nada-design.md
--
-- Antes: shared/venda.ts gravava vendas → venda_itens → estoque_movimentos → pagamentos
-- em 4 chamadas. Falha no meio deixava venda sem itens, sem baixa de estoque ou sem
-- pagamento (contando no faturamento). E duas vendas do último item ao mesmo tempo
-- deixavam o saldo negativo.
--
-- Agora: uma função, uma transação. Qualquer erro desfaz tudo.
--  - SECURITY INVOKER: as policies de sempre valem (vendas, venda_itens, estoque_movimentos,
--    pagamentos). Checagem explícita de vendas.acessar para a mensagem ficar clara.
--  - Desconto ou cortesia com valor exigem comanda.desconto (mesma regra da tela).
--  - valor_total calculado aqui pela soma dos itens (nunca vem da tela).
--  - Estoque: pg_advisory_xact_lock por produto (em ordem de id, sem deadlock) e conferência
--    do saldo. Não usa SELECT ... FOR UPDATE: exigiria a policy de UPDATE de produtos
--    (estoque.acessar), que quem só tem vendas.acessar não tem.
--  - Id da venda gerado aqui (sem RETURNING, que exigiria a policy de SELECT).
--  - A baixa do saldo continua no trigger atualizar_estoque (saida).
--  Requer a 086 (pagamentos.maquininha_id).
--
-- Rollback:
--   drop function if exists public.registrar_venda_avulsa(uuid, uuid, numeric, jsonb, jsonb);
--   notify pgrst, 'reload schema';
-- ============================================================

create or replace function public.registrar_venda_avulsa(
  p_empresa uuid,
  p_cliente uuid,
  p_desconto numeric,
  p_itens jsonb,
  p_pagamentos jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_venda    uuid;
  v_total    numeric(10,2);
  v_desconto numeric(10,2) := round(coalesce(p_desconto, 0), 2);
  v_pago     numeric(10,2);
  v_nome     text;
  v_saldo    numeric;
  r          record;
begin
  if not tem_permissao(p_empresa, 'vendas.acessar') then
    raise exception 'Você não tem permissão para registrar vendas avulsas.' using errcode = '42501';
  end if;

  -- Itens
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Carrinho vazio.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric, preco_unitario numeric)
    where i.produto_id is null or coalesce(i.quantidade, 0) <= 0 or i.preco_unitario is null or i.preco_unitario < 0
  ) then
    raise exception 'Item da venda inválido.';
  end if;
  select round(sum(round(i.preco_unitario, 2) * i.quantidade), 2) into v_total
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric, preco_unitario numeric);

  if v_desconto < 0 or v_desconto > v_total then
    raise exception 'O desconto não pode ser maior que o subtotal';
  end if;

  -- Pagamentos
  if p_pagamentos is null or jsonb_typeof(p_pagamentos) <> 'array' or jsonb_array_length(p_pagamentos) = 0 then
    raise exception 'Pagamento não informado.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_pagamentos) as p(valor numeric, metodo text)
    where p.valor is null or p.valor < 0 or p.metodo is null
  ) then
    raise exception 'Pagamento inválido.';
  end if;
  select round(coalesce(sum(p.valor), 0), 2) into v_pago
    from jsonb_to_recordset(p_pagamentos) as p(valor numeric);
  if v_pago < (v_total - v_desconto) - 0.005 then
    raise exception 'O pagamento não cobre o total da venda.';
  end if;

  -- Desconto e cortesia com valor: mesma permissão da comanda (a cortesia automática de R$ 0 passa)
  if (v_desconto > 0 or exists (
        select 1 from jsonb_to_recordset(p_pagamentos) as p(valor numeric, metodo text)
        where p.metodo = 'cortesia' and p.valor > 0))
     and not tem_permissao(p_empresa, 'comanda.desconto') then
    raise exception 'Você não tem permissão para dar desconto ou cortesia.' using errcode = '42501';
  end if;

  -- Estoque: trava por produto e confere o saldo
  for r in
    select i.produto_id, sum(i.quantidade) as qtd
      from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric)
     group by i.produto_id
     order by i.produto_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('venda_estoque:' || r.produto_id::text, 0));
    select pr.nome, pr.estoque_atual into v_nome, v_saldo
      from public.produtos pr
     where pr.id = r.produto_id and pr.empresa_id = p_empresa and pr.tipo = 'venda' and pr.ativo;
    if not found then
      raise exception 'Produto indisponível para venda.';
    end if;
    if coalesce(v_saldo, 0) < r.qtd then
      raise exception 'Estoque insuficiente: % (restam %)', v_nome, trim_scale(coalesce(v_saldo, 0));
    end if;
  end loop;

  -- Gravação
  v_venda := gen_random_uuid();

  insert into public.vendas (id, empresa_id, cliente_id, valor_total, desconto)
  values (v_venda, p_empresa, p_cliente, v_total, v_desconto);

  insert into public.venda_itens (empresa_id, venda_id, produto_id, quantidade, preco_unitario)
  select p_empresa, v_venda, i.produto_id, i.quantidade, round(i.preco_unitario, 2)
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric, preco_unitario numeric);

  insert into public.estoque_movimentos (empresa_id, produto_id, tipo, quantidade, motivo)
  select p_empresa, i.produto_id, 'saida', i.quantidade, 'Venda avulsa'
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade numeric);

  insert into public.pagamentos
    (empresa_id, venda_id, valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id, status)
  select p_empresa, v_venda, round(p.valor, 2), p.metodo::pagamento_metodo, p.bandeira, coalesce(p.parcelas, 1),
         p.taxa_perc, p.valor_liquido, p.maquininha_id, 'pago'
    from jsonb_to_recordset(p_pagamentos) as p(
      valor numeric, metodo text, bandeira text, parcelas integer,
      taxa_perc numeric, valor_liquido numeric, maquininha_id uuid
    );

  return v_venda;
end;
$$;

revoke all on function public.registrar_venda_avulsa(uuid, uuid, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_venda_avulsa(uuid, uuid, numeric, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/unit/venda-rpc-migration.test.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/087_registrar_venda_avulsa.sql web/tests/unit/venda-rpc-migration.test.ts
git commit -m "feat(banco): venda avulsa gravada tudo ou nada com trava de estoque (087)"
```

---

### Task 2: `gravarVenda` chama a função (com caminho antigo sem a 087)

**Files:**
- Modify: `shared/venda.ts` (função `gravarVenda` e imports)
- Modify: `web/tests/unit/fixtures/fake-db.ts` (opção `rpc`)
- Test: `web/tests/unit/venda.test.ts`

**Interfaces:**
- Consumes: função SQL da Task 1 (nome e parâmetros exatos: `p_empresa, p_cliente, p_desconto, p_itens, p_pagamentos`).
- Produces: `gravarVenda(db: ClienteDbVenda, d: DadosVenda): Promise<ResultadoVenda>` — mesma assinatura de dados; `ClienteDbVenda = ClienteDb & { rpc(fn: string, args?: Record<string, unknown>): any }` exportado de `shared/venda.ts`. Sucesso pela função → `{ vendaId, avisoEstoque: null }`. Erro da função → `ErroVenda('venda', mensagemErroBanco(erro, 'registrar a venda'), null)`.

- [ ] **Step 1: `fakeDb` aceita `rpc`** — em `web/tests/unit/fixtures/fake-db.ts`:

Adicionar ao tipo de `opcoes` (logo depois de `respostaUpdate?`):

```ts
  /**
   * Resposta de `db.rpc(fn, args)`. Ausente → função inexistente (`PGRST202`), como no banco
   * antes da migration que a cria; os testes antigos seguem pelo caminho sem a função.
   */
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null };
```

Adicionar ao retorno a lista de chamadas de rpc. Trocar `const chamadas: Chamada[] = [];` por:

```ts
  const chamadas: Chamada[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
```

E dentro de `const db = {`, antes de `from(tabela: string) {`, adicionar:

```ts
    rpc(fn: string, args: Record<string, unknown> = {}) {
      rpcs.push({ fn, args });
      return Promise.resolve(opcoes.rpc
        ? opcoes.rpc(fn, args)
        : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } });
    },
```

Trocar `return { db, chamadas };` por `return { db, chamadas, rpcs };`.

- [ ] **Step 2: Write the failing tests** — em `web/tests/unit/venda.test.ts`, dentro de `describe('gravarVenda', …)`, depois do `const linhas = …`, adicionar:

```ts
  describe('pela função registrar_venda_avulsa (087)', () => {
    const ok = () => ({ data: 'v9', error: null });

    it('chama a função uma vez, com itens, desconto e pagamentos, e não grava tabela nenhuma direto', async () => {
      const { db, chamadas, rpcs } = fakeDb({ awaitavel: true, linhas, rpc: ok });
      const r = await gravarVenda(db, dados());
      expect(r).toEqual({ vendaId: 'v9', avisoEstoque: null });
      expect(chamadas).toHaveLength(0);
      expect(rpcs).toHaveLength(1);
      expect(rpcs[0].fn).toBe('registrar_venda_avulsa');
      const a = rpcs[0].args;
      expect(a.p_empresa).toBe('e1');
      expect(a.p_cliente).toBe('c1');
      expect(a.p_desconto).toBe(0.1);
      expect(a.p_itens).toEqual([{ produto_id: 'p2', quantidade: 2, preco_unitario: 5.05 }]);
      const pags = a.p_pagamentos as Record<string, unknown>[];
      expect(pags).toHaveLength(1);
      expect(pags[0]).toMatchObject({ metodo: 'credito', bandeira: 'visa', parcelas: 2, maquininha_id: 'maq1', valor: 10, status: 'pago' });
      expect(pags[0]).not.toHaveProperty('venda_id');
      expect(pags[0]).not.toHaveProperty('empresa_id');
      expect(pags[0]).not.toHaveProperty('comanda_id');
    });

    it('cliente opcional vira null; total zero sem pagamento manda a Cortesia R$ 0', async () => {
      const { db, rpcs } = fakeDb({ awaitavel: true, linhas, rpc: ok });
      await gravarVenda(db, dados({ clienteId: null, desconto: 10.1, splits: [] }));
      expect(rpcs[0].args.p_cliente).toBeNull();
      expect(rpcs[0].args.p_pagamentos).toEqual([expect.objectContaining({ metodo: 'cortesia', valor: 0 })]);
    });

    it('erro da função (ex.: estoque insuficiente) vira ErroVenda sem vendaId e não tenta o caminho antigo', async () => {
      const { db, chamadas } = fakeDb({ awaitavel: true, linhas,
        rpc: () => ({ data: null, error: { code: 'P0001', message: 'Estoque insuficiente: Óleo (restam 1)' } }) });
      const e = await gravarVenda(db, dados()).catch(x => x);
      expect(e).toBeInstanceOf(ErroVenda);
      expect(e.etapa).toBe('venda');
      expect(e.vendaId).toBeNull();
      expect(e.message).toBe('venda: Estoque insuficiente: Óleo (restam 1)');
      expect(chamadas).toHaveLength(0);
    });

    it('permissão negada pela função vira mensagem em português', async () => {
      const { db } = fakeDb({ awaitavel: true, linhas,
        rpc: () => ({ data: null, error: { code: '42501', message: 'Você não tem permissão para registrar vendas avulsas.' } }) });
      await expect(gravarVenda(db, dados())).rejects.toThrow('venda: Você não tem permissão para registrar a venda. Fale com a dona ou a gestora.');
    });

    it('função sem devolver id é erro (nunca sucesso sem venda)', async () => {
      const { db } = fakeDb({ awaitavel: true, linhas, rpc: () => ({ data: null, error: null }) });
      const e = await gravarVenda(db, dados()).catch(x => x);
      expect(e).toBeInstanceOf(ErroVenda);
      expect(e.vendaId).toBeNull();
    });

    it('sem a 087 (PGRST202) usa o caminho antigo em 4 passos', async () => {
      const { db, chamadas, rpcs } = fakeDb({ awaitavel: true, linhas }); // sem `rpc` = PGRST202
      const r = await gravarVenda(db, dados());
      expect(rpcs).toHaveLength(1);
      expect(r).toEqual({ vendaId: 'v1', avisoEstoque: null });
      expect(chamadas.map(c => c.tabela)).toEqual(['vendas', 'venda_itens', 'estoque_movimentos', 'pagamentos']);
    });

    it('validação local continua antes da função (total não coberto não chama nada)', async () => {
      const { db, chamadas, rpcs } = fakeDb({ awaitavel: true, linhas, rpc: ok });
      await expect(gravarVenda(db, dados({ splits: [{ metodo: 'pix', valor: 5 }] }))).rejects.toThrow('venda: Ainda faltam R$ 5,00 para cobrir o total');
      expect(rpcs).toHaveLength(0);
      expect(chamadas).toHaveLength(0);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run tests/unit/venda.test.ts`
Expected: FAIL nos testes novos de "pela função" (gravarVenda ainda não chama `rpc`); os antigos passam.

- [ ] **Step 4: Implementar em `shared/venda.ts`**

4a. Abaixo dos imports, adicionar o tipo exportado:

```ts
/** Cliente do banco para a venda: tabelas (caminho antigo) e `rpc` (função da 087). Estrutural. */
export type ClienteDbVenda = ClienteDb & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
};

/** Função ainda não criada no banco (a 087 não foi rodada): PostgREST devolve PGRST202. */
const funcaoInexistente = (e: { code?: string | null } | null | undefined) => e?.code === 'PGRST202' || e?.code === '42883';
```

4b. Atualizar o JSDoc e a assinatura de `gravarVenda` e inserir a chamada da função logo depois da checagem de `resumo.podeFechar` (antes de `// 1. Venda`):

```ts
/**
 * Grava a venda. Caminho principal: a função `registrar_venda_avulsa` (migration 087) grava venda,
 * itens, saída de estoque e pagamentos numa transação só, travando o estoque — qualquer erro desfaz
 * tudo (`ErroVenda` com `vendaId` null: pode tentar de novo). Sem a 087 (`PGRST202`), usa o caminho
 * antigo: `vendas` → `venda_itens` → `estoque_movimentos` (saída; o trigger trg_atualizar_estoque
 * baixa o saldo) → `pagamentos` (`venda_id`, via montarPagamentos), com cada etapa conferida — falha
 * nos itens tenta desfazer a venda, falha no estoque vira `avisoEstoque`, falha nos pagamentos lança
 * com `vendaId`. Confere o total antes de gravar qualquer coisa. Lança sempre `ErroVenda`.
 */
export async function gravarVenda(db: ClienteDbVenda, d: DadosVenda): Promise<ResultadoVenda> {
  if (d.itens.length === 0) throw new ErroVenda('venda', 'Carrinho vazio.', null);
  const subtotal = subtotalVenda(d.itens);
  const desconto = centavos(d.desconto);
  if (desconto > subtotal + 0.001) throw new ErroVenda('venda', 'O desconto não pode ser maior que o subtotal', null);
  const resumo = resumoComanda({ subtotal, desconto, descontoReserva: 0, splits: d.splits });
  if (!resumo.podeFechar) throw new ErroVenda('venda', resumo.motivo ?? 'Pagamento não cobre o total.', null);

  // 0. Tudo ou nada pela função do banco (087). O total é o recalculado aqui (e de novo na função).
  const pagamentosRpc = montarPagamentos(d.splits, { empresaId: d.empresaId, config: d.config, total: resumo.total })
    .map(({ empresa_id: _e, comanda_id: _c, venda_id: _v, ...resto }) => resto);
  const { data: idRpc, error: eRpc } = await db.rpc('registrar_venda_avulsa', {
    p_empresa: d.empresaId,
    p_cliente: d.clienteId || null,
    p_desconto: desconto,
    p_itens: d.itens.map(i => ({ produto_id: i.produtoId, quantidade: i.quantidade, preco_unitario: i.precoUnitario })),
    p_pagamentos: pagamentosRpc,
  });
  if (!funcaoInexistente(eRpc)) {
    if (eRpc || typeof idRpc !== 'string' || !idRpc) {
      throw new ErroVenda('venda', mensagemErroBanco(eRpc, 'registrar a venda'), null);
    }
    return { vendaId: idRpc, avisoEstoque: null };
  }

  // Sem a 087: caminho antigo em 4 passos.
```

(O restante da função — `// 1. Venda` em diante — fica exatamente como está.)

Observação: `montarPagamentos` sem `comandaId`/`vendaId` já não põe vínculo (`vinculo()` devolve `{}`); a desestruturação remove `empresa_id` e garante que nenhum vínculo vá para a função.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run tests/unit/venda.test.ts`
Expected: PASS (todos, antigos e novos)

- [ ] **Step 6: Typecheck das duas plataformas**

Run: `cd web && npx tsc --noEmit` → 0 erros.
Run: `cd mobile && npx tsc --noEmit` → os mesmos 6 erros pré-existentes (o `supabase` do app e o `createClient()` do web já têm `rpc`, então as chamadas de `gravarVenda` nas telas continuam compilando).

- [ ] **Step 7: Commit**

```bash
git add shared/venda.ts web/tests/unit/venda.test.ts web/tests/unit/fixtures/fake-db.ts
git commit -m "feat(vendas): gravarVenda pela funcao tudo ou nada, com caminho antigo sem a 087"
```

---

### Task 3: Tela de Vendas — app recarrega ao voltar, sem "Sem permissão" piscando; clientes paginados (app e web)

**Files:**
- Modify: `mobile/app/(empresa)/vendas.tsx`
- Modify: `web/app/(app)/vendas/page.tsx` (função `carregar`)
- Test: `web/tests/unit/vendas-telas.test.ts` (novo, lê os fontes como texto)

**Interfaces:**
- Consumes: `buscarTodasOuLancar<T>(montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]>` de `@shared/kpis-financeiros-consultas` (lança em erro); `usePermissoes()` do app devolve `{ pode, permissoesCarregadas, … }`; `useFocusEffect` de `expo-router`.

- [ ] **Step 1: Write the failing test** — `web/tests/unit/vendas-telas.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(process.cwd(), '..');
const app = readFileSync(join(raiz, 'mobile', 'app', '(empresa)', 'vendas.tsx'), 'utf8');
const web = readFileSync(join(raiz, 'web', 'app', '(app)', 'vendas', 'page.tsx'), 'utf8');

describe('tela de Vendas do app', () => {
  it('recarrega catálogo e histórico ao voltar para a tela (useFocusEffect)', () => {
    expect(app).toMatch(/import \{[^}]*useFocusEffect[^}]*\} from 'expo-router'/);
    expect(app.match(/useFocusEffect\(/g)?.length).toBe(2);
    // Os useEffect de carga antigos saem (senão carregaria duas vezes na abertura)
    expect(app).not.toContain('useEffect(() => { if (podeVendas) carregar(); }');
    expect(app).not.toContain("useEffect(() => { if (aba === 'historico' && podeVendas) carregarVendas(); }");
  });
  it('espera as permissões carregarem antes de mostrar "Sem permissão"', () => {
    expect(app).toMatch(/const \{ pode, permissoesCarregadas \} = usePermissoes\(\)/);
    const iCarregando = app.indexOf('if (!permissoesCarregadas)');
    const iSemPermissao = app.indexOf('if (!podeVendas)');
    expect(iCarregando).toBeGreaterThan(-1);
    expect(iCarregando).toBeLessThan(iSemPermissao);
  });
  it('clientes paginados com desempate por id', () => {
    expect(app).toContain('buscarTodasOuLancar');
    expect(app).toMatch(/from\('clientes'\)[\s\S]{0,200}\.order\('id'\)[\s\S]{0,40}\.range\(de, ate\)/);
  });
});

describe('tela de Vendas do web', () => {
  it('clientes paginados com desempate por id', () => {
    expect(web).toContain('buscarTodasOuLancar');
    expect(web).toMatch(/from\('clientes'\)[\s\S]{0,200}\.order\('id'\)[\s\S]{0,40}\.range\(de, ate\)/);
  });
  it('erro ao carregar produtos ou clientes aparece na tela (nunca lista vazia em silêncio)', () => {
    expect(web).toContain("mensagemErroBanco(rProdutos.error, 'carregar os produtos')");
    expect(web).toContain("'carregar as clientes'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/unit/vendas-telas.test.ts`
Expected: FAIL (useFocusEffect, permissoesCarregadas, buscarTodasOuLancar ausentes)

- [ ] **Step 3: App — `mobile/app/(empresa)/vendas.tsx`**

3a. Import: trocar `import { router } from 'expo-router';` por

```ts
import { router, useFocusEffect } from 'expo-router';
```

e adicionar, junto dos imports de `@shared/…`:

```ts
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
```

3b. Permissões: trocar `const { pode } = usePermissoes();` por

```ts
  const { pode, permissoesCarregadas } = usePermissoes();
```

3c. Em `carregar`, trocar a consulta de clientes dentro do `Promise.all`:

```ts
      supabase.from('clientes')
        .select('id, nome, telefone')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
```

por (paginada; o erro volta no mesmo formato `{ data, error }` que o resto da função já confere):

```ts
      // Paginada: acima de 1000 clientes o PostgREST cortaria a lista em silêncio.
      buscarTodasOuLancar<Cliente>((de, ate) => supabase.from('clientes')
        .select('id, nome, telefone')
        .eq('empresa_id', empresaId).eq('ativo', true)
        .order('nome').order('id')
        .range(de, ate)).then(
        data => ({ data, error: null as { message: string } | null }),
        (e: unknown) => ({ data: null as Cliente[] | null, error: { message: e instanceof Error ? e.message : String(e) } }),
      ),
```

3d. Trocar as duas linhas de carga

```ts
  useEffect(() => { if (podeVendas) carregar(); }, [carregar, podeVendas]);
```

e

```ts
  useEffect(() => { if (aba === 'historico' && podeVendas) carregarVendas(); }, [aba, carregarVendas, podeVendas]);
```

respectivamente por

```ts
  // Ao abrir e ao VOLTAR para a tela (ela fica montada na pilha): estoque dos cards sempre atual.
  useFocusEffect(useCallback(() => { if (podeVendas) carregar(); }, [carregar, podeVendas]));
```

e

```ts
  // Histórico do dia: ao abrir a aba, ao trocar o dia e ao voltar para a tela.
  useFocusEffect(useCallback(() => {
    if (aba === 'historico' && podeVendas) carregarVendas();
  }, [aba, carregarVendas, podeVendas]));
```

Se `useEffect` deixar de ser usado no arquivo, removê-lo do import de `react` (o tsc/lint acusa import sem uso).

3e. Antes do bloco `// ── Sem permissão (ex.: deep link)` / `if (!podeVendas) {`, inserir:

```tsx
  // Permissões ainda carregando: não mostrar "Sem permissão" por um instante.
  if (!permissoesCarregadas) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }
```

- [ ] **Step 4: Web — `web/app/(app)/vendas/page.tsx`, função `carregar`**

Adicionar o import junto dos de `@shared/…`:

```ts
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
```

Trocar o corpo de `carregar` (de `setLoading(true);` até `setLoading(false);`) por:

```ts
    setLoading(true);
    const [rProdutos, rClientes] = await Promise.all([
      supabase.from('produtos')
        .select('id, nome, categoria, preco_venda, estoque_atual, unidade')
        .eq('empresa_id', empId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      // Paginada: acima de 1000 clientes o PostgREST cortaria a lista em silêncio.
      buscarTodasOuLancar<Cliente>((de, ate) => supabase.from('clientes')
        .select('id, nome, telefone')
        .eq('empresa_id', empId).eq('ativo', true)
        .order('nome').order('id')
        .range(de, ate)).then(
        data => ({ data, error: null as { message: string } | null }),
        (e: unknown) => ({ data: null as Cliente[] | null, error: { message: e instanceof Error ? e.message : String(e) } }),
      ),
    ]);
    if (rProdutos.error) setErro(mensagemErroBanco(rProdutos.error, 'carregar os produtos'));
    else if (rClientes.error) setErro(mensagemErroBanco(rClientes.error, 'carregar as clientes'));
    if (!rProdutos.error) setProdutos((rProdutos.data ?? []) as Produto[]);
    if (!rClientes.error) setClientes((rClientes.data ?? []) as Cliente[]);
    setLoading(false);
```

(`setErro` e `mensagemErroBanco` já existem no arquivo; o banner de `erro` já é exibido acima do botão Finalizar.)

- [ ] **Step 5: Run tests and typecheck**

Run: `cd web && npx vitest run tests/unit/vendas-telas.test.ts tests/unit/venda.test.ts` → PASS
Run: `cd web && npx tsc --noEmit` → 0 erros
Run: `cd mobile && npx tsc --noEmit` → os mesmos 6 erros pré-existentes, nenhum em `vendas.tsx`

- [ ] **Step 6: Suíte completa**

Run: `cd web && npx vitest run` → tudo PASS (incluindo `web-nao-importa-mobile.test.ts`)

- [ ] **Step 7: Commit**

```bash
git add "mobile/app/(empresa)/vendas.tsx" "web/app/(app)/vendas/page.tsx" web/tests/unit/vendas-telas.test.ts
git commit -m "fix(vendas): app recarrega ao voltar e espera permissoes; clientes paginados (web e app)"
```
