# Comanda B — recursos no app + comissão de serviço extra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A comanda do app faz tudo o que a do web faz, serviço extra com profissional gera comissão (trigger no banco), e abrir comanda fechada abre a comanda certa nas duas plataformas.

**Architecture:** Regras puras novas em `shared/` (diff de itens, cartões do dia, texto do recibo, consultas de backlog/comandas só-extras), comissão de item por triggers SECURITY DEFINER na migration 085, telas de comissão lendo extras por `shared/comissoes.ts`. Web e app consomem as mesmas funções.

**Tech Stack:** Next.js (web), Expo/React Native (mobile), Supabase (Postgres + RLS), vitest (testes em `web/tests/unit`, imports `@shared/...`).

**Spec:** `docs/superpowers/specs/2026-10-08-comanda-b-recursos-app-design.md`

## Global Constraints

- Toda comunicação, comentários e mensagens de UI em português.
- Paridade web/mobile: o que entra num lado entra no outro.
- Nada novo na área `mobile/app/(profissional)`.
- Migrations são aplicadas à mão no SQL Editor; nunca `supabase db push`. Migration idempotente, termina com `notify pgrst, 'reload schema';`.
- Código funciona antes e depois da 085 (sem a 085: sem comissão de extra; telas de comissão usam colunas antigas).
- Valores digitados lidos com `parseValorBR` (`@shared/comanda-fechamento`); dinheiro exibido com `formatarMoeda` (`@shared/moeda`).
- Erros de banco para o usuário via `mensagemErroBanco(erro, acao)` (`@shared/erros`).
- Todo UPDATE/DELETE que precisa ter efeito usa `.select('id')` e confere a contagem (RLS devolve 0 linhas sem erro).
- Verificação de cada task: `cd web && npx tsc --noEmit` zerado; `cd web && npx vitest run` verde; tasks que tocam `mobile/`: `cd mobile && npx tsc --noEmit` com exatamente os 6 erros pré-existentes (configuracoes.tsx ×2, estoque.tsx, useAgenda.ts, useNotificacoes.ts ×2), nenhum novo.
- Commits com `git commit -F -` (heredoc no Bash) terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/085_comissao_servico_extra.sql` (novo) | coluna `comissoes.comanda_item_id`, CHECK de origem, 3 triggers de comissão por item |
| `shared/comanda-fechamento.ts` | + `diffItensComanda` |
| `shared/comanda.ts` | + `cartoesComandaDoDia` |
| `shared/comanda-recibo.ts` (novo) | `gerarTextoRecibo` (mesmo texto web/app) |
| `shared/comanda-consultas.ts` (novo) | `carregarBacklogComandas`, `carregarComandasSoExtrasDoDia`, `carregarComissoesPagasDosItens` |
| `shared/comissoes.ts`, `shared/comissoes-consultas.ts` | comissão de extra normalizada; fallback antes da 085 |
| `web/app/(app)/comanda/page.tsx` | cartões por comanda, reabrir só-extras, edição por diff, travas de comissão paga, recibo e backlog de shared |
| `mobile/app/(empresa)/nova-comanda.tsx` | dias (semana/mês/backlog), itens (remover atendimento, profissional, valor, quantidade), recibo WhatsApp, editar comanda fechada |
| `web/tests/unit/*.test.ts` | testes de cada task |

---

### Task 1: Migration 085 — comissão de serviço extra

**Files:**
- Create: `supabase/migrations/085_comissao_servico_extra.sql`
- Test: `web/tests/unit/comissao-servico-extra-migration.test.ts`

**Interfaces:**
- Produces: coluna `comissoes.comanda_item_id uuid null`; `comissoes.agendamento_id` nullable; exceção `'Comissão deste serviço já foi paga'` ao apagar item / trocar profissional de item com comissão paga.

- [ ] **Step 1: Escrever o teste (texto da migration)**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '085_comissao_servico_extra.sql'), 'utf8').toLowerCase();

describe('Migration 085: comissão de serviço extra', () => {
  it('coluna comanda_item_id, agendamento_id nullable e CHECK de origem', () => {
    expect(sql).toMatch(/add column if not exists comanda_item_id uuid references public\.comanda_itens\(id\)/);
    expect(sql).toMatch(/alter column agendamento_id drop not null/);
    expect(sql).toMatch(/constraint comissoes_origem check \(agendamento_id is not null or comanda_item_id is not null\)/);
  });
  it('três funções security definer com search_path', () => {
    for (const f of ['gerar_comissao_item', 'sincronizar_comissao_item', 'apagar_comissao_item']) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${f}\\(\\)`));
    }
    expect(sql.match(/security definer set search_path = public/g)?.length).toBe(3);
  });
  it('triggers em comanda_itens: after insert, after update, before delete', () => {
    expect(sql).toMatch(/create trigger trg_gerar_comissao_item\s+after insert on public\.comanda_itens/);
    expect(sql).toMatch(/create trigger trg_sincronizar_comissao_item\s+after update on public\.comanda_itens/);
    expect(sql).toMatch(/create trigger trg_apagar_comissao_item\s+before delete on public\.comanda_itens/);
  });
  it('só serviço com profissional e percentual > 0; comissão paga bloqueia', () => {
    expect(sql).toContain("new.tipo = 'servico'");
    expect(sql).toContain('percentual_comissao');
    expect(sql).toContain('comissão deste serviço já foi paga');
  });
  it('idempotente e recarrega o schema', () => {
    expect(sql).toMatch(/drop trigger if exists trg_gerar_comissao_item/);
    expect(sql).toMatch(/drop constraint if exists comissoes_origem/);
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/comissao-servico-extra-migration.test.ts`
Expected: FAIL (ENOENT no arquivo da migration).

- [ ] **Step 3: Escrever a migration**

```sql
-- ============================================================
-- 085 — Comissão de serviço extra lançado na comanda
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-08-comanda-b-recursos-app-design.md
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
--
-- Antes: só o atendimento agendado gerava comissão (trg_gerar_comissao, 065). Serviço
-- extra da comanda guardava `comanda_itens.profissional_id`, mas ninguém recebia comissão.
-- Agora: item `servico` com profissional gera comissão pelo percentual dela
-- (empresa_membros.percentual_comissao), igual ao atendimento.
--   - valor/quantidade alterados → valor_servico acompanha (pendente ou paga — mesma regra
--     da 075 para atendimento: se já foi repassada, ajuste o repasse);
--   - profissional trocada/removida ou item apagado → comissão pendente some; paga bloqueia.
-- SECURITY DEFINER: a profissional que fecha a comanda não tem INSERT/UPDATE em `comissoes`.
-- Sem backfill: extras antigos não ganham comissão (decisão de não reescrever histórico).
--
-- Rollback:
--   drop trigger if exists trg_gerar_comissao_item on public.comanda_itens;
--   drop trigger if exists trg_sincronizar_comissao_item on public.comanda_itens;
--   drop trigger if exists trg_apagar_comissao_item on public.comanda_itens;
--   drop function if exists public.gerar_comissao_item(), public.sincronizar_comissao_item(), public.apagar_comissao_item();
--   delete from public.comissoes where comanda_item_id is not null;
--   alter table public.comissoes drop constraint if exists comissoes_origem;
--   alter table public.comissoes drop column if exists comanda_item_id;
--   alter table public.comissoes alter column agendamento_id set not null;

alter table public.comissoes
  add column if not exists comanda_item_id uuid references public.comanda_itens(id);
alter table public.comissoes alter column agendamento_id drop not null;
alter table public.comissoes drop constraint if exists comissoes_origem;
alter table public.comissoes add constraint comissoes_origem check (agendamento_id is not null or comanda_item_id is not null);
create index if not exists idx_comissoes_comanda_item on public.comissoes(comanda_item_id) where comanda_item_id is not null;

-- Insere a comissão de um item (usado no INSERT e na troca de profissional).
create or replace function public.gerar_comissao_item()
returns trigger as $$
declare
  v_percentual numeric(5,2);
begin
  if new.tipo = 'servico' and new.profissional_id is not null and new.valor_unit * new.quantidade > 0 then
    select percentual_comissao into v_percentual
      from public.empresa_membros
     where empresa_id = new.empresa_id and user_id = new.profissional_id;
    if v_percentual is not null and v_percentual > 0 then
      insert into public.comissoes (empresa_id, profissional_id, comanda_item_id, valor_servico, percentual)
      values (new.empresa_id, new.profissional_id, new.id, round(new.valor_unit * new.quantidade, 2), v_percentual);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.sincronizar_comissao_item()
returns trigger as $$
declare
  v_percentual numeric(5,2);
begin
  if new.profissional_id is distinct from old.profissional_id or new.tipo is distinct from old.tipo then
    if exists (select 1 from public.comissoes where comanda_item_id = old.id and status = 'pago') then
      raise exception 'Comissão deste serviço já foi paga';
    end if;
    delete from public.comissoes where comanda_item_id = old.id;
    if new.tipo = 'servico' and new.profissional_id is not null and new.valor_unit * new.quantidade > 0 then
      select percentual_comissao into v_percentual
        from public.empresa_membros
       where empresa_id = new.empresa_id and user_id = new.profissional_id;
      if v_percentual is not null and v_percentual > 0 then
        insert into public.comissoes (empresa_id, profissional_id, comanda_item_id, valor_servico, percentual)
        values (new.empresa_id, new.profissional_id, new.id, round(new.valor_unit * new.quantidade, 2), v_percentual);
      end if;
    end if;
  elsif new.valor_unit is distinct from old.valor_unit or new.quantidade is distinct from old.quantidade then
    update public.comissoes
       set valor_servico = round(new.valor_unit * new.quantidade, 2)
     where comanda_item_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.apagar_comissao_item()
returns trigger as $$
begin
  if exists (select 1 from public.comissoes where comanda_item_id = old.id and status = 'pago') then
    raise exception 'Comissão deste serviço já foi paga';
  end if;
  delete from public.comissoes where comanda_item_id = old.id;
  return old;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_gerar_comissao_item on public.comanda_itens;
create trigger trg_gerar_comissao_item
  after insert on public.comanda_itens
  for each row execute function public.gerar_comissao_item();

drop trigger if exists trg_sincronizar_comissao_item on public.comanda_itens;
create trigger trg_sincronizar_comissao_item
  after update on public.comanda_itens
  for each row execute function public.sincronizar_comissao_item();

drop trigger if exists trg_apagar_comissao_item on public.comanda_itens;
create trigger trg_apagar_comissao_item
  before delete on public.comanda_itens
  for each row execute function public.apagar_comissao_item();

notify pgrst, 'reload schema';
```

Atenção: a contagem de `security definer set search_path = public` no teste é 3 — não escreva essa frase em comentários do arquivo.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run tests/unit/comissao-servico-extra-migration.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/085_comissao_servico_extra.sql web/tests/unit/comissao-servico-extra-migration.test.ts
git commit -F - <<'EOF'
feat(banco): comissao de servico extra da comanda (migration 085)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Regras puras e consultas da comanda em `shared/`

**Files:**
- Modify: `shared/comanda-fechamento.ts` (+ `diffItensComanda`)
- Modify: `shared/comanda.ts` (+ `cartoesComandaDoDia`)
- Create: `shared/comanda-recibo.ts`
- Create: `shared/comanda-consultas.ts`
- Test: `web/tests/unit/comanda-b-shared.test.ts`

**Interfaces:**
- Produces:
  - `type ItemComandaPersistivel = { item_id?: string; tipo: 'servico' | 'produto' | 'pacote'; descricao: string; servico_id?: string; produto_id?: string; pacote_id?: string; profissional_id?: string | null; quantidade: number; valor: number }`
  - `type ItemComandaOriginal = { item_id: string; valor: number; quantidade: number; profissional_id: string | null }`
  - `diffItensComanda(originais: ItemComandaOriginal[], atuais: ItemComandaPersistivel[]): { inserir: ItemComandaPersistivel[]; atualizar: { item_id: string; valor_unit: number; quantidade: number; profissional_id: string | null }[]; apagar: string[] }`
  - `type AgendamentoCartao = { id: string; data_hora_inicio: string; status: string; comanda_id: string | null; cliente: { id: string; nome: string; telefone?: string } | null }`
  - `type ComandaSoExtras = { id: string; fechada_at: string; cliente: { id: string; nome: string; telefone?: string | null } | null }`
  - `type CartaoComanda<T> = { chave: string; clienteId: string; nome: string; telefone?: string; agendamentos: T[]; comandaId: string | null; fechada: boolean; ordem: string }`
  - `cartoesComandaDoDia<T extends AgendamentoCartao>(ags: T[], soExtras: ComandaSoExtras[]): CartaoComanda<T>[]`
  - `type DadosRecibo = { nome: string; valor: number; dataIso: string; itens: { descricao: string; quantidade: number; valor: number }[]; splits: { metodo: string; valor: number; bandeira?: string | null; parcelas?: number }[]; desconto: number; descontoReserva: number }`
  - `gerarTextoRecibo(d: DadosRecibo): string`; `linkWhatsAppRecibo(telefone: string, texto: string): string`
  - `carregarBacklogComandas(db: ClienteDb, empresaId: string, agoraIso: string): Promise<{ id: string; data_hora_inicio: string }[]>`
  - `carregarComandasSoExtrasDoDia(db: ClienteDb, empresaId: string, l: Limites): Promise<ComandaSoExtras[]>`
  - `carregarComissoesPagasDosItens(db: ClienteDb, itemIds: string[]): Promise<Set<string>>` (ids de item com comissão paga; vazio se a 085 não existe)

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, expect, it } from 'vitest';
import { diffItensComanda } from '@shared/comanda-fechamento';
import { cartoesComandaDoDia } from '@shared/comanda';
import { gerarTextoRecibo, linkWhatsAppRecibo } from '@shared/comanda-recibo';
import { carregarBacklogComandas, carregarComandasSoExtrasDoDia, carregarComissoesPagasDosItens } from '@shared/comanda-consultas';
import { limitesDias } from '@shared/periodos';
import { fakeDb, opsDe } from './fixtures/fake-db';

describe('diffItensComanda', () => {
  const orig = [
    { item_id: 'a', valor: 50, quantidade: 1, profissional_id: 'p1' },
    { item_id: 'b', valor: 30, quantidade: 2, profissional_id: null },
    { item_id: 'c', valor: 10, quantidade: 1, profissional_id: null },
  ];
  it('atualiza só o que mudou, apaga removidos e insere novos', () => {
    const r = diffItensComanda(orig, [
      { item_id: 'a', tipo: 'servico', descricao: 'Esmalte', quantidade: 1, valor: 60, profissional_id: 'p1' },
      { item_id: 'b', tipo: 'produto', descricao: 'Creme', quantidade: 2, valor: 30, profissional_id: null },
      { tipo: 'servico', descricao: 'Novo', quantidade: 1, valor: 20, profissional_id: 'p2' },
    ]);
    expect(r.atualizar).toEqual([{ item_id: 'a', valor_unit: 60, quantidade: 1, profissional_id: 'p1' }]);
    expect(r.apagar).toEqual(['c']);
    expect(r.inserir.map(i => i.descricao)).toEqual(['Novo']);
  });
  it('troca de profissional e undefined = null', () => {
    const r = diffItensComanda([{ item_id: 'a', valor: 50, quantidade: 1, profissional_id: 'p1' }],
      [{ item_id: 'a', tipo: 'servico', descricao: 'X', quantidade: 1, valor: 50 }]);
    expect(r.atualizar).toEqual([{ item_id: 'a', valor_unit: 50, quantidade: 1, profissional_id: null }]);
  });
  it('nada mudou → listas vazias', () => {
    const r = diffItensComanda(orig.slice(0, 1), [{ item_id: 'a', tipo: 'servico', descricao: 'E', quantidade: 1, valor: 50, profissional_id: 'p1' }]);
    expect(r).toEqual({ inserir: [], atualizar: [], apagar: [] });
  });
});

describe('cartoesComandaDoDia', () => {
  const cli = { id: 'c1', nome: 'Ana', telefone: '34999' };
  const ag = (id: string, hora: string, status: string, comanda_id: string | null, cliente = cli) =>
    ({ id, data_hora_inicio: `2026-10-08T${hora}:00-03:00`, status, comanda_id, cliente });
  it('uma comanda fechada por cartão e um cartão para os abertos', () => {
    const cards = cartoesComandaDoDia([
      ag('1', '09:00', 'concluido', 'K1'),
      ag('2', '11:00', 'concluido', 'K2'),
      ag('3', '15:00', 'agendado', null),
      ag('4', '16:00', 'concluido', null),
    ], []);
    expect(cards.map(c => [c.comandaId, c.fechada, c.agendamentos.map(a => a.id)])).toEqual([
      ['K1', true, ['1']],
      ['K2', true, ['2']],
      [null, false, ['3', '4']],
    ]);
    expect(cards[0].chave).toBe('c1|K1');
    expect(cards[2].chave).toBe('c1|aberta');
  });
  it('sem cliente vira __sem__; comanda só com extras vira cartão fechado sem agendamentos', () => {
    const cards = cartoesComandaDoDia([ag('1', '10:00', 'agendado', null, null as any)], [
      { id: 'K9', fechada_at: '2026-10-08T12:00:00-03:00', cliente: { id: 'c2', nome: 'Bia', telefone: null } },
      { id: 'K8', fechada_at: '2026-10-08T08:00:00-03:00', cliente: null },
    ]);
    expect(cards.map(c => [c.clienteId, c.nome, c.comandaId, c.fechada])).toEqual([
      ['__sem__', 'Cliente', 'K8', true],
      ['__sem__', 'Cliente', null, false],
      ['c2', 'Bia', 'K9', true],
    ]);
    expect(cards[2].agendamentos).toEqual([]);
    expect(cards[2].telefone).toBeUndefined();
  });
});

describe('gerarTextoRecibo', () => {
  it('mesmo formato do web, data em Brasília', () => {
    const t = gerarTextoRecibo({
      nome: 'Ana', valor: 90, dataIso: '2026-10-08T17:30:00Z',
      itens: [{ descricao: 'Corte', quantidade: 1, valor: 80 }, { descricao: 'Creme', quantidade: 2, valor: 10 }],
      splits: [{ metodo: 'credito', valor: 50, bandeira: 'visa', parcelas: 2 }, { metodo: 'pix', valor: 40 }],
      desconto: 5, descontoReserva: 5,
    });
    expect(t.split('\n')).toEqual([
      '🌸 *Recibo de Atendimento*', '', '👤 Ana', '📅 08/10/2026 às 14:30', '',
      '*Serviços:*', '• Corte — R$ 80,00', '• Creme (2x) — R$ 20,00',
      '• Taxa de reserva paga — −R$ 5,00', '• Desconto — −R$ 5,00', '',
      '💰 *Total: R$ 90,00*', '', '*Pagamento:*', '• Crédito Visa 2x — R$ 50,00', '• PIX — R$ 40,00',
    ]);
  });
  it('link do WhatsApp com DDI e texto codificado', () => {
    expect(linkWhatsAppRecibo('(34) 99178-0000', 'a b')).toBe('https://wa.me/5534991780000?text=a%20b');
  });
});

describe('consultas da comanda', () => {
  it('backlog: sem comanda, não cancelado/faltou, já terminou, mais antigo primeiro, até 500', async () => {
    const { db, chamadas } = fakeDb();
    await carregarBacklogComandas(db, 'emp', '2026-10-08T12:00:00.000Z');
    const [ops] = opsDe(chamadas, 'agendamentos');
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['is', ['comanda_id', null]]);
    expect(ops).toContainEqual(['not', ['status', 'in', '("cancelado","faltou")']]);
    expect(ops).toContainEqual(['lt', ['data_hora_fim', '2026-10-08T12:00:00.000Z']]);
    expect(ops).toContainEqual(['limit', [500]]);
  });
  it('comandas só com extras: fechadas no dia, sem agendamento vinculado', async () => {
    const l = limitesDias('2026-10-08', '2026-10-08');
    const { db, chamadas } = fakeDb({ comandas: [
      { id: 'K1', fechada_at: '2026-10-08T12:00:00Z', cliente: null, agendamentos: [] },
      { id: 'K2', fechada_at: '2026-10-08T13:00:00Z', cliente: null, agendamentos: [{ id: 'a' }] },
    ] });
    const r = await carregarComandasSoExtrasDoDia(db, 'emp', l);
    expect(r.map(c => c.id)).toEqual(['K1']);
    const [ops] = opsDe(chamadas, 'comandas');
    expect(ops).toContainEqual(['eq', ['status', 'fechada']]);
    expect(ops).toContainEqual(['gte', ['fechada_at', l.startIso]]);
    expect(ops).toContainEqual(['lte', ['fechada_at', l.endIso]]);
  });
  it('comissões pagas dos itens: lista vazia não consulta', async () => {
    const { db, chamadas } = fakeDb();
    expect((await carregarComissoesPagasDosItens(db, [])).size).toBe(0);
    expect(opsDe(chamadas, 'comissoes')).toEqual([]);
  });
});
```

Antes de escrever, leia `web/tests/unit/fixtures/fake-db.ts` para confirmar a assinatura de `fakeDb` (aceita dados por tabela? registra `limit`/`is`/`not`?). Se `fakeDb` não aceitar dados iniciais ou não registrar algum método, estenda o fixture de forma retrocompatível (não altere o comportamento usado pelos testes existentes) e ajuste o teste para essa forma.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/comanda-b-shared.test.ts`
Expected: FAIL (exports não existem).

- [ ] **Step 3: Implementar**

Em `shared/comanda-fechamento.ts` (no fim):

```ts
/** Item extra da comanda como a tela o tem; `item_id` = linha já gravada em `comanda_itens`. */
export type ItemComandaPersistivel = {
  item_id?: string; tipo: 'servico' | 'produto' | 'pacote'; descricao: string;
  servico_id?: string; produto_id?: string; pacote_id?: string; profissional_id?: string | null;
  quantidade: number; valor: number;
};
/** Como o item estava no banco ao reabrir a comanda fechada. */
export type ItemComandaOriginal = { item_id: string; valor: number; quantidade: number; profissional_id: string | null };

