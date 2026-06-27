# Camada 3 — Operação: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir atrito operacional: recibo de comanda compartilhável, observação na agenda, bandeira+parcelas no histórico de pagamentos, toasts em exclusões, e validação de split.

**Architecture:** Todas as mudanças são em Client Components existentes. Nenhuma nova tabela. Usa o `navigator.clipboard` para compartilhamento de recibo.

**Tech Stack:** Next.js (App Router), Supabase, TypeScript, Tailwind CSS, lucide-react

## Global Constraints

- Branch: `feat/melhorias-operacao` criada a partir de `main`
- Commits em pt-BR
- `npx tsc --noEmit` sem erros

---

### Task 1: Criar branch

- [ ] **Step 1:**

```bash
git checkout main && git pull origin main
git checkout -b feat/melhorias-operacao
```

---

### Task 2: Comanda — recibo compartilhável

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`

- [ ] **Step 1: Criar função `gerarRecibo`**

Na seção de funções do componente, adicione:
```typescript
function gerarRecibo(
  cliente: { nome: string },
  itens: ComandaItem[],
  splits: Split[],
  desconto: number,
  total: number,
): string {
  const linhas: string[] = [];
  linhas.push(`🧾 *Comanda — ${cliente.nome}*`);
  linhas.push(`_${format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}_`);
  linhas.push('');
  linhas.push('*Serviços / Produtos*');
  itens.forEach(it => {
    const v = (it.valor_unit * it.quantidade).toFixed(2).replace('.', ',');
    linhas.push(`• ${it.descricao} × ${it.quantidade} — R$ ${v}`);
  });
  if (desconto > 0) {
    linhas.push(`• Desconto — R$ ${desconto.toFixed(2).replace('.', ',')}`);
  }
  linhas.push('');
  linhas.push(`*Total: R$ ${total.toFixed(2).replace('.', ',')}*`);
  linhas.push('');
  linhas.push('*Pagamento*');
  splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0).forEach(s => {
    const label: Record<string, string> = {
      dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', cortesia: 'Cortesia',
    };
    const parc = s.parcelas && s.parcelas > 1 ? ` ${s.parcelas}×` : '';
    const band = s.bandeira ? ` (${s.bandeira})` : '';
    linhas.push(`• ${label[s.metodo] ?? s.metodo}${band}${parc} — R$ ${s.valor}`);
  });
  return linhas.join('\n');
}
```

- [ ] **Step 2: Adicionar estado `reciboCopiadoId`**

```typescript
const [reciboCopiadoId, setReciboCopiadoId] = useState<string | null>(null);
```

- [ ] **Step 3: Adicionar botão "Compartilhar recibo" na comanda fechada**

Localize onde a comanda fechada é renderizada (próximo ao status "Fechada"). Adicione o botão:
```tsx
<button
  onClick={async () => {
    if (!clienteSel || !itensComanda) return;
    const texto = gerarRecibo(
      clienteSel,
      itensComanda,
      splits,
      desconto ? parseFloat(desconto.replace(',', '.')) : 0,
      totalComanda,
    );
    await navigator.clipboard.writeText(texto);
    setReciboCopiadoId(clienteSel.id);
    setTimeout(() => setReciboCopiadoId(null), 2500);
  }}
  className="flex items-center gap-2 px-4 h-9 rounded-xl border border-border text-sm font-semibold text-text-2 hover:bg-bg transition"
>
  {reciboCopiadoId === clienteSel?.id
    ? <><Check size={14} className="text-green"/><span className="text-green">Copiado!</span></>
    : <><Share2 size={14}/> Compartilhar recibo</>
  }
</button>
```

Importe `Share2` e `Check` de `lucide-react`.

- [ ] **Step 4: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/comanda/page.tsx
git commit -m "feat: botão de compartilhar recibo da comanda via clipboard"
```

---

### Task 3: Comanda — validação de split antes de fechar

**Files:**
- Modify: `web/app/(app)/comanda/page.tsx`

- [ ] **Step 1: Calcular diferença entre split e total**

Na seção de cálculos derivados, adicione:
```typescript
const totalSplit = splits.reduce((s, sp) => s + parseFloat(sp.valor.replace(',', '.') || '0'), 0);
const splitDivergente = Math.abs(totalSplit - totalComanda) > 0.01 && totalSplit > 0;
```

- [ ] **Step 2: Desabilitar botão "Fechar comanda" quando há divergência**

Localize o botão de fechar comanda. Adicione a prop `disabled` e mensagem de aviso:
```tsx
{splitDivergente && (
  <p className="text-xs text-rose text-center">
    Split (R$ {totalSplit.toFixed(2).replace('.', ',')}) diferente do total (R$ {totalComanda.toFixed(2).replace('.', ',')})
  </p>
)}
<button
  onClick={fecharComanda}
  disabled={fechando || splitDivergente}
  className="... disabled:opacity-50 disabled:cursor-not-allowed"
>
  {fechando ? 'Fechando...' : 'Fechar comanda'}
</button>
```

