# Camada 2 — Retenção de Clientes: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enriquecer o perfil do cliente, alertar sobre clientes inativos, mostrar aniversariantes e deduzir sessões de pacotes automaticamente.

**Architecture:** Todas as mudanças são adições em cima das tabelas existentes. Pacotes usam `pacote_clientes` e `pacote_uso` (migrations 010/011). Dashboard usa Server Component. Clientes/[id] usa Client Component.

**Tech Stack:** Next.js (App Router — Dashboard é Server Component, Clientes é Client Component), Supabase, TypeScript, Tailwind CSS

## Global Constraints

- Branch: `feat/retencao-clientes` criada a partir de `main` (após merge de feat/receita-real)
- Commits em pt-BR
- `npx tsc --noEmit` sem erros

---

### Task 1: Criar branch

- [ ] **Step 1:**

```bash
git checkout main && git pull origin main
git checkout -b feat/retencao-clientes
```

---

### Task 2: Perfil do cliente — bloco de resumo estatístico

**Files:**
- Modify: `web/app/(app)/clientes/[id]/page.tsx`

- [ ] **Step 1: Adicionar tipo `ClienteStats` e novos estados**

No topo do arquivo, após os tipos existentes, adicione:
```typescript
type ClienteStats = {
  totalGasto:      number;
  totalVisitas:    number;
  ultimaVisita:    string | null;
  servicoFavorito: string | null;
};
```

No corpo do componente, adicione os estados:
```typescript
const [stats, setStats] = useState<ClienteStats | null>(null);
```

- [ ] **Step 2: Buscar estatísticas do cliente**

Na função de carregamento do cliente (onde já há queries para histórico de agendamentos), adicione a query de stats em paralelo. Localize o `Promise.all` existente e adicione:
```typescript
supabase.from('agendamentos')
  .select('valor, data_hora_inicio, servico:servicos(nome)')
  .eq('empresa_id', empresaId)
  .eq('cliente_id', clienteId)
  .eq('status', 'concluido')
  .order('data_hora_inicio', { ascending: false }),
```

Processe o resultado:
```typescript
const agsStats = (statsData.data ?? []) as { valor: number; data_hora_inicio: string; servico: { nome: string } | null }[];
const svcCount: Record<string, number> = {};
agsStats.forEach(a => {
  const nome = a.servico?.nome ?? 'Serviço';
  svcCount[nome] = (svcCount[nome] ?? 0) + 1;
});
const favorito = Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
setStats({
  totalGasto:      agsStats.reduce((s, a) => s + Number(a.valor), 0),
  totalVisitas:    agsStats.length,
  ultimaVisita:    agsStats[0]?.data_hora_inicio ?? null,
  servicoFavorito: favorito,
});
```

- [ ] **Step 3: Renderizar bloco de estatísticas no JSX**

Localize onde o nome e dados do cliente são exibidos. Logo abaixo do cabeçalho do perfil, antes das abas, insira:
```tsx
{stats && (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
    {[
      { label: 'Total gasto',      value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(stats.totalGasto) },
      { label: 'Visitas',          value: String(stats.totalVisitas) },
      { label: 'Última visita',    value: stats.ultimaVisita ? format(parseISO(stats.ultimaVisita), 'd MMM yyyy', { locale: ptBR }) : '—' },
      { label: 'Serviço favorito', value: stats.servicoFavorito ?? '—' },
    ].map(({ label, value }) => (
      <div key={label} className="bg-surface border border-border rounded-xl p-3 text-center">
        <p className="text-xs text-text-4 uppercase tracking-wide font-semibold mb-1">{label}</p>
        <p className="text-sm font-bold text-text truncate">{value}</p>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/clientes/\[id\]/page.tsx
git commit -m "feat: perfil do cliente exibe total gasto, visitas e serviço favorito"
```

---

### Task 3: Dashboard — Clientes inativos + Aniversariantes

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`

O Dashboard é um Server Component — as queries são feitas no corpo da função.

- [ ] **Step 1: Adicionar queries de inativos e aniversariantes no `Promise.all`**

Após as queries existentes, adicione (ainda dentro do `Promise.all`):
```typescript
// Clientes inativos (último agendamento concluído há mais de 45 dias)
supabase.from('clientes')
  .select('id, nome, telefone')
  .eq('empresa_id', empresaId)
  .eq('ativo', true)
  .limit(5),