/**
 * Edição de comanda fechada por diferença (não apaga e reinsere): a comissão do serviço extra
 * mora no item (migration 085) e recriar o item recriaria a comissão — ou falharia se já paga.
 */
export function diffItensComanda(originais: ItemComandaOriginal[], atuais: ItemComandaPersistivel[]) {
  const porId = new Map(originais.map(o => [o.item_id, o]));
  const mantidos = new Set<string>();
  const inserir: ItemComandaPersistivel[] = [];
  const atualizar: { item_id: string; valor_unit: number; quantidade: number; profissional_id: string | null }[] = [];
  for (const i of atuais) {
    const o = i.item_id ? porId.get(i.item_id) : undefined;
    if (!o) { inserir.push(i); continue; }
    mantidos.add(o.item_id);
    const prof = i.profissional_id ?? null;
    if (centavos(i.valor) !== centavos(o.valor) || i.quantidade !== o.quantidade || prof !== o.profissional_id) {
      atualizar.push({ item_id: o.item_id, valor_unit: centavos(i.valor), quantidade: i.quantidade, profissional_id: prof });
    }
  }
  const apagar = originais.filter(o => !mantidos.has(o.item_id)).map(o => o.item_id);
  return { inserir, atualizar, apagar };
}
```

Em `shared/comanda.ts` (no fim):

```ts
export type AgendamentoCartao = {
  id: string; data_hora_inicio: string; status: string; comanda_id: string | null;
  cliente: { id: string; nome: string; telefone?: string } | null;
};
export type ComandaSoExtras = {
  id: string; fechada_at: string;
  cliente: { id: string; nome: string; telefone?: string | null } | null;
};
/** Um cartão da lista do dia: os atendimentos abertos da cliente, ou UMA comanda fechada. */
export type CartaoComanda<T> = {
  chave: string; clienteId: string; nome: string; telefone?: string;
  agendamentos: T[]; comandaId: string | null; fechada: boolean; ordem: string;
};

