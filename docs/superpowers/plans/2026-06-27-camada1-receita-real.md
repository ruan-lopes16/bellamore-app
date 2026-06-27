# Camada 1 — Receita Real: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Financeiro e Relatórios mostrarem o líquido real após taxas de cartão, acionar notificações de estoque baixo por trigger, e commitar a migration 027.

**Architecture:** A tabela `pagamentos` já tem `valor_liquido` e `taxa_perc` (migration 026). Basta adicionar esses campos nas queries existentes de Financeiro e Relatórios, calcular a taxa total como `Σ(valor - valor_liquido)` e exibir como novo KPI. A notification trigger é uma nova migration SQL.

**Tech Stack:** Next.js (App Router), Supabase, TypeScript, Tailwind CSS

## Global Constraints

- Branch: `feat/receita-real` criada a partir de `feat/taxas-cartao`
- Todos os commits em pt-BR
- `npx tsc --noEmit` deve passar sem erros após cada task
- Não renomear variáveis existentes sem motivo — apenas adicionar

---

### Task 1: Criar branch e commitar migration 027

**Files:**
- Commit: `supabase/migrations/027_fix_user_delete_cascade.sql` (já existe, só precisa ser adicionado)

- [ ] **Step 1: Criar branch `feat/receita-real` a partir de `feat/taxas-cartao`**

```bash
git checkout -b feat/receita-real
```

- [ ] **Step 2: Commitar migration 027**

```bash
git add supabase/migrations/027_fix_user_delete_cascade.sql
git commit -m "feat: migration 027 — cascata de exclusão de usuários (SET NULL)"
```

---

### Task 2: Migration 028 — trigger de notificação de estoque baixo

**Files:**
- Create: `supabase/migrations/028_trigger_notif_estoque_baixo.sql`

- [ ] **Step 1: Criar arquivo da migration**

Conteúdo de `supabase/migrations/028_trigger_notif_estoque_baixo.sql`:

```sql
-- Migration 028: notificação automática quando estoque atinge mínimo
-- Dispara após qualquer INSERT em estoque_movimentos (saída ou ajuste que zera estoque)

create or replace function notificar_estoque_baixo()
returns trigger as $$
declare
  v_estoque_atual  numeric;
  v_estoque_minimo numeric;
  v_nome           text;
  v_empresa_id     uuid;
  v_owner_id       uuid;
begin
  -- Buscar estado atual do produto
  select p.estoque_atual, p.estoque_minimo, p.nome, p.empresa_id
    into v_estoque_atual, v_estoque_minimo, v_nome, v_empresa_id
  from public.produtos p
  where p.id = NEW.produto_id;

  -- Só notifica em saída ou ajuste que deixou abaixo do mínimo
  if (NEW.tipo in ('saida', 'ajuste')) and (v_estoque_atual <= v_estoque_minimo) then
    -- Buscar owner da empresa para receber a notificação
    select owner_id into v_owner_id from public.empresas where id = v_empresa_id;

    if v_owner_id is not null then
      insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
      values (
        v_owner_id,
        v_empresa_id,
        'estoque_baixo',
        'Estoque baixo: ' || v_nome,
        'Restam ' || round(v_estoque_atual, 2) || ' unidades. Mínimo configurado: ' || round(v_estoque_minimo, 2) || '.'
      );
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql security definer;

-- Remover trigger anterior se existir
drop trigger if exists trg_notif_estoque_baixo on public.estoque_movimentos;

create trigger trg_notif_estoque_baixo
  after insert on public.estoque_movimentos
  for each row execute function notificar_estoque_baixo();
```

- [ ] **Step 2: Commitar**

```bash
git add supabase/migrations/028_trigger_notif_estoque_baixo.sql
git commit -m "feat: trigger de notificação automática para estoque baixo"
```

---

### Task 3: Financeiro — KPIs com taxas de cartão

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

**O que muda:**
1. Query de pagamentos passa a incluir `valor_liquido`
2. Novos estados: `taxasCartao`, `taxasCartaoAnt`
3. Novo cálculo de `liquidoAposTaxas`
4. KPIs reorganizados: Bruto → Taxas Cartão → Líquido após Taxas | Comissões → Gastos → Lucro Real

- [ ] **Step 1: Adicionar `valor_liquido` na query de pagamentos (linha ~336)**

