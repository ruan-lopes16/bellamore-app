# Camada 4 — Crescimento: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Features de crescimento: avaliação pós-atendimento, segmentação de clientes (VIP/Em risco/Novos), meta de faturamento no Dashboard e relatório de lucratividade por serviço.

**Architecture:** Avaliação requer nova tabela `avaliacoes` (migration). Meta de faturamento armazenada em `empresas.meta_mensal` (nova coluna). Segmentação é query client-side sobre dados existentes. Lucratividade usa `servico_produtos` já existente.

**Tech Stack:** Next.js (App Router), Supabase, TypeScript, Tailwind CSS

## Global Constraints

- Branch: `feat/crescimento` criada a partir de `main`
- Commits em pt-BR
- `npx tsc --noEmit` sem erros

---

### Task 1: Criar branch

- [ ] **Step 1:**

```bash
git checkout main && git pull origin main
git checkout -b feat/crescimento
```

---

### Task 2: Migration — tabela de avaliações + meta mensal

**Files:**
- Create: `supabase/migrations/030_avaliacoes_meta.sql`

- [ ] **Step 1: Criar migration**

```sql
-- Migration 030: tabela de avaliações pós-atendimento + meta mensal por empresa

-- 1. Avaliações
create table public.avaliacoes (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  agendamento_id   uuid not null references public.agendamentos(id) on delete cascade,
  cliente_id       uuid references public.clientes(id) on delete set null,
  profissional_id  uuid references public.users(id) on delete set null,
  nota             smallint not null check (nota between 1 and 5),
  comentario       text,
  created_at       timestamptz default now(),
  unique (agendamento_id)
);

alter table public.avaliacoes enable row level security;

create policy "avaliacoes: membro gerencia"
  on public.avaliacoes for all
  using   (empresa_id in (select minha_empresas()))
  with check (empresa_id in (select minha_empresas()));

-- 2. Meta mensal por empresa
alter table public.empresas
  add column if not exists meta_mensal numeric(10,2);
```

- [ ] **Step 2: Commitar**

```bash
git add supabase/migrations/030_avaliacoes_meta.sql
git commit -m "feat: migration 030 — tabela avaliacoes e coluna meta_mensal em empresas"
```

---

### Task 3: Avaliação pós-atendimento na Agenda

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

- [ ] **Step 1: Adicionar tipo e estado para avaliação pendente**

```typescript
type AvaliacaoPendente = {
  agendamentoId: string;
  clienteNome: string;
  profissionalId: string | null;
  clienteId: string | null;
};

const [avalPendente, setAvalPendente] = useState<AvaliacaoPendente | null>(null);
const [avalNota, setAvalNota] = useState(0);
const [avalComentario, setAvalComentario] = useState('');
const [salvandoAval, setSalvandoAval] = useState(false);
```

- [ ] **Step 2: Disparar modal de avaliação ao concluir agendamento**

Localize a função que muda o status do agendamento para 'concluido'. Após o update bem-sucedido, adicione:
```typescript
if (novoStatus === 'concluido') {
  setAvalPendente({
    agendamentoId: ag.id,
    clienteNome: ag.cliente?.nome ?? 'Cliente',
    profissionalId: ag.profissional_id ?? null,
    clienteId: ag.cliente_id ?? null,
  });
  setAvalNota(0);
  setAvalComentario('');
}
```

- [ ] **Step 3: Criar modal de avaliação**