/**
 * Cartões da lista de comandas do dia (web e app). Cada comanda fechada é um cartão — a mesma
 * cliente pode ter duas no dia, e abrir "a primeira comanda_id" editava a comanda errada.
 * Atendimento concluído SEM comanda_id (atalho do app / backlog) continua aberto. Comandas só
 * com extras (nenhum atendimento vinculado) também viram cartão, para poderem ser reabertas.
 */
export function cartoesComandaDoDia<T extends AgendamentoCartao>(ags: T[], soExtras: ComandaSoExtras[]): CartaoComanda<T>[] {
  const mapa = new Map<string, CartaoComanda<T>>();
  for (const ag of ags) {
    const clienteId = ag.cliente?.id ?? '__sem__';
    const fechada = ag.status === 'concluido' && !!ag.comanda_id;
    const chave = `${clienteId}|${fechada ? ag.comanda_id : 'aberta'}`;
    let c = mapa.get(chave);
    if (!c) {
      c = { chave, clienteId, nome: ag.cliente?.nome ?? 'Cliente', telefone: ag.cliente?.telefone,
        agendamentos: [], comandaId: fechada ? ag.comanda_id : null, fechada, ordem: ag.data_hora_inicio };
      mapa.set(chave, c);
    }
    c.agendamentos.push(ag);
    if (instanteMs(ag.data_hora_inicio) < instanteMs(c.ordem)) c.ordem = ag.data_hora_inicio;
  }
  for (const k of soExtras) {
    const clienteId = k.cliente?.id ?? '__sem__';
    mapa.set(`${clienteId}|${k.id}`, {
      chave: `${clienteId}|${k.id}`, clienteId, nome: k.cliente?.nome ?? 'Cliente',
      telefone: k.cliente?.telefone ?? undefined, agendamentos: [], comandaId: k.id, fechada: true, ordem: k.fechada_at,
    });
  }
  return [...mapa.values()].sort((a, b) => instanteMs(a.ordem) - instanteMs(b.ordem) || a.chave.localeCompare(b.chave));
}
```

Importe `instanteMs` de `./periodos` no topo de `shared/comanda.ts`.

`shared/comanda-recibo.ts`:

```ts
/**
 * @file comanda-recibo.ts
 * Texto do recibo da comanda enviado por WhatsApp — o MESMO no web e no app.
 */
