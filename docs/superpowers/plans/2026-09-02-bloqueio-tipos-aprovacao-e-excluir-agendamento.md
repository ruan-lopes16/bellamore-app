# Bloqueio de agenda (tipos + motivo + aprovação) & excluir agendamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar dois tipos de bloqueio de agenda (de um profissional / geral) com motivo obrigatório, restringir o "geral" a dona/gestora, exigir aprovação da gestão para bloqueio pedido por profissional (com aviso no sino + lista de pendentes), registrar o tipo de contrato da profissional, e permitir que dona/gestora exclua de vez um agendamento lançado/cancelado por engano — tudo no app web e no app nativo.

**Architecture:** 4 migrations aditivas (`066`–`069`): policy de DELETE de `agendamentos`, coluna `tipo_contrato` em `empresa_membros`, colunas de tipo/motivo/aprovação + reescrita das 4 RLS de `agenda_bloqueios`, e um trigger `SECURITY DEFINER` que grava `notificacoes` nos 3 eventos do fluxo de aprovação. Toda a lógica de decisão (quem pode que tipo, status inicial, montagem do insert, quando pode excluir) vive em funções puras testáveis em `shared/bloqueios.ts` e `shared/agendamentos.ts`, consumidas por web e nativo. A UI segue os padrões já existentes (modais, `ConfirmDialog`, chips de status, `useQuery`). Sem Supabase Realtime: a lista de pendentes recarrega a cada 30s com a tela aberta; a notificação no sino é imediata.

**Tech Stack:** Next.js 15 App Router (TypeScript), Supabase (PostgreSQL + RLS + triggers), React Native/Expo + `@tanstack/react-query` (mobile), Vitest, date-fns, Tailwind CSS, lucide-react / lucide-react-native.

## Global Constraints

- **Português** em toda copy visível ao usuário, comentários de código e mensagens de commit.
- **TypeScript web:** `cd web && npx tsc --noEmit` DEVE terminar com **zero erros** ao fim de cada task que toca `web/` ou `shared/`.
- **TypeScript mobile:** `cd mobile && npx tsc --noEmit` — capturar a baseline de erros pré-existentes ANTES de começar (auditorias anteriores registram ~10). **Nenhum erro novo** ao fim de cada task que toca `mobile/`.
- **Testes:** `cd web && npm test` (Vitest) DEVE passar 100% ao fim de cada task que toca `web/` ou `shared/`.
- **Migrations:** arquivo em `supabase/migrations/NNN_descricao.sql`, `NNN` sequencial. Último aplicado/versionado é `065`; este plano usa **`066`–`069`**. Idempotentes (`if not exists`, `drop policy if exists` antes de `create`). 100% aditivas — nenhuma coluna/policy/trigger/índice existente é removido ou alterado em semântica (só a reescrita deliberada das 4 policies de `agenda_bloqueios`, documentada).
- **`.select()` obrigatório** depois de todo `.insert()` / `.update()` / `.delete()` nas tabelas tocadas, com tratamento de erro **visível** — um miss de RLS não pode "dar sucesso" mudo (lição de `marcarReservaPaga`). Para `.delete()`/`.update()` restritos por papel, checar linhas afetadas (`data.length === 0` → toast de permissão).
- **Guarda de papel no cliente:** o tipo "geral" e a lista de pendentes só renderizam para `owner`/`gestor`; a ação "Excluir agendamento" só para `owner`/`gestor`. Nunca renderizar o controle desabilitado "fantasma" para profissional — não renderizar.
- **Imports compartilhados** usam o alias `@shared/...` (web: `vitest.config.ts` + `tsconfig`; mobile: `tsconfig` `paths`). Já configurado nos dois.
- **Fuso:** formatação de data/hora nas notificações do trigger usa `America/Sao_Paulo` (coluna é `timestamptz`).
- **Não-quebra confirmada na spec (seção 9):** único consumidor de `agenda_bloqueios` é `web/app/(app)/agenda/page.tsx`; `agendamentos` não tem `DELETE` pelo cliente hoje; linhas antigas de bloqueio ficam `situacao='aprovado'` e seguem visíveis a todos.

## File Structure

### Novos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/066_agendamentos_delete_gestor_owner.sql` | policy de `DELETE` de `agendamentos` restrita a gestor/owner |
| `supabase/migrations/067_empresa_membros_tipo_contrato.sql` | coluna `tipo_contrato` (`pj`/`clt`, nullable) |
| `supabase/migrations/068_agenda_bloqueios_tipos_motivo_aprovacao.sql` | colunas `escopo`/`motivo`/`situacao`/`criado_por`/`revisado_por`/`revisado_em` + backfill + reescrita das 4 policies + índice de pendentes |
| `supabase/migrations/069_agenda_bloqueios_notificacoes_trigger.sql` | função + trigger `SECURITY DEFINER` que grava `notificacoes` (pendente/aprovado/recusado) |
| `shared/agendamentos.ts` | `podeExcluirAgendamento`, `motivoExclusaoBloqueada`, `STATUS_NAO_EXCLUIVEL` |
| `shared/bloqueios.ts` | tipos de domínio, `MOTIVOS_BLOQUEIO`, `motivoBloqueioLabel`, `podeSelecionarEscopoGeral`, `situacaoInicialBloqueio`, `montarInsertBloqueio` |
| `web/tests/unit/agendamentos-exclusao.test.ts` | unit de `shared/agendamentos.ts` |
| `web/tests/unit/bloqueios.test.ts` | unit de `shared/bloqueios.ts` |
| `web/tests/unit/bloqueio-agendamento-migrations.test.ts` | asserts sobre o texto das migrations `066`–`069` |
| `web/tests/unit/agenda-bloqueio-aprovacao.test.ts` | asserts de fonte sobre `agenda/page.tsx` (usa os helpers, guarda de papel, sem `= any(minha_empresas())`) |
| `mobile/components/BloqueioModal.tsx` | modal RN de criar bloqueio (gestão: escopo + picker; profissional: travado em si) |
| `mobile/components/PendentesBloqueioSheet.tsx` | lista RN de bloqueios pendentes com Aprovar/Recusar (só `(empresa)`) |

### Modificados

| Arquivo | Mudança |
|---|---|
| `web/app/(app)/agenda/page.tsx` | carrega `meuRole`/`meuUserId`/lista completa de membros; `fetchDia` traz colunas novas; `NovoBloqueioModal` reescrito; pílula + modal de pendentes; `TimelineView` desenha pendente; `NovoAgModal` ganha "Excluir agendamento" |
| `web/app/(app)/equipe/page.tsx` | `EditInfoModal` ganha `<select>` "Tipo de contrato"; card mostra o valor; `select` da listagem traz `tipo_contrato` |
| `web/app/api/profissionais/route.ts` | `PATCH` aceita e grava `tipo_contrato` |
| `web/app/(app)/notificacoes/page.tsx` | rótulo/ícone dos 3 tipos novos (`bloqueio_pendente`/`_aprovado`/`_recusado`) |
| `mobile/hooks/useAgenda.ts` | `useBloqueiosDia`, `useBloqueiosPendentes`, `useCriarBloqueio`, `useAprovarBloqueio`, `useRecusarBloqueio` |
| `mobile/hooks/useProfissional.ts` | `useBloqueiosProfissionalDia`, `useCriarBloqueioProfissional` |
| `mobile/app/(empresa)/agenda.tsx` | botão "Bloquear" + `BloqueioModal` + pílula/sheet de pendentes + desenho de bloqueio na timeline |
| `mobile/app/(profissional)/agenda.tsx` | botão "Bloquear" + `BloqueioModal` (travado) + desenho do próprio bloqueio (pendente listrado) |
| `mobile/app/(empresa)/agendamento/[id].tsx` | botão "Excluir agendamento" (destrutivo, some em `concluído`) |

---

## Task 1: Migrations 066 + 067 (DELETE de agendamentos + tipo_contrato)

**Files:**
- Create: `supabase/migrations/066_agendamentos_delete_gestor_owner.sql`
- Create: `supabase/migrations/067_empresa_membros_tipo_contrato.sql`
- Create: `web/tests/unit/bloqueio-agendamento-migrations.test.ts`

**Interfaces:**
- Consumes: função `is_gestor_ou_owner(uuid)` (migration `003`), tabelas `public.agendamentos`, `public.empresa_membros`.
- Produces: coluna `public.empresa_membros.tipo_contrato text` com valores `'pj' | 'clt' | NULL` (contrato usado nas Tasks 4, 12); policy `"agendamentos: gestor ou owner exclui"` (usada na Task 6/7).

- [ ] **Step 1: Write the failing migration test**

Create `web/tests/unit/bloqueio-agendamento-migrations.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function readAllMigrations(): string {
  const dir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8').toLowerCase())
    .join('\n---\n');
}

describe('Migrations 066–069: bloqueio + excluir agendamento', () => {
  const sql = readAllMigrations();

  // ── 066 ──
  it('066: cria policy de DELETE de agendamentos restrita a gestor/owner', () => {
    expect(sql).toMatch(/create policy "agendamentos: gestor ou owner exclui"\s+on public\.agendamentos\s+for delete\s+using \(is_gestor_ou_owner\(empresa_id\)\)/);
  });

  // ── 067 ──
  it('067: adiciona empresa_membros.tipo_contrato nullable com check pj/clt', () => {
    expect(sql).toMatch(/alter table public\.empresa_membros\s+add column if not exists tipo_contrato text\s+check \(tipo_contrato in \('pj', 'clt'\)\)/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/bloqueio-agendamento-migrations.test.ts`
Expected: FAIL — nenhuma migration casa os padrões.

- [ ] **Step 3: Write migration 066**

Create `supabase/migrations/066_agendamentos_delete_gestor_owner.sql`:

```sql
-- ============================================================
-- MIGRATION 066 — agendamentos: policy de DELETE (gestor/owner)
--
-- Hoje NENHUMA policy de INSERT/UPDATE/DELETE de agendamentos está
-- versionada — só a de SELECT (001, reescrita na 042). As de escrita
-- foram criadas no painel do Supabase. Com RLS ligado (001) e sem
-- policy de DELETE, o cliente não apaga agendamento nenhum — estado
-- atual. Não existe nenhum .from('agendamentos').delete() no código.
--
-- Esta migration cria a policy de DELETE explícita e restrita a
-- gestor/owner (is_gestor_ou_owner, da 003). Só ABRE a ação nova
-- (Tasks 6 e 7); não altera nenhum fluxo existente.
--
-- ⚠️ Conferir no painel do Supabase se sobrou alguma policy de DELETE
--    em public.agendamentos com outro nome (policies permissivas se
--    somam com OR — não quebraria nada, só afrouxaria a trava).
-- ============================================================

alter table public.agendamentos enable row level security;

drop policy if exists "agendamentos: excluir"                on public.agendamentos;
drop policy if exists "agendamentos: gestor exclui"          on public.agendamentos;
drop policy if exists "agendamentos: membro exclui"          on public.agendamentos;
drop policy if exists "agendamentos: gestor ou owner exclui" on public.agendamentos;

create policy "agendamentos: gestor ou owner exclui"
  on public.agendamentos
  for delete
  using (is_gestor_ou_owner(empresa_id));
```

- [ ] **Step 4: Write migration 067**

Create `supabase/migrations/067_empresa_membros_tipo_contrato.sql`:

```sql
-- ============================================================
-- MIGRATION 067 — empresa_membros: tipo de contrato
--
-- Coluna opcional para registrar o vínculo do profissional:
--   'pj'  → "PJ / Comissionada"
--   'clt' → "CLT"
--   NULL  → não informado
--
-- Aditiva e nullable: linhas existentes ficam NULL, nada quebra. O
-- CHECK só rejeita valor não-nulo fora da lista. Sem policy nova:
-- empresa_membros já tem UPDATE restrito a gestor/owner (043); o
-- trigger bloquear_alteracao_role (043) só inspeciona
-- role/user_id/empresa_id e ignora esta coluna.
--
-- Hoje NÃO ramifica o fluxo de bloqueio (PJ e CLT caem os dois em
-- aprovação) — registro de cadastro para diferenciação futura.
-- ============================================================

alter table public.empresa_membros
  add column if not exists tipo_contrato text
    check (tipo_contrato in ('pj', 'clt'));

comment on column public.empresa_membros.tipo_contrato is
  'Vinculo: pj (PJ/Comissionada) | clt | NULL. Registro de cadastro; nao altera regras de bloqueio.';
```

- [ ] **Step 5: Run test to verify 066 + 067 pass**

