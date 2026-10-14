# Paridade Estoque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Estoque do web e do app passam a ser iguais. Ficam iguais o cadastro de produto (material ou venda, pacote/caixa), as categorias e unidades, a movimentação conferida no banco (saldo nunca negativo), a aba Movimentações, os filtros, os cartões e a exportação. Cada empresa escolhe quais unidades aparecem.

**Architecture:**
- Migration 088 cria duas coisas:
  - `movimentar_estoque`: plpgsql, security invoker, com a mesma trava da 087;
  - `estoque_unidades_empresa`: tabela das unidades visíveis de cada empresa.
- As regras ficam em `shared/estoque.ts` e o acesso ao banco em `shared/estoque-consultas.ts`.
- As duas plataformas consomem só essas funções.
- Sem a 088, a movimentação volta ao caminho antigo e o ajuste de unidades fica escondido.

**Tech Stack:** Supabase/Postgres (plpgsql, RLS), TypeScript em `shared/`, Next.js (web), Expo/React Native + TanStack Query (app), Vitest em `web/tests/unit`.

**Spec:** `docs/superpowers/specs/2026-10-13-paridade-estoque-design.md`

## Global Constraints

- Comunicação, comentários, mensagens de tela e commits em português.
- O web NUNCA importa nada de `mobile/` (teste `web-nao-importa-mobile.test.ts`). Código comum vai em `shared/` e é importado como `@shared/...`.
- Testes rodam em `web/` com `cd web && npx vitest run <arquivo>`.
- tsc:
  - `cd web && npx tsc --noEmit`: 0 erros;
  - `cd mobile && npx tsc --noEmit`: exatamente 9 erros pré-existentes neste worktree (6 + 3 de `lib/exportar.ts` por módulos não instalados), nenhum novo.
- Migrations:
  - não são aplicadas por CI e NUNCA com `supabase db push`; o dono roda no SQL Editor;
  - idempotentes, terminando em `notify pgrst, 'reload schema';`;
  - função nova sem `security definer`.
- Toda consulta confere o erro. Lista vazia nunca pode ser erro escondido.
- Paginação sempre com desempate `.order('id')`.
- Datas e meses em Brasília (`shared/periodos.ts`).
- Os arquivos usam CRLF no checkout. Preservar o fim de linha ao editar.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca commitar `.superpowers/`.
- **Decisões do dono:**
  - saída de estoque conferida no banco;
  - catálogo de unidades completo e configurável por empresa;
  - só `pct` e `cx` perguntam a quantidade de dentro (kit não);
  - o ajuste das unidades fica na tela de Estoque, para quem tem `estoque.acessar`;
  - o saldo continua editável no produto, igual ao web.

---

### Task 1: Migration 088

**Files:**
- Create: `supabase/migrations/088_estoque_movimentar_e_unidades.sql`
- Test: `web/tests/unit/estoque-migration.test.ts`

**Interfaces:**
- Produces:
  - `public.movimentar_estoque(p_produto uuid, p_tipo text, p_quantidade numeric, p_motivo text) returns numeric` (devolve o saldo novo);
  - tabela `public.estoque_unidades_empresa(empresa_id uuid pk, unidades text[], atualizado_em timestamptz)`.

- [ ] **Step 1: Write the failing test** — `web/tests/unit/estoque-migration.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '088_estoque_movimentar_e_unidades.sql'), 'utf8')
  .toLowerCase().replace(/\r\n/g, '\n');
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sql087 = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '087_registrar_venda_avulsa.sql'), 'utf8').toLowerCase();

describe('migration 088 — movimentar_estoque', () => {
  it('assinatura e retorno numeric', () => {
    expect(corpo).toMatch(/create or replace function public\.movimentar_estoque\(\s*p_produto uuid,\s*p_tipo text,\s*p_quantidade numeric,\s*p_motivo text\s*\)\s*returns numeric/);
  });
  it('security invoker, nunca definer', () => {
    expect(corpo).toContain('security invoker');
    expect(corpo).not.toContain('security definer');
  });
  it('exige estoque.acessar com 42501', () => {
    expect(corpo).toContain("tem_permissao(v_empresa, 'estoque.acessar')");
    expect(corpo).toContain("errcode = '42501'");
  });
  it('mesma chave de trava da 087 (venda avulsa e movimentação em fila)', () => {
    const chave = "hashtextextended('venda_estoque:' || ";
    expect(sql087).toContain(chave);
    expect(corpo).toContain(chave);
    expect(corpo).toContain('pg_advisory_xact_lock');
    expect(corpo).not.toMatch(/from public.produtos[^;]*for update/);
  });
  it('recusa saída maior que o saldo e valida tipo e quantidade', () => {
    expect(corpo).toContain('estoque insuficiente');
    expect(corpo).toContain('tipo de movimentação inválido.');
    expect(corpo).toContain('informe uma quantidade maior que zero.');
  });
  it('grava o movimento sem returning e devolve o saldo relido', () => {
    expect(corpo).toContain('insert into public.estoque_movimentos');
    expect(corpo).not.toMatch(/returning/);
    expect(corpo).toMatch(/return v_saldo/);
  });
  it('execução só para authenticated', () => {
    expect(corpo).toMatch(/revoke all on function public\.movimentar_estoque\(uuid, text, numeric, text\) from public, anon/);
    expect(corpo).toMatch(/grant execute on function public\.movimentar_estoque\(uuid, text, numeric, text\) to authenticated/);
  });
});

describe('migration 088 — estoque_unidades_empresa', () => {
  it('tabela com chave por empresa, lista não vazia e cascade', () => {
    expect(corpo).toContain('create table if not exists public.estoque_unidades_empresa');
    expect(corpo).toMatch(/empresa_id\s+uuid primary key references public\.empresas\(id\) on delete cascade/);
    expect(corpo).toMatch(/check \(cardinality\(unidades\) between 1 and 50\)/);
  });
  it('rls: leitura de membro, escrita com estoque.acessar, sem delete', () => {
    expect(corpo).toContain('alter table public.estoque_unidades_empresa enable row level security');
    expect(corpo).toMatch(/for select\s+using \(empresa_id in \(select minha_empresas\(\)\)\)/);
    expect(corpo).toMatch(/for insert\s+with check \(tem_permissao\(empresa_id, 'estoque\.acessar'\)\)/);
    expect(corpo).toMatch(/for update\s+using \(tem_permissao\(empresa_id, 'estoque\.acessar'\)\)\s+with check \(tem_permissao\(empresa_id, 'estoque\.acessar'\)\)/);
    expect(corpo).not.toMatch(/for delete/);
  });
  it('idempotente e recarrega o schema', () => {
    expect(corpo.match(/drop policy if exists/g)?.length).toBe(3);
    expect(corpo).toContain("notify pgrst, 'reload schema'");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd web && npx vitest run tests/unit/estoque-migration.test.ts`
Expected: FAIL (ENOENT)

- [ ] **Step 3: Write the migration** — `supabase/migrations/088_estoque_movimentar_e_unidades.sql`

