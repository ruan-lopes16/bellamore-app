# Permissões da profissional: agenda própria, sem estoque/despesas, serviços/pacotes só-leitura, dashboard pessoal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 4 pontos pedidos para o role `profissional` (agenda só própria, sem estoque/despesas nas notificações, serviços/pacotes visíveis mas não editáveis, dashboard pessoal como página inicial) em web e mobile, estendendo a matriz de permissões já existente em vez de criar um mecanismo novo.

**Architecture:** RLS no Postgres é a linha de defesa real (já cobre agenda/comissões/despesas desde a migration 042); esta entrega estende o mesmo padrão para a escrita de `servicos`/`pacotes`. UI (web e mobile) usa `temPermissao()` para esconder/desabilitar ações, nunca para decidir segurança por si só. O dashboard pessoal é um componente novo, isolado do dashboard da empresa (que não é tocado).

**Tech Stack:** Next.js 15 App Router (Server + Client Components), Supabase (Postgres RLS, RPC `SECURITY DEFINER`), React Native/Expo Router (mobile), Vitest.

## Global Constraints

- Nunca usar `supabase db push` — migrations ficam só nos arquivos; o usuário aplica à mão no SQL editor (ver spec, seção de riscos).
- Toda permissão nova entra em `web/lib/permissions.ts` **e** `mobile/lib/permissions.ts` (arquivos separados, sem módulo compartilhado) — mudar um sem o outro é bug.
- `produtos`/`estoque_movimentos` **não podem** ter o SELECT restringido a gestor/owner: a Comanda (web `comanda/page.tsx:273`) e o consumo de insumo dependem de qualquer membro ativo (inclusive profissional) conseguir ler `produtos`, e `estoque_movimentos: gestor pode inserir` (migration 004) já tem uma cláusula `OR` explícita liberando INSERT de `saida` pra profissional vinculada ao próprio agendamento. O requisito "estoque não aparece pra profissional" é resolvido **só na camada de UI** (Sidebar/Notificações), nunca em RLS — isso corrige uma imprecisão da spec original, que propunha RLS ali.
- `pacote_clientes` (vender) e `pacote_uso` (registrar sessão) nunca são tocados por nenhuma task — permanecem `FOR ALL` abertos a qualquer membro, exatamente como hoje.
- `npx tsc --noEmit` (dentro de `web/`) sem erros novos ao final de cada task que toca `.ts`/`.tsx`. Mobile mantém a baseline de erros pré-existente (~10, não relacionados) — nenhuma task deste plano deve adicionar erro novo lá.

---

## File Structure

**Migrations (novas, `supabase/migrations/`):**
- `078_servicos_pacotes_rls_escrita_gestor.sql` — trava INSERT/UPDATE/DELETE de `servicos`, `pacotes`, `pacote_servicos` para gestor/owner.
- `079_meta_mensal_pessoal.sql` — coluna `empresa_membros.meta_mensal_pessoal` + função `definir_minha_meta_mensal`.

**Shared (`shared/`, usado por web e mobile):**
- `dashboard-profissional.ts` (novo) — `classificarClientesReconquista`, `progressoMetaPessoal`, puras e testáveis.

**Web (`web/`):**
- `lib/permissions.ts` — modificar (novas permissões, `rotaInicial`).
- `tests/unit/permissions.test.ts` — modificar (novos casos).
- `tests/unit/supabase-security.test.ts` — modificar (asserts sobre a migration 078/079).
- `tests/unit/dashboard-profissional.test.ts` (novo) — testes do `shared/dashboard-profissional.ts`.
- `app/(app)/servicos/layout.tsx` — modificar (permissão `ver_servicos`).
- `app/(app)/servicos/page.tsx` — modificar (gating de botões + fetch de `role`).
- `app/(app)/pacotes/page.tsx` — modificar (gating de botões de catálogo + fetch de `role`).
- `components/Sidebar.tsx` — modificar (nav de Serviços/Dashboard, badge de estoque).
- `app/(app)/notificacoes/page.tsx` — modificar (esconder seção de estoque pra quem não gerencia estoque).
- `app/(app)/agenda/page.tsx` — modificar (não carregar equipe inteira pra profissional).
- `app/(app)/dashboard/layout.tsx` — modificar (aceitar profissional).
- `app/(app)/dashboard/page.tsx` — modificar (branch por role, early return).
- `app/(app)/dashboard/DashboardProfissionalView.tsx` (novo) — dashboard pessoal (Server Component).
- `app/(app)/dashboard/MetaPessoalCard.tsx` (novo) — Client Component da meta pessoal.

**Mobile (`mobile/`):**
- `lib/permissions.ts` — modificar (mesmas permissões novas, `rotaInicial`).
- `app/(empresa)/servicos.tsx` — modificar (gating por role).
- `app/(empresa)/pacotes.tsx` — modificar (gating por role, só catálogo).
- `app/(profissional)/servicos.tsx` (novo) — re-export de `(empresa)/servicos.tsx`.
- `app/(profissional)/pacotes.tsx` (novo) — re-export de `(empresa)/pacotes.tsx`.
- `app/(profissional)/inicio.tsx` (novo) — dashboard pessoal.
- `app/(profissional)/_layout.tsx` — modificar (4 abas em vez de 3).

---

### Task 1: Migration — RLS de escrita em servicos/pacotes restrita a gestor/owner

**Files:**
- Create: `supabase/migrations/078_servicos_pacotes_rls_escrita_gestor.sql`
- Modify: `web/tests/unit/supabase-security.test.ts`

**Interfaces:**
- Produces: policies `"servicos: gestor gerencia"` (INSERT/UPDATE/DELETE), `"pacotes: gestor gerencia"` (INSERT/UPDATE/DELETE), `"pacote_servicos: gestor gerencia"` (INSERT/UPDATE/DELETE) — nenhuma outra task depende do nome exato, só do efeito (profissional não escreve nessas 3 tabelas).

- [ ] **Step 1: Escrever a migration**

```sql
-- Migration 078: trava escrita de servicos/pacotes/pacote_servicos para gestor/owner
--
-- `servicos` nunca teve policy de INSERT/UPDATE/DELETE rastreada em nenhuma
-- migration (só a de SELECT, em 001_initial_schema.sql:372) — mas a feature
-- de editar serviço funciona em produção hoje, então é possível que exista
-- uma policy criada à mão no SQL editor e nunca capturada aqui (schema
-- drift, já documentado no projeto). `pacotes`/`pacote_servicos` SIM têm
-- policies rastreadas ("membro insere/atualiza/exclui", migrations
-- 005/010/034/035) abertas a qualquer role.
--
-- Por segurança contra os dois casos (policy desconhecida OU conhecida),
-- este bloco varre pg_policies e derruba TODA policy de INSERT/UPDATE/DELETE
-- dessas 3 tabelas antes de criar as novas — nomes antigos não importam.
-- Policies são somadas com OR: só adicionar uma restritiva sem remover a
-- permissiva antiga não teria efeito nenhum.

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('servicos', 'pacotes', 'pacote_servicos')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "servicos: gestor gerencia"
  on public.servicos
  for all
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

-- SELECT de servicos continua liberado pra qualquer membro (fica intacto,
-- não foi dropado acima — o loop só pega INSERT/UPDATE/DELETE).

create policy "pacotes: gestor gerencia"
  on public.pacotes
  for all
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

create policy "pacote_servicos: gestor gerencia"
  on public.pacote_servicos
  for all
  using (
    exists (
      select 1 from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and is_gestor_ou_owner(p.empresa_id)
    )
  )
  with check (
    exists (
      select 1 from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and is_gestor_ou_owner(p.empresa_id)
    )
  );

-- pacote_clientes (vender) e pacote_uso (registrar sessão) NÃO são tocados
-- aqui — continuam FOR ALL abertos a qualquer membro ativo (migration 010).
```

Salvar em `supabase/migrations/078_servicos_pacotes_rls_escrita_gestor.sql`.

> Nota: `create policy ... for all` recria SELECT também, mas como o loop
> acima só apagou INSERT/UPDATE/DELETE, a policy de SELECT original
> (`"servicos: membro ve"` / `"pacotes: membro ve"`) continua existindo em
> paralelo — Postgres permite múltiplas policies permissivas pro mesmo
> comando (OR), então SELECT continua liberado pra qualquer membro **e**
> agora também via a nova policy `for all` (redundante pra SELECT, sem
> problema). Só INSERT/UPDATE/DELETE ficam de fato restritos, porque essas
> não têm mais nenhuma outra policy depois do drop.

- [ ] **Step 2: Estender o teste de segurança estático**

Ler `web/tests/unit/supabase-security.test.ts` (arquivo atual, 1 teste) e adicionar:

```typescript
it('trava escrita de servicos/pacotes/pacote_servicos para gestor ou owner', () => {
  const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
    .join('\n');

  expect(migrations).toContain('"servicos: gestor gerencia"');
  expect(migrations).toContain('"pacotes: gestor gerencia"');
  expect(migrations).toContain('"pacote_servicos: gestor gerencia"');
});
```

Este `it` entra dentro do `describe('Supabase security migrations', ...)` já existente, como segundo teste.

- [ ] **Step 3: Rodar o teste**

Run: `cd web && npx vitest run tests/unit/supabase-security.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/078_servicos_pacotes_rls_escrita_gestor.sql web/tests/unit/supabase-security.test.ts
git commit -m "feat(rls): trava escrita de servicos/pacotes para gestor ou owner"
```

---

### Task 2: Migration — meta mensal pessoal (coluna + RPC)

**Files:**
- Create: `supabase/migrations/079_meta_mensal_pessoal.sql`
- Modify: `web/tests/unit/supabase-security.test.ts`

**Interfaces:**
- Produces: coluna `empresa_membros.meta_mensal_pessoal numeric(10,2)`; RPC `definir_minha_meta_mensal(p_valor numeric) returns void` — chamada como `supabase.rpc('definir_minha_meta_mensal', { p_valor: valor })`. Consumida pela Task 11 (`MetaPessoalCard.tsx`) e pela Task 14 (mobile Início).

- [ ] **Step 1: Escrever a migration**

```sql
-- Migration 079: meta mensal pessoal da profissional (distinta da
-- meta_mensal da empresa, que é do dono e vive em `empresas`).
--
-- Não existe policy de UPDATE em empresa_membros que libere o próprio
-- membro alterar a própria linha (migration 043 restringe UPDATE a
-- is_gestor_ou_owner) — de propósito, pra ninguém mexer no próprio role/
-- percentual_comissao/ativo. Por isso a meta pessoal não pode ser uma
-- policy de UPDATE nova: seria ampliar esse acesso pra linha inteira.
-- Uma função SECURITY DEFINER resolve, restrita a essa única coluna e à
-- própria linha do usuário autenticado.

alter table public.empresa_membros
  add column if not exists meta_mensal_pessoal numeric(10,2);

create or replace function public.definir_minha_meta_mensal(p_valor numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_valor is not null and p_valor < 0 then
    raise exception 'Meta não pode ser negativa';
  end if;

  update public.empresa_membros
  set meta_mensal_pessoal = p_valor
  where user_id = auth.uid()
    and ativo = true;
end;
$$;

grant execute on function public.definir_minha_meta_mensal(numeric) to authenticated;
```

Salvar em `supabase/migrations/079_meta_mensal_pessoal.sql`.

- [ ] **Step 2: Estender o teste de segurança estático**

Adicionar ao mesmo `describe('Supabase security migrations', ...)`:

```typescript
it('meta pessoal só é escrita via funcao security definer restrita ao proprio usuario', () => {
  const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
    .join('\n');

  expect(migrations).toContain('meta_mensal_pessoal');
  expect(migrations).toContain('definir_minha_meta_mensal');
  expect(migrations).toMatch(/definir_minha_meta_mensal[\s\S]*?security definer/);
  // A função não pode abrir uma policy de UPDATE genérica em empresa_membros
  // — só o campo meta_mensal_pessoal, só da própria linha.
  expect(migrations).toMatch(/update public\.empresa_membros\s+set meta_mensal_pessoal/);
});
```

