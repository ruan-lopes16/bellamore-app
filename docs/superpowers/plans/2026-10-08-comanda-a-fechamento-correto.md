# Comanda A — fechamento correto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web e app fecham a comanda pela mesma regra (desconto %/R$ limitado ao subtotal, total coberto, pagamentos com bandeira/parcelas/taxa/valor líquido, valor cobrado gravado no atendimento, erros conferidos), com taxas da maquininha editáveis em Configurações.

**Architecture:** cálculos em `shared/comanda-fechamento.ts` e `shared/taxas-cartao.ts` (puros, testados), consumidos pelas duas telas de comanda. Valor cobrado por atendimento reaproveita `agruparValoresPorAgendamento` (já em `shared/comanda.ts`, usado pelo web). Migration 084 adiciona 3 colunas `taxa_cartao_*` em `empresas`; o trigger da 083 já restringe não-dona a colunas `taxa_*` com `config.taxas`.

**Tech Stack:** Next.js (web, ver `web/AGENTS.md`), Expo SDK 51 / RN 0.74, Supabase, Vitest (em `web/tests/unit`, também lê `shared/` e fontes do `mobile/`).

**Spec:** `docs/superpowers/specs/2026-10-08-comanda-a-fechamento-correto-design.md`

## Global Constraints

- Português em código, comentários, commits e telas. Dinheiro exibido por `formatarMoeda` (`@shared/moeda`).
- Desconto: o usuário escolhe `%` ou `R$`; grava-se sempre o valor em reais; desconto > subtotal bloqueia com "O desconto não pode ser maior que o subtotal".
- Fechar só com total coberto (`recebido ≥ total − 0,01`); troco permitido; total < 0,01 → Cortesia automática (uma linha `metodo 'cortesia'`, valor 0).
- Taxas padrão: débito `0.0239`, crédito à vista `0.0499`, crédito parcelado `0.0559`.
- Edição de comanda fechada (web): produtos e quantidades SÓ LEITURA; editáveis: valores dos serviços, desconto, pagamentos.
- Paridade web/mobile; área `mobile/app/(profissional)` sem telas/botões novos.
- Migrations aplicadas à mão no SQL Editor do projeto `qpiepxolyqmoankeyeva`; idempotentes; terminam com `notify pgrst, 'reload schema';`. Nunca `supabase db push`.
- Verificação por task: `cd web && npx tsc --noEmit` zerado; `cd web && npx vitest run` verde; `cd mobile && npx tsc --noEmit` com EXATAMENTE os 6 erros pré-existentes (configuracoes.tsx ×2, estoque.tsx, useAgenda.ts, useNotificacoes.ts ×2).
- Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; nunca commitar `.superpowers/`.

---

### Task 1: Taxas da maquininha em shared

**Files:**
- Create: `shared/taxas-cartao.ts`
- Delete: `web/lib/taxas-cartao.ts`
- Modify: `web/app/(app)/comanda/page.tsx` (import ~52), `web/app/(app)/vendas/page.tsx` (import ~39)
- Test: `web/tests/unit/taxas-cartao.test.ts`

**Interfaces:**
- Produces:
  - `type TaxasCartao = { debito: number; creditoAvista: number; creditoParcelado: number }`
  - `TAXAS_PADRAO: TaxasCartao` = `{ debito: 0.0239, creditoAvista: 0.0499, creditoParcelado: 0.0559 }`
  - `taxasDaEmpresa(empresa: Record<string, unknown> | null | undefined): TaxasCartao` — lê `taxa_cartao_debito`, `taxa_cartao_credito_avista`, `taxa_cartao_credito_parcelado`; ausente/não numérico/fora de [0, 0.2] → padrão daquele campo.
  - `calcTaxa(metodo: string, parcelas?: number, taxas?: TaxasCartao): number` (taxas default `TAXAS_PADRAO`)
  - `valorLiquido(bruto: number, taxa: number): number`, `fmtTaxa(taxa: number): string`, `OPCOES_PARCELAS`

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/taxas-cartao.test.ts
import { describe, expect, it } from 'vitest';
import { TAXAS_PADRAO, taxasDaEmpresa, calcTaxa, valorLiquido, fmtTaxa, OPCOES_PARCELAS } from '@shared/taxas-cartao';