```sql
-- ============================================================
-- MIGRATION 088 — Movimentação de estoque conferida no banco + unidades por empresa
-- Spec: docs/superpowers/specs/2026-10-13-paridade-estoque-design.md
--
-- 1) movimentar_estoque: a entrada/saída manual (tela de Estoque, web e app) passa a ser
--    gravada por uma função que trava o produto e recusa saída maior que o saldo. Antes a
--    saída era conferida só contra o saldo que a tela mostrava: duas saídas ao mesmo tempo
--    deixavam o estoque negativo.
--    - SECURITY INVOKER: as policies de sempre valem (INSERT de estoque_movimentos exige
--      estoque.acessar; o trigger atualizar_estoque, security definer desde a 083, baixa o saldo).
--    - Trava: pg_advisory_xact_lock com a MESMA chave da 087 ('venda_estoque:' || produto),
--      então venda avulsa e movimentação manual do mesmo produto ficam em fila.
--      A baixa automática da comanda continua sem trava (decisão do dono de 29/09).
--    - Sem RETURNING (exigiria a policy de SELECT); devolve o saldo relido depois do insert.
--    - Nunca mudar a assinatura: clientes antigos receberiam PGRST202 e cairiam no caminho
--      antigo (sem trava). Mudança futura = função nova.
-- 2) estoque_unidades_empresa: quais unidades de medida cada empresa quer ver no seletor do
--    cadastro de produto (catálogo fixo em shared/estoque.ts). Sem linha = lista padrão.
--    Leitura para membro; escrita para quem tem estoque.acessar (não usa a tabela empresas,
--    que só a dona edita).
--
-- Rollback:
--   drop function if exists public.movimentar_estoque(uuid, text, numeric, text);
--   drop table if exists public.estoque_unidades_empresa;
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 1. movimentar_estoque ─────────────────────────────────────
create or replace function public.movimentar_estoque(
  p_produto uuid,
  p_tipo text,
  p_quantidade numeric,
  p_motivo text
) returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_empresa uuid;
  v_nome    text;
  v_unidade text;
  v_saldo   numeric;
begin
  if p_tipo is null or p_tipo not in ('entrada', 'saida') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;

  select pr.empresa_id into v_empresa from public.produtos pr where pr.id = p_produto;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  if not tem_permissao(v_empresa, 'estoque.acessar') then
    raise exception 'Você não tem permissão para movimentar o estoque.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('venda_estoque:' || p_produto::text, 0));

  -- Relido depois da trava: enxerga o saldo de quem gravou antes (READ COMMITTED).
  select pr.nome, pr.unidade, pr.estoque_atual into v_nome, v_unidade, v_saldo
    from public.produtos pr where pr.id = p_produto;

  if p_tipo = 'saida' and coalesce(v_saldo, 0) < p_quantidade then
    raise exception 'Estoque insuficiente: % (restam % %)',
      v_nome, trim_scale(coalesce(v_saldo, 0)), coalesce(v_unidade, 'un');
  end if;

  insert into public.estoque_movimentos (empresa_id, produto_id, tipo, quantidade, motivo)
  values (v_empresa, p_produto, p_tipo::movimento_tipo, p_quantidade, nullif(btrim(coalesce(p_motivo, '')), ''));

  select pr.estoque_atual into v_saldo from public.produtos pr where pr.id = p_produto;
  return v_saldo;
end;
$$;

revoke all on function public.movimentar_estoque(uuid, text, numeric, text) from public, anon;
grant execute on function public.movimentar_estoque(uuid, text, numeric, text) to authenticated;

-- ── 2. estoque_unidades_empresa ───────────────────────────────
create table if not exists public.estoque_unidades_empresa (
  empresa_id    uuid primary key references public.empresas(id) on delete cascade,
  unidades      text[] not null check (cardinality(unidades) between 1 and 50),
  atualizado_em timestamptz not null default now()
);

alter table public.estoque_unidades_empresa enable row level security;

drop policy if exists "estoque_unidades_empresa: membro ve" on public.estoque_unidades_empresa;
create policy "estoque_unidades_empresa: membro ve" on public.estoque_unidades_empresa
  for select
  using (empresa_id in (select minha_empresas()));

drop policy if exists "estoque_unidades_empresa: estoque insere" on public.estoque_unidades_empresa;
create policy "estoque_unidades_empresa: estoque insere" on public.estoque_unidades_empresa
  for insert
  with check (tem_permissao(empresa_id, 'estoque.acessar'));

drop policy if exists "estoque_unidades_empresa: estoque atualiza" on public.estoque_unidades_empresa;
create policy "estoque_unidades_empresa: estoque atualiza" on public.estoque_unidades_empresa
  for update
  using (tem_permissao(empresa_id, 'estoque.acessar'))
  with check (tem_permissao(empresa_id, 'estoque.acessar'));

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run to see it pass**

Run: `cd web && npx vitest run tests/unit/estoque-migration.test.ts`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/088_estoque_movimentar_e_unidades.sql web/tests/unit/estoque-migration.test.ts
git commit -m "feat(banco): movimentacao de estoque conferida no banco e unidades por empresa (088)"
```

---

### Task 2: Regras de estoque em `shared/estoque.ts`

**Files:**
- Modify: `shared/estoque.ts` (acrescenta; o que existe fica igual)
- Test: `web/tests/unit/estoque-regras.test.ts`

**Interfaces:**
- Consumes: `parseValorBR(s: string): number` de `./comanda-fechamento`.
- Produces (exportados de `shared/estoque.ts`):
  - `CATEGORIAS_PRODUTO: { key: string; label: string }[]`
  - `type GrupoUnidade = 'contagem' | 'embalagem' | 'volume' | 'peso' | 'comprimento' | 'outras'`
  - `GRUPOS_UNIDADE: { key: GrupoUnidade; label: string }[]`
  - `UNIDADES_PRODUTO: { key: string; label: string; grupo: GrupoUnidade }[]`
  - `UNIDADES_PADRAO: string[]`
  - `unidadePedeQtdPorUnidade(u: string): boolean`
  - `rotuloUnidade(u: string): string`
  - `normalizarUnidadesVisiveis(lista: string[]): string[]`
  - `unidadesParaSeletor(visiveis: string[] | null, atual?: string | null): string[]`
  - `parseQuantidadeBR(texto: string): number`
  - `type TipoProduto = 'material' | 'venda'`
  - `type FormProduto = { nome: string; tipo: TipoProduto; categoria: string; unidade: string; qtdPorUnidade: string; estoqueAtual: string; estoqueMinimo: string; precoCusto: string; precoVenda: string }`
  - `type PayloadProduto = { empresa_id: string; nome: string; tipo: TipoProduto; categoria: string; unidade: string; qtd_por_unidade: number; estoque_atual: number; estoque_minimo: number; preco_custo: number; preco_venda: number; ativo?: boolean }`
  - `montarProduto(form: FormProduto, ctx: { empresaId: string; editando: boolean }): { payload: PayloadProduto } | { erro: string }`
  - `resumoProdutos(ps: { tipo: string; estoque_atual: number; estoque_minimo: number; preco_custo: number }[]): { materiais: number; venda: number; alertas: number; valorTotal: number }`
  - `resumoMovimentos(ms: { tipo: string; quantidade: number }[]): { entradas: number; saidas: number; total: number; qtdEntradas: number; qtdSaidas: number }`
  - `margemVenda(custo: number, venda: number): number | null`