- [ ] **Step 3: Rodar o teste**

Run: `cd web && npx vitest run tests/unit/supabase-security.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/079_meta_mensal_pessoal.sql web/tests/unit/supabase-security.test.ts
git commit -m "feat(rls): meta mensal pessoal da profissional via funcao security definer"
```

---

### Task 3: Shared — helpers puros do dashboard pessoal

**Files:**
- Create: `shared/dashboard-profissional.ts`
- Test: `web/tests/unit/dashboard-profissional.test.ts`

**Interfaces:**
- Produces:
  - `type VisitaClienteProfissional = { clienteId: string; nome: string; ultimaVisita: string; totalVisitas: number }`
  - `type ClienteReconquista = VisitaClienteProfissional & { diasSemVisita: number }`
  - `function classificarClientesReconquista(visitas: VisitaClienteProfissional[], agora?: Date): { emRisco: ClienteReconquista[]; naoRetornou: ClienteReconquista[] }`
  - `function progressoMetaPessoal(faturamentoBrutoMes: number, metaMensalPessoal: number | null): { temMeta: boolean; percentual: number; restante: number }`
- Consumida por: Task 12 (`DashboardProfissionalView.tsx`), Task 14 (mobile Início).

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `web/tests/unit/dashboard-profissional.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  classificarClientesReconquista,
  progressoMetaPessoal,
  type VisitaClienteProfissional,
} from '@shared/dashboard-profissional';

const AGORA = new Date('2026-09-24T12:00:00Z');

function visita(over: Partial<VisitaClienteProfissional> = {}): VisitaClienteProfissional {
  return {
    clienteId: 'c1', nome: 'Cliente', ultimaVisita: AGORA.toISOString(), totalVisitas: 1,
    ...over,
  };
}

describe('classificarClientesReconquista', () => {
  it('cliente com 1 visita há 30+ dias entra em "não retornou"', () => {
    const ultimaVisita = new Date(AGORA.getTime() - 31 * 86_400_000).toISOString();
    const r = classificarClientesReconquista([visita({ totalVisitas: 1, ultimaVisita })], AGORA);
    expect(r.naoRetornou).toHaveLength(1);
    expect(r.emRisco).toHaveLength(0);
    expect(r.naoRetornou[0].diasSemVisita).toBe(31);
  });

  it('cliente com 1 visita há menos de 30 dias não entra em nenhuma lista', () => {
    const ultimaVisita = new Date(AGORA.getTime() - 10 * 86_400_000).toISOString();
    const r = classificarClientesReconquista([visita({ totalVisitas: 1, ultimaVisita })], AGORA);
    expect(r.naoRetornou).toHaveLength(0);
    expect(r.emRisco).toHaveLength(0);
  });

  it('cliente com 2+ visitas e 45+ dias sem voltar entra em "em risco"', () => {
    const ultimaVisita = new Date(AGORA.getTime() - 46 * 86_400_000).toISOString();
    const r = classificarClientesReconquista([visita({ totalVisitas: 3, ultimaVisita })], AGORA);
    expect(r.emRisco).toHaveLength(1);
    expect(r.naoRetornou).toHaveLength(0);
  });

  it('cliente com 2+ visitas e menos de 45 dias não entra em nenhuma lista', () => {
    const ultimaVisita = new Date(AGORA.getTime() - 20 * 86_400_000).toISOString();
    const r = classificarClientesReconquista([visita({ totalVisitas: 5, ultimaVisita })], AGORA);
    expect(r.emRisco).toHaveLength(0);
    expect(r.naoRetornou).toHaveLength(0);
  });

  it('ordena cada lista da mais atrasada para a menos atrasada', () => {
    const r = classificarClientesReconquista([
      visita({ clienteId: 'a', totalVisitas: 1, ultimaVisita: new Date(AGORA.getTime() - 31 * 86_400_000).toISOString() }),
      visita({ clienteId: 'b', totalVisitas: 1, ultimaVisita: new Date(AGORA.getTime() - 90 * 86_400_000).toISOString() }),
    ], AGORA);
    expect(r.naoRetornou.map((c) => c.clienteId)).toEqual(['b', 'a']);
  });
});

describe('progressoMetaPessoal', () => {
  it('sem meta definida, temMeta e false', () => {
    expect(progressoMetaPessoal(1000, null)).toEqual({ temMeta: false, percentual: 0, restante: 0 });
    expect(progressoMetaPessoal(1000, 0)).toEqual({ temMeta: false, percentual: 0, restante: 0 });
  });

  it('faturamento abaixo da meta calcula percentual e restante', () => {
    expect(progressoMetaPessoal(500, 1000)).toEqual({ temMeta: true, percentual: 50, restante: 500 });
  });

  it('faturamento acima da meta trava percentual em 100 e restante em 0', () => {
    expect(progressoMetaPessoal(1500, 1000)).toEqual({ temMeta: true, percentual: 100, restante: 0 });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd web && npx vitest run tests/unit/dashboard-profissional.test.ts`
Expected: FAIL com `Cannot find module '@shared/dashboard-profissional'`.

- [ ] **Step 3: Implementar `shared/dashboard-profissional.ts`**

```typescript
/**
 * Helpers puros do dashboard pessoal da profissional — sem I/O, sem
 * dependência de Supabase. As telas (web e mobile) buscam os dados e
 * chamam essas funções pra classificar/calcular.
 */

export type VisitaClienteProfissional = {
  clienteId: string;
  nome: string;
  /** ISO 8601 — data do último atendimento concluído dela com esse cliente. */
  ultimaVisita: string;
  /** Total de atendimentos concluídos dela com esse cliente (não da empresa). */
  totalVisitas: number;
};

export type ClienteReconquista = VisitaClienteProfissional & {
  diasSemVisita: number;
};

export type ReconquistaClassificacao = {
  /** Já voltou mais de uma vez, mas está há 45+ dias sem retornar. */
  emRisco: ClienteReconquista[];
  /** Veio 1 vez só e não voltou em 30+ dias — provavelmente não vai voltar sem contato. */
  naoRetornou: ClienteReconquista[];
};

const DIAS_EM_RISCO = 45;
const DIAS_NAO_RETORNOU = 30;

/**
 * Classifica os clientes que a profissional já atendeu em duas listas de
 * reconquista, mutuamente exclusivas — um cliente de 1 visita só nunca cai
 * em "em risco" mesmo que a visita tenha sido há mais de 45 dias, porque
 * "não retornou" já é o balde mais específico pra esse caso.
 */
export function classificarClientesReconquista(
  visitas: VisitaClienteProfissional[],
  agora: Date = new Date(),
): ReconquistaClassificacao {
  const emRisco: ClienteReconquista[] = [];
  const naoRetornou: ClienteReconquista[] = [];

  for (const v of visitas) {
    const diasSemVisita = Math.floor(
      (agora.getTime() - new Date(v.ultimaVisita).getTime()) / 86_400_000,
    );
    const item: ClienteReconquista = { ...v, diasSemVisita };

    if (v.totalVisitas === 1 && diasSemVisita >= DIAS_NAO_RETORNOU) {
      naoRetornou.push(item);
    } else if (v.totalVisitas >= 2 && diasSemVisita >= DIAS_EM_RISCO) {
      emRisco.push(item);
    }
  }

  emRisco.sort((a, b) => b.diasSemVisita - a.diasSemVisita);
  naoRetornou.sort((a, b) => b.diasSemVisita - a.diasSemVisita);
  return { emRisco, naoRetornou };
}

/**
 * Progresso do faturamento bruto do mês contra a meta pessoal da
 * profissional. Sem meta definida (null ou <= 0), temMeta vem false e a
 * tela decide não desenhar a barra.
 */
export function progressoMetaPessoal(
  faturamentoBrutoMes: number,
  metaMensalPessoal: number | null,
): { temMeta: boolean; percentual: number; restante: number } {
  if (!metaMensalPessoal || metaMensalPessoal <= 0) {
    return { temMeta: false, percentual: 0, restante: 0 };
  }
  const percentual = Math.min(100, Math.round((faturamentoBrutoMes / metaMensalPessoal) * 100));
  const restante = Math.max(0, metaMensalPessoal - faturamentoBrutoMes);
  return { temMeta: true, percentual, restante };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd web && npx vitest run tests/unit/dashboard-profissional.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add shared/dashboard-profissional.ts web/tests/unit/dashboard-profissional.test.ts
git commit -m "feat(shared): helpers puros de reconquista e meta pessoal do dashboard da profissional"
```

---

### Task 4: Permissões — ver_servicos, gerenciar_pacotes, rotaInicial (web + mobile)

**Files:**
- Modify: `web/lib/permissions.ts`
- Modify: `mobile/lib/permissions.ts`
- Modify: `web/tests/unit/permissions.test.ts`

**Interfaces:**
- Produces: `Permissao` ganha `'ver_servicos' | 'gerenciar_pacotes'` (web e mobile); `temPermissao(role, 'ver_servicos')` true pra `owner`/`gestor`/`profissional`; `temPermissao(role, 'gerenciar_pacotes')` true só pra `owner`/`gestor`; `rotaInicial('profissional')` retorna `/dashboard` (web) / `/(profissional)/inicio` (mobile).
- Consumida por: Task 5 (Serviços web), Task 6 (Pacotes web), Task 8 (Sidebar), Task 9 (Agenda), Task 10 (Dashboard layout), Task 13/14/15 (mobile).

- [ ] **Step 1: Editar `web/lib/permissions.ts`**

Ler o arquivo atual (63 linhas, já visto por completo nesta sessão). Aplicar:

```typescript
export type Permissao =
  | 'ver_financeiro_sensivel'
  | 'ver_despesas'
  | 'ver_resumo_financeiro'
  | 'ver_todos_agendamentos'
  | 'ver_proprios_agendamentos'
  | 'gerenciar_profissionais'
  | 'gerenciar_servicos'
  | 'ver_servicos'
  | 'gerenciar_produtos'
  | 'gerenciar_estoque'
  | 'gerenciar_pacotes'
  | 'ver_comissoes_todas'
  | 'ver_propria_comissao'
  | 'ver_todos_clientes'
  | 'ver_anamnese'
  | 'fechar_comanda'
  | 'configurar_empresa'
  | 'gerenciar_vendas';

const PERMISSOES: Record<'owner' | PerfilRole, Permissao[]> = {
  owner: [
    'ver_financeiro_sensivel', 'ver_despesas', 'ver_resumo_financeiro',
    'ver_todos_agendamentos', 'ver_proprios_agendamentos',
    'gerenciar_profissionais', 'gerenciar_servicos', 'ver_servicos', 'gerenciar_produtos',
    'gerenciar_estoque', 'gerenciar_pacotes', 'ver_comissoes_todas', 'ver_propria_comissao',
    'ver_todos_clientes', 'ver_anamnese', 'fechar_comanda', 'configurar_empresa',
    'gerenciar_vendas',
  ],
  gestor: [
    'ver_despesas', 'ver_resumo_financeiro',
    'ver_todos_agendamentos', 'ver_proprios_agendamentos',
    'gerenciar_profissionais', 'gerenciar_servicos', 'ver_servicos', 'gerenciar_produtos',
    'gerenciar_estoque', 'gerenciar_pacotes', 'ver_comissoes_todas', 'ver_propria_comissao',
    'ver_todos_clientes', 'ver_anamnese', 'fechar_comanda',
    'gerenciar_vendas',
  ],
  profissional: ['ver_proprios_agendamentos', 'ver_propria_comissao', 'ver_anamnese', 'fechar_comanda', 'ver_servicos'],
  cliente: [],
};
```

`rotaInicial`:

```typescript
export function rotaInicial(role: PerfilRole | 'owner'): string {
  switch (role) {
    case 'owner':
    case 'gestor':
    case 'profissional': return '/dashboard';
    case 'cliente':     return '/inicio';
    default:            return '/login';
  }
}
```

- [ ] **Step 2: Editar `mobile/lib/permissions.ts`**

Trocar o `type Permissao` (linhas 8-23 do arquivo atual):