describe('taxas da maquininha', () => {
  it('padrão = InfinitePay atual', () => {
    expect(TAXAS_PADRAO).toEqual({ debito: 0.0239, creditoAvista: 0.0499, creditoParcelado: 0.0559 });
    expect(OPCOES_PARCELAS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18]);
  });
  it('taxasDaEmpresa lê as colunas e cai no padrão quando ausente/inválido', () => {
    expect(taxasDaEmpresa({ taxa_cartao_debito: 0.02, taxa_cartao_credito_avista: '0.045', taxa_cartao_credito_parcelado: null }))
      .toEqual({ debito: 0.02, creditoAvista: 0.045, creditoParcelado: 0.0559 });
    expect(taxasDaEmpresa(null)).toEqual(TAXAS_PADRAO);
    expect(taxasDaEmpresa({ taxa_cartao_debito: 5 })).toEqual(TAXAS_PADRAO);
  });
  it('calcTaxa por método e parcelas', () => {
    const t = { debito: 0.02, creditoAvista: 0.04, creditoParcelado: 0.05 };
    expect(calcTaxa('debito', 1, t)).toBe(0.02);
    expect(calcTaxa('credito', 1, t)).toBe(0.04);
    expect(calcTaxa('credito', 3, t)).toBe(0.05);
    expect(calcTaxa('pix', 1, t)).toBe(0);
    expect(calcTaxa('credito', 1)).toBe(0.0499);
  });
  it('valorLiquido e fmtTaxa', () => {
    expect(valorLiquido(100, 0.0499)).toBe(95.01);
    expect(fmtTaxa(0.0499)).toBe('4,99%');
  });
});
```

- [ ] **Step 2:** `cd web && npx vitest run tests/unit/taxas-cartao.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// shared/taxas-cartao.ts
/**
 * Taxas da maquininha (web e app). Configuráveis por empresa (migration 084:
 * empresas.taxa_cartao_debito / _credito_avista / _credito_parcelado); sem as colunas
 * (migration não aplicada) ou com valor inválido, vale o padrão InfinitePay.
 */
export type TaxasCartao = { debito: number; creditoAvista: number; creditoParcelado: number };

export const TAXAS_PADRAO: TaxasCartao = { debito: 0.0239, creditoAvista: 0.0499, creditoParcelado: 0.0559 };

export const OPCOES_PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18];

function taxaValida(v: unknown, padrao: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 0.2 ? n : padrao;
}

/** Taxas da empresa a partir da linha de `empresas` (qualquer coluna ausente → padrão). */
export function taxasDaEmpresa(empresa: Record<string, unknown> | null | undefined): TaxasCartao {
  return {
    debito:           taxaValida(empresa?.taxa_cartao_debito, TAXAS_PADRAO.debito),
    creditoAvista:    taxaValida(empresa?.taxa_cartao_credito_avista, TAXAS_PADRAO.creditoAvista),
    creditoParcelado: taxaValida(empresa?.taxa_cartao_credito_parcelado, TAXAS_PADRAO.creditoParcelado),
  };
}

/** Taxa decimal (ex.: 0.0499) conforme método e parcelas. Pix/dinheiro/cortesia → 0. */
export function calcTaxa(metodo: string, parcelas = 1, taxas: TaxasCartao = TAXAS_PADRAO): number {
  if (metodo === 'debito') return taxas.debito;
  if (metodo === 'credito') return parcelas === 1 ? taxas.creditoAvista : taxas.creditoParcelado;
  return 0;
}

/** "4,99%". */
export function fmtTaxa(taxa: number): string {
  return `${(taxa * 100).toFixed(2).replace('.', ',')}%`;
}