- [ ] **Step 1: Write the failing test** — `web/tests/unit/estoque-regras.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS_PRODUTO, GRUPOS_UNIDADE, UNIDADES_PRODUTO, UNIDADES_PADRAO, unidadePedeQtdPorUnidade, rotuloUnidade,
  normalizarUnidadesVisiveis, unidadesParaSeletor, parseQuantidadeBR, montarProduto, resumoProdutos,
  resumoMovimentos, margemVenda, type FormProduto,
} from '@shared/estoque';

const form = (extra: Partial<FormProduto> = {}): FormProduto => ({
  nome: '  Cola  ', tipo: 'material', categoria: 'cilios', unidade: 'un', qtdPorUnidade: '',
  estoqueAtual: '3', estoqueMinimo: '1', precoCusto: '12,50', precoVenda: '', ...extra,
});

describe('catálogos', () => {
  it('categorias: as 9 do web, por chave, na ordem dos rótulos', () => {
    expect(CATEGORIAS_PRODUTO.map(c => c.key)).toEqual(['cilios', 'depilacao', 'ferramentas', 'higiene', 'materiais', 'outros', 'pele', 'sobrancelhas', 'unhas']);
    expect(CATEGORIAS_PRODUTO[0].label).toBe('Cílios');
  });
  it('unidades: catálogo completo, sem repetição, com grupo conhecido', () => {
    const chaves = UNIDADES_PRODUTO.map(u => u.key);
    expect(chaves).toEqual(['un', 'pç', 'par', 'kit', 'pct', 'cx', 'fr', 'tb', 'pote', 'amp', 'sachê', 'rolo', 'folha', 'ml', 'L', 'mg', 'g', 'kg', 'cm', 'm', 'dose']);
    expect(new Set(chaves).size).toBe(chaves.length);
    const grupos = new Set(GRUPOS_UNIDADE.map(g => g.key));
    expect(UNIDADES_PRODUTO.every(u => grupos.has(u.grupo))).toBe(true);
  });
  it('padrão = lista do web + frasco, todas no catálogo', () => {
    expect(UNIDADES_PADRAO).toEqual(['un', 'pct', 'ml', 'g', 'kg', 'L', 'cx', 'pç', 'par', 'fr']);
    expect(UNIDADES_PADRAO.every(u => UNIDADES_PRODUTO.some(c => c.key === u))).toBe(true);
  });
  it('só pacote e caixa perguntam a quantidade de dentro', () => {
    expect(UNIDADES_PRODUTO.filter(u => unidadePedeQtdPorUnidade(u.key)).map(u => u.key)).toEqual(['pct', 'cx']);
  });
  it('rótulo da unidade; desconhecida devolve a chave', () => {
    expect(rotuloUnidade('fr')).toBe('Frasco');
    expect(rotuloUnidade('xyz')).toBe('xyz');
  });
});

describe('unidades visíveis', () => {
  it('normaliza: só do catálogo, sem repetição, na ordem do catálogo', () => {
    expect(normalizarUnidadesVisiveis(['kg', 'xyz', 'un', 'kg', 'fr'])).toEqual(['un', 'fr', 'kg']);
  });
  it('seletor: sem configuração usa o padrão', () => {
    expect(unidadesParaSeletor(null)).toEqual(normalizarUnidadesVisiveis(UNIDADES_PADRAO));
  });
  it('seletor: configuração da empresa, na ordem do catálogo', () => {
    expect(unidadesParaSeletor(['kg', 'un'])).toEqual(['un', 'kg']);
  });
  it('seletor: a unidade do produto editado nunca some (mesmo oculta ou fora do catálogo)', () => {
    expect(unidadesParaSeletor(['un'], 'cx')).toEqual(['un', 'cx']);
    expect(unidadesParaSeletor(['un'], 'galão')).toEqual(['un', 'galão']);
    expect(unidadesParaSeletor(['un', 'cx'], 'cx')).toEqual(['un', 'cx']);
  });
});

describe('parseQuantidadeBR', () => {
  it('vírgula, ponto decimal, milhar; vazio e negativo viram 0', () => {
    expect(parseQuantidadeBR('0,5')).toBe(0.5);
    expect(parseQuantidadeBR('0.5')).toBe(0.5);
    expect(parseQuantidadeBR('1.234,56')).toBe(1234.56);
    expect(parseQuantidadeBR('')).toBe(0);
    expect(parseQuantidadeBR('-3')).toBe(0);
  });
});

describe('montarProduto', () => {
  it('material: payload com números lidos em BR e sem preço de venda', () => {
    const r = montarProduto(form({ precoVenda: '99' }), { empresaId: 'e1', editando: false });
    expect(r).toEqual({ payload: {
      empresa_id: 'e1', nome: 'Cola', tipo: 'material', categoria: 'cilios', unidade: 'un', qtd_por_unidade: 1,
      estoque_atual: 3, estoque_minimo: 1, preco_custo: 12.5, preco_venda: 0, ativo: true,
    } });
  });
  it('edição não manda ativo (não reativa nem desativa)', () => {
    const r = montarProduto(form(), { empresaId: 'e1', editando: true });
    expect('payload' in r && r.payload).not.toHaveProperty('ativo');
    expect('payload' in r && r.payload.estoque_atual).toBe(3);
  });
  it('venda exige preço de venda maior que zero', () => {
    expect(montarProduto(form({ tipo: 'venda', precoVenda: '' }), { empresaId: 'e1', editando: false }))
      .toEqual({ erro: 'Informe o preço de venda.' });
    const ok = montarProduto(form({ tipo: 'venda', precoVenda: '1.234,50' }), { empresaId: 'e1', editando: false });
    expect('payload' in ok && ok.payload.preco_venda).toBe(1234.5);
  });
  it('quantidade dentro só para pacote/caixa, inteira e no mínimo 1', () => {
    const pct = montarProduto(form({ unidade: 'pct', qtdPorUnidade: '12' }), { empresaId: 'e1', editando: false });
    expect('payload' in pct && pct.payload.qtd_por_unidade).toBe(12);
    const arred = montarProduto(form({ unidade: 'cx', qtdPorUnidade: '2,6' }), { empresaId: 'e1', editando: false });
    expect('payload' in arred && arred.payload.qtd_por_unidade).toBe(3);
    const vazio = montarProduto(form({ unidade: 'cx', qtdPorUnidade: '' }), { empresaId: 'e1', editando: false });
    expect('payload' in vazio && vazio.payload.qtd_por_unidade).toBe(1);
    const kit = montarProduto(form({ unidade: 'kit', qtdPorUnidade: '5' }), { empresaId: 'e1', editando: false });
    expect('payload' in kit && kit.payload.qtd_por_unidade).toBe(1);
  });
  it('erros: nome, categoria fora do catálogo, unidade vazia', () => {
    expect(montarProduto(form({ nome: '  ' }), { empresaId: 'e1', editando: false })).toEqual({ erro: 'Informe o nome do produto.' });
    expect(montarProduto(form({ categoria: 'Pele' }), { empresaId: 'e1', editando: false })).toEqual({ erro: 'Escolha uma categoria.' });
    expect(montarProduto(form({ unidade: '' }), { empresaId: 'e1', editando: false })).toEqual({ erro: 'Escolha a unidade de medida.' });
  });
});

describe('resumos', () => {
  it('resumoProdutos: contagens, alertas (baixo e zerado) e valor sem saldo negativo', () => {
    expect(resumoProdutos([
      { tipo: 'material', estoque_atual: 2, estoque_minimo: 2, preco_custo: 10.1 },
      { tipo: 'material', estoque_atual: 5, estoque_minimo: 1, preco_custo: 3 },
      { tipo: 'venda', estoque_atual: -1, estoque_minimo: 0, preco_custo: 50 },
    ])).toEqual({ materiais: 2, venda: 1, alertas: 2, valorTotal: 35.2 });
  });
  it('resumoMovimentos: contagem e soma por tipo', () => {
    expect(resumoMovimentos([
      { tipo: 'entrada', quantidade: 2 }, { tipo: 'saida', quantidade: 1.5 }, { tipo: 'entrada', quantidade: 3 },
    ])).toEqual({ entradas: 2, saidas: 1, total: 3, qtdEntradas: 5, qtdSaidas: 1.5 });
  });
  it('margemVenda: % inteiro; sem custo ou venda devolve null', () => {
    expect(margemVenda(10, 15)).toBe(50);
    expect(margemVenda(0, 15)).toBeNull();
    expect(margemVenda(10, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd web && npx vitest run tests/unit/estoque-regras.test.ts`
Expected: FAIL (exports inexistentes)

- [ ] **Step 3: Implement** — acrescentar ao final de `shared/estoque.ts`, e o import no topo (logo abaixo do comentário de cabeçalho):

```ts
import { parseValorBR } from './comanda-fechamento';
```