```tsx
{avalPendente && (
  <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAvalPendente(null)}/>
    <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
      <h2 className="font-serif text-xl text-text">Avaliação — {avalPendente.clienteNome}</h2>
      <p className="text-sm text-text-3">Como foi o atendimento?</p>
      {/* Estrelas */}
      <div className="flex gap-2 justify-center">
        {[1,2,3,4,5].map(n => (
          <button key={n} onClick={() => setAvalNota(n)}
            className={`text-2xl transition ${n <= avalNota ? 'text-amber' : 'text-border'}`}>
            ★
          </button>
        ))}
      </div>
      {/* Comentário */}
      <textarea
        value={avalComentario}
        onChange={e => setAvalComentario(e.target.value)}
        placeholder="Comentário opcional..."
        rows={3}
        className="w-full px-3.5 py-3 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent resize-none"
      />
      <div className="flex gap-3">
        <button onClick={() => setAvalPendente(null)}
          className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
          Pular
        </button>
        <button
          disabled={avalNota === 0 || salvandoAval}
          onClick={async () => {
            if (avalNota === 0 || !empresaId) return;
            setSalvandoAval(true);
            await supabase.from('avaliacoes').insert({
              empresa_id:      empresaId,
              agendamento_id:  avalPendente.agendamentoId,
              cliente_id:      avalPendente.clienteId,
              profissional_id: avalPendente.profissionalId,
              nota:            avalNota,
              comentario:      avalComentario.trim() || null,
            });
            setSalvandoAval(false);
            setAvalPendente(null);
          }}
          className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
          {salvandoAval ? 'Salvando...' : 'Salvar avaliação'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/agenda/page.tsx
git commit -m "feat: modal de avaliação pós-atendimento ao concluir agendamento"
```

---

### Task 4: Relatórios — avaliação média por profissional e lucratividade por serviço

**Files:**
- Modify: `web/app/(app)/relatorios/page.tsx`

- [ ] **Step 1: Adicionar query de avaliações ao Promise.all**

```typescript
supabase.from('avaliacoes')
  .select('nota, profissional_id, profissional:users(nome)')
  .eq('empresa_id', empId)
  .gte('created_at', inicio.toISOString()).lte('created_at', fim.toISOString()),
```

- [ ] **Step 2: Calcular média por profissional**

```typescript
const notasPorProf = useMemo(() => {
  const map: Record<string, { nome: string; soma: number; qtd: number }> = {};
  (avaliacoes ?? []).forEach((a: { nota: number; profissional_id: string | null; profissional: { nome: string } | null }) => {
    if (!a.profissional_id) return;
    if (!map[a.profissional_id]) map[a.profissional_id] = { nome: a.profissional?.nome ?? 'Profissional', soma: 0, qtd: 0 };
    map[a.profissional_id].soma += a.nota;
    map[a.profissional_id].qtd++;
  });
  return Object.values(map).map(p => ({ ...p, media: p.soma / p.qtd })).sort((a, b) => b.media - a.media);
}, [avaliacoes]);
```

- [ ] **Step 3: Adicionar query de custo de insumos por serviço (lucratividade)**

```typescript
supabase.from('servico_produtos')
  .select('servico_id, quantidade, produto:produtos(preco_custo)')
  .eq('empresa_id', empId),
```

- [ ] **Step 4: Calcular margem por serviço**

```typescript
const margemPorServico = useMemo(() => {
  type SpRow = { servico_id: string; quantidade: number; produto: { preco_custo: number } | null };
  const custoPorSvc: Record<string, number> = {};
  (servicoProdutos ?? []).forEach((sp: SpRow) => {
    custoPorSvc[sp.servico_id] = (custoPorSvc[sp.servico_id] ?? 0) + sp.quantidade * (sp.produto?.preco_custo ?? 0);
  });
  return rankServicos.map(s => ({
    ...s,
    custoInsumos: custoPorSvc[s.id ?? ''] ?? 0,
    margem: s.valor - (custoPorSvc[s.id ?? ''] ?? 0) * s.qtd,
  })).sort((a, b) => b.margem - a.margem);
}, [rankServicos, servicoProdutos]);
```

- [ ] **Step 5: Renderizar nova aba "Lucratividade" em Relatórios**

Adicione `lucratividade` às abas existentes:
```typescript
const ABA_OPTS = [
  ...abasExistentes,
  { key: 'lucratividade' as const, label: 'Lucratividade', icon: TrendingUp },
];
```