```typescript
type Permissao =
  | 'ver_financeiro_sensivel'   // CNPJ, dados bancários, faturamento bruto
  | 'ver_despesas'
  | 'ver_resumo_financeiro'
  | 'ver_todos_agendamentos'
  | 'ver_proprios_agendamentos'
  | 'gerenciar_profissionais'
  | 'gerenciar_servicos'
  | 'ver_servicos'
  | 'gerenciar_produtos'
  | 'gerenciar_estoque'
  | 'gerenciar_pacotes'
  | 'ver_comissoes_todas'
  | 'ver_propria_comissao'
  | 'ver_todos_clientes'
  | 'ver_anamnese'
  | 'fechar_comanda'
  | 'configurar_empresa';
```

E o `PERMISSOES` (linhas 25-65):

```typescript
const PERMISSOES: Record<'owner' | PerfilRole, Permissao[]> = {
  owner: [
    'ver_financeiro_sensivel',
    'ver_despesas',
    'ver_resumo_financeiro',
    'ver_todos_agendamentos',
    'ver_proprios_agendamentos',
    'gerenciar_profissionais',
    'gerenciar_servicos',
    'ver_servicos',
    'gerenciar_produtos',
    'gerenciar_estoque',
    'gerenciar_pacotes',
    'ver_comissoes_todas',
    'ver_propria_comissao',
    'ver_todos_clientes',
    'ver_anamnese',
    'fechar_comanda',
    'configurar_empresa',
  ],
  gestor: [
    'ver_despesas',
    'ver_resumo_financeiro',
    'ver_todos_agendamentos',
    'ver_proprios_agendamentos',
    'gerenciar_profissionais',
    'gerenciar_servicos',
    'ver_servicos',
    'gerenciar_produtos',
    'gerenciar_estoque',
    'gerenciar_pacotes',
    'ver_comissoes_todas',
    'ver_propria_comissao',
    'ver_todos_clientes',
    'ver_anamnese',
    'fechar_comanda',
  ],
  profissional: [
    'ver_proprios_agendamentos',
    'ver_propria_comissao',
    'ver_anamnese',
    'fechar_comanda',
    'ver_servicos',
  ],
  cliente: [],
};
```

E `rotaInicial`:

```typescript
export function rotaInicial(role: PerfilRole | 'owner'): string {
  switch (role) {
    case 'owner':
    case 'gestor':
      return '/(empresa)/dashboard';
    case 'profissional':
      return '/(profissional)/inicio';
    case 'cliente':
      return '/(cliente)/inicio';
    default:
      return '/(auth)/login';
  }
}
```

- [ ] **Step 3: Atualizar `web/tests/unit/permissions.test.ts`**

Trocar o teste de `rotaInicial` (linhas 76-78 do arquivo atual):

```typescript
it('profissional vai ao dashboard (visão pessoal)', () => {
  expect(rotaInicial('profissional')).toBe('/dashboard');
});
```

E adicionar, dentro do `describe('profissional', ...)` já existente:

```typescript
it('vê a lista de serviços mas não gerencia catálogo', () => {
  expect(temPermissao('profissional', 'ver_servicos')).toBe(true);
  expect(temPermissao('profissional', 'gerenciar_servicos')).toBe(false);
  expect(temPermissao('profissional', 'gerenciar_pacotes')).toBe(false);
});
```

- [ ] **Step 4: Rodar os testes**

Run: `cd web && npx vitest run tests/unit/permissions.test.ts`
Expected: PASS.

Run: `cd web && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add web/lib/permissions.ts mobile/lib/permissions.ts web/tests/unit/permissions.test.ts
git commit -m "feat(permissions): ver_servicos, gerenciar_pacotes e dashboard como rota inicial da profissional"
```

---

### Task 5: Web — Serviços visível, não editável

**Files:**
- Modify: `web/app/(app)/servicos/layout.tsx`
- Modify: `web/app/(app)/servicos/page.tsx`

**Interfaces:**
- Consumes: `temPermissao` de `@/lib/permissions` (Task 4).
- Produces: nada consumido por outra task — folha da árvore.

- [ ] **Step 1: Trocar a permissão do layout**

`web/app/(app)/servicos/layout.tsx` (arquivo inteiro, 9 linhas):

```typescript
import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function ServicosLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'ver_servicos');
  return <>{children}</>;
}
```

(Única mudança: `'gerenciar_servicos'` → `'ver_servicos'` na chamada de `exigirPermissao`.)

- [ ] **Step 2: Buscar `role` em `ServicosPage`**

Em `web/app/(app)/servicos/page.tsx:571-611`, adicionar o state e o fetch de role:

```typescript
export default function ServicosPage() {
  const [servicos,    setServicos]    = useState<Servico[]>([]);
  const [categorias,  setCategorias]  = useState<CategoriaCustom[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [empresaId,   setEmpresaId]   = useState<string | null>(null);
  const [role,        setRole]        = useState<string | null>(null);
  const [modal,       setModal]       = useState<ModalState | null>(null);
  const [gerenciarCategorias, setGerenciarCategorias] = useState(false);
  const [colapsos,    setColapsos]    = useState<Set<string>>(new Set(CATEGORIAS.map(c => c.key)));
  const [excluindoId,   setExcluindoId]   = useState<string | null>(null);
  const [toastErro,     setToastErro]     = useState('');
  const [toastSucesso,  setToastSucesso]  = useState('');

  const podeGerenciar = temPermissao((role ?? 'profissional') as 'owner' | PerfilRole, 'gerenciar_servicos');

  function toggleColapso(key: string) {
    setColapsos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id, role')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;
      setEmpresaId(membro.empresa_id);
      setRole(membro.role);
      const [{ data: servs }, { data: cats }] = await Promise.all([
        supabase.from('servicos').select('*')
          .eq('empresa_id', membro.empresa_id).order('categoria').order('nome'),
        supabase.from('categorias_servico').select('*')
          .eq('empresa_id', membro.empresa_id).order('nome'),
      ]);
      setServicos((servs ?? []) as Servico[]);
      const catsList = (cats ?? []) as CategoriaCustom[];
      setCategorias(catsList);
      setColapsos(prev => { const n = new Set(prev); catsList.forEach(c => n.add(c.id)); return n; });
      setLoading(false);
    })();
  }, []);
```

Adicionar os imports no topo do arquivo (junto aos existentes, linha 1-20):

```typescript
import { temPermissao } from '@/lib/permissions';
import type { PerfilRole } from '@/types';
```

- [ ] **Step 3: Esconder os botões de gestão do catálogo no header**

Em `web/app/(app)/servicos/page.tsx:701-709`, envolver os dois botões de gestão (Categorias e Novo serviço) — o `ExportButton` continua sempre visível:

```tsx
          {podeGerenciar && (
            <>
              <button onClick={() => setGerenciarCategorias(true)}
                title="Gerenciar categorias"
                className="flex items-center gap-1.5 px-3 h-10 rounded-2xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
                <Tags size={15} strokeWidth={2}/> Categorias
              </button>
              <button onClick={() => setModal({ modo: 'criar' })} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
                style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)', fontFamily: 'var(--font-sans)' }}>
                <Plus size={15} strokeWidth={2.5}/> Novo serviço
              </button>
            </>
          )}
```

- [ ] **Step 4: Esconder o botão "+" por categoria e passar `podeGerenciar` pro card**

Em `web/app/(app)/servicos/page.tsx:806-814`, envolver o botão "+":

```tsx
                  {podeGerenciar && (
                    <button
                      onClick={() => setModal(grupo.categoriaId
                        ? { modo: 'criar', categoriaId: grupo.categoriaId }
                        : { modo: 'criar', categoria: grupo.categoriaKey })}
                      title={`Novo serviço em ${grupo.label}`}
                      className="w-7 h-7 rounded-xl flex items-center justify-center border transition flex-shrink-0"
                      style={{ borderColor: `${grupo.cor}40`, color: grupo.cor, background: 'var(--color-surface)' }}>
                      <Plus size={13} strokeWidth={2.5}/>
                    </button>
                  )}
```

Em `web/app/(app)/servicos/page.tsx:823-831`, passar a nova prop:

```tsx
                          <ServicoCard
                            servico={s}
                            resolvida={resolverCategoriaServico(s.categoria, s.categoria_id, categorias)}
                            podeGerenciar={podeGerenciar}
                            onToggle={() => toggleAtivo(s)}
                            onEdit={() => setModal({ modo: 'editar', servico: s })}
                            excluindo={excluindoId === s.id}
                            onDelete={() => excluindoId === s.id ? excluirServico(s) : setExcluindoId(s.id)}
                            onCancelDelete={() => setExcluindoId(null)}
                          />
```

- [ ] **Step 5: `ServicoCard` esconde as ações quando `podeGerenciar` é falso**

Em `web/app/(app)/servicos/page.tsx:481-567`, adicionar o prop e envolver o bloco de ações (linhas 525-562 do arquivo atual):

```tsx
function ServicoCard({ servico, resolvida, podeGerenciar, onToggle, onEdit, onDelete, onCancelDelete, excluindo }: {
  servico: Servico;
  resolvida: CategoriaResolvida;
  podeGerenciar: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  excluindo: boolean;
}) {
```

E, dentro do JSX, trocar o bloco de ações:

```tsx
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!podeGerenciar ? null : excluindo ? (
              <>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-rose)', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>Excluir?</span>
                <button onClick={onDelete} aria-label="Confirmar exclusão"
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition"
                  style={{ background: 'var(--color-rose)', color: '#fff' }}>
                  <Trash2 size={13} strokeWidth={2.5}/>
                </button>
                <button onClick={onCancelDelete} aria-label="Cancelar"
                  className="w-8 h-8 rounded-lg border border-border text-text-4 hover:bg-bg flex items-center justify-center transition">
                  <X size={13} strokeWidth={2.5}/>
                </button>
              </>
            ) : (
              <>
                <button onClick={onEdit} aria-label="Editar serviço"
                  className="w-8 h-8 rounded-lg border border-border text-text-4 hover:bg-bg hover:text-text-2 flex items-center justify-center transition">
                  <Edit3 size={13} strokeWidth={2}/>
                </button>
                <button onClick={onDelete} aria-label="Excluir serviço"
                  className="w-8 h-8 rounded-lg border border-border text-text-4 hover:bg-rose-soft hover:text-rose flex items-center justify-center transition">
                  <Trash2 size={13} strokeWidth={2}/>
                </button>
                <button
                  onClick={onToggle}
                  aria-label={servico.ativo ? 'Desativar serviço' : 'Ativar serviço'}
                  title={servico.ativo ? 'Desativar' : 'Ativar'}
                  className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-1 ${
                    servico.ativo ? 'bg-green' : 'bg-border'
                  }`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-200 ${
                    servico.ativo ? 'left-[18px]' : 'left-0.5'
                  }`}/>
                </button>
              </>
            )}
          </div>
```

- [ ] **Step 6: Verificar tipos e rodar a suíte**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros novos.

Run: `cd web && npx vitest run`
Expected: PASS (sem regressão nos testes existentes).

- [ ] **Step 7: Commit**

```bash
git add web/app/\(app\)/servicos/layout.tsx web/app/\(app\)/servicos/page.tsx
git commit -m "feat(servicos): profissional ve o catalogo mas so gestor/owner edita"
```

---

### Task 6: Web — Pacotes: catálogo travado, venda/sessão livres

**Files:**
- Modify: `web/app/(app)/pacotes/page.tsx`

**Interfaces:**
- Consumes: `temPermissao` de `@/lib/permissions` (Task 4).

- [ ] **Step 1: Buscar `role` junto com `empresaId`**

Em `web/app/(app)/pacotes/page.tsx:733-773` (topo de `PacotesPage`), adicionar o state e trocar o `select`:

```typescript
export default function PacotesPage() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [role,      setRole]      = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [aba,       setAba]       = useState<'catalogo' | 'vendidos' | 'relatorio'>('catalogo');

  // ... (demais states inalterados) ...

  const podeGerenciarCatalogo = temPermissao((role ?? 'profissional') as 'owner' | PerfilRole, 'gerenciar_pacotes');

  // ── Carregar empresa
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('empresa_membros').select('empresa_id, role')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (data) { setEmpresaId(data.empresa_id); setRole(data.role); }
    })();
  }, []);
```