```ts
// ── Categorias e unidades (catálogo único web e app) ─────────────

/** Categorias de produto na ordem de exibição (chave gravada no banco + rótulo). */
export const CATEGORIAS_PRODUTO: { key: string; label: string }[] =
  Object.entries(ROTULOS_CATEGORIA_PRODUTO).map(([key, label]) => ({ key, label }));

export type GrupoUnidade = 'contagem' | 'embalagem' | 'volume' | 'peso' | 'comprimento' | 'outras';

/** Grupos de unidade na ordem de exibição (agrupam os chips do ajuste de unidades). */
export const GRUPOS_UNIDADE: { key: GrupoUnidade; label: string }[] = [
  { key: 'contagem', label: 'Contagem' },
  { key: 'embalagem', label: 'Embalagens' },
  { key: 'volume', label: 'Volume' },
  { key: 'peso', label: 'Peso' },
  { key: 'comprimento', label: 'Comprimento' },
  { key: 'outras', label: 'Outras' },
];

/** Catálogo completo de unidades de medida (chave gravada em `produtos.unidade`), na ordem de exibição. */
export const UNIDADES_PRODUTO: { key: string; label: string; grupo: GrupoUnidade }[] = [
  { key: 'un', label: 'Unidade', grupo: 'contagem' },
  { key: 'pç', label: 'Peça', grupo: 'contagem' },
  { key: 'par', label: 'Par', grupo: 'contagem' },
  { key: 'kit', label: 'Kit', grupo: 'contagem' },
  { key: 'pct', label: 'Pacote', grupo: 'embalagem' },
  { key: 'cx', label: 'Caixa', grupo: 'embalagem' },
  { key: 'fr', label: 'Frasco', grupo: 'embalagem' },
  { key: 'tb', label: 'Tubo', grupo: 'embalagem' },
  { key: 'pote', label: 'Pote', grupo: 'embalagem' },
  { key: 'amp', label: 'Ampola', grupo: 'embalagem' },
  { key: 'sachê', label: 'Sachê', grupo: 'embalagem' },
  { key: 'rolo', label: 'Rolo', grupo: 'embalagem' },
  { key: 'folha', label: 'Folha', grupo: 'embalagem' },
  { key: 'ml', label: 'Mililitro', grupo: 'volume' },
  { key: 'L', label: 'Litro', grupo: 'volume' },
  { key: 'mg', label: 'Miligrama', grupo: 'peso' },
  { key: 'g', label: 'Grama', grupo: 'peso' },
  { key: 'kg', label: 'Quilo', grupo: 'peso' },
  { key: 'cm', label: 'Centímetro', grupo: 'comprimento' },
  { key: 'm', label: 'Metro', grupo: 'comprimento' },
  { key: 'dose', label: 'Dose', grupo: 'outras' },
];

/** Unidades visíveis quando a empresa nunca ajustou (lista antiga do web + frasco). */
export const UNIDADES_PADRAO = ['un', 'pct', 'ml', 'g', 'kg', 'L', 'cx', 'pç', 'par', 'fr'];

/** Só pacote e caixa perguntam quantas unidades vêm dentro (`qtd_por_unidade`). Decisão do dono. */
export function unidadePedeQtdPorUnidade(u: string): boolean {
  return u === 'pct' || u === 'cx';
}

/** Rótulo da unidade no catálogo; desconhecida devolve a própria chave. */
export function rotuloUnidade(u: string): string {
  return UNIDADES_PRODUTO.find(x => x.key === u)?.label ?? u;
}

/** Lista de unidades → só chaves do catálogo, sem repetição, na ordem do catálogo (o que se grava). */
export function normalizarUnidadesVisiveis(lista: string[]): string[] {
  const set = new Set(lista);
  return UNIDADES_PRODUTO.filter(u => set.has(u.key)).map(u => u.key);
}

/**
 * Opções do seletor de unidade: as visíveis da empresa (`null` = padrão), na ordem do catálogo,
 * mais a unidade atual do produto editado se ela não estiver lá — dado já gravado nunca some.
 */
export function unidadesParaSeletor(visiveis: string[] | null, atual?: string | null): string[] {
  const base = normalizarUnidadesVisiveis(visiveis ?? UNIDADES_PADRAO);
  return atual && !base.includes(atual) ? [...base, atual] : base;
}

/** Quantidade digitada → número ("0,5", "0.5", "1.234,56"); vazio, inválido ou negativo → 0. */
export function parseQuantidadeBR(texto: string): number {
  return parseValorBR(texto);
}

// ── Cadastro de produto ──────────────────────────────────────────

export type TipoProduto = 'material' | 'venda';

/** Campos do formulário de produto como a tela os tem (texto digitado). */
export type FormProduto = {
  nome: string; tipo: TipoProduto; categoria: string; unidade: string; qtdPorUnidade: string;
  estoqueAtual: string; estoqueMinimo: string; precoCusto: string; precoVenda: string;
};

/** Linha de `produtos` para INSERT/UPDATE. `ativo` só no cadastro. */
export type PayloadProduto = {
  empresa_id: string; nome: string; tipo: TipoProduto; categoria: string; unidade: string; qtd_por_unidade: number;
  estoque_atual: number; estoque_minimo: number; preco_custo: number; preco_venda: number; ativo?: boolean;
};

const centavosEstoque = (v: number) => Math.round(v * 100) / 100;

/**
 * Valida o formulário e monta a linha de `produtos` (mesma regra no web e no app).
 * Nome, categoria do catálogo e unidade obrigatórios; preço de venda só (e obrigatório) para venda;
 * `qtd_por_unidade` só para pacote/caixa (inteiro ≥ 1); saldo editável no cadastro e na edição.
 */
export function montarProduto(form: FormProduto, ctx: { empresaId: string; editando: boolean }): { payload: PayloadProduto } | { erro: string } {
  const nome = form.nome.trim();
  if (!nome) return { erro: 'Informe o nome do produto.' };
  if (!Object.prototype.hasOwnProperty.call(ROTULOS_CATEGORIA_PRODUTO, form.categoria)) return { erro: 'Escolha uma categoria.' };
  if (!form.unidade) return { erro: 'Escolha a unidade de medida.' };
  const precoVenda = form.tipo === 'venda' ? centavosEstoque(parseValorBR(form.precoVenda)) : 0;
  if (form.tipo === 'venda' && precoVenda <= 0) return { erro: 'Informe o preço de venda.' };
  const qtdDentro = unidadePedeQtdPorUnidade(form.unidade) ? Math.round(parseQuantidadeBR(form.qtdPorUnidade)) : 1;
  const payload: PayloadProduto = {
    empresa_id: ctx.empresaId,
    nome,
    tipo: form.tipo,
    categoria: form.categoria,
    unidade: form.unidade,
    qtd_por_unidade: qtdDentro >= 1 ? qtdDentro : 1,
    estoque_atual: parseQuantidadeBR(form.estoqueAtual),
    estoque_minimo: parseQuantidadeBR(form.estoqueMinimo),
    preco_custo: centavosEstoque(parseValorBR(form.precoCusto)),
    preco_venda: precoVenda,
  };
  if (!ctx.editando) payload.ativo = true;
  return { payload };
}

// ── Resumos (cartões das telas) ─────────────────────────────────

/** Cartões do Estoque: materiais, para venda, precisam de reposição (baixo ou zerado) e valor (saldo × custo). */
export function resumoProdutos(ps: { tipo: string; estoque_atual: number; estoque_minimo: number; preco_custo: number }[]) {
  let centavos = 0;
  let alertas = 0;
  for (const p of ps) {
    const saldo = Number(p.estoque_atual);
    if (statusEstoque(saldo, Number(p.estoque_minimo)) !== 'ok') alertas++;
    centavos += Math.round(Math.max(saldo, 0) * Number(p.preco_custo) * 100);
  }
  return {
    materiais: ps.filter(p => p.tipo === 'material').length,
    venda: ps.filter(p => p.tipo === 'venda').length,
    alertas,
    valorTotal: centavos / 100,
  };
}

/** Cartões do mês em Movimentações: quantos registros e quanto entrou/saiu. */
export function resumoMovimentos(ms: { tipo: string; quantidade: number }[]) {
  const ent = ms.filter(m => m.tipo === 'entrada');
  const sai = ms.filter(m => m.tipo === 'saida');
  const soma = (xs: { quantidade: number }[]) => Math.round(xs.reduce((s, m) => s + Number(m.quantidade), 0) * 1000) / 1000;
  return { entradas: ent.length, saidas: sai.length, total: ms.length, qtdEntradas: soma(ent), qtdSaidas: soma(sai) };
}

/** Margem de revenda em % inteiro ((venda / custo − 1) × 100); sem custo ou sem venda → null. */
export function margemVenda(custo: number, venda: number): number | null {
  if (!(custo > 0) || !(venda > 0)) return null;
  return Math.round((venda / custo - 1) * 100);
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run tests/unit/estoque-regras.test.ts` → PASS.
Também rode os testes que já usam `shared/estoque`: `cd web && npx vitest run tests/unit/exportacao` (se existirem testes de exportação de estoque, devem continuar passando). E `cd web && npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add shared/estoque.ts web/tests/unit/estoque-regras.test.ts
git commit -m "feat(shared): catalogo de unidades e categorias, cadastro de produto e resumos do estoque"
```

---

### Task 3: Consultas de estoque em `shared/estoque-consultas.ts`

**Files:**
- Create: `shared/estoque-consultas.ts`
- Test: `web/tests/unit/estoque-consultas.test.ts`

**Interfaces:**
- Consumes: `buscarTodasOuLancar`, `ClienteDb` de `./kpis-financeiros-consultas`; `limitesMes` de `./periodos`; `mensagemErroBanco` de `./erros`; `normalizarUnidadesVisiveis` de `./estoque` (Task 2). O `fakeDb` de `web/tests/unit/fixtures/fake-db.ts` já aceita `rpc` (sem `rpc` → `PGRST202`) e devolve `{ db, chamadas, rpcs }`.
- Produces:
  - `type ProdutoEstoque = { id: string; empresa_id: string; nome: string; categoria: string; unidade: string; qtd_por_unidade: number; estoque_atual: number; estoque_minimo: number; preco_custo: number; preco_venda: number; tipo: 'material' | 'venda'; ativo: boolean }`
  - `type MovimentoEstoque = { id: string; tipo: 'entrada' | 'saida' | 'ajuste'; quantidade: number; motivo: string | null; created_at: string; agendamento_id: string | null; produto_id: string; produto: { nome: string; unidade: string } | null }`
  - `type ClienteDbEstoque = ClienteDb & { rpc(fn: string, args?: Record<string, unknown>): any }`
  - `carregarProdutosEstoque(db: ClienteDb, empresaId: string): Promise<ProdutoEstoque[]>`
  - `carregarMovimentosMes(db: ClienteDb, empresaId: string, mesChave: string): Promise<MovimentoEstoque[]>`
  - `movimentarEstoque(db: ClienteDbEstoque, d: { empresaId: string; produto: { id: string; estoque_atual: number; nome: string; unidade: string }; tipo: 'entrada' | 'saida'; quantidade: number; motivo: string }): Promise<{ novoSaldo: number }>`
  - `carregarUnidadesVisiveis(db: ClienteDb, empresaId: string): Promise<{ unidades: string[] | null; disponivel: boolean }>`
  - `salvarUnidadesVisiveis(db: ClienteDb, empresaId: string, unidades: string[]): Promise<string[]>`

