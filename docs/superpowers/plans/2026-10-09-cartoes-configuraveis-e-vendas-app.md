# Cartões configuráveis + Comanda C (vendas no app) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maquininhas, bandeiras e taxas por parcela configuráveis (adicionar/remover/editar) usadas em toda cobrança, e tela de Vendas avulsas no app com a mesma regra de pagamento da comanda.

**Architecture:** Migration 086 cria `cartao_bandeiras`, `cartao_maquininhas`, `cartao_taxas` (+ `pagamentos.maquininha_id`) com seed das taxas da 084. Regras puras em `shared/taxas-cartao.ts` e consulta única em `shared/taxas-cartao-consultas.ts`; `montarPagamentos` passa a receber a configuração de cartões. Vendas usam `shared/venda.ts` nas duas plataformas.

**Tech Stack:** Next.js (web), Expo/React Native (mobile), Supabase (Postgres + RLS), vitest (`web/tests/unit`, imports `@shared/...`).

**Spec:** `docs/superpowers/specs/2026-10-09-cartoes-configuraveis-e-vendas-app-design.md`

## Global Constraints

- Toda comunicação, comentários e mensagens de UI em português.
- Paridade web/mobile: o que entra num lado entra no outro.
- Nada novo na área `mobile/app/(profissional)`.
- Migrations são aplicadas à mão no SQL Editor; nunca `supabase db push`. Migration idempotente, termina com `notify pgrst, 'reload schema';`.
- Código funciona antes e depois da 086 (sem a 086: `configLegada` — uma maquininha virtual com as taxas da 084 e as 5 bandeiras fixas; a tela Cartões mostra "Disponível após a atualização do sistema" e não edita).
- Taxa nunca inventada: combinação sem taxa cadastrada → aviso "Taxa não cadastrada para esta combinação" e pagamento gravado com `taxa_perc` e `valor_liquido` null.
- Máximo de parcelas por maquininha entre 1 e 18; taxa entre 0 e 20%.
- Edição de cartões exige a permissão `config.taxas`; leitura para todos os membros.
- Valores digitados com `parseValorBR`; dinheiro com `formatarMoeda`; erros de banco com `mensagemErroBanco(erro, acao)`.
- Todo UPDATE/DELETE que precisa ter efeito usa `.select('id')` e confere a contagem.
- Verificação de cada task: `cd web && npx tsc --noEmit` zerado; `cd web && npx vitest run` verde; tasks que tocam `mobile/`: `cd mobile && npx tsc --noEmit` com exatamente os 6 erros pré-existentes (configuracoes.tsx ×2, estoque.tsx, useAgenda.ts, useNotificacoes.ts ×2), nenhum novo.
- Commits com `git commit -F -` (heredoc no Bash) terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/086_cartoes_maquininhas_bandeiras.sql` (novo) | 3 tabelas, RLS, seed, trigger de empresa nova, `pagamentos.maquininha_id` |
| `shared/taxas-cartao.ts` | tipos de configuração, `taxaDoCartao`, `validarTabela`, `chaveBandeira`, `configLegada`, helpers de % |
| `shared/taxas-cartao-consultas.ts` (novo) | `carregarConfigCartoes`, gravação de maquininha/bandeira |
| `shared/comanda-fechamento.ts` | `montarPagamentos`/`taxaDoSplit` com configuração e maquininha; `vendaId` |
| `shared/venda.ts` (novo) | carrinho de venda, limites de estoque, gravação única da venda |
| `web/app/(app)/configuracoes/page.tsx` (+ componente novo `web/components/configuracoes/CartoesConfig.tsx`) | área Cartões no web |
| `mobile/app/(empresa)/configuracoes.tsx` (+ `mobile/components/configuracoes/CartoesConfig.tsx`) | área Cartões no app |
| `web/app/(app)/comanda/page.tsx`, `mobile/app/(empresa)/nova-comanda.tsx` | cobrança com maquininha |
| `web/app/(app)/vendas/page.tsx` | PDV pela regra única |
| `mobile/app/(empresa)/vendas.tsx` (novo), `mobile/app/(empresa)/mais.tsx`, `mobile/app/(empresa)/_layout.tsx` | Vendas no app |

---

### Task 1: Migration 086

**Files:**
- Create: `supabase/migrations/086_cartoes_maquininhas_bandeiras.sql`
- Test: `web/tests/unit/cartoes-migration.test.ts`

**Interfaces:**
- Produces: tabelas `cartao_bandeiras(id, empresa_id, chave, nome, ativa, ordem, created_at)`, `cartao_maquininhas(id, empresa_id, nome, max_parcelas, ativa, padrao, ordem, created_at)`, `cartao_taxas(id, empresa_id, maquininha_id, bandeira_id null, modalidade, parcelas, taxa)`; `pagamentos.maquininha_id`; função `semear_cartoes_empresa(p_empresa_id uuid)`.

- [ ] **Step 1: Teste (texto)**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '086_cartoes_maquininhas_bandeiras.sql'), 'utf8').toLowerCase();

describe('Migration 086: cartões', () => {
  it('três tabelas com checks', () => {
    expect(sql).toMatch(/create table if not exists public\.cartao_bandeiras/);
    expect(sql).toMatch(/create table if not exists public\.cartao_maquininhas/);
    expect(sql).toMatch(/create table if not exists public\.cartao_taxas/);
    expect(sql).toMatch(/max_parcelas int not null default 12 check \(max_parcelas between 1 and 18\)/);
    expect(sql).toMatch(/taxa numeric\(6,4\) not null check \(taxa between 0 and 0\.2\)/);
    expect(sql).toMatch(/check \(modalidade in \('debito', ?'credito'\)\)/);
    expect(sql).toMatch(/check \(modalidade = 'credito' or parcelas = 1\)/);
  });
  it('unicidades', () => {
    expect(sql).toMatch(/unique \(empresa_id, chave\)/);
    expect(sql).toMatch(/create unique index if not exists uq_cartao_maquininha_padrao\s+on public\.cartao_maquininhas \(empresa_id\) where padrao and ativa/);
    expect(sql).toMatch(/create unique index if not exists uq_cartao_taxas_linha/);
  });
  it('rls: leitura de membro, escrita com config.taxas', () => {
    for (const t of ['cartao_bandeiras', 'cartao_maquininhas', 'cartao_taxas']) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
    expect(sql.match(/tem_permissao\(empresa_id, 'config\.taxas'\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/empresa_id in \(select minha_empresas\(\)\)/);
  });
  it('seed das empresas existentes e de empresa nova; maquininha no pagamento', () => {
    expect(sql).toContain('create or replace function public.semear_cartoes_empresa(p_empresa_id uuid)');
    expect(sql).toMatch(/after insert on public\.empresas/);
    expect(sql).toMatch(/add column if not exists maquininha_id uuid references public\.cartao_maquininhas\(id\) on delete set null/);
    expect(sql).toContain('taxa_cartao_credito_parcelado');
  });
  it('idempotente e recarrega o schema', () => {
    expect(sql).toMatch(/drop trigger if exists trg_semear_cartoes_empresa/);
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
```