Adicionar os imports no topo do arquivo:

```typescript
import { temPermissao } from '@/lib/permissions';
import type { PerfilRole } from '@/types';
```

- [ ] **Step 2: Esconder "Novo pacote" no header**

Em `web/app/(app)/pacotes/page.tsx:1018-1021`, envolver o botão (ele hoje é irmão dos três `ExportButton` condicionais por aba, sempre visível):

```tsx
          {podeGerenciarCatalogo && (
            <button onClick={() => setModalPacote('novo')}
              className="flex items-center gap-2 h-10 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition shadow-sm">
              <Plus size={16}/> Novo pacote
            </button>
          )}
```

- [ ] **Step 3: Esconder "Criar primeiro pacote" no estado vazio**

Em `web/app/(app)/pacotes/page.tsx:1068-1076`:

```tsx
        ) : pacotes.length === 0 ? (
          <div className="text-center py-16">
            <Gift size={36} className="mx-auto mb-3 text-text-4"/>
            <p className="text-text-3 text-sm">Nenhum pacote criado ainda.</p>
            {podeGerenciarCatalogo && (
              <button onClick={() => setModalPacote('novo')}
                className="mt-4 px-5 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition">
                Criar primeiro pacote
              </button>
            )}
          </div>
        ) : (
```

- [ ] **Step 4: Esconder editar/ativar-desativar/excluir do catálogo, manter "Vender"**

Em `web/app/(app)/pacotes/page.tsx:1122-1145`:

```tsx
                  {/* Ações */}
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() => p.ativo && p.servicos.length > 0 && setModalVender(p)}
                      disabled={!p.ativo || p.servicos.length === 0}
                      title={p.servicos.length === 0 ? 'Adicione serviços antes de vender' : ''}
                      className="flex-1 h-8 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition disabled:opacity-40">
                      {p.servicos.length === 0 ? '⚠ Sem serviços' : 'Vender'}
                    </button>
                    {podeGerenciarCatalogo && (
                      <>
                        <button onClick={() => setModalPacote(p)}
                          className="w-8 h-8 rounded-lg border border-border hover:bg-bg flex items-center justify-center text-text-3 transition">
                          <Edit3 size={13}/>
                        </button>
                        <button onClick={() => toggleAtivo(p)}
                          title={p.ativo ? 'Desativar' : 'Reativar'}
                          className="w-8 h-8 rounded-lg border border-border hover:bg-bg flex items-center justify-center text-text-3 transition">
                          {p.ativo ? <X size={13}/> : <Check size={13}/>}
                        </button>
                        <button onClick={() => pedirExclusao(p)}
                          title="Excluir pacote"
                          className="w-8 h-8 rounded-lg border border-border hover:bg-red-soft hover:border-red/30 flex items-center justify-center text-text-3 hover:text-red transition">
                          <Trash2 size={13}/>
                        </button>
                      </>
                    )}
                  </div>
```

Nenhuma mudança na aba "Vendidos" (vender, gerenciar sessões, excluir venda) nem no `SessoesModal` — ficam abertos pra qualquer role, como já são hoje.

- [ ] **Step 5: Verificar tipos e rodar a suíte**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/pacotes/page.tsx
git commit -m "feat(pacotes): trava edicao do catalogo para gestor/owner, mantem venda e sessoes livres"
```

---

### Task 7: Web — estoque some das notificações/badge da profissional

**Files:**
- Modify: `web/components/Sidebar.tsx`
- Modify: `web/app/(app)/notificacoes/page.tsx`

**Interfaces:**
- Consumes: `temPermissao` de `@/lib/permissions` (já importado em `Sidebar.tsx`; novo em `notificacoes/page.tsx`).

> `despesas` já não aparece pra profissional (RLS, migration 042 — já em produção). Este task só cobre estoque, que ainda não tem proteção nenhuma (nem RLS, nem UI) — ver Global Constraints sobre por que a correção é na UI, não em RLS.

- [ ] **Step 1: Sidebar — não contar estoque baixo pra quem não gerencia estoque**

Em `web/components/Sidebar.tsx:93-123`, trocar o `useEffect` do `alertCount`:

```typescript
  const efetivo = (role ?? 'profissional') as 'owner' | PerfilRole;
  const podeVerEstoque = temPermissao(efetivo, 'gerenciar_estoque');
  const navFiltrado          = NAV.filter(item => !item.permissao || temPermissao(efetivo, item.permissao));
  const bottomNavFiltrado    = BOTTOM_NAV_DESKTOP.filter(item => !item.permissao || temPermissao(efetivo, item.permissao));
  const mobileNavFiltrado    = MOBILE_NAV.filter(item => !item.permissao || temPermissao(efetivo, item.permissao));
  const maisNavFiltrado      = MAIS_NAV.filter(item => !item.permissao || temPermissao(efetivo, item.permissao));

  useEffect(() => {
    (async () => {
      const hoje   = new Date().toISOString().slice(0, 10);
      const daqui7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const [estoque, despesas, comissoes, comandas] = await Promise.all([
        podeVerEstoque
          ? supabase.from('v_produtos_estoque_baixo').select('id', { count: 'exact', head: true })
              .eq('empresa_id', empresaId).eq('ativo', true)
          : Promise.resolve({ count: 0 } as { count: number | null }),
        supabase.from('despesas').select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresaId).eq('status', 'pendente')
          .gte('data_vencimento', hoje).lte('data_vencimento', daqui7),
        supabase.from('comissoes').select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresaId).eq('status', 'pendente'),
        supabase.from('agendamentos').select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresaId).is('comanda_id', null)
          .not('status', 'in', '("cancelado","faltou")')
          .lt('data_hora_fim', new Date().toISOString()),
      ]);

      const comCount = comissoes.count ?? 0;
      const comandasCount = comandas.count ?? 0;
      setComissoesCount(comCount);
      setComandasAbertasCount(comandasCount);
      const total = (estoque.count ?? 0) + (despesas.count ?? 0) + (comCount > 0 ? 1 : 0) + (comandasCount > 0 ? 1 : 0);
      setAlertCount(total);
    })();
  }, [empresaId, podeVerEstoque]);
```

(Mudança: a query de `v_produtos_estoque_baixo` só roda quando `podeVerEstoque`; senão resolve direto pra `{ count: 0 }`. `podeVerEstoque` entra no array de dependências do efeito.)

- [ ] **Step 2: Notificações — buscar `role` e esconder a seção de estoque**

Em `web/app/(app)/notificacoes/page.tsx`, adicionar os imports (topo do arquivo, junto aos existentes):

```typescript
import { temPermissao } from '@/lib/permissions';
import type { PerfilRole } from '@/types';
```

Em `web/app/(app)/notificacoes/page.tsx:92-152`, trocar o `select` do membro e tornar a query de estoque condicional:

```typescript
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membro } = await supabase
        .from('empresa_membros').select('empresa_id, role')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;

      const empId = membro.empresa_id;
      setEmpresaId(empId);
      const podeVerEstoque = temPermissao((membro.role ?? 'profissional') as 'owner' | PerfilRole, 'gerenciar_estoque');

      const hoje      = new Date();
      const hojeStr   = hoje.toISOString().slice(0, 10);
      const daqui7    = new Date(hoje.getTime() + 7 * 86400000).toISOString().slice(0, 10);
      const fimDia    = new Date(hojeStr + 'T23:59:59').toISOString();

      const [rAgs, rEstoque, rDespesas, rComissoes, rClientes, rNotifs] = await Promise.all([
        // Agendamentos de hoje ainda não concluídos
        supabase.from('agendamentos')
          .select('id, data_hora_inicio, status, cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)')
          .eq('empresa_id', empId)
          .gte('data_hora_fim', hoje.toISOString())
          .lte('data_hora_inicio', fimDia)
          .not('status', 'in', '("concluido","cancelado","faltou")')
          .order('data_hora_inicio'),

        // Estoque abaixo do mínimo — só pra quem gerencia estoque
        podeVerEstoque
          ? supabase.from('v_produtos_estoque_baixo')
              .select('id, nome, estoque_atual, estoque_minimo')
              .eq('empresa_id', empId).eq('ativo', true)
          : Promise.resolve({ data: [] as { id: string; nome: string; estoque_atual: number; estoque_minimo: number }[] }),

        // Despesas pendentes vencendo em 7 dias
        supabase.from('despesas')
          .select('id, descricao, valor, data_vencimento')
          .eq('empresa_id', empId).eq('status', 'pendente')
          .gte('data_vencimento', hojeStr)
          .lte('data_vencimento', daqui7)
          .order('data_vencimento'),

        // Comissões pendentes
        supabase.from('comissoes')
          .select('id, valor_comissao, profissional:users!comissoes_profissional_id_fkey(nome)')
          .eq('empresa_id', empId).eq('status', 'pendente'),

        // Clientes aniversariantes esta semana
        supabase.from('clientes')
          .select('id, nome, data_nascimento')
          .eq('empresa_id', empId).eq('ativo', true)
          .not('data_nascimento', 'is', null),

        // Notificações salvas
        supabase.from('notificacoes')
          .select('id, tipo, titulo, mensagem, lida, created_at')
          .eq('empresa_id', empId)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);
```

O resto da função (montagem de `lista`/`listaAg`, incluindo o bloco de "Estoque baixo" que empurra pra `lista`) fica **sem mudança nenhuma** — como `rEstoque.data` já vem `[]` pra profissional, o `estBaixo.forEach(...)` simplesmente não adiciona nada.

- [ ] **Step 3: Verificar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add web/components/Sidebar.tsx web/app/\(app\)/notificacoes/page.tsx
git commit -m "fix(notificacoes): esconde estoque baixo do badge e da tela para quem nao gerencia estoque"
```

---

### Task 8: Web — Agenda só a própria pra profissional

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Nenhuma interface nova consumida/produzida — a RLS (migration 042, já em produção) já garante que `ags` só traga linhas da própria profissional; esta task só evita que a UI busque/mostre colunas de equipe que sempre vêm vazias pra ela.

- [ ] **Step 1: Buscar só o próprio nome quando não é gestão**

Em `web/app/(app)/agenda/page.tsx:2030-2057`, trocar o `useEffect` inicial:

```typescript
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id, role')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      setEmpresaId(membro?.empresa_id ?? null);
      setMeuUserId(user.id);
      setMeuRole((membro?.role as string) ?? 'profissional');
      if (membro?.empresa_id) {
        const souGestao = membro.role === 'owner' || membro.role === 'gestor';
        const [{ data: cats }, { data: profs }] = await Promise.all([
          supabase.from('categorias_servico').select('*')
            .eq('empresa_id', membro.empresa_id).order('nome'),
          souGestao
            ? supabase.from('empresa_membros').select('user_id, user:users(id, nome)')
                .eq('empresa_id', membro.empresa_id)
                .in('role', ['owner', 'gestor', 'profissional']).eq('ativo', true)
            : supabase.from('empresa_membros').select('user_id, user:users(id, nome)')
                .eq('empresa_id', membro.empresa_id).eq('user_id', user.id).limit(1),
        ]);
        setCategoriasCustom((cats ?? []) as CategoriaCustom[]);
        const membrosMapeados = ((profs ?? []) as any[])
          .map((m) => ({ id: m.user?.id, nome: m.user?.nome }))
          .filter((m: { id?: string; nome?: string }) => m.id && m.nome);
        setMembrosAtivos(membrosMapeados);
        setProfissionaisEmpresa(
          [...membrosMapeados].sort((a, b) => a.nome.localeCompare(b.nome)),
        );
      }
    })();
  }, []);
```

(Mudança: quando `!souGestao`, a query de membros filtra `eq('user_id', user.id)` em vez de trazer a empresa inteira — profissional nunca sabe quem são as colegas por essa tela. A Timeline, que já mescla `profissionaisEmpresa` com quem aparece em `ags` — `agenda/page.tsx:1524-1531` — continua funcionando sem mudança: com `profissionaisEmpresa = [ela mesma]`, sempre sobra pelo menos uma coluna, mesmo em dias sem agendamento.)

- [ ] **Step 2: Filtrar `fetchDia` explicitamente por profissional_id quando não é gestão**

Em `web/app/(app)/agenda/page.tsx:2060-2089`, trocar `fetchDia`:

```typescript
  const fetchDia = useCallback(async (data: Date, empId: string) => {
    setLoading(true);
    const iniDia = startOfDay(data).toISOString();
    const fimDia = endOfDay(data).toISOString();
    const souGestao = meuRole === 'owner' || meuRole === 'gestor';

    let queryAgs = supabase
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
      .order('data_hora_inicio');
    if (!souGestao && meuUserId) queryAgs = queryAgs.eq('profissional_id', meuUserId);

    const [{ data: rows }, { data: blRows }] = await Promise.all([
      queryAgs,
      supabase
        .from('agenda_bloqueios')
        .select('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por')
        .eq('empresa_id', empId)
        .lte('data_inicio', fimDia)
        .gte('data_fim',    iniDia),
    ]);

    setAgs((rows ?? []) as unknown as Ag[]);
    setBloqueios((blRows ?? []) as Bloqueio[]);
    setLoading(false);
  }, [meuRole, meuUserId]);
```

(A RLS já filtrava isso por trás — este `.eq('profissional_id', meuUserId)` deixa a intenção explícita no código e evita depender só do banco pra esse comportamento, como a spec pedia.)

- [ ] **Step 3: Verificar tipos e testar manualmente**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros novos.

Como não há conta de teste com role `profissional` disponível localmente (mesma limitação de sessões anteriores, ver CLAUDE.md), a verificação visual entra na Task 15 (checklist manual final).

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/agenda/page.tsx
git commit -m "feat(agenda): profissional carrega e ve so a propria coluna na timeline"
```

---

### Task 9: Web — Dashboard: libera acesso e cria a visão pessoal (base)

**Files:**
- Modify: `web/app/(app)/dashboard/layout.tsx`
- Modify: `web/app/(app)/dashboard/page.tsx`
- Create: `web/app/(app)/dashboard/DashboardProfissionalView.tsx`

**Interfaces:**
- Consumes: `AppContext` (tipo) de `@/lib/auth/server-context`; `temPermissao`/`rotaInicial` de `@/lib/permissions` (Task 4).
- Produces: `DashboardProfissionalView({ supabase, empresaId, userId })` — Server Component. Tasks 10 e 11 editam este mesmo arquivo pra acrescentar a meta pessoal e a reconquista, respectivamente.

- [ ] **Step 1: Layout aceita profissional**

`web/app/(app)/dashboard/layout.tsx` (arquivo inteiro):

```typescript
import { redirect } from 'next/navigation';
import { getAppContext } from '@/lib/auth/server-context';
import { temPermissao, rotaInicial } from '@/lib/permissions';
import type { PerfilRole } from '@/types';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  const efetivo = (role ?? 'profissional') as 'owner' | PerfilRole;
  const podeAcessar = temPermissao(efetivo, 'ver_resumo_financeiro') || temPermissao(efetivo, 'ver_proprios_agendamentos');
  if (!podeAcessar) redirect(rotaInicial(efetivo));
  return <>{children}</>;
}
```

- [ ] **Step 2: `DashboardPage` bifurca por role antes de qualquer query de empresa**

Em `web/app/(app)/dashboard/page.tsx`, adicionar aos imports do topo (junto aos existentes, linhas 1-22):

```typescript
import { temPermissao } from '@/lib/permissions';
import type { PerfilRole } from '@/types';
import DashboardProfissionalView from './DashboardProfissionalView';
```

Em `web/app/(app)/dashboard/page.tsx:87-90`, trocar a abertura da função:

```typescript
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { supabase, empresaId, empresa, user, role } = await getAppContext();

  const efetivo = (role ?? 'profissional') as 'owner' | PerfilRole;
  if (!temPermissao(efetivo, 'ver_resumo_financeiro')) {
    return <DashboardProfissionalView supabase={supabase} empresaId={empresaId} userId={user.id} />;
  }

  // Brazil is UTC-3 (no DST since 2019). Shift so getUTC* returns Brazil local values.
  const hoje     = new Date(Date.now() - 3 * 60 * 60 * 1000);
