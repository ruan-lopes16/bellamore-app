# Paridade Equipe + revisão das permissões — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a tela Equipe fica igual no web e no app. A API de profissionais passa a funcionar para as duas plataformas, sem zerar comissão, e troca o login quando o e-mail muda. Toda permissão passa a ter tela e banco de acordo.

**Architecture:**
- As regras puras ficam em `shared/equipe.ts` e o acesso ao banco em `shared/equipe-consultas.ts`.
- A API (`web/app/api/profissionais`, `web/app/api/convites`) usa as regras puras e aceita cookie (web) ou Bearer (app).
- A revisão de permissões gera uma matriz em `docs/superpowers/notes/` e corrige as divergências. Se precisar de mudança no banco, vira a migration 089.

**Tech Stack:** Next.js (web + rotas de API), Expo/React Native + TanStack Query (app), TypeScript em `shared/`, Supabase/Postgres (RLS, `tem_permissao`), Vitest em `web/tests/unit`.

**Spec:** `docs/superpowers/specs/2026-10-14-paridade-equipe-design.md`

## Global Constraints

- **Idioma:** comunicação, comentários, mensagens de tela e commits em português.
- **Código comum:** o web NUNCA importa nada de `mobile/`. O código comum fica em `shared/` (`@shared/...`).
- **Testes e tsc:**
  - testes: `cd web && npx vitest run <arquivo>`;
  - tsc do web: `cd web && npx tsc --noEmit` deve dar 0 erros;
  - tsc do app: `cd mobile && npx tsc --noEmit` deve dar exatamente 8 erros pré-existentes neste worktree, nenhum novo.
- **Migrations:**
  - não são aplicadas por CI e NUNCA com `supabase db push`;
  - devem ser idempotentes e terminar em `notify pgrst, 'reload schema';`;
  - nunca executar nada contra o banco.
- **Consultas e gravações:**
  - toda consulta confere o erro;
  - paginação com `.order('id')`;
  - mês em Brasília (`shared/periodos.ts`);
  - `update`/`delete` com `.select('id')` e 0 linhas = sem permissão (`mensagemErroBanco(… { code: '42501' } …)`);
  - insert sem RETURNING em tabela cuja leitura é mais restrita que a escrita.
- **Arquivos:** usam CRLF no checkout; preservar o fim de linha.
- **Commits:** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca commitar `.superpowers/`.
- **Decisões do dono:**
  1. Faturado do mês = atendimentos concluídos sem pacote (`pacote_cliente_id is null`) + serviços extras. Atendimentos do mês continua contando todos os concluídos.
  2. Trocar o e-mail troca também o login. E-mail já usado dá "Este e-mail já é usado por outra conta." e nada é salvo.
  3. Nenhuma permissão pode ter tela e banco em desacordo.

---

### Task 1: Regras e consultas da Equipe em `shared/`

**Files:**
- Create: `shared/equipe.ts`, `shared/equipe-consultas.ts`
- Test: `web/tests/unit/equipe-regras.test.ts`, `web/tests/unit/equipe-consultas.test.ts`

**Interfaces (produz):**
- `shared/equipe.ts`:
  - `type TipoContrato = 'pj' | 'clt'`
  - `rotuloContrato(t: TipoContrato | null): string`, que devolve `'PJ / Comissionada'`, `'CLT'` ou `''`
  - `normalizarComissao(v: unknown): number | null | undefined`: `undefined` = não veio; `null` = inválida
  - `normalizarTipoContrato(v: unknown): TipoContrato | null | undefined | 'invalido'`
  - `emailValido(e: string): boolean`
  - `montarPatchVinculo(corpo: { percentual_comissao?: unknown; tipo_contrato?: unknown }): { patch: { percentual_comissao?: number; tipo_contrato?: TipoContrato | null } } | { erro: string }`
  - `vinculoParaGravar(existente: { percentual_comissao: number; tipo_contrato: TipoContrato | null } | null, corpo: { percentual_comissao?: unknown; tipo_contrato?: unknown }): { valores: { percentual_comissao: number; tipo_contrato: TipoContrato | null } } | { erro: string }`
  - `estatisticasDoMes(ags: { profissional_id: string | null; valor: number | string | null; pacote_cliente_id: string | null }[], extrasPorProf: Record<string, number>): Record<string, { total: number; atendimentos: number }>`