Run: `cd web && npx vitest run tests/unit/bloqueio-agendamento-migrations.test.ts`
Expected: os 2 testes de 066/067 PASSAM (os de 068/069 ainda não existem no arquivo — só serão adicionados nas Tasks 2/3).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/066_agendamentos_delete_gestor_owner.sql supabase/migrations/067_empresa_membros_tipo_contrato.sql web/tests/unit/bloqueio-agendamento-migrations.test.ts
git commit -m "feat(db): policy de DELETE de agendamentos + empresa_membros.tipo_contrato"
```

---

## Task 2: Migration 068 (tipos/motivo/aprovação em agenda_bloqueios)

**Files:**
- Create: `supabase/migrations/068_agenda_bloqueios_tipos_motivo_aprovacao.sql`
- Modify: `web/tests/unit/bloqueio-agendamento-migrations.test.ts`

**Interfaces:**
- Consumes: `public.agenda_bloqueios` (migration `033`), `minha_empresas()` (001), `is_gestor_ou_owner(uuid)` (003).
- Produces: colunas `escopo ('profissional'|'geral')`, `motivo (folga|feriado|almoco|reuniao|manutencao|outro | NULL)`, `situacao ('aprovado'|'pendente')`, `criado_por uuid`, `revisado_por uuid`, `revisado_em timestamptz`; 4 policies renomeadas (`"bloqueios: ver"`, `"bloqueios: criar"`, `"bloqueios: aprovar"`, `"bloqueios: excluir"`). Contrato de colunas usado por todas as tasks de UI.

- [ ] **Step 1: Add failing assertions to the migration test**

In `web/tests/unit/bloqueio-agendamento-migrations.test.ts`, add inside the `describe`:

```typescript
  // ── 068 ──
  it('068: adiciona as colunas de tipo/motivo/aprovacao em agenda_bloqueios', () => {
    expect(sql).toMatch(/add column if not exists escopo\s+text not null default 'profissional'\s+check \(escopo in \('profissional', 'geral'\)\)/);
    expect(sql).toMatch(/add column if not exists motivo\s+text\s+check \(motivo in \('folga', 'feriado', 'almoco', 'reuniao', 'manutencao', 'outro'\)\)/);
    expect(sql).toMatch(/add column if not exists situacao\s+text not null default 'aprovado'\s+check \(situacao in \('aprovado', 'pendente'\)\)/);
    expect(sql).toContain('add column if not exists criado_por');
    expect(sql).toContain('add column if not exists revisado_por');
    expect(sql).toContain('add column if not exists revisado_em');
  });

  it('068: backfill de escopo geral para linhas antigas sem profissional', () => {
    expect(sql).toMatch(/update public\.agenda_bloqueios set escopo = 'geral' where profissional_id is null/);
  });

  it('068: reescreve as 4 policies usando IN (SELECT minha_empresas()), nunca = ANY', () => {
    // Ler SÓ o arquivo 068 (a migration 033 ainda contém a forma antiga
    // `= any(...)` no seu próprio texto e não deve ser tocada).
    const m068 = readFileSync(
      join(process.cwd(), '..', 'supabase', 'migrations', '068_agenda_bloqueios_tipos_motivo_aprovacao.sql'),
      'utf8',
    ).toLowerCase();
    expect(m068).not.toContain('= any(minha_empresas())');
    expect(m068).toContain('in (select minha_empresas())');
    for (const p of ['"bloqueios: ver"', '"bloqueios: criar"', '"bloqueios: aprovar"', '"bloqueios: excluir"']) {
      expect(m068).toContain(p);
    }
    expect(m068).toMatch(/for insert with check \([\s\S]*?escopo\s*=\s*'profissional'[\s\S]*?profissional_id\s*=\s*auth\.uid\(\)[\s\S]*?criado_por\s*=\s*auth\.uid\(\)[\s\S]*?situacao\s*=\s*'pendente'[\s\S]*?motivo is not null/);
  });

  it('068: index de pendentes', () => {
    expect(sql).toMatch(/create index if not exists idx_bloqueios_pendentes\s+on public\.agenda_bloqueios \(empresa_id, situacao, data_inicio\)/);
  });
```

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `cd web && npx vitest run tests/unit/bloqueio-agendamento-migrations.test.ts`
Expected: os 4 testes novos de 068 FALHAM; 066/067 seguem passando.

- [ ] **Step 3: Write migration 068**

Create `supabase/migrations/068_agenda_bloqueios_tipos_motivo_aprovacao.sql`:

```sql
-- ============================================================
-- MIGRATION 068 — agenda_bloqueios: tipos, motivo e aprovacao
--
-- 1. Colunas novas (aditivas; o codigo atual segue inserindo sem
--    elas gracas aos defaults / nullability):
--      escopo       'profissional' | 'geral'  (default 'profissional')
--      motivo       folga|feriado|almoco|reuniao|manutencao|outro
--                   (nullable; obrigatorio so na aplicacao)
--      situacao     'aprovado' | 'pendente'   (default 'aprovado')
--      criado_por   users(id)  — quem criou/pediu
--      revisado_por users(id)  — quem aprovou
--      revisado_em  timestamptz
--
-- 2. Backfill: linhas antigas viram escopo='geral' quando
--    profissional_id IS NULL; as demais pegam o default. Todas ficam
--    situacao='aprovado' (default) -> seguem visiveis a todos.
--
-- 3. Reescrita das 4 policies. A 033 usa `empresa_id = ANY(minha_empresas())`
--    — forma incorreta p/ funcao SETOF (ver feat/bloqueio-aniversario).
--    Troca para `IN (SELECT minha_empresas())`. A novidade e a regra
--    de papel/situacao; o recorte por empresa fica igual ou melhor.
--
-- IMPACTO no unico consumidor (web .../agenda/page.tsx):
--   • SELECT — linhas atuais sao 'aprovado' -> seguem visiveis a todo
--     membro. Sem mudanca.
--   • INSERT de gestor/owner (modal atual) — passa por is_gestor_ou_owner;
--     defaults preenchem o resto. Sem regressao.
--   • INSERT de profissional pelo modal antigo — passa a ser negado
--     (falta criado_por/situacao/motivo). E a trava pedida; migration
--     e frontend sobem no mesmo PR.
--   • Hoje o codigo so faz INSERT e DELETE em agenda_bloqueios. Apos a
--     migration, profissional so apaga o PROPRIO bloqueio pendente; o
--     botao "X" da Timeline e ajustado no mesmo PR. Nenhum dado e perdido.
--
-- ⚠️ Conferir no painel se ha policies extras com outros nomes.
-- ============================================================

alter table public.agenda_bloqueios
  add column if not exists escopo       text not null default 'profissional'
    check (escopo in ('profissional', 'geral')),
  add column if not exists motivo       text
    check (motivo in ('folga', 'feriado', 'almoco', 'reuniao', 'manutencao', 'outro')),
  add column if not exists situacao     text not null default 'aprovado'
    check (situacao in ('aprovado', 'pendente')),
  add column if not exists criado_por   uuid references public.users(id) on delete set null,
  add column if not exists revisado_por uuid references public.users(id) on delete set null,
  add column if not exists revisado_em  timestamptz;

-- Backfill: bloqueios gerais antigos tinham profissional_id NULL
update public.agenda_bloqueios set escopo = 'geral' where profissional_id is null;

-- ── RLS reescrita (empresa_id IN (SELECT minha_empresas())) ──
drop policy if exists "bloqueios_select" on public.agenda_bloqueios;
drop policy if exists "bloqueios_insert" on public.agenda_bloqueios;
drop policy if exists "bloqueios_update" on public.agenda_bloqueios;
drop policy if exists "bloqueios_delete" on public.agenda_bloqueios;

create policy "bloqueios: ver" on public.agenda_bloqueios
  for select using (
    empresa_id in (select minha_empresas())
    and (
      situacao = 'aprovado'
      or criado_por = auth.uid()
      or is_gestor_ou_owner(empresa_id)
    )
  );

create policy "bloqueios: criar" on public.agenda_bloqueios
  for insert with check (
    empresa_id in (select minha_empresas())
    and (
      is_gestor_ou_owner(empresa_id)
      or (
        escopo        = 'profissional'
        and profissional_id = auth.uid()
        and criado_por      = auth.uid()
        and situacao        = 'pendente'
        and motivo is not null
      )
    )
  );

create policy "bloqueios: aprovar" on public.agenda_bloqueios
  for update using      (is_gestor_ou_owner(empresa_id))
             with check (is_gestor_ou_owner(empresa_id));

create policy "bloqueios: excluir" on public.agenda_bloqueios
  for delete using (
    is_gestor_ou_owner(empresa_id)
    or (criado_por = auth.uid() and situacao = 'pendente')
  );

create index if not exists idx_bloqueios_pendentes
  on public.agenda_bloqueios (empresa_id, situacao, data_inicio);
```

- [ ] **Step 4: Run test to verify 068 passes**

Run: `cd web && npx vitest run tests/unit/bloqueio-agendamento-migrations.test.ts`
Expected: todos os testes de 066/067/068 PASSAM.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/068_agenda_bloqueios_tipos_motivo_aprovacao.sql web/tests/unit/bloqueio-agendamento-migrations.test.ts
git commit -m "feat(db): tipos, motivo e aprovacao em agenda_bloqueios + RLS reescrita"
```

---

## Task 3: Migration 069 (trigger de notificações de bloqueio)

**Files:**
- Create: `supabase/migrations/069_agenda_bloqueios_notificacoes_trigger.sql`
- Modify: `web/tests/unit/bloqueio-agendamento-migrations.test.ts`

**Interfaces:**
- Consumes: `public.agenda_bloqueios` (colunas da Task 2), `public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)` (001), `public.empresa_membros`, `public.empresas.owner_id`, `public.users.nome`, `auth.uid()`.
- Produces: trigger `trg_notificar_bloqueio` e função `public.notificar_bloqueio()`. Tipos de `notificacoes` gerados: `'bloqueio_pendente'`, `'bloqueio_aprovado'`, `'bloqueio_recusado'` (usados na Task 13).

- [ ] **Step 1: Add failing assertions**

In `web/tests/unit/bloqueio-agendamento-migrations.test.ts`, add:

```typescript
  // ── 069 ──
  it('069: funcao notificar_bloqueio security definer + trigger after ins/upd/del', () => {
    expect(sql).toMatch(/create or replace function public\.notificar_bloqueio\(\)[\s\S]*?security definer/);
    expect(sql).toMatch(/create trigger trg_notificar_bloqueio\s+after insert or update or delete on public\.agenda_bloqueios/);
  });

  it('069: gera bloqueio_pendente para gestor + owner (dedupe, sem o autor)', () => {
    expect(sql).toContain("'bloqueio_pendente'");
    expect(sql).toMatch(/role = 'gestor'/);
    expect(sql).toMatch(/select e\.owner_id/);
    expect(sql).toMatch(/u\.uid <> new\.criado_por/);
  });

  it('069: bloqueio_aprovado no update pendente->aprovado e bloqueio_recusado so por terceiro', () => {
    expect(sql).toMatch(/old\.situacao = 'pendente' and new\.situacao = 'aprovado'/);
    expect(sql).toContain("'bloqueio_aprovado'");
    expect(sql).toMatch(/old\.situacao = 'pendente'[\s\S]*?old\.criado_por <> auth\.uid\(\)/);
    expect(sql).toContain("'bloqueio_recusado'");
  });

  it('069: formata data no fuso America/Sao_Paulo', () => {
    expect(sql).toContain("at time zone 'america/sao_paulo'");
  });
```

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `cd web && npx vitest run tests/unit/bloqueio-agendamento-migrations.test.ts`
Expected: os 4 testes novos de 069 FALHAM.

- [ ] **Step 3: Write migration 069**

Create `supabase/migrations/069_agenda_bloqueios_notificacoes_trigger.sql`:

```sql
-- ============================================================
-- MIGRATION 069 — agenda_bloqueios: notificacoes de aprovacao
--
-- Trigger SECURITY DEFINER (padrao da 028) que grava em
-- public.notificacoes nos 3 eventos do fluxo:
--   • profissional cria pedido (INSERT, situacao='pendente')
--       -> 'bloqueio_pendente' p/ cada gestor ativo + owner (dedupe)
--   • gestor/owner aprova (UPDATE pendente -> aprovado)
--       -> 'bloqueio_aprovado' p/ criado_por
--   • gestor/owner recusa (DELETE de pendente por TERCEIRO)
--       -> 'bloqueio_recusado' p/ criado_por
-- Demais casos -> sem notificacao.
--
-- notificacoes nao tem policy de INSERT — insercao so via trigger
-- SECURITY DEFINER (igual 028). Tudo defensivo: criado_por NULL ->
-- nao faz nada e devolve a linha, NUNCA aborta a operacao.
-- ============================================================

create or replace function public.notificar_bloqueio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_autor_nome text;
  v_quando     text;
  v_motivo     text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_quando := to_char(NEW.data_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  else
    v_quando := to_char(OLD.data_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;

  -- 1. Pedido novo -> avisa a gestao
  if tg_op = 'INSERT' and NEW.situacao = 'pendente' and NEW.criado_por is not null then
    select nome into v_autor_nome from public.users where id = NEW.criado_por;
    v_motivo := coalesce(nullif(NEW.motivo, ''), 'sem motivo');

    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    select u.uid, NEW.empresa_id, 'bloqueio_pendente',
           'Bloqueio aguardando aprovacao',
           coalesce(split_part(v_autor_nome, ' ', 1), 'Profissional')
             || ' pediu bloqueio em ' || v_quando || ' (' || v_motivo || ')'
    from (
      select m.user_id as uid
        from public.empresa_membros m
       where m.empresa_id = NEW.empresa_id and m.ativo = true and m.role = 'gestor'
      union
      select e.owner_id
        from public.empresas e
       where e.id = NEW.empresa_id and e.owner_id is not null
    ) u
    where u.uid is not null and u.uid <> NEW.criado_por;

    return NEW;
  end if;

  -- 2. Aprovado -> avisa o autor
  if tg_op = 'UPDATE'
     and OLD.situacao = 'pendente' and NEW.situacao = 'aprovado'
     and NEW.criado_por is not null then
    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    values (NEW.criado_por, NEW.empresa_id, 'bloqueio_aprovado',
            'Bloqueio aprovado',
            'Seu bloqueio de ' || v_quando || ' foi aprovado.');
    return NEW;
  end if;

  -- 3. Recusado (delete de pendente por terceiro) -> avisa o autor
  if tg_op = 'DELETE'
     and OLD.situacao = 'pendente'
     and OLD.criado_por is not null
     and OLD.criado_por <> auth.uid() then
    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    values (OLD.criado_por, OLD.empresa_id, 'bloqueio_recusado',
            'Bloqueio recusado',
            'Seu bloqueio de ' || v_quando || ' foi recusado.');
    return OLD;
  end if;

  if tg_op = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notificar_bloqueio on public.agenda_bloqueios;
create trigger trg_notificar_bloqueio
  after insert or update or delete on public.agenda_bloqueios
  for each row execute function public.notificar_bloqueio();
```

- [ ] **Step 4: Run test to verify all migration assertions pass**

Run: `cd web && npx vitest run tests/unit/bloqueio-agendamento-migrations.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/069_agenda_bloqueios_notificacoes_trigger.sql web/tests/unit/bloqueio-agendamento-migrations.test.ts
git commit -m "feat(db): trigger de notificacoes de bloqueio (pendente/aprovado/recusado)"
```

---

## Task 4: `shared/agendamentos.ts` (regras de exclusão)

**Files:**
- Create: `shared/agendamentos.ts`
- Create: `web/tests/unit/agendamentos-exclusao.test.ts`

**Interfaces:**
- Produces:
  - `STATUS_NAO_EXCLUIVEL: readonly ['concluido']`
  - `podeExcluirAgendamento(status: string, role: string): boolean`
  - `motivoExclusaoBloqueada(status: string): string | null`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/agendamentos-exclusao.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  podeExcluirAgendamento, motivoExclusaoBloqueada, STATUS_NAO_EXCLUIVEL,
} from '@shared/agendamentos';