import { formatarMoeda } from './moeda';
import { ROTULOS_BANDEIRA } from './comanda-fechamento';
import { chaveDiaBRT, horaBRT, rotuloDataBR } from './periodos';
import { toWhatsApp } from './mascaras';

const METODOS: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', cortesia: 'Cortesia' };

export type DadosRecibo = {
  nome: string; valor: number; dataIso: string;
  itens: { descricao: string; quantidade: number; valor: number }[];
  splits: { metodo: string; valor: number; bandeira?: string | null; parcelas?: number }[];
  /** Desconto manual em R$ (sem a taxa de reserva). */
  desconto: number;
  /** Taxa de reserva já paga, descontada à parte. */
  descontoReserva: number;
};

/** Recibo em texto (negrito do WhatsApp com *). Data/hora em Brasília. */
export function gerarTextoRecibo(d: DadosRecibo): string {
  return [
    '🌸 *Recibo de Atendimento*', '',
    `👤 ${d.nome}`,
    `📅 ${rotuloDataBR(chaveDiaBRT(d.dataIso))} às ${horaBRT(d.dataIso)}`, '',
    '*Serviços:*',
    ...d.itens.map(i => `• ${i.descricao}${i.quantidade > 1 ? ` (${i.quantidade}x)` : ''} — ${formatarMoeda(i.valor * i.quantidade)}`),
    ...(d.descontoReserva > 0 ? [`• Taxa de reserva paga — −${formatarMoeda(d.descontoReserva)}`] : []),
    ...(d.desconto > 0 ? [`• Desconto — −${formatarMoeda(d.desconto)}`] : []),
    '',
    `💰 *Total: ${formatarMoeda(d.valor)}*`, '',
    '*Pagamento:*',
    ...d.splits.map(s => {
      let rotulo = METODOS[s.metodo] ?? s.metodo;
      if (s.bandeira) rotulo += ` ${ROTULOS_BANDEIRA[s.bandeira] ?? s.bandeira}`;
      if (s.metodo === 'credito' && (s.parcelas ?? 1) > 1) rotulo += ` ${s.parcelas}x`;
      return `• ${rotulo} — ${formatarMoeda(s.valor)}`;
    }),
  ].join('\n');
}

/** Link wa.me com o recibo (telefone com ou sem DDI). */
export function linkWhatsAppRecibo(telefone: string, texto: string): string {
  return `https://wa.me/${toWhatsApp(telefone)}?text=${encodeURIComponent(texto)}`;
}
```

Confira que `formatarMoeda(80)` devolve `'R$ 80,00'` (com espaço comum); se o teste mostrar outro espaço, ajuste o teste ao que `formatarMoeda` devolve (ele é a fonte de verdade).

`shared/comanda-consultas.ts`:

```ts
/**
 * @file comanda-consultas.ts
 * Consultas ÚNICAS da tela de comanda (web e app).
 */
import type { ClienteDb } from './kpis-financeiros-consultas';
import type { Limites } from './periodos';
import type { ComandaSoExtras } from './comanda';

/**
 * Atendimentos que já terminaram e não têm comanda (esqueceram de fechar, ou foram marcados
 * "concluído" sem comanda pelo atalho do app). Mais antigo primeiro, até 500.
 */
export async function carregarBacklogComandas(db: ClienteDb, empresaId: string, agoraIso: string) {
  const { data, error } = await db.from('agendamentos')
    .select('id, data_hora_inicio')
    .eq('empresa_id', empresaId)
    .is('comanda_id', null)
    .not('status', 'in', '("cancelado","faltou")')
    .lt('data_hora_fim', agoraIso)
    .order('data_hora_inicio', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; data_hora_inicio: string }[];
}

/** Comandas fechadas no dia que não têm nenhum atendimento (só produtos/serviços extras). */
export async function carregarComandasSoExtrasDoDia(db: ClienteDb, empresaId: string, l: Limites): Promise<ComandaSoExtras[]> {
  const { data, error } = await db.from('comandas')
    .select('id, fechada_at, cliente:clientes!comandas_clientes_id_fkey(id, nome, telefone), agendamentos(id)')
    .eq('empresa_id', empresaId)
    .eq('status', 'fechada')
    .gte('fechada_at', l.startIso)
    .lte('fechada_at', l.endIso)
    .order('fechada_at');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[])
    .filter(c => (c.agendamentos ?? []).length === 0)
    .map(c => ({ id: c.id, fechada_at: c.fechada_at, cliente: c.cliente ?? null }));
}