```

O resto de `DashboardPage` (todas as queries e o JSX do dashboard da empresa) **não muda uma linha** — o `return` antecipado garante que nenhuma dessas queries roda pra profissional, e o comportamento pra owner/gestor é idêntico ao de hoje.

- [ ] **Step 3: Criar `DashboardProfissionalView.tsx` (base: agenda de hoje + faturamento + comissão do mês)**

```tsx
import Link from 'next/link';
import { CalendarDays, Wallet, BadgeDollarSign } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Secret, PrivacyToggle } from '@/components/privacy';
import type { AppContext } from '@/lib/auth/server-context';

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

const STATUS_LABEL: Record<string, string> = {
  agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído', faltou: 'Faltou',
};

/**
 * Dashboard pessoal da profissional — números dela, não da empresa.
 * "Fat. bruto do mês" soma valor_servico (preço do serviço, não a
 * comissão) das próprias comissões do mês — mesma tabela que a tela de
 * Comissões já usa, sem query nova pesada.
 */
export default async function DashboardProfissionalView({
  supabase, empresaId, userId,
}: {
  supabase: AppContext['supabase'];
  empresaId: string;
  userId: string;
}) {
  // Brazil is UTC-3 (sem DST desde 2019).
  const hoje     = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const diaLabel = format(hoje, "EEEE, d 'de' MMMM", { locale: ptBR });
  const brYear   = hoje.getUTCFullYear();
  const brMonth  = hoje.getUTCMonth();
  const brDate   = hoje.getUTCDate();
  const inicioHoje = new Date(Date.UTC(brYear, brMonth, brDate, 3, 0, 0, 0)).toISOString();
  const fimHoje    = new Date(Date.UTC(brYear, brMonth, brDate + 1, 3, 0, 0, 0) - 1).toISOString();
  const mesRef   = new Date(brYear, brMonth, 1);
  const inicioMes = startOfMonth(mesRef).toISOString();
  const fimMes     = endOfMonth(mesRef).toISOString();

  const [{ data: agendaHoje }, { data: comissoesMes }] = await Promise.all([
    supabase.from('agendamentos')
      .select('id, data_hora_inicio, status, valor, cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)')
      .eq('empresa_id', empresaId).eq('profissional_id', userId)
      .gte('data_hora_inicio', inicioHoje).lte('data_hora_inicio', fimHoje)
      .neq('status', 'cancelado')
      .order('data_hora_inicio'),
    supabase.from('comissoes')
      .select('valor_servico, valor_comissao, status')
      .eq('empresa_id', empresaId).eq('profissional_id', userId)
      .gte('created_at', inicioMes).lte('created_at', fimMes),
  ]);

  const ags     = (agendaHoje ?? []) as any[];
  const fatHoje = ags.reduce((s, a) => s + Number(a.valor), 0);

  const comMes              = comissoesMes ?? [];
  const faturamentoBrutoMes = comMes.reduce((s, c) => s + Number(c.valor_servico), 0);
  const comissaoPagaMes     = comMes.filter(c => c.status === 'pago').reduce((s, c) => s + Number(c.valor_comissao), 0);
  const comissaoPendenteMes = comMes.filter(c => c.status === 'pendente').reduce((s, c) => s + Number(c.valor_comissao), 0);
  const atendimentosMes     = comMes.length;

  return (
    <div className="bm-page">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>
            {diaLabel}
          </p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
            Minha agenda
          </h1>
        </div>
        <PrivacyToggle />
      </div>

      {/* KPIs do dia/mês */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-7">
        {[
          { label: 'Agenda hoje',       value: String(ags.length), sub: `${ags.filter(a => a.status === 'concluido').length} concluído(s)`, icon: CalendarDays, color: 'var(--color-accent)' },
          { label: 'Fat. hoje',         value: fmt(fatHoje),               sub: 'Meus atendimentos',                                          icon: Wallet,       color: 'var(--color-primary)' },
          { label: 'Fat. bruto do mês', value: fmt(faturamentoBrutoMes),   sub: `${atendimentosMes} atendimento(s)`,                          icon: Wallet,       color: 'var(--color-primary)' },
          { label: 'Comissão do mês',   value: fmt(comissaoPagaMes + comissaoPendenteMes), sub: comissaoPendenteMes > 0 ? `${fmt(comissaoPendenteMes)} pendente` : 'Em dia', icon: BadgeDollarSign, color: 'var(--color-amber)' },
        ].map(({ label, value, sub, icon: Icon, color }, i) => (
          <div key={label} className="rounded-2xl p-3 md:p-5 bm-stagger min-w-0"
            style={{ '--bm-i': i, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' } as React.CSSProperties}>
            <div className="flex items-start justify-between mb-2 gap-1">
              <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
              <Icon size={12} style={{ color, opacity: 0.7, flexShrink: 0 }} strokeWidth={2} />
            </div>
            <p className="whitespace-nowrap tabular-nums" style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 700, color, letterSpacing: '-0.03em', lineHeight: 1 }}><Secret>{value}</Secret></p>
            <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--color-ink4)', marginTop: 4 }}><Secret>{sub}</Secret></p>
          </div>
        ))}
      </div>

      {/* Agenda de hoje */}
      <div className="mb-7">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
          Atendimentos de hoje
        </p>
        {ags.length === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink4)' }}>Nenhum atendimento hoje.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {ags.map((ag) => (
              <Link key={ag.id} href="/agenda"
                className="press flex items-center gap-3 p-3.5 rounded-2xl"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="flex flex-col items-center flex-shrink-0" style={{ width: 46 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-ink)' }}>
                    {format(new Date(ag.data_hora_inicio), 'HH:mm')}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 600, color: 'var(--color-ink)' }}>
                    {ag.cliente?.nome ?? 'Cliente'} · {ag.servico?.nome ?? 'Serviço'}
                  </p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink4)', marginTop: 1 }}>
                    {STATUS_LABEL[ag.status] ?? ag.status}
                  </p>
                </div>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', flexShrink: 0 }}>
                  <Secret>{fmt(Number(ag.valor))}</Secret>
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/dashboard/layout.tsx web/app/\(app\)/dashboard/page.tsx web/app/\(app\)/dashboard/DashboardProfissionalView.tsx
git commit -m "feat(dashboard): libera acesso para profissional com visao pessoal propria"
```

---

### Task 10: Web — Dashboard pessoal: meta mensal própria

**Files:**
- Create: `web/app/(app)/dashboard/MetaPessoalCard.tsx`
- Modify: `web/app/(app)/dashboard/DashboardProfissionalView.tsx`

**Interfaces:**
- Consumes: RPC `definir_minha_meta_mensal` (Task 2); `progressoMetaPessoal` de `@shared/dashboard-profissional` (Task 3).
- Produces: `<MetaPessoalCard metaInicial={number|null} faturamentoBrutoMes={number} />` — Client Component, usado só dentro de `DashboardProfissionalView`.

- [ ] **Step 1: Criar `MetaPessoalCard.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Target, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Secret } from '@/components/privacy';
import { progressoMetaPessoal } from '@shared/dashboard-profissional';

const supabase = createClient();

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

/** Meta mensal pessoal da profissional — distinta da meta da empresa. Ela
 * mesma define e altera; a mutação passa pela RPC `definir_minha_meta_mensal`
 * (migration 079), que só toca a própria linha/coluna. */