/** Valor líquido após a taxa, arredondado em centavos. */
export function valorLiquido(bruto: number, taxa: number): number {
  return Math.round(bruto * (1 - taxa) * 100) / 100;
}
```

Em `web/app/(app)/comanda/page.tsx` e `web/app/(app)/vendas/page.tsx`: trocar `from '@/lib/taxas-cartao'` por `from '@shared/taxas-cartao'` e passar as taxas da empresa a todo `calcTaxa(...)`. Cada página carrega as taxas uma vez junto com o que já carrega da empresa: `supabase.from('empresas').select('*').eq('id', empresaId).single()` → `setTaxas(taxasDaEmpresa(data))` (estado inicial `TAXAS_PADRAO`; `select('*')` para não falhar antes da migration 084). Apagar `web/lib/taxas-cartao.ts`.

- [ ] **Step 4:** teste + `cd web && npx tsc --noEmit` + `cd web && npx vitest run`.
- [ ] **Step 5: Commit** — `feat(taxas): taxas da maquininha em shared, por empresa`.

---

### Task 2: Regra de fechamento em shared

**Files:**
- Create: `shared/comanda-fechamento.ts`
- Test: `web/tests/unit/comanda-fechamento.test.ts`

**Interfaces:**
- Consumes: `aplicarDescontoReserva` (`shared/taxa-reserva.ts`), `TaxasCartao`, `calcTaxa`, `valorLiquido` (Task 1), `formatarMoeda`.
- Produces:
  - `type ModoDesconto = 'percentual' | 'valor'`
  - `calcularDesconto(subtotal: number, entrada: number, modo: ModoDesconto): { valor: number; erro: string | null }`
  - `type SplitPagamento = { metodo: string; valor: number; bandeira?: string | null; parcelas?: number }`
  - `type ResumoComanda = { subtotal; desconto; descontoReserva; total; recebido; falta; troco; cortesiaAutomatica: boolean; podeFechar: boolean; motivo: string | null }` (números)
  - `resumoComanda(e: { subtotal: number; desconto: number; erroDesconto?: string | null; descontoReserva: number; splits: SplitPagamento[] }): ResumoComanda`
  - `montarPagamentos(splits: SplitPagamento[], ctx: { empresaId: string; comandaId: string; taxas: TaxasCartao; total: number }): LinhaPagamento[]` com `LinhaPagamento = { empresa_id; comanda_id; valor; metodo; bandeira: string | null; parcelas: number; taxa_perc: number | null; valor_liquido: number | null; status: 'pago' }`
  - `parseValorBR(s: string): number` — '1.234,56' / '12,5' / '' → número (NaN → 0)

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/comanda-fechamento.test.ts
import { describe, expect, it } from 'vitest';
import { calcularDesconto, resumoComanda, montarPagamentos, parseValorBR } from '@shared/comanda-fechamento';
import { TAXAS_PADRAO } from '@shared/taxas-cartao';

describe('calcularDesconto', () => {
  it('percentual e valor', () => {
    expect(calcularDesconto(200, 10, 'percentual')).toEqual({ valor: 20, erro: null });
    expect(calcularDesconto(200, 10, 'valor')).toEqual({ valor: 10, erro: null });
    expect(calcularDesconto(99.9, 10, 'percentual')).toEqual({ valor: 9.99, erro: null });
  });
  it('negativo vira 0; acima do subtotal bloqueia', () => {
    expect(calcularDesconto(100, -5, 'valor')).toEqual({ valor: 0, erro: null });
    expect(calcularDesconto(100, 150, 'valor')).toEqual({ valor: 100, erro: 'O desconto não pode ser maior que o subtotal' });
    expect(calcularDesconto(100, 120, 'percentual').erro).toBe('O desconto não pode ser maior que o subtotal');
  });
});

describe('resumoComanda', () => {
  const base = { subtotal: 200, desconto: 20, descontoReserva: 30, splits: [] as { metodo: string; valor: number }[] };
  it('sem pagamento não fecha e diz quanto falta', () => {
    const r = resumoComanda(base);
    expect(r.total).toBe(150);
    expect(r.podeFechar).toBe(false);
    expect(r.falta).toBe(150);
    expect(r.motivo).toBe('Ainda faltam R$ 150,00 para cobrir o total');
  });
  it('pagamento exato fecha; a mais vira troco', () => {
    expect(resumoComanda({ ...base, splits: [{ metodo: 'pix', valor: 150 }] }).podeFechar).toBe(true);
    const r = resumoComanda({ ...base, splits: [{ metodo: 'dinheiro', valor: 160 }] });
    expect(r.podeFechar).toBe(true);
    expect(r.troco).toBe(10);
    expect(r.falta).toBe(0);
  });
  it('total zero = cortesia automática, fecha sem pagamento', () => {
    const r = resumoComanda({ subtotal: 100, desconto: 0, descontoReserva: 100, splits: [] });
    expect(r.cortesiaAutomatica).toBe(true);
    expect(r.podeFechar).toBe(true);
  });
  it('erro de desconto bloqueia mesmo coberto', () => {
    const r = resumoComanda({ ...base, erroDesconto: 'O desconto não pode ser maior que o subtotal', splits: [{ metodo: 'pix', valor: 999 }] });
    expect(r.podeFechar).toBe(false);
    expect(r.motivo).toBe('O desconto não pode ser maior que o subtotal');
  });
});

describe('montarPagamentos', () => {
  const ctx = { empresaId: 'e', comandaId: 'c', taxas: TAXAS_PADRAO, total: 300 };
  it('cartão grava bandeira, parcelas, taxa e líquido; pix sem taxa', () => {
    const linhas = montarPagamentos([
      { metodo: 'credito', valor: 100, bandeira: 'visa', parcelas: 3 },
      { metodo: 'debito', valor: 100, bandeira: 'master' },
      { metodo: 'pix', valor: 100, bandeira: 'visa' },
    ], ctx);
    expect(linhas[0]).toEqual({ empresa_id: 'e', comanda_id: 'c', valor: 100, metodo: 'credito', bandeira: 'visa', parcelas: 3, taxa_perc: 0.0559, valor_liquido: 94.41, status: 'pago' });
    expect(linhas[1]).toMatchObject({ metodo: 'debito', parcelas: 1, taxa_perc: 0.0239, valor_liquido: 97.61, bandeira: 'master' });
    expect(linhas[2]).toMatchObject({ metodo: 'pix', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null });
  });
  it('ignora splits de valor zero; total zero sem splits = cortesia', () => {
    expect(montarPagamentos([{ metodo: 'pix', valor: 0 }], ctx)).toEqual([]);
    expect(montarPagamentos([], { ...ctx, total: 0 })).toEqual([
      { empresa_id: 'e', comanda_id: 'c', valor: 0, metodo: 'cortesia', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null, status: 'pago' },
    ]);
  });
});

describe('parseValorBR', () => {
  it('formatos brasileiros', () => {
    expect(parseValorBR('1.234,56')).toBe(1234.56);
    expect(parseValorBR('12,5')).toBe(12.5);
    expect(parseValorBR('')).toBe(0);
    expect(parseValorBR('abc')).toBe(0);
  });
});
```