Encontre a query de pagamentos:
```typescript
supabase.from('pagamentos').select('metodo, valor')
  .eq('empresa_id', empId).eq('status', 'pago')
  .gte('created_at', ini).lte('created_at', fim),
```

Substitua por:
```typescript
supabase.from('pagamentos').select('metodo, valor, valor_liquido')
  .eq('empresa_id', empId).eq('status', 'pago')
  .gte('created_at', ini).lte('created_at', fim),
```

- [ ] **Step 2: Adicionar estados para taxas (seção de estados, ~linha 265)**

Após a linha `const [receita, setReceita] = useState(0);`, adicione:
```typescript
const [taxasCartao,    setTaxasCartao]    = useState(0);
const [taxasCartaoAnt, setTaxasCartaoAnt] = useState(0);
```

- [ ] **Step 3: Calcular taxas no bloco de processamento (após linha ~382)**

Após `setReceita(receitaVal); setReceitaAnt(receitaAntVal);`, adicione:

```typescript
type PagRow = { metodo: string; valor: number; valor_liquido: number | null };
const pagsData = (pagsMes.data ?? []) as PagRow[];
const taxasCartaoVal = pagsData.reduce((s, p) =>
  s + (p.valor_liquido != null ? Number(p.valor) - Number(p.valor_liquido) : 0), 0);
setTaxasCartao(taxasCartaoVal);
// Mês anterior: precisamos de uma query adicional para pagamentos do mês anterior
// Por ora: mantemos 0 no anterior (sem comparativo de taxa)
setTaxasCartaoAnt(0);
```

- [ ] **Step 4: Calcular `liquidoAposTaxas` (após linha ~488)**

Após `const liquido = receita - comissoes;`, adicione:
```typescript
const liquidoAposTaxas = receita - taxasCartao;
const dTaxas           = taxasCartao > 0 ? null : null; // sem comparativo ainda
```

- [ ] **Step 5: Reorganizar os KPIs no JSX (linha ~563)**

Substitua o bloco de KPIs:

```tsx
{/* Linha 1: Bruto | Taxas Cartão | Líquido após Taxas */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
  {[
    { label: 'Faturamento Bruto',     value: receita,          d: dReceita,   cor: 'text-green',   invertDelta: false },
    { label: 'Taxas de Cartão',       value: taxasCartao,      d: null,       cor: 'text-rose',    invertDelta: false },
    { label: 'Líquido após Taxas',    value: liquidoAposTaxas, d: null,       cor: 'text-primary', invertDelta: false },
  ].map(({ label, value, d, cor, invertDelta }) => (
    <div key={label} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
      <p className="text-xs text-text-4 uppercase tracking-wide font-semibold mb-2">{label}</p>
      <p className={`text-2xl font-bold leading-none mb-2 ${cor}`}>{fmtBRL(value)}</p>
      {d !== null && (
        <div className="flex items-center gap-1">
          {(invertDelta ? d < 0 : d >= 0)
            ? <TrendingUp  size={11} className="text-green" strokeWidth={2.5}/>
            : <TrendingDown size={11} className="text-red"  strokeWidth={2.5}/>
          }
          <span className={`text-xs font-bold ${(invertDelta ? d < 0 : d >= 0) ? 'text-green' : 'text-red'}`}>
            {d >= 0 ? '+' : ''}{d}% vs mês anterior
          </span>
        </div>
      )}
    </div>
  ))}
</div>
{/* Linha 2: Comissões | Gastos | Lucro Real */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
  {[
    { label: 'Comissões',        value: comissoes,            d: dComissoes, cor: 'text-amber', invertDelta: true  },
    { label: 'Gastos',           value: gastos,               d: dGastos,   cor: 'text-rose',  invertDelta: true  },
    { label: 'Lucro Real',       value: liquidoAposTaxas - comissoes - gastos, d: null, cor: (liquidoAposTaxas - comissoes - gastos) >= 0 ? 'text-primary' : 'text-red', invertDelta: false },
  ].map(({ label, value, d, cor, invertDelta }) => (
    <div key={label} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
      <p className="text-xs text-text-4 uppercase tracking-wide font-semibold mb-2">{label}</p>
      <p className={`text-2xl font-bold leading-none mb-2 ${cor}`}>{fmtBRL(value)}</p>
      {d !== null && (
        <div className="flex items-center gap-1">
          {(invertDelta ? d < 0 : d >= 0)
            ? <TrendingUp  size={11} className="text-green" strokeWidth={2.5}/>
            : <TrendingDown size={11} className="text-red"  strokeWidth={2.5}/>
          }
          <span className={`text-xs font-bold ${(invertDelta ? d < 0 : d >= 0) ? 'text-green' : 'text-red'}`}>
            {d >= 0 ? '+' : ''}{d}% vs mês anterior
          </span>
        </div>
      )}
    </div>
  ))}
</div>
```