/**
 * Ids de `comanda_itens` cuja comissão já foi paga (trava profissional/remover na edição).
 * Sem a migration 085 a coluna não existe: devolve vazio (não há comissão de item).
 */
export async function carregarComissoesPagasDosItens(db: ClienteDb, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const { data, error } = await db.from('comissoes')
    .select('comanda_item_id').in('comanda_item_id', itemIds).eq('status', 'pago');
  if (error) return new Set();
  return new Set(((data ?? []) as { comanda_item_id: string }[]).map(r => r.comanda_item_id));
}
```

Se `ClienteDb` não tipar `.is`, `.not`, `.lt`, `.limit` ou `.in`, siga o padrão já usado em outros `*-consultas.ts` de `shared/` (procure como eles chamam esses métodos) — não use `any` no parâmetro `db`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run tests/unit/comanda-b-shared.test.ts && npx tsc --noEmit`
Expected: PASS; tsc sem erros.

- [ ] **Step 5: Commit**

```bash
git add shared/comanda-fechamento.ts shared/comanda.ts shared/comanda-recibo.ts shared/comanda-consultas.ts web/tests/unit/comanda-b-shared.test.ts web/tests/unit/fixtures/fake-db.ts
git commit -F - <<'EOF'
feat(shared): diff de itens, cartoes do dia, recibo e consultas da comanda

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Comissão de extra nas telas de comissão (shared)

**Files:**
- Modify: `shared/comissoes.ts` (`ComissaoDetalheRow`, `normalizarComissao`)
- Modify: `shared/comissoes-consultas.ts` (`COLUNAS_COMISSAO_DETALHE`, `COLUNAS_COMISSAO_DETALHE_LEGADO`, fallback em `carregarComissoesDoPeriodo`)
- Test: `web/tests/unit/shared-comissoes.test.ts`, `web/tests/unit/shared-comissoes-consultas.test.ts` (acrescentar casos)

**Interfaces:**
- Consumes: coluna `comissoes.comanda_item_id` (Task 1).
- Produces: `ComissaoItem` inalterado na forma; comissão de extra vem com `agendamentoId: null`, `dataAtendimento = comanda.fechada_at`, `servicoNome = '<descricao> (extra)'`, `clienteNome` da comanda, `valorAtendimento = valor_servico`, categoria null.

- [ ] **Step 1: Testes**

Em `web/tests/unit/shared-comissoes.test.ts` acrescente:

```ts
describe('normalizarComissao — serviço extra da comanda', () => {
  it('data e cliente da comanda, descrição com (extra)', () => {
    const c = normalizarComissao({
      id: 'x', profissional_id: 'p', agendamento_id: null, comanda_item_id: 'i1',
      valor_servico: '40.00', percentual: '50', valor_comissao: '20.00', status: 'pendente', created_at: '2026-10-08T15:00:00Z',
      profissional: { nome: 'Lu' }, agendamento: null,
      item: { descricao: 'Esmaltação', comanda: { fechada_at: '2026-10-08T14:59:00Z', cliente: { nome: 'Ana' } } },
    });
    expect(c).toMatchObject({
      agendamentoId: null, dataAtendimento: '2026-10-08T14:59:00Z', valorAtendimento: 40,
      servicoNome: 'Esmaltação (extra)', clienteNome: 'Ana', servicoCategoria: null, valorComissao: 20,
    });
  });
});
```

Em `web/tests/unit/shared-comissoes-consultas.test.ts` acrescente (ajuste ao `fakeDb` existente — veja como ele simula erro):

```ts
it('sem a migration 085 cai nas colunas antigas', async () => {
  const { db, chamadas } = fakeDb({ erroQuandoSelectContem: { comissoes: 'comanda_item_id' } });
  await carregarComissoesDoPeriodo(db, 'emp', SET);
  const selects = opsDe(chamadas, 'comissoes').map(ops => ops.find(([m]) => m === 'select')?.[1][0]);
  expect(selects).toEqual([COLUNAS_COMISSAO_DETALHE, COLUNAS_COMISSAO_DETALHE_LEGADO]);
});
```

Se o `fakeDb` não tiver como simular erro condicional ao conteúdo do select, acrescente essa opção ao fixture (retrocompatível) com o nome acima.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run tests/unit/shared-comissoes.test.ts tests/unit/shared-comissoes-consultas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`shared/comissoes-consultas.ts`:

```ts
/** Colunas de antes da migration 085 (sem comissão de serviço extra). */
export const COLUNAS_COMISSAO_DETALHE_LEGADO = `id, profissional_id, agendamento_id, valor_servico, percentual, valor_comissao, status, created_at,
  profissional:users!comissoes_profissional_id_fkey(nome),
  agendamento:agendamentos(data_hora_inicio, valor,
    servico:servicos(nome, categoria, categoria_id),
    cliente:clientes!agendamentos_cliente_id_fkey(nome))`;

/** Colunas atuais: + comissão de serviço extra (comanda_item_id → item → comanda → cliente). */
export const COLUNAS_COMISSAO_DETALHE = `${COLUNAS_COMISSAO_DETALHE_LEGADO}, comanda_item_id,
  item:comanda_itens(descricao, comanda:comandas(fechada_at, cliente:clientes!comandas_clientes_id_fkey(nome)))`;
```

Em `carregarComissoesDoPeriodo`, extraia a montagem para uma função interna `buscar(colunas)` e:

```ts
  try {
    return await buscar(COLUNAS_COMISSAO_DETALHE);
  } catch (e) {
    // Banco sem a migration 085: coluna/relação de comanda_item_id não existe.
    if (e instanceof Error && /comanda_item/.test(e.message)) return buscar(COLUNAS_COMISSAO_DETALHE_LEGADO);
    throw e;
  }
```

`shared/comissoes.ts`: em `ComissaoDetalheRow` acrescente

```ts
  comanda_item_id?: string | null;
  item?: { descricao: string | null; comanda?: { fechada_at: string | null; cliente?: { nome: string | null } | null } | null } | null;
```

e em `normalizarComissao`, quando `r.agendamento` for nulo e `r.item` existir, use a comanda:

```ts
  const ag = r.agendamento ?? null;
  const extra = !ag && r.item ? r.item : null;
  // ...
    dataAtendimento: ag?.data_hora_inicio ?? extra?.comanda?.fechada_at ?? null,
    valorAtendimento: ag && ag.valor != null ? num(ag.valor) : extra ? num(r.valor_servico) : null,
    servicoNome: extra ? `${extra.descricao || 'Serviço'} (extra)` : ag?.servico?.nome || 'Serviço',
    clienteNome: ag?.cliente?.nome || extra?.comanda?.cliente?.nome || '—',
```

Depois, rode `grep -rn "agendamento?\.\|\.agendamento\." web/app mobile/app mobile/hooks --include=*.ts --include=*.tsx | grep -i comiss` e confirme que nenhuma tela lê o embed `agendamento` cru de comissão (todas devem usar `ComissaoItem`). Se alguma ler, troque pelo campo de `ComissaoItem` equivalente.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run && npx tsc --noEmit && cd ../mobile && npx tsc --noEmit`
Expected: vitest verde; tsc web sem erros; mobile só os 6 pré-existentes.

- [ ] **Step 5: Commit**

```bash
git add shared/comissoes.ts shared/comissoes-consultas.ts web/tests/unit/shared-comissoes.test.ts web/tests/unit/shared-comissoes-consultas.test.ts web/tests/unit/fixtures/fake-db.ts
git commit -F - <<'EOF'
feat(comissoes): comissao de servico extra nas telas, com fallback antes da 085

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Web — cartões por comanda, reabrir só-extras, edição por diff

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`
- Test: `web/tests/unit/comanda-b-paridade.test.ts` (novo; varredura)

