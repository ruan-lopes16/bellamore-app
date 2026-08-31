# Categorias de serviço personalizadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que cada empresa cadastre categorias de serviço próprias (nome + cor + ícone), além das 8 fixas, e usá-las em toda a UI que hoje mostra categoria.

**Architecture:** Tabela nova `categorias_servico` (uma linha por categoria personalizada, por empresa) + coluna `servicos.categoria_id` com `on delete set null`. As 8 categorias fixas continuam no código (`shared/categorias.ts`). Uma função pura `resolverCategoriaServico(categoria, categoria_id, customs)` no shared decide label/cor/bg/ícone; toda tela que renderiza categoria passa a chamá-la. Criação inline no formulário de serviço; edição/exclusão num mini-gerenciador na tela Serviços.

**Tech Stack:** Next.js 15 (App Router, Client Components) + React Native (Expo) + Supabase (Postgres + RLS) + Tailwind (web) + lucide-react / lucide-react-native + vitest (só web).

## Global Constraints

- Migration nova: `supabase/migrations/063_categorias_servico.sql` (063 = próximo sequencial; o último é `062_taxas_metodo_pagamento.sql`).
- RLS obrigatória em tabela nova; escrita (`insert`/`update`/`delete`) restrita a gestor/owner via `is_gestor_ou_owner(empresa_id)` (mesmo padrão de `despesas`, migration 003). Leitura para qualquer membro via `empresa_id in (select minha_empresas())`.
- `servicos.categoria` (texto) e `servicos.categoria_id` (FK) são mutuamente exclusivos — no máximo um preenchido. Garantido por `check constraint` na migration.
- Nenhum backfill; serviços existentes continuam com `categoria` texto.
- Paleta curada: exatamente estes 10 pares (ordem fixa):
  `#4F46E5/#EEF2FF`, `#7C3AED/#F3EFFE`, `#D4608A/#FDF0F5`, `#B45309/#FEF3E2`, `#0D7E5F/#EAFAF5`, `#0891B2/#ECFEFF`, `#C026D3/#FDF4FF`, `#DC2626/#FEF2F2`, `#2563EB/#EFF6FF`, `#6B7280/#F3F4F6`.
- Ícones curados: exatamente estes 12 nomes (verificados em `lucide-react@1.17.0` e `lucide-react-native@0.363.0`):
  `Sparkles, Scissors, Heart, Star, Gem, Flower, Wand, Droplet, Sun, Hand, Smile, Leaf`. Fallback quando o nome salvo não resolve: `Tag`.
- Client Components web: `const supabase = createClient()` no nível do módulo (padrão do projeto).
- Queries adicionais entram no `Promise.all` existente de cada tela (sem waterfall).
- `npx tsc --noEmit` limpo no web; mobile mantém a baseline de 10 erros pré-existentes (`comissoes.tsx`, `configuracoes.tsx` ×2, `estoque.tsx`, `novo-cliente.tsx`, `relatorios.tsx`, `useAgenda.ts`, `useNotificacoes.ts` ×2, `hooks/useAgenda.ts`) — nenhum erro novo.
- Testes: `cd web && npx vitest run <arquivo>`. Mobile não tem runner de teste — validação é `tsc`.
- Idioma de UI e comentários: português.

---

### Task 1: Migration `063_categorias_servico.sql`

**Files:**
- Create: `supabase/migrations/063_categorias_servico.sql`
- Create: `web/tests/unit/categorias-servico-migration.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: tabela `public.categorias_servico (id uuid pk, empresa_id uuid, nome text, cor text, icone text, created_at timestamptz)`; coluna `public.servicos.categoria_id uuid null`; check `servicos_categoria_xor`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/categorias-servico-migration.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readAllMigrations(): string {
  const dir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8').toLowerCase())
    .join('\n');
}

describe('Migration 063: categorias_servico', () => {
  const sql = readAllMigrations();

  it('cria a tabela com RLS habilitado', () => {
    expect(sql).toContain('create table public.categorias_servico');
    expect(sql).toMatch(/alter table public\.categorias_servico\s+enable row level security/);
  });

  it('tem colunas nome, cor e icone not null', () => {
    expect(sql).toMatch(/create table public\.categorias_servico[\s\S]{0,400}nome\s+text not null/);
    expect(sql).toMatch(/create table public\.categorias_servico[\s\S]{0,400}cor\s+text not null/);
    expect(sql).toMatch(/create table public\.categorias_servico[\s\S]{0,400}icone\s+text not null/);
  });

  it('impede nome duplicado por empresa (case-insensitive)', () => {
    expect(sql).toMatch(/unique index[\s\S]{0,120}categorias_servico\s*\(empresa_id,\s*lower\(nome\)\)/);
  });

  it('libera select para membro e escrita so para gestor/owner', () => {
    expect(sql).toMatch(/categorias_servico[\s\S]{0,400}for select[\s\S]{0,160}minha_empresas/);
    expect(sql).toMatch(/categorias_servico[\s\S]{0,400}for insert[\s\S]{0,160}is_gestor_ou_owner/);
    expect(sql).toMatch(/categorias_servico[\s\S]{0,400}for update[\s\S]{0,160}is_gestor_ou_owner/);
    expect(sql).toMatch(/categorias_servico[\s\S]{0,400}for delete[\s\S]{0,160}is_gestor_ou_owner/);
  });

  it('adiciona servicos.categoria_id com on delete set null', () => {
    expect(sql).toMatch(/alter table public\.servicos\s+add column categoria_id uuid references public\.categorias_servico\(id\) on delete set null/);
  });

  it('impede categoria e categoria_id preenchidos juntos', () => {
    expect(sql).toMatch(/servicos_categoria_xor[\s\S]{0,120}check \(categoria is null or categoria_id is null\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/unit/categorias-servico-migration.test.ts`
Expected: FAIL (todas as asserções — arquivo de migration ainda não existe).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/063_categorias_servico.sql`:

```sql
-- ============================================================
-- CATEGORIAS DE SERVICO PERSONALIZADAS
-- ------------------------------------------------------------
-- As 8 categorias fixas continuam no codigo (shared/categorias.ts).
-- Esta tabela guarda apenas as categorias que a empresa cria.
-- servicos.categoria (texto) segue valendo para as fixas;
-- servicos.categoria_id aponta para uma personalizada.
-- No maximo um dos dois preenchido (check servicos_categoria_xor).
-- ============================================================