- `shared/equipe-consultas.ts`:
  - `type MembroEquipe = { id: string; user_id: string; role: 'owner' | 'gestor' | 'profissional'; percentual_comissao: number; tipo_contrato: TipoContrato | null; ativo: boolean; created_at: string; user: { id: string; nome: string; telefone: string | null; email: string | null; foto_url: string | null }; total_mes: number; atendimentos_mes: number; comissao_pendente: number; comissao_pendente_anterior: number; ids_pendentes_mes: string[] }`
  - `carregarEquipe(db: ClienteDb, empresaId: string, mesChave: string): Promise<MembroEquipe[]>`
  - `alterarAtivo(db: ClienteDb, empresaId: string, membroId: string, ativo: boolean): Promise<void>`: lança `Error` em português
  - `alterarPapel(db: ClienteDb, empresaId: string, membroId: string, papel: 'gestor' | 'profissional'): Promise<void>`: lança `Error` em português
- **Consome:** `buscarTodasOuLancar`, `ClienteDb`, `carregarComissoesPendentes` e `carregarServicosExtras` de `./kpis-financeiros-consultas`; `receitaExtrasPorProfissional` de `./kpis-financeiros`; `pendentesPorProfissional` de `./comissoes`; `limitesMes` de `./periodos`; `mensagemErroBanco` de `./erros`. O `fakeDb` de `web/tests/unit/fixtures/fake-db.ts` aceita `linhas`, `erroTabelas`, `awaitavel`, `respostaUpdate` e `rpc`.

- [ ] **Step 1: Testes que falham**

Crie `web/tests/unit/equipe-regras.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  rotuloContrato, normalizarComissao, normalizarTipoContrato, emailValido, montarPatchVinculo,
  vinculoParaGravar, estatisticasDoMes,
} from '@shared/equipe';

describe('normalizações', () => {
  it('comissão: undefined não veio; número/texto 0–100; fora disso inválida', () => {
    expect(normalizarComissao(undefined)).toBeUndefined();
    expect(normalizarComissao(45)).toBe(45);
    expect(normalizarComissao('45,5')).toBe(45.5);
    expect(normalizarComissao('')).toBe(0);
    expect(normalizarComissao(101)).toBeNull();
    expect(normalizarComissao(-1)).toBeNull();
    expect(normalizarComissao('abc')).toBeNull();
  });
  it('tipo de contrato: pj/clt; null ou vazio = sem contrato; outro = inválido', () => {
    expect(normalizarTipoContrato(undefined)).toBeUndefined();
    expect(normalizarTipoContrato('pj')).toBe('pj');
    expect(normalizarTipoContrato('clt')).toBe('clt');
    expect(normalizarTipoContrato(null)).toBeNull();
    expect(normalizarTipoContrato('')).toBeNull();
    expect(normalizarTipoContrato('mei')).toBe('invalido');
  });
  it('rótulo e e-mail', () => {
    expect(rotuloContrato('pj')).toBe('PJ / Comissionada');
    expect(rotuloContrato('clt')).toBe('CLT');
    expect(rotuloContrato(null)).toBe('');
    expect(emailValido(' ana@x.com ')).toBe(true);
    expect(emailValido('ana@x')).toBe(false);
  });
});

describe('montarPatchVinculo', () => {
  it('só o que veio', () => {
    expect(montarPatchVinculo({})).toEqual({ patch: {} });
    expect(montarPatchVinculo({ percentual_comissao: 50 })).toEqual({ patch: { percentual_comissao: 50 } });
    expect(montarPatchVinculo({ tipo_contrato: null })).toEqual({ patch: { tipo_contrato: null } });
  });
  it('erros', () => {
    expect(montarPatchVinculo({ percentual_comissao: 150 })).toEqual({ erro: 'A comissão deve ficar entre 0 e 100%.' });
    expect(montarPatchVinculo({ tipo_contrato: 'x' })).toEqual({ erro: 'Tipo de contrato inválido.' });
  });
});

describe('vinculoParaGravar', () => {
  it('vínculo novo: comissão e contrato que vieram, senão 0 e sem contrato', () => {
    expect(vinculoParaGravar(null, { percentual_comissao: 40, tipo_contrato: 'clt' }))
      .toEqual({ valores: { percentual_comissao: 40, tipo_contrato: 'clt' } });
    expect(vinculoParaGravar(null, {})).toEqual({ valores: { percentual_comissao: 0, tipo_contrato: null } });
  });
  it('vínculo existente: nunca zera o que não veio (bug do convite)', () => {
    const existente = { percentual_comissao: 70, tipo_contrato: 'pj' as const };
    expect(vinculoParaGravar(existente, {})).toEqual({ valores: { percentual_comissao: 70, tipo_contrato: 'pj' } });
    expect(vinculoParaGravar(existente, { percentual_comissao: 55 })).toEqual({ valores: { percentual_comissao: 55, tipo_contrato: 'pj' } });
    expect(vinculoParaGravar(existente, { tipo_contrato: null })).toEqual({ valores: { percentual_comissao: 70, tipo_contrato: null } });
  });
  it('erro de validação', () => {
    expect(vinculoParaGravar(null, { percentual_comissao: 'x' })).toEqual({ erro: 'A comissão deve ficar entre 0 e 100%.' });
  });
});

describe('estatisticasDoMes (decisão 1)', () => {
  it('faturado sem sessões de pacote + extras; atendimentos contam todos', () => {
    const r = estatisticasDoMes([
      { profissional_id: 'a', valor: 100, pacote_cliente_id: null },
      { profissional_id: 'a', valor: '50.5', pacote_cliente_id: null },
      { profissional_id: 'a', valor: 0, pacote_cliente_id: 'pc1' },
      { profissional_id: 'b', valor: 80, pacote_cliente_id: 'pc2' },
      { profissional_id: null, valor: 10, pacote_cliente_id: null },
    ], { a: 20, c: 30 });
    expect(r).toEqual({
      a: { total: 170.5, atendimentos: 3 },
      b: { total: 0, atendimentos: 1 },
      c: { total: 30, atendimentos: 0 },
    });
  });
});
```