Run: `cd web && npx vitest run tests/unit/cartoes-migration.test.ts` → FAIL (ENOENT).

- [ ] **Step 2: Migration**

```sql
-- ============================================================
-- 086 — Cartões: maquininhas, bandeiras e taxas por parcela
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-09-cartoes-configuraveis-e-vendas-app-design.md
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
--
-- Cada empresa cadastra maquininhas (com máximo de parcelas) e bandeiras. Cada maquininha tem uma
-- tabela padrão (bandeira_id null: débito + crédito 1x..máx) e exceções por bandeira. O seed abaixo
-- cria, para cada empresa, as 5 bandeiras de antes e uma maquininha "Maquininha" com as taxas da 084
-- (débito; crédito 1x = à vista; 2x a 12x = parcelado) — nada muda nos números no dia em que roda.
-- Empresa nova ganha o mesmo seed por trigger. As colunas taxa_cartao_* da 084 deixam de ser editadas.
-- Pagamentos antigos mantêm taxa_perc; maquininha_id fica null neles.
--
-- Rollback:
--   drop trigger if exists trg_semear_cartoes_empresa on public.empresas;
--   drop function if exists public.trg_fn_semear_cartoes_empresa(), public.semear_cartoes_empresa(uuid);
--   alter table public.pagamentos drop column if exists maquininha_id;
--   drop table if exists public.cartao_taxas, public.cartao_maquininhas, public.cartao_bandeiras;

create table if not exists public.cartao_bandeiras (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave      text not null,
  nome       text not null,
  ativa      boolean not null default true,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  unique (empresa_id, chave)
);

create table if not exists public.cartao_maquininhas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  nome         text not null,
  max_parcelas int not null default 12 check (max_parcelas between 1 and 18),
  ativa        boolean not null default true,
  padrao       boolean not null default false,
  ordem        int not null default 0,
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_cartao_maquininha_padrao
  on public.cartao_maquininhas (empresa_id) where padrao and ativa;

create table if not exists public.cartao_taxas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  maquininha_id uuid not null references public.cartao_maquininhas(id) on delete cascade,
  bandeira_id   uuid references public.cartao_bandeiras(id) on delete cascade,
  modalidade    text not null check (modalidade in ('debito', 'credito')),
  parcelas      int not null check (parcelas between 1 and 18),
  taxa          numeric(6,4) not null check (taxa between 0 and 0.2),
  check (modalidade = 'credito' or parcelas = 1)
);
create unique index if not exists uq_cartao_taxas_linha
  on public.cartao_taxas (maquininha_id, coalesce(bandeira_id, '00000000-0000-0000-0000-000000000000'::uuid), modalidade, parcelas);

alter table public.pagamentos
  add column if not exists maquininha_id uuid references public.cartao_maquininhas(id) on delete set null;

-- RLS: leitura para membros, escrita com a permissão config.taxas (083).
alter table public.cartao_bandeiras enable row level security;
alter table public.cartao_maquininhas enable row level security;
alter table public.cartao_taxas enable row level security;

drop policy if exists "cartao_bandeiras: membro ve" on public.cartao_bandeiras;
create policy "cartao_bandeiras: membro ve" on public.cartao_bandeiras for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "cartao_bandeiras: config.taxas edita" on public.cartao_bandeiras;
create policy "cartao_bandeiras: config.taxas edita" on public.cartao_bandeiras for all
  using (tem_permissao(empresa_id, 'config.taxas'))
  with check (tem_permissao(empresa_id, 'config.taxas'));

drop policy if exists "cartao_maquininhas: membro ve" on public.cartao_maquininhas;
create policy "cartao_maquininhas: membro ve" on public.cartao_maquininhas for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "cartao_maquininhas: config.taxas edita" on public.cartao_maquininhas;
create policy "cartao_maquininhas: config.taxas edita" on public.cartao_maquininhas for all
  using (tem_permissao(empresa_id, 'config.taxas'))
  with check (tem_permissao(empresa_id, 'config.taxas'));

drop policy if exists "cartao_taxas: membro ve" on public.cartao_taxas;
create policy "cartao_taxas: membro ve" on public.cartao_taxas for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "cartao_taxas: config.taxas edita" on public.cartao_taxas;
create policy "cartao_taxas: config.taxas edita" on public.cartao_taxas for all
  using (tem_permissao(empresa_id, 'config.taxas'))
  with check (tem_permissao(empresa_id, 'config.taxas'));

-- Seed de uma empresa (só se ela ainda não tem maquininha).
create or replace function public.semear_cartoes_empresa(p_empresa_id uuid)
returns void as $$
declare
  v_debito    numeric(6,4);
  v_avista    numeric(6,4);
  v_parcelado numeric(6,4);
  v_maq       uuid;
  n           int;
begin
  if exists (select 1 from public.cartao_maquininhas where empresa_id = p_empresa_id) then
    return;
  end if;

  insert into public.cartao_bandeiras (empresa_id, chave, nome, ordem) values
    (p_empresa_id, 'visa', 'Visa', 1),
    (p_empresa_id, 'mastercard', 'Master', 2),
    (p_empresa_id, 'elo', 'Elo', 3),
    (p_empresa_id, 'amex', 'Amex', 4),
    (p_empresa_id, 'hipercard', 'Hipercard', 5)
  on conflict (empresa_id, chave) do nothing;

  select coalesce(taxa_cartao_debito, 0.0239), coalesce(taxa_cartao_credito_avista, 0.0499),
         coalesce(taxa_cartao_credito_parcelado, 0.0559)
    into v_debito, v_avista, v_parcelado
    from public.empresas where id = p_empresa_id;

  insert into public.cartao_maquininhas (empresa_id, nome, max_parcelas, padrao, ordem)
  values (p_empresa_id, 'Maquininha', 12, true, 1)
  returning id into v_maq;

  insert into public.cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa)
  values (p_empresa_id, v_maq, null, 'debito', 1, coalesce(v_debito, 0.0239)),
         (p_empresa_id, v_maq, null, 'credito', 1, coalesce(v_avista, 0.0499));
  for n in 2..12 loop
    insert into public.cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa)
    values (p_empresa_id, v_maq, null, 'credito', n, coalesce(v_parcelado, 0.0559));
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.trg_fn_semear_cartoes_empresa()
returns trigger as $$
begin
  perform public.semear_cartoes_empresa(new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_semear_cartoes_empresa on public.empresas;
create trigger trg_semear_cartoes_empresa
  after insert on public.empresas
  for each row execute function public.trg_fn_semear_cartoes_empresa();

-- Empresas existentes.
select public.semear_cartoes_empresa(id) from public.empresas;

notify pgrst, 'reload schema';
```