describe('podeExcluirAgendamento', () => {
  it('permite owner/gestor em status nao-concluido', () => {
    for (const role of ['owner', 'gestor']) {
      for (const st of ['agendado', 'confirmado', 'cancelado', 'faltou']) {
        expect(podeExcluirAgendamento(st, role)).toBe(true);
      }
    }
  });

  it('nunca permite status concluido, mesmo para owner', () => {
    expect(podeExcluirAgendamento('concluido', 'owner')).toBe(false);
    expect(podeExcluirAgendamento('concluido', 'gestor')).toBe(false);
  });

  it('nunca permite profissional, seja qual for o status', () => {
    for (const st of ['agendado', 'confirmado', 'cancelado', 'faltou', 'concluido']) {
      expect(podeExcluirAgendamento(st, 'profissional')).toBe(false);
    }
  });

  it('role desconhecido nao pode', () => {
    expect(podeExcluirAgendamento('cancelado', 'cliente')).toBe(false);
    expect(podeExcluirAgendamento('cancelado', '')).toBe(false);
  });
});

describe('motivoExclusaoBloqueada', () => {
  it('explica o bloqueio para concluido', () => {
    expect(motivoExclusaoBloqueada('concluido')).toMatch(/conclu[ií]do/i);
  });
  it('retorna null para status excluiveis', () => {
    expect(motivoExclusaoBloqueada('cancelado')).toBeNull();
    expect(motivoExclusaoBloqueada('agendado')).toBeNull();
  });
});

