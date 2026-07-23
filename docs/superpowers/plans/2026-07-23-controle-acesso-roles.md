# Controle de Acesso por Role (Dona/Gestora/Profissional) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar de fato a matriz de permissões (owner/gestor/profissional) que já existe no código — hoje só o mobile a usa — reforçar as policies de RLS que hoje ignoram role, e permitir escolher/alterar o role de um membro da equipe (convite com role + promover/rebaixar), em web e mobile.

**Architecture:** Três migrations SQL aditivas (enum + RLS de leitura + RLS/trigger de escrita em `empresa_membros`), um helper de guarda server-side reutilizado por 7 `layout.tsx` novos na web (um por rota restrita), filtragem da sidebar por `temPermissao()`, e extensão do fluxo de convite/gestão de equipe (web + mobile) para escolher e alterar role, com a mesma regra de negócio (`podeAtribuirRole`) espelhada nos dois apps.

**Tech Stack:** Next.js App Router (Server Components + Route Segment `layout.tsx`), Supabase Postgres (RLS policies + trigger), React Native/Expo Router, Vitest.

## Global Constraints

- Todo texto de UI, commits e comentários em pt-BR.
- `npx tsc --noEmit` deve continuar zerado na web após cada task que toque `.ts`/`.tsx`.
- Migrations são aditivas — nunca editar uma migration já aplicada; sempre criar um arquivo novo.
- Nenhuma tabela nova; apenas policies/triggers sobre tabelas existentes.
- RLS desta entrega cobre só `despesas`, `agendamentos`, `comissoes` e `empresa_membros` — **não mexer em `vendas`, `comandas`, `pagamentos`** (profissional precisa de escrita ali para `fechar_comanda`; ver spec).
- Regra de atribuição de role: só `owner` convida/promove/rebaixa para `gestor`; `owner` ou `gestor` convidam como `profissional`; ninguém altera o próprio role.
- Spec de referência: `docs/superpowers/specs/2026-07-23-controle-acesso-roles-design.md`.

---

## Task 1: Migration — enum `perfil_role` ganha `'owner'`

**Files:**
- Create: `supabase/migrations/041_perfil_role_owner_enum.sql`

**Interfaces:**
- Produces: valor `'owner'` formalmente aceito pelo tipo `perfil_role` (já usado em runtime via schema drift; esta migration só documenta).

- [ ] **Step 1: Criar a migration**

```sql
-- ============================================================
-- MIGRATION 041 — Documenta 'owner' no enum perfil_role
--
-- O enum perfil_role (migration 001) nunca declarou 'owner', mas a
-- migration 032 e todo o código (web/mobile) já leem/gravam
-- role = 'owner' em empresa_membros. Isso só funciona porque a
-- segurança (RLS) nunca dependeu desse valor — is_gestor_ou_owner()
-- (003_despesas_policies.sql) decide "é dona" checando
-- empresas.owner_id, não a coluna role. Ou seja, 'owner' já existe
-- no banco por alteração direta fora de migration (schema drift);
-- esta migration só torna isso reproduzível a partir do zero.
-- ============================================================

ALTER TYPE perfil_role ADD VALUE IF NOT EXISTS 'owner';
```

- [ ] **Step 2: Aplicar e verificar**

Aplicar no SQL Editor do Supabase (ou `supabase db push` se o CLI estiver linkado ao projeto). Depois, rodar:

```sql
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'perfil_role'::regtype
ORDER BY enumsortorder;
```

Esperado: `gestor`, `profissional`, `cliente`, `owner` (a ordem pode variar, mas `owner` deve aparecer na lista).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/041_perfil_role_owner_enum.sql
git commit -m "fix(db): documenta owner no enum perfil_role"
```

---

## Task 2: Migration — RLS de leitura por role (despesas, agendamentos, comissões)

**Files:**
- Create: `supabase/migrations/042_rls_reforco_leitura_por_role.sql`

**Interfaces:**
- Consumes: função `is_gestor_ou_owner(p_empresa_id uuid) returns boolean`, já definida em `supabase/migrations/003_despesas_policies.sql`.
- Produces: profissional só lê as próprias linhas de `agendamentos`/`comissoes`; não lê `despesas` de forma alguma. Gestor/owner continuam vendo tudo.

- [ ] **Step 1: Criar a migration**

```sql
-- ============================================================
-- MIGRATION 042 — RLS: leitura por role (despesas, agendamentos, comissões)
--
-- As policies "despesas: membro ve", "agendamentos: ver" e
-- "comissoes: ver" (migration 001) tinham comentários dizendo
-- "profissional vê só as suas / não vê despesas", mas a condição
-- real (`empresa_id in (select minha_empresas())`) libera QUALQUER
-- membro ativo, de qualquer role. Esta migration corrige isso
-- reaproveitando is_gestor_ou_owner() (003_despesas_policies.sql).
-- ============================================================

DROP POLICY IF EXISTS "despesas: membro ve" ON public.despesas;
CREATE POLICY "despesas: gestor ou owner ve"
  ON public.despesas
  FOR SELECT
  USING (is_gestor_ou_owner(empresa_id));

DROP POLICY IF EXISTS "agendamentos: ver" ON public.agendamentos;
CREATE POLICY "agendamentos: ver"
  ON public.agendamentos
  FOR SELECT
  USING (
    profissional_id = auth.uid()
    OR cliente_id = auth.uid()
    OR is_gestor_ou_owner(empresa_id)
  );

DROP POLICY IF EXISTS "comissoes: ver" ON public.comissoes;
CREATE POLICY "comissoes: ver"
  ON public.comissoes
  FOR SELECT
  USING (
    profissional_id = auth.uid()
    OR is_gestor_ou_owner(empresa_id)
  );