Antes de escrever, confira em `supabase/migrations/084_taxas_cartao_empresa.sql` que as colunas da 084 têm esses nomes, e em `083_permissoes_configuraveis.sql` a assinatura de `tem_permissao(uuid, text)` e de `minha_empresas()`. Se a 084 não estiver garantida no banco ao rodar a 086, o `select ... taxa_cartao_*` falharia: a 084 já foi aplicada em produção (2026-10-08), então mantenha a leitura direta.

- [ ] **Step 3:** `cd web && npx vitest run tests/unit/cartoes-migration.test.ts` → PASS; `npx vitest run`; `npx tsc --noEmit`.
- [ ] **Step 4: Commit** `feat(banco): maquininhas, bandeiras e taxas por parcela (migration 086)`.

---

### Task 2: Regras e consulta de cartões em `shared/`

**Files:**
- Modify: `shared/taxas-cartao.ts`
- Create: `shared/taxas-cartao-consultas.ts`
- Test: `web/tests/unit/taxas-cartao-config.test.ts` (novo nome se o arquivo já existir com outro conteúdo: `cartoes-config.test.ts`)

**Interfaces:**
- Produces (em `shared/taxas-cartao.ts`, mantendo `fmtTaxa`, `valorLiquido`, `taxaParaCampo`, `mascararPercentual`, `campoParaTaxa`, `TaxasCartao`, `TAXAS_PADRAO`, `taxasDaEmpresa`):

```ts
export type Modalidade = 'debito' | 'credito';
export type BandeiraCartao = { id: string; chave: string; nome: string; ativa: boolean; ordem: number };
export type TaxaLinha = { id?: string; bandeiraId: string | null; modalidade: Modalidade; parcelas: number; taxa: number };
export type Maquininha = { id: string; nome: string; maxParcelas: number; ativa: boolean; padrao: boolean; ordem: number; taxas: TaxaLinha[] };
export type ConfigCartoes = { maquininhas: Maquininha[]; bandeiras: BandeiraCartao[]; legado: boolean };
export const MAX_PARCELAS = 18;
export const BANDEIRAS_INICIAIS: { chave: string; nome: string }[];   // visa Visa, mastercard Master, elo Elo, amex Amex, hipercard Hipercard
export function configLegada(empresa: Record<string, unknown> | null | undefined): ConfigCartoes;
export function maquininhasAtivas(c: ConfigCartoes): Maquininha[];        // por ordem, nome
export function maquininhaPadrao(c: ConfigCartoes): Maquininha | null;   // padrão ativa, senão 1ª ativa
export function bandeirasAtivas(c: ConfigCartoes): BandeiraCartao[];
export function nomeBandeira(c: ConfigCartoes, chave: string | null | undefined): string; // nome cadastrado; chave desconhecida → a própria chave; null → ''
export function parcelasDisponiveis(m: Maquininha): number[];           // 1..maxParcelas
export function taxaDoCartao(c: ConfigCartoes, s: { maquininhaId: string | null | undefined; bandeiraChave: string | null | undefined; metodo: string; parcelas?: number }): number | null;
export function validarTabela(m: Pick<Maquininha, 'maxParcelas' | 'taxas'>): string | null; // null = ok; senão mensagem
export function chaveBandeira(nome: string, existentes: string[]): string;
```

- Produces (em `shared/taxas-cartao-consultas.ts`):

```ts
export async function carregarConfigCartoes(db: ClienteDb, empresaId: string): Promise<ConfigCartoes>;
export async function salvarMaquininha(db: ClienteDb, empresaId: string, m: Omit<Maquininha, 'id'> & { id?: string }, originais: TaxaLinha[]): Promise<{ id: string } >; // lança Error(mensagem em pt)
export async function definirPadrao(db: ClienteDb, empresaId: string, maquininhaId: string): Promise<void>;
export async function salvarBandeira(db: ClienteDb, empresaId: string, b: { id?: string; nome: string; ativa: boolean; ordem?: number }, chavesExistentes: string[]): Promise<void>;
```