export default function MetaPessoalCard({ metaInicial, faturamentoBrutoMes }: {
  metaInicial: number | null;
  faturamentoBrutoMes: number;
}) {
  const [meta,       setMeta]       = useState(metaInicial);
  const [editando,   setEditando]   = useState(false);
  const [valorInput, setValorInput] = useState(meta ? meta.toFixed(2).replace('.', ',') : '');
  const [salvando,   setSalvando]   = useState(false);
  const [erro,       setErro]       = useState('');

  const progresso = progressoMetaPessoal(faturamentoBrutoMes, meta);

  function abrirEdicao() {
    setValorInput(meta ? meta.toFixed(2).replace('.', ',') : '');
    setErro('');
    setEditando(true);
  }

  async function salvar() {
    setErro('');
    if (!valorInput.trim()) {
      setSalvando(true);
      const { error } = await supabase.rpc('definir_minha_meta_mensal', { p_valor: null });
      setSalvando(false);
      if (error) { setErro(error.message); return; }
      setMeta(null); setEditando(false);
      return;
    }
    const valor = parseFloat(valorInput.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) { setErro('Valor inválido.'); return; }
    setSalvando(true);
    const { error } = await supabase.rpc('definir_minha_meta_mensal', { p_valor: valor });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setMeta(valor); setEditando(false);
  }

  if (editando) {
    return (
      <div className="mb-7 rounded-2xl p-4 md:p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Minha meta do mês
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
            <input value={valorInput} onChange={e => setValorInput(e.target.value)} inputMode="decimal" placeholder="Sem meta"
              className="w-full h-10 pl-9 pr-3.5 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"/>
          </div>
          <button onClick={salvar} disabled={salvando}
            className="h-10 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
          <button onClick={() => setEditando(false)}
            className="h-10 px-3 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Cancelar
          </button>
        </div>
        {erro && <p className="text-sm text-red mt-2">{erro}</p>}
        <p className="text-xs text-text-4 mt-2">Deixe em branco pra remover a meta.</p>
      </div>
    );
  }

  return (
    <div className="mb-7 rounded-2xl p-4 md:p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Target size={13} style={{ color: progresso.temMeta && progresso.percentual >= 100 ? 'var(--color-green)' : 'var(--color-accent)', flexShrink: 0 }} strokeWidth={2}/>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
          Minha meta do mês
        </p>
        <button onClick={abrirEdicao} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-3 hover:bg-bg transition">
          <Pencil size={13}/>
        </button>
      </div>
      {progresso.temMeta ? (
        <>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 700, color: progresso.percentual >= 100 ? 'var(--color-green)' : 'var(--color-ink2)', marginBottom: 8 }}>
            <Secret>{fmt(faturamentoBrutoMes)} / {fmt(meta!)}</Secret>
          </p>
          <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
            <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
              style={{ width: `${progresso.percentual}%`, background: progresso.percentual >= 100 ? 'var(--color-green)' : 'linear-gradient(90deg, var(--color-primary), var(--color-accent))' }}/>
          </div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: progresso.percentual >= 100 ? 'var(--color-green)' : 'var(--color-ink4)', marginTop: 6, fontWeight: progresso.percentual >= 100 ? 700 : 400 }}>
            <Secret>{progresso.percentual >= 100 ? 'Meta atingida!' : `${progresso.percentual}% concluído · faltam ${fmt(progresso.restante)}`}</Secret>
          </p>
        </>
      ) : (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink4)' }}>
          Sem meta definida — clique no ícone para definir uma meta pessoal.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Buscar a meta e renderizar o card em `DashboardProfissionalView.tsx`**

Adicionar o import no topo do arquivo:

```typescript
import MetaPessoalCard from './MetaPessoalCard';
```

Trocar o `Promise.all` (bloco escrito na Task 9) pra incluir a meta:

```typescript
  const [{ data: agendaHoje }, { data: comissoesMes }, { data: membro }] = await Promise.all([
    supabase.from('agendamentos')
      .select('id, data_hora_inicio, status, valor, cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)')
      .eq('empresa_id', empresaId).eq('profissional_id', userId)
      .gte('data_hora_inicio', inicioHoje).lte('data_hora_inicio', fimHoje)
      .neq('status', 'cancelado')
      .order('data_hora_inicio'),
    supabase.from('comissoes')
      .select('valor_servico, valor_comissao, status')
      .eq('empresa_id', empresaId).eq('profissional_id', userId)
      .gte('created_at', inicioMes).lte('created_at', fimMes),
    supabase.from('empresa_membros').select('meta_mensal_pessoal')
      .eq('empresa_id', empresaId).eq('user_id', userId).single(),
  ]);

  const metaMensalPessoal = membro?.meta_mensal_pessoal != null ? Number(membro.meta_mensal_pessoal) : null;
```

Inserir `<MetaPessoalCard />` logo depois do grid de KPIs (entre o `</div>` que fecha o grid de KPIs e o comentário `{/* Agenda de hoje */}`, ambos escritos na Task 9):

```tsx
      <MetaPessoalCard metaInicial={metaMensalPessoal} faturamentoBrutoMes={faturamentoBrutoMes} />

      {/* Agenda de hoje */}
```

- [ ] **Step 3: Verificar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/dashboard/MetaPessoalCard.tsx web/app/\(app\)/dashboard/DashboardProfissionalView.tsx
git commit -m "feat(dashboard): meta mensal pessoal editavel pela propria profissional"
```

---

### Task 11: Web — Dashboard pessoal: reconquista de clientes

**Files:**
- Modify: `web/app/(app)/dashboard/DashboardProfissionalView.tsx`

**Interfaces:**
- Consumes: `classificarClientesReconquista` de `@shared/dashboard-profissional` (Task 3).

- [ ] **Step 1: Buscar o histórico de atendimentos dela e classificar**

Adicionar o import no topo do arquivo:

```typescript
import { AlertTriangle, UserX } from 'lucide-react';
import { classificarClientesReconquista, type VisitaClienteProfissional } from '@shared/dashboard-profissional';
```

Acrescentar mais uma entrada ao `Promise.all` (o mesmo bloco editado na Task 10):

```typescript
  const [{ data: agendaHoje }, { data: comissoesMes }, { data: membro }, { data: historico }] = await Promise.all([
    supabase.from('agendamentos')
      .select('id, data_hora_inicio, status, valor, cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)')
      .eq('empresa_id', empresaId).eq('profissional_id', userId)
      .gte('data_hora_inicio', inicioHoje).lte('data_hora_inicio', fimHoje)
      .neq('status', 'cancelado')
      .order('data_hora_inicio'),
    supabase.from('comissoes')
      .select('valor_servico, valor_comissao, status')
      .eq('empresa_id', empresaId).eq('profissional_id', userId)
      .gte('created_at', inicioMes).lte('created_at', fimMes),
    supabase.from('empresa_membros').select('meta_mensal_pessoal')
      .eq('empresa_id', empresaId).eq('user_id', userId).single(),
    supabase.from('agendamentos')
      .select('cliente_id, data_hora_inicio, cliente:clientes!agendamentos_cliente_id_fkey(id, nome)')
      .eq('empresa_id', empresaId).eq('profissional_id', userId).eq('status', 'concluido')
      .order('data_hora_inicio', { ascending: false })
      .limit(2000),
  ]);

  const metaMensalPessoal = membro?.meta_mensal_pessoal != null ? Number(membro.meta_mensal_pessoal) : null;

  // Histórico vem ordenado do mais recente pro mais antigo — a primeira
  // ocorrência de cada cliente_id já é a última visita.
  const visitasPorCliente = new Map<string, VisitaClienteProfissional>();
  for (const ag of (historico ?? []) as any[]) {
    if (!ag.cliente_id) continue;
    const existente = visitasPorCliente.get(ag.cliente_id);
    if (existente) {
      existente.totalVisitas++;
    } else {
      visitasPorCliente.set(ag.cliente_id, {
        clienteId: ag.cliente_id,
        nome: ag.cliente?.nome ?? 'Cliente',
        ultimaVisita: ag.data_hora_inicio,
        totalVisitas: 1,
      });
    }
  }
  const { emRisco, naoRetornou } = classificarClientesReconquista(Array.from(visitasPorCliente.values()));
```

- [ ] **Step 2: Renderizar a seção de reconquista**

Inserir depois do bloco "Agenda de hoje" (antes do `</div>` final que fecha `<div className="bm-page">`, escrito na Task 9):

```tsx
      {(emRisco.length > 0 || naoRetornou.length > 0) && (
        <div className="mb-2">
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
            Clientes para reconquistar
          </p>
          <div className="flex flex-col gap-2">
            {naoRetornou.slice(0, 6).map((c) => (
              <Link key={c.clienteId} href={`/clientes/${c.clienteId}`}
                className="press flex items-center gap-3 p-3.5 rounded-2xl"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-bg)' }}>
                  <UserX size={15} style={{ color: 'var(--color-ink3)' }} strokeWidth={2}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 600, color: 'var(--color-ink)' }}>{c.nome}</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink4)', marginTop: 1 }}>
                    Veio 1x há {c.diasSemVisita} dias e não voltou
                  </p>
                </div>
              </Link>
            ))}
            {emRisco.slice(0, 6).map((c) => (
              <Link key={c.clienteId} href={`/clientes/${c.clienteId}`}
                className="press flex items-center gap-3 p-3.5 rounded-2xl"
                style={{ background: 'var(--color-rose-soft)', border: '1px solid rgba(220,38,38,0.15)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#fff' }}>
                  <AlertTriangle size={15} style={{ color: 'var(--color-rose)' }} strokeWidth={2}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 600, color: 'var(--color-ink)' }}>{c.nome}</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-rose)', marginTop: 1 }}>
                    {c.totalVisitas} atendimentos · sem vir há {c.diasSemVisita} dias
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 3: Verificar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/dashboard/DashboardProfissionalView.tsx
git commit -m "feat(dashboard): painel de reconquista de clientes da profissional"
```

---

### Task 12: Mobile — Serviços: mesma tela, papel decide se edita

**Files:**
- Modify: `mobile/app/(empresa)/servicos.tsx`
- Create: `mobile/app/(profissional)/servicos.tsx`

**Interfaces:**
- Consumes: `temPermissao` de `@/lib/permissions`, `useAuthStore` (`roleAtivo`, `isOwner`) — ambos já usados no arquivo.

> Em vez de duplicar a tela, `(empresa)/servicos.tsx` passa a decidir por role se mostra as ações de gestão — hoje só é alcançada por owner/gestor, então esse gate não muda nada pra quem já usa. `(profissional)/servicos.tsx` só re-exporta o mesmo componente sob a nova rota.

- [ ] **Step 1: Calcular `podeGerenciar` e escondê-lo dos botões de header/FAB/estado-vazio**

Adicionar o import no topo de `mobile/app/(empresa)/servicos.tsx` (junto aos existentes, linhas 23-31):

```typescript
import { temPermissao } from '@/lib/permissions';
```

Em `mobile/app/(empresa)/servicos.tsx:155-163`, dentro de `export default function Servicos()`:

```typescript
export default function Servicos() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva, roleAtivo, isOwner } = useAuthStore();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useServicos();
  const servicos = data?.servicos ?? [];
  const categorias = data?.categorias ?? [];
  const [gerenciar, setGerenciar] = useState(false);
  const podeGerenciar = temPermissao(isOwner ? 'owner' : (roleAtivo ?? 'profissional'), 'gerenciar_servicos');