create table public.categorias_servico (
  id          uuid primary key default uuid_generate_v4(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  nome        text not null,
  cor         text not null,   -- hex; um dos valores da paleta curada (shared/categorias.ts)
  icone       text not null,   -- nome de icone lucide; um da lista curada
  created_at  timestamptz default now()
);

-- Nome unico por empresa, case-insensitive
create unique index categorias_servico_empresa_nome_uniq
  on public.categorias_servico (empresa_id, lower(nome));

alter table public.categorias_servico enable row level security;

create policy "categorias_servico: membro ve"
  on public.categorias_servico for select
  using (empresa_id in (select minha_empresas()));

create policy "categorias_servico: gestor insere"
  on public.categorias_servico for insert
  with check (is_gestor_ou_owner(empresa_id));

create policy "categorias_servico: gestor atualiza"
  on public.categorias_servico for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

create policy "categorias_servico: gestor deleta"
  on public.categorias_servico for delete
  using (is_gestor_ou_owner(empresa_id));

-- Vinculo no servico
alter table public.servicos
  add column categoria_id uuid references public.categorias_servico(id) on delete set null;

-- built-in (texto) XOR personalizada (fk); ambos nulos = sem categoria (renderiza como Outros)
alter table public.servicos
  add constraint servicos_categoria_xor
  check (categoria is null or categoria_id is null);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/unit/categorias-servico-migration.test.ts`
Expected: PASS (6 asserções).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/063_categorias_servico.sql web/tests/unit/categorias-servico-migration.test.ts
git commit -m "feat: migration 063 — tabela categorias_servico + servicos.categoria_id"
```

---

### Task 2: Shared — helpers de resolução + tipos

**Files:**
- Modify: `shared/categorias.ts` (append no fim; não altera nada existente)
- Modify: `web/types/index.ts` (`Servico` ganha `categoria_id`)
- Modify: `mobile/types/index.ts` (`Servico` ganha `categoria_id`)
- Modify: `mobile/hooks/useAgenda.ts` (`AgendamentoCompleto.servico` ganha `categoria_id`)
- Create: `web/tests/unit/categorias.test.ts`

**Interfaces:**
- Consumes: `CategoriaServico`, `CATEGORIA_COR`, `CATEGORIA_BG`, `CATEGORIA_LABEL`, `ALL_CATEGORIAS` (já existem em `shared/categorias.ts`).
- Produces:
  - `type CategoriaCustom = { id: string; empresa_id: string; nome: string; cor: string; icone: string }`
  - `const CATEGORIA_PALETA: { cor: string; bg: string }[]` (10 itens, ordem do Global Constraints)
  - `const CATEGORIA_ICONES: readonly string[]` (12 nomes do Global Constraints)
  - `function bgDaCor(cor: string): string`
  - `type CategoriaResolvida = { chave: string; label: string; cor: string; bg: string; tipo: 'builtin' | 'custom' | 'nenhuma'; iconeBuiltin?: CategoriaServico; iconeCustom?: string }`
  - `function resolverCategoriaServico(categoria: string | null | undefined, categoriaId: string | null | undefined, customs: CategoriaCustom[]): CategoriaResolvida`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/categorias.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CATEGORIA_PALETA,
  CATEGORIA_ICONES,
  bgDaCor,
  resolverCategoriaServico,
  type CategoriaCustom,
} from '@shared/categorias';

const custom: CategoriaCustom = {
  id: 'c1', empresa_id: 'e1', nome: 'Massagem', cor: '#DC2626', icone: 'Heart',
};

describe('paleta e icones curados', () => {
  it('tem 10 cores e 12 icones', () => {
    expect(CATEGORIA_PALETA).toHaveLength(10);
    expect(CATEGORIA_ICONES).toHaveLength(12);
  });
  it('bgDaCor devolve o bg do par ou cinza para cor fora da paleta', () => {
    expect(bgDaCor('#DC2626')).toBe('#FEF2F2');
    expect(bgDaCor('#123456')).toBe('#F3F4F6');
  });
});