- [ ] **Step 1: Testes**

```ts
import { describe, expect, it } from 'vitest';
import {
  configLegada, taxaDoCartao, validarTabela, chaveBandeira, maquininhaPadrao, parcelasDisponiveis, nomeBandeira,
  type ConfigCartoes,
} from '@shared/taxas-cartao';
import { carregarConfigCartoes } from '@shared/taxas-cartao-consultas';
import { fakeDb } from './fixtures/fake-db';

const tabela = (taxaDeb: number, avista: number, parc: number, max = 3) => [
  { bandeiraId: null, modalidade: 'debito' as const, parcelas: 1, taxa: taxaDeb },
  ...Array.from({ length: max }, (_, i) => ({ bandeiraId: null, modalidade: 'credito' as const, parcelas: i + 1, taxa: i === 0 ? avista : parc })),
];
const cfg: ConfigCartoes = {
  legado: false,
  bandeiras: [
    { id: 'b-visa', chave: 'visa', nome: 'Visa', ativa: true, ordem: 1 },
    { id: 'b-amex', chave: 'amex', nome: 'Amex', ativa: true, ordem: 2 },
  ],
  maquininhas: [{
    id: 'm1', nome: 'Stone', maxParcelas: 3, ativa: true, padrao: true, ordem: 1,
    taxas: [...tabela(0.02, 0.04, 0.05), { bandeiraId: 'b-amex', modalidade: 'credito', parcelas: 2, taxa: 0.07 }],
  }],
};

describe('taxaDoCartao', () => {
  it('padrão, exceção da bandeira e pix', () => {
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'visa', metodo: 'credito', parcelas: 2 })).toBe(0.05);
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'amex', metodo: 'credito', parcelas: 2 })).toBe(0.07);
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'amex', metodo: 'credito', parcelas: 3 })).toBe(0.05);
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: null, metodo: 'debito' })).toBe(0.02);
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'visa', metodo: 'pix' })).toBe(0);
  });
  it('sem linha → null; maquininha ausente usa a padrão', () => {
    expect(taxaDoCartao(cfg, { maquininhaId: 'm1', bandeiraChave: 'visa', metodo: 'credito', parcelas: 6 })).toBeNull();
    expect(taxaDoCartao(cfg, { maquininhaId: null, bandeiraChave: 'visa', metodo: 'credito', parcelas: 1 })).toBe(0.04);
    expect(taxaDoCartao(cfg, { maquininhaId: 'x', bandeiraChave: 'visa', metodo: 'debito' })).toBe(0.02);
  });
});

describe('validarTabela', () => {
  it('padrão completa ok; faltando parcela ou fora da faixa → mensagem', () => {
    expect(validarTabela({ maxParcelas: 3, taxas: tabela(0.02, 0.04, 0.05) })).toBeNull();
    expect(validarTabela({ maxParcelas: 4, taxas: tabela(0.02, 0.04, 0.05) })).toBe('Preencha a taxa do crédito em 4x');
    expect(validarTabela({ maxParcelas: 3, taxas: tabela(0.02, 0.04, 0.05).filter(t => t.modalidade !== 'debito') })).toBe('Preencha a taxa do débito');
    expect(validarTabela({ maxParcelas: 3, taxas: tabela(0.25, 0.04, 0.05) })).toBe('As taxas precisam ficar entre 0% e 20%');
    expect(validarTabela({ maxParcelas: 19, taxas: [] })).toBe('O máximo de parcelas precisa ficar entre 1 e 18');
  });
});

describe('chaveBandeira e auxiliares', () => {
  it('slug sem acento e sufixo se repetir', () => {
    expect(chaveBandeira('Diners Club', [])).toBe('diners-club');
    expect(chaveBandeira('Cabal', ['cabal'])).toBe('cabal-2');
    expect(chaveBandeira('Elô', ['elo', 'elo-2'])).toBe('elo-3');
  });
  it('padrão, parcelas e nome', () => {
    expect(maquininhaPadrao(cfg)?.id).toBe('m1');
    expect(parcelasDisponiveis(cfg.maquininhas[0])).toEqual([1, 2, 3]);
    expect(nomeBandeira(cfg, 'amex')).toBe('Amex');
    expect(nomeBandeira(cfg, 'cabal')).toBe('cabal');
  });
  it('configLegada monta uma maquininha virtual com as taxas da 084', () => {
    const c = configLegada({ taxa_cartao_debito: 0.03, taxa_cartao_credito_avista: 0.04, taxa_cartao_credito_parcelado: 0.06 });
    expect(c.legado).toBe(true);
    expect(c.maquininhas).toHaveLength(1);
    expect(c.maquininhas[0]).toMatchObject({ id: 'legado', maxParcelas: 12, padrao: true });
    expect(taxaDoCartao(c, { maquininhaId: 'legado', bandeiraChave: 'visa', metodo: 'credito', parcelas: 12 })).toBe(0.06);
    expect(c.bandeiras.map(b => b.chave)).toEqual(['visa', 'mastercard', 'elo', 'amex', 'hipercard']);
  });
});

describe('carregarConfigCartoes', () => {
  it('tabela ausente → configuração legada da empresa', async () => {
    const { db } = fakeDb({ erroTabelas: { cartao_maquininhas: 'relation "public.cartao_maquininhas" does not exist' },
      linhas: { empresas: [{ id: 'emp', taxa_cartao_debito: 0.03 }] } });
    const c = await carregarConfigCartoes(db, 'emp');
    expect(c.legado).toBe(true);
  });
});
```

Antes, leia `web/tests/unit/fixtures/fake-db.ts` e adapte o último teste à API real do fixture (estenda-o de forma retrocompatível se precisar simular erro por tabela, ex.: opção `erroTabelas`).