// Aniversariantes hoje e nos próximos 7 dias
supabase.from('clientes')
  .select('id, nome, telefone, data_nascimento')
  .eq('empresa_id', empresaId)
  .eq('ativo', true)
  .not('data_nascimento', 'is', null),
```

- [ ] **Step 2: Processar inativos**

Após o `Promise.all`, adicione:
```typescript
// Clientes inativos: último agendamento concluído há > 45 dias
const hoje45 = new Date(Date.now() - 45 * 86400000);
const { data: ultimosAgs } = await supabase
  .from('agendamentos')
  .select('cliente_id, data_hora_inicio')
  .eq('empresa_id', empresaId)
  .eq('status', 'concluido')
  .gte('data_hora_inicio', startOfMonth(subMonths(hoje, 6)).toISOString())
  .order('data_hora_inicio', { ascending: false });

const ultimoPorCliente: Record<string, Date> = {};
(ultimosAgs ?? []).forEach((a: { cliente_id: string | null; data_hora_inicio: string }) => {
  if (!a.cliente_id) return;
  if (!ultimoPorCliente[a.cliente_id]) {
    ultimoPorCliente[a.cliente_id] = new Date(a.data_hora_inicio);
  }
});

type ClienteRow = { id: string; nome: string; telefone: string | null };
const inativos: (ClienteRow & { diasSemVir: number })[] = (todosClientes.data ?? [])
  .filter((c: ClienteRow) => {
    const ultimo = ultimoPorCliente[c.id];
    return ultimo && ultimo < hoje45;
  })
  .map((c: ClienteRow) => ({
    ...c,
    diasSemVir: Math.floor((Date.now() - (ultimoPorCliente[c.id]?.getTime() ?? 0)) / 86400000),
  }))
  .sort((a, b) => b.diasSemVir - a.diasSemVir)
  .slice(0, 5);
```

- [ ] **Step 3: Processar aniversariantes**

```typescript
const hoje = new Date();
const hojeMMDD  = `${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
const limite7   = new Date(Date.now() + 7 * 86400000);
const lim7MMDD  = `${String(limite7.getMonth() + 1).padStart(2, '0')}-${String(limite7.getDate()).padStart(2, '0')}`;

type ClienteAniv = { id: string; nome: string; telefone: string | null; data_nascimento: string };
const aniversariantes = ((anivData.data ?? []) as ClienteAniv[])
  .filter(c => {
    const mmdd = c.data_nascimento.slice(5, 10); // "MM-DD"
    return mmdd >= hojeMMDD && mmdd <= lim7MMDD;
  })
  .slice(0, 5);
```

- [ ] **Step 4: Renderizar cards no JSX do Dashboard**

Após o último card existente no Dashboard, adicione dois novos cards:

```tsx
{/* Clientes inativos */}
{inativos.length > 0 && (
  <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
    <div className="flex items-center gap-2 mb-4">
      <AlertTriangle size={16} className="text-amber" strokeWidth={2}/>
      <h3 className="font-semibold text-sm text-text">Clientes inativos</h3>
      <span className="ml-auto text-xs text-text-4">&gt; 45 dias sem visita</span>
    </div>
    <ul className="flex flex-col gap-2">
      {inativos.map(c => (
        <li key={c.id} className="flex items-center justify-between gap-3">
          <Link href={`/clientes/${c.id}`} className="text-sm font-semibold text-text hover:text-primary transition truncate">
            {c.nome}
          </Link>
          <span className="text-xs text-text-4 flex-shrink-0">{c.diasSemVir}d atrás</span>
        </li>
      ))}
    </ul>
  </div>
)}

{/* Aniversariantes */}
{aniversariantes.length > 0 && (
  <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
    <div className="flex items-center gap-2 mb-4">
      <span className="text-base">🎂</span>
      <h3 className="font-semibold text-sm text-text">Aniversariantes</h3>
      <span className="ml-auto text-xs text-text-4">próximos 7 dias</span>
    </div>
    <ul className="flex flex-col gap-2">
      {aniversariantes.map(c => (
        <li key={c.id} className="flex items-center justify-between gap-3">
          <Link href={`/clientes/${c.id}`} className="text-sm font-semibold text-text hover:text-primary transition truncate">
            {c.nome}
          </Link>
          <span className="text-xs text-text-4 flex-shrink-0">
            {format(parseISO(c.data_nascimento.slice(0,10) + 'T12:00:00'), 'd MMM', { locale: ptBR })}
          </span>
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 5: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/dashboard/page.tsx
git commit -m "feat: dashboard exibe clientes inativos e aniversariantes da semana"
```