- [ ] **Step 1: Write the failing test** — `web/tests/unit/estoque-consultas.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  carregarProdutosEstoque, carregarMovimentosMes, movimentarEstoque, carregarUnidadesVisiveis, salvarUnidadesVisiveis,
} from '@shared/estoque-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const produto = { id: 'p1', estoque_atual: 5, nome: 'Creme', unidade: 'un' };

describe('carregarProdutosEstoque', () => {
  it('só ativos da empresa, ordem categoria/nome/id, paginado', async () => {
    const { db, chamadas } = fakeDb({ linhas: { produtos: [{ id: 'p1', estoque_atual: '2', estoque_minimo: '1', preco_custo: '3', preco_venda: '0', qtd_por_unidade: null }] } });
    const r = await carregarProdutosEstoque(db, 'e1');
    const ops = opsDe(chamadas, 'produtos')[0];
    expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ops).toContainEqual(['eq', ['ativo', true]]);
    expect(ops.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['categoria', 'nome', 'id']);
    expect(ops.some(([m]) => m === 'range')).toBe(true);
    // números vêm como texto do PostgREST (numeric) e viram number; qtd nula vira 1
    expect(r[0]).toMatchObject({ estoque_atual: 2, estoque_minimo: 1, preco_custo: 3, preco_venda: 0, qtd_por_unidade: 1 });
  });
  it('erro lança (nunca lista vazia)', async () => {
    const { db } = fakeDb({ erroTabelas: { produtos: 'boom' } });
    await expect(carregarProdutosEstoque(db, 'e1')).rejects.toThrow('boom');
  });
});

describe('carregarMovimentosMes', () => {
  it('limites do mês em Brasília, com produto_id, ordem desc + id', async () => {
    const { db, chamadas } = fakeDb({ linhas: { estoque_movimentos: [] } });
    await carregarMovimentosMes(db, 'e1', '2026-10');
    const ops = opsDe(chamadas, 'estoque_movimentos')[0];
    const sel = ops.find(([m]) => m === 'select')![1][0] as string;
    expect(sel).toContain('produto_id');
    expect(sel).toContain('produto:produtos(nome, unidade)');
    expect(ops).toContainEqual(['gte', ['created_at', '2026-10-01T03:00:00.000Z']]);
    expect(ops).toContainEqual(['lte', ['created_at', '2026-11-01T02:59:59.999Z']]);
    expect(ops).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(ops).toContainEqual(['order', ['id']]);
  });
});

describe('movimentarEstoque', () => {
  const dados = { empresaId: 'e1', produto, tipo: 'saida' as const, quantidade: 2, motivo: ' uso ' };

  it('pela função: argumentos e saldo devolvido pelo banco', async () => {
    const { db, chamadas, rpcs } = fakeDb({ rpc: () => ({ data: 3, error: null }) });
    expect(await movimentarEstoque(db, dados)).toEqual({ novoSaldo: 3 });
    expect(rpcs).toEqual([{ fn: 'movimentar_estoque', args: { p_produto: 'p1', p_tipo: 'saida', p_quantidade: 2, p_motivo: 'uso' } }]);
    expect(chamadas).toHaveLength(0);
  });
  it('saldo como texto (numeric) vira number', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: '3.500', error: null }) });
    expect(await movimentarEstoque(db, dados)).toEqual({ novoSaldo: 3.5 });
  });
  it('erro da função vira mensagem e não tenta o caminho antigo', async () => {
    const { db, chamadas } = fakeDb({ rpc: () => ({ data: null, error: { code: 'P0001', message: 'Estoque insuficiente: Creme (restam 1 un)' } }) });
    await expect(movimentarEstoque(db, dados)).rejects.toThrow('Estoque insuficiente: Creme (restam 1 un)');
    expect(chamadas).toHaveLength(0);
  });
  it('permissão negada em português', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '42501', message: 'x' } }) });
    await expect(movimentarEstoque(db, dados)).rejects.toThrow('Você não tem permissão para movimentar o estoque. Fale com a dona ou a gestora.');
  });
  it('sem resposta (erro sem code) avisa para conferir antes de repetir', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }) });
    await expect(movimentarEstoque(db, dados)).rejects.toThrow('Sem resposta do servidor: a movimentação pode ter sido registrada. Confira em Movimentações antes de repetir.');
  });
  it('quantidade inválida não chama nada', async () => {
    const { db, chamadas, rpcs } = fakeDb({ rpc: () => ({ data: 1, error: null }) });
    await expect(movimentarEstoque(db, { ...dados, quantidade: 0 })).rejects.toThrow('Informe uma quantidade maior que zero.');
    expect(rpcs).toHaveLength(0);
    expect(chamadas).toHaveLength(0);
  });
  describe('sem a 088 (PGRST202): caminho antigo', () => {
    it('saída maior que o saldo da tela é recusada sem gravar', async () => {
      const { db, chamadas } = fakeDb({ awaitavel: true });
      await expect(movimentarEstoque(db, { ...dados, quantidade: 9 })).rejects.toThrow('Estoque insuficiente: Creme (restam 5 un)');
      expect(chamadas).toHaveLength(0);
    });
    it('grava o movimento e devolve saldo da tela ± quantidade', async () => {
      const { db, chamadas } = fakeDb({ awaitavel: true });
      expect(await movimentarEstoque(db, dados)).toEqual({ novoSaldo: 3 });
      expect(opsDe(chamadas, 'estoque_movimentos')[0][0]).toEqual(['insert', [{
        produto_id: 'p1', empresa_id: 'e1', tipo: 'saida', quantidade: 2, motivo: 'uso',
      }]]);
      expect(await movimentarEstoque(db, { ...dados, tipo: 'entrada', motivo: '' })).toEqual({ novoSaldo: 7 });
    });
    it('erro do insert lança (nunca sucesso falso)', async () => {
      const { db } = fakeDb({ awaitavel: true, erroTabelas: { estoque_movimentos: 'new row violates row-level security policy' } });
      await expect(movimentarEstoque(db, dados)).rejects.toThrow('Você não tem permissão para movimentar o estoque.');
    });
  });
});

describe('unidades visíveis', () => {
  it('sem linha: null e disponível', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { estoque_unidades_empresa: [] } });
    expect(await carregarUnidadesVisiveis(db, 'e1')).toEqual({ unidades: null, disponivel: true });
  });
  it('com linha: lista normalizada', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { estoque_unidades_empresa: [{ unidades: ['kg', 'un', 'zz'] }] } });
    expect(await carregarUnidadesVisiveis(db, 'e1')).toEqual({ unidades: ['un', 'kg'], disponivel: true });
  });
  it('tabela inexistente (sem a 088): null e indisponível', async () => {
    const { db } = fakeDb({ awaitavel: true, erroTabelas: { estoque_unidades_empresa: "Could not find the table 'public.estoque_unidades_empresa' in the schema cache" } });
    expect(await carregarUnidadesVisiveis(db, 'e1')).toEqual({ unidades: null, disponivel: false });
  });
  it('outro erro lança', async () => {
    const { db } = fakeDb({ awaitavel: true, erroTabelas: { estoque_unidades_empresa: 'boom' } });
    await expect(carregarUnidadesVisiveis(db, 'e1')).rejects.toThrow('boom');
  });
  it('salvar: upsert normalizado; lista vazia é recusada', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas: { estoque_unidades_empresa: [{ empresa_id: 'e1' }] } });
    expect(await salvarUnidadesVisiveis(db, 'e1', ['kg', 'un', 'zz'])).toEqual(['un', 'kg']);
    const ops = opsDe(chamadas, 'estoque_unidades_empresa')[0];
    expect(ops[0][0]).toBe('upsert');
    expect((ops[0][1][0] as Record<string, unknown>)).toMatchObject({ empresa_id: 'e1', unidades: ['un', 'kg'] });
    expect(ops).toContainEqual(['select', ['empresa_id']]);
    await expect(salvarUnidadesVisiveis(db, 'e1', ['zz'])).rejects.toThrow('Deixe pelo menos uma unidade ligada.');
  });
  it('salvar sem linha devolvida = sem permissão', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { estoque_unidades_empresa: [] } });
    await expect(salvarUnidadesVisiveis(db, 'e1', ['un'])).rejects.toThrow('Você não tem permissão para ajustar as unidades.');
  });
});
```

Observação sobre o `fakeDb`: com `awaitavel: true`, `await` numa cadeia sem `range` devolve `linhas[tabela]` (ou o erro de `erroTabelas`). `upsert(...).select('empresa_id')` não tem `update`/`delete`, então cai no `await` → `linhas.estoque_unidades_empresa`.

- [ ] **Step 2: Run to see it fail**

Run: `cd web && npx vitest run tests/unit/estoque-consultas.test.ts`
Expected: FAIL (módulo inexistente)

- [ ] **Step 3: Implement** — `shared/estoque-consultas.ts`