describe('STATUS_NAO_EXCLUIVEL', () => {
  it('contem apenas concluido', () => {
    expect([...STATUS_NAO_EXCLUIVEL]).toEqual(['concluido']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/agendamentos-exclusao.test.ts`
Expected: FAIL — módulo `@shared/agendamentos` não existe.

- [ ] **Step 3: Write the implementation**

Create `shared/agendamentos.ts`:

```typescript
/**
 * Regras de exclusão física de agendamentos.
 *
 * Um agendamento `concluido` tem comissão, uso de pacote e movimento
 * de estoque amarrados sem `ON DELETE CASCADE` — apagar dá erro de FK
 * e mexeria em faturamento. Fica sempre fora. Os demais status
 * (agendado/confirmado/cancelado/faltou) podem ser apagados por
 * dona/gestora quando foram lançados ou cancelados por engano; as
 * taxas de reserva/cancelamento vinculadas somem por cascata.
 */

/** Status cujo agendamento NÃO pode ser apagado (tem financeiro vinculado). */
export const STATUS_NAO_EXCLUIVEL = ['concluido'] as const;

/** true se este papel pode apagar de vez um agendamento neste status. */
export function podeExcluirAgendamento(status: string, role: string): boolean {
  const ehGestao = role === 'owner' || role === 'gestor';
  return ehGestao && !(STATUS_NAO_EXCLUIVEL as readonly string[]).includes(status);
}

/** Texto do porquê a exclusão está bloqueada por status, ou null se o status permite. */
export function motivoExclusaoBloqueada(status: string): string | null {
  if ((STATUS_NAO_EXCLUIVEL as readonly string[]).includes(status)) {
    return 'Atendimento concluído tem comissão e financeiro vinculados. Reverta o status antes de excluir.';
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run tests/unit/agendamentos-exclusao.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add shared/agendamentos.ts web/tests/unit/agendamentos-exclusao.test.ts
git commit -m "feat(shared): regras de exclusao de agendamento"
```

---

## Task 5: `shared/bloqueios.ts` (domínio + montagem do insert)

**Files:**
- Create: `shared/bloqueios.ts`
- Create: `web/tests/unit/bloqueios.test.ts`

**Interfaces:**
- Produces:
  - Types: `EscopoBloqueio = 'profissional' | 'geral'`, `SituacaoBloqueio = 'aprovado' | 'pendente'`, `MotivoBloqueio = 'folga'|'feriado'|'almoco'|'reuniao'|'manutencao'|'outro'`
  - `MOTIVOS_BLOQUEIO: { key: MotivoBloqueio; label: string }[]`
  - `motivoBloqueioLabel(motivo: string | null | undefined): string`
  - `podeSelecionarEscopoGeral(role: string): boolean`
  - `situacaoInicialBloqueio(role: string): SituacaoBloqueio`
  - `montarInsertBloqueio(input: MontarInsertBloqueioInput): BloqueioInsert` — ver shapes abaixo.

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/bloqueios.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  MOTIVOS_BLOQUEIO, motivoBloqueioLabel, podeSelecionarEscopoGeral,
  situacaoInicialBloqueio, montarInsertBloqueio,
} from '@shared/bloqueios';

const BASE = {
  meuUserId: 'u-prof',
  empresaId: 'e-1',
  motivo: 'folga' as const,
  titulo: '',
  dataInicio: '2026-09-03T14:00:00.000Z',
  dataFim: '2026-09-03T16:00:00.000Z',
};

describe('MOTIVOS_BLOQUEIO', () => {
  it('tem as 6 opcoes na ordem definida', () => {
    expect(MOTIVOS_BLOQUEIO.map((m) => m.key)).toEqual(
      ['folga', 'feriado', 'almoco', 'reuniao', 'manutencao', 'outro'],
    );
  });
});

describe('motivoBloqueioLabel', () => {
  it('traduz cada chave', () => {
    expect(motivoBloqueioLabel('almoco')).toBe('Almoço');
    expect(motivoBloqueioLabel('reuniao')).toBe('Reunião');
  });
  it('cai em travessão para nulo/desconhecido', () => {
    expect(motivoBloqueioLabel(null)).toBe('—');
    expect(motivoBloqueioLabel(undefined)).toBe('—');
    expect(motivoBloqueioLabel('xpto')).toBe('—');
  });
});

describe('podeSelecionarEscopoGeral', () => {
  it('so owner e gestor', () => {
    expect(podeSelecionarEscopoGeral('owner')).toBe(true);
    expect(podeSelecionarEscopoGeral('gestor')).toBe(true);
    expect(podeSelecionarEscopoGeral('profissional')).toBe(false);
    expect(podeSelecionarEscopoGeral('')).toBe(false);
  });
});

describe('situacaoInicialBloqueio', () => {
  it('gestao => aprovado, profissional => pendente', () => {
    expect(situacaoInicialBloqueio('owner')).toBe('aprovado');
    expect(situacaoInicialBloqueio('gestor')).toBe('aprovado');
    expect(situacaoInicialBloqueio('profissional')).toBe('pendente');
  });
});

describe('montarInsertBloqueio', () => {
  it('profissional: forca escopo=profissional, profissional_id=si, situacao=pendente — mesmo pedindo geral', () => {
    const ins = montarInsertBloqueio({
      ...BASE, role: 'profissional', escopo: 'geral', profissionalId: 'u-outra',
    });
    expect(ins.escopo).toBe('profissional');
    expect(ins.profissional_id).toBe('u-prof');
    expect(ins.situacao).toBe('pendente');
    expect(ins.criado_por).toBe('u-prof');
    expect(ins.empresa_id).toBe('e-1');
    expect(ins.motivo).toBe('folga');
  });

  it('gestor: escopo geral => profissional_id null, situacao aprovado', () => {
    const ins = montarInsertBloqueio({
      ...BASE, meuUserId: 'u-gestor', role: 'gestor', escopo: 'geral', profissionalId: 'u-x',
    });
    expect(ins.escopo).toBe('geral');
    expect(ins.profissional_id).toBeNull();
    expect(ins.situacao).toBe('aprovado');
    expect(ins.criado_por).toBe('u-gestor');
  });

  it('gestor: escopo profissional => usa o profissionalId escolhido', () => {
    const ins = montarInsertBloqueio({
      ...BASE, meuUserId: 'u-gestor', role: 'gestor', escopo: 'profissional', profissionalId: 'u-alvo',
    });
    expect(ins.escopo).toBe('profissional');
    expect(ins.profissional_id).toBe('u-alvo');
    expect(ins.situacao).toBe('aprovado');
  });

  it('titulo vazio cai no rotulo do motivo; com texto usa o texto (trim)', () => {
    expect(montarInsertBloqueio({ ...BASE, role: 'gestor', escopo: 'profissional', profissionalId: 'x' }).titulo).toBe('Folga');
    expect(montarInsertBloqueio({ ...BASE, role: 'gestor', escopo: 'profissional', profissionalId: 'x', titulo: '  Dentista  ' }).titulo).toBe('Dentista');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/bloqueios.test.ts`
Expected: FAIL — `@shared/bloqueios` não existe.

- [ ] **Step 3: Write the implementation**

Create `shared/bloqueios.ts`:

```typescript
/**
 * Domínio de bloqueios de agenda.
 *
 * Dois tipos: "de um profissional" (`escopo='profissional'`, com
 * `profissional_id`) e "geral" (`escopo='geral'`, agenda toda). O
 * tipo "geral" só é oferecido a dona/gestora. Bloqueio pedido por
 * profissional nasce `pendente` e só vale depois que dona/gestora
 * aprova. Estas funções puras concentram todas essas regras para web
 * e mobile usarem a mesma coisa.
 */

export type EscopoBloqueio    = 'profissional' | 'geral';
export type SituacaoBloqueio  = 'aprovado' | 'pendente';
export type MotivoBloqueio    =
  | 'folga' | 'feriado' | 'almoco' | 'reuniao' | 'manutencao' | 'outro';

export const MOTIVOS_BLOQUEIO: { key: MotivoBloqueio; label: string }[] = [
  { key: 'folga',      label: 'Folga' },
  { key: 'feriado',    label: 'Feriado' },
  { key: 'almoco',     label: 'Almoço' },
  { key: 'reuniao',    label: 'Reunião' },
  { key: 'manutencao', label: 'Manutenção' },
  { key: 'outro',      label: 'Outro' },
];

/** Rótulo em pt-BR de um motivo; travessão para nulo/desconhecido. */
export function motivoBloqueioLabel(motivo: string | null | undefined): string {
  const m = MOTIVOS_BLOQUEIO.find((x) => x.key === motivo);
  return m ? m.label : '—';
}

/** Só dona (owner) e gestora podem criar bloqueio "geral". */
export function podeSelecionarEscopoGeral(role: string): boolean {
  return role === 'owner' || role === 'gestor';
}

/** Bloqueio de dona/gestora nasce aprovado; de profissional, pendente. */
export function situacaoInicialBloqueio(role: string): SituacaoBloqueio {
  return role === 'owner' || role === 'gestor' ? 'aprovado' : 'pendente';
}

export interface MontarInsertBloqueioInput {
  role: string;
  meuUserId: string;
  empresaId: string;
  /** Escopo pedido. Ignorado (forçado 'profissional') quando role = profissional. */
  escopo: EscopoBloqueio;
  /** Profissional-alvo quando a gestão cria escopo 'profissional'. */
  profissionalId: string | null;
  motivo: MotivoBloqueio;
  titulo?: string | null;
  /** ISO string. */
  dataInicio: string;
  /** ISO string. */
  dataFim: string;
}

export interface BloqueioInsert {
  empresa_id: string;
  escopo: EscopoBloqueio;
  profissional_id: string | null;
  motivo: MotivoBloqueio;
  titulo: string;
  data_inicio: string;
  data_fim: string;
  situacao: SituacaoBloqueio;
  criado_por: string;
}

/**
 * Monta o objeto de `insert` em `agenda_bloqueios` já coerente com as
 * regras de papel — o mesmo que a RLS exige. Profissional sempre vira
 * `escopo='profissional'`, `profissional_id = meuUserId`,
 * `situacao='pendente'`, independentemente do que foi passado.
 */
export function montarInsertBloqueio(input: MontarInsertBloqueioInput): BloqueioInsert {
  const ehGestao = input.role === 'owner' || input.role === 'gestor';
  const escopo: EscopoBloqueio = ehGestao ? input.escopo : 'profissional';
  const profissional_id =
    escopo === 'geral'
      ? null
      : ehGestao
        ? input.profissionalId
        : input.meuUserId;

  return {
    empresa_id:      input.empresaId,
    escopo,
    profissional_id,
    motivo:          input.motivo,
    titulo:          (input.titulo ?? '').trim() || motivoBloqueioLabel(input.motivo),
    data_inicio:     input.dataInicio,
    data_fim:        input.dataFim,
    situacao:        situacaoInicialBloqueio(input.role),
    criado_por:      input.meuUserId,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run tests/unit/bloqueios.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add shared/bloqueios.ts web/tests/unit/bloqueios.test.ts
git commit -m "feat(shared): dominio de bloqueios (tipos, motivo, montagem do insert)"
```

---

## Task 6: Web — excluir agendamento (`NovoAgModal`)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: `podeExcluirAgendamento`, `motivoExclusaoBloqueada` from `@shared/agendamentos`; `ConfirmDialog` from `@/components/ConfirmDialog`; `Trash2` (já importado, linha ~32).
- Produces: nada para tasks seguintes. `NovoAgModal` ganha props `meuRole: string` e `onExcluido: () => void`.

- [ ] **Step 1: Write a source-assertion test**

Create `web/tests/unit/agenda-excluir-agendamento.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'app', '(app)', 'agenda', 'page.tsx'), 'utf8',
);

describe('agenda: excluir agendamento', () => {
  it('usa os helpers de @shared/agendamentos', () => {
    expect(src).toMatch(/from '@shared\/agendamentos'/);
    expect(src).toContain('podeExcluirAgendamento');
  });
  it('faz DELETE em agendamentos com .select() para detectar RLS', () => {
    expect(src).toMatch(/from\('agendamentos'\)\s*\.delete\(\)\s*\.eq\('id',[^)]*\)\s*\.select\('id'\)/s);
  });
  it('usa ConfirmDialog para confirmar a exclusao', () => {
    expect(src).toContain('ConfirmDialog');
  });
});
```

Run: `cd web && npx vitest run tests/unit/agenda-excluir-agendamento.test.ts` → FAIL.

- [ ] **Step 2: Add the import**

In `web/app/(app)/agenda/page.tsx`, after the `@shared/taxa-reserva` import (~line 45), add:

```typescript
import { podeExcluirAgendamento, motivoExclusaoBloqueada } from '@shared/agendamentos';
import { ConfirmDialog } from '@/components/ConfirmDialog';
```

- [ ] **Step 3: Extend `NovoAgModal` signature**

Change the `NovoAgModal` params (line 233-241) to add `meuRole` and `onExcluido`:

```typescript
function NovoAgModal({
  data, empresaId, onClose, onSalvo, agEditar, horaInicial, profIdInicial, meuRole, onExcluido,
}: {
  data: Date; empresaId: string;
  onClose: () => void; onSalvo: () => void;
  agEditar?: Ag;
  horaInicial?: string;
  profIdInicial?: string;
  meuRole: string;
  onExcluido: () => void;
}) {
```

- [ ] **Step 4: Add delete state + handler inside `NovoAgModal`**

Right after `const [erro, setErro] = useState('');` (~line 253) add:

```typescript
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [avisoTaxaExcluir, setAvisoTaxaExcluir] = useState('');

  const podeExcluir = !!agEditar && podeExcluirAgendamento(agEditar.status, meuRole);
  const motivoBloqueioExcluir = agEditar ? motivoExclusaoBloqueada(agEditar.status) : null;

  async function abrirConfirmExcluir() {
    setAvisoTaxaExcluir('');
    if (!agEditar) return;
    // Avisa se há taxa paga que sairá do faturamento junto
    const [{ data: tr }, { data: tc }] = await Promise.all([
      supabase.from('taxas_reserva').select('valor, status, paga_em').eq('agendamento_id', agEditar.id),
      supabase.from('taxas_cancelamento').select('valor, status, paga_em').eq('agendamento_id', agEditar.id),
    ]);
    const pagas = [...(tr ?? []), ...(tc ?? [])].filter(
      (t: any) => t.paga_em != null || t.status === 'pago' || t.status === 'paga',
    );
    const totalPago = pagas.reduce((s: number, t: any) => s + Number(t.valor || 0), 0);
    if (totalPago > 0) {
      setAvisoTaxaExcluir(
        ` A taxa de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPago)} (paga) também será removida e sai do faturamento daquele período.`,
      );
    }
    setConfirmarExcluir(true);
  }

  async function excluirAgendamento() {
    if (!agEditar) return;
    setExcluindo(true);
    const { data: apagados, error } = await supabase
      .from('agendamentos')
      .delete()
      .eq('id', agEditar.id)
      .select('id');
    setExcluindo(false);
    setConfirmarExcluir(false);
    if (error) { setErro(`Erro ao excluir: ${error.message}`); return; }
    if (!apagados || apagados.length === 0) {
      setErro('Você não tem permissão para excluir agendamentos.');
      return;
    }
    onExcluido();
  }
```

- [ ] **Step 5: Add the button to the modal footer**

Replace the footer block (lines ~930-935) with:

```tsx
          {erro && <p className="text-red text-sm text-center">{erro}</p>}

          <div className="flex items-center gap-3 mt-1">
            {agEditar && podeExcluir && (
              <button type="button" onClick={abrirConfirmExcluir}
                className="h-10 px-3 rounded-xl text-sm font-semibold text-red hover:bg-red-soft transition flex items-center gap-1.5">
                <Trash2 size={14} strokeWidth={2}/> Excluir
              </button>
            )}
            {agEditar && !podeExcluir && motivoBloqueioExcluir && meuRole !== 'profissional' && (
              <span className="text-xs text-text-4" title={motivoBloqueioExcluir}>Não pode excluir</span>
            )}
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="submit" disabled={salvando} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
              {salvando ? 'Salvando...' : agEditar ? 'Salvar alterações' : 'Agendar'}
            </button>
          </div>
        </form>
      </div>

      {confirmarExcluir && agEditar && (
        <ConfirmDialog
          open
          variant="danger"
          title="Excluir agendamento"
          message={`Excluir o agendamento de ${agEditar.cliente?.nome ?? 'cliente'}? Esta ação não pode ser desfeita.${avisoTaxaExcluir}`}
          confirmLabel="Excluir"
          loading={excluindo}
          onConfirm={excluirAgendamento}
          onCancel={() => setConfirmarExcluir(false)}
        />
      )}
    </div>
  );
```

(The final `</div>` / `)` that previously closed the component stay; you are inserting the `ConfirmDialog` block between the modal's outer `</div>` and the component's closing `)`. Verify brace balance with `tsc`.)

- [ ] **Step 6: Wire `meuRole` + `onExcluido` at the call site**

`AgendaPage` already needs `meuRole`/`meuUserId` (Task 8 adds the load). For this task, add a minimal role load now so Parte A ships independently. After the existing `empresaId` effect (~line 1642-1655), add state and extend the query:

```typescript
  const [meuRole,   setMeuRole]   = useState<string>('profissional');
  const [meuUserId, setMeuUserId] = useState<string>('');
```

In that effect, change the `empresa_membros` select from `.select('empresa_id')` to `.select('empresa_id, role')`, and after `setEmpresaId(...)` add:

```typescript
      setMeuUserId(user.id);
      setMeuRole((membro?.role as string) ?? 'profissional');
```

Then in the `NovoAgModal` render (~line 1896-1911) add the two props:

```tsx
        <NovoAgModal
          data={agEditar ? parseISO(agEditar.data_hora_inicio) : dataSel}
          empresaId={empresaId}
          horaInicial={modalParams.hora}
          profIdInicial={modalParams.profId}
          meuRole={meuRole}
          onClose={() => { setModal(false); setAgEditar(null); setModalParams({}); }}
          onSalvo={() => {
            setModal(false); setAgEditar(null); setModalParams({});
            fetchDia(dataSel, empresaId);
            if (view === 'mes') fetchMes(dataSel, empresaId);
          }}
          onExcluido={() => {
            setModal(false); setAgEditar(null); setModalParams({});
            fetchDia(dataSel, empresaId);
            if (view === 'mes') fetchMes(dataSel, empresaId);
          }}
          agEditar={agEditar ?? undefined}
        />
```

- [ ] **Step 7: Run tests + typecheck**

Run: `cd web && npx vitest run tests/unit/agenda-excluir-agendamento.test.ts && npx tsc --noEmit`
Expected: PASS, zero erros.

- [ ] **Step 8: Manual check**

Run: `cd web && npm run dev`. Abra a Agenda como owner/gestor, dê 2 cliques num agendamento `cancelado`, confirme que aparece "Excluir", exclua, confirme que some da timeline. Repita num `concluído` → botão não aparece.

- [ ] **Step 9: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx" web/tests/unit/agenda-excluir-agendamento.test.ts
git commit -m "feat(agenda-web): excluir agendamento (dona/gestora, exceto concluido)"
```

---

## Task 7: Nativo — excluir agendamento (`(empresa)/agendamento/[id].tsx`)

**Files:**
- Modify: `mobile/app/(empresa)/agendamento/[id].tsx`

**Interfaces:**
- Consumes: `podeExcluirAgendamento` from `@shared/agendamentos`; `useAuthStore().roleAtivo` / `isOwner`; `supabase`, `router`, `qc` (já no arquivo); `Trash2` de `lucide-react-native`.
- Produces: nada.

- [ ] **Step 1: Add imports**

In `mobile/app/(empresa)/agendamento/[id].tsx`:
- Add `Trash2` to the `lucide-react-native` import (line 11-15).
- After the `@shared/atendimento-detalhe` import (line 33-36) add:

```typescript
import { podeExcluirAgendamento } from '@shared/agendamentos';
```

- [ ] **Step 2: Compute role + delete handler**

Near `const statusCfg = ...` (line 403), the component already has `useAuthStore`. Add after line 439 (`const estaCancelado = ...`):

```typescript
  const { roleAtivo, isOwner } = useAuthStore();
  const meuRole = isOwner ? 'owner' : (roleAtivo ?? 'profissional');
  const podeExcluir = podeExcluirAgendamento(ag.status, meuRole);

  async function excluirAgendamento() {
    setAtualizando(true);
    const { data: apagados, error } = await supabase
      .from('agendamentos')
      .delete()
      .eq('id', id)
      .select('id');
    setAtualizando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    if (!apagados || apagados.length === 0) {
      Alert.alert('Sem permissão', 'Você não tem permissão para excluir agendamentos.');
      return;
    }
    qc.invalidateQueries({ queryKey: ['agenda-dia'] });
    qc.invalidateQueries({ queryKey: ['cliente-detalhe'] });
    router.back();
  }

  function confirmarExclusao() {
    Alert.alert(
      'Excluir agendamento',
      `Excluir o agendamento de ${ag.cliente?.nome ?? 'cliente'}? Esta ação não pode ser desfeita. Taxas de reserva/cancelamento vinculadas também serão removidas.`,
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: excluirAgendamento },
      ],
    );
  }
```

(Note: `useAuthStore` is already imported at line 30; if a top-level `const { ... } = useAuthStore()` already exists in the component, merge `roleAtivo`/`isOwner` into it instead of adding a second call.)

- [ ] **Step 3: Render the button**

After the "Status final" `MotiView` block (closes ~line 703), before the closing `</ScrollView>`, add:

```tsx
        {podeExcluir && (
          <View style={{ marginHorizontal: 24, marginBottom: 28 }}>
            <TouchableOpacity
              onPress={confirmarExclusao}
              disabled={atualizando}
              style={{
                borderWidth: 1, borderColor: 'rgba(192,57,43,0.3)',
                borderRadius: 14, padding: 14, flexDirection: 'row',
                alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <Trash2 size={15} color={C.red} strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.red }}>
                Excluir agendamento
              </Text>
            </TouchableOpacity>
          </View>
        )}
```

- [ ] **Step 4: Typecheck (mobile baseline)**

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma contagem de erros da baseline (nenhum novo em `agendamento/[id].tsx`).

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(empresa)/agendamento/[id].tsx"
git commit -m "feat(agenda-mobile): excluir agendamento na tela de detalhe (empresa)"
```

---

## Task 8: Web — carga de dados de bloqueio na `AgendaPage`

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: `@shared/bloqueios` types.
- Produces (contrato para Tasks 9–11):
  - `Bloqueio` type ganha `escopo: EscopoBloqueio`, `motivo: string | null`, `situacao: SituacaoBloqueio`, `criado_por: string | null`.
  - `AgendaPage` expõe a componentes internos: `meuRole: string`, `meuUserId: string`, `membrosAtivos: { id: string; nome: string }[]`, `bloqueiosPendentes: BloqueioPendente[]`, `recarregarPendentes(): void`.
  - `BloqueioPendente = { id: string; profissional_id: string | null; criado_por: string | null; autorNome: string; titulo: string; motivo: string | null; data_inicio: string; data_fim: string }`.

- [ ] **Step 1: Extend the `Bloqueio` type**

In `web/app/(app)/agenda/page.tsx`, update `type Bloqueio` (line 90-96):

```typescript
type Bloqueio   = {
  id: string;
  profissional_id: string | null;
  titulo: string;
  data_inicio: string;
  data_fim: string;
  escopo: 'profissional' | 'geral';
  motivo: string | null;
  situacao: 'aprovado' | 'pendente';
  criado_por: string | null;
};

type BloqueioPendente = {
  id: string;
  profissional_id: string | null;
  criado_por: string | null;
  autorNome: string;
  titulo: string;
  motivo: string | null;
  data_inicio: string;
  data_fim: string;
};
```

- [ ] **Step 2: Add import**

After the `@shared/agendamentos` import (added in Task 6):

```typescript
import {
  MOTIVOS_BLOQUEIO, motivoBloqueioLabel, podeSelecionarEscopoGeral,
  montarInsertBloqueio, type EscopoBloqueio,
} from '@shared/bloqueios';
```

- [ ] **Step 3: Load role + active members + pendentes**

`meuRole` / `meuUserId` state already added in Task 6. Add after them:

```typescript
  const [membrosAtivos,      setMembrosAtivos]      = useState<{ id: string; nome: string }[]>([]);
  const [bloqueiosPendentes, setBloqueiosPendentes] = useState<BloqueioPendente[]>([]);

  const ehGestao = meuRole === 'owner' || meuRole === 'gestor';
```

In the `empresaId` effect (the one that sets `empresaId` + `categoriasCustom`), after `setEmpresaId(...)` and inside `if (membro?.empresa_id) { ... }`, add a members fetch:

```typescript
        const { data: membros } = await supabase
          .from('empresa_membros')
          .select('user_id, user:users(id, nome)')
          .eq('empresa_id', membro.empresa_id)
          .in('role', ['owner', 'gestor', 'profissional'])
          .eq('ativo', true);
        setMembrosAtivos(
          ((membros ?? []) as any[])
            .map((m) => ({ id: m.user?.id, nome: m.user?.nome }))
            .filter((m) => m.id && m.nome),
        );
```

- [ ] **Step 4: `recarregarPendentes` + 30s polling**

Add this callback near `fetchDia`:

```typescript
  const recarregarPendentes = useCallback(async () => {
    if (!empresaId) return;
    const { data } = await supabase
      .from('agenda_bloqueios')
      .select('id, profissional_id, criado_por, titulo, motivo, data_inicio, data_fim, autor:users!agenda_bloqueios_criado_por_fkey(nome)')
      .eq('empresa_id', empresaId)
      .eq('situacao', 'pendente')
      .order('data_inicio');
    setBloqueiosPendentes(
      ((data ?? []) as any[]).map((b) => ({
        id: b.id,
        profissional_id: b.profissional_id,
        criado_por: b.criado_por,
        autorNome: b.autor?.nome ?? 'Profissional',
        titulo: b.titulo,
        motivo: b.motivo,
        data_inicio: b.data_inicio,
        data_fim: b.data_fim,
      })),
    );
  }, [empresaId]);

  useEffect(() => {
    if (!empresaId || !ehGestao) return;
    recarregarPendentes();
    const tick = () => { if (document.visibilityState === 'visible') recarregarPendentes(); };
    const iv = setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(iv); window.removeEventListener('focus', tick); };
  }, [empresaId, ehGestao, recarregarPendentes]);
```

> If Supabase's FK auto-embed name `agenda_bloqueios_criado_por_fkey` differs, use a two-step: fetch pendentes then `users` by `criado_por` ids. Verify against the generated constraint name.

- [ ] **Step 5: `fetchDia` brings the new columns**

In `fetchDia`, change the `agenda_bloqueios` select to:

```typescript
      supabase
        .from('agenda_bloqueios')
        .select('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por')
        .eq('empresa_id', empId)
        .lte('data_inicio', fimDia)
        .gte('data_fim',    iniDia),
```

- [ ] **Step 6: Source-assertion test**

Create `web/tests/unit/agenda-bloqueio-aprovacao.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'app', '(app)', 'agenda', 'page.tsx'), 'utf8');

describe('agenda: bloqueio com tipos + aprovacao', () => {
  it('importa os helpers compartilhados de bloqueio', () => {
    expect(src).toMatch(/from '@shared\/bloqueios'/);
    expect(src).toContain('montarInsertBloqueio');
    expect(src).toContain('podeSelecionarEscopoGeral');
  });
  it('carrega pendentes filtrando situacao pendente', () => {
    expect(src).toMatch(/\.eq\('situacao', 'pendente'\)/);
  });
  it('faz polling de 30s de pendentes', () => {
    expect(src).toContain('30_000');
  });
  it('fetchDia traz escopo/motivo/situacao/criado_por', () => {
    expect(src).toMatch(/agenda_bloqueios'\)\s*\.select\('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por'\)/);
  });
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `cd web && npx vitest run tests/unit/agenda-bloqueio-aprovacao.test.ts && npx tsc --noEmit`
Expected: PASS, zero erros. (`montarInsertBloqueio`/`podeSelecionarEscopoGeral` are imported but not yet used → prefix with `void` or add an eslint-disable only if the build errors on unused; Next `tsc --noEmit` does not fail on unused imports, but if a lint step runs, wire them in Task 9 which is next.)

- [ ] **Step 8: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx" web/tests/unit/agenda-bloqueio-aprovacao.test.ts
git commit -m "feat(agenda-web): carga de papel, membros e bloqueios pendentes"
```

---

## Task 9: Web — `NovoBloqueioModal` reescrito (escopo + motivo + papel)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: `montarInsertBloqueio`, `MOTIVOS_BLOQUEIO`, `podeSelecionarEscopoGeral`, `motivoBloqueioLabel` from `@shared/bloqueios`; `meuRole`, `meuUserId`, `membrosAtivos` from `AgendaPage` (Task 8).
- Produces: `NovoBloqueioModal` props agora: `{ data, empresaId, meuRole, meuUserId, meuNome, membros, onClose, onSalvo }`. `onSalvo(b: Bloqueio)` inalterado em assinatura.

- [ ] **Step 1: Replace the `NovoBloqueioModal` function (lines ~1015-1127)**

```tsx
function NovoBloqueioModal({ data, empresaId, meuRole, meuUserId, meuNome, membros, onClose, onSalvo }: {
  data: Date;
  empresaId: string;
  meuRole: string;
  meuUserId: string;
  meuNome: string;
  membros: { id: string; nome: string }[];
  onClose: () => void;
  onSalvo: (b: Bloqueio) => void;
}) {
  useScrollLock();
  const ehGestao = podeSelecionarEscopoGeral(meuRole);

  const [escopo,   setEscopo]   = useState<EscopoBloqueio>('profissional');
  const [profId,   setProfId]   = useState('');
  const [motivo,   setMotivo]   = useState<string>('folga');
  const [titulo,   setTitulo]   = useState('');
  const [horaIni,  setHoraIni]  = useState('08:00');
  const [horaFim,  setHoraFim]  = useState('09:00');
  const [dataBl,   setDataBl]   = useState(format(data, 'yyyy-MM-dd'));
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(''); setSalvando(true);

    const dataInicio = new Date(`${dataBl}T${horaIni}:00`);
    const dataFim    = new Date(`${dataBl}T${horaFim}:00`);
    if (dataFim <= dataInicio) {
      setErro('O horário de fim deve ser após o início.'); setSalvando(false); return;
    }
    if (ehGestao && escopo === 'profissional' && !profId) {
      setErro('Escolha o profissional.'); setSalvando(false); return;
    }

    const insert = montarInsertBloqueio({
      role: meuRole,
      meuUserId,
      empresaId,
      escopo,
      profissionalId: profId || null,
      motivo: motivo as any,
      titulo,
      dataInicio: dataInicio.toISOString(),
      dataFim: dataFim.toISOString(),
    });

    const { data: row, error } = await supabase
      .from('agenda_bloqueios')
      .insert(insert)
      .select('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por')
      .single();

    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo(row as Bloqueio);
  }

  const inputCls = "w-full h-10 px-3 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
  const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1";

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Ban size={16} style={{ color: 'var(--color-rose)' }} strokeWidth={2}/>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--color-ink)' }}>
              Bloquear horário
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        <form onSubmit={salvar} className="p-5 flex flex-col gap-3">
          {ehGestao ? (
            <>
              <div>
                <label className={labelCls}>Tipo de bloqueio</label>
                <div className="flex rounded-xl border border-border overflow-hidden">
                  <button type="button" onClick={() => setEscopo('profissional')}
                    className={`flex-1 h-10 text-sm font-semibold transition ${escopo === 'profissional' ? 'bg-primary text-white' : 'text-text-2 hover:bg-bg'}`}>
                    Um profissional
                  </button>
                  <button type="button" onClick={() => setEscopo('geral')}
                    className={`flex-1 h-10 text-sm font-semibold transition ${escopo === 'geral' ? 'bg-primary text-white' : 'text-text-2 hover:bg-bg'}`}>
                    Toda a agenda
                  </button>
                </div>
              </div>
              {escopo === 'profissional' && (
                <div>
                  <label className={labelCls}>Profissional</label>
                  <select value={profId} onChange={e => setProfId(e.target.value)} className={inputCls}>
                    <option value="">Selecione...</option>
                    {membros.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl bg-bg border border-border px-3 py-2.5 text-sm text-text-2">
              Bloqueio para: <span className="font-semibold text-text">{meuNome}</span>
              <p className="text-xs text-text-4 mt-1">Vai para aprovação da dona ou gestora.</p>
            </div>
          )}

          <div>
            <label className={labelCls}>Motivo</label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)} className={inputCls} required>
              {MOTIVOS_BLOQUEIO.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Detalhe <span className="normal-case font-normal text-text-4">(opcional)</span></label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: Dentista, Viagem..." className={inputCls}/>
          </div>

          <div>
            <label className={labelCls}>Data</label>
            <input type="date" value={dataBl} onChange={e => setDataBl(e.target.value)} className={inputCls}/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Início</label>
              <input type="time" value={horaIni} onChange={e => setHoraIni(e.target.value)} className={inputCls}/>
            </div>
            <div>
              <label className={labelCls}>Fim</label>
              <input type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)} className={inputCls}/>
            </div>
          </div>

          {erro && <p className="text-sm" style={{ color: 'var(--color-rose)' }}>{erro}</p>}

          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando}
              className="flex-1 h-10 rounded-xl text-white text-sm font-bold transition disabled:opacity-60"
              style={{ background: 'var(--color-rose)' }}>
              {salvando ? 'Salvando...' : ehGestao ? 'Bloquear' : 'Pedir bloqueio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the modal render block**

Replace the `modalBloq` IIFE (lines ~1915-1929) with:

```tsx
      {/* Modal de bloqueio */}
      {modalBloq && empresaId && (
        <NovoBloqueioModal
          data={dataSel}
          empresaId={empresaId}
          meuRole={meuRole}
          meuUserId={meuUserId}
          meuNome={membrosAtivos.find(m => m.id === meuUserId)?.nome ?? 'Você'}
          membros={membrosAtivos}
          onClose={() => setModalBloq(false)}
          onSalvo={b => {
            setBloqueios(prev => [...prev, b]);
            setModalBloq(false);
            if (b.situacao === 'pendente') showErro('Pedido de bloqueio enviado para aprovação.');
          }}
        />
      )}
```

> `showErro` is the existing toast helper (reused for a neutral message). If a green toast helper exists, prefer it; otherwise this is acceptable and consistent with the file.

- [ ] **Step 3: Typecheck + test**

Run: `cd web && npx tsc --noEmit && npx vitest run tests/unit/agenda-bloqueio-aprovacao.test.ts`
Expected: zero erros, PASS.

- [ ] **Step 4: Manual check**

`npm run dev`. Como owner: "Bloquear" → alterna "Um profissional"/"Toda a agenda", escolhe motivo, salva → aparece na timeline. Como profissional (usar outra conta): sem toggle de escopo, texto "Vai para aprovação", botão diz "Pedir bloqueio".

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx"
git commit -m "feat(agenda-web): modal de bloqueio com tipo, motivo e fluxo de pedido"
```

---

## Task 10: Web — pílula + modal de bloqueios pendentes (aprovar/recusar)

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: `bloqueiosPendentes`, `recarregarPendentes`, `meuUserId`, `ehGestao`, `motivoBloqueioLabel`, `fetchDia`, `dataSel`, `empresaId`.
- Produces: nada.

- [ ] **Step 1: Add approve/reject handlers in `AgendaPage`**

Near `deletarBloqueio` (~line 1753):

```typescript
  async function aprovarBloqueio(id: string) {
    const { data: rows, error } = await supabase
      .from('agenda_bloqueios')
      .update({ situacao: 'aprovado', revisado_por: meuUserId, revisado_em: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (error || !rows || rows.length === 0) {
      showErro(error?.message ?? 'Sem permissão para aprovar.');
      return;
    }
    setBloqueiosPendentes(prev => prev.filter(b => b.id !== id));
    if (empresaId) fetchDia(dataSel, empresaId);
  }

  async function recusarBloqueio(id: string) {
    const { data: rows, error } = await supabase
      .from('agenda_bloqueios')
      .delete()
      .eq('id', id)
      .select('id');
    if (error || !rows || rows.length === 0) {
      showErro(error?.message ?? 'Sem permissão para recusar.');
      return;
    }
    setBloqueiosPendentes(prev => prev.filter(b => b.id !== id));
    if (empresaId) fetchDia(dataSel, empresaId);
  }
```

- [ ] **Step 2: Add a `PendentesBloqueio` inline component**

Above `AgendaPage` (or right after `NovoBloqueioModal`):

```tsx
function PendentesBloqueioBtn({ pendentes, onAprovar, onRecusar }: {
  pendentes: BloqueioPendente[];
  onAprovar: (id: string) => void;
  onRecusar: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [confirmarRecusa, setConfirmarRecusa] = useState<string | null>(null);
  if (pendentes.length === 0) return null;

  return (
    <>
      <button onClick={() => setAberto(true)}
        className="press flex items-center gap-2 px-3 h-10 rounded-2xl text-sm font-bold border transition"
        style={{ borderColor: 'var(--color-amber)', color: 'var(--color-amber)', background: 'var(--color-amber-soft)' }}
        title="Bloqueios aguardando aprovação">
        <AlertTriangle size={14} strokeWidth={2}/><span>Pendentes ({pendentes.length})</span>
      </button>

      {aberto && (
        <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAberto(false)}/>
          <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[85dvh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--color-ink)' }}>
                Bloqueios pendentes
              </h2>
              <button onClick={() => setAberto(false)} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
                <X size={16}/>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {pendentes.map(b => (
                <div key={b.id} className="rounded-xl border border-border p-3">
                  <p className="font-semibold text-text text-sm">{b.autorNome}</p>
                  <p className="text-xs text-text-3 mt-0.5">
                    {format(parseISO(b.data_inicio), "dd/MM 'às' HH:mm")}–{format(parseISO(b.data_fim), 'HH:mm')}
                    {' · '}{motivoBloqueioLabel(b.motivo)}
                  </p>
                  {b.titulo && b.titulo !== motivoBloqueioLabel(b.motivo) && (
                    <p className="text-xs text-text-4 italic mt-0.5">{b.titulo}</p>
                  )}
                  {confirmarRecusa === b.id ? (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => { onRecusar(b.id); setConfirmarRecusa(null); }}
                        className="flex-1 h-8 rounded-lg text-white text-xs font-bold" style={{ background: 'var(--color-rose)' }}>
                        Confirmar recusa
                      </button>
                      <button onClick={() => setConfirmarRecusa(null)}
                        className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold">
                        Voltar
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => onAprovar(b.id)}
                        className="flex-1 h-8 rounded-lg text-white text-xs font-bold" style={{ background: 'var(--color-green)' }}>
                        Aprovar
                      </button>
                      <button onClick={() => setConfirmarRecusa(b.id)}
                        className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-bg">
                        Recusar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Render it next to the "Bloquear" button**

In the header actions (after the "Bloquear" `<button>`, ~line 1814), insert:

```tsx
          {ehGestao && (
            <PendentesBloqueioBtn
              pendentes={bloqueiosPendentes}
              onAprovar={aprovarBloqueio}
              onRecusar={recusarBloqueio}
            />
          )}
```

- [ ] **Step 4: Add assertion + run**

Append to `web/tests/unit/agenda-bloqueio-aprovacao.test.ts`:

```typescript
  it('tem fluxo de aprovar/recusar pendente', () => {
    expect(src).toContain("update({ situacao: 'aprovado'");
    expect(src).toContain('PendentesBloqueioBtn');
  });
```

Run: `cd web && npx vitest run tests/unit/agenda-bloqueio-aprovacao.test.ts && npx tsc --noEmit`
Expected: PASS, zero erros.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx" web/tests/unit/agenda-bloqueio-aprovacao.test.ts
git commit -m "feat(agenda-web): lista de bloqueios pendentes com aprovar/recusar"
```

---

## Task 11: Web — `TimelineView` desenha bloqueio pendente + trava do "X"

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: `Bloqueio.situacao`, `Bloqueio.criado_por`, `meuRole`, `meuUserId`, `motivoBloqueioLabel`.
- Produces: `TimelineView` props ganham `meuRole: string`, `meuUserId: string`.

- [ ] **Step 1: Pass the two props to `TimelineView`**

In the `view === 'timeline'` render (~line 1859-1871) add `meuRole={meuRole}` and `meuUserId={meuUserId}`. Update the `TimelineView` param list (line 1148-1152) and its type to include:

```typescript
  meuRole: string; meuUserId: string;
```

- [ ] **Step 2: Style pending blocks + gate the remove button**

Find the "Bloqueios de horário" map (around line 1340-1365). Update the block rendering so:
- when `bl.situacao === 'pendente'`: add a hachura background and an "aguardando aprovação" pill;
- the remove `X` button (`onDeletarBloqueio`) shows when `meuRole` is `owner`/`gestor`, OR when `bl.situacao === 'pendente' && bl.criado_por === meuUserId`.

Replace that block's inner JSX with:

```tsx
                  {bloqueios
                    .filter(bl => {
                      // aprovados: todos; pendentes: só quem criou + gestão (RLS já filtra, isto é visual)
                      return bl.situacao === 'aprovado'
                        || meuRole === 'owner' || meuRole === 'gestor'
                        || bl.criado_por === meuUserId;
                    })
                    .filter(/* mantém o filtro de coluna/profissional existente aqui */ () => true)
                    .map(bl => {
                      const pendente = bl.situacao === 'pendente';
                      const podeRemover = meuRole === 'owner' || meuRole === 'gestor'
                        || (pendente && bl.criado_por === meuUserId);
                      return (
                        <div key={bl.id} /* posição/altura calculadas como hoje */
                          className="absolute left-1 right-1 rounded-lg border px-2 py-1 overflow-hidden"
                          style={{
                            /* top/height calculados como hoje */
                            background: pendente
                              ? 'repeating-linear-gradient(45deg, rgba(201,82,127,0.10) 0 6px, rgba(201,82,127,0.02) 6px 12px)'
                              : 'var(--color-rose-soft)',
                            borderColor: 'rgba(201,82,127,0.35)',
                          }}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-rose)' }}>
                              {bl.titulo || motivoBloqueioLabel(bl.motivo) || 'Bloqueio'}
                            </span>
                            {podeRemover && (
                              <button onClick={e => { e.stopPropagation(); onDeletarBloqueio(bl.id); }}
                                className="text-text-4 hover:text-rose transition flex-shrink-0"
                                title="Remover bloqueio">
                                <X size={11}/>
                              </button>
                            )}
                          </div>
                          {pendente && (
                            <span className="text-[9px] font-semibold" style={{ color: 'var(--color-amber)' }}>
                              aguardando aprovação
                            </span>
                          )}
                        </div>
                      );
                    })}
```

> Keep the existing top/height/position math and the existing profissional-column filter — only merge in the `situacao` filter, the hachura style, the pill, and the `podeRemover` gate. Do not drop the coordinate logic that is already there.

- [ ] **Step 3: `deletarBloqueio` — feedback on 0 rows**

Update `deletarBloqueio` (~line 1753) to check rows and warn:

```typescript
  async function deletarBloqueio(id: string) {
    const anterior = bloqueios;
    setBloqueios(prev => prev.filter(b => b.id !== id));
    const { data: rows, error } = await supabase
      .from('agenda_bloqueios').delete().eq('id', id).select('id');
    if (error || !rows || rows.length === 0) {
      setBloqueios(anterior);
      showErro(error?.message ?? 'Sem permissão para remover este bloqueio.');
      return;
    }
    setBloqueiosPendentes(prev => prev.filter(b => b.id !== id));
  }
```

- [ ] **Step 4: Typecheck + manual**

Run: `cd web && npx tsc --noEmit`
`npm run dev`: profissional pede bloqueio → vê o próprio bloco tracejado com "aguardando aprovação" e um "X" para retirar; gestor vê o mesmo bloco e aprova pela lista de pendentes → vira sólido.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/agenda/page.tsx"
git commit -m "feat(agenda-web): timeline desenha bloqueio pendente + trava do remover"
```

---

## Task 12: Web — tipo de contrato na Equipe

**Files:**
- Modify: `web/app/(app)/equipe/page.tsx`
- Modify: `web/app/api/profissionais/route.ts`

**Interfaces:**
- Consumes: coluna `empresa_membros.tipo_contrato` (migration 067).
- Produces: `Profissional` type ganha `tipo_contrato: 'pj' | 'clt' | null`.

- [ ] **Step 1: API — aceitar `tipo_contrato` no PATCH**

In `web/app/api/profissionais/route.ts`, `PATCH` handler:
- destructure: `const { userId, nome, telefone, email, membroId, percentual_comissao, tipo_contrato } = await req.json();`
- validate: `const tc = tipo_contrato === 'pj' || tipo_contrato === 'clt' ? tipo_contrato : null;`
- change the `empresa_membros` update block:

```typescript
    if (membroId != null) {
      const patch: Record<string, unknown> = { tipo_contrato: tc };
      if (percentual_comissao != null) patch.percentual_comissao = percentual_comissao;
      const { error: errMembro } = await adminClient
        .from('empresa_membros')
        .update(patch)
        .eq('id', membroId);
      if (errMembro) return NextResponse.json({ error: errMembro.message }, { status: 400 });
    }
```

- [ ] **Step 2: Equipe — type + list select**

In `web/app/(app)/equipe/page.tsx`:
- `type Profissional` (line ~26): add `tipo_contrato: 'pj' | 'clt' | null;`
- the members `select` (line ~467): add `tipo_contrato` to the column list.

- [ ] **Step 3: `EditInfoModal` — the field**

Add near `const [comissao, ...]` (line 212):

```typescript
  const [tipoContrato, setTipoContrato] = useState<'pj' | 'clt' | ''>(prof.tipo_contrato ?? '');
```

Extend the `onSalvo` payload type and `fetch` body:

```typescript
  onSalvo: (dados: { nome: string; telefone: string; email: string; comissao: number; tipoContrato: 'pj' | 'clt' | null }) => void;
```

```typescript
      body: JSON.stringify({
        userId: prof.user_id, nome: nome.trim(),
        telefone: telefone.trim() || null, email: email.trim() || null,
        membroId: prof.id, percentual_comissao: pct,
        tipo_contrato: tipoContrato || null,
      }),
```

```typescript
    onSalvo({ nome: nome.trim(), telefone: telefone.trim(), email: email.trim(), comissao: pct, tipoContrato: tipoContrato || null });
```

Add the `<select>` in the form (after the comissão field):

```tsx
          <div>
            <label className={labelClass}>Tipo de contrato</label>
            <select value={tipoContrato} onChange={e => setTipoContrato(e.target.value as 'pj' | 'clt' | '')}
              className={inputClass}>
              <option value="">—</option>
              <option value="pj">PJ / Comissionada</option>
              <option value="clt">CLT</option>
            </select>
          </div>
```

- [ ] **Step 4: Apply `tipoContrato` to local state on save**

Find the `onSalvo` handler passed to `EditInfoModal` (search `setProfs(prev => prev.map(` near line 539). Add `tipo_contrato: dados.tipoContrato` to the mapped object.

- [ ] **Step 5: Show it on the card**

Near the comissão display (line ~388), add a small line:

```tsx
            {prof.tipo_contrato && (
              <span className="text-[11px] text-text-4 font-medium">
                {prof.tipo_contrato === 'pj' ? 'PJ / Comissionada' : 'CLT'}
              </span>
            )}
```

- [ ] **Step 6: Source-assertion test**

Create `web/tests/unit/equipe-tipo-contrato.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const equipe = readFileSync(join(process.cwd(), 'app', '(app)', 'equipe', 'page.tsx'), 'utf8');
const api    = readFileSync(join(process.cwd(), 'app', 'api', 'profissionais', 'route.ts'), 'utf8');

describe('equipe: tipo de contrato', () => {
  it('modal tem o select com pj e clt', () => {
    expect(equipe).toContain('PJ / Comissionada');
    expect(equipe).toMatch(/value="clt"/);
  });
  it('select da listagem traz tipo_contrato', () => {
    expect(equipe).toMatch(/tipo_contrato/);
  });
  it('API PATCH valida e grava tipo_contrato', () => {
    expect(api).toMatch(/tipo_contrato === 'pj' \|\| tipo_contrato === 'clt'/);
    expect(api).toContain('tipo_contrato: tc');
  });
});
```

- [ ] **Step 7: Run + typecheck**

Run: `cd web && npx vitest run tests/unit/equipe-tipo-contrato.test.ts && npx tsc --noEmit`
Expected: PASS, zero erros.

- [ ] **Step 8: Commit**

```bash
git add "web/app/(app)/equipe/page.tsx" "web/app/api/profissionais/route.ts" web/tests/unit/equipe-tipo-contrato.test.ts
git commit -m "feat(equipe): tipo de contrato (PJ/Comissionada ou CLT) por profissional"
```

---

## Task 13: Web — rótulos dos 3 tipos novos de notificação

**Files:**
- Modify: `web/app/(app)/notificacoes/page.tsx`

**Interfaces:**
- Consumes: `notificacoes.tipo` valores `bloqueio_pendente` / `bloqueio_aprovado` / `bloqueio_recusado` (migration 069).
- Produces: nada.

- [ ] **Step 1: Inspect the tipo→ícone/rótulo map**

Run: `cd web && grep -n "tipo" "app/(app)/notificacoes/page.tsx" | head -40` — localize o objeto/switch que mapeia `tipo` para ícone/cor (padrão: `estoque_baixo`, `agendamento`, `comissao`...).

- [ ] **Step 2: Add the 3 entries**

Add to that map (use `Ban` / `Check` / `X` from lucide, or the icons the file already imports):

```tsx
  bloqueio_pendente: { icon: Ban,   cor: 'text-amber',  bg: 'bg-amber-soft'  },
  bloqueio_aprovado: { icon: Check, cor: 'text-green',  bg: 'bg-green-soft'  },
  bloqueio_recusado: { icon: X,     cor: 'text-red',    bg: 'bg-red-soft'    },
```

If the page filters by a whitelist of `tipo` (e.g. only shows some), add the 3 to that whitelist. If it renders any tipo generically, only the icon map is needed.

- [ ] **Step 3: Typecheck + manual**

Run: `cd web && npx tsc --noEmit`
`npm run dev`: gere uma notificação (peça um bloqueio como profissional) → o sino/tela de notificações mostra "Bloqueio aguardando aprovação" com ícone.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/notificacoes/page.tsx"
git commit -m "feat(notificacoes): rotulos dos avisos de bloqueio pendente/aprovado/recusado"
```

---

## Task 14: Nativo — hooks de bloqueio para `(empresa)` (`useAgenda.ts`)

**Files:**
- Modify: `mobile/hooks/useAgenda.ts`

**Interfaces:**
- Consumes: `supabase` (`@/lib/supabase`), `useAuthStore` (`empresaAtiva`, `user`, `roleAtivo`, `isOwner`), `@tanstack/react-query`, `@shared/bloqueios`.
- Produces:
  - `BloqueioAgenda = { id: string; profissional_id: string | null; titulo: string; motivo: string | null; escopo: 'profissional'|'geral'; situacao: 'aprovado'|'pendente'; criado_por: string | null; data_inicio: string; data_fim: string }`
  - `useBloqueiosDia(dia: Date)` → `{ data: BloqueioAgenda[]; refetch }`
  - `useBloqueiosPendentes()` → `{ data: (BloqueioAgenda & { autorNome: string })[]; refetch }`
  - `useCriarBloqueio()` → mutation, `mutateAsync(input: Omit<MontarInsertBloqueioInput,'role'|'meuUserId'|'empresaId'>)`
  - `useAprovarBloqueio()` / `useRecusarBloqueio()` → mutations, `mutateAsync(id: string)`

- [ ] **Step 1: Add imports + type**

At the top of `mobile/hooks/useAgenda.ts` add:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { montarInsertBloqueio, type MontarInsertBloqueioInput } from '@shared/bloqueios';
```

(keep the existing `useQuery` import; merge.)

```typescript
export interface BloqueioAgenda {
  id: string;
  profissional_id: string | null;
  titulo: string;
  motivo: string | null;
  escopo: 'profissional' | 'geral';
  situacao: 'aprovado' | 'pendente';
  criado_por: string | null;
  data_inicio: string;
  data_fim: string;
}
```

- [ ] **Step 2: Add the hooks (append to the file)**

```typescript
const BLOQUEIO_COLS = 'id, profissional_id, titulo, motivo, escopo, situacao, criado_por, data_inicio, data_fim';

export function useBloqueiosDia(dia: Date) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const chave = format(dia, 'yyyy-MM-dd');
  return useQuery({
    queryKey: ['bloqueios-dia', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<BloqueioAgenda[]> => {
      const ini = startOfDay(dia).toISOString();
      const fim = endOfDay(dia).toISOString();
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .select(BLOQUEIO_COLS)
        .eq('empresa_id', empresaId)
        .lte('data_inicio', fim)
        .gte('data_fim', ini);
      if (error) throw error;
      return (data ?? []) as BloqueioAgenda[];
    },
  });
}

export function useBloqueiosPendentes() {
  const { empresaAtiva, roleAtivo, isOwner } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const ehGestao = isOwner || roleAtivo === 'gestor';
  return useQuery({
    queryKey: ['bloqueios-pendentes', empresaId],
    enabled: !!empresaId && ehGestao,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .select(`${BLOQUEIO_COLS}, autor:users!agenda_bloqueios_criado_por_fkey(nome)`)
        .eq('empresa_id', empresaId)
        .eq('situacao', 'pendente')
        .order('data_inicio');
      if (error) throw error;
      return ((data ?? []) as any[]).map((b) => ({
        ...(b as BloqueioAgenda),
        autorNome: b.autor?.nome ?? 'Profissional',
      }));
    },
  });
}

export function useCriarBloqueio() {
  const { empresaAtiva, user, roleAtivo, isOwner } = useAuthStore();
  const qc = useQueryClient();
  const role = isOwner ? 'owner' : (roleAtivo ?? 'profissional');
  return useMutation({
    mutationFn: async (
      input: Omit<MontarInsertBloqueioInput, 'role' | 'meuUserId' | 'empresaId'>,
    ) => {
      const insert = montarInsertBloqueio({
        ...input,
        role,
        meuUserId: user!.id,
        empresaId: empresaAtiva!.id,
      });
      const { data, error } = await supabase
        .from('agenda_bloqueios').insert(insert)
        .select('id, situacao').single();
      if (error) throw error;
      return data as { id: string; situacao: 'aprovado' | 'pendente' };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloqueios-dia'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-pendentes'] });
    },
  });
}

export function useAprovarBloqueio() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .update({ situacao: 'aprovado', revisado_por: user!.id, revisado_em: new Date().toISOString() })
        .eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para aprovar.');
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloqueios-dia'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-pendentes'] });
    },
  });
}