Na seção de conteúdo, adicione o case:
```tsx
{aba === 'lucratividade' && (
  <div className="flex flex-col gap-3">
    <h3 className="text-sm font-semibold text-text-2 uppercase tracking-wide">Margem por serviço</h3>
    {margemPorServico.map((s, i) => (
      <div key={i} className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text truncate">{s.nome}</p>
          <p className="text-xs text-text-4">{s.qtd} atendimentos · custo R$ {fmtBRL(s.custoInsumos * s.qtd)}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-sm font-bold ${s.margem >= 0 ? 'text-green' : 'text-red'}`}>{fmtBRL(s.margem)}</p>
          <p className="text-xs text-text-4">margem</p>
        </div>
      </div>
    ))}
    {notasPorProf.length > 0 && (
      <>
        <h3 className="text-sm font-semibold text-text-2 uppercase tracking-wide mt-4">Avaliação por profissional</h3>
        {notasPorProf.map((p, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-text">{p.nome}</p>
            <div className="flex items-center gap-1">
              <span className="text-amber">{'★'.repeat(Math.round(p.media))}</span>
              <span className="text-xs text-text-4 ml-1">{p.media.toFixed(1)} ({p.qtd} aval.)</span>
            </div>
          </div>
        ))}
      </>
    )}
  </div>
)}
```

- [ ] **Step 6: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/relatorios/page.tsx
git commit -m "feat: relatórios com lucratividade por serviço e avaliação média por profissional"
```

---

### Task 5: Dashboard — meta de faturamento mensal

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`
- Modify: `web/app/(app)/configuracoes/page.tsx`

- [ ] **Step 1: Buscar `meta_mensal` da empresa no Dashboard (Server Component)**

Na query de empresa ou em uma query separada, adicione:
```typescript
const { data: empresaData } = await supabase
  .from('empresas')
  .select('meta_mensal')
  .eq('id', empresaId)
  .single();
const metaMensal = Number(empresaData?.meta_mensal ?? 0);
```

- [ ] **Step 2: Calcular progresso e renderizar barra**

```typescript
const progressoMeta = metaMensal > 0 ? Math.min((receitaMes / metaMensal) * 100, 100) : 0;
```

No JSX, após os KPIs principais:
```tsx
{metaMensal > 0 && (
  <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
    <div className="flex items-center justify-between mb-3">
      <p className="text-xs text-text-4 uppercase tracking-wide font-semibold">Meta do mês</p>
      <p className="text-xs font-bold text-text-2">{Math.round(progressoMeta)}%</p>
    </div>
    <div className="h-2 bg-border rounded-full overflow-hidden mb-2">
      <div
        className={`h-full rounded-full transition-all ${progressoMeta >= 100 ? 'bg-green' : 'bg-primary'}`}
        style={{ width: `${progressoMeta}%` }}
      />
    </div>
    <p className="text-sm font-bold text-text">
      {fmt(receitaMes)} <span className="text-text-4 font-normal text-xs">de {fmt(metaMensal)}</span>
    </p>
  </div>
)}
```

- [ ] **Step 3: Adicionar campo de meta em Configurações**

Em `configuracoes/page.tsx`, na seção de dados da empresa, adicione campo para editar `meta_mensal`:
```tsx
<div>
  <label className={labelClass}>Meta de faturamento mensal (R$)</label>
  <input
    value={metaMensalInput}
    onChange={e => setMetaMensalInput(e.target.value)}
    inputMode="decimal"
    placeholder="0,00"
    className={inputClass}
  />
</div>
```

No save, inclua `meta_mensal: parseFloat(metaMensalInput.replace(',', '.')) || null`.

- [ ] **Step 4: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/dashboard/page.tsx web/app/\(app\)/configuracoes/page.tsx
git commit -m "feat: meta de faturamento mensal no dashboard com barra de progresso"
```

---

### Task 6: Clientes — aba de segmentação (VIP / Em risco / Novos)

**Files:**
- Modify: `web/app/(app)/clientes/page.tsx`

- [ ] **Step 1: Adicionar queries de segmentação**

Na função de carregamento, adicione a query de últimos agendamentos por cliente:
```typescript
const { data: ultimosAgsPorCliente } = await supabase
  .from('agendamentos')
  .select('cliente_id, valor, data_hora_inicio')
  .eq('empresa_id', empresaId)
  .eq('status', 'concluido')
  .gte('data_hora_inicio', startOfMonth(subMonths(new Date(), 3)).toISOString());
```

- [ ] **Step 2: Calcular segmentos client-side**