**Interfaces:**
- Consumes: `cartoesComandaDoDia`, `CartaoComanda`, `diffItensComanda`, `ItemComandaOriginal`, `gerarTextoRecibo`, `linkWhatsAppRecibo`, `carregarBacklogComandas`, `carregarComandasSoExtrasDoDia`, `carregarComissoesPagasDosItens` (Task 2).

- [ ] **Step 1: Teste de varredura (falha antes da mudança)**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(process.cwd(), '..');
const web = readFileSync(join(raiz, 'web/app/(app)/comanda/page.tsx'), 'utf8');

describe('Comanda B — web', () => {
  it('usa as regras de shared', () => {
    expect(web).toContain("from '@shared/comanda-recibo'");
    expect(web).toContain('cartoesComandaDoDia(');
    expect(web).toContain('diffItensComanda(');
    expect(web).toContain('carregarBacklogComandas(');
    expect(web).toContain('carregarComandasSoExtrasDoDia(');
    expect(web).not.toMatch(/function gerarTextoRecibo/);
  });
  it('não apaga mais todos os itens da comanda na edição', () => {
    expect(web).not.toMatch(/from\('comanda_itens'\)\.delete\(\)\.eq\('comanda_id'/);
  });
  it('abre a comanda do cartão, não a primeira da cliente', () => {
    expect(web).not.toMatch(/agendamentos\.find\(a => a\.comanda_id\)\?\.comanda_id/);
  });
});
```

Run: `cd web && npx vitest run tests/unit/comanda-b-paridade.test.ts` → FAIL.

- [ ] **Step 2: Lista do dia por cartão**

1. `ClienteComanda` ganha `comandaId: string | null` e `chave: string`. Substitua o `useMemo` `clientesDia` por:

```ts
const [soExtrasDia, setSoExtrasDia] = useState<ComandaSoExtras[]>([]);
const clientesDia = useMemo<ClienteComanda[]>(() =>
  cartoesComandaDoDia(agDia, soExtrasDia).map(c => ({
    id: c.clienteId, chave: c.chave, nome: c.nome, telefone: c.telefone,
    agendamentos: c.agendamentos, comandaId: c.comandaId,
  })), [agDia, soExtrasDia]);
```

2. No carregamento do dia (mesmo efeito que preenche `agDia`), carregue também
`carregarComandasSoExtrasDoDia(supabase, empresaId, limitesDias(chaveDiaExibido(dataComanda), chaveDiaExibido(dataComanda)))`
(em `try/catch`; erro → `setErro(mensagemErroBanco(...,'carregar as comandas do dia'))` e lista vazia) e grave em `setSoExtrasDia`.
3. No `map` da lista: `key={cliente.chave}`, `ativo = clienteSel?.chave === cliente.chave`, `jaFeita = cliente.comandaId !== null`.
O subtítulo do cartão usa `primeiroAg`; para cartão sem agendamentos mostre `fmtHora` de... não há horário: mostre `'Só produtos/serviços extras'`. `temAtendimentoDeOutra` com lista vazia já devolve false.
4. `abrirComandaFechada(cliente)`: troque a primeira linha por `const comandaId = cliente.comandaId;`.
5. `proximoClienteAberto` passa a filtrar `c.comandaId === null` (só cartões abertos) e comparar `c.chave !== excluirChave`. Onde `clienteSel.id` é usado como identidade de cartão (`comandasParciais`), mantenha `id` (cliente) — a trava de comanda parcial é por cliente, como na A.

- [ ] **Step 3: Backlog e recibo de shared**

- `fetchBacklog` passa a chamar `carregarBacklogComandas(supabase, empId, new Date().toISOString())` (try/catch; erro → lista vazia).
- Apague a função local `gerarTextoRecibo` e o `MET_LABELS`. No botão de WhatsApp:

```ts
const texto = gerarTextoRecibo({
  nome: sucesso.nome, valor: sucesso.valor, dataIso: sucesso.data.toISOString(),
  itens: sucesso.itens.map(i => ({ descricao: i.descricao, quantidade: i.quantidade, valor: i.valor })),
  splits: sucesso.splits.map(s => ({ metodo: s.metodo, valor: parseValorBR(s.valor), bandeira: s.bandeira, parcelas: s.parcelas })),
  desconto: sucesso.desconto, descontoReserva: sucesso.descontoReserva,
});
window.open(linkWhatsAppRecibo(sucesso.telefone!, texto), '_blank');
```

Remova o import de `toWhatsApp` se ficar sem uso.

- [ ] **Step 4: Edição por diff e trava de comissão paga**

1. `ComandaItem` ganha `item_id?: string` e `comissao_paga?: boolean`. Crie o estado `const [itensOriginais, setItensOriginais] = useState<ItemComandaOriginal[]>([]);`.
2. Em `abrirComandaFechada`, o select de `comanda_itens` passa a incluir `id` e `.order('created_at')`. Os extras ganham `item_id: item.id`. Depois de montar, chame
`const pagas = await carregarComissoesPagasDosItens(supabase, extras.map(e => e.item_id!));` e marque `comissao_paga: pagas.has(e.item_id!)`.
Grave `setItensOriginais(extras.map(e => ({ item_id: e.item_id!, valor: e.valor, quantidade: e.quantidade, profissional_id: e.profissional_id ?? null })))`.
Em `abrirComanda` (comanda nova), `setItensOriginais([])`.
3. Em `editarComanda`, troque o bloco "Troca os itens extras" por:

```ts
const { inserir, atualizar, apagar } = diffItensComanda(itensOriginais, itens
  .filter(i => i.tipo !== 'agendamento')
  .map(i => ({ item_id: i.item_id, tipo: i.tipo as 'servico' | 'produto' | 'pacote', descricao: i.descricao,
    servico_id: i.servico_id, produto_id: i.produto_id, pacote_id: i.pacote_id,
    profissional_id: i.profissional_id ?? null, quantidade: i.quantidade, valor: i.valor })));

for (const id of apagar) {
  const { data, error } = await supabase.from('comanda_itens').delete().eq('id', id).select('id');
  if (error || !data || data.length === 0) { setErro(mensagemErroBanco(error, 'remover o item da comanda')); setFechando(false); return; }
}
for (const u of atualizar) {
  const { data, error } = await supabase.from('comanda_itens')
    .update({ valor_unit: u.valor_unit, quantidade: u.quantidade, profissional_id: u.profissional_id })
    .eq('id', u.item_id).select('id');
  if (error || !data || data.length === 0) { setErro(mensagemErroBanco(error, 'salvar o item da comanda')); setFechando(false); return; }
}
if (inserir.length > 0) {
  const { error } = await supabase.from('comanda_itens').insert(inserir.map(i => ({
    comanda_id: comandaId, empresa_id: empresaId, tipo: i.tipo, descricao: i.descricao,
    servico_id: i.servico_id ?? null, produto_id: i.produto_id ?? null, pacote_id: i.pacote_id ?? null,
    profissional_id: i.profissional_id ?? null, quantidade: i.quantidade, valor_unit: i.valor,
  })));
  if (error) { setErro(mensagemErroBanco(error, 'salvar os itens da comanda')); setFechando(false); return; }
}
```

Remova `conferirDeleteVazio('comanda_itens', …)` (continua em uso para `pagamentos`; ajuste o tipo do parâmetro para só `'pagamentos'` se ficar único).
4. Na UI do item, quando `emEdicao && item.comissao_paga`: o `<select>` de profissional fica `disabled`, a lixeira não aparece, e mostre abaixo `<p className="text-[11px] text-text-3 mt-1">Comissão já paga — profissional e remoção travadas</p>`. O valor continua editável.

- [ ] **Step 5: Verificar e commitar**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: verde, incluindo `comanda-b-paridade.test.ts` e os testes da A (`comanda-a-paridade.test.ts` — se algum teste da A procurava o padrão antigo de apagar itens, atualize-o para o novo comportamento e explique no commit).

```bash
git add "web/app/(app)/comanda/page.tsx" web/tests/unit/comanda-b-paridade.test.ts web/tests/unit/comanda-a-paridade.test.ts
git commit -F - <<'EOF'
feat(comanda/web): cartao por comanda, reabrir so-extras e edicao por diferenca

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: App — escolher o dia (semana, mês, backlog)

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`
- Test: `web/tests/unit/comanda-b-paridade.test.ts` (acrescentar bloco do app)

**Interfaces:**
- Consumes: `carregarBacklogComandas` (Task 2).
- Produces: estado `dataComanda: Date` no app (usado pelas Tasks 6 e 7); `carregarDia` passa a depender de `dataComanda`.

- [ ] **Step 1: Teste de varredura**

Acrescente em `comanda-b-paridade.test.ts`:

```ts
const app = readFileSync(join(raiz, 'mobile/app/(empresa)/nova-comanda.tsx'), 'utf8');
describe('Comanda B — app: dias', () => {
  it('navega por dia/semana/mês e mostra backlog de shared', () => {
    expect(app).toContain('carregarBacklogComandas(');
    expect(app).toMatch(/startOfWeek\([^)]*weekStartsOn: 0/);
    expect(app).toContain('startOfDay(dataComanda)');
    expect(app).not.toMatch(/const hoje = new Date\(\);\s*await Promise\.all/);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implementar (espelhando o web, `web/app/(app)/comanda/page.tsx` linhas de `navDia`/`navMes`/`selecionarDia`, `fetchMes`, `fetchBacklog` e o cabeçalho de semana/mês)**

1. Estados: `dataComanda` (`new Date()`), `view: 'semana' | 'mes'`, `semana: Date[]` (7 dias a partir de `startOfWeek(hoje, { weekStartsOn: 0 })`), `agsMes: Map<string, number>`, `backlog: { id: string; data: Date }[]`.
2. `carregarDia` usa `startOfDay(dataComanda)`/`endOfDay(dataComanda)` e entra `dataComanda` nas dependências. Ao trocar de dia, feche a comanda aberta na tela (`setClienteSel(null)`, `setEtapa('lista')`).
3. Copie `navDia`, `navMes`, `selecionarDia` do web (mesmo código, `weekStartsOn: 0`).
4. `fetchMes` igual ao web (contagem por dia `yyyy-MM-dd`, sem cancelado/faltou), só quando `view === 'mes'`.
5. Backlog: `carregarBacklogComandas(supabase, empresaId, new Date().toISOString())` ao montar e depois de fechar/editar comanda; erro → lista vazia.
6. UI (no topo da etapa `lista`, estilos do próprio arquivo: `C`, fontes PlusJakartaSans, cartões com `borderRadius` 14):
   - Linha com `‹` / rótulo do dia (`format(dataComanda, "EEE, d 'de' MMM", { locale: ptBR })`) / `›`, botão "Hoje" quando não for hoje, e alternador "Semana | Mês".
   - Semana: 7 botões (`DIAS` abreviados + número), dia selecionado com `C.primary`.
   - Mês: grade 7 colunas do mês de `dataComanda`, número do dia + pontinho/contagem de `agsMes`; toque chama `selecionarDia`. Setas do cabeçalho chamam `navMes` nesse modo.
   - Aviso de backlog (só se houver item com dia anterior a hoje): cartão `C.roseSoft`/`C.rose`, texto `N dia(s) com comanda aberta`, toque → `selecionarDia(backlog[0].data)`. Mesmo texto do banner do web (copie do web).
   - Título da lista: "Hoje" ou a data selecionada; vazio: "Nenhum atendimento hoje" / "Nenhum atendimento neste dia".
7. `proximoClienteAberto` usa `agora` real (sem mudança) — em dia futuro não haverá próximo, como no web.

- [ ] **Step 3: Verificar e commitar**

Run: `cd web && npx vitest run && npx tsc --noEmit && cd ../mobile && npx tsc --noEmit`
Expected: verde; mobile só os 6 erros pré-existentes.

```bash
git add "mobile/app/(empresa)/nova-comanda.tsx" web/tests/unit/comanda-b-paridade.test.ts
git commit -F - <<'EOF'
feat(comanda/app): escolher o dia (semana, mes e comandas abertas de dias anteriores)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: App — itens (tirar atendimento, profissional, valor, quantidade) e recibo por WhatsApp

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`
- Test: `web/tests/unit/comanda-b-paridade.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `parseValorBR` (`@shared/comanda-fechamento`), `gerarTextoRecibo`, `linkWhatsAppRecibo` (Task 2), `dataComanda` (Task 5).
- Produces: estado `membros: { id: string; nome: string }[]` e funções `atualizarValor(uid, texto)`, `atualizarQtd(uid, delta)`, `atualizarProfissional(uid, profId)` (usadas na Task 7).

- [ ] **Step 1: Teste de varredura**

```ts
describe('Comanda B — app: itens e recibo', () => {
  it('profissional no extra, valor por parseValorBR, recibo de shared', () => {
    expect(app).toContain("from '@shared/comanda-recibo'");
    expect(app).toContain('linkWhatsAppRecibo(');
    expect(app).toContain('Linking.openURL(');
    expect(app).toContain('function atualizarProfissional(');
    expect(app).toMatch(/function atualizarValor\([^)]*\)[^{]*\{[^}]*parseValorBR\(/);
    expect(app).not.toMatch(/item\.tipo !== 'agendamento' && \(\s*<TouchableOpacity onPress=\{\(\) => removerItem/);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implementar**

1. **Membros:** no `Promise.all` de `carregarDia`, acrescente
`supabase.from('empresa_membros').select('user_id, users:users!empresa_membros_user_id_fkey(nome)').eq('empresa_id', empresaId).eq('ativo', true)`
(confira no web, `page.tsx` ~linha 321, os filtros exatos usados e copie-os) → `setMembros(rows.map(m => ({ id: m.user_id, nome: m.users?.nome ?? 'Profissional' })))`.
2. **Funções** (iguais ao web):

```ts
function atualizarValor(u: string, texto: string) {
  const v = parseValorBR(texto);
  setItens(prev => prev.map(i => i.uid === u ? { ...i, valor: v } : i));
}
function atualizarQtd(u: string, delta: number) {
  setItens(prev => prev.map(i => i.uid === u ? { ...i, quantidade: Math.max(1, i.quantidade + delta) } : i));
}
function atualizarProfissional(u: string, profId: string) {
  const m = membros.find(x => x.id === profId);
  setItens(prev => prev.map(i => i.uid === u ? { ...i, profissional_id: profId || undefined, profissional: m?.nome } : i));
}
```

3. **Tirar atendimento:** a lixeira passa a aparecer também em `tipo === 'agendamento'` (fechamento novo). Ao remover um atendimento, remova TODAS as linhas com o mesmo `agendamento_id` e limpe `pacoteLinks[agendamento_id]` (o web faz o mesmo em `removerItem` — copie a lógica de lá). Confirmação com `Alert.alert('Tirar da comanda', 'O agendamento continua aberto.', [Cancelar, Tirar])`.
4. **Valor:** substitua o `<Text>` do valor do item por `TextInput` (`keyboardType="decimal-pad"`, `defaultValue={item.valor.toFixed(2).replace('.', ',')}`, `key={`${item.uid}-${item.valor}`}`, `onEndEditing={e => atualizarValor(item.uid, e.nativeEvent.text)}`), `editable={false}` quando o atendimento estiver coberto por pacote (`!!pacoteLinks[item.agendamento_id]`). Mostre o total da linha (`formatarMoeda(item.valor * item.quantidade)`) abaixo quando `quantidade > 1`.
5. **Quantidade:** para `servico`/`produto`/`pacote`, botões `−` `N` `+` chamando `atualizarQtd`.
6. **Profissional no extra:** para `tipo === 'servico'`, chips horizontais (`ScrollView horizontal`) com "Sem profissional" + cada membro; o selecionado com `C.primarySoft`/`C.primary`. Chama `atualizarProfissional`.
7. **Gravação:** confira que o INSERT de `comanda_itens` em `fecharComanda` já envia `profissional_id: i.profissional_id ?? null` e `quantidade`; se não enviar, acrescente.
8. **Recibo:** `sucessoData` ganha `itens`, `dataIso`. Na tela de sucesso, quando `sucessoData.telefone`, botão "Enviar recibo por WhatsApp" (verde `#16A34A`, ícone `MessageCircle` do `lucide-react-native` se já usado no projeto; senão `Send`) que monta `gerarTextoRecibo({...})` com `splits` numéricos e chama `Linking.openURL(linkWhatsAppRecibo(sucessoData.telefone, texto))`, com `.catch(() => Alert.alert('WhatsApp', 'Não foi possível abrir o WhatsApp.'))`.

- [ ] **Step 3: Verificar e commitar**

Run: `cd web && npx vitest run && npx tsc --noEmit && cd ../mobile && npx tsc --noEmit`

```bash
git add "mobile/app/(empresa)/nova-comanda.tsx" web/tests/unit/comanda-b-paridade.test.ts
git commit -F - <<'EOF'
feat(comanda/app): tirar atendimento, profissional no extra, valor, quantidade e recibo por WhatsApp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: App — cartões por comanda e editar comanda fechada

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`
- Test: `web/tests/unit/comanda-b-paridade.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `cartoesComandaDoDia`, `carregarComandasSoExtrasDoDia`, `diffItensComanda`, `carregarComissoesPagasDosItens` (Task 2); `montarPagamentos` com `taxaGravada`/`criadoEm` (`@shared/comanda-fechamento`, já existente); `membros`, `atualizarValor`, `atualizarProfissional` (Task 6); `dataComanda` (Task 5).

- [ ] **Step 1: Teste de varredura**

```ts
describe('Comanda B — app: editar comanda fechada', () => {
  it('cartões por comanda, edição por diff, permissão de editar fechada', () => {
    expect(app).toContain('cartoesComandaDoDia(');
    expect(app).toContain('carregarComandasSoExtrasDoDia(');
    expect(app).toContain('diffItensComanda(');
    expect(app).toContain('carregarComissoesPagasDosItens(');
    expect(app).toContain("pode('comanda.editar_fechada')");
    expect(app).toMatch(/async function editarComanda\(/);
    expect(app).toMatch(/taxaGravada/);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implementar, copiando do web (`web/app/(app)/comanda/page.tsx`: `abrirComandaFechada`, `editarComanda`, travas de edição) e adaptando a UI RN**

1. `ClienteComanda` ganha `chave` e `comandaId`; `clientesDia` vira `cartoesComandaDoDia(agDia, soExtrasDia)` como no web (Task 4, Step 2.1) e `carregarDia` carrega `soExtrasDia` com `limitesDias(chaveDiaExibido(dataComanda), chaveDiaExibido(dataComanda))`.
2. `const podeEditarFechada = pode('comanda.editar_fechada');`. Na lista, cartão com `comandaId` aparece com ✓ e "Editar" (ou "Comanda fechada" sem ação se `!podeEditarFechada` ou `temAtendimentoDeOutra`).
3. Estados: `comandaExistenteId: string | null`, `itensOriginais: ItemComandaOriginal[]`. `ComandaItem` ganha `item_id?`, `comissao_paga?`. `Split` ganha `taxaGravada?`, `metodoGravado?`, `parcelasGravadas?`, `criadoEm?`.
4. `abrirComandaFechada(cliente)`: mesma sequência do web — itens dos atendimentos da comanda (`ag.comanda_id === cliente.comandaId`), `Promise.all` de `comandas` (desconto, desconto_reserva), `comanda_itens` (`id,tipo,descricao,servico_id,produto_id,pacote_id,profissional_id,quantidade,valor_unit`, `.order('created_at')`), `pagamentos` (`metodo,valor,bandeira,parcelas,taxa_perc,created_at`, `.order('created_at')`); erro em qualquer um → `Alert` com `mensagemErroBanco(err, 'abrir a comanda')` e volta à lista. Desconto reabre em R$ (`descontoModo = 'valor'`, valor = `desconto - desconto_reserva`). Splits reabertos com `taxaGravada`/`metodoGravado`/`parcelasGravadas`/`criadoEm`. `comissao_paga` via `carregarComissoesPagasDosItens`. Pacote links semeados do banco (só exibição).
5. Travas na edição (`comandaExistenteId !== null`), iguais ao web: produtos e pacotes com valor só leitura, quantidade travada em todos, sem adicionar pacote/vincular/desvincular/vender pacote, sem tirar atendimento; serviço extra com `comissao_paga` → chips de profissional desabilitados, sem lixeira, aviso "Comissão já paga — profissional e remoção travadas". Adicionar serviço/produto extra continua permitido (igual ao web — confira no web se adicionar produto é permitido em edição e espelhe exatamente).
6. `editarComanda(comandaId)`: mesma ordem do web — (1) UPDATE `comandas` (`valor_total`, `desconto`, `desconto_reserva`) com `.select('id')` e contagem; (2) `persistirValoresAgendamento()` (sem `extraUpdate`); (3) itens por `diffItensComanda` (mesmo código do web, Task 4 Step 4.3); (4) apagar pagamentos (`.delete().eq('comanda_id', id).select('id')`) e conferir que não sobrou nenhum (`select('id').eq('comanda_id', id)` vazio, igual ao `conferirDeleteVazio` do web), depois inserir `montarPagamentos(splitsNumericos, { empresaId, comandaId, taxas, total })`. Falha em qualquer etapa → `falharFechamento(etapa, erro)` existente. Sucesso → tela de sucesso (com recibo) e `invalidarFinanceiro()` como no fechamento.
7. O botão principal mostra "Salvar alterações" em edição e chama `editarComanda`; habilitado pela mesma regra do web (`resumo.podeFechar`, itens > 0).

- [ ] **Step 3: Verificar e commitar**

Run: `cd web && npx vitest run && npx tsc --noEmit && cd ../mobile && npx tsc --noEmit`

```bash
git add "mobile/app/(empresa)/nova-comanda.tsx" web/tests/unit/comanda-b-paridade.test.ts
git commit -F - <<'EOF'
feat(comanda/app): cartao por comanda e editar comanda fechada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Auditoria e PR

**Files:**
- Modify: `CLAUDE.md` (nova sessão antes de `## ✅ ESCOPO COMPLETO`)

- [ ] **Step 1:** Verificação completa: `cd web && npx tsc --noEmit && npx vitest run`; `cd mobile && npx tsc --noEmit` (6 erros pré-existentes).
- [ ] **Step 2:** Entrada "Sessão 2026-10-08 — Paridade Comanda B (recursos no app + comissão de serviço extra)" no mesmo formato das anteriores: escopo, tabela de critérios, score, decisões do dono (as 3 da spec), bugs corrigidos, pendência "aplicar 085 no SQL Editor (https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new), ordem livre", registrados não corrigidos.
- [ ] **Step 3:** Commit `docs: auditoria da comanda B`, `gh auth switch --user ruan-lopes16`, `git push -u origin feat/paridade-comanda-b`, `gh pr create` (corpo com resumo, 085 e testes pós-deploy, terminando com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). Não mergear.