```

Em `mobile/app/(empresa)/servicos.tsx:220-243` (botões Tags/Plus do header):

```tsx
            {podeGerenciar && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setGerenciar(true)}
                  style={{
                    width: 38, height: 38,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
                    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Tags size={17} color="#fff" strokeWidth={2.2} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/(empresa)/novo-servico' as any)}
                  style={{
                    width: 38, height: 38,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
                    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Plus size={18} color="#fff" strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            )}
```

Em `mobile/app/(empresa)/servicos.tsx:321-335` (estado vazio):

```tsx
        {servicos.length === 0 && !isLoading && (
          <View style={{ marginHorizontal: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 32, alignItems: 'center', gap: 12 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
              Nenhum serviço cadastrado ainda.
            </Text>
            {podeGerenciar && (
              <TouchableOpacity
                onPress={() => router.push('/(empresa)/novo-servico' as any)}
                style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                  Adicionar primeiro serviço
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
```

Em `mobile/app/(empresa)/servicos.tsx:338-351` (FAB):

```tsx
      {podeGerenciar && (
        <TouchableOpacity
          onPress={() => router.push('/(empresa)/novo-servico' as any)}
          style={{
            position: 'absolute', bottom: insets.bottom + 24, right: 24,
            width: 52, height: 52, borderRadius: 16,
            backgroundColor: C.primary,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: C.primary, shadowOpacity: 0.35,
            shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
          }}
        >
          <Plus size={22} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
      )}
```

Também envolver o modal de gerenciar categorias (o mesmo `podeGerenciar` protege a única forma de abri-lo, `setGerenciar(true)` no header) — o `<CategoriasManagerModal visible={gerenciar} .../>` no fim do arquivo não precisa de mudança, já que `gerenciar` nunca vira `true` sem o botão que foi escondido.

- [ ] **Step 2: `ServicoCard` esconde toggle/editar quando não pode gerenciar**

Em `mobile/app/(empresa)/servicos.tsx:81-85`, adicionar o prop:

```typescript
function ServicoCard({ servico, podeGerenciar, onToggle, onEdit }: {
  servico: Servico;
  podeGerenciar: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
```

Em `mobile/app/(empresa)/servicos.tsx:97-116` (linha superior do card, nome + switch), trocar o `Switch` incondicional por:

```tsx
        {podeGerenciar && (
          <Switch
            value={servico.ativo}
            onValueChange={onToggle}
            trackColor={{ false: '#E5E7EB', true: C.green }}
            thumbColor="#fff"
            style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
          />
        )}
```

Em `mobile/app/(empresa)/servicos.tsx:133-146` (linha inferior, botão editar), envolver:

```tsx
          {podeGerenciar && (
            <TouchableOpacity
              onPress={onEdit}
              style={{
                width: 30, height: 30, borderRadius: 8,
                backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Edit3 size={13} color={C.text3} strokeWidth={2} />
            </TouchableOpacity>
          )}
```

E, no uso do componente (`mobile/app/(empresa)/servicos.tsx:309-315`), passar a prop:

```tsx
                <ServicoCard
                  key={s.id}
                  servico={s}
                  podeGerenciar={podeGerenciar}
                  onToggle={() => toggleServico(s)}
                  onEdit={() => router.push(`/(empresa)/editar-servico/${s.id}` as any)}
                />
```

- [ ] **Step 3: Criar a rota da profissional como re-export**

```typescript
export { default } from '../(empresa)/servicos';
```

Salvar em `mobile/app/(profissional)/servicos.tsx`.

- [ ] **Step 4: Verificar tipos**

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma baseline de ~10 erros pré-existentes, nenhum novo nos 2 arquivos tocados.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(empresa\)/servicos.tsx mobile/app/\(profissional\)/servicos.tsx
git commit -m "feat(mobile,servicos): profissional ve o catalogo, so gestor/owner edita"
```

---

### Task 13: Mobile — Pacotes: catálogo travado, venda/sessão livres

**Files:**
- Modify: `mobile/app/(empresa)/pacotes.tsx`
- Create: `mobile/app/(profissional)/pacotes.tsx`

**Interfaces:**
- Consumes: `temPermissao` de `@/lib/permissions`, `useAuthStore`.

> Mesma estratégia da Task 12: a tela existente ganha um gate por role; `VendidoCard` (vender/excluir venda) e o modal de sessões continuam abertos pra qualquer role — só `PacoteCard` (catálogo) e os botões "Novo pacote" mudam.

- [ ] **Step 1: Calcular `podeGerenciarCatalogo`**

Adicionar o import no topo de `mobile/app/(empresa)/pacotes.tsx` (junto aos existentes, linhas 24-33):

```typescript
import { temPermissao } from '@/lib/permissions';
```

Em `mobile/app/(empresa)/pacotes.tsx:668-669`, incluir `roleAtivo, isOwner` na mesma desestruturação já existente:

```typescript
  const { empresaAtiva, roleAtivo, isOwner } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const podeGerenciarCatalogo = temPermissao(isOwner ? 'owner' : (roleAtivo ?? 'profissional'), 'gerenciar_pacotes');
```

- [ ] **Step 2: `PacoteCard` esconde toggle/editar do catálogo**

Em `mobile/app/(empresa)/pacotes.tsx:86-90`, adicionar o prop:

```typescript
function PacoteCard({ pacote, podeGerenciar, onToggle, onEdit }: {
  pacote: PacoteComServicos;
  podeGerenciar: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
```

Em `mobile/app/(empresa)/pacotes.tsx:107-121` (nome + switch), trocar o `Switch` incondicional por:

```tsx
        {podeGerenciar && (
          <Switch
            value={pacote.ativo}
            onValueChange={onToggle}
            trackColor={{ false: '#E5E7EB', true: C.green }}
            thumbColor="#fff"
            style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
          />
        )}
```

Em `mobile/app/(empresa)/pacotes.tsx:158-176` (preço + editar), envolver o botão:

```tsx
        {podeGerenciar && (
          <TouchableOpacity
            onPress={onEdit}
            style={{
              width: 30, height: 30, borderRadius: 8,
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Edit3 size={13} color={C.text3} strokeWidth={2} />
          </TouchableOpacity>
        )}
```

- [ ] **Step 3: `renderSection` passa a prop pro card**

Em `mobile/app/(empresa)/pacotes.tsx:749-756`:

```tsx
        {lista.map((p) => (
          <PacoteCard
            key={p.id}
            pacote={p}
            podeGerenciar={podeGerenciarCatalogo}
            onToggle={() => togglePacote(p)}
            onEdit={() => router.push(`/(empresa)/editar-pacote/${p.id}` as any)}
          />
        ))}
```

- [ ] **Step 4: Esconder "Criar primeiro pacote" e o FAB**

Em `mobile/app/(empresa)/pacotes.tsx:834-848` (estado vazio do catálogo):

```tsx
            {pacotes.length === 0 && !isLoading && (
              <View style={{ marginHorizontal: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 32, alignItems: 'center', gap: 12 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Nenhum pacote cadastrado ainda.
                </Text>
                {podeGerenciarCatalogo && (
                  <TouchableOpacity
                    onPress={() => router.push('/(empresa)/novo-pacote' as any)}
                    style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                      Criar primeiro pacote
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
```

Em `mobile/app/(empresa)/pacotes.tsx:892-901` (FAB):

```tsx
      {podeGerenciarCatalogo && (
        <TouchableOpacity
          onPress={() => router.push('/(empresa)/novo-pacote' as any)}
          style={{
            position: 'absolute', bottom: insets.bottom + 24, right: 24,
            width: 52, height: 52, borderRadius: 16,
            backgroundColor: C.primary,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: C.primary, shadowOpacity: 0.35,
            shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
          }}
        >
          <Plus size={22} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
      )}
```

Nenhuma mudança em `VendidoCard`, no `renderSection` de "Vendidos", nem no modal de gerenciar sessões (linhas 181-680 aproximadamente) — vender, excluir venda e registrar/editar/excluir sessão continuam abertos pra qualquer role.

- [ ] **Step 5: Criar a rota da profissional como re-export**

```typescript
export { default } from '../(empresa)/pacotes';
```

Salvar em `mobile/app/(profissional)/pacotes.tsx`.

- [ ] **Step 6: Verificar tipos**

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma baseline de ~10 erros pré-existentes, nenhum novo nos 2 arquivos tocados.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/\(empresa\)/pacotes.tsx mobile/app/\(profissional\)/pacotes.tsx
git commit -m "feat(mobile,pacotes): trava edicao do catalogo para gestor/owner, mantem venda e sessoes livres"
```

---

### Task 14: Mobile — dashboard pessoal ("Início") + meta + reconquista

**Files:**
- Modify: `mobile/hooks/useProfissional.ts`
- Create: `mobile/app/(profissional)/inicio.tsx`
- Modify: `mobile/app/(profissional)/_layout.tsx`

**Interfaces:**
- Consumes: `classificarClientesReconquista` de `@shared/dashboard-profissional` (Task 3); `useAgendaProfissional`, `useKpisDiaProfissional` (já existentes em `useProfissional.ts`, sem mudança).
- Produces: `useMetaPessoal()`, `useDefinirMetaPessoal()`, `useClientesReconquistaProfissional()` (novos); `ResumoComissoes` ganha o campo `faturamentoBruto`.

- [ ] **Step 1: Estender `ResumoComissoes` e `useResumoComissoes` com faturamento bruto**

Em `mobile/hooks/useProfissional.ts:25-31`, adicionar o campo:

```typescript
export interface ResumoComissoes {
  total: number;
  pago: number;
  pendente: number;
  atendimentos: number;
  ticketMedio: number;
  /** Soma de valor_servico (preço do serviço, não a comissão) do período. */
  faturamentoBruto: number;
}
```

Em `mobile/hooks/useProfissional.ts:187-204` (dentro de `useResumoComissoes`):

```typescript
    queryFn: async () => {
      const { data } = await supabase
        .from('comissoes')
        .select('valor_servico, valor_comissao, status')
        .eq('profissional_id', userId!)
        .eq('empresa_id', empresaId!)
        .gte('created_at', startOfMonth(mesRef).toISOString())
        .lte('created_at', endOfMonth(mesRef).toISOString());

      const items = data ?? [];
      const total            = items.reduce((s, c) => s + Number(c.valor_comissao), 0);
      const pago             = items.filter((c) => c.status === 'pago').reduce((s, c) => s + Number(c.valor_comissao), 0);
      const pendente          = items.filter((c) => c.status === 'pendente').reduce((s, c) => s + Number(c.valor_comissao), 0);
      const atendimentos      = items.length;
      const ticketMedio       = atendimentos > 0 ? Math.round(total / atendimentos) : 0;
      const faturamentoBruto  = items.reduce((s, c) => s + Number(c.valor_servico), 0);

      return { total, pago, pendente, atendimentos, ticketMedio, faturamentoBruto } as ResumoComissoes;
    },
```

- [ ] **Step 2: Adicionar meta pessoal e reconquista ao final do arquivo**

Adicionar o import no topo de `mobile/hooks/useProfissional.ts` (junto aos existentes):

```typescript
import { classificarClientesReconquista, type VisitaClienteProfissional } from '@shared/dashboard-profissional';
```

Acrescentar ao final do arquivo (depois de `useCriarBloqueioProfissional`, linha 304):

```typescript

// ── Meta mensal pessoal ──────────────────────────────────────

/** Busca a meta pessoal (distinta da meta_mensal da empresa). null = sem meta. */
export function useMetaPessoal() {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['prof-meta-pessoal', userId, empresaId],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data } = await supabase
        .from('empresa_membros').select('meta_mensal_pessoal')
        .eq('user_id', userId!).eq('empresa_id', empresaId!).single();
      return data?.meta_mensal_pessoal != null ? Number(data.meta_mensal_pessoal) : null;
    },
  });
}

/** Define/limpa (valor null) a meta pessoal via RPC restrita à própria linha. */
export function useDefinirMetaPessoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (valor: number | null) => {
      const { error } = await supabase.rpc('definir_minha_meta_mensal', { p_valor: valor });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prof-meta-pessoal'] }),
  });
}

// ── Clientes para reconquistar ───────────────────────────────

/**
 * Clientes que a profissional já atendeu, classificados em "em risco"
 * (2+ visitas, 45+ dias sem voltar) e "não retornou" (1 visita só, 30+
 * dias). Mesma regra pura de `shared/dashboard-profissional.ts` usada no
 * dashboard web.
 */
export function useClientesReconquistaProfissional() {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['prof-reconquista', userId, empresaId],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase
        .from('agendamentos')
        .select('cliente_id, data_hora_inicio, cliente:users!agendamentos_cliente_id_fkey(id, nome)')
        .eq('empresa_id', empresaId!).eq('profissional_id', userId!).eq('status', 'concluido')
        .order('data_hora_inicio', { ascending: false })
        .limit(2000);

      // Ordenado do mais recente pro mais antigo — a 1a ocorrência de cada
      // cliente_id já é a última visita.
      const visitasPorCliente = new Map<string, VisitaClienteProfissional>();
      for (const ag of (data ?? []) as any[]) {
        if (!ag.cliente_id) continue;
        const existente = visitasPorCliente.get(ag.cliente_id);
        if (existente) {
          existente.totalVisitas++;
        } else {
          visitasPorCliente.set(ag.cliente_id, {
            clienteId: ag.cliente_id,
            nome: ag.cliente?.nome ?? 'Cliente',
            ultimaVisita: ag.data_hora_inicio,
            totalVisitas: 1,
          });
        }
      }
      return classificarClientesReconquista(Array.from(visitasPorCliente.values()));
    },
  });
}
```

- [ ] **Step 3: Criar a tela `mobile/app/(profissional)/inicio.tsx`**

```tsx
import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StatusBar, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Target, Pencil, AlertTriangle, UserX, CalendarDays } from 'lucide-react-native';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  useFonts,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useAuthStore } from '@/stores/authStore';
import {
  useAgendaProfissional, useKpisDiaProfissional, useResumoComissoes,
  useMetaPessoal, useDefinirMetaPessoal, useClientesReconquistaProfissional,
} from '@/hooks/useProfissional';
import { progressoMetaPessoal } from '@shared/dashboard-profissional';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  rose: '#C0392B', roseSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

// ── Card de meta pessoal ──────────────────────────────────────

function MetaPessoalCard({ meta, faturamentoBruto }: { meta: number | null; faturamentoBruto: number }) {
  const definirMeta = useDefinirMetaPessoal();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(meta ? String(meta) : '');
  const progresso = progressoMetaPessoal(faturamentoBruto, meta);

  async function salvar() {
    const num = valor.trim() ? parseFloat(valor.replace(',', '.')) : null;
    if (valor.trim() && (!Number.isFinite(num) || (num as number) < 0)) return;
    await definirMeta.mutateAsync(num);
    setEditando(false);
  }

  return (
    <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginHorizontal: 24, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Target size={14} color={progresso.temMeta && progresso.percentual >= 100 ? C.green : C.accent} />
        <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Minha meta do mês
        </Text>
        <TouchableOpacity onPress={() => { setValor(meta ? String(meta) : ''); setEditando((v) => !v); }}>
          <Pencil size={14} color={C.text3} />
        </TouchableOpacity>
      </View>
      {editando ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={valor} onChangeText={setValor} keyboardType="decimal-pad" placeholder="Sem meta"
            style={{ flex: 1, height: 38, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}
          />
          <TouchableOpacity onPress={salvar} disabled={definirMeta.isPending}
            style={{ height: 38, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Salvar</Text>
          </TouchableOpacity>
        </View>
      ) : progresso.temMeta ? (
        <>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: progresso.percentual >= 100 ? C.green : C.text2, marginBottom: 6 }}>
            {fmtBRL(faturamentoBruto)} / {fmtBRL(meta!)}
          </Text>
          <View style={{ height: 8, borderRadius: 999, backgroundColor: C.bg, overflow: 'hidden' }}>
            <View style={{ height: 8, borderRadius: 999, width: `${progresso.percentual}%`, backgroundColor: progresso.percentual >= 100 ? C.green : C.accent }} />
          </View>
        </>
      ) : (
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4 }}>
          Sem meta definida — toque no lápis para definir.
        </Text>
      )}
    </View>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function Inicio() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const hoje = new Date();

  const { data: agendaHoje, isLoading: loadingAgenda, refetch: refetchAgenda } = useAgendaProfissional(hoje);
  const { data: kpisDia, refetch: refetchKpis } = useKpisDiaProfissional(hoje);
  const { data: resumoMes, refetch: refetchResumo } = useResumoComissoes(hoje);
  const { data: meta, refetch: refetchMeta } = useMetaPessoal();
  const { data: reconquista, refetch: refetchReconquista } = useClientesReconquistaProfissional();

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  async function onRefresh() {
    await Promise.all([refetchAgenda(), refetchKpis(), refetchResumo(), refetchMeta(), refetchReconquista()]);
  }

  if (!fontsLoaded) return null;

  const ags = agendaHoje ?? [];
  const concluidos = ags.filter((a) => a.status === 'concluido').length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loadingAgenda} onRefresh={onRefresh} tintColor="#fff" />}
      >
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 20 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {empresaAtiva?.nome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            {format(hoje, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </Text>
        </LinearGradient>

        {/* KPIs */}
        <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { value: String(ags.length),                          label: 'Agenda hoje',       color: C.accent },
            { value: fmtBRL(kpisDia?.receitaDia ?? 0),              label: 'Fat. hoje',         color: C.primary },
            { value: fmtBRL(resumoMes?.faturamentoBruto ?? 0),      label: 'Fat. bruto do mês', color: C.primary },
            { value: fmtBRL((resumoMes?.pago ?? 0) + (resumoMes?.pendente ?? 0)), label: 'Comissão do mês', color: C.green },
          ].map((s) => (
            <View key={s.label} style={{
              width: '47%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 14, padding: 12,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.3 }}>{s.value}</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 3 }}>{s.label}</Text>
            </View>
          ))}
        </View>

        <MetaPessoalCard meta={meta ?? null} faturamentoBruto={resumoMes?.faturamentoBruto ?? 0} />

        {/* Agenda de hoje */}
        <View style={{ marginHorizontal: 24, marginBottom: 20 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Atendimentos de hoje ({concluidos} concluído{concluidos !== 1 ? 's' : ''})
          </Text>
          {ags.length === 0 ? (
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 20, alignItems: 'center' }}>
              <CalendarDays size={20} color={C.text4} />
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, marginTop: 8 }}>Nenhum atendimento hoje.</Text>
            </View>
          ) : (
            ags.map((ag) => (
              <TouchableOpacity key={ag.id} onPress={() => router.push(`/(profissional)/agendamento/${ag.id}` as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, marginBottom: 8 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, width: 44 }}>
                  {format(new Date(ag.data_hora_inicio), 'HH:mm')}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                    {ag.cliente?.nome ?? 'Cliente'} · {ag.servico?.nome ?? 'Serviço'}
                  </Text>
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.primary }}>
                  {fmtBRL(Number(ag.valor))}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Reconquista */}
        {reconquista && (reconquista.emRisco.length > 0 || reconquista.naoRetornou.length > 0) && (
          <View style={{ marginHorizontal: 24 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Clientes para reconquistar
            </Text>
            {reconquista.naoRetornou.slice(0, 6).map((c) => (
              <TouchableOpacity key={c.clienteId} onPress={() => router.push(`/(empresa)/cliente/${c.clienteId}` as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, marginBottom: 8 }}>
                <UserX size={16} color={C.text3} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{c.nome}</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>Veio 1x há {c.diasSemVisita} dias e não voltou</Text>
                </View>
              </TouchableOpacity>
            ))}
            {reconquista.emRisco.slice(0, 6).map((c) => (
              <TouchableOpacity key={c.clienteId} onPress={() => router.push(`/(empresa)/cliente/${c.clienteId}` as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.roseSoft, borderWidth: 1, borderColor: 'rgba(192,57,43,0.2)', borderRadius: 14, padding: 12, marginBottom: 8 }}>
                <AlertTriangle size={16} color={C.rose} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{c.nome}</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.rose }}>{c.totalVisitas} atendimentos · sem vir há {c.diasSemVisita} dias</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
```

> Nota: a rota de destino do card de reconquista (`/(empresa)/cliente/${id}`) é a única tela de perfil de cliente que existe hoje no mobile — vive em `(empresa)/cliente/[id].tsx`. Acessá-la fora do grupo `(empresa)` funciona no Expo Router (rotas são globais; o grupo só organiza arquivos), mas exige confirmar na Task 15 que a tela não tem nenhum gate de layout que bloqueie quem não é owner/gestor. Se bloquear, o link deste card deve virar só texto (sem navegação) até existir uma tela de perfil de cliente acessível à profissional.

- [ ] **Step 4: Adicionar a aba "Início" ao layout da profissional**

`mobile/app/(profissional)/_layout.tsx` (arquivo inteiro):

```typescript
import { Tabs } from 'expo-router';

export default function ProfissionalLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#6b21a8',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { borderTopColor: '#f3e8ff' },
      }}
    >
      <Tabs.Screen name="inicio"        options={{ title: 'Início',       tabBarIcon: () => null }} />
      <Tabs.Screen name="agenda"        options={{ title: 'Minha Agenda', tabBarIcon: () => null }} />
      <Tabs.Screen name="servicos"      options={{ title: 'Serviços',     tabBarIcon: () => null }} />
      <Tabs.Screen name="pacotes"       options={{ title: 'Pacotes',      tabBarIcon: () => null }} />
      <Tabs.Screen name="comissoes"     options={{ title: 'Comissões',    tabBarIcon: () => null }} />
      <Tabs.Screen name="configuracoes" options={{ title: 'Ajustes',      tabBarIcon: () => null }} />
    </Tabs>
  );
}
```

- [ ] **Step 5: Verificar tipos**

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma baseline de ~10 erros pré-existentes, nenhum novo.

- [ ] **Step 6: Commit**

```bash
git add mobile/hooks/useProfissional.ts mobile/app/\(profissional\)/inicio.tsx mobile/app/\(profissional\)/_layout.tsx
git commit -m "feat(mobile,dashboard): tela Inicio pessoal da profissional com meta e reconquista"
```

---

### Task 15: Verificação final (migrations + checklist manual)

**Files:** nenhum arquivo novo — task de fechamento.

**Interfaces:** nenhuma.

Esta entrega não pode ser 100% verificada por teste automatizado: RLS só é real depois que o usuário aplica as migrations no SQL editor (ver Global Constraints), e não há conta de teste com role `profissional` disponível neste ambiente. Este task documenta o que falta confirmar depois do merge.

- [ ] **Step 1: Rodar a suíte completa e o typecheck uma última vez**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS, zero erros.

Run: `cd mobile && npx tsc --noEmit`
Expected: mesma baseline de erros pré-existentes (contar quantos são, comparar com a contagem do início da branch — nenhum novo).

- [ ] **Step 2: Listar as migrations pendentes de aplicação**

Run: `ls supabase/migrations | tail -5`
Expected: `078_servicos_pacotes_rls_escrita_gestor.sql` e `079_meta_mensal_pessoal.sql` aparecem na lista — avisar ao usuário que precisam ser aplicadas manualmente no SQL editor do Supabase (junto com `062`, `063`, `066`–`069`, que já seguiam pendentes antes desta entrega).

- [ ] **Step 3: Checklist manual (requer uma segunda conta com role `profissional`)**

Documentar no PR que o seguinte precisa de verificação visual, com uma conta de teste `profissional`, antes de considerar a entrega fechada:

- [ ] Web `/agenda`: mostra só a própria coluna, sem seletor de equipe; consegue criar/editar/pedir bloqueio da própria agenda.
- [ ] Web `/dashboard`: abre direto ao logar (não redireciona pra `/agenda`); mostra agenda de hoje, faturamento, comissão do mês; consegue definir/limpar a meta pessoal; painel de reconquista aparece quando há clientes elegíveis.
- [ ] Web `/servicos`: lista aparece; nenhum botão de criar/editar/excluir/ativar visível; tentar editar via URL direta de um serviço específico não é possível (não há rota de edição fora do modal, então basta confirmar que o modal nunca abre).
- [ ] Web `/pacotes`: catálogo visível sem "Novo pacote"/editar/ativar/excluir; "Vender" funciona; aba "Vendidos" com gerenciar sessões/excluir venda funcionando normalmente.
- [ ] Web `/notificacoes` e badge da sidebar: nenhum alerta de estoque baixo aparece; despesa a vencer também não (já valia antes desta entrega).
- [ ] Mobile: login de profissional abre em "Início" (não mais em "Minha Agenda"); tabs mostram Início/Minha Agenda/Serviços/Pacotes/Comissões/Ajustes; Serviços e Pacotes seguem as mesmas regras do web (visível, catálogo travado); tela "Início" mostra os mesmos números do dashboard web.
- [ ] Confirmar que owner/gestor não perderam nenhum acesso (dashboard da empresa idêntico ao de antes; servicos/pacotes com todos os botões de gestão continuam ali).

Marcar cada item conforme testado; qualquer falha volta pra uma task específica deste plano, não pra um novo item solto.