-- A UPDATE original (015_comissoes_update_policy.sql) tinha o mesmo
-- problema: o comentário dizia "somente gestores/owners", mas a
-- condição liberava qualquer membro, inclusive a própria profissional
-- marcando sua comissão como paga.
DROP POLICY IF EXISTS "comissoes: membro atualiza" ON public.comissoes;
CREATE POLICY "comissoes: gestor ou owner atualiza"
  ON public.comissoes
  FOR UPDATE
  USING (is_gestor_ou_owner(empresa_id))
  WITH CHECK (is_gestor_ou_owner(empresa_id));
```

- [ ] **Step 2: Aplicar e verificar**

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('despesas', 'agendamentos', 'comissoes')
ORDER BY tablename, cmd;
```

Esperado: nenhuma policy chamada `"despesas: membro ve"`, `"agendamentos: ver"` (antiga) ou `"comissoes: membro atualiza"` (antiga) — só as novas listadas acima.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_rls_reforco_leitura_por_role.sql
git commit -m "fix(db): restringe leitura de despesas/agendamentos/comissoes por role"
```

---

## Task 3: Migration — `empresa_membros`: quem insere e quem altera role

**Files:**
- Create: `supabase/migrations/043_empresa_membros_role_policies.sql`

**Interfaces:**
- Produces: policy de INSERT (gestor/owner convidam `profissional`; só owner convida `gestor`), policy de UPDATE (gestor/owner atualizam `ativo`/`percentual_comissao`), trigger `bloquear_alteracao_role` que impede qualquer um de mudar a coluna `role` fora da regra (só owner altera, nunca o próprio role, nunca envolvendo `'owner'`).

- [ ] **Step 1: Criar a migration**

```sql
-- ============================================================
-- MIGRATION 043 — empresa_membros: policies de escrita + trigger de role
--
-- empresa_membros nunca teve policy de INSERT nem UPDATE (só SELECT,
-- migration 001). Isso deixava sem efeito, sob RLS:
--   - o toggle ativo/inativo em Equipe (web e mobile chamam
--     supabase.from('empresa_membros').update({ativo}) direto)
--   - o convite direto do mobile quando o usuário já existe
--     (convidar-profissional.tsx faz upsert client-side)
-- Esta migration:
--   1. Permite INSERT de novo membro por gestor/owner — role
--      'profissional' por qualquer um dos dois, role 'gestor' só
--      pela dona (owner_id da empresa).
--   2. Permite UPDATE geral (ativo, percentual_comissao) por
--      gestor/owner — corrige o toggle ativo/inativo.
--   3. Bloqueia, via trigger, qualquer UPDATE que mude a coluna role
--      fora da regra: só a dona altera role; ninguém altera o
--      próprio role; role 'owner' nunca é atribuído/removido por
--      aqui (só a função criar_empresa_completo, que roda como
--      SECURITY DEFINER e não passa por RLS/trigger de policy).
-- ============================================================

CREATE POLICY "membros: gestor ou owner convida"
  ON public.empresa_membros
  FOR INSERT
  WITH CHECK (
    role IN ('gestor', 'profissional')
    AND is_gestor_ou_owner(empresa_id)
    AND (
      role = 'profissional'
      OR EXISTS (
        SELECT 1 FROM public.empresas
        WHERE id = empresa_id AND owner_id = auth.uid()
      )
    )
  );

CREATE POLICY "membros: gestor ou owner atualiza"
  ON public.empresa_membros
  FOR UPDATE
  USING (is_gestor_ou_owner(empresa_id))
  WITH CHECK (is_gestor_ou_owner(empresa_id));

CREATE OR REPLACE FUNCTION public.bloquear_alteracao_role()
RETURNS trigger AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role = 'owner' OR OLD.role = 'owner' THEN
      RAISE EXCEPTION 'O papel de dona não pode ser alterado.';
    END IF;
    IF NEW.user_id = auth.uid() THEN
      RAISE EXCEPTION 'Não é possível alterar o próprio papel.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.empresas
      WHERE id = NEW.empresa_id AND owner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Somente a dona da empresa pode alterar o papel de um membro.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_bloquear_alteracao_role ON public.empresa_membros;
CREATE TRIGGER trg_bloquear_alteracao_role
  BEFORE UPDATE ON public.empresa_membros
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_alteracao_role();
```

- [ ] **Step 2: Aplicar e verificar**

```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'empresa_membros' ORDER BY cmd;
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.empresa_membros'::regclass AND NOT tgisinternal;
```

Esperado: policies de SELECT (já existente), INSERT e UPDATE listadas; trigger `trg_bloquear_alteracao_role` presente.

Teste funcional direto no SQL Editor (rodando como um usuário de teste via `set local role authenticated; set local request.jwt.claim.sub = '<uuid-de-uma-gestora>';` ou, mais simples, deixar para a verificação manual da Task 14): confirmar que uma gestora tentando `UPDATE empresa_membros SET role = 'gestor' WHERE id = '<próprio id>'` recebe o erro `Não é possível alterar o próprio papel.`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/043_empresa_membros_role_policies.sql
git commit -m "feat(db): permite convite/gestao de equipe sob RLS e restringe alteracao de role a owner"
```

---

## Task 4: `web/lib/permissions.ts` — exportar tipo + regra de atribuição de role

**Files:**
- Modify: `web/lib/permissions.ts`
- Modify: `web/tests/unit/permissions.test.ts`

**Interfaces:**
- Produces: `export type Permissao` (antes não exportado — necessário para tipar o array de navegação na Task 7), `export function podeAtribuirRole(quemConvida: 'owner' | PerfilRole, roleAlvo: 'gestor' | 'profissional'): boolean`.