- [ ] **Step 2:** rodar → FAIL.

- [ ] **Step 3: Implementar**

```ts
// shared/comanda-fechamento.ts
/**
 * Regra única de fechamento da comanda (web e app) — spec
 * docs/superpowers/specs/2026-10-08-comanda-a-fechamento-correto-design.md.
 * O valor cobrado por atendimento continua em shared/comanda.ts (agruparValoresPorAgendamento).
 */
import { formatarMoeda } from './moeda';
import { calcTaxa, valorLiquido, type TaxasCartao } from './taxas-cartao';

export type ModoDesconto = 'percentual' | 'valor';

const centavos = (v: number) => Math.round(v * 100) / 100;
const ERRO_DESCONTO = 'O desconto não pode ser maior que o subtotal';

/** '1.234,56' → 1234.56; vazio/inválido → 0. */
export function parseValorBR(s: string): number {
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Desconto em reais a partir do que a pessoa digitou (% ou R$). Acima do subtotal → erro e valor limitado. */
export function calcularDesconto(subtotal: number, entrada: number, modo: ModoDesconto): { valor: number; erro: string | null } {
  const bruto = Math.max(0, modo === 'percentual' ? centavos((subtotal * entrada) / 100) : centavos(entrada));
  if (bruto > subtotal + 0.001) return { valor: centavos(subtotal), erro: ERRO_DESCONTO };
  return { valor: bruto, erro: null };
}

export type SplitPagamento = { metodo: string; valor: number; bandeira?: string | null; parcelas?: number };

export type ResumoComanda = {
  subtotal: number; desconto: number; descontoReserva: number; total: number;
  recebido: number; falta: number; troco: number;
  cortesiaAutomatica: boolean; podeFechar: boolean; motivo: string | null;
};

/** Totais da comanda e se ela pode fechar (total coberto; troco permitido; total zero = cortesia). */
export function resumoComanda(e: {
  subtotal: number; desconto: number; erroDesconto?: string | null; descontoReserva: number; splits: SplitPagamento[];
}): ResumoComanda {
  const total = centavos(Math.max(e.subtotal - e.desconto - e.descontoReserva, 0));
  const recebido = centavos(e.splits.reduce((s, x) => s + (x.valor > 0 ? x.valor : 0), 0));
  const falta = centavos(Math.max(total - recebido, 0));
  const troco = centavos(Math.max(recebido - total, 0));
  const cortesiaAutomatica = total < 0.01;
  const coberto = cortesiaAutomatica || recebido >= total - 0.01;
  const motivo = e.erroDesconto ?? (coberto ? null : `Ainda faltam ${formatarMoeda(falta)} para cobrir o total`);
  return {
    subtotal: e.subtotal, desconto: e.desconto, descontoReserva: e.descontoReserva,
    total, recebido, falta, troco, cortesiaAutomatica, podeFechar: !e.erroDesconto && coberto, motivo,
  };
}

export type LinhaPagamento = {
  empresa_id: string; comanda_id: string; valor: number; metodo: string;
  bandeira: string | null; parcelas: number; taxa_perc: number | null; valor_liquido: number | null; status: 'pago';
};

/** Linhas de `pagamentos`: cartão com bandeira/parcelas/taxa/líquido; total zero sem splits = cortesia R$0. */
export function montarPagamentos(
  splits: SplitPagamento[],
  ctx: { empresaId: string; comandaId: string; taxas: TaxasCartao; total: number },
): LinhaPagamento[] {
  const validos = splits.filter(s => s.valor > 0);
  if (validos.length === 0 && ctx.total < 0.01) {
    return [{ empresa_id: ctx.empresaId, comanda_id: ctx.comandaId, valor: 0, metodo: 'cortesia', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null, status: 'pago' }];
  }
  return validos.map(s => {
    const cartao = s.metodo === 'credito' || s.metodo === 'debito';
    const parcelas = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
    const taxa = calcTaxa(s.metodo, parcelas, ctx.taxas);
    return {
      empresa_id: ctx.empresaId, comanda_id: ctx.comandaId, valor: centavos(s.valor), metodo: s.metodo,
      bandeira: cartao ? (s.bandeira ?? null) : null, parcelas,
      taxa_perc: taxa > 0 ? taxa : null, valor_liquido: taxa > 0 ? valorLiquido(s.valor, taxa) : null,
      status: 'pago',
    };
  });
}
```