Run → FAIL.

- [ ] **Step 2: Implementar**

`taxaDoCartao`:

```ts
export function taxaDoCartao(c: ConfigCartoes, s: { maquininhaId: string | null | undefined; bandeiraChave: string | null | undefined; metodo: string; parcelas?: number }): number | null {
  if (s.metodo !== 'debito' && s.metodo !== 'credito') return 0;
  const maq = c.maquininhas.find(m => m.id === s.maquininhaId) ?? maquininhaPadrao(c);
  if (!maq) return null;
  const parcelas = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
  const bandeiraId = s.bandeiraChave ? c.bandeiras.find(b => b.chave === s.bandeiraChave)?.id ?? null : null;
  const achar = (bid: string | null) => maq.taxas.find(t => t.bandeiraId === bid && t.modalidade === s.metodo && t.parcelas === parcelas);
  const linha = (bandeiraId ? achar(bandeiraId) : undefined) ?? achar(null);
  return linha ? linha.taxa : null;
}
```

`validarTabela`: confere `maxParcelas` 1..18 (`'O máximo de parcelas precisa ficar entre 1 e 18'`); todas as taxas 0..0.2 (`'As taxas precisam ficar entre 0% e 20%'`); padrão (bandeiraId null) com débito (`'Preencha a taxa do débito'`) e crédito 1..max (`'Preencha a taxa do crédito em Nx'`, a primeira que faltar). Exceções podem ser parciais. Linhas com parcelas acima do máximo são ignoradas pela validação (serão apagadas ao salvar).

`chaveBandeira`: `nome.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')`; se vazio → `'bandeira'`; se existir, sufixo `-2`, `-3`… até não existir.

`configLegada(empresa)`: usa `taxasDaEmpresa(empresa)`; maquininha `{ id: 'legado', nome: 'Maquininha', maxParcelas: 12, ativa: true, padrao: true, ordem: 1 }` com débito, crédito 1x = `creditoAvista`, 2..12 = `creditoParcelado`; bandeiras = `BANDEIRAS_INICIAIS` com `id = 'legado-' + chave`.

`carregarConfigCartoes`: em paralelo `cartao_maquininhas` (todas, `order('ordem').order('nome')`), `cartao_bandeiras` (todas, mesma ordem) e `cartao_taxas` da empresa; erro cuja mensagem contém `cartao_` e (`does not exist` ou `schema cache`) → lê `empresas` (`select('*').eq('id', empresaId).single()`) e devolve `configLegada`; outro erro → lança. Numéricos vêm como string: converta com `Number`.

`salvarMaquininha`: insere/atualiza a maquininha (`.select('id')` + contagem), depois as taxas por diferença contra `originais` (chave = bandeiraId|modalidade|parcelas): apaga linhas que sumiram ou com parcelas > max, atualiza as que mudaram, insere as novas — sempre com `empresa_id` e `maquininha_id`. Lança `Error` com `mensagemErroBanco(erro, 'salvar a maquininha')`.
`definirPadrao`: tira `padrao` das outras da empresa e marca esta (duas chamadas com conferência; a ordem evita violar o índice único: primeiro desmarca, depois marca).
`salvarBandeira`: nova → `chaveBandeira(nome, chavesExistentes)`; existente → só `nome`/`ativa`/`ordem` (a chave nunca muda, pagamentos antigos usam ela).

- [ ] **Step 3:** testes do arquivo PASS; `npx vitest run`; `npx tsc --noEmit`; mobile tsc (6).
- [ ] **Step 4: Commit** `feat(shared): configuracao de cartoes (maquininhas, bandeiras, taxas por parcela)`.

---

### Task 3: Pagamentos com maquininha + cobrança na comanda do web e no PDV do web (leitura da configuração)

**Files:**
- Modify: `shared/comanda-fechamento.ts`, `web/app/(app)/comanda/page.tsx`, `web/app/(app)/vendas/page.tsx` (só a troca de `taxas` pela configuração — a regra única do PDV é a Task 6), `mobile/app/(empresa)/nova-comanda.tsx` (só a troca de `taxas` pela configuração, sem UI nova — a UI é a Task 4)
- Test: `web/tests/unit/comanda-fechamento.test.ts` (atualizar), `web/tests/unit/cartoes-paridade.test.ts` (novo, varredura)

**Interfaces:**
- Consumes: `ConfigCartoes`, `taxaDoCartao`, `maquininhaPadrao`, `carregarConfigCartoes` (Task 2).
- Produces:
  - `SplitPagamento` ganha `maquininhaId?: string | null; maquininhaGravada?: string | null; bandeiraGravada?: string | null`.
  - `taxaDoSplit(s, config): number | null` (null = taxa não cadastrada).
  - `montarPagamentos(splits, ctx: { empresaId: string; comandaId?: string; vendaId?: string; config: ConfigCartoes; total: number }): LinhaPagamento[]`; `LinhaPagamento` ganha `maquininha_id: string | null`, `comanda_id?: string`, `venda_id?: string`.

- [ ] **Step 1: Testes** — em `comanda-fechamento.test.ts`, troque `taxas: TAXAS_PADRAO` por uma `ConfigCartoes` de teste (use `configLegada({})` para os casos antigos, que mantêm os mesmos números: débito 0.0239, crédito 1x 0.0499, 2x+ 0.0559) e acrescente:

```ts
describe('montarPagamentos — maquininha', () => {
  const cfg: ConfigCartoes = {
    legado: false,
    bandeiras: [{ id: 'b1', chave: 'visa', nome: 'Visa', ativa: true, ordem: 1 }],
    maquininhas: [
      { id: 'm1', nome: 'A', maxParcelas: 2, ativa: true, padrao: true, ordem: 1, taxas: [
        { bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: 0.02 },
        { bandeiraId: null, modalidade: 'credito', parcelas: 1, taxa: 0.04 },
        { bandeiraId: null, modalidade: 'credito', parcelas: 2, taxa: 0.05 } ] },
      { id: 'm2', nome: 'B', maxParcelas: 1, ativa: true, padrao: false, ordem: 2, taxas: [
        { bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: 0.01 },
        { bandeiraId: null, modalidade: 'credito', parcelas: 1, taxa: 0.03 } ] },
    ],
  };
  const ctx = { empresaId: 'e', comandaId: 'c', config: cfg, total: 100 };
  it('grava a maquininha e a taxa dela; sem maquininha usa a padrão', () => {
    expect(montarPagamentos([{ metodo: 'credito', valor: 100, bandeira: 'visa', parcelas: 1, maquininhaId: 'm2' }], ctx)[0])
      .toMatchObject({ maquininha_id: 'm2', taxa_perc: 0.03, valor_liquido: 97 });
    expect(montarPagamentos([{ metodo: 'debito', valor: 100, bandeira: 'visa' }], ctx)[0])
      .toMatchObject({ maquininha_id: 'm1', taxa_perc: 0.02 });
  });
  it('pix sem maquininha; taxa não cadastrada grava sem taxa', () => {
    expect(montarPagamentos([{ metodo: 'pix', valor: 100, maquininhaId: 'm2' }], ctx)[0]).toMatchObject({ maquininha_id: null, taxa_perc: null });
    expect(montarPagamentos([{ metodo: 'credito', valor: 100, parcelas: 5, maquininhaId: 'm1' }], ctx)[0])
      .toMatchObject({ maquininha_id: 'm1', taxa_perc: null, valor_liquido: null });
  });
  it('reaberto mantém a taxa só se maquininha e bandeira também não mudaram', () => {
    const base = { metodo: 'credito', valor: 100, parcelas: 1, bandeira: 'visa', taxaGravada: 0.09, metodoGravado: 'credito', parcelasGravadas: 1, maquininhaGravada: 'm1', bandeiraGravada: 'visa' };
    expect(montarPagamentos([{ ...base, maquininhaId: 'm1' }], ctx)[0].taxa_perc).toBe(0.09);
    expect(montarPagamentos([{ ...base, maquininhaId: 'm2' }], ctx)[0].taxa_perc).toBe(0.03);
    expect(montarPagamentos([{ ...base, maquininhaId: 'm1', bandeira: 'amex' }], ctx)[0].taxa_perc).toBe(0.04);
  });
  it('venda grava venda_id e não comanda_id; legado grava maquininha null', () => {
    const l = montarPagamentos([{ metodo: 'pix', valor: 10 }], { empresaId: 'e', vendaId: 'v', config: cfg, total: 10 })[0];
    expect(l).toMatchObject({ venda_id: 'v' });
    expect(l).not.toHaveProperty('comanda_id');
    expect(montarPagamentos([{ metodo: 'debito', valor: 10 }], { empresaId: 'e', comandaId: 'c', config: configLegada({}), total: 10 })[0].maquininha_id).toBeNull();
  });
});
```

Regra de compatibilidade de split reaberto antigo: pagamento gravado antes da 086 tem `maquininha_id` null → `maquininhaGravada` null; trate `maquininhaId` null/undefined e `maquininhaGravada` null como "mesma maquininha" (o reaberto antigo continua com a taxa da época enquanto ninguém troca a maquininha).

`cartoes-paridade.test.ts` (varredura): os 3 arquivos de tela importam `carregarConfigCartoes`; nenhum arquivo em `web/app`, `mobile/app`, `shared/comanda-fechamento.ts` usa `calcTaxa(` nem `OPCOES_PARCELAS`.

- [ ] **Step 2: Implementar `shared/comanda-fechamento.ts`**: `taxaDoSplit` usa `taxaDoCartao(config, { maquininhaId: s.maquininhaId, bandeiraChave: s.bandeira, metodo, parcelas })` salvo quando reaberto inalterado (método, parcelas, maquininha e bandeira iguais aos gravados); `montarPagamentos` grava `maquininha_id` = `null` se não cartão ou `config.legado`, senão `s.maquininhaId ?? maquininhaPadrao(config)?.id ?? null`; `taxa_perc`/`valor_liquido` null quando a taxa é null ou 0; inclui só `comanda_id` ou só `venda_id` conforme o ctx. Remova `calcTaxa` e `OPCOES_PARCELAS` de `shared/taxas-cartao.ts` (e o import em `comanda-fechamento.ts`).
- [ ] **Step 3: Web comanda** (`web/app/(app)/comanda/page.tsx`): estado `config: ConfigCartoes` carregado por `carregarConfigCartoes` (no lugar de `taxasDaEmpresa`; erro → `setErro(mensagemErroBanco(...,'carregar as taxas dos cartões'))` e `configLegada` com a empresa); `Split` ganha `maquininhaId`; ao adicionar split de cartão inicia com `maquininhaPadrao(config)?.id`; no bloco do cartão: seletor de maquininha (só com 2+ ativas), bandeiras de `bandeirasAtivas(config)` (troca `BANDEIRAS_CARTAO`), parcelas de `parcelasDisponiveis(maquininha)` (se a maquininha trocada tiver menos parcelas, ajusta para o máximo), taxa/líquido de `taxaDoSplit` (null → aviso "Taxa não cadastrada para esta combinação"). Reabrir comanda: `pagamentos` passa a ler `maquininha_id` → `maquininhaId` e `maquininhaGravada`, e `bandeiraGravada = bandeira`. Recibo/tela de sucesso: bandeira por `nomeBandeira(config, chave)`.
- [ ] **Step 4: Web vendas e app comanda (compilação)**: troque a leitura de taxas por `carregarConfigCartoes` e passe `config` onde antes passava `taxas`, sem mudar a UI (o seletor de maquininha do app é a Task 4; o PDV é a Task 6). O app grava com a maquininha padrão até a Task 4.
- [ ] **Step 5:** `cd web && npx vitest run && npx tsc --noEmit`; `cd mobile && npx tsc --noEmit` (6). Commit `feat(cartoes): pagamento grava maquininha e taxa da tabela configurada (web)`.