```typescript
const segmentos = useMemo(() => {
  const hoje = new Date();
  const gastosPorCliente: Record<string, { total: number; ultimo: Date; count: number }> = {};

  (ultimosAgs ?? []).forEach((a: { cliente_id: string | null; valor: number; data_hora_inicio: string }) => {
    if (!a.cliente_id) return;
    if (!gastosPorCliente[a.cliente_id]) gastosPorCliente[a.cliente_id] = { total: 0, ultimo: new Date(0), count: 0 };
    gastosPorCliente[a.cliente_id].total += Number(a.valor);
    const d = new Date(a.data_hora_inicio);
    if (d > gastosPorCliente[a.cliente_id].ultimo) gastosPorCliente[a.cliente_id].ultimo = d;
    gastosPorCliente[a.cliente_id].count++;
  });

  const todos = Object.entries(gastosPorCliente).map(([id, g]) => ({ id, ...g }));
  const sorted = [...todos].sort((a, b) => b.total - a.total);
  const vipCutoff = sorted[Math.floor(sorted.length * 0.2)]?.total ?? Infinity;

  const vip       = clientes.filter(c => (gastosPorCliente[c.id]?.total ?? 0) >= vipCutoff && vipCutoff > 0);
  const emRisco   = clientes.filter(c => {
    const g = gastosPorCliente[c.id];
    return g && g.count >= 2 && (hoje.getTime() - g.ultimo.getTime()) > 60 * 86400000;
  });
  const novos90   = clientes.filter(c => {
    const criado = new Date(c.created_at);
    return (hoje.getTime() - criado.getTime()) <= 30 * 86400000;
  });

  return { vip, emRisco, novos: novos90 };
}, [clientes, ultimosAgs]);
```

- [ ] **Step 3: Adicionar aba "Segmentos" na tela de Clientes**

Adicione ao array de abas:
```tsx
{ key: 'segmentos', label: `Segmentos` },
```

Conteúdo da aba:
```tsx
{aba === 'segmentos' && (
  <div className="flex flex-col gap-6">
    {[
      { titulo: '⭐ VIP', desc: 'Top 20% por receita (últimos 90 dias)', lista: segmentos.vip, cor: 'text-amber' },
      { titulo: '⚠️ Em risco', desc: '2+ visitas, sem aparecer há 60+ dias', lista: segmentos.emRisco, cor: 'text-rose' },
      { titulo: '🆕 Novos', desc: 'Cadastrados nos últimos 30 dias', lista: segmentos.novos, cor: 'text-green' },
    ].map(({ titulo, desc, lista, cor }) => (
      <div key={titulo}>
        <div className="flex items-center gap-2 mb-3">
          <h3 className={`text-sm font-bold ${cor}`}>{titulo}</h3>
          <span className="text-xs text-text-4">— {desc} · {lista.length} cliente{lista.length !== 1 ? 's' : ''}</span>
        </div>
        {lista.length === 0
          ? <p className="text-sm text-text-4 italic">Nenhum cliente neste segmento.</p>
          : (
            <div className="flex flex-col gap-2">
              {lista.slice(0, 10).map(c => (
                <button key={c.id} onClick={() => router.push(`/clientes/${c.id}`)}
                  className="flex items-center justify-between px-4 py-3 bg-surface border border-border rounded-xl hover:border-accent transition text-left">
                  <span className="text-sm font-semibold text-text">{c.nome}</span>
                  <ChevronRight size={14} className="text-text-4"/>
                </button>
              ))}
            </div>
          )
        }
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/clientes/page.tsx
git commit -m "feat: aba de segmentação de clientes — VIP, Em risco, Novos"
```

---

### Task 7: Criar PR para feat/crescimento

- [ ] **Step 1: Push e PR**

```bash
git push -u origin feat/crescimento
gh pr create \
  --title "feat: crescimento — avaliações, segmentação, meta mensal, lucratividade" \
  --base main \
  --body "## O que muda\n- Avaliação pós-atendimento (1–5 estrelas) ao concluir agendamento\n- Relatórios: lucratividade por serviço e avaliação média por profissional\n- Dashboard: barra de progresso da meta de faturamento mensal\n- Configurações: campo para definir meta mensal\n- Clientes: aba 'Segmentos' com VIP, Em risco e Novos\n\n## Como testar\n- Concluir agendamento → modal de avaliação aparece\n- Relatórios → aba Lucratividade mostra margem por serviço\n- Configurações → definir meta → Dashboard exibe barra de progresso\n- Clientes → aba Segmentos mostra agrupamentos automáticos"
```