- [ ] **Step 4:** teste + `cd web && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(comanda): regra unica de fechamento em shared`.

---

### Task 3: Migration 084 + taxas editáveis em Configurações

**Files:**
- Create: `supabase/migrations/084_taxas_cartao_empresa.sql`
- Modify: `shared/permissoes.ts` (descrição/rótulo de `config.taxas`), `web/app/(app)/configuracoes/page.tsx`, `mobile/app/(empresa)/configuracoes.tsx`
- Test: `web/tests/unit/taxas-cartao-config.test.ts`

**Interfaces:**
- Consumes: `taxasDaEmpresa`, `TAXAS_PADRAO`, `fmtTaxa` (Task 1).

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/taxas-cartao-config.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CATALOGO_PERMISSOES } from '@shared/permissoes';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('migration 084', () => {
  const sql = ler('supabase/migrations/084_taxas_cartao_empresa.sql');
  it('3 colunas taxa_cartao_* com padrão atual e limite', () => {
    expect(sql).toMatch(/add column if not exists taxa_cartao_debito\s+numeric\(6,4\) not null default 0\.0239/);
    expect(sql).toMatch(/add column if not exists taxa_cartao_credito_avista\s+numeric\(6,4\) not null default 0\.0499/);
    expect(sql).toMatch(/add column if not exists taxa_cartao_credito_parcelado\s+numeric\(6,4\) not null default 0\.0559/);
    expect(sql).toMatch(/between 0 and 0\.2/);
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('Configurações: taxas da maquininha', () => {
  it('permissão config.taxas cita a maquininha', () => {
    const c = CATALOGO_PERMISSOES.find(p => p.chave === 'config.taxas')!;
    expect(c.rotulo).toBe('Editar taxas de reserva, cancelamento e maquininha');
  });
  for (const arq of ['web/app/(app)/configuracoes/page.tsx', 'mobile/app/(empresa)/configuracoes.tsx']) {
    it(`${arq} edita as 3 taxas`, () => {
      const src = ler(arq);
      expect(src).toContain('Taxas da maquininha');
      for (const col of ['taxa_cartao_debito', 'taxa_cartao_credito_avista', 'taxa_cartao_credito_parcelado']) expect(src).toContain(col);
      expect(src).toContain("pode('config.taxas')");
    });
  }
});
```

- [ ] **Step 2:** rodar → FAIL.

- [ ] **Step 3: Migration**

```sql
-- ============================================================
-- 084 — Taxas da maquininha por empresa (editáveis em Configurações)
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-08-comanda-a-fechamento-correto-design.md
-- Antes fixas no código (web/lib/taxas-cartao.ts, InfinitePay). Padrões = valores de antes,
-- então nada muda no dia em que roda. Sem policy nova: o trigger trg_empresas_nao_dona_so_taxas
-- (083) já deixa quem não é dona alterar só colunas taxa_* com a permissão config.taxas.
-- Pagamentos antigos mantêm o taxa_perc com que foram gravados.
-- Rollback:
--   alter table public.empresas drop column if exists taxa_cartao_debito,
--     drop column if exists taxa_cartao_credito_avista, drop column if exists taxa_cartao_credito_parcelado;

alter table public.empresas
  add column if not exists taxa_cartao_debito            numeric(6,4) not null default 0.0239,
  add column if not exists taxa_cartao_credito_avista    numeric(6,4) not null default 0.0499,
  add column if not exists taxa_cartao_credito_parcelado numeric(6,4) not null default 0.0559;

alter table public.empresas drop constraint if exists empresas_taxas_cartao_faixa;
alter table public.empresas add constraint empresas_taxas_cartao_faixa check (
  taxa_cartao_debito between 0 and 0.2
  and taxa_cartao_credito_avista between 0 and 0.2
  and taxa_cartao_credito_parcelado between 0 and 0.2
);

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Catálogo** — em `shared/permissoes.ts`, a entrada `config.taxas` passa a `rotulo: 'Editar taxas de reserva, cancelamento e maquininha'` (descrição mantém "Os demais dados da empresa são só da dona."). Rodar os testes de permissões existentes e ajustar só asserções de rótulo, se houver.

- [ ] **Step 5: Telas** — na aba Empresa de Configurações (web e app), dentro da área que já aparece para `pode('dona') || pode('config.taxas')`, um bloco "Taxas da maquininha" com 3 campos de percentual (Débito, Crédito à vista, Crédito parcelado): exibição `(taxa × 100)` com vírgula, edição com máscara de número decimal (2 casas), validação 0–20%. Carregar de `empresas` (`select('*')`, via `taxasDaEmpresa` para o valor inicial) e salvar junto com as demais taxas no mesmo `update` que hoje grava `taxa_reserva_*`/`taxa_cancelamento_*` (colunas `taxa_cartao_*` em decimal: valor digitado ÷ 100). Erro de salvar via `mensagemErroBanco`. Se a migration 084 ainda não existir, o salvar das colunas novas falha com erro do banco — mostrar a mensagem normalmente (não esconder).

- [ ] **Step 6:** teste + `cd web && npx tsc --noEmit` + `cd web && npx vitest run` + `cd mobile && npx tsc --noEmit` (baseline).
- [ ] **Step 7: Commit** — `feat(taxas): migration 084 e taxas da maquininha editaveis em Configuracoes`.

---

### Task 4: Web — comanda pela regra única e edição corrigida

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`
- Test: `web/tests/unit/comanda-a-paridade.test.ts` (novo; parte web)

**Interfaces:**
- Consumes: Tasks 1–2 (`calcularDesconto`, `resumoComanda`, `montarPagamentos`, `parseValorBR`, `taxasDaEmpresa`); existente `agruparValoresPorAgendamento`, `aplicarDescontoReserva`, `somarTaxasReservaPagas`.

Mudanças (arquivo tem ~1770 linhas; edições cirúrgicas):
1. **Desconto %/R$**: estado `descontoModo: ModoDesconto` (padrão `'percentual'`, igual ao comportamento atual) ao lado de `descontoPct` (renomear para `descontoEntrada`); seletor de dois botões "%" / "R$" junto ao input (~1530), só quando `pode('comanda.desconto')`. `const { valor: descontoN, erro: erroDesconto } = calcularDesconto(subtotal, parseValorBR(descontoEntrada), descontoModo)` (substitui ~787-788).
2. **Resumo**: `const resumo = resumoComanda({ subtotal, desconto: descontoN, erroDesconto, descontoReserva: descontoReservaAplicado, splits: splits.map(s => ({ ...s, valor: parseValorBR(s.valor) })) })`; `total`, `recebido`, `restante`/falta/troco do painel (~809-810, ~1692-1720) passam a vir de `resumo`; o botão Fechar (~1743) usa `!resumo.podeFechar` no lugar da condição atual de splits/restante (mantendo `fechando`, `itens.length === 0`, `!empresaId`, `(!comandaExistenteId && !podeFechar)`); mensagem abaixo do botão (~1761) usa `resumo.motivo`. Manter `aplicarDescontoReserva` para obter `descontoReservaAplicado` como hoje.
3. **Pagamentos**: os dois inserts (fechar novo ~ e `editarComanda` ~700-717) passam a `montarPagamentos(splitsNumericos, { empresaId, comandaId, taxas, total: resumo.total })` — a cortesia R$0 do fechamento novo passa a vir daí também (remover a lógica local equivalente).
4. **Taxas da empresa**: estado `taxas` carregado como na Task 1 (se a Task 1 já fez, só usar).
5. **Edição de comanda fechada** (`abrirComandaFechada` ~512, `editarComanda` ~655):
   - `agItems` só dos agendamentos com `ag.comanda_id === comandaId` (hoje mistura comandas da mesma cliente no dia);
   - carregar `desconto, desconto_reserva` da comanda e preencher `descontoEntrada` com `desconto − desconto_reserva` em modo `'valor'` (hoje zera);
   - itens `produto` e campos de quantidade ficam só leitura em modo edição (sem remover produto, sem mudar quantidade; valor de serviço continua editável) — `comandaExistenteId` como condição;
   - `editarComanda` grava `pagamentos` com `montarPagamentos` (aplica cortesia R$0 automática) e continua conferindo todos os erros (já confere).
6. Toda mensagem de erro de gravação nova via `mensagemErroBanco(erro, 'fechar a comanda')` / `'salvar a comanda'`.

- [ ] **Step 1: Teste que falha**

```ts
// web/tests/unit/comanda-a-paridade.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('comanda web pela regra única', () => {
  const src = ler('web/app/(app)/comanda/page.tsx');
  it('usa calcularDesconto, resumoComanda e montarPagamentos', () => {
    for (const f of ['calcularDesconto(', 'resumoComanda(', 'montarPagamentos(']) expect(src).toContain(f);
    expect(src).toContain("from '@shared/comanda-fechamento'");
  });
  it('desconto com seletor % / R$', () => {
    expect(src).toContain("'percentual'");
    expect(src).toContain("'valor'");
  });
  it('botão Fechar depende de resumo.podeFechar', () => {
    expect(src).toContain('resumo.podeFechar');
  });
  it('edição só da comanda escolhida', () => {
    expect(src).toMatch(/comanda_id === comandaId/);
  });
  it('taxas vêm de shared (arquivo antigo removido)', () => {
    expect(existsSync(join(root, 'web/lib/taxas-cartao.ts'))).toBe(false);
    expect(src).toContain("from '@shared/taxas-cartao'");
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar as 6 mudanças.
- [ ] **Step 4:** teste + `cd web && npx tsc --noEmit` + `cd web && npx vitest run` (testes antigos de comanda que leem o fonte: atualizar para a forma nova sem afrouxar o que protegem — ex.: fechamento duplicado, persistência de valores, cortesia).
- [ ] **Step 5: Commit** — `fix(comanda/web): regra unica de fechamento, desconto %/R$ e edicao sem misturar comandas`.

---

### Task 5: App — comanda pela regra única

**Files:**
- Modify: `mobile/app/(empresa)/nova-comanda.tsx`
- Test: acrescentar em `web/tests/unit/comanda-a-paridade.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `agruparValoresPorAgendamento` (`shared/comanda.ts`, ver como o web usa em `persistirValoresAgendamento` — `web/app/(app)/comanda/page.tsx:592-634`); `mensagemErroBanco`.

Mudanças:
1. **Pagamento com cartão**: ao escolher Crédito/Débito, seletor de bandeira (mesmas bandeiras do web: `BANDEIRAS` em `web/app/(app)/comanda/page.tsx:117` — mover a lista para `shared/comanda-fechamento.ts` como `BANDEIRAS_CARTAO` e usar nas duas telas) e, em Crédito, parcelas (`OPCOES_PARCELAS`), com a taxa (`fmtTaxa(calcTaxa(...))`) visível como no web.
2. **Desconto %/R$**: seletor igual ao web (some sem `pode('comanda.desconto')`), `calcularDesconto` + erro exibido.
3. **Resumo/Fechar**: `resumoComanda` (como na Task 4, item 2); botão Fechar desabilitado com `!resumo.podeFechar`, mostrando `resumo.motivo`, "Falta" e "Troco" (já existe UI de restante ~999-1006 — passar a usar `resumo`); `fecharComanda` também retorna cedo se `!resumo.podeFechar`.
4. **Taxas da empresa**: carregar `empresas` com `select('*')` e `taxasDaEmpresa` (estado inicial `TAXAS_PADRAO`).
5. **Valor cobrado no atendimento**: o UPDATE de agendamentos (~405-431) passa a gravar também `valor` (total do grupo) e, antes, `agendamento_servicos.valor` por linha, usando `agruparValoresPorAgendamento(itens, pacoteLinksFinal)` — mesma lógica de `persistirValoresAgendamento` do web (inclusive `.select('id')` + checagem de 0 linhas e `.eq('empresa_id', empresaId)`), mantendo o vínculo de pacote no MESMO update do status (comentários atuais explicam o porquê).
6. **Erros conferidos**: `comanda_itens` (~435), `vendas`/`venda_itens` de produtos (~458-471), `pagamentos` (~523) passam a conferir `error`; estoque continua avisando (já avisa). Na primeira falha: `Alert.alert('Erro', \`${mensagemErroBanco(erro, 'fechar a comanda')} (etapa: <nome da etapa>)\`)`, `setFechando(false)`, recarregar a lista do dia, e NÃO mostrar a tela de sucesso.
7. **Pagamentos**: `montarPagamentos(...)` (substitui a montagem local + cortesia ~514-525).

- [ ] **Step 1: Teste que falha** (acrescentar):

```ts
describe('comanda app pela regra única', () => {
  const src = ler('mobile/app/(empresa)/nova-comanda.tsx');
  it('usa as mesmas funções do web', () => {
    for (const f of ['calcularDesconto(', 'resumoComanda(', 'montarPagamentos(', 'agruparValoresPorAgendamento(', 'taxasDaEmpresa(']) expect(src).toContain(f);
  });
  it('não fecha sem cobrir o total', () => {
    expect(src).toContain('resumo.podeFechar');
  });
  it('bandeiras e parcelas vindas de shared', () => {
    expect(src).toContain('BANDEIRAS_CARTAO');
    expect(src).toContain('OPCOES_PARCELAS');
  });
  it('confere erro de comanda_itens, vendas e pagamentos', () => {
    expect(src).toMatch(/from\('comanda_itens'\)\.insert\([\s\S]{0,400}?error/);
    expect(src).toMatch(/from\('pagamentos'\)\.insert\([\s\S]{0,200}?error/);
  });
  it('updates de agendamentos filtrados pela empresa', () => {
    const updates = src.match(/from\('agendamentos'\)\s*\.update\([\s\S]{0,300}?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(u).toContain(".eq('empresa_id'");
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar as 7 mudanças (e mover `BANDEIRAS`/`BAND_LABELS` do web para `shared/comanda-fechamento.ts`, atualizando o web).
- [ ] **Step 4:** teste + `cd mobile && npx tsc --noEmit` (baseline) + `cd web && npx tsc --noEmit` + `cd web && npx vitest run`.
- [ ] **Step 5: Commit** — `fix(comanda/app): fechamento pela regra unica, cartao com bandeira/parcelas/taxa e erros conferidos`.

---

### Task 6: Documentação e revisão final

**Files:** `CLAUDE.md`, spec (status)

- [ ] **Step 1:** `cd web && npx tsc --noEmit && npx vitest run`; `cd mobile && npx tsc --noEmit` (baseline).
- [ ] **Step 2:** revisão final de branch (opus): dinheiro de ponta a ponta nas duas plataformas (desconto, total, taxa de reserva, pacote, troco, cortesia, pagamentos e líquido), igualdade web × app para os mesmos itens, edição de comanda fechada, ordem/atomicidade das gravações e mensagens de falha.
- [ ] **Step 3:** CLAUDE.md — sessão "2026-10-08 — Comanda A (fechamento correto)" no formato das anteriores; pendência: aplicar `084_taxas_cartao_empresa.sql` no SQL Editor do projeto `qpiepxolyqmoankeyeva` (link `https://supabase.com/dashboard/project/qpiepxolyqmoankeyeva/sql/new`).
- [ ] **Step 4: Commit** — `docs: auditoria da comanda A`.