export function useRecusarBloqueio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('agenda_bloqueios').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para recusar.');
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloqueios-dia'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-pendentes'] });
    },
  });
}
```

> Confirm `startOfDay`/`endOfDay` are imported in this file (they are, line 2). Confirm the FK embed alias `agenda_bloqueios_criado_por_fkey`; if PostgREST rejects it, do a second query for `users` by `criado_por`.

- [ ] **Step 3: Typecheck (mobile baseline)**

Run: `cd mobile && npx tsc --noEmit`
Expected: nenhum erro novo.

- [ ] **Step 4: Commit**

```bash
git add mobile/hooks/useAgenda.ts
git commit -m "feat(agenda-mobile): hooks de bloqueio (dia, pendentes, criar, aprovar, recusar)"
```

---

## Task 15: Nativo — `BloqueioModal` + `PendentesBloqueioSheet` + wiring em `(empresa)/agenda.tsx`

**Files:**
- Create: `mobile/components/BloqueioModal.tsx`
- Create: `mobile/components/PendentesBloqueioSheet.tsx`
- Modify: `mobile/app/(empresa)/agenda.tsx`

**Interfaces:**
- `BloqueioModal` props: `{ visible: boolean; role: string; meuUserId: string; meuNome: string; membros: { id: string; nome: string }[]; dataInicial: Date; onClose: () => void; onSubmit: (input: Omit<MontarInsertBloqueioInput,'role'|'meuUserId'|'empresaId'>) => Promise<{ situacao: 'aprovado'|'pendente' }>; }`
- `PendentesBloqueioSheet` props: `{ visible: boolean; pendentes: (BloqueioAgenda & { autorNome: string })[]; onClose: () => void; onAprovar: (id: string) => void; onRecusar: (id: string) => void; }`

- [ ] **Step 1: Create `mobile/components/BloqueioModal.tsx`**

```tsx
import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { format } from 'date-fns';
import { X } from 'lucide-react-native';
import {
  MOTIVOS_BLOQUEIO, podeSelecionarEscopoGeral,
  type MontarInsertBloqueioInput, type EscopoBloqueio, type MotivoBloqueio,
} from '@shared/bloqueios';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', rose: '#C9527F', text: '#1A1228', text3: '#8878A6',
};