Crie `web/tests/unit/equipe-consultas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { carregarEquipe, alterarAtivo, alterarPapel } from '@shared/equipe-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const membros = [
  { id: 'm1', user_id: 'u1', role: 'owner', percentual_comissao: '45', tipo_contrato: null, ativo: true, created_at: '2026-01-01', user: { id: 'u1', nome: 'Ana', telefone: null, email: 'a@x.com', foto_url: null } },
  { id: 'm2', user_id: 'u2', role: 'profissional', percentual_comissao: 70, tipo_contrato: 'pj', ativo: true, created_at: '2026-02-01', user: { id: 'u2', nome: 'Thalia', telefone: null, email: 't@x.com', foto_url: null } },
];

describe('carregarEquipe', () => {
  it('inclui a dona, mês em Brasília, faturado sem pacote e pendentes do mês', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas: {
      empresa_membros: membros,
      agendamentos: [
        { id: 'a1', profissional_id: 'u2', valor: 100, pacote_cliente_id: null },
        { id: 'a2', profissional_id: 'u2', valor: 0, pacote_cliente_id: 'p1' },
      ],
      comanda_itens: [],
      comissoes: [
        { id: 'c1', profissional_id: 'u2', valor_comissao: 70, created_at: '2026-10-05T12:00:00Z' },
        { id: 'c2', profissional_id: 'u2', valor_comissao: 30, created_at: '2026-09-20T12:00:00Z' },
      ],
    } });
    const r = await carregarEquipe(db, 'e1', '2026-10');
    expect(r.map(m => m.role)).toEqual(['owner', 'profissional']);
    const t = r.find(m => m.user_id === 'u2')!;
    expect(t).toMatchObject({ total_mes: 100, atendimentos_mes: 2, comissao_pendente: 70, comissao_pendente_anterior: 30, ids_pendentes_mes: ['c1'] });
    expect(r[0].percentual_comissao).toBe(45);
    const opsMem = opsDe(chamadas, 'empresa_membros')[0];
    expect(opsMem).toContainEqual(['in', ['role', ['owner', 'gestor', 'profissional']]]);
    const opsAg = opsDe(chamadas, 'agendamentos')[0];
    expect(opsAg).toContainEqual(['gte', ['data_hora_inicio', '2026-10-01T03:00:00.000Z']]);
    expect(opsAg).toContainEqual(['eq', ['status', 'concluido']]);
    expect(opsAg).toContainEqual(['order', ['id']]);
  });
  it('erro em qualquer consulta lança (nunca lista vazia)', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { empresa_membros: membros }, erroTabelas: { agendamentos: 'boom' } });
    await expect(carregarEquipe(db, 'e1', '2026-10')).rejects.toThrow('boom');
  });
});

describe('alterarAtivo / alterarPapel', () => {
  it('grava com empresa e confere linhas', async () => {
    const { db, chamadas } = fakeDb({});
    await alterarAtivo(db, 'e1', 'm2', false);
    const ops = opsDe(chamadas, 'empresa_membros')[0];
    expect(ops[0]).toEqual(['update', [{ ativo: false }]]);
    expect(ops).toContainEqual(['eq', ['id', 'm2']]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
  });
  it('0 linhas = sem permissão, em português', async () => {
    const { db } = fakeDb({ respostaUpdate: () => ({ data: [], error: null }) });
    await expect(alterarAtivo(db, 'e1', 'm2', true)).rejects.toThrow('Você não tem permissão para reativar esta pessoa. Fale com a dona ou a gestora.');
    await expect(alterarPapel(db, 'e1', 'm2', 'gestor')).rejects.toThrow('Você não tem permissão para trocar o papel desta pessoa. Fale com a dona ou a gestora.');
  });
});
```