- [ ] **Step 6: Atualizar o Skeleton de loading para refletir 3+3 cards**

Encontre o bloco de loading (~linha 546):
```tsx
<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
  {[1,2,3].map(i => (
```
Adicione logo abaixo dele (após o `</div>` que fecha o primeiro grid), um segundo grid idêntico:
```tsx
<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
  {[4,5,6].map(i => (
    <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
      <Sk className="h-3 w-1/3 mb-3 max-w-[100px]"/><Sk className="h-7 w-2/3 mb-3 max-w-[140px]"/><Sk className="h-3 w-1/2 max-w-[120px]"/>
    </div>
  ))}
</div>
```
E remova o grid de 2 colunas que existia para Gastos/Lucro.

- [ ] **Step 7: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit
```
Esperado: sem erros.

- [ ] **Step 8: Commitar**

```bash
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat: financeiro exibe taxas de cartão e líquido real separados"
```

---

### Task 4: Relatórios — adicionar linha de taxas de cartão nos KPIs

**Files:**
- Modify: `web/app/(app)/relatorios/page.tsx`

- [ ] **Step 1: Adicionar query de pagamentos ao `Promise.all` na função `carregar`**

Localize a função `carregar` em relatorios/page.tsx. No `Promise.all`, adicione (após a query de comissoes):
```typescript
supabase.from('pagamentos').select('valor, valor_liquido')
  .eq('empresa_id', empId).eq('status', 'pago')
  .gte('created_at', inicio.toISOString()).lte('created_at', fim.toISOString()),
```

Adicione o resultado ao destructuring (ex: `pagsRel`).

- [ ] **Step 2: Adicionar estado e cálculo de `taxasCartaoRel`**

Após o cálculo de `bruto`, adicione:
```typescript
const taxasCartaoRel = useMemo(() =>
  (pagsRel ?? []).reduce((s: number, p: { valor: number; valor_liquido: number | null }) =>
    s + (p.valor_liquido != null ? Number(p.valor) - Number(p.valor_liquido) : 0), 0),
[pagsRel]);
const liquidoAposTaxasRel = bruto - taxasCartaoRel;
```

- [ ] **Step 3: Adicionar KPI "Taxas de Cartão" nos cards de Relatórios**

Localize os `KpiCard` principais. Após o card de "Faturamento bruto", insira:
```tsx
<KpiCard icon={CreditCard} label="Taxas de cartão" value={fmtBRL(taxasCartaoRel)} cor="#DC2626" loading={loading} />
<KpiCard icon={TrendingUp} label="Líquido após taxas" value={fmtBRL(liquidoAposTaxasRel)} cor="#7C3AED" loading={loading} />
```

Importe `CreditCard` de `lucide-react` se ainda não importado.

- [ ] **Step 4: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 5: Commitar**

```bash
git add web/app/\(app\)/relatorios/page.tsx
git commit -m "feat: relatórios exibe taxas de cartão e líquido após taxas"
```

---

### Task 5: Criar PR para feat/receita-real

- [ ] **Step 1: Push da branch**

```bash
git push -u origin feat/receita-real
```

- [ ] **Step 2: Criar PR**

```bash
gh pr create \
  --title "feat: receita real — taxas de cartão no financeiro e notificações de estoque" \
  --base main \
  --body "## O que muda\n- Financeiro exibe Taxas de Cartão e Líquido após Taxas separados do bruto\n- Relatórios idem\n- Migration 027: cascata de exclusão de usuários\n- Migration 028: trigger de notificação automática de estoque baixo\n\n## Como testar\n- Abrir Financeiro → verificar 6 KPIs (3+3)\n- Fazer um pagamento no cartão na Comanda → verificar taxa aparece no Financeiro\n- Baixar estoque de um produto abaixo do mínimo → verificar sino de notificação"
```