---

### Task 4: App — cobrança com maquininha na comanda

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`
- Test: `web/tests/unit/cartoes-paridade.test.ts` (acrescentar)

**Interfaces:** consome `ConfigCartoes`, `maquininhasAtivas`, `maquininhaPadrao`, `bandeirasAtivas`, `parcelasDisponiveis`, `nomeBandeira`, `taxaDoSplit`.

- [ ] **Step 1: Varredura** — o app usa `maquininhasAtivas(`, `parcelasDisponiveis(`, `bandeirasAtivas(` e lê `maquininha_id` ao reabrir comanda; não usa `BANDEIRAS_CARTAO`. Run → FAIL.
- [ ] **Step 2: Implementar** espelhando o web da Task 3 (Step 3): seletor de maquininha em chips (só com 2+ ativas), bandeiras e parcelas da configuração, aviso de taxa não cadastrada, reabertura com `maquininhaGravada`/`bandeiraGravada`, nomes de bandeira no recibo e na tela de sucesso. A configuração é carregada dentro de `carregarDia` respeitando `reqDiaRef` (nenhum setState de resposta antiga).
- [ ] **Step 3:** testes, tsc web, tsc mobile (6). Commit `feat(cartoes/app): cobranca da comanda com maquininha, bandeira e parcelas configuradas`.

---

### Task 5: Configurações → Cartões (web)

**Files:**
- Create: `web/components/configuracoes/CartoesConfig.tsx`
- Modify: `web/app/(app)/configuracoes/page.tsx` (remove o bloco "Taxas da maquininha" e o envio das colunas `taxa_cartao_*` no salvar; renderiza `CartoesConfig`)
- Test: `web/tests/unit/cartoes-paridade.test.ts` (acrescentar)

**Interfaces:** consome `carregarConfigCartoes`, `salvarMaquininha`, `definirPadrao`, `salvarBandeira`, `validarTabela`, `taxaParaCampo`, `mascararPercentual`, `campoParaTaxa`, `MAX_PARCELAS`; permissão via `usePermissoes().pode('config.taxas')`.

- [ ] **Step 1: Varredura** — `configuracoes/page.tsx` renderiza `<CartoesConfig` e não envia `taxa_cartao_debito`; `CartoesConfig.tsx` usa `validarTabela(`, `salvarMaquininha(`, `salvarBandeira(`, `definirPadrao(`. Run → FAIL.
- [ ] **Step 2: Implementar** (padrões visuais do próprio `configuracoes/page.tsx`: cartões `rounded-2xl border`, `inputCls`/`labelCls`, Skeleton no carregamento):
  1. Carrega `carregarConfigCartoes`. `config.legado` → aviso "Disponível após a atualização do sistema" e tudo só leitura. Sem `pode('config.taxas')` → só leitura, sem botões.
  2. **Maquininhas**: lista (nome, selo "Padrão", "até Nx", inativas em seção recolhida "Removidas" com "Restaurar"). Ações: Editar, Tornar padrão (`definirPadrao`), Remover (= `ativa: false`; bloqueado para a padrão — "Escolha outra maquininha padrão antes de remover esta" — e para a última ativa). "Adicionar maquininha": abre o editor com nome vazio, máx. = o da padrão e a tabela padrão copiada da padrão (sem exceções).
  3. **Editor de maquininha** (modal): nome (obrigatório), máx. de parcelas (1..18), **Tabela padrão** em grade (Débito; Crédito 1x..Nx) com campos `%` (`mascararPercentual`/`campoParaTaxa`), **Exceções por bandeira**: lista de bandeiras com exceção; "Adicionar exceção" escolhe uma bandeira ativa sem exceção e cria a tabela pré-preenchida com a padrão; cada exceção pode ser removida. Ao salvar, linhas de exceção iguais à padrão são descartadas (não gravar redundância). `validarTabela` → mensagem inline; sucesso → `salvarMaquininha` com as linhas originais e recarrega.
  4. **Bandeiras**: lista com nome editável (salva no blur/Enter), Ativa/Desativar, "Adicionar bandeira" (nome obrigatório, sem repetir nome ativo ignorando maiúsculas/acentos).
  5. Erros via `mensagemErroBanco` em toast/inline; botões desabilitados durante gravação.
- [ ] **Step 3:** testes, tsc web. Commit `feat(cartoes/web): configuracoes de maquininhas, bandeiras e taxas`.

---

### Task 6: Regra única de venda + PDV do web

**Files:**
- Create: `shared/venda.ts`
- Modify: `web/app/(app)/vendas/page.tsx`
- Test: `web/tests/unit/venda.test.ts` (novo), `web/tests/unit/cartoes-paridade.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `calcularDesconto`, `resumoComanda`, `montarPagamentos`, `ConfigCartoes` (Task 3).
- Produces:

```ts
export type ProdutoVenda = { id: string; nome: string; preco_venda: number; estoque_atual: number; unidade: string };
export type ItemVenda = { produtoId: string; nome: string; precoUnitario: number; quantidade: number; estoqueAtual: number; unidade: string };
export function adicionarAoCarrinho(itens: ItemVenda[], p: ProdutoVenda): ItemVenda[];      // sem estoque → mesmo array; já no carrinho → +1 até o estoque
export function alterarQuantidade(itens: ItemVenda[], produtoId: string, quantidade: number): ItemVenda[]; // <1 remove; > estoque → limita ao estoque
export function subtotalVenda(itens: ItemVenda[]): number;
export type DadosVenda = { empresaId: string; clienteId: string | null; itens: ItemVenda[]; desconto: number; splits: SplitPagamento[]; config: ConfigCartoes; total: number };
export type ResultadoVenda = { vendaId: string; avisoEstoque: string | null };
export async function gravarVenda(db: ClienteDb, d: DadosVenda): Promise<ResultadoVenda>; // lança Error('<etapa>: <mensagem>')
```

- [ ] **Step 1: Testes** (`venda.test.ts`): carrinho (adiciona, soma, respeita estoque, produto sem estoque não entra, quantidade 0 remove, subtotal com centavos), e `gravarVenda` com o `fakeDb`: ordem `vendas` → `venda_itens` → `estoque_movimentos` → `pagamentos` (`venda_id`, `maquininha_id`); erro em `vendas` lança e não chama as seguintes; erro em `estoque_movimentos` não lança e devolve `avisoEstoque`; erro em `pagamentos` lança com a etapa "pagamentos". Leia antes o PDV atual (`web/app/(app)/vendas/page.tsx`, `confirmarVenda`) para copiar as colunas exatas de cada insert (`vendas`: empresa_id, cliente_id, valor_total, desconto, …; `venda_itens`; `estoque_movimentos` tipo saída com `produto_id`, `quantidade`, `motivo`/`origem` iguais aos de hoje).
- [ ] **Step 2: `shared/venda.ts`** implementa o acima (venda inserida com `.select('id').single()`).
- [ ] **Step 3: PDV web**: carrinho por `shared/venda.ts`; desconto %/R$ com `calcularDesconto` (mesmo toggle da comanda); resumo por `resumoComanda({ subtotal, desconto, erroDesconto, descontoReserva: 0, splits })` com os mesmos textos ("Ainda faltam…", troco, cortesia automática); pagamentos iguais aos da comanda (métodos podem repetir, cartão com maquininha/bandeira/parcelas/taxa, aviso de taxa não cadastrada); botão "Finalizar venda" habilitado por `podeFechar` e trava de duplo clique; gravação por `gravarVenda` (erro → mensagem com a etapa; `avisoEstoque` → toast de aviso). Histórico mostra bandeira por `nomeBandeira`.
- [ ] **Step 4:** testes, tsc web, tsc mobile (6). Commit `feat(vendas): regra unica de venda e PDV do web pela regra da comanda`.

---

### Task 7: App — Configurações → Cartões

**Files:**
- Create: `mobile/components/configuracoes/CartoesConfig.tsx`
- Modify: `mobile/app/(empresa)/configuracoes.tsx` (remove o bloco "Taxas da maquininha" e o envio das colunas `taxa_cartao_*`; renderiza `CartoesConfig`)
- Test: `web/tests/unit/cartoes-paridade.test.ts` (acrescentar)

- [ ] **Step 1: Varredura** igual à da Task 5, para os arquivos do app. Run → FAIL.
- [ ] **Step 2: Implementar** espelhando a Task 5 (mesmas regras, textos, bloqueios e permissão), em RN com o estilo da tela (`C`, fontes PlusJakartaSans, `Modal`/sheet já usados no app). Teclado `decimal-pad` nos campos de %.
- [ ] **Step 3:** testes, tsc web, tsc mobile (6). Commit `feat(cartoes/app): configuracoes de maquininhas, bandeiras e taxas`.

---

### Task 8: App — Vendas avulsas

**Files:**
- Create: `mobile/app/(empresa)/vendas.tsx`
- Modify: `mobile/app/(empresa)/mais.tsx` (item "Vendas" com a permissão `vendas.acessar`), `mobile/app/(empresa)/_layout.tsx` (registrar a rota escondida da tab bar, como as outras telas de "Mais")
- Test: `web/tests/unit/cartoes-paridade.test.ts` (acrescentar)

**Interfaces:** consome `shared/venda.ts`, `carregarConfigCartoes`, `gerarTextoRecibo`/`linkWhatsAppRecibo`, `invalidarFinanceiro`.

- [ ] **Step 1: Varredura** — `vendas.tsx` existe, importa `gravarVenda(` e `carregarConfigCartoes(`, checa `pode('vendas.acessar')`; `mais.tsx` tem rota `/(empresa)/vendas`. Run → FAIL.
- [ ] **Step 2: Implementar** (referência: PDV do web após a Task 6):
  1. Sem `vendas.acessar` → tela "Sem permissão" (mesmo padrão de outras telas do app).
  2. Aba **Nova venda**: busca de produto (produtos de venda ativos), carrinho com +/−, cliente opcional (busca), desconto %/R$, pagamentos (mesma UI da comanda do app da Task 4, extraia o bloco de pagamento para um componente compartilhado `mobile/components/comanda/PagamentosEditor.tsx` se ficar duplicado), resumo e botão "Finalizar venda" (`podeFechar`, trava de duplo toque).
  3. Sucesso: tela com total, itens, pagamentos e "Enviar recibo por WhatsApp" quando a cliente tem telefone (`gerarTextoRecibo` com os itens da venda); `invalidarFinanceiro(qc)`; recarrega produtos (estoque).
  4. Aba **Histórico**: vendas do dia escolhido (setas de dia, mesmo formato do web), com cliente, itens, pagamentos e total.
- [ ] **Step 3:** testes, tsc web, tsc mobile (6). Commit `feat(vendas/app): vendas avulsas no app`.

---

### Task 9: Auditoria e PR

- [ ] Verificação completa (web tsc + vitest; mobile tsc com 6).
- [ ] Entrada "Sessão 2026-10-09 — Cartões configuráveis + Comanda C" no CLAUDE.md (antes de `## ✅ ESCOPO COMPLETO`), no formato das anteriores, com a pendência "aplicar 086 no SQL Editor (https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new)" e a ordem: deploy antes ou depois é livre (sem a 086 vale a configuração legada).
- [ ] Commit `docs: auditoria de cartoes e vendas no app`, `gh auth switch --user ruan-lopes16`, push, `gh pr create` (corpo terminando com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). Não mergear.