---

### Task 4: Pacotes — auto-dedução de sessão ao concluir agendamento

**Files:**
- Create: `supabase/migrations/029_trigger_pacote_auto_deducao.sql`
- Modify: `web/app/(app)/comanda/page.tsx`

- [ ] **Step 1: Criar migration de trigger de auto-dedução**

Conteúdo de `supabase/migrations/029_trigger_pacote_auto_deducao.sql`:

```sql
-- Migration 029: deduz automaticamente uma sessão de pacote ativo
-- quando um agendamento é marcado como 'concluido'

create or replace function deduzir_sessao_pacote()
returns trigger as $$
declare
  v_pacote_cliente_id uuid;
  v_uso_count         integer;
  v_total_sessoes     integer;
begin
  if NEW.status = 'concluido' and OLD.status != 'concluido' then
    -- Buscar pacote ativo do cliente que inclui este serviço
    select pc.id, pc.sessoes_totais
      into v_pacote_cliente_id, v_total_sessoes
    from public.pacote_clientes pc
    join public.pacote_servicos ps on ps.pacote_id = pc.pacote_id
    where pc.cliente_id = NEW.cliente_id
      and pc.empresa_id = NEW.empresa_id
      and ps.servico_id = NEW.servico_id
      and pc.status = 'ativo'
      and (pc.validade_ate is null or pc.validade_ate >= now())
    order by pc.created_at
    limit 1;

    if v_pacote_cliente_id is not null then
      -- Contar usos já registrados
      select count(*) into v_uso_count
      from public.pacote_uso
      where pacote_cliente_id = v_pacote_cliente_id;

      -- Registrar uso
      insert into public.pacote_uso (pacote_cliente_id, agendamento_id, empresa_id)
      values (v_pacote_cliente_id, NEW.id, NEW.empresa_id);

      -- Se atingiu total de sessões, marcar como concluído
      if (v_uso_count + 1) >= v_total_sessoes then
        update public.pacote_clientes
        set status = 'concluido'
        where id = v_pacote_cliente_id;
      end if;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_deduzir_sessao_pacote on public.agendamentos;

create trigger trg_deduzir_sessao_pacote
  after update on public.agendamentos
  for each row execute function deduzir_sessao_pacote();
```

- [ ] **Step 2: Verificar se `pacote_clientes` tem coluna `sessoes_totais`**

Consulte as migrations 010 e 011. Se a coluna não existir, adicione ao início da migration 029:
```sql
alter table public.pacote_clientes
  add column if not exists sessoes_totais integer not null default 1,
  add column if not exists status text not null default 'ativo',
  add column if not exists validade_ate date;
```

- [ ] **Step 3: Commitar migration**

```bash
git add supabase/migrations/029_trigger_pacote_auto_deducao.sql
git commit -m "feat: trigger de auto-dedução de sessão de pacote ao concluir agendamento"
```

---

### Task 5: Criar PR para feat/retencao-clientes

- [ ] **Step 1: Push e PR**

```bash
git push -u origin feat/retencao-clientes
gh pr create \
  --title "feat: retenção — perfil rico, clientes inativos, aniversariantes, pacotes" \
  --base main \
  --body "## O que muda\n- Perfil do cliente: total gasto, nº de visitas, última visita, serviço favorito\n- Dashboard: card de clientes inativos (45+ dias) e aniversariantes (próximos 7 dias)\n- Trigger de auto-dedução de sessão de pacote ao concluir agendamento\n\n## Como testar\n- Abrir perfil de cliente → verificar bloco de estatísticas\n- Dashboard → verificar cards de inativos e aniversariantes\n- Concluir agendamento de cliente com pacote ativo → verificar sessão deduzida"
```