describe('resolverCategoriaServico', () => {
  it('categoria built-in conhecida', () => {
    const r = resolverCategoriaServico('cilios', null, []);
    expect(r.tipo).toBe('builtin');
    expect(r.chave).toBe('cilios');
    expect(r.label).toBe('Cílios');
    expect(r.cor).toBe('#4F46E5');
    expect(r.iconeBuiltin).toBe('cilios');
  });

  it('categoria_id com custom presente na lista', () => {
    const r = resolverCategoriaServico(null, 'c1', [custom]);
    expect(r.tipo).toBe('custom');
    expect(r.chave).toBe('c1');
    expect(r.label).toBe('Massagem');
    expect(r.cor).toBe('#DC2626');
    expect(r.bg).toBe('#FEF2F2');
    expect(r.iconeCustom).toBe('Heart');
  });

  it('categoria_id apontando para custom ausente (categoria apagada) cai em Outros', () => {
    const r = resolverCategoriaServico(null, 'c-removida', [custom]);
    expect(r.tipo).toBe('nenhuma');
    expect(r.chave).toBe('outros');
    expect(r.label).toBe('Outros');
    expect(r.iconeBuiltin).toBe('outros');
  });

  it('ambos nulos cai em Outros', () => {
    expect(resolverCategoriaServico(null, null, []).chave).toBe('outros');
    expect(resolverCategoriaServico(undefined, undefined, []).tipo).toBe('nenhuma');
  });

  it('categoria texto fora das 8 chaves, sem categoria_id, cai em Outros', () => {
    const r = resolverCategoriaServico('massagem-legada', null, []);
    expect(r.chave).toBe('outros');
    expect(r.tipo).toBe('nenhuma');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/unit/categorias.test.ts`
Expected: FAIL ("does not provide an export named 'resolverCategoriaServico'").

- [ ] **Step 3: Append helpers to `shared/categorias.ts`**

Adicione ao FINAL de `shared/categorias.ts` (não altere o que já existe):

```ts
// ── Categorias personalizadas (por empresa) ──────────────────

export type CategoriaCustom = {
  id: string;
  empresa_id: string;
  nome: string;
  cor: string;
  icone: string;
};

/** Paleta curada — cor = traço/texto; bg = fundo suave do chip. Ordem fixa. */
export const CATEGORIA_PALETA: { cor: string; bg: string }[] = [
  { cor: '#4F46E5', bg: '#EEF2FF' },
  { cor: '#7C3AED', bg: '#F3EFFE' },
  { cor: '#D4608A', bg: '#FDF0F5' },
  { cor: '#B45309', bg: '#FEF3E2' },
  { cor: '#0D7E5F', bg: '#EAFAF5' },
  { cor: '#0891B2', bg: '#ECFEFF' },
  { cor: '#C026D3', bg: '#FDF4FF' },
  { cor: '#DC2626', bg: '#FEF2F2' },
  { cor: '#2563EB', bg: '#EFF6FF' },
  { cor: '#6B7280', bg: '#F3F4F6' },
];

/** Nomes de ícones lucide (existem em lucide-react e lucide-react-native). */
export const CATEGORIA_ICONES = [
  'Sparkles', 'Scissors', 'Heart', 'Star', 'Gem', 'Flower',
  'Wand', 'Droplet', 'Sun', 'Hand', 'Smile', 'Leaf',
] as const;

/** bg correspondente a uma cor da paleta; cinza se a cor não estiver na paleta. */
export function bgDaCor(cor: string): string {
  return CATEGORIA_PALETA.find((p) => p.cor === cor)?.bg ?? '#F3F4F6';
}

export type CategoriaResolvida = {
  chave: string;                    // chave built-in, id da custom, ou 'outros'
  label: string;
  cor: string;
  bg: string;
  tipo: 'builtin' | 'custom' | 'nenhuma';
  iconeBuiltin?: CategoriaServico;  // renderizar via CategoriaIcon / CATEGORIA_SVG
  iconeCustom?: string;             // nome lucide
};

const _CHAVES_BUILTIN = new Set<string>(ALL_CATEGORIAS);

/**
 * Resolve a aparência da categoria de um serviço.
 * Prioridade: categoria_id (personalizada) → categoria (built-in) → Outros.
 * Um categoria_id que não bate com nenhuma custom da lista (categoria apagada)
 * cai em Outros.
 */
export function resolverCategoriaServico(
  categoria: string | null | undefined,
  categoriaId: string | null | undefined,
  customs: CategoriaCustom[],
): CategoriaResolvida {
  if (categoriaId) {
    const c = customs.find((x) => x.id === categoriaId);
    if (c) {
      return {
        chave: c.id,
        label: c.nome,
        cor: c.cor,
        bg: bgDaCor(c.cor),
        tipo: 'custom',
        iconeCustom: c.icone,
      };
    }
  }
  if (categoria && _CHAVES_BUILTIN.has(categoria)) {
    const k = categoria as CategoriaServico;
    return {
      chave: k,
      label: CATEGORIA_LABEL[k],
      cor: CATEGORIA_COR[k],
      bg: CATEGORIA_BG[k],
      tipo: 'builtin',
      iconeBuiltin: k,
    };
  }
  return {
    chave: 'outros',
    label: CATEGORIA_LABEL.outros,
    cor: CATEGORIA_COR.outros,
    bg: CATEGORIA_BG.outros,
    tipo: 'nenhuma',
    iconeBuiltin: 'outros',
  };
}
```

- [ ] **Step 4: Add `categoria_id` to the type declarations**

`web/types/index.ts` — no `interface Servico` (linha ~59), logo abaixo de `categoria?: string;`:

```ts
  categoria_id?: string | null;
```

`mobile/types/index.ts` — no `interface Servico` (linha ~70), logo abaixo de `categoria?: string;`:

```ts
  categoria_id?: string | null;
```

`mobile/hooks/useAgenda.ts` — na interface `AgendamentoCompleto` (linha ~19), trocar a linha do `servico` para:

```ts
  servico:      { id: string; nome: string; duracao_minutos: number; categoria?: string; categoria_id?: string | null };
```

- [ ] **Step 5: Run tests + tsc**

Run: `cd web && npx vitest run tests/unit/categorias.test.ts`
Expected: PASS.
Run: `cd web && npx tsc --noEmit`
Expected: exit 0.
Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `10` (baseline inalterada).

- [ ] **Step 6: Commit**

```bash
git add shared/categorias.ts web/types/index.ts mobile/types/index.ts mobile/hooks/useAgenda.ts web/tests/unit/categorias.test.ts
git commit -m "feat: helpers resolverCategoriaServico + paleta/icones curados no shared"
```

---

### Task 3: Web — `CategoriaIconCustom`

**Files:**
- Modify: `web/components/CategoriaIcon.tsx` (append)

**Interfaces:**
- Consumes: nada novo.
- Produces: `CategoriaIconCustom({ name: string; size?: number; color?: string; strokeWidth?: number; className?: string; style?: React.CSSProperties })` — renderiza o ícone lucide `name`; cai em `Tag` se não resolver.

- [ ] **Step 1: Append the component**

No fim de `web/components/CategoriaIcon.tsx`:

```tsx
import * as LucideIcons from 'lucide-react';

/** Ícone de categoria personalizada, por nome lucide (ver CATEGORIA_ICONES no shared). */
export function CategoriaIconCustom({
  name, size = 20, color = 'currentColor', strokeWidth = 1.8, className, style,
}: IconProps & { name: string }) {
  const Cmp =
    (LucideIcons as unknown as Record<string, React.ElementType>)[name] ?? LucideIcons.Tag;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} className={className} style={style} />;
}
```

- [ ] **Step 2: tsc**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/components/CategoriaIcon.tsx
git commit -m "feat: CategoriaIconCustom (web) para icones de categoria personalizada"
```

---

### Task 4: Web — `CategoriaPicker` (chips + criar inline)

**Files:**
- Create: `web/components/CategoriaPicker.tsx`

**Interfaces:**
- Consumes: `resolverCategoriaServico`, `CATEGORIA_PALETA`, `CATEGORIA_ICONES`, `bgDaCor`, `type CategoriaCustom` (Task 2); `CategoriaIcon`, `CategoriaIconCustom`, `CATEGORIA_COR`, `CATEGORIA_BG` (Tasks 3 / existentes); `ALL_CATEGORIAS`, `CATEGORIA_LABEL` (shared).
- Produces: componente
  ```tsx
  CategoriaPicker({
    empresaId: string;
    customs: CategoriaCustom[];
    categoria: string | null;        // chave built-in selecionada (ou null)
    categoriaId: string | null;      // id da custom selecionada (ou null)
    onSelect: (categoria: string | null, categoriaId: string | null) => void;
    onCustomCriada: (c: CategoriaCustom) => void;
  })
  ```
  Regra de seleção: escolher built-in → `onSelect('<chave>', null)`; escolher custom → `onSelect(null, '<id>')`.

- [ ] **Step 1: Implement the component**

Create `web/components/CategoriaPicker.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { CategoriaIcon, CategoriaIconCustom } from '@/components/CategoriaIcon';
import {
  ALL_CATEGORIAS, CATEGORIA_LABEL, CATEGORIA_COR, CATEGORIA_BG,
  CATEGORIA_PALETA, CATEGORIA_ICONES, bgDaCor,
  type CategoriaCustom, type CategoriaServico,
} from '@shared/categorias';

const supabase = createClient();

type Props = {
  empresaId: string;
  customs: CategoriaCustom[];
  categoria: string | null;
  categoriaId: string | null;
  onSelect: (categoria: string | null, categoriaId: string | null) => void;
  onCustomCriada: (c: CategoriaCustom) => void;
};

const chipBase =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition';

export function CategoriaPicker({ empresaId, customs, categoria, categoriaId, onSelect, onCustomCriada }: Props) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome]   = useState('');
  const [cor,  setCor]    = useState(CATEGORIA_PALETA[0].cor);
  const [icone, setIcone] = useState<string>(CATEGORIA_ICONES[0]);
  const [erro, setErro]   = useState('');
  const [salvando, setSalvando] = useState(false);

  const nomesUsados = new Set<string>([
    ...ALL_CATEGORIAS.map((k) => CATEGORIA_LABEL[k].toLowerCase()),
    ...customs.map((c) => c.nome.toLowerCase()),
  ]);

  async function criar() {
    const limpo = nome.trim();
    if (!limpo) { setErro('Dê um nome à categoria.'); return; }
    if (nomesUsados.has(limpo.toLowerCase())) { setErro('Já existe uma categoria com esse nome.'); return; }
    setErro(''); setSalvando(true);
    const { data, error } = await supabase
      .from('categorias_servico')
      .insert({ empresa_id: empresaId, nome: limpo, cor, icone })
      .select('*')
      .single();
    setSalvando(false);
    if (error) { setErro(error.message.includes('categorias_servico_empresa_nome_uniq') ? 'Já existe uma categoria com esse nome.' : 'Sem permissão para criar categoria (só gestor/dono).'); return; }
    const nova = data as CategoriaCustom;
    onCustomCriada(nova);
    onSelect(null, nova.id);
    setCriando(false); setNome(''); setCor(CATEGORIA_PALETA[0].cor); setIcone(CATEGORIA_ICONES[0]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {ALL_CATEGORIAS.map((k: CategoriaServico) => {
          const ativo = categoria === k && !categoriaId;
          return (
            <button key={k} type="button" onClick={() => onSelect(k, null)}
              className={chipBase}
              style={{
                backgroundColor: ativo ? CATEGORIA_BG[k] : undefined,
                borderColor: ativo ? CATEGORIA_COR[k] : undefined,
                color: ativo ? CATEGORIA_COR[k] : undefined,
              }}
              data-inactive={!ativo || undefined}>
              <CategoriaIcon categoria={k} size={12} color={ativo ? CATEGORIA_COR[k] : undefined}
                className={!ativo ? 'text-text-4' : ''} />
              <span className={!ativo ? 'text-text-3' : ''}>{CATEGORIA_LABEL[k]}</span>
            </button>
          );
        })}
        {customs.map((c) => {
          const ativo = categoriaId === c.id;
          return (
            <button key={c.id} type="button" onClick={() => onSelect(null, c.id)}
              className={chipBase}
              style={{
                backgroundColor: ativo ? bgDaCor(c.cor) : undefined,
                borderColor: ativo ? c.cor : undefined,
                color: ativo ? c.cor : undefined,
              }}
              data-inactive={!ativo || undefined}>
              <CategoriaIconCustom name={c.icone} size={12} color={ativo ? c.cor : undefined}
                className={!ativo ? 'text-text-4' : ''} />
              <span className={!ativo ? 'text-text-3' : ''}>{c.nome}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setCriando((v) => !v)}
          className={`${chipBase} border-dashed border-border text-text-3 hover:border-accent hover:text-accent`}>
          <Plus size={12} strokeWidth={2.5} /> Nova
        </button>
      </div>

      {criando && (
        <div className="mt-3 rounded-xl border border-border bg-bg p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-2 uppercase tracking-wide">Nova categoria</span>
            <button type="button" onClick={() => setCriando(false)} className="text-text-4 hover:text-text-2"><X size={14} /></button>
          </div>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex: Massagem)"
            className="w-full h-9 px-3 rounded-lg border border-border bg-surface text-text text-sm focus:outline-none focus:border-accent" />
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIA_PALETA.map((p) => (
              <button key={p.cor} type="button" onClick={() => setCor(p.cor)}
                className="w-7 h-7 rounded-full border-2 transition"
                style={{ background: p.bg, borderColor: cor === p.cor ? p.cor : 'transparent' }}>
                <span className="block w-3 h-3 rounded-full mx-auto" style={{ background: p.cor }} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIA_ICONES.map((n) => (
              <button key={n} type="button" onClick={() => setIcone(n)}
                className="w-8 h-8 rounded-lg border flex items-center justify-center transition"
                style={{ borderColor: icone === n ? cor : 'var(--color-border)', color: icone === n ? cor : 'var(--color-ink3)' }}>
                <CategoriaIconCustom name={n} size={15} />
              </button>
            ))}
          </div>
          {erro && <p className="text-red text-xs">{erro}</p>}
          <button type="button" onClick={criar} disabled={salvando}
            className="h-9 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar categoria'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/components/CategoriaPicker.tsx
git commit -m "feat: CategoriaPicker (web) — chips built-in + custom + criar inline"
```

---

### Task 5: Web — `CategoriasManagerModal` (editar / excluir)

**Files:**
- Create: `web/components/CategoriasManagerModal.tsx`

**Interfaces:**
- Consumes: `CATEGORIA_PALETA`, `CATEGORIA_ICONES`, `bgDaCor`, `type CategoriaCustom` (Task 2); `CategoriaIconCustom` (Task 3); `useScrollLock` (`@/lib/useScrollLock`).
- Produces:
  ```tsx
  CategoriasManagerModal({
    customs: CategoriaCustom[];
    contarUso: (categoriaId: string) => number;  // nº de serviços com esse categoria_id
    onClose: () => void;
    onAtualizada: (c: CategoriaCustom) => void;
    onExcluida: (id: string) => void;
  })
  ```

- [ ] **Step 1: Implement the component**

Create `web/components/CategoriasManagerModal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { X, Pencil, Trash2, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { CategoriaIconCustom } from '@/components/CategoriaIcon';
import {
  CATEGORIA_PALETA, CATEGORIA_ICONES, bgDaCor, type CategoriaCustom,
} from '@shared/categorias';

const supabase = createClient();

type Props = {
  customs: CategoriaCustom[];
  contarUso: (categoriaId: string) => number;
  onClose: () => void;
  onAtualizada: (c: CategoriaCustom) => void;
  onExcluida: (id: string) => void;
};

export function CategoriasManagerModal({ customs, contarUso, onClose, onAtualizada, onExcluida }: Props) {
  useScrollLock();
  const [editId, setEditId]   = useState<string | null>(null);
  const [nome, setNome]       = useState('');
  const [cor, setCor]         = useState('');
  const [icone, setIcone]     = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [erro, setErro]       = useState('');
  const [busy, setBusy]       = useState(false);

  function abrirEdicao(c: CategoriaCustom) {
    setEditId(c.id); setNome(c.nome); setCor(c.cor); setIcone(c.icone); setErro('');
  }

  async function salvar(id: string) {
    const limpo = nome.trim();
    if (!limpo) { setErro('Nome obrigatório.'); return; }
    setBusy(true); setErro('');
    const { data, error } = await supabase
      .from('categorias_servico')
      .update({ nome: limpo, cor, icone })
      .eq('id', id).select('*').single();
    setBusy(false);
    if (error) { setErro(error.message.includes('uniq') ? 'Já existe categoria com esse nome.' : 'Sem permissão (só gestor/dono).'); return; }
    onAtualizada(data as CategoriaCustom);
    setEditId(null);
  }

  async function excluir(id: string) {
    setBusy(true);
    const { error } = await supabase.from('categorias_servico').delete().eq('id', id).select('id');
    setBusy(false);
    if (error) { setErro('Sem permissão para excluir (só gestor/dono).'); return; }
    onExcluida(id);
    setConfirmDel(null);
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">Categorias personalizadas</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-3">
          {customs.length === 0 && (
            <p className="text-sm text-text-4 text-center py-6">
              Nenhuma categoria personalizada. Crie uma ao cadastrar um serviço.
            </p>
          )}
          {customs.map((c) => {
            const emEdicao = editId === c.id;
            const usos = contarUso(c.id);
            return (
              <div key={c.id} className="rounded-xl border border-border p-3">
                {!emEdicao ? (
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: bgDaCor(c.cor) }}>
                      <CategoriaIconCustom name={c.icone} size={15} color={c.cor} />
                    </span>
                    <span className="flex-1 text-sm font-semibold text-text">{c.nome}</span>
                    {confirmDel === c.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] text-red">{usos > 0 ? `${usos} serviço(s) usam` : 'Confirmar?'}</span>
                        <button onClick={() => excluir(c.id)} disabled={busy} className="px-2 h-7 rounded-lg bg-red text-white text-xs font-bold disabled:opacity-50">Excluir</button>
                        <button onClick={() => setConfirmDel(null)} className="px-2 h-7 rounded-lg border border-border text-xs">Cancelar</button>
                      </span>
                    ) : (
                      <>
                        <button onClick={() => abrirEdicao(c)} className="w-7 h-7 rounded-lg border border-border text-text-4 hover:text-text-2 flex items-center justify-center"><Pencil size={12} /></button>
                        <button onClick={() => { setConfirmDel(c.id); setErro(''); }} className="w-7 h-7 rounded-lg border border-border text-text-4 hover:text-red flex items-center justify-center"><Trash2 size={12} /></button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <input value={nome} onChange={(e) => setNome(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:border-accent" />
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIA_PALETA.map((p) => (
                        <button key={p.cor} type="button" onClick={() => setCor(p.cor)} className="w-7 h-7 rounded-full border-2" style={{ background: p.bg, borderColor: cor === p.cor ? p.cor : 'transparent' }}>
                          <span className="block w-3 h-3 rounded-full mx-auto" style={{ background: p.cor }} />
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIA_ICONES.map((n) => (
                        <button key={n} type="button" onClick={() => setIcone(n)} className="w-8 h-8 rounded-lg border flex items-center justify-center" style={{ borderColor: icone === n ? cor : 'var(--color-border)', color: icone === n ? cor : 'var(--color-ink3)' }}>
                          <CategoriaIconCustom name={n} size={15} />
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditId(null)} className="flex-1 h-9 rounded-lg border border-border text-sm font-semibold">Cancelar</button>
                      <button onClick={() => salvar(c.id)} disabled={busy} className="flex-1 h-9 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1"><Check size={14} /> Salvar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {erro && <p className="text-red text-sm">{erro}</p>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/components/CategoriasManagerModal.tsx
git commit -m "feat: CategoriasManagerModal (web) — editar/excluir categoria personalizada"
```

---

### Task 6: Web — integrar em `servicos/page.tsx`

**Files:**
- Modify: `web/app/(app)/servicos/page.tsx`

**Interfaces:**
- Consumes: `CategoriaPicker` (Task 4), `CategoriasManagerModal` (Task 5), `resolverCategoriaServico`, `CategoriaIconCustom`, `type CategoriaCustom` (Tasks 2/3).
- Produces: nada para outras tasks.

Mudanças (o arquivo tem tipos locais `CategoriaKey` / `CATEGORIAS` / `CAT_MAP` — **mantê-los**, só adicionar o caminho custom):

- [ ] **Step 1: State + carga das categorias personalizadas**

No componente `ServicosPage` (após `const [servicos, setServicos] = ...`):

```tsx
const [categorias, setCategorias] = useState<CategoriaCustom[]>([]);
const [gerenciarCategorias, setGerenciarCategorias] = useState(false);
```

Import no topo:

```tsx
import { CategoriaPicker } from '@/components/CategoriaPicker';
import { CategoriasManagerModal } from '@/components/CategoriasManagerModal';
import { resolverCategoriaServico, type CategoriaCustom } from '@shared/categorias';
import { CategoriaIconCustom } from '@/components/CategoriaIcon';
```

No `useEffect` de carga (onde hoje busca `servicos`), adicionar em paralelo — trocar o bloco que faz só o `.from('servicos')` por um `Promise.all`:

```tsx
const [{ data: servs }, { data: cats }] = await Promise.all([
  supabase.from('servicos').select('*').eq('empresa_id', membro.empresa_id).order('categoria').order('nome'),
  supabase.from('categorias_servico').select('*').eq('empresa_id', membro.empresa_id).order('nome'),
]);
setServicos((servs ?? []) as Servico[]);
setCategorias((cats ?? []) as CategoriaCustom[]);
```

- [ ] **Step 2: `Servico` type local ganha `categoria_id`**

Na `type Servico = { ... }` local do arquivo, adicionar:

```tsx
  categoria_id?: string | null;
```

- [ ] **Step 3: `ServicoModal` usa `CategoriaPicker`**

`ServicoModal` recebe props novas: `customs: CategoriaCustom[]` e `onCustomCriada: (c: CategoriaCustom) => void`. Dentro dele:
- estado: trocar `const [categoria, setCategoria] = useState<CategoriaKey>(catInicial)` por dois estados:
  ```tsx
  const [categoria,   setCategoria]   = useState<string | null>(editando?.categoria ?? (editando?.categoria_id ? null : (state.modo === 'criar' ? (state.categoria ?? 'outros') : 'outros')));
  const [categoriaId, setCategoriaId] = useState<string | null>(editando?.categoria_id ?? null);
  ```
- substituir o bloco de chips de categoria (o `<div className="flex flex-wrap gap-2">{CATEGORIAS.map(...)}</div>`) por:
  ```tsx
  <CategoriaPicker
    empresaId={empresaId}
    customs={customs}
    categoria={categoria}
    categoriaId={categoriaId}
    onSelect={(c, id) => { setCategoria(c); setCategoriaId(id); }}
    onCustomCriada={onCustomCriada}
  />
  ```
- no `payload` do `salvar()`: trocar `categoria,` por:
  ```tsx
  categoria:    categoriaId ? null : categoria,
  categoria_id: categoriaId,
  ```
- o preview dentro do modal (`const catAtual = CAT_MAP[categoria]` e o bloco `<catAtual.icon .../>`) passa a usar `resolverCategoriaServico`:
  ```tsx
  const catAtual = resolverCategoriaServico(categoria, categoriaId, customs);
  // ...no preview:
  <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: catAtual.bg }}>
    {catAtual.iconeCustom
      ? <CategoriaIconCustom name={catAtual.iconeCustom} size={16} color={catAtual.cor} />
      : <CategoriaIcon categoria={catAtual.iconeBuiltin ?? 'outros'} size={16} color={catAtual.cor} />}
  </span>
  ```
  (ajustar o markup do preview de sucesso da mesma forma — hoje usa `CAT_MAP[sucesso.categoria]`; trocar por `resolverCategoriaServico(sucesso.categoria, sucesso.categoria_id, customs)`.)

Onde `ServicoModal` é renderizado, passar as props:

```tsx
<ServicoModal
  empresaId={empresaId}
  state={modal}
  customs={categorias}
  onClose={() => setModal(null)}
  onSalvo={onSalvo}
  onCustomCriada={(c) => setCategorias((prev) => [...prev, c].sort((a, b) => a.nome.localeCompare(b.nome)))}
/>
```

- [ ] **Step 4: Card + agrupamento via resolver**

- `ServicoCard`: recebe prop nova `resolvida: CategoriaResolvida` (calculada pelo pai). Trocar `const cat = CAT_MAP[servico.categoria] ?? CAT_MAP.outros; const Icon = cat.icon;` e o markup do ícone/gradiente por uso de `resolvida` — ícone:
  ```tsx
  {resolvida.iconeCustom
    ? <CategoriaIconCustom name={resolvida.iconeCustom} size={15} color="#fff" />
    : <CategoriaIcon categoria={resolvida.iconeBuiltin ?? 'outros'} size={15} color="#fff" />}
  ```
  (o gradiente `hue` derivado de `cat.key` passa a derivar de `resolvida.chave` — mesma lógica de loop de char codes.)
  `import { type CategoriaResolvida } from '@shared/categorias';`

- Agrupamento (`const porCategoria = CATEGORIAS.map(...)`): substituir por lista dinâmica `[...8 built-ins, ...categorias]`:
  ```tsx
  const gruposBase = [
    ...CATEGORIAS.map((c) => ({ chave: c.key, label: c.label, cor: c.cor, bg: c.bg, iconeBuiltin: c.key as CategoriaKey, iconeCustom: undefined as string | undefined })),
    ...categorias.map((c) => ({ chave: c.id, label: c.nome, cor: c.cor, bg: bgDaCor(c.cor), iconeBuiltin: undefined as CategoriaKey | undefined, iconeCustom: c.icone })),
  ];
  const porCategoria = gruposBase
    .map((g) => ({
      grupo: g,
      items: servicos.filter((s) => resolverCategoriaServico(s.categoria, s.categoria_id, categorias).chave === g.chave),
    }))
    .filter((g) => g.items.length > 0);
  ```
  Import `bgDaCor` do shared. Ajustar o header de cada grupo (hoje usa `cat.cor` / `cat.bg` / `<Icon .../>`) para usar `g.grupo.*` e o helper de ícone. O botão "+ novo serviço em <categoria>" por grupo: para built-in passa `state.categoria = g.grupo.iconeBuiltin`; para custom, abrir modal com a custom pré-selecionada — como `ModalState` só carrega `categoria?: CategoriaKey`, estender para `{ modo: 'criar'; categoria?: string; categoriaId?: string }` e propagar aos estados iniciais do modal (Step 3).

- [ ] **Step 5: Botão do mini-gerenciador no header**

No header da página (ao lado do `<ExportButton>` / "Novo serviço"), adicionar:

```tsx
<button onClick={() => setGerenciarCategorias(true)}
  title="Gerenciar categorias"
  className="flex items-center gap-1.5 px-3 h-10 rounded-2xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
  <Tags size={15} strokeWidth={2} /> Categorias
</button>
```

`import { Tags } from 'lucide-react';`

E, no fim do JSX (junto do `{modal && ...}`):

```tsx
{gerenciarCategorias && (
  <CategoriasManagerModal
    customs={categorias}
    contarUso={(id) => servicos.filter((s) => s.categoria_id === id).length}
    onClose={() => setGerenciarCategorias(false)}
    onAtualizada={(c) => setCategorias((prev) => prev.map((x) => x.id === c.id ? c : x))}
    onExcluida={(id) => {
      setCategorias((prev) => prev.filter((x) => x.id !== id));
      setServicos((prev) => prev.map((s) => s.categoria_id === id ? { ...s, categoria_id: null } : s));
    }}
  />
)}
```

- [ ] **Step 6: tsc + smoke**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.
Run: `cd web && npx vitest run`
Expected: todos os testes passam (nenhum quebrou).

- [ ] **Step 7: Commit**

```bash
git add web/app/(app)/servicos/page.tsx
git commit -m "feat: categorias personalizadas na tela Servicos (web) — criar, agrupar, gerenciar"
```

---

### Task 7: Web — resolver categoria na Agenda

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: `resolverCategoriaServico`, `type CategoriaCustom` (Task 2).
- Produces: nada.

- [ ] **Step 1: Carregar categorias + trazer `categoria_id`**

- Nas duas queries de agendamento (linhas ~1584-1585) que fazem `servico:servicos(id,nome,duracao_minutos,categoria)` e `agendamento_servicos(...,servico:servicos(id,nome,categoria))`, acrescentar `categoria_id` na projeção de `servicos`.
- Adicionar, no `Promise.all` de carga da tela, uma query:
  ```ts
  supabase.from('categorias_servico').select('*').eq('empresa_id', empresaId).order('nome')
  ```
  e guardar em estado `const [categoriasCustom, setCategoriasCustom] = useState<CategoriaCustom[]>([]);`

- [ ] **Step 2: `categoriasDoAg` + tipos**

- Nos tipos `AgServico` / `Ag.servico`, adicionar `categoria_id?: string | null`.
- `categoriasDoAg(ag)` hoje devolve `CategoriaServico[]` a partir de `servico?.categoria`. Trocar para devolver as **chaves resolvidas** (`string[]`), mapeando cada serviço via `resolverCategoriaServico(s.categoria, s.categoria_id, categoriasCustom).chave`.
- `categoriasPresentes` (useMemo) e os chips de filtro (linhas ~1128-1161): a lista passa a ser de chaves resolvidas; para o label/cor de cada chip, resolver uma vez:
  ```ts
  const info = resolverCategoriaServicoPorChave(chave); // helper local: procura built-in em CATEGORIA_* ; senão procura em categoriasCustom por id
  ```
  Implementar helper local no arquivo:
  ```ts
  function infoDaChave(chave: string, customs: CategoriaCustom[]) {
    const c = customs.find((x) => x.id === chave);
    if (c) return { label: c.nome, cor: c.cor, bg: bgDaCor(c.cor), iconeCustom: c.icone as string | undefined, iconeBuiltin: undefined as CategoriaServico | undefined };
    return resolverCategoriaServico(chave, null, []); // built-in ou 'outros'
  }
  ```
- Onde hoje acessa `CATEGORIA_COR[c]` / `CATEGORIA_BG[c]` / `CATEGORIA_LABEL[c]` diretamente para uma categoria de agendamento (ex. linha ~1298 `const cats = categoriasDoAg(ag)`), trocar por `infoDaChave(chave, categoriasCustom)`.

- [ ] **Step 3: tsc**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/app/(app)/agenda/page.tsx
git commit -m "feat: agenda (web) resolve categoria personalizada nos chips e cores"
```

---

### Task 8: Web — resolver categoria em Comissões

**Files:**
- Modify: `web/app/(app)/comissoes/ComissoesGestorView.tsx`

**Interfaces:**
- Consumes: `resolverCategoriaServico`, `type CategoriaCustom`, `CategoriaIconCustom`.
- Produces: nada.

- [ ] **Step 1: Trazer `categoria_id` + carregar customs**

- Na query (linha ~186) `agendamento:agendamentos(data_hora_inicio, servico:servicos(nome, categoria))`, acrescentar `categoria_id`.
- Adicionar carga de `categorias_servico` da empresa (no `Promise.all` existente) → estado `categoriasCustom: CategoriaCustom[]`.
- No tipo local do row, `servico: { nome: string; categoria: string | null; categoria_id?: string | null } | null`.

- [ ] **Step 2: Resolver na agregação por categoria (linha ~523)**

Trocar:
```ts
const cat = (c.agendamento?.servico?.categoria ?? 'outros') as CategoriaServico;
const cor = CATEGORIA_COR[cat] ?? '#6B7280';
const bg  = CATEGORIA_BG[cat]  ?? '#F3F4F6';
```
por:
```ts
const r = resolverCategoriaServico(c.agendamento?.servico?.categoria, c.agendamento?.servico?.categoria_id, categoriasCustom);
const cor = r.cor, bg = r.bg;
```
E o `<CategoriaIcon categoria={cat} .../>` vira:
```tsx
{r.iconeCustom
  ? <CategoriaIconCustom name={r.iconeCustom} size={15} color={cor} />
  : <CategoriaIcon categoria={r.iconeBuiltin ?? 'outros'} size={15} color={cor} />}
```
Se houver agrupamento por `cat` como chave, usar `r.chave`; o label exibido usa `r.label`.

- [ ] **Step 3: tsc**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/app/(app)/comissoes/ComissoesGestorView.tsx
git commit -m "feat: comissoes (web) resolve categoria personalizada no ranking"
```

---

### Task 9: Mobile — `CategoriaIconCustom` + `CategoriaPicker` + `CategoriasManagerModal`

**Files:**
- Modify: `mobile/components/CategoriaIcon.tsx` (append)
- Create: `mobile/components/CategoriaPicker.tsx`
- Create: `mobile/components/CategoriasManagerModal.tsx`

**Interfaces:**
- Consumes: `CATEGORIA_PALETA`, `CATEGORIA_ICONES`, `bgDaCor`, `resolverCategoriaServico`, `type CategoriaCustom` (Task 2); `ALL_CATEGORIAS`, `CATEGORIA_LABEL`, `CATEGORIA_COR`, `CATEGORIA_BG` (shared); `CategoriaIcon` (existente).
- Produces:
  - `CategoriaIconCustom({ name: string; size?: number; color?: string; strokeWidth?: number })`
  - `CategoriaPicker({ empresaId, customs, categoria, categoriaId, onSelect, onCustomCriada })` — mesma assinatura da versão web (Task 4).
  - `CategoriasManagerModal({ customs, contarUso, onClose, onAtualizada, onExcluida })` — mesma assinatura da web (Task 5).

- [ ] **Step 1: `CategoriaIconCustom` em `mobile/components/CategoriaIcon.tsx`**

Append:

```tsx
import * as LucideRN from 'lucide-react-native';

type CustomProps = { name: string; size?: number; color?: string; strokeWidth?: number };

/** Ícone de categoria personalizada por nome lucide (ver CATEGORIA_ICONES no shared). */
export function CategoriaIconCustom({ name, size = 20, color = '#6B7280', strokeWidth = 1.8 }: CustomProps) {
  const Cmp = (LucideRN as unknown as Record<string, React.ComponentType<any>>)[name] ?? LucideRN.Tag;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} />;
}
```

- [ ] **Step 2: `mobile/components/CategoriaPicker.tsx`**

Componente RN espelhando a lógica da Task 4 (chips horizontais roláveis + bloco "Nova categoria" com `TextInput`, grade de cores e grade de ícones). Usar `supabase` de `@/lib/supabase`, `Alert` para erro de permissão, e a paleta `C` local (copiar o objeto `C` de `mobile/app/(empresa)/novo-servico.tsx`). Assinatura de props idêntica à web. Chamada de insert:

```tsx
const { data, error } = await supabase
  .from('categorias_servico')
  .insert({ empresa_id: empresaId, nome: nome.trim(), cor, icone })
  .select('*').single();
if (error) { Alert.alert('Não deu', error.message.includes('uniq') ? 'Já existe categoria com esse nome.' : 'Só gestor/dono pode criar categoria.'); return; }
onCustomCriada(data as CategoriaCustom);
onSelect(null, (data as CategoriaCustom).id);
```

- [ ] **Step 3: `mobile/components/CategoriasManagerModal.tsx`**

`Modal` RN (`import { Modal } from 'react-native'`) com lista das `customs`: cada item com nome + amostra (`CategoriaIconCustom`), botão editar (abre TextInput + grades) e excluir (confirm inline mostrando `contarUso(id)` serviços). `update` / `delete` como na Task 5, com `Alert` no erro. Chama `onAtualizada` / `onExcluida`.

- [ ] **Step 4: tsc**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `10` (baseline; nenhum erro novo nos 3 arquivos).

- [ ] **Step 5: Commit**

```bash
git add mobile/components/CategoriaIcon.tsx mobile/components/CategoriaPicker.tsx mobile/components/CategoriasManagerModal.tsx
git commit -m "feat: componentes de categoria personalizada (mobile)"
```

---

### Task 10: Mobile — `novo-servico` + `editar-servico`

**Files:**
- Modify: `mobile/app/(empresa)/novo-servico.tsx`
- Modify: `mobile/app/(empresa)/editar-servico/[id].tsx`

**Interfaces:**
- Consumes: `CategoriaPicker` (Task 9), `type CategoriaCustom`, `resolverCategoriaServico`.
- Produces: nada.

- [ ] **Step 1: `novo-servico.tsx`**

- Carregar categorias personalizadas: adicionar um `useQuery` (ou fetch no `useEffect`) para `categorias_servico` da empresa → `customs`.
- Trocar `const [categoria, setCategoria] = useState<CategoriaServico>('outros')` por:
  ```tsx
  const [categoria,   setCategoria]   = useState<string | null>('outros');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  ```
- Substituir o bloco de chips (`{CATEGORIAS.map(...)}`, linhas ~201-217) pelo `<CategoriaPicker empresaId={empresaId} customs={customs} categoria={categoria} categoriaId={categoriaId} onSelect={(c,id)=>{setCategoria(c);setCategoriaId(id);}} onCustomCriada={(c)=>setCustoms(prev=>[...prev,c])} />`.
- No `insert` de `servicos`: `categoria: categoriaId ? null : categoria, categoria_id: categoriaId`.
- O preview (linha ~289, `CategoriaIcon categoria={categoria}`) usa `resolverCategoriaServico(categoria, categoriaId, customs)` → `iconeCustom ? <CategoriaIconCustom .../> : <CategoriaIcon categoria={r.iconeBuiltin ?? 'outros'} .../>`.

- [ ] **Step 2: `editar-servico/[id].tsx`**

Mesmas trocas. Estados iniciais a partir do serviço carregado:
```tsx
const [categoria,   setCategoria]   = useState<string | null>(servico?.categoria ?? (servico?.categoria_id ? null : 'outros'));
const [categoriaId, setCategoriaId] = useState<string | null>(servico?.categoria_id ?? null);
```
No `update`: `categoria: categoriaId ? null : categoria, categoria_id: categoriaId`.

- [ ] **Step 3: tsc**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `10`.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(empresa)/novo-servico.tsx" "mobile/app/(empresa)/editar-servico/[id].tsx"
git commit -m "feat: criar/selecionar categoria personalizada no form de servico (mobile)"
```

---

### Task 11: Mobile — tela `servicos.tsx`

**Files:**
- Modify: `mobile/app/(empresa)/servicos.tsx`

**Interfaces:**
- Consumes: `CategoriasManagerModal` (Task 9), `resolverCategoriaServico`, `CategoriaIconCustom`, `type CategoriaCustom`, `bgDaCor`.
- Produces: nada.

- [ ] **Step 1: Carregar customs**

Em `useServicos`, trocar o `queryFn` para buscar `servicos` e `categorias_servico` em paralelo e retornar `{ servicos, categorias }`. Ajustar o consumo no componente (`const { data } = useServicos(); const servicos = data?.servicos ?? []; const categorias = data?.categorias ?? [];`).

- [ ] **Step 2: Agrupar via resolver**

Trocar o `reduce` de `porCategoria` (linhas ~159-164) por agrupamento pela **chave resolvida**:
```tsx
const porChave = servicos.reduce<Record<string, Servico[]>>((acc, s) => {
  const chave = resolverCategoriaServico(s.categoria, s.categoria_id, categorias).chave;
  (acc[chave] ??= []).push(s);
  return acc;
}, {});
```
Ao renderizar cada seção (linhas ~245-274), resolver a info do header a partir da primeira ocorrência ou de um helper `infoDaChave(chave, categorias)` (mesmo helper da Task 7, versão mobile): usar `label`, `cor`, `bg`, e ícone via `iconeCustom ? <CategoriaIconCustom/> : <CategoriaIcon categoria={iconeBuiltin ?? 'outros'}/>`. Remove a dependência de `CATEGORIA_CONFIG` para o label (mantém para os built-ins via resolver).

- [ ] **Step 3: Botão + modal do mini-gerenciador**

No header (ao lado do `+`), um `TouchableOpacity` com ícone `Tags` (de `lucide-react-native`) que abre `<CategoriasManagerModal customs={categorias} contarUso={(id)=>servicos.filter(s=>s.categoria_id===id).length} onClose={...} onAtualizada={...} onExcluida={...} />`. Nos handlers, invalidar `['servicos-gestao']` / `['servicos-empresa']` no `queryClient`.

- [ ] **Step 4: tsc**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `10`.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(empresa)/servicos.tsx"
git commit -m "feat: categorias personalizadas na tela Servicos (mobile)"
```

---

### Task 12: Mobile — `useAgenda` + `agenda.tsx`

**Files:**
- Modify: `mobile/hooks/useAgenda.ts`
- Modify: `mobile/app/(empresa)/agenda.tsx`

**Interfaces:**
- Consumes: `resolverCategoriaServico`, `type CategoriaCustom`, `bgDaCor` (shared); `CategoriaIconCustom` (Task 9).
- Produces: `AgendamentoCompleto` ganha `categoriaResolvida?: { label: string; cor: string; bg: string; iconeCustom?: string; iconeBuiltin?: CategoriaServico }`.

- [ ] **Step 1: `useAgenda.ts`**

- A query de agendamentos passa a trazer `categoria_id` no join de `servico`.
- Buscar `categorias_servico` da empresa junto (ou em `useQuery` separado dentro do hook) → `customs`.
- No mapeamento de cada agendamento, além do `categoria: resolverCategoria(ag.servico?.categoria)` já existente (mantido para não quebrar consumidores atuais), preencher:
  ```ts
  categoriaResolvida: (() => {
    const r = resolverCategoriaServico(ag.servico?.categoria, ag.servico?.categoria_id, customs);
    return { label: r.label, cor: r.cor, bg: r.bg, iconeCustom: r.iconeCustom, iconeBuiltin: r.iconeBuiltin };
  })(),
  ```
- `CATEGORIA_CONFIG` e `resolverCategoria(texto)` **continuam existindo** (não remover).

- [ ] **Step 2: `agenda.tsx`**

- Linha ~84 `const cfg = CATEGORIA_CONFIG[ag.categoria]`: passar a usar `ag.categoriaResolvida` para cor/label/ícone do card do dia (com `CATEGORIA_CONFIG[ag.categoria]` como fallback se `categoriaResolvida` estiver ausente).
- Legenda de categorias (linhas ~377-383): além dos 8 fixos de `CATEGORIA_CONFIG`, listar as `customs` presentes no dia (derivar da lista de agendamentos → `categoriaResolvida` com `tipo custom`/id distinto). Renderizar ícone custom via `CategoriaIconCustom`.

- [ ] **Step 3: tsc**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `10`.

- [ ] **Step 4: Commit**

```bash
git add "mobile/hooks/useAgenda.ts" "mobile/app/(empresa)/agenda.tsx"
git commit -m "feat: agenda (mobile) resolve categoria personalizada no card e legenda"
```

---

## Verificação final (após todas as tasks)

- [ ] `cd web && npx tsc --noEmit` → exit 0.
- [ ] `cd web && npx vitest run` → tudo verde (incl. `categorias.test.ts`, `categorias-servico-migration.test.ts`).
- [ ] `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"` → `10` (baseline, nenhum novo).
- [ ] Revisão de branch (opus) via `superpowers:requesting-code-review` antes de abrir/atualizar o PR: foco na costura entre as 12 tasks — seleção `categoria` vs `categoria_id` consistente nos 4 pontos de form (web novo/editar dentro de `ServicoModal`, mobile novo/editar), agrupamento não perdendo serviço, `on delete set null` refletido no estado local, RLS (erro de papel `profissional` tratado sem quebrar fluxo).
- [ ] Verificação visual no navegador local: não executável nesta sessão (sem conta de teste) — registrar no PR, como nas sessões anteriores.

## Self-review (feito pelo autor do plano)

**Cobertura da spec:**
- §1 Banco → Task 1. ✅ (check XOR incluído)
- §2 Shared helpers → Task 2. ✅
- §3 Carregamento das customs → Tasks 6, 7, 8, 10, 11, 12. ✅
- §4 Criar inline → Task 4 (web), Task 9+10 (mobile). ✅
- §5 Mini-gerenciador → Task 5+6 (web), Task 9+11 (mobile). ✅
- §6 Consumo/render (servicos, agenda, comissões) → Tasks 6/7/8 (web), 11/12 (mobile). ✅
- §7 Tipos → Task 2. ✅
- Bug do agrupamento que some serviço → Task 6 Step 4 e Task 11 Step 2 (`.filter(items.length > 0)` mantido, mas agora todo serviço resolve para uma `chave` que existe em `gruposBase`, e serviço sem match cai em `outros`). ✅

**Placeholder scan:** Tasks 9, 11, 12 descrevem componentes RN "espelhando a Task X" em vez de reproduzir todo o JSX de estilo React Native. É deliberado: a lógica/assinatura está 100% especificada (props idênticas às versões web já escritas por extenso nas Tasks 4/5), e o markup RN é mecânico. O implementador tem a versão web como referência exata. Não há `TODO`/`TBD` de lógica.

**Consistência de tipos:** `resolverCategoriaServico(categoria, categoriaId, customs)` — mesma assinatura em todas as tasks. `CategoriaResolvida.chave` usada como identidade de grupo em Tasks 6/11. `CategoriaPicker` / `CategoriasManagerModal` — mesma assinatura de props web (Tasks 4/5) e mobile (Task 9). `categoria: categoriaId ? null : categoria, categoria_id: categoriaId` — mesmo par em Tasks 6/10 (4 pontos de form).