Observação sobre o `fakeDb`: `update(...).eq('id', x).eq('empresa_id', y).select('id')` devolve `{ data: [{ id: x }] }` por padrão. Ele procura `eq('id', …)` para montar a resposta.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd web && npx vitest run tests/unit/equipe-regras.test.ts tests/unit/equipe-consultas.test.ts
```

Esperado: FAIL, porque os módulos ainda não existem.

- [ ] **Step 3: Implementar `shared/equipe.ts`**

```ts
/** Regras puras da Equipe (web, app e rotas de API). */

export type TipoContrato = 'pj' | 'clt';

/** Rótulo do tipo de contrato (vazio = sem contrato informado). */
export function rotuloContrato(t: TipoContrato | null): string {
  return t === 'pj' ? 'PJ / Comissionada' : t === 'clt' ? 'CLT' : '';
}

/** Comissão do corpo: `undefined` = não veio; número 0–100 (aceita "45,5"); fora disso `null` (inválida). */
export function normalizarComissao(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/** Tipo de contrato do corpo: `undefined` = não veio; `null` = sem contrato; `'invalido'` = valor desconhecido. */
export function normalizarTipoContrato(v: unknown): TipoContrato | null | undefined | 'invalido' {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return v === 'pj' || v === 'clt' ? v : 'invalido';
}

/** E-mail com formato mínimo (algo@algo.algo). */
export function emailValido(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

const ERRO_COMISSAO = 'A comissão deve ficar entre 0 e 100%.';
const ERRO_CONTRATO = 'Tipo de contrato inválido.';

/** PATCH do vínculo: só os campos que vieram no corpo. */
export function montarPatchVinculo(corpo: { percentual_comissao?: unknown; tipo_contrato?: unknown }):
  { patch: { percentual_comissao?: number; tipo_contrato?: TipoContrato | null } } | { erro: string } {
  const patch: { percentual_comissao?: number; tipo_contrato?: TipoContrato | null } = {};
  const c = normalizarComissao(corpo.percentual_comissao);
  if (c === null) return { erro: ERRO_COMISSAO };
  if (c !== undefined) patch.percentual_comissao = c;
  const t = normalizarTipoContrato(corpo.tipo_contrato);
  if (t === 'invalido') return { erro: ERRO_CONTRATO };
  if (t !== undefined) patch.tipo_contrato = t;
  return { patch };
}

/**
 * Comissão e contrato a gravar ao adicionar/convidar. Vínculo novo: o que veio (senão 0 e sem contrato).
 * Vínculo existente: só troca o que veio — reenviar convite nunca zera a comissão.
 */
export function vinculoParaGravar(
  existente: { percentual_comissao: number; tipo_contrato: TipoContrato | null } | null,
  corpo: { percentual_comissao?: unknown; tipo_contrato?: unknown },
): { valores: { percentual_comissao: number; tipo_contrato: TipoContrato | null } } | { erro: string } {
  const r = montarPatchVinculo(corpo);
  if ('erro' in r) return r;
  return { valores: {
    percentual_comissao: r.patch.percentual_comissao ?? Number(existente?.percentual_comissao ?? 0),
    tipo_contrato: r.patch.tipo_contrato !== undefined ? r.patch.tipo_contrato : (existente?.tipo_contrato ?? null),
  } };
}

/**
 * Faturado e atendimentos do mês por profissional (decisão do dono 2026-10-14): faturado = atendimentos
 * concluídos SEM pacote + serviços extras (`extrasPorProf`); atendimentos = todos os concluídos.
 */
export function estatisticasDoMes(
  ags: { profissional_id: string | null; valor: number | string | null; pacote_cliente_id: string | null }[],
  extrasPorProf: Record<string, number>,
): Record<string, { total: number; atendimentos: number }> {
  const centavos: Record<string, number> = {};
  const atend: Record<string, number> = {};
  for (const a of ags) {
    if (!a.profissional_id) continue;
    atend[a.profissional_id] = (atend[a.profissional_id] ?? 0) + 1;
    centavos[a.profissional_id] ??= 0;
    if (!a.pacote_cliente_id) centavos[a.profissional_id] += Math.round(Number(a.valor ?? 0) * 100);
  }
  for (const [id, v] of Object.entries(extrasPorProf)) {
    centavos[id] = (centavos[id] ?? 0) + Math.round(v * 100);
  }
  const out: Record<string, { total: number; atendimentos: number }> = {};
  for (const id of new Set([...Object.keys(centavos), ...Object.keys(atend)])) {
    out[id] = { total: (centavos[id] ?? 0) / 100, atendimentos: atend[id] ?? 0 };
  }
  return out;
}
```

- [ ] **Step 4: Implementar `shared/equipe-consultas.ts`**

```ts
/** Acesso ao banco da Equipe (web e app). Toda consulta lança erro em vez de devolver lista vazia. */
import { buscarTodasOuLancar, carregarComissoesPendentes, carregarServicosExtras, type ClienteDb } from './kpis-financeiros-consultas';
import { receitaExtrasPorProfissional } from './kpis-financeiros';
import { pendentesPorProfissional } from './comissoes';
import { limitesMes } from './periodos';
import { mensagemErroBanco } from './erros';
import { estatisticasDoMes, type TipoContrato } from './equipe';

export type MembroEquipe = {
  id: string; user_id: string; role: 'owner' | 'gestor' | 'profissional'; percentual_comissao: number;
  tipo_contrato: TipoContrato | null; ativo: boolean; created_at: string;
  user: { id: string; nome: string; telefone: string | null; email: string | null; foto_url: string | null };
  total_mes: number; atendimentos_mes: number;
  comissao_pendente: number; comissao_pendente_anterior: number; ids_pendentes_mes: string[];
};

const COLUNAS_MEMBRO = 'id, user_id, role, percentual_comissao, tipo_contrato, ativo, created_at, user:users(id, nome, telefone, email, foto_url)';

/**
 * Equipe da empresa (dona, gestoras e profissionais; ativas primeiro) com o mês 'yyyy-MM' em Brasília:
 * faturado (sem pacote + extras), atendimentos (todos os concluídos) e comissões pendentes do mês/anteriores.
 */
export async function carregarEquipe(db: ClienteDb, empresaId: string, mesChave: string): Promise<MembroEquipe[]> {
  const mes = limitesMes(mesChave);
  const [rMembros, ags, extras, pendentes] = await Promise.all([
    db.from('empresa_membros').select(COLUNAS_MEMBRO)
      .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional'])
      .order('ativo', { ascending: false }).order('created_at').order('id'),
    buscarTodasOuLancar<{ profissional_id: string | null; valor: number | string | null; pacote_cliente_id: string | null }>((de, ate) =>
      db.from('agendamentos').select('id, profissional_id, valor, pacote_cliente_id')
        .eq('empresa_id', empresaId).eq('status', 'concluido')
        .gte('data_hora_inicio', mes.startIso).lte('data_hora_inicio', mes.endIso)
        .order('id').range(de, ate)),
    carregarServicosExtras(db, empresaId, mes),
    carregarComissoesPendentes(db, empresaId),
  ]);
  if (rMembros.error) throw new Error(mensagemErroBanco(rMembros.error, 'carregar a equipe'));
  const stats = estatisticasDoMes(ags, receitaExtrasPorProfissional(extras));
  const pend = pendentesPorProfissional(pendentes, mes);
  return ((rMembros.data ?? []) as Record<string, unknown>[]).map(m => {
    const uid = m.user_id as string;
    return {
      ...(m as unknown as MembroEquipe),
      percentual_comissao: Number(m.percentual_comissao ?? 0),
      tipo_contrato: (m.tipo_contrato === 'pj' || m.tipo_contrato === 'clt') ? m.tipo_contrato : null,
      total_mes: stats[uid]?.total ?? 0,
      atendimentos_mes: stats[uid]?.atendimentos ?? 0,
      comissao_pendente: pend[uid]?.valorDoPeriodo ?? 0,
      comissao_pendente_anterior: pend[uid]?.valorAnterior ?? 0,
      ids_pendentes_mes: pend[uid]?.idsDoPeriodo ?? [],
    };
  });
}

async function atualizarMembro(db: ClienteDb, empresaId: string, membroId: string, valores: Record<string, unknown>, acao: string) {
  const { data, error } = await db.from('empresa_membros').update(valores)
    .eq('id', membroId).eq('empresa_id', empresaId).select('id');
  if (error || !data || data.length === 0) throw new Error(mensagemErroBanco(error ?? { code: '42501' }, acao));
}

/** Desativa/reativa a pessoa (0 linhas = sem permissão). */
export function alterarAtivo(db: ClienteDb, empresaId: string, membroId: string, ativo: boolean): Promise<void> {
  return atualizarMembro(db, empresaId, membroId, { ativo }, ativo ? 'reativar esta pessoa' : 'desativar esta pessoa');
}

/** Troca o papel gestora ↔ profissional (o banco só deixa a dona; 0 linhas = sem permissão). */
export function alterarPapel(db: ClienteDb, empresaId: string, membroId: string, papel: 'gestor' | 'profissional'): Promise<void> {
  return atualizarMembro(db, empresaId, membroId, { role: papel }, 'trocar o papel desta pessoa');
}
```

Confira os nomes reais dos campos devolvidos por `pendentesPorProfissional` (`valorDoPeriodo`, `valorAnterior`, `idsDoPeriodo`), que já são usados assim em `web/app/(app)/equipe/page.tsx`. Se o teste de pendentes não bater com o formato do `fakeDb` (`range` em `comissoes`/`comanda_itens`), ajuste o mínimo e explique no relatório.

- [ ] **Step 5: Testes e tsc**

```bash
cd web && npx vitest run tests/unit/equipe-regras.test.ts tests/unit/equipe-consultas.test.ts
cd web && npx tsc --noEmit
```

Esperado: os testes passam e o tsc dá 0 erros.

- [ ] **Step 6: Commit**

```bash
git add shared/equipe.ts shared/equipe-consultas.ts web/tests/unit/equipe-regras.test.ts web/tests/unit/equipe-consultas.test.ts
git commit -m "feat(shared): regras e consultas da Equipe (faturado sem pacote, vinculo sem zerar comissao)"
```

---

### Task 2: API de profissionais e convites

**Files:**
- Modify: `web/app/api/profissionais/route.ts`, `web/app/api/convites/route.ts`
- Create: `web/lib/auth/quem-chama.ts`
- Test: `web/tests/unit/api-equipe.test.ts` (varredura de texto + função pura)

**Interfaces:**
- **Produz** `quemChama(req: NextRequest, adminClient): Promise<string | null>` em `web/lib/auth/quem-chama.ts`. Com `Authorization: Bearer <token>`, usa `adminClient.auth.getUser(token)`; senão, a sessão por cookie (`createClient()` de `@/lib/supabase/server`). Devolve o id do usuário ou null.
- **Contrato do PATCH:** corpo `{ empresaId, userId, membroId, nome?, telefone?, email?, percentual_comissao?, tipo_contrato? }`. Respostas:
  - 200 `{ ok: true }`;
  - 400 `{ error }` para validação;
  - 401, 403 e 409 `{ error: 'Este e-mail já é usado por outra conta.' }`.
- **Contrato dos POST:** aceitam `tipo_contrato` além do que já aceitam. A resposta `membro` inclui `tipo_contrato`.
- **Consome** `vinculoParaGravar`, `montarPatchVinculo` e `emailValido` de `@shared/equipe`.

Requisitos:
1. `quemChama` substitui a lógica duplicada de Bearer/cookie do POST de `profissionais`. `convites` e PATCH passam a usar a mesma função, e assim o app consegue chamar os três.
2. **POST de `profissionais` e de `convites`:**
   - ler o vínculo existente (`id, role, percentual_comissao, tipo_contrato`);
   - calcular `vinculoParaGravar(existente, { percentual_comissao, tipo_contrato })` (erro → 400);
   - fazer o upsert com esses valores, mais `ativo: true` e o papel existente ou o solicitado. Nunca `?? 0` direto;
   - incluir `tipo_contrato` no `select` de retorno.
3. **PATCH:**
   - exige `empresaId`. Quem chama precisa ser membro ativo dessa empresa (ou a dona por `empresas.owner_id`), ter `equipe.gerenciar` (`carregarPermissoesDoMembro`) e passar em `podeGerenciarMembro` (mesma regra de hoje). O alvo (`userId`) precisa ter vínculo nessa empresa, e `membroId` precisa ser desse vínculo;
   - `nome`, se vier, não pode ficar vazio;
   - `telefone`/`nome`, se vierem, são gravados em `users`;
   - `email`, se vier: `emailValido`, senão 400 "E-mail inválido.". Se for diferente do atual (`users.email`), chamar antes `adminClient.auth.admin.updateUserById(userId, { email, email_confirm: true })`. Erro com "already", "registered" ou "exists" na mensagem (minúsculas) → 409 com a mensagem da decisão 2; outro erro → 400. Só depois gravar `users.email`;
   - vínculo: `montarPatchVinculo` (erro → 400). Patch vazio → não chama o update;
   - `user_metadata.nome` atualizado quando `nome` vier.
4. As mensagens de erro saem em português.
5. **Teste `web/tests/unit/api-equipe.test.ts`** (varredura de texto):
   - os dois POST usam `vinculoParaGravar` e não têm `percentual_comissao ?? 0`;
   - os três handlers usam `quemChama`;
   - o PATCH usa `montarPatchVinculo`, `updateUserById(` com `email` e a mensagem "Este e-mail já é usado por outra conta.";
   - o PATCH exige `empresaId`.

- [ ] Step 1: teste (falha) → Step 2: implementação → Step 3: `cd web && npx vitest run tests/unit/api-equipe.test.ts tests/unit/equipe-regras.test.ts` e `cd web && npx tsc --noEmit` → Step 4: commit `fix(api/equipe): convite nao zera comissao, PATCH pelo app com empresa explicita e troca de login no e-mail`.

---

### Task 3: Web — tela Equipe pelas funções de shared

**Files:**
- Modify: `web/app/(app)/equipe/page.tsx`
- Test: `web/tests/unit/equipe-telas.test.ts`, bloco `describe('web', …)`. A Task 4 acrescenta o bloco do app.

Requisitos:
1. **`carregarEquipe` (local):** substituída por `carregarEquipe(supabase, empresaId, chaveMesBRT(new Date()))` de shared (`chaveMesBRT` existe em `@shared/periodos`). Erro aparece num banner com "Tentar de novo", nunca `alert`. Contador de requisição.
2. **`gravarAtivo`/`alterarRole`:** usam `alterarAtivo`/`alterarPapel` de shared em try/catch. O erro aparece no toast ou banner, e a lista local só muda no sucesso.
3. **`NovoProfModal`:** campo "Tipo de contrato" (sem informar / PJ / Comissionada / CLT), igual ao `EditInfoModal`, enviado como `tipo_contrato` nos dois caminhos (convite e senha).
4. **`EditInfoModal`:**
   - envia `empresaId` no PATCH;
   - mostra a mensagem de erro da API (409 do e-mail incluso);
   - usa `rotuloContrato` de shared para os rótulos.
5. O tipo `Profissional` local passa a ser `MembroEquipe` de shared.
6. **Card:** mostra "Faturado no mês" com o valor novo (decisão 1). Os textos continuam os mesmos.
7. **Teste `describe('web')`:**
   - `carregarEquipe(`, `alterarAtivo(`, `alterarPapel(` e `rotuloContrato`;
   - `empresaId` no corpo do PATCH;
   - `tipo_contrato` no `NovoProfModal`;
   - sem `.from('empresa_membros').update(` no arquivo.

- [ ] Steps: teste falhando → implementação → `cd web && npx vitest run` (tudo PASS) e `cd web && npx tsc --noEmit` → commit `feat(equipe/web): tela pelas funcoes de shared, contrato no cadastro e erros da API`.

---

### Task 4: App — Equipe, editar profissional e convite

**Files:**
- Modify: `mobile/app/(empresa)/equipe.tsx`, `mobile/app/(empresa)/convidar-profissional.tsx`, `mobile/app/(empresa)/_layout.tsx` (registrar a rota nova, se o layout listar rotas)
- Create: `mobile/app/(empresa)/editar-profissional/[id].tsx`
- Test: `web/tests/unit/equipe-telas.test.ts`, bloco `describe('app', …)`

Requisitos (referência: a tela do web depois da Task 3):
1. **`useEquipe`:** usa `carregarEquipe(supabase, empresaId, chaveMesBRT(new Date()))` com a chave `['equipe', empresaId, mes]`. Em erro, mostra banner com "Tentar de novo". A dona aparece na lista.
2. **Card igual ao web:**
   - papel, Ativa/Inativa, selo de exceções de permissão (já existe), comissão %, tipo de contrato (`rotuloContrato`), faturado e atendimentos do mês;
   - "Comissão pendente do mês" com botão **Pagar** (`pagarComissoes(supabase, empresaId, ids_pendentes_mes)`, sem otimismo, com `MENSAGEM_PAGAMENTO_PARCIAL` em resultado parcial) quando houver e com `comissoes.pagar`;
   - "+ R$ X de meses anteriores — pague em Comissões" quando `comissao_pendente_anterior > 0`.
3. **Ações:**
   - desativar com confirmação (`Alert` com Cancelar/Desativar), reativar direto, trocar papel só quando `podeAtribuirRole` e o alvo não é a dona, todas por `alterarAtivo`/`alterarPapel`. Erro em `Alert`;
   - editar (lápis) abre `/(empresa)/editar-profissional/<membroId>`, só com `podeGerenciarMembro` (mesma regra do web).
4. **Edição rápida de comissão:** se o modal atual continuar, ele passa a usar o PATCH da API (com Bearer e `empresaId`), não o update direto. Uma única forma de gravar.
5. **`editar-profissional/[id].tsx`:**
   - carrega o vínculo e o usuário (`empresa_membros` com `user:users(...)` por `id` e `empresa_id`);
   - campos nome *, telefone (`maskPhone` do mobile ou `@shared/mascaras`), e-mail, comissão (%) e tipo de contrato (chips: Sem informar / PJ / Comissionada / CLT);
   - salvar: `fetch(`${EXPO_PUBLIC_API_URL}/api/profissionais`, { method: 'PATCH', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ empresaId, userId, membroId, nome, telefone, email, percentual_comissao, tipo_contrato }) })`. Siga o padrão de `convidar-profissional.tsx` para URL e token;
   - mostra o `error` da resposta;
   - trava de duplo toque;
   - sucesso invalida `['equipe']` e `['profissionais']` e volta;
   - sem `equipe.gerenciar`, mostra aviso, como as outras telas.
6. **`convidar-profissional.tsx`:** campos de comissão (%) e tipo de contrato, enviados como `percentual_comissao` e `tipo_contrato` nos dois caminhos.
7. Pagar, ativar e papel invalidam `['equipe']`, `['profissionais']` e `invalidarFinanceiro(qc)`.
8. Nenhum `.from('empresa_membros').update(` sobra no app.
9. **Teste `describe('app')`:**
   - a rota `editar-profissional/[id].tsx` existe e usa `method: 'PATCH'`, `Authorization` e `empresaId`;
   - `equipe.tsx` usa `carregarEquipe(`, `pagarComissoes(`, `alterarAtivo(`, `alterarPapel(` e "meses anteriores";
   - `convidar-profissional.tsx` envia `tipo_contrato` e `percentual_comissao`;
   - sem `.from('empresa_membros').update(` em `mobile/app`.

- [ ] Steps: teste falhando → implementação → `cd web && npx vitest run` (tudo PASS), `cd web && npx tsc --noEmit` (0), `cd mobile && npx tsc --noEmit` (8, nenhum nos arquivos tocados) → commit `feat(equipe/app): editar profissional, pagar comissoes, dona na lista e contrato no convite`.

---

### Task 5: Revisão das permissões (27 chaves × web/PWA × app)

**Files:**
- Create: `docs/superpowers/notes/2026-10-14-matriz-permissoes.md`
- Create (se precisar): `supabase/migrations/089_permissoes_alinhamento.sql`
- Modify: as telas e os módulos com divergência
- Test: `web/tests/unit/permissoes-matriz.test.ts`

**Contexto:**
- O catálogo está em `shared/permissoes.ts`.
- O banco usa `tem_permissao(empresa, chave)` nas policies (migration 083 em diante: 084–088).
- A tela usa `pode('chave')`: `usePermissoes()` no web (`@/components/PermissoesProvider`) e no app (`@/lib/permissions`).
- Bug real que motivou esta task, já corrigido no commit 4088486: a tela deixava a profissional fechar a comanda, mas o INSERT com RETURNING era recusado pela policy de SELECT.

**Procedimento:**
1. **Matriz.** Para cada chave, monte uma linha com:
   - as telas e ações do web que a usam;
   - as telas e ações do app que a usam;
   - as tabelas e funções do banco que a exigem (grep por `tem_permissao(` nas migrations, valendo a última definição de cada policy);
   - o padrão por papel;
   - o veredito.
2. **Procure, nas duas plataformas, estas classes de divergência:**
   - **(a)** a tela mostra ou libera a ação, mas o banco recusa para quem tem a chave. Isso inclui policy de SELECT mais restrita que a de INSERT com RETURNING, UPDATE sem `.select()` e UPDATE com `.select()` em tabela que ela não pode ler;
   - **(b)** o banco libera, mas a tela esconde ou bloqueia;
   - **(c)** a tela usa uma chave diferente da do banco para a mesma ação;
   - **(d)** o web gateia uma ação e o app não (ou o contrário);
   - **(e)** a ação depende do papel (`role === ...`) quando deveria depender da chave.
3. **Varra também as gravações da profissional nas próprias coisas:** comanda, agenda (criar, editar, concluir, status, bloqueio), cliente, anamnese, venda de pacote e vendas. Para cada uma, simule por leitura do SQL a profissional com os padrões e confirme que cada passo (incluindo RETURNING e update com select) passa.
4. **Corrija tudo o que achar:**
   - no código, de preferência;
   - no banco, se a policy estiver errada, numa migration `089_permissoes_alinhamento.sql` idempotente, com cabeçalho e rollback.
   - Nenhuma mudança de comportamento para a dona.
5. **Teste `permissoes-matriz.test.ts`.** Ele trava:
   - toda chave usada em `pode('…')` no web e no app existe no catálogo;
   - toda chave do catálogo aparece em pelo menos uma policy (`tem_permissao`) ou é marcada na matriz como "só tela", com o motivo;
   - nenhum `from('comandas').insert(...).select(` volta;
   - as correções feitas.
6. **A matriz** registra cada divergência achada, a correção e o que ficou de fora (com motivo).

- [ ] Steps: matriz → correções com testes → `cd web && npx vitest run` (tudo PASS), os dois tsc → commit `fix(permissoes): tela e banco de acordo nas 27 chaves (matriz + correcoes)`.