- [ ] **Step 1: Escrever o teste (falhando)**

Adicionar ao final de `web/tests/unit/permissions.test.ts`:

```ts
import { temPermissao, rotaInicial, podeAtribuirRole } from '@/lib/permissions';

describe('podeAtribuirRole', () => {
  it('só owner pode atribuir role gestor', () => {
    expect(podeAtribuirRole('owner', 'gestor')).toBe(true);
    expect(podeAtribuirRole('gestor', 'gestor')).toBe(false);
    expect(podeAtribuirRole('profissional', 'gestor')).toBe(false);
  });

  it('owner ou gestor podem atribuir role profissional', () => {
    expect(podeAtribuirRole('owner', 'profissional')).toBe(true);
    expect(podeAtribuirRole('gestor', 'profissional')).toBe(true);
    expect(podeAtribuirRole('profissional', 'profissional')).toBe(false);
  });
});
```

(A linha `import { temPermissao, rotaInicial } from '@/lib/permissions';` já existe no topo do arquivo — trocar por essa nova linha com os três nomes, sem duplicar o import.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run tests/unit/permissions.test.ts`
Expected: FAIL — `podeAtribuirRole is not a function` / erro de import.

- [ ] **Step 3: Implementar**

Em `web/lib/permissions.ts`, trocar a linha 3 (`type Permissao = ...`) por `export type Permissao = ...` (só adiciona `export`, mesmo conteúdo), e adicionar ao final do arquivo:

```ts
export function podeAtribuirRole(
  quemConvida: 'owner' | PerfilRole,
  roleAlvo: 'gestor' | 'profissional',
): boolean {
  if (roleAlvo === 'gestor') return quemConvida === 'owner';
  return quemConvida === 'owner' || quemConvida === 'gestor';
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run tests/unit/permissions.test.ts`
Expected: PASS — todos os testes, incluindo os novos de `podeAtribuirRole`.

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 6: Commit**

```bash
git add web/lib/permissions.ts web/tests/unit/permissions.test.ts
git commit -m "feat: exporta tipo Permissao e adiciona regra podeAtribuirRole"
```

---

## Task 5: `mobile/lib/permissions.ts` — espelhar `podeAtribuirRole`

**Files:**
- Modify: `mobile/lib/permissions.ts`

**Interfaces:**
- Consumes: nenhuma (mesma assinatura da Task 4).
- Produces: `export function podeAtribuirRole(quemConvida: 'owner' | PerfilRole, roleAlvo: 'gestor' | 'profissional'): boolean` — idêntica à da web (mobile não tem infraestrutura de teste hoje; nenhum arquivo em `mobile/**/*.test.*` existe, então esta task não introduz um padrão novo ao pular testes automatizados aqui).

- [ ] **Step 1: Implementar**

Adicionar ao final de `mobile/lib/permissions.ts`:

```ts
export function podeAtribuirRole(
  quemConvida: 'owner' | PerfilRole,
  roleAlvo: 'gestor' | 'profissional'
): boolean {
  if (roleAlvo === 'gestor') return quemConvida === 'owner';
  return quemConvida === 'owner' || quemConvida === 'gestor';
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/lib/permissions.ts
git commit -m "feat: espelha podeAtribuirRole no mobile"
```

---

## Task 6: `web/lib/auth/requireRole.ts` — helper de guarda server-side

**Files:**
- Create: `web/lib/auth/requireRole.ts`

**Interfaces:**
- Consumes: `temPermissao`, `rotaInicial` de `@/lib/permissions`; `PerfilRole` de `@/types`; `redirect` de `next/navigation`.
- Produces: `export async function exigirPermissao(role: string | null, permissao: Permissao): Promise<void>` — usado pelas 7 `layout.tsx` da Task 8. Não redireciona se a role tiver a permissão; chama `redirect()` (que lança e interrompe a renderização) caso contrário.

- [ ] **Step 1: Implementar**

```ts
import { redirect } from 'next/navigation';
import type { PerfilRole } from '@/types';
import { temPermissao, rotaInicial, type Permissao } from '@/lib/permissions';

export async function exigirPermissao(role: string | null, permissao: Permissao) {
  const efetivo = (role ?? 'profissional') as 'owner' | PerfilRole;
  if (!temPermissao(efetivo, permissao)) {
    redirect(rotaInicial(efetivo));
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: sem novos erros (a função ainda não é usada por ninguém nesta task, mas deve compilar isoladamente).

- [ ] **Step 3: Commit**

```bash
git add web/lib/auth/requireRole.ts
git commit -m "feat: adiciona helper exigirPermissao para guardas de rota por role"
```

---

## Task 7: Web — Sidebar filtra navegação por permissão

**Files:**
- Modify: `web/components/AppLayout.tsx`
- Modify: `web/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `getAppContext()` (já existente, `web/lib/auth/server-context.ts`) — passa a usar o campo `role` que já é retornado; `temPermissao` e tipo `Permissao` de `@/lib/permissions` (Task 4).
- Produces: `Sidebar` passa a receber uma prop `role: string | null` e esconde os itens de nav que exigem permissão que a role não tem.

- [ ] **Step 1: `AppLayout.tsx` passa a role para o Sidebar**

Em `web/components/AppLayout.tsx`, trocar:

```tsx
  const { empresa, empresaId } = await getAppContext();
```

por:

```tsx
  const { empresa, empresaId, role } = await getAppContext();
```

E no JSX do `<Sidebar .../>`, adicionar a prop:

```tsx
      <Sidebar
        empresaId={empresaId}
        empresaNome={empresa.nome}
        empresaLogo={empresa.logo_url ?? null}
        empresaSegmento={empresa.segmento ?? 'Estúdio'}
        role={role}
      />
```

- [ ] **Step 2: `Sidebar.tsx` recebe a role e filtra os itens**

No topo de `web/components/Sidebar.tsx`, adicionar o import (junto aos outros imports):

```tsx
import { temPermissao, type Permissao } from '@/lib/permissions';
import type { PerfilRole } from '@/types';
```

Trocar as constantes `NAV` e `MAIS_NAV` (que hoje são `{ href, label, icon }[]`) para incluir um campo opcional `permissao`:

```tsx
// Itens principais da sidebar desktop
const NAV: { href: string; label: string; icon: React.ElementType; permissao?: Permissao }[] = [
  { href: '/dashboard',    label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/agenda',       label: 'Agenda',       icon: CalendarDays    },
  { href: '/comanda',      label: 'Comanda',      icon: Receipt         },
  { href: '/vendas',       label: 'Vendas',       icon: ShoppingCart    },
  { href: '/clientes',     label: 'Clientes',     icon: Users           },
  { href: '/financeiro',   label: 'Financeiro',   icon: DollarSign,      permissao: 'ver_resumo_financeiro' },
  { href: '/servicos',     label: 'Serviços',     icon: Scissors,        permissao: 'gerenciar_servicos'     },
  { href: '/pacotes',      label: 'Pacotes',      icon: Gift            },
  { href: '/equipe',       label: 'Equipe',       icon: UserCog,         permissao: 'gerenciar_profissionais' },
  { href: '/comissoes',    label: 'Comissões',    icon: Banknote,        permissao: 'ver_comissoes_todas'    },
  { href: '/estoque',      label: 'Estoque',      icon: Package,         permissao: 'gerenciar_estoque'      },
  { href: '/relatorios',   label: 'Relatórios',   icon: BarChart2,       permissao: 'ver_resumo_financeiro'  },
];

const BOTTOM_NAV_DESKTOP: { href: string; label: string; icon: React.ElementType; permissao?: Permissao }[] = [
  { href: '/notificacoes',  label: 'Notificações', icon: Bell     },
  { href: '/configuracoes', label: 'Configurações', icon: Settings, permissao: 'configurar_empresa' },
];

// 5 abas do bottom nav mobile (design Bellamore) — sem permissão condicionada:
// Financeiro some do bottom nav quando restrito (ver filtragem no componente)
const MOBILE_NAV: { href: string; label: string; icon: React.ElementType; permissao?: Permissao }[] = [
  { href: '/dashboard',  label: 'Início',     icon: LayoutDashboard },
  { href: '/agenda',     label: 'Agenda',     icon: CalendarDays    },
  { href: '/clientes',   label: 'Clientes',   icon: Users           },
  { href: '/financeiro', label: 'Financeiro', icon: DollarSign,      permissao: 'ver_resumo_financeiro' },
  { href: '/mais',       label: 'Mais',       icon: MoreHorizontal  },
];

// Itens do drawer "Mais" (mobile)
const MAIS_NAV: { href: string; label: string; icon: React.ElementType; permissao?: Permissao }[] = [
  { href: '/comanda',      label: 'Comanda',      icon: Receipt      },
  { href: '/vendas',       label: 'Vendas',        icon: ShoppingCart },
  { href: '/servicos',     label: 'Serviços',      icon: Scissors,     permissao: 'gerenciar_servicos'     },
  { href: '/pacotes',      label: 'Pacotes',       icon: Gift         },
  { href: '/equipe',       label: 'Equipe',        icon: UserCog,      permissao: 'gerenciar_profissionais' },
  { href: '/comissoes',    label: 'Comissões',     icon: Banknote,     permissao: 'ver_comissoes_todas'    },
  { href: '/estoque',      label: 'Estoque',       icon: Package,      permissao: 'gerenciar_estoque'      },
  { href: '/relatorios',   label: 'Relatórios',    icon: BarChart2,    permissao: 'ver_resumo_financeiro'  },
  { href: '/notificacoes', label: 'Notificações',  icon: Bell         },
  { href: '/configuracoes',label: 'Configurações', icon: Settings,     permissao: 'configurar_empresa'     },
];
```

Trocar a assinatura da função para aceitar `role`:

```tsx
export default function Sidebar({
  empresaId,
  empresaNome,
  empresaLogo,
  empresaSegmento,
  role,
}: {
  empresaId: string;
  empresaNome: string;
  empresaLogo: string | null;
  empresaSegmento: string;
  role: string | null;
}) {
```

Logo após a linha `const pathname = usePathname();` (dentro do corpo da função), adicionar:

```tsx
  const efetivo = (role ?? 'profissional') as 'owner' | PerfilRole;
  const navFiltrado          = NAV.filter(item => !item.permissao || temPermissao(efetivo, item.permissao));
  const bottomNavFiltrado    = BOTTOM_NAV_DESKTOP.filter(item => !item.permissao || temPermissao(efetivo, item.permissao));
  const mobileNavFiltrado    = MOBILE_NAV.filter(item => !item.permissao || temPermissao(efetivo, item.permissao));
  const maisNavFiltrado      = MAIS_NAV.filter(item => !item.permissao || temPermissao(efetivo, item.permissao));
```

E trocar as quatro ocorrências de `.map(...)` no JSX para usar as versões filtradas:
- `{NAV.map(` → `{navFiltrado.map(`
- `{BOTTOM_NAV_DESKTOP.map(` → `{bottomNavFiltrado.map(`
- `{MOBILE_NAV.map(` → `{mobileNavFiltrado.map(`
- `{MAIS_NAV.map(` → `{maisNavFiltrado.map(`

E, no drawer "Mais", a checagem `MAIS_NAV.some(({ href: h }) => pathname.startsWith(h))` (usada para saber se o botão "Mais" está ativo) deve usar `maisNavFiltrado` no lugar de `MAIS_NAV`.

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 4: Commit**

```bash
git add web/components/AppLayout.tsx web/components/Sidebar.tsx
git commit -m "feat: sidebar esconde itens de navegacao sem permissao para a role atual"
```

---

## Task 8: Web — guardas de rota nas 7 páginas restritas

**Files:**
- Create: `web/app/(app)/financeiro/layout.tsx`
- Create: `web/app/(app)/configuracoes/layout.tsx`
- Create: `web/app/(app)/equipe/layout.tsx`
- Create: `web/app/(app)/servicos/layout.tsx`
- Create: `web/app/(app)/estoque/layout.tsx`
- Create: `web/app/(app)/relatorios/layout.tsx`
- Create: `web/app/(app)/comissoes/layout.tsx`

**Interfaces:**
- Consumes: `getAppContext()` (`@/lib/auth/server-context`), `exigirPermissao()` (Task 6, `@/lib/auth/requireRole`).
- Produces: acesso direto por URL a essas 7 rotas passa a redirecionar (via `rotaInicial`) quem não tem a permissão — mesmo que a página em si seja `'use client'`, o `layout.tsx` do segmento roda no servidor antes dela.

Todas as páginas dentro de `(app)` já são `'use client'` e buscam dados via `createClient()` do lado do navegador — não chamam `getAppContext()`. Por isso a guarda entra como um `layout.tsx` novo no segmento de cada rota (Next.js renderiza o `layout.tsx` do segmento antes do `page.tsx` filho; um `redirect()` ali interrompe a renderização da página sem precisar tocar em nenhum desses arquivos client existentes).

- [ ] **Step 1: `financeiro/layout.tsx`**

```tsx
import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function FinanceiroLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'ver_resumo_financeiro');
  return <>{children}</>;
}
```

- [ ] **Step 2: `configuracoes/layout.tsx`**

```tsx
import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'configurar_empresa');
  return <>{children}</>;
}
```

- [ ] **Step 3: `equipe/layout.tsx`**

```tsx
import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function EquipeLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'gerenciar_profissionais');
  return <>{children}</>;
}
```

- [ ] **Step 4: `servicos/layout.tsx`**

```tsx
import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function ServicosLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'gerenciar_servicos');
  return <>{children}</>;
}
```

- [ ] **Step 5: `estoque/layout.tsx`**

```tsx
import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function EstoqueLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'gerenciar_estoque');
  return <>{children}</>;
}
```

- [ ] **Step 6: `relatorios/layout.tsx`**

```tsx
import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'ver_resumo_financeiro');
  return <>{children}</>;
}
```

- [ ] **Step 7: `comissoes/layout.tsx`**

```tsx
import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function ComissoesLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'ver_comissoes_todas');
  return <>{children}</>;
}
```

> Nota: isso torna a página de Comissões (gestão de pagamento por profissional) restrita a gestor/owner nesta entrega — a visão pessoal de comissão da profissional (o mobile já tem uma tela própria, `(profissional)/comissoes.tsx`) fica para uma iteração futura; a web não ganha uma tela equivalente neste pacote.

- [ ] **Step 8: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 9: Commit**

```bash
git add "web/app/(app)/financeiro/layout.tsx" "web/app/(app)/configuracoes/layout.tsx" "web/app/(app)/equipe/layout.tsx" "web/app/(app)/servicos/layout.tsx" "web/app/(app)/estoque/layout.tsx" "web/app/(app)/relatorios/layout.tsx" "web/app/(app)/comissoes/layout.tsx"
git commit -m "feat: adiciona guarda de permissao por role nas rotas restritas"
```

---

## Task 9: `web/app/api/profissionais/route.ts` — aceitar e validar `role` no convite

**Files:**
- Modify: `web/app/api/profissionais/route.ts`

**Interfaces:**
- Consumes: `podeAtribuirRole` de `@/lib/permissions` (Task 4).
- Produces: o `POST` passa a aceitar `role: 'gestor' | 'profissional'` no corpo da requisição; rejeita com 403 se quem chama não tiver permissão para atribuir esse role.

- [ ] **Step 1: Adicionar o import**

No topo de `web/app/api/profissionais/route.ts`, adicionar:

```ts
import { podeAtribuirRole } from '@/lib/permissions';
```

- [ ] **Step 2: Buscar o próprio role de quem chama e validar**

Trocar (dentro do `POST`):

```ts
    const { data: membroReq } = await supabase
      .from('empresa_membros')
      .select('empresa_id')
      .eq('user_id', user.id)
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .single();
    if (!membroReq) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
```

por:

```ts
    const { data: membroReq } = await supabase
      .from('empresa_membros')
      .select('empresa_id, role')
      .eq('user_id', user.id)
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .single();
    if (!membroReq) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const roleSolicitado: 'gestor' | 'profissional' = role === 'gestor' ? 'gestor' : 'profissional';
    if (!podeAtribuirRole(membroReq.role as 'owner' | 'gestor' | 'profissional', roleSolicitado)) {
      return NextResponse.json({ error: 'Você não pode convidar alguém com esse papel.' }, { status: 403 });
    }
```

- [ ] **Step 3: Aceitar `role` no corpo da requisição**

Trocar a linha de desestruturação do body:

```ts
    const { empresaId, nome, telefone, email, percentual_comissao } = await req.json();
```

por:

```ts
    const { empresaId, nome, telefone, email, percentual_comissao, role } = await req.json();
```

- [ ] **Step 4: Usar `roleSolicitado` ao criar o membro**

Trocar:

```ts
    const roleToUse = existing?.role ?? 'profissional';
```

por:

```ts
    const roleToUse = existing?.role ?? roleSolicitado;
```

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 6: Commit**

```bash
git add web/app/api/profissionais/route.ts
git commit -m "feat: api de convite valida quem pode atribuir role gestor"
```

---

## Task 10: Web `equipe/page.tsx` — seletor de role no convite

**Files:**
- Modify: `web/app/(app)/equipe/page.tsx`

**Interfaces:**
- Consumes: `podeAtribuirRole` de `@/lib/permissions`.
- Produces: `NovoProfModal` ganha um campo de role (só mostra "Gestora" se `meuRole === 'owner'`) e envia `role` no POST; `EquipePage` passa a guardar o próprio `user.id` e `role` em estado, repassando para `NovoProfModal` e (Task 11) para `ProfCard`.

- [ ] **Step 1: Importar `podeAtribuirRole`**

No topo de `web/app/(app)/equipe/page.tsx`, adicionar ao import existente de `@/lib/masks`/etc uma nova linha:

```tsx
import { podeAtribuirRole } from '@/lib/permissions';
```

- [ ] **Step 2: `NovoProfModal` ganha o campo de role**

Trocar a assinatura de `NovoProfModal`:

```tsx
function NovoProfModal({ empresaId, onClose, onSalvo }: {
  empresaId: string;
  onClose: () => void;
  onSalvo: (p: Profissional) => void;
}) {
```

por:

```tsx
function NovoProfModal({ empresaId, meuRole, onClose, onSalvo }: {
  empresaId: string;
  meuRole: 'owner' | 'gestor' | 'profissional';
  onClose: () => void;
  onSalvo: (p: Profissional) => void;
}) {
```

Adicionar o estado do role logo abaixo de `const [comissao, setComissao] = useState('0');`:

```tsx
  const [role, setRole] = useState<'gestor' | 'profissional'>('profissional');
```

No `body` do `fetch('/api/profissionais', ...)`, adicionar `role,`:

```tsx
      body: JSON.stringify({
        empresaId,
        nome:                 nome.trim(),
        telefone:             telefone.trim() || null,
        email:                email.trim() || null,
        percentual_comissao:  parseFloat(comissao) || 0,
        role,
      }),
```

No JSX, logo após o bloco do campo "E-mail" (antes do campo "Comissão por atendimento"), adicionar — só visível se `meuRole === 'owner'`:

```tsx
          {podeAtribuirRole(meuRole, 'gestor') && (
            <div>
              <label className={labelClass}>Papel</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setRole('profissional')}
                  className="flex-1 h-10 rounded-xl border text-sm font-semibold transition"
                  style={{
                    borderColor: role === 'profissional' ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  role === 'profissional' ? 'var(--color-primary-soft)' : 'transparent',
                    color:       role === 'profissional' ? 'var(--color-primary)' : 'var(--color-text-2)',
                  }}>
                  Profissional
                </button>
                <button type="button" onClick={() => setRole('gestor')}
                  className="flex-1 h-10 rounded-xl border text-sm font-semibold transition"
                  style={{
                    borderColor: role === 'gestor' ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  role === 'gestor' ? 'var(--color-primary-soft)' : 'transparent',
                    color:       role === 'gestor' ? 'var(--color-primary)' : 'var(--color-text-2)',
                  }}>
                  Gestora
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 3: `EquipePage` guarda o próprio id/role e repassa**

Adicionar dois estados novos logo após `const [confirmDesativar, setConfirmDesativar] = useState<Profissional | null>(null);`:

```tsx
  const [meuUserId, setMeuUserId] = useState<string | null>(null);
  const [meuRole,   setMeuRole]   = useState<'owner' | 'gestor' | 'profissional'>('profissional');
```

No `useEffect` de carregamento inicial, trocar:

```tsx
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;
      setEmpresaId(membro.empresa_id);
      await carregarEquipe(membro.empresa_id);
    })();
  }, []);
```

por:

```tsx
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id, role')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;
      setEmpresaId(membro.empresa_id);
      setMeuUserId(user.id);
      setMeuRole(membro.role as 'owner' | 'gestor' | 'profissional');
      await carregarEquipe(membro.empresa_id);
    })();
  }, []);
```

E, no JSX, trocar:

```tsx
      {modal && empresaId && (
        <NovoProfModal empresaId={empresaId} onClose={() => setModal(false)} onSalvo={onProfSalva}/>
      )}
```

por:

```tsx
      {modal && empresaId && (
        <NovoProfModal empresaId={empresaId} meuRole={meuRole} onClose={() => setModal(false)} onSalvo={onProfSalva}/>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/equipe/page.tsx"
git commit -m "feat: convite de equipe permite escolher role quando quem convida pode"
```

---

## Task 11: Web `equipe/page.tsx` — promover/rebaixar um membro existente

**Files:**
- Modify: `web/app/(app)/equipe/page.tsx`

**Interfaces:**
- Consumes: `meuUserId`, `meuRole` (Task 10); cliente Supabase autenticado (`update` direto em `empresa_membros`, protegido pelo trigger/policies da Task 3).
- Produces: botão "Promover a gestora" / "Rebaixar a profissional" em `ProfCard`, visível só para `meuRole === 'owner'` e quando a linha não é a própria dona nem o próprio usuário logado.

- [ ] **Step 1: `ProfCard` ganha a ação de alterar role**

Trocar a assinatura de `ProfCard`:

```tsx
function ProfCard({ prof, onEditInfo, onToggle, onPagar }: {
  prof: Profissional;
  onEditInfo: () => void;
  onToggle: () => void;
  onPagar: () => void;
}) {
```

por:

```tsx
function ProfCard({ prof, podeAlterarRole, onEditInfo, onToggle, onPagar, onAlterarRole }: {
  prof: Profissional;
  podeAlterarRole: boolean;
  onEditInfo: () => void;
  onToggle: () => void;
  onPagar: () => void;
  onAlterarRole: () => void;
}) {
```

No JSX, logo após o botão "Ativar / desativar" (antes do `</div>` que fecha o conteúdo expandido, linha com `{/* Ativar / desativar */}` ... `</button>`), adicionar:

```tsx
          {/* Promover / rebaixar */}
          {podeAlterarRole && prof.role !== 'owner' && (
            <button onClick={onAlterarRole}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 14, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)', marginTop: 8 }}>
              <UserCog size={13} strokeWidth={2}/>
              {prof.role === 'gestor' ? 'Rebaixar para profissional' : 'Promover a gestora'}
            </button>
          )}
```

(`UserCog` já está importado em `web/app/(app)/equipe/page.tsx` — usado em outro lugar do arquivo para o ícone de stats.)

- [ ] **Step 2: `EquipePage` implementa `alterarRole` e passa a prop**

Adicionar a função, próxima de `toggleAtivo`:

```tsx
  async function alterarRole(prof: Profissional) {
    const novoRole = prof.role === 'gestor' ? 'profissional' : 'gestor';
    const { error } = await supabase.from('empresa_membros')
      .update({ role: novoRole })
      .eq('id', prof.id);
    if (error) { alert(error.message); return; }
    setProfs(prev => prev.map(p => p.id === prof.id ? { ...p, role: novoRole } : p));
  }
```

No JSX, trocar a linha que renderiza `ProfCard`:

```tsx
                <ProfCard prof={p} onEditInfo={() => setEditandoInfo(p)} onToggle={() => toggleAtivo(p)} onPagar={() => pagarComissoes(p.user_id)}/>
```

por:

```tsx
                <ProfCard
                  prof={p}
                  podeAlterarRole={meuRole === 'owner' && p.user_id !== meuUserId}
                  onEditInfo={() => setEditandoInfo(p)}
                  onToggle={() => toggleAtivo(p)}
                  onPagar={() => pagarComissoes(p.user_id)}
                  onAlterarRole={() => alterarRole(p)}
                />
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/equipe/page.tsx"
git commit -m "feat: dona pode promover/rebaixar membros da equipe"
```

---

## Task 12: Mobile `convidar-profissional.tsx` — seletor de role

**Files:**
- Modify: `mobile/app/(empresa)/convidar-profissional.tsx`

**Interfaces:**
- Consumes: `isOwner` de `useAuthStore()` (já existente); `podeAtribuirRole` de `@/lib/permissions` (Task 5).
- Produces: tela de convite ganha um seletor Gestora/Profissional (só visível se `isOwner`); o `upsert` em `empresa_membros` passa a usar o role escolhido.

- [ ] **Step 1: Importar e capturar `isOwner`**

Trocar:

```tsx
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
```

por:

```tsx
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { podeAtribuirRole } from '@/lib/permissions';
```

Trocar:

```tsx
  const { empresaAtiva } = useAuthStore();
```

por:

```tsx
  const { empresaAtiva, isOwner } = useAuthStore();
```

- [ ] **Step 2: Estado do role e uso no upsert**

Adicionar, junto aos outros `useState`:

```tsx
  const [role, setRole] = useState<'gestor' | 'profissional'>('profissional');
```

Na função `convidar()`, trocar a linha `role: 'profissional',` (dentro do `.upsert({...})`) por `role,`.

- [ ] **Step 3: Seletor no JSX**

Logo após o campo "Telefone" (antes do botão "Enviar convite"), adicionar — condicionado a `podeAtribuirRole(isOwner ? 'owner' : 'gestor', 'gestor')`, ou seja, só quando quem está convidando é a dona:

```tsx
          {podeAtribuirRole(isOwner ? 'owner' : 'gestor', 'gestor') && (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
                Papel
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => setRole('profissional')}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: role === 'profissional' ? C.primary : C.border,
                    backgroundColor: role === 'profissional' ? C.primarySoft : C.surface,
                  }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: role === 'profissional' ? C.primary : C.text2 }}>
                    Profissional
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRole('gestor')}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: role === 'gestor' ? C.primary : C.border,
                    backgroundColor: role === 'gestor' ? C.primarySoft : C.surface,
                  }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: role === 'gestor' ? C.primary : C.text2 }}>
                    Gestora
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
```

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(empresa)/convidar-profissional.tsx"
git commit -m "feat: convite mobile permite escolher role quando quem convida e a dona"
```

---

## Task 13: Mobile `equipe.tsx` — incluir gestoras na lista + promover/rebaixar

**Files:**
- Modify: `mobile/app/(empresa)/equipe.tsx`

**Interfaces:**
- Consumes: `isOwner` de `useAuthStore()`.
- Produces: `useEquipe()` passa a listar `gestor` e `profissional` (não só `profissional`); `MembroEquipe` ganha o campo `role`; `ProfCard` ganha um botão de promover/rebaixar visível só para `isOwner`.

- [ ] **Step 1: Ampliar a query e o tipo**

Trocar:

```tsx
interface MembroEquipe {
  id: string;
  user_id: string;
  percentual_comissao: number;
  ativo: boolean;
  created_at: string;
  user: { id: string; nome: string; telefone?: string; foto_url?: string };
  total_mes: number;
  atendimentos_mes: number;
}
```

por:

```tsx
interface MembroEquipe {
  id: string;
  user_id: string;
  role: 'gestor' | 'profissional';
  percentual_comissao: number;
  ativo: boolean;
  created_at: string;
  user: { id: string; nome: string; telefone?: string; foto_url?: string };
  total_mes: number;
  atendimentos_mes: number;
}
```

Trocar, dentro de `useEquipe()`:

```tsx
      const { data: membros, error } = await supabase
        .from('empresa_membros')
        .select('*, user:users(id, nome, telefone, foto_url)')
        .eq('empresa_id', empresaId!)
        .eq('role', 'profissional')
        .order('ativo', { ascending: false })
        .order('created_at');
```

por:

```tsx
      const { data: membros, error } = await supabase
        .from('empresa_membros')
        .select('*, user:users(id, nome, telefone, foto_url)')
        .eq('empresa_id', empresaId!)
        .in('role', ['gestor', 'profissional'])
        .order('ativo', { ascending: false })
        .order('created_at');
```

- [ ] **Step 2: `ProfCard` ganha o botão de promover/rebaixar**

Trocar a assinatura:

```tsx
function ProfCard({ membro, onEditComissao, onToggle }: {
  membro: MembroEquipe;
  onEditComissao: () => void;
  onToggle: () => void;
}) {
```

por:

```tsx
function ProfCard({ membro, podeAlterarRole, onEditComissao, onToggle, onAlterarRole }: {
  membro: MembroEquipe;
  podeAlterarRole: boolean;
  onEditComissao: () => void;
  onToggle: () => void;
  onAlterarRole: () => void;
}) {
```

Adicionar, logo após o bloco "Comissão" (`</TouchableOpacity>` que fecha o card de percentual) e antes do bloco "Ações":

```tsx
      {podeAlterarRole && (
        <TouchableOpacity
          onPress={onAlterarRole}
          style={{
            padding: 10, borderRadius: 10, marginBottom: 8,
            borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>
            {membro.role === 'gestor' ? 'Rebaixar para profissional' : 'Promover a gestora'}
          </Text>
        </TouchableOpacity>
      )}
```

- [ ] **Step 3: Tela principal captura `isOwner`, implementa `alterarRole` e passa a prop**

Trocar:

```tsx
export default function Equipe() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();
```

por:

```tsx
export default function Equipe() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva, isOwner } = useAuthStore();
  const qc = useQueryClient();
```

Adicionar, junto às outras funções (`toggleAtivo`, `salvarComissao`):

```tsx
  async function alterarRole(m: MembroEquipe) {
    const novoRole = m.role === 'gestor' ? 'profissional' : 'gestor';
    const { error } = await supabase
      .from('empresa_membros')
      .update({ role: novoRole })
      .eq('id', m.id);
    if (error) { Alert.alert('Erro', error.message); return; }
    qc.invalidateQueries({ queryKey: ['equipe'] });
  }
```

Trocar a renderização de `ProfCard`:

```tsx
            <ProfCard
              key={m.id}
              membro={m}
              onEditComissao={() => setEditando(m)}
              onToggle={() => toggleAtivo(m)}
            />
```

por:

```tsx
            <ProfCard
              key={m.id}
              membro={m}
              podeAlterarRole={isOwner}
              onEditComissao={() => setEditando(m)}
              onToggle={() => toggleAtivo(m)}
              onAlterarRole={() => alterarRole(m)}
            />
```

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(empresa)/equipe.tsx"
git commit -m "feat: equipe mobile lista gestoras e permite promover/rebaixar"
```

---

## Task 14: Verificação manual de ponta a ponta

**Files:** nenhum (só verificação — não há como testar RLS/guardas de forma automatizada sem infraestrutura de teste E2E que este projeto não tem).

- [ ] **Step 1: Criar uma segunda conta de teste**

Na web, como owner, usar o modal "Nova profissional" em Equipe para criar uma conta com e-mail de teste (ex.: `teste.profissional@exemplo.com`), papel "Profissional".

- [ ] **Step 2: Confirmar RLS de leitura (SQL Editor do Supabase, como o usuário de teste ou via `set local request.jwt.claim.sub`)**

```sql
select count(*) from despesas where empresa_id = '<empresa_id>';
```
Esperado: erro de permissão ou 0 linhas (a policy nova exige `is_gestor_ou_owner`).

```sql
select count(*) from agendamentos where empresa_id = '<empresa_id>' and profissional_id <> '<uuid-do-teste>';
```
Esperado: 0 linhas (só enxerga os próprios agendamentos).

- [ ] **Step 3: Confirmar guardas de UI na web**

Logar como a conta de teste (profissional). Verificar:
- Sidebar não mostra Financeiro, Configurações, Equipe, Serviços, Estoque, Relatórios, Comissões.
- Acessar `/financeiro` direto pela URL redireciona para `/agenda`.
- `/agenda` abre normalmente e mostra só os próprios atendimentos.

- [ ] **Step 4: Confirmar regra de promover/rebaixar**

Logado como a dona (owner) na web, abrir Equipe, expandir o card da conta de teste, clicar "Promover a gestora" — badge deve mudar para "Gestor(a)" e o botão passa a dizer "Rebaixar para profissional". Confirmar que a própria dona não tem esse botão em seu próprio card (ele não deve nem aparecer, já que `prof.role === 'owner'`).

- [ ] **Step 5: Confirmar que uma gestora não pode se autopromover**

No SQL Editor, autenticado como a conta de teste já promovida a gestora, tentar:

```sql
update empresa_membros set role = 'owner' where user_id = '<uuid-do-teste>';
```
Esperado: erro `O papel de dona não pode ser alterado.` (trigger `bloquear_alteracao_role`).

- [ ] **Step 6: Rodar a suíte de testes e o typecheck completos**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: tudo passando, zero erros de tipo.

- [ ] **Step 7: Reverter a conta de teste (opcional)**

Se a conta de teste não for necessária, desativá-la em Equipe (não deletar dados — usar "Desativar profissional").