```ts
/**
 * Acesso ao banco do Estoque (web e app). Toda consulta LANÇA erro em vez de devolver lista vazia.
 * A movimentação manual passa pela função `movimentar_estoque` (migration 088: trava e recusa
 * saída maior que o saldo); sem a 088 (`PGRST202`) usa o caminho antigo.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { limitesMes } from './periodos';
import { mensagemErroBanco } from './erros';
import { normalizarUnidadesVisiveis } from './estoque';

export type ProdutoEstoque = {
  id: string; empresa_id: string; nome: string; categoria: string; unidade: string; qtd_por_unidade: number;
  estoque_atual: number; estoque_minimo: number; preco_custo: number; preco_venda: number;
  tipo: 'material' | 'venda'; ativo: boolean;
};

export type MovimentoEstoque = {
  id: string; tipo: 'entrada' | 'saida' | 'ajuste'; quantidade: number; motivo: string | null; created_at: string;
  agendamento_id: string | null; produto_id: string; produto: { nome: string; unidade: string } | null;
};

/** Cliente do banco com `rpc` (a função da 088). Estrutural. */
export type ClienteDbEstoque = ClienteDb & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
};

const num = (v: unknown, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? n : padrao; };

/** Produtos ativos da empresa (ordem categoria/nome), com os numéricos convertidos. */
export async function carregarProdutosEstoque(db: ClienteDb, empresaId: string): Promise<ProdutoEstoque[]> {
  const linhas = await buscarTodasOuLancar<Record<string, unknown>>((de, ate) => db.from('produtos')
    .select('*')
    .eq('empresa_id', empresaId).eq('ativo', true)
    .order('categoria').order('nome').order('id')
    .range(de, ate));
  return linhas.map(p => ({
    ...(p as unknown as ProdutoEstoque),
    estoque_atual: num(p.estoque_atual),
    estoque_minimo: num(p.estoque_minimo),
    preco_custo: num(p.preco_custo),
    preco_venda: num(p.preco_venda),
    qtd_por_unidade: num(p.qtd_por_unidade, 1) || 1,
  }));
}

/** Movimentos do mês 'yyyy-MM' (limites em Brasília), mais recentes primeiro. */
export async function carregarMovimentosMes(db: ClienteDb, empresaId: string, mesChave: string): Promise<MovimentoEstoque[]> {
  const { startIso, endIso } = limitesMes(mesChave);
  const linhas = await buscarTodasOuLancar<Record<string, unknown>>((de, ate) => db.from('estoque_movimentos')
    .select('id, tipo, quantidade, motivo, created_at, agendamento_id, produto_id, produto:produtos(nome, unidade)')
    .eq('empresa_id', empresaId)
    .gte('created_at', startIso).lte('created_at', endIso)
    .order('created_at', { ascending: false }).order('id')
    .range(de, ate));
  return linhas.map(m => ({ ...(m as unknown as MovimentoEstoque), quantidade: num(m.quantidade) }));
}

const SEM_RESPOSTA = 'Sem resposta do servidor: a movimentação pode ter sido registrada. Confira em Movimentações antes de repetir.';
const fmtSaldo = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/**
 * Entrada ou saída manual. Pela função da 088 (saldo conferido e travado no banco; devolve o saldo
 * real). Sem a 088 (`PGRST202`): confere o saldo da tela e grava o movimento (o trigger baixa o
 * saldo). Lança `Error` com a mensagem para a tela.
 */
export async function movimentarEstoque(
  db: ClienteDbEstoque,
  d: { empresaId: string; produto: { id: string; estoque_atual: number; nome: string; unidade: string }; tipo: 'entrada' | 'saida'; quantidade: number; motivo: string },
): Promise<{ novoSaldo: number }> {
  if (!(d.quantidade > 0)) throw new Error('Informe uma quantidade maior que zero.');
  const motivo = d.motivo.trim();
  const { data, error } = await db.rpc('movimentar_estoque', {
    p_produto: d.produto.id, p_tipo: d.tipo, p_quantidade: d.quantidade, p_motivo: motivo,
  });
  if (error?.code !== 'PGRST202') {
    if (error) throw new Error(error.code ? mensagemErroBanco(error, 'movimentar o estoque') : SEM_RESPOSTA);
    const saldo = Number(data);
    if (data === null || data === undefined || !Number.isFinite(saldo)) throw new Error(SEM_RESPOSTA);
    return { novoSaldo: saldo };
  }

  // Sem a 088: caminho antigo, saldo conferido contra o que a tela mostra.
  if (d.tipo === 'saida' && d.quantidade > d.produto.estoque_atual) {
    throw new Error(`Estoque insuficiente: ${d.produto.nome} (restam ${fmtSaldo(d.produto.estoque_atual)} ${d.produto.unidade})`);
  }
  const { error: eIns } = await db.from('estoque_movimentos').insert({
    produto_id: d.produto.id, empresa_id: d.empresaId, tipo: d.tipo, quantidade: d.quantidade, motivo: motivo || null,
  });
  if (eIns) throw new Error(mensagemErroBanco(eIns, 'movimentar o estoque'));
  const novo = d.tipo === 'entrada' ? d.produto.estoque_atual + d.quantidade : d.produto.estoque_atual - d.quantidade;
  return { novoSaldo: Math.round(novo * 1000) / 1000 };
}

/** Tabela inexistente (a 088 não foi rodada). */
const tabelaInexistente = (e: { code?: string | null; message?: string | null }) =>
  e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(e.message ?? '');

/**
 * Unidades visíveis da empresa. `unidades: null` = usar o padrão; `disponivel: false` = sem a 088
 * (a tela esconde o ajuste de unidades).
 */
export async function carregarUnidadesVisiveis(db: ClienteDb, empresaId: string): Promise<{ unidades: string[] | null; disponivel: boolean }> {
  const { data, error } = await db.from('estoque_unidades_empresa').select('unidades').eq('empresa_id', empresaId);
  if (error) {
    if (tabelaInexistente(error)) return { unidades: null, disponivel: false };
    throw new Error(mensagemErroBanco(error, 'carregar as unidades de medida'));
  }
  const linha = (data ?? [])[0] as { unidades?: string[] } | undefined;
  const unidades = linha?.unidades ? normalizarUnidadesVisiveis(linha.unidades) : [];
  return { unidades: unidades.length > 0 ? unidades : null, disponivel: true };
}

/** Grava as unidades visíveis (normalizadas). Devolve a lista gravada. */
export async function salvarUnidadesVisiveis(db: ClienteDb, empresaId: string, unidades: string[]): Promise<string[]> {
  const lista = normalizarUnidadesVisiveis(unidades);
  if (lista.length === 0) throw new Error('Deixe pelo menos uma unidade ligada.');
  const { data, error } = await db.from('estoque_unidades_empresa')
    .upsert({ empresa_id: empresaId, unidades: lista, atualizado_em: new Date().toISOString() })
    .select('empresa_id');
  if (error) throw new Error(mensagemErroBanco(error, 'ajustar as unidades'));
  if (!data || data.length === 0) throw new Error('Você não tem permissão para ajustar as unidades. Fale com a dona ou a gestora.');
  return lista;
}
```

- [ ] **Step 4: Run tests and tsc**

Run: `cd web && npx vitest run tests/unit/estoque-consultas.test.ts` → PASS; `cd web && npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add shared/estoque-consultas.ts web/tests/unit/estoque-consultas.test.ts
git commit -m "feat(shared): consultas de estoque, movimentacao pela funcao da 088 e unidades visiveis"
```

---

### Task 4: Web — tela de Estoque pelas regras e consultas de shared

**Files:**
- Modify: `web/app/(app)/estoque/page.tsx`
- Create: `web/app/(app)/estoque/UnidadesModal.tsx`
- Test: `web/tests/unit/estoque-telas.test.ts` (novo; o bloco `describe('web', …)` — a Task 6 acrescenta o bloco do app)

**Interfaces:**
- Consumes: tudo da Task 2 (`@shared/estoque`) e da Task 3 (`@shared/estoque-consultas`); `chaveMesBRT`, `somarMeses`, `rotuloMesAno` de `@shared/periodos`; `usePermissoes` de `@/components/PermissoesProvider` (`pode('estoque.acessar')`); `mensagemErroBanco` de `@shared/erros`.
- Produces: `UnidadesModal({ empresaId, visiveis, onClose, onSalvo }: { empresaId: string; visiveis: string[] | null; onClose: () => void; onSalvo: (unidades: string[]) => void })`.

Requisitos (sem mudar o visual existente além do necessário):

1. **Tipos:** troque os tipos locais `Produto`/`MovItem` por `ProdutoEstoque`/`MovimentoEstoque` de shared. Mantenha `CATS` (chave → cor/fundo) local, mas gere a lista de categorias a partir de `CATEGORIAS_PRODUTO` (label vindo de shared). Remova `const UNIDADES` local.
2. **Carga inicial:** `carregarProdutosEstoque(supabase, empresaId)` e `carregarUnidadesVisiveis(supabase, empresaId)` em `Promise.all`. Erro → estado `erroCarga`, mostrado num banner no topo (estilo `bg-red-soft`, ícone `AlertTriangle`), com botão "Tentar de novo". Não deixe `loading` preso: `finally`.
3. **Movimentações:**
   - mês guardado como chave `'yyyy-MM'`: inicial `chaveMesBRT(new Date())`, navegação com `somarMeses(chave, ±1)` e rótulo `rotuloMesAno`;
   - carga com `carregarMovimentosMes`, mais um contador de requisição (`useRef`) para descartar resposta de mês antigo;
   - erro → `erroMov` em banner na aba;
   - remova `startOfMonth`/`endOfMonth` deste arquivo.