type SubmitInput = Omit<MontarInsertBloqueioInput, 'role' | 'meuUserId' | 'empresaId'>;

export function BloqueioModal({
  visible, role, meuNome, membros, dataInicial, onClose, onSubmit,
}: {
  visible: boolean;
  role: string;
  meuUserId: string;
  meuNome: string;
  membros: { id: string; nome: string }[];
  dataInicial: Date;
  onClose: () => void;
  onSubmit: (input: SubmitInput) => Promise<{ situacao: 'aprovado' | 'pendente' }>;
}) {
  const ehGestao = podeSelecionarEscopoGeral(role);
  const [escopo, setEscopo] = useState<EscopoBloqueio>('profissional');
  const [profId, setProfId] = useState('');
  const [motivo, setMotivo] = useState<MotivoBloqueio>('folga');
  const [titulo, setTitulo] = useState('');
  const [dataBl, setDataBl] = useState(format(dataInicial, 'yyyy-MM-dd'));
  const [horaIni, setHoraIni] = useState('08:00');
  const [horaFim, setHoraFim] = useState('09:00');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const di = new Date(`${dataBl}T${horaIni}:00`);
    const df = new Date(`${dataBl}T${horaFim}:00`);
    if (df <= di) { Alert.alert('Horário inválido', 'O fim deve ser após o início.'); return; }
    if (ehGestao && escopo === 'profissional' && !profId) { Alert.alert('Escolha o profissional'); return; }
    setSalvando(true);
    try {
      const { situacao } = await onSubmit({
        escopo, profissionalId: profId || null, motivo, titulo,
        dataInicio: di.toISOString(), dataFim: df.toISOString(),
      });
      setSalvando(false);
      onClose();
      if (situacao === 'pendente') Alert.alert('Pedido enviado', 'Aguardando aprovação da dona ou gestora.');
    } catch (e: any) {
      setSalvando(false);
      Alert.alert('Erro', e?.message ?? 'Não foi possível salvar.');
    }
  }

  const inputStyle = {
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 12, height: 44, fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 14, color: C.text, backgroundColor: C.bg,
  } as const;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: C.border }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>Bloquear horário</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={C.text3} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            {ehGestao ? (
              <>
                <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 12, overflow: 'hidden' }}>
                  {(['profissional', 'geral'] as EscopoBloqueio[]).map((op) => (
                    <TouchableOpacity key={op} onPress={() => setEscopo(op)}
                      style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: escopo === op ? C.primary : '#fff' }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: escopo === op ? '#fff' : C.text3 }}>
                        {op === 'profissional' ? 'Um profissional' : 'Toda a agenda'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {escopo === 'profissional' && (
                  <View style={{ gap: 6 }}>
                    {membros.map((m) => (
                      <TouchableOpacity key={m.id} onPress={() => setProfId(m.id)}
                        style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: profId === m.id ? C.primary : C.border, backgroundColor: profId === m.id ? '#EEE8F8' : '#fff' }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{m.nome}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={{ padding: 12, borderRadius: 12, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>
                  Bloqueio para <Text style={{ fontFamily: 'PlusJakartaSans_700Bold' }}>{meuNome}</Text>
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 4 }}>
                  Vai para aprovação da dona ou gestora.
                </Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {MOTIVOS_BLOQUEIO.map((m) => (
                <TouchableOpacity key={m.key} onPress={() => setMotivo(m.key)}
                  style={{ paddingHorizontal: 14, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: motivo === m.key ? C.primary : '#fff', borderWidth: 1, borderColor: motivo === m.key ? C.primary : C.border }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: motivo === m.key ? '#fff' : C.text3 }}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput value={titulo} onChangeText={setTitulo} placeholder="Detalhe (opcional)" style={inputStyle} placeholderTextColor={C.text3} />
            <TextInput value={dataBl} onChangeText={setDataBl} placeholder="AAAA-MM-DD" style={inputStyle} placeholderTextColor={C.text3} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TextInput value={horaIni} onChangeText={setHoraIni} placeholder="Início" style={[inputStyle, { flex: 1 }]} placeholderTextColor={C.text3} />
              <TextInput value={horaFim} onChangeText={setHoraFim} placeholder="Fim" style={[inputStyle, { flex: 1 }]} placeholderTextColor={C.text3} />
            </View>

            <TouchableOpacity onPress={salvar} disabled={salvando}
              style={{ height: 48, borderRadius: 14, backgroundColor: C.rose, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.6 : 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>
                {salvando ? 'Salvando...' : ehGestao ? 'Bloquear' : 'Pedir bloqueio'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
```

> Date/time as text inputs keeps this task self-contained (matches other quick mobile modals in the repo that use `mascaraData`). If the repo has a shared date-picker component, prefer it.

- [ ] **Step 2: Create `mobile/components/PendentesBloqueioSheet.tsx`**

```tsx
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { format } from 'date-fns';
import { X } from 'lucide-react-native';
import { motivoBloqueioLabel } from '@shared/bloqueios';
import type { BloqueioAgenda } from '@/hooks/useAgenda';

const C = { surface: '#FFFFFF', border: '#E8E2DC', text: '#1A1228', text3: '#8878A6', green: '#0D7E5F', red: '#C0392B' };

export function PendentesBloqueioSheet({
  visible, pendentes, onClose, onAprovar, onRecusar,
}: {
  visible: boolean;
  pendentes: (BloqueioAgenda & { autorNome: string })[];
  onClose: () => void;
  onAprovar: (id: string) => void;
  onRecusar: (id: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: C.border }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>Bloqueios pendentes</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={C.text3} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {pendentes.length === 0 && (
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, textAlign: 'center', paddingVertical: 20 }}>
                Nada pendente.
              </Text>
            )}
            {pendentes.map((b) => (
              <View key={b.id} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>{b.autorNome}</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                  {format(new Date(b.data_inicio), 'dd/MM HH:mm')}–{format(new Date(b.data_fim), 'HH:mm')} · {motivoBloqueioLabel(b.motivo)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <TouchableOpacity onPress={() => onAprovar(b.id)}
                    style={{ flex: 1, height: 34, borderRadius: 8, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Aprovar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onRecusar(b.id)}
                    style={{ flex: 1, height: 34, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.red }}>Recusar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 3: Wire into `mobile/app/(empresa)/agenda.tsx`**

- Import at top:

```typescript
import { useState } from 'react';
import { Ban } from 'lucide-react-native';
import { useAuthStore } from '@/stores/authStore';
import {
  useBloqueiosDia, useBloqueiosPendentes, useCriarBloqueio,
  useAprovarBloqueio, useRecusarBloqueio,
} from '@/hooks/useAgenda';
import { useProfissionais } from '@/hooks/useAgenda'; // já importado — merge
import { BloqueioModal } from '@/components/BloqueioModal';
import { PendentesBloqueioSheet } from '@/components/PendentesBloqueioSheet';
import { motivoBloqueioLabel } from '@shared/bloqueios';
```

- Inside the component:

```typescript
  const { user, roleAtivo, isOwner } = useAuthStore();
  const meuRole = isOwner ? 'owner' : (roleAtivo ?? 'gestor');
  const { data: bloqueios = [] } = useBloqueiosDia(diaSelecionado);
  const { data: pendentes = [] } = useBloqueiosPendentes();
  const { data: profissionaisLista = [] } = useProfissionais();
  const criarBloqueio = useCriarBloqueio();
  const aprovar = useAprovarBloqueio();
  const recusar = useRecusarBloqueio();
  const [modalBloqueio, setModalBloqueio] = useState(false);
  const [sheetPendentes, setSheetPendentes] = useState(false);

  const bloqueiosPorHora: Record<number, typeof bloqueios> = {};
  bloqueios.forEach((b) => {
    const h = new Date(b.data_inicio).getHours();
    (bloqueiosPorHora[h] ||= []).push(b);
  });
```

- Add the buttons near the "+ Novo" button (~line 285-292):

```tsx
            <TouchableOpacity onPress={() => setModalBloqueio(true)}
              style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#E8E2DC', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ban size={14} color="#C9527F" strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C9527F' }}>Bloquear</Text>
            </TouchableOpacity>
            {pendentes.length > 0 && (
              <TouchableOpacity onPress={() => setSheetPendentes(true)}
                style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#FEF3E2', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#B45309' }}>Pendentes ({pendentes.length})</Text>
              </TouchableOpacity>
            )}
```

- In the `HORAS.map` timeline loop, after the appointments for that hour, render the blocks:

```tsx
                  {(bloqueiosPorHora[hora] ?? []).map((b) => (
                    <View key={b.id} style={{
                      borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,82,127,0.35)',
                      backgroundColor: b.situacao === 'pendente' ? 'rgba(201,82,127,0.06)' : '#FDF0F5',
                      padding: 10, marginBottom: 6,
                    }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C9527F' }}>
                        {b.titulo || motivoBloqueioLabel(b.motivo)}
                      </Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: '#8878A6' }}>
                        {format(new Date(b.data_inicio), 'HH:mm')}–{format(new Date(b.data_fim), 'HH:mm')}
                        {b.situacao === 'pendente' ? '  · aguardando aprovação' : ''}
                      </Text>
                    </View>
                  ))}
```

- Before the closing tag of the screen, render the modals:

```tsx
      <BloqueioModal
        visible={modalBloqueio}
        role={meuRole}
        meuUserId={user?.id ?? ''}
        meuNome={user?.nome ?? 'Você'}
        membros={profissionaisLista.map((p: any) => ({ id: p.id, nome: p.nome }))}
        dataInicial={diaSelecionado}
        onClose={() => setModalBloqueio(false)}
        onSubmit={async (input) => {
          const r = await criarBloqueio.mutateAsync(input);
          return { situacao: r.situacao };
        }}
      />
      <PendentesBloqueioSheet
        visible={sheetPendentes}
        pendentes={pendentes}
        onClose={() => setSheetPendentes(false)}
        onAprovar={(id) => aprovar.mutate(id)}
        onRecusar={(id) => recusar.mutate(id)}
      />
```

> Adjust variable names (`diaSelecionado`, `profissionaisLista`) to whatever the file already uses. Verify `useProfissionais` returns objects with `id`/`nome`; if it returns `{ user_id, nome }` map accordingly.

- [ ] **Step 4: Typecheck (mobile baseline)**

Run: `cd mobile && npx tsc --noEmit`
Expected: nenhum erro novo.

- [ ] **Step 5: Commit**

```bash
git add mobile/components/BloqueioModal.tsx mobile/components/PendentesBloqueioSheet.tsx "mobile/app/(empresa)/agenda.tsx"
git commit -m "feat(agenda-mobile/empresa): criar bloqueio + aprovar/recusar pendentes"
```

---

## Task 16: Nativo — bloqueio na agenda da profissional

**Files:**
- Modify: `mobile/hooks/useProfissional.ts`
- Modify: `mobile/app/(profissional)/agenda.tsx`

**Interfaces:**
- Consumes: `supabase`, `useAuthStore` (`user`, `empresaAtiva`), `@shared/bloqueios`, `BloqueioModal` (Task 15).
- Produces:
  - `useBloqueiosProfissionalDia(dia: Date)` → `{ data: BloqueioAgenda[]; refetch }` (reusa o type de `@/hooks/useAgenda`)
  - `useCriarBloqueioProfissional()` → mutation `mutateAsync(input)` (mesma shape do `useCriarBloqueio`)

- [ ] **Step 1: Add hooks to `mobile/hooks/useProfissional.ts`**

```typescript
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { startOfDay, endOfDay, format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { montarInsertBloqueio, type MontarInsertBloqueioInput } from '@shared/bloqueios';
import type { BloqueioAgenda } from '@/hooks/useAgenda';

const COLS = 'id, profissional_id, titulo, motivo, escopo, situacao, criado_por, data_inicio, data_fim';

export function useBloqueiosProfissionalDia(dia: Date) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  return useQuery({
    queryKey: ['bloqueios-prof-dia', empresaId, format(dia, 'yyyy-MM-dd')],
    enabled: !!empresaId,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<BloqueioAgenda[]> => {
      const { data, error } = await supabase
        .from('agenda_bloqueios').select(COLS)
        .eq('empresa_id', empresaId)
        .lte('data_inicio', endOfDay(dia).toISOString())
        .gte('data_fim', startOfDay(dia).toISOString());
      if (error) throw error;
      return (data ?? []) as BloqueioAgenda[];
    },
  });
}

export function useCriarBloqueioProfissional() {
  const { empresaAtiva, user } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<MontarInsertBloqueioInput, 'role' | 'meuUserId' | 'empresaId'>,
    ) => {
      const insert = montarInsertBloqueio({
        ...input, role: 'profissional', meuUserId: user!.id, empresaId: empresaAtiva!.id,
      });
      const { data, error } = await supabase
        .from('agenda_bloqueios').insert(insert).select('id, situacao').single();
      if (error) throw error;
      return data as { id: string; situacao: 'aprovado' | 'pendente' };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bloqueios-prof-dia'] }),
  });
}
```

> Merge imports with whatever the file already imports (it likely already has `useQuery`, `supabase`, `useAuthStore`).

- [ ] **Step 2: Wire into `mobile/app/(profissional)/agenda.tsx`**

- Imports:

```typescript
import { Ban } from 'lucide-react-native';
import { BloqueioModal } from '@/components/BloqueioModal';
import { useBloqueiosProfissionalDia, useCriarBloqueioProfissional } from '@/hooks/useProfissional';
import { motivoBloqueioLabel } from '@shared/bloqueios';
```

- In the component (`AgendaProfissional`), after the existing hooks:

```typescript
  const { data: bloqueios = [] } = useBloqueiosProfissionalDia(diaSelecionado);
  const criarBloqueio = useCriarBloqueioProfissional();
  const [modalBloqueio, setModalBloqueio] = useState(false);

  const bloqueiosPorHora: Record<number, typeof bloqueios> = {};
  bloqueios.forEach((b) => {
    const h = new Date(b.data_inicio).getHours();
    (bloqueiosPorHora[h] ||= []).push(b);
  });
```

- Add a "Bloquear" button in the hero/header area (near the month nav or below the weekly strip — a full-width secondary button is fine):

```tsx
        <View style={{ marginHorizontal: 24, marginBottom: 12 }}>
          <TouchableOpacity onPress={() => setModalBloqueio(true)}
            style={{ height: 42, borderRadius: 12, borderWidth: 1, borderColor: '#E8E2DC', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff' }}>
            <Ban size={14} color="#C9527F" strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#C9527F' }}>Bloquear horário</Text>
          </TouchableOpacity>
        </View>
```

- In the `HORAS.map` loop, after the `ags`/`SlotVazio` block, render the blocks (pending = striped look via low-opacity bg):

```tsx
                  {(bloqueiosPorHora[hora] ?? []).map((b) => (
                    <View key={b.id} style={{
                      borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,82,127,0.35)',
                      backgroundColor: b.situacao === 'pendente' ? 'rgba(201,82,127,0.06)' : '#FDF0F5',
                      padding: 10, marginBottom: 6,
                    }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C9527F' }}>
                        {b.titulo || motivoBloqueioLabel(b.motivo)}
                      </Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: '#8878A6' }}>
                        {format(new Date(b.data_inicio), 'HH:mm')}–{format(new Date(b.data_fim), 'HH:mm')}
                        {b.situacao === 'pendente' ? '  · aguardando aprovação' : ''}
                      </Text>
                    </View>
                  ))}
```

- Render the modal (locked to self — `role="profissional"` makes `BloqueioModal` hide the escopo toggle):

```tsx
      <BloqueioModal
        visible={modalBloqueio}
        role="profissional"
        meuUserId={user?.id ?? ''}
        meuNome={user?.nome ?? 'Você'}
        membros={[]}
        dataInicial={diaSelecionado}
        onClose={() => setModalBloqueio(false)}
        onSubmit={async (input) => {
          const r = await criarBloqueio.mutateAsync(input);
          return { situacao: r.situacao };
        }}
      />
```

> `user` comes from `useAuthStore()` — the file already reads `user`. Confirm `diaSelecionado` is the state name used in this file.

- [ ] **Step 3: Typecheck (mobile baseline)**

Run: `cd mobile && npx tsc --noEmit`
Expected: nenhum erro novo.

- [ ] **Step 4: Commit**

```bash
git add mobile/hooks/useProfissional.ts "mobile/app/(profissional)/agenda.tsx"
git commit -m "feat(agenda-mobile/profissional): pedir bloqueio da propria agenda"
```

---

## Task 17: Verificação final de costura

**Files:** nenhum (só verificação; corrigir inline o que aparecer).

- [ ] **Step 1: Suite completa web**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: 100% verde, zero erros TS.

- [ ] **Step 2: Baseline mobile**

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma contagem/lista de erros capturada antes da Task 1. Se houver erro novo, corrigir.

- [ ] **Step 3: Revisão das costuras (checklist manual)**

- [ ] `montarInsertBloqueio` é a **única** montagem de `insert` de bloqueio em web e mobile (grep `escopo:` / `situacao:` fora de `shared/bloqueios.ts` não deve achar montagem manual).
- [ ] Nenhum `= ANY(minha_empresas())` novo (grep nas migrations `066`–`069`).
- [ ] Todo `.delete()`/`.update()` em `agenda_bloqueios` e `agendamentos` tem `.select(...)` + verificação de linhas afetadas.
- [ ] Guarda de papel: "Toda a agenda" e "Pendentes (N)" e "Excluir agendamento" nunca renderizam para `profissional` (checar web e mobile).
- [ ] `fetchDia` (web) e `useBloqueiosDia` (mobile) trazem `situacao` e a Timeline diferencia `pendente`.
- [ ] Notificações: os 3 tipos aparecem com rótulo na tela de notificações web (mobile: confirmar se a tela de notificações do app renderiza tipo desconhecido sem quebrar; se filtrar por whitelist, adicionar os 3).
- [ ] `docs/superpowers/specs/2026-09-02-...` seção 9 bate com o SQL final das migrations criadas.

- [ ] **Step 4: Atualizar o CLAUDE.md**

Adicionar entrada de auditoria da sessão em `CLAUDE.md` (seção "HISTÓRICO DE AUDITORIAS"), no padrão das anteriores, listando: escopo, migrations `066`–`069`, decisões (sem Realtime, excluir exceto `concluído`, `tipo_contrato` não ramifica), e pendências (aplicar migrations `062`,`063`,`066`–`069`; push notification; bloqueio impedir agendamento; visões Semana/Mês).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: auditoria da sessao de bloqueio + excluir agendamento"
```

---

## Self-Review (preenchido)

**1. Spec coverage:**
- Spec §3 (excluir agendamento) → Tasks 4, 6, 7. ✓
- Spec §4.1 (modelo de dados) → Tasks 1, 2, 3. ✓
- Spec §4.2 (notificações trigger) → Task 3. ✓
- Spec §4.3 (quase-instantâneo/30s) → Task 8 (web polling) + hooks `staleTime` 30s (Tasks 14, 16); mobile refetch on focus é `useQuery` padrão do react-query (refetchOnWindowFocus/AppState já no projeto). ✓
- Spec §4.4 (web agenda: carga, modal, pendentes, timeline) → Tasks 8, 9, 10, 11. ✓
- Spec §4.5 (Equipe tipo_contrato) → Task 12. ✓
- Spec §4.6 (nativo) → Tasks 14, 15, 16. ✓
- Spec §4.7 (helpers shared) → Tasks 4, 5. ✓
- Spec §6 (testes) → migration tests (Tasks 1-3), unit dos helpers (Tasks 4-5), source-assertions (Tasks 6, 8, 10, 12). ✓

**2. Placeholder scan:** As instruções "ajuste o nome da variável conforme o arquivo" e "mantenha a matemática de posição da Timeline" são deliberadas — o arquivo tem lógica de coordenadas que não deve ser reescrita às cegas; cada uma vem com o quê preservar e o quê inserir. Sem `TODO`/`TBD`.

**3. Type consistency:** `BloqueioInsert`/`MontarInsertBloqueioInput` (Task 5) usados iguais em Tasks 9, 14, 16. `BloqueioAgenda` definido na Task 14 e reusado por import nas Tasks 15, 16. `Bloqueio` (web) estendido na Task 8, consumido nas Tasks 9-11. `podeExcluirAgendamento(status, role)` — mesma assinatura em Tasks 4, 6, 7.

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-09-02-bloqueio-tipos-aprovacao-e-excluir-agendamento.md`.