- [ ] **Step 3: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/comanda/page.tsx
git commit -m "feat: bloquear fechar comanda quando split diverge do total"
```

---

### Task 4: Agenda — observação visível no card de agendamento

**Files:**
- Modify: `web/app/(app)/agenda/page.tsx`

- [ ] **Step 1: Garantir que `observacao` é buscado na query de agendamentos**

Localize a query `.select(...)` que busca agendamentos na agenda. Adicione `observacao` ao select se não estiver:
```typescript
.select('id, status, valor, data_hora_inicio, data_hora_fim, observacao, servico:servicos(nome), ...')
```

- [ ] **Step 2: Exibir `observacao` no card/linha do agendamento**

Localize o componente/elemento que renderiza cada agendamento na timeline. Após o nome do serviço, adicione:
```tsx
{ag.observacao && (
  <p className="text-xs text-text-4 italic truncate mt-0.5">{ag.observacao}</p>
)}
```

- [ ] **Step 3: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/agenda/page.tsx
git commit -m "feat: agenda exibe observação do agendamento no card"
```

---

### Task 5: Financeiro — bandeira, parcelas e taxa no histórico de pagamentos

**Files:**
- Modify: `web/app/(app)/financeiro/page.tsx`

- [ ] **Step 1: Adicionar campos à query de pagamentos (lista de despesas já mostra pagamentos?)**

Localize onde os pagamentos por método são exibidos (seção de "Formas de pagamento"). A query já inclui `metodo, valor`. Adicione `bandeira, parcelas, taxa_perc, valor_liquido`:
```typescript
supabase.from('pagamentos').select('metodo, valor, valor_liquido, taxa_perc, bandeira, parcelas')
  .eq('empresa_id', empId).eq('status', 'pago')
  .gte('created_at', ini).lte('created_at', fim),
```

- [ ] **Step 2: Atualizar o tipo `MetodoPag` para incluir detalhes**

```typescript
type PagDetalhe = {
  metodo: string; valor: number; bandeira?: string | null;
  parcelas?: number | null; taxa_perc?: number | null; valor_liquido?: number | null;
};
```

- [ ] **Step 3: Exibir bandeira e parcelas no breakdown de pagamentos**

Localize o render da seção de "Formas de pagamento". Após o valor de cada método, mostre os detalhes agregados (bandeira mais usada, parcelas médias):
```tsx
{/* Dentro do card de cada método de pagamento */}
<div className="flex items-center justify-between">
  <span className="text-sm font-bold text-text">{fmtBRL(m.valor)}</span>
  <span className="text-xs text-text-4">{m.quantidade} pgto{m.quantidade > 1 ? 's' : ''}</span>
</div>
```

Para crédito, exibir sub-detalhe de taxa média:
```tsx
{m.metodo === 'credito' && taxaMedia > 0 && (
  <p className="text-xs text-text-4 mt-1">Taxa média: {(taxaMedia * 100).toFixed(2)}%</p>
)}
```

- [ ] **Step 4: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/financeiro/page.tsx
git commit -m "feat: financeiro exibe bandeira, parcelas e taxa média no breakdown de pagamentos"
```

---

### Task 6: Toasts de confirmação em exclusões críticas

**Files:**
- Modify: `web/app/(app)/servicos/page.tsx`
- Modify: `web/app/(app)/estoque/page.tsx`
- Modify: `web/app/(app)/clientes/page.tsx`

O projeto usa `toast` (verificar se já existe algum sistema de toast, ex: react-hot-toast ou similar). Se não existir, usar um estado local simples.

- [ ] **Step 1: Verificar qual sistema de toast existe no projeto**

```bash
cd web && grep -r "toast\|sonner\|hot-toast" package.json
```

Se não existir, criar componente `Toast` simples ou usar `alert()` como fallback temporário.

- [ ] **Step 2: Adicionar toast em exclusão de serviço**

Em `servicos/page.tsx`, localize a função de exclusão. Após o `supabase.from('servicos').delete()` bem-sucedido, adicione:
```typescript
// Após exclusão bem-sucedida:
setToastMsg('Serviço excluído com sucesso.');
setTimeout(() => setToastMsg(''), 2500);
```

Adicione estado `const [toastMsg, setToastMsg] = useState('')` e render:
```tsx
{toastMsg && (
  <div className="fixed bottom-4 right-4 z-50 bg-surface border border-border rounded-xl shadow-lg px-4 py-3 text-sm font-semibold text-text flex items-center gap-2">
    <CheckCircle2 size={16} className="text-green"/> {toastMsg}
  </div>
)}
```

- [ ] **Step 3: Repetir para exclusão em estoque e clientes**

Mesma lógica em `estoque/page.tsx` e `clientes/page.tsx`.

- [ ] **Step 4: TypeScript check e commit**

```bash
cd web && npx tsc --noEmit
git add web/app/\(app\)/servicos/page.tsx web/app/\(app\)/estoque/page.tsx web/app/\(app\)/clientes/page.tsx
git commit -m "feat: toast de confirmação após exclusão de serviço, produto e cliente"
```

---

### Task 7: Criar PR para feat/melhorias-operacao

- [ ] **Step 1: Push e PR**

```bash
git push -u origin feat/melhorias-operacao
gh pr create \
  --title "feat: operação — recibo, validação split, observação agenda, toasts" \
  --base main \
  --body "## O que muda\n- Comanda: botão 'Compartilhar recibo' gera texto para WhatsApp\n- Comanda: split divergente bloqueia o botão 'Fechar'\n- Agenda: observação visível no card de cada agendamento\n- Financeiro: bandeira e parcelas no breakdown de pagamentos\n- Toasts de confirmação em exclusões de serviço, produto e cliente"
```