4. **Filtro por produto pelo id:**
   - filtre por `m.produto_id === filtroProdId`, nunca pelo nome;
   - `movDoProduto` também filtra pelo id;
   - remova `produtoFiltradoNome` se ele ficar sem uso.
5. **Cartões:**
   - os 4 cartões de Produtos usam `resumoProdutos(produtos)` (`materiais`, `venda`, `alertas`, `valorTotal`);
   - os 3 do mês usam `resumoMovimentos(movDoProduto)`;
   - o subtítulo das quantidades usa a vírgula brasileira (`toLocaleString` não é permitido: use `String(n).replace('.', ',')`).
6. **ProdutoModal:**
   - o salvar monta com `montarProduto({ nome, tipo, categoria, unidade, qtdPorUnidade: qtdPorUn, estoqueAtual: estAtual, estoqueMinimo: estMin, precoCusto: custo, precoVenda }, { empresaId, editando: !!ed })`;
   - `erro` → `setErro(r.erro)` e não grava;
   - o insert/update continua com o payload devolvido (mesmo `.select().single()` e tratamento de `PGRST116` que já existe);
   - seletor de unidade: `unidadesParaSeletor(visiveis, ed?.unidade)`, mostrando `rotuloUnidade(u)` (`"Pacote (pct)"`);
   - o campo "quantas unidades dentro" aparece só com `unidadePedeQtdPorUnidade(unidade)`;
   - os previews de total em unidades e de margem usam `parseQuantidadeBR`/`margemVenda` (sem `parseFloat`);
   - `ProdutoModal` recebe a prop nova `visiveis: string[] | null`.
7. **MovModal:**
   - `qtdNum = parseQuantidadeBR(qtd)`;
   - salvar chama `movimentarEstoque(supabase, { empresaId: produto.empresa_id, produto, tipo, quantidade: qtdNum, motivo: obs })` em try/catch: erro → `setErro(e.message)`; sucesso → `setSucesso({ tipo, qtd: qtdNum, novoEstoque: r.novoSaldo })`;
   - a pré-checagem local de saldo pode continuar (mensagem antecipada), mas a fonte de verdade é a função.
8. **Unidades:**
   - botão "Unidades" no cabeçalho da aba Produtos, só com `pode('estoque.acessar') && unidadesDisponivel`;
   - abre o `UnidadesModal`, que mostra `GRUPOS_UNIDADE` com os chips de `UNIDADES_PRODUTO` daquele grupo (rótulo + chave), cada um liga/desliga;
   - o modal tem "Restaurar padrão" (`UNIDADES_PADRAO`), Salvar (`salvarUnidadesVisiveis`) e Cancelar;
   - Salvar fica desabilitado com 0 ligadas; erro aparece no modal; ao salvar, `onSalvo(lista)` atualiza `visiveis`;
   - use o `useScrollLock()` e a estrutura `bm-modal` dos outros modais do arquivo.
9. Nenhum `parseFloat(` sobra no arquivo.

- [ ] **Step 1: Write the failing test** — `web/tests/unit/estoque-telas.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(process.cwd(), '..');
const ler = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8');

describe('web', () => {
  const web = ler('web', 'app', '(app)', 'estoque', 'page.tsx');
  const modal = ler('web', 'app', '(app)', 'estoque', 'UnidadesModal.tsx');
  it('usa as consultas e regras de shared', () => {
    for (const f of ['carregarProdutosEstoque', 'carregarMovimentosMes', 'movimentarEstoque', 'carregarUnidadesVisiveis',
      'montarProduto', 'unidadesParaSeletor', 'unidadePedeQtdPorUnidade', 'resumoProdutos', 'resumoMovimentos', 'parseQuantidadeBR']) {
      expect(web).toContain(f);
    }
  });
  it('sem parseFloat, sem mês no fuso do navegador, sem lista local de unidades', () => {
    expect(web).not.toContain('parseFloat(');
    expect(web).not.toMatch(/startOfMonth|endOfMonth/);
    expect(web).not.toMatch(/const UNIDADES\s*=/);
  });
  it('filtro de movimentos pelo id do produto', () => {
    expect(web).toContain('produto_id === filtroProdId');
    expect(web).not.toMatch(/produto\.nome === produtoFiltradoNome/);
  });
  it('ajuste de unidades com permissão e só com a 088', () => {
    expect(web).toContain("pode('estoque.acessar')");
    expect(web).toContain('UnidadesModal');
    expect(modal).toContain('salvarUnidadesVisiveis');
    expect(modal).toContain('GRUPOS_UNIDADE');
    expect(modal).toContain('UNIDADES_PADRAO');
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd web && npx vitest run tests/unit/estoque-telas.test.ts` → FAIL.
- [ ] **Step 3: Implement os itens 1–9.**
- [ ] **Step 4: Verify:**
  - `cd web && npx vitest run tests/unit/estoque-telas.test.ts tests/unit/estoque-regras.test.ts tests/unit/estoque-consultas.test.ts` → PASS;
  - `cd web && npx tsc --noEmit` → 0;
  - `cd web && npx vitest run` → tudo PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(estoque/web): tela pelas regras de shared, mes em Brasilia, movimentacao conferida e ajuste de unidades"`

---

### Task 5: App — hook e cadastro/edição de produto

**Files:**
- Modify: `mobile/hooks/useEstoque.ts`
- Modify: `mobile/app/(empresa)/novo-produto.tsx`
- Modify: `mobile/app/(empresa)/editar-produto/[id].tsx`
- Test: a Task 6 cobre por varredura. Aqui basta tsc e os testes existentes.

**Interfaces:**
- Consumes: as Tasks 2 e 3. `supabase` de `@/lib/supabase` e `useAuthStore` de `@/stores/authStore`.
- Produces: o hook `useEstoque()` (mesmo nome) passa a devolver:
  - `produtos: (ProdutoEstoque & { status: StatusEstoque })[]`
  - `criticos`, `baixos` e `normais` (mesmo cálculo de hoje, via `statusEstoque`)
  - `totalCriticos`, `totalAtencao`
  - `resumo: ReturnType<typeof resumoProdutos>`
  - `isLoading`, `isError`, `erro: string | null`, `refetch`
  - `unidadesVisiveis: string[] | null`, `unidadesDisponivel: boolean`
  - `movimentar(produto: ProdutoEstoque, tipo: 'entrada' | 'saida', quantidade: number, motivo: string): Promise<{ novoSaldo: number }>`: lança em erro e, em sucesso, invalida `['estoque', empresaId]` e `['estoque-movimentos', empresaId]`
  - `salvarUnidades(lista: string[]): Promise<string[]>`: invalida `['estoque-unidades', empresaId]`
- Produces também `useMovimentosMes(mesChave: string, ativo: boolean)`, exportado do mesmo arquivo: `useQuery` com chave `['estoque-movimentos', empresaId, mesChave]`, `enabled: !!empresaId && ativo`, `queryFn: carregarMovimentosMes(...)`, `placeholderData: keepPreviousData`. Devolve o objeto do `useQuery`.

Requisitos:
1. **`useEstoque`:**
   - produtos por `carregarProdutosEstoque` (chave `['estoque', empresaId]`, igual a hoje);
   - unidades por `carregarUnidadesVisiveis` (chave `['estoque-unidades', empresaId]`);
   - o tipo `Produto` exportado passa a ser `ProdutoEstoque & { status }`;
   - remova a mutação antiga, que não conferia erro.
2. **`novo-produto.tsx` e `editar-produto/[id].tsx`:** os mesmos campos e regras do `ProdutoModal` do web:
   - tipo Material/Insumo × Para venda (PDV);
   - nome;
   - categoria por chips de `CATEGORIAS_PRODUTO`, que mostram o rótulo e gravam a chave;
   - unidade por chips de `unidadesParaSeletor(unidadesVisiveis, produtoAtual?.unidade)` com `rotuloUnidade`;
   - "Quantas unidades vêm dentro?", só quando `unidadePedeQtdPorUnidade`;
   - estoque atual (no cadastro e na edição);
   - mínimo;
   - custo;
   - preço de venda com "Margem: X%" (`margemVenda`), só para venda.
   - Salvar com `montarProduto(form, { empresaId, editando })`. Em `erro`, `Alert.alert('Confira os dados', erro)`.
   - O insert/update confere erro (`mensagemErroBanco`).
   - O update usa `.eq('id').eq('empresa_id').select('id')` e trata 0 linhas como sem permissão.
   - Remova as listas antigas `CATEGORIAS`/`UNIDADES` e o `parseBRLFloat` dos dois arquivos.
   - A edição carrega o produto (incluindo `tipo`, `preco_venda`, `qtd_por_unidade`) e preenche os campos: números com vírgula, `qtd_por_unidade` só se for > 1.
   - Excluir/desativar continua como está, mas conferindo o erro.
3. Os dois arquivos invalidam `['estoque', empresaId]` depois de salvar, como já fazem hoje.

- [ ] **Step 1:** Implemente os itens 1–3.
- [ ] **Step 2:** Rode `cd mobile && npx tsc --noEmit` (9 erros, a baseline; nenhum nos arquivos tocados) e `cd web && npx vitest run` (tudo PASS). `estoque.tsx` ainda usa a API antiga do hook: ajuste o mínimo para compilar (trocar `registrarMovimento(id, …)` por `movimentar(produto, …)`). A tela completa é a Task 6.
- [ ] **Step 3: Commit** — `git commit -m "feat(estoque/app): cadastro e edicao de produto iguais ao web; hook pelas consultas de shared"`

---

### Task 6: App — tela de Estoque completa + invalidação depois de comanda/venda

**Files:**
- Modify: `mobile/app/(empresa)/estoque.tsx`
- Create: `mobile/components/UnidadesEstoqueModal.tsx`
- Modify: `mobile/app/(empresa)/nova-comanda.tsx` e `mobile/app/(empresa)/vendas.tsx` (só a invalidação)
- Test: `web/tests/unit/estoque-telas.test.ts` (acrescentar o `describe('app', …)`)

**Interfaces:**
- Consumes:
  - da Task 5: `useEstoque()` e `useMovimentosMes`;
  - de `@shared/estoque`: `CATEGORIAS_PRODUTO`, `rotuloCategoriaProduto`, `GRUPOS_UNIDADE`, `UNIDADES_PRODUTO`, `UNIDADES_PADRAO`, `resumoMovimentos`, `parseQuantidadeBR`, `rotuloUnidade`;
  - de `@shared/exportacao/estoque`: `definicaoEstoqueMovimentacoes(mes)`;
  - de `@shared/periodos`: `chaveMesBRT`, `somarMeses`, `rotuloMesAno`;
  - `BotaoExportar` (já usado na tela) e `usePermissoes` de `@/lib/permissions`.

Requisitos (mesmas regras e textos do web):
1. **Cabeçalho:** as 4 cartas, que são "Materiais / Insumos", "Para venda (PDV)", "Precisam de reposição" (com "estoque baixo" ou "tudo OK") e "Valor total em estoque" (com "custo de aquisição" e `formatarMoeda`). Os valores vêm de `resumo` e mostram "—" enquanto carrega ou em erro.
2. **Abas:** `SmoothTabs`, Produtos | Movimentações.
3. **Produtos:**
   - busca (nome e categoria);
   - filtro de tipo: Todos / Materiais / Venda, com contadores;
   - filtro de situação: Todos / Alertas;
   - filtro por categoria: chips só das categorias que têm produto, mais "Todas";
   - os cards atuais continuam, com o rótulo da categoria vindo de shared e "3 pct (36 un)" quando `qtd_por_unidade > 1`;
   - cada card tem a ação "Histórico", que muda para Movimentações com o filtro desse produto;
   - erro de carga mostra um banner com "Tentar de novo".
4. **Modal de movimentação:**
   - `parseQuantidadeBR`;
   - chama `movimentar(produto, tipo, qtd, motivo)`;
   - em erro, `Alert.alert('Não foi possível movimentar', e.message)` e o modal continua aberto;
   - em sucesso, mostra o saldo novo (`novoSaldo`) na confirmação;
   - trava contra toque duplo (ref).
5. **Movimentações:**
   - mês como chave (`chaveMesBRT`), com setas `somarMeses` e rótulo `rotuloMesAno`;
   - "próximo" nunca passa do mês atual;
   - os dados vêm de `useMovimentosMes(mes, aba === 'movimentacoes')`;
   - filtros: tipo (Todos / Entradas / Saídas) e produto (lista dos produtos, pelo id);
   - quando há filtro de produto, aparece um aviso "Mostrando só: <nome>" com "Limpar";
   - os 3 cartões do mês vêm de `resumoMovimentos`, calculado só pelo filtro de produto (como no web): "Saídas no mês", "Entradas no mês", "Total registros";
   - lista com data/hora em Brasília, produto, tipo (cor verde/vermelha), quantidade + unidade e motivo; "Via comanda" quando `agendamento_id`;
   - lista vazia mostra "Nenhuma movimentação neste mês"; erro mostra banner;
   - `BotaoExportar` com `definicaoEstoqueMovimentacoes(rotuloMesAno(mes))` e linhas `{ criadoEm, produto, tipo, quantidade, unidade, motivo }` dos filtrados (mesma forma do web).
6. **Unidades:**
   - botão "Unidades" (com `pode('estoque.acessar') && unidadesDisponivel`);
   - abre o `UnidadesEstoqueModal`: chips por `GRUPOS_UNIDADE`, liga/desliga, "Restaurar padrão", Salvar (`salvarUnidades`) desabilitado com 0 ligadas, erro com `Alert`.
7. **`nova-comanda.tsx` e `vendas.tsx`:** depois de gravar com sucesso (e no caso "venda/comanda registrada pela metade"), chamar também `qc.invalidateQueries({ queryKey: ['estoque'] })` e `qc.invalidateQueries({ queryKey: ['estoque-movimentos'] })`. Use o `qc` que o arquivo já tem; se não tiver, use o `useQueryClient`.
8. Nenhum `parseFloat(`, `Number(quantidade.replace` ou `parseBRLFloat` sobra em `estoque.tsx`.

- [ ] **Step 1: Write the failing test.** Acrescente ao `web/tests/unit/estoque-telas.test.ts`:

```ts
describe('app', () => {
  const tela = ler('mobile', 'app', '(empresa)', 'estoque.tsx');
  const novo = ler('mobile', 'app', '(empresa)', 'novo-produto.tsx');
  const editar = ler('mobile', 'app', '(empresa)', 'editar-produto', '[id].tsx');
  const hook = ler('mobile', 'hooks', 'useEstoque.ts');
  const modal = ler('mobile', 'components', 'UnidadesEstoqueModal.tsx');
  const comanda = ler('mobile', 'app', '(empresa)', 'nova-comanda.tsx');
  const vendas = ler('mobile', 'app', '(empresa)', 'vendas.tsx');

  it('hook pelas consultas de shared (movimentação lança erro)', () => {
    for (const f of ['carregarProdutosEstoque', 'carregarMovimentosMes', 'movimentarEstoque', 'carregarUnidadesVisiveis', 'salvarUnidadesVisiveis']) {
      expect(hook).toContain(f);
    }
    expect(hook).toContain("'estoque-movimentos'");
  });
  it('cadastro e edição pela mesma regra do web, sem as listas antigas', () => {
    for (const src of [novo, editar]) {
      expect(src).toContain('montarProduto');
      expect(src).toContain('CATEGORIAS_PRODUTO');
      expect(src).toContain('unidadesParaSeletor');
      expect(src).toContain('unidadePedeQtdPorUnidade');
      expect(src).toContain('margemVenda');
      expect(src).not.toContain('parseBRLFloat');
      expect(src).not.toMatch(/'Cabelo'|'Maquiagem'|'Massagem'/);
    }
  });
  it('tela com cartões, movimentações em Brasília, filtros pelo id e exportação', () => {
    for (const f of ['resumoMovimentos', 'useMovimentosMes', 'chaveMesBRT', 'somarMeses', 'definicaoEstoqueMovimentacoes',
      'Materiais / Insumos', 'Para venda (PDV)', 'Precisam de reposição', 'Valor total em estoque', 'UnidadesEstoqueModal']) {
      expect(tela).toContain(f);
    }
    expect(tela).toContain('produto_id === filtroProdId');
    expect(tela).not.toContain('parseFloat(');
    expect(tela).not.toContain('Number(quantidade.replace');
    expect(modal).toContain('GRUPOS_UNIDADE');
    expect(modal).toContain('UNIDADES_PADRAO');
  });
  it('comanda e vendas atualizam o estoque depois de gravar', () => {
    expect(comanda).toContain("queryKey: ['estoque']");
    expect(vendas).toContain("queryKey: ['estoque']");
  });
});
```

- [ ] **Step 2: Run to see it fail.** `cd web && npx vitest run tests/unit/estoque-telas.test.ts` deve dar FAIL no bloco app.
- [ ] **Step 3: Implement** os itens 1–8.
- [ ] **Step 4: Verify.**
  - `cd web && npx vitest run` deve passar inteiro.
  - `cd web && npx tsc --noEmit` deve dar 0 erros.
  - `cd mobile && npx tsc --noEmit` deve dar 9 erros (baseline), nenhum nos arquivos tocados.
- [ ] **Step 5: Commit.** `git commit -m "feat(estoque/app): cartoes, filtros, aba Movimentacoes, exportacao e ajuste de unidades; comanda e vendas atualizam o estoque"`
