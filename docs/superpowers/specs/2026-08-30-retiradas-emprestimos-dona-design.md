# Retiradas e empréstimos da dona

## Contexto

Hoje o app não tem nenhuma forma de registrar a dona (owner) tirando dinheiro do
estúdio. Ela precisa de duas coisas, decididas no brainstorming:

1. **Empréstimo** — o estúdio "empresta" e ela devolve depois, à vista/avulso ou
   com cronograma de parcelas. Gera um saldo devedor. Não é gasto.
2. **Retirada definitiva** — ela tira parte do lucro para uso pessoal, sem gerar
   dívida. Precisa aparecer para o lucro não parecer inflado, mas **fora** do
   "Lucro real" (que continua sendo o lucro operacional).

Um único fluxo de "Registrar" escolhe o tipo na hora. Recurso exclusivo da dona
(owner) — não vale para profissionais no v1.

Local na UI: seção própria dentro do Financeiro, ao lado de Despesas / Taxas de
Cancelamento / Taxas de Reserva (mesmo padrão de blocos empilhados, web e mobile).

## Garantia de não regressão

**Nada aqui altera dado ou cálculo existente.**

- Migration só **adiciona** um enum novo e duas tabelas novas. Nenhuma tabela,
  coluna, política de RLS, trigger ou índice existente é alterado ou removido.
- O cálculo de `lucro` / "Lucro real" / "Lucro do mês" em Dashboard, Relatórios e
  Financeiro **não muda** — nenhuma query de `despesas`, `pagamentos`,
  `agendamentos`, `vendas`, `comissoes` ou taxas é tocada. As linhas novas
  ("Retiradas da dona", "Resultado após retiradas") são **aditivas** e calculadas
  a partir das tabelas novas.
- Empréstimo, devolução e retirada **nunca** entram em receita nem em despesa.
- Saldo devedor, "quitado", "parcela X de Y" e "atrasada" são **derivados na
  exibição** a partir das devoluções — nada de estado derivado gravado, mesmo
  princípio de `calcularParcelaDerivada` em `shared/despesas.ts`.
- Para quem **não é owner** (gestor/profissional), as tabelas novas retornam zero
  linhas por RLS **e** a UI não renderiza a seção nem as linhas novas — decisão de
  design, não "R$ 0" silencioso.

## Modelo de dados

Migration `supabase/migrations/063_retiradas_socia.sql`.

```sql
create type retirada_socia_tipo as enum ('emprestimo', 'retirada');

create table public.retiradas_socia (
  id                  uuid primary key default uuid_generate_v4(),
  empresa_id          uuid not null references public.empresas(id) on delete cascade,
  tipo                retirada_socia_tipo not null,
  valor               numeric(10,2) not null check (valor > 0),
  data                date not null default current_date,   -- quando o dinheiro saiu
  descricao           text,
  metodo              public.pagamento_metodo,              -- opcional: de onde saiu o dinheiro
  -- cronograma (só quando tipo='emprestimo' e parcelado=true)
  parcelado           boolean not null default false,
  total_parcelas      int  check (total_parcelas is null or total_parcelas >= 2),
  valor_parcela       numeric(10,2) check (valor_parcela is null or valor_parcela > 0),
  primeira_parcela_em date,
  -- "ela decidiu não devolver o que falta"
  convertido_em       date,
  criado_por          uuid references public.users(id),
  created_at          timestamptz default now()
);

create table public.retiradas_socia_devolucoes (
  id           uuid primary key default uuid_generate_v4(),
  retirada_id  uuid not null references public.retiradas_socia(id) on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  valor        numeric(10,2) not null check (valor > 0),
  data         date not null default current_date,
  metodo       public.pagamento_metodo,
  created_at   timestamptz default now()
);

create index idx_retiradas_socia_empresa_data on public.retiradas_socia(empresa_id, data);
create index idx_retiradas_socia_dev_retirada on public.retiradas_socia_devolucoes(retirada_id);
```

Reaproveita o enum `public.pagamento_metodo` existente (`dinheiro`, `pix`,
`credito`, `debito`, `cortesia`) — mesmo padrão da migration 062. `metodo` é
opcional nos dois sentidos (retroativo e daqui pra frente), igual às taxas.

### Valores derivados (nunca gravados)

| Derivado | Fórmula |
|---|---|
| `devolvido` | Σ `retiradas_socia_devolucoes.valor` da retirada |
| `saldo` | `max(0, valor − devolvido)` — só empréstimo |
| `quitado` | empréstimo com `saldo ≤ 0` **ou** `convertido_em` preenchido |

## Semântica financeira

**"Lucro real" / "Lucro do mês" NÃO muda.** Continua sendo o lucro operacional.

Dois agregados novos, calculados **somente quando o usuário atual é a dona
(owner)** — `empresas.owner_id === auth.uid()`:

### A) Retiradas do período → linha "(−) Retiradas da dona"

```
retiradasPeriodo =
    Σ valor                onde tipo='retirada'   e  data ∈ [início, fim]
  + Σ (valor − devolvido)  onde tipo='emprestimo' e  convertido_em ∈ [início, fim]
```

- **Relatórios:** KPI `Lucro real` intacto + KPI novo **`Resultado após retiradas`**
  = `lucro − retiradasPeriodo`; linha "Retiradas da dona" no detalhamento; entra
  no export PDF/XLSX.
- **Dashboard:** KPI `Lucro do mês` intacto + sub-linha **`Após retiradas: R$ Y`**
  (só se `retiradasPeriodo > 0`).

### B) Saldo devedor da dona → card "A dona deve ao estúdio"

Histórico total, **não** preso ao mês selecionado:

```
saldoDevedorTotal = Σ (valor − devolvido)
                    onde tipo='emprestimo' e convertido_em is null
```

- **Financeiro:** card no topo da seção nova — "A dona deve ao estúdio: **R$ X**"
  (some se 0).
- **Dashboard:** card/linha "Empréstimos da dona em aberto: **R$ X**" (só se
  `> 0` e owner). Incluir no v1 — a dona decide se corta depois de ver a PR.

### Fora de escopo, explícito

Não existe "saldo em caixa" acumulado no app e **não será criado**. Esses dois
números são toda a pegada da feature nos relatórios.

## UI — seção "Retiradas da dona" no Financeiro

Bloco `<section>` depois de "Taxas de Reserva", mesmo padrão visual dos blocos que
já existem lá (web: `web/app/(app)/financeiro/page.tsx`; mobile:
`mobile/app/(empresa)/financeiro.tsx`, linhas ~1620+). **Só renderiza se
`isOwner`.**

### Cabeçalho da seção

Título + botão "Registrar" · resumo "A dona deve: **R$ X**" (saldo devedor total) ·
"Retiradas definitivas no mês: **R$ Y**".

### Lista (mês selecionado pelo seletor que a página já tem, mais recente primeiro)

Cada linha:
- Badge do tipo (Empréstimo / Retirada), valor, data, descrição, método.
- Empréstimo: barra "Devolvido R$ a / R$ total" + saldo; se parcelado,
  "Parcela n/N" + chip **"atrasada"** quando aplicável; se convertido, chip
  "Convertido em retirada (dd/mm)".
- Ações: **Registrar devolução** (empréstimo aberto), **Converter saldo em
  retirada** (empréstimo aberto), **Editar**, **Excluir**.

### Modal "Registrar" (novo)

- Toggle **Empréstimo / Retirada** — mesmo padrão visual dos chips de
  periodicidade das despesas.
- Valor (máscara BRL), Data (default hoje), Descrição (opcional), Método
  (opcional, reusa `METODO_CFG` / `METODO_CONFIG` já existente no arquivo).
- Se **Empréstimo**: toggle **"Devolução avulsa" / "Em parcelas"**.
  - Em parcelas → Nº de parcelas (≥ 2), Valor da parcela (auto = `valor / nº`,
    editável; diferença de centavos vai para a última parcela), 1ª parcela em
    (default: mesmo dia do mês seguinte). Periodicidade mensal fixa no v1.
- Bloqueia salvar com mensagem se: `valor ≤ 0`; parcelado sem nº ou sem 1ª
  parcela — mesmo padrão dos pontos de validação de despesas parceladas.

### Modal "Registrar devolução"

Valor (default = valor da parcela se parcelado e houver saldo, senão o saldo
inteiro), Data (hoje), Método (opcional). Devolução acima do saldo é aceita, o
saldo faz **clamp em 0** com aviso "isso quita e sobra R$ z".

### Modal "Editar"

Edita valor / data / descrição / método; para empréstimo parcelado, edita nº /
valor da parcela / 1ª parcela. **Não permite trocar `tipo`** depois de criado —
para mudar de ideia, exclui e recria, ou usa "Converter".

### Excluir

Confirmação. `on delete cascade` leva as devoluções junto.

### Converter empréstimo em retirada

Ação "Converter saldo em retirada definitiva" → define `convertido_em = <data>`.
O `saldo` em aberto naquela data passa a contar como **retirada definitiva no
período da conversão** (nada retroativo). `tipo` continua `'emprestimo'` no banco
— o histórico fica legível ("foi empréstimo, devolveu parte, o resto virou
retirada"). Depois de convertido, some das ações de devolução.

### Mobile

`mobile/app/(empresa)/financeiro.tsx` ganha a mesma seção; tela
`mobile/app/(empresa)/nova-retirada.tsx` no padrão de `nova-despesa.tsx` (ou modal
inline — seguir o que o arquivo já faz para despesas).

## Relatórios / Dashboard — mudanças

| Arquivo | Mudança |
|---|---|
| `web/app/(app)/relatorios/page.tsx` | query nova (owner) + KPI "Resultado após retiradas" + linha no detalhamento + export |
| `web/app/(app)/dashboard/page.tsx` | queries no `Promise.all` guardadas por owner + sub-linha "Após retiradas" + card opcional |
| `mobile/hooks/useFinanceiro.ts` + dashboard/relatórios mobile | paridade onde a tela já mostra lucro |

`Lucro real` / `Lucro do mês` continuam idênticos em todas as telas.

## RLS

Ambas as tabelas: **owner-only** (mais restrito que `despesas`, que libera gestor).

```sql
alter table public.retiradas_socia enable row level security;
alter table public.retiradas_socia_devolucoes enable row level security;

create policy "retiradas_socia: owner full" on public.retiradas_socia
  for all
  using  (exists (select 1 from public.empresas e
                  where e.id = empresa_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.empresas e
                  where e.id = empresa_id and e.owner_id = auth.uid()));

create policy "retiradas_socia_devolucoes: owner full" on public.retiradas_socia_devolucoes
  for all
  using  (exists (select 1 from public.empresas e
                  where e.id = empresa_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.empresas e
                  where e.id = empresa_id and e.owner_id = auth.uid()));
```

Consequência (decisão de design, não bug): gestor não lê essas linhas. A seção no
Financeiro, a linha "Retiradas da dona" nos Relatórios e o card "deve" **não são
renderizados** para não-owner (guarda `isOwner` no cliente). Todo `.insert()` /
`.update()` nessas tabelas leva `.select()` junto, para uma falha de permissão
aparecer em vez de "sucesso" mudo — mesma lição de `marcarReservaPaga`.

## Casos de borda

- Devolução > saldo → aceita, saldo clamp 0, avisa.
- Empréstimo quitado → some "devolução"/"converter", mostra chip "Quitado".
- Converter empréstimo parcialmente devolvido → só o saldo restante vira retirada,
  na data da conversão; devoluções passadas continuam válidas.
- Empréstimo criado num mês e convertido em outro → conta nas retiradas do **mês
  da conversão**.
- Parcela atrasada: `parcelasQuitadas = floor(devolvido / valor_parcela)`; a
  parcela `parcelasQuitadas + 1` está atrasada se
  `hoje > primeira_parcela_em + parcelasQuitadas meses`. Conta meses decorridos
  (robusto a meses pulados), não incrementa fixo — mesma lição do contador
  "Parcela X de Y" de despesas.
- Data futura no registro → permitida, conta pela `data` (consistente com
  despesas).
- Mês sem registros → estado vazio na seção; `retiradasPeriodo = 0`, "Resultado
  após retiradas" iguala o lucro.

## Testes

`shared/retiradas-socia.ts` — helpers puros com JSDoc pt-BR, testados em
`web/tests/unit/retiradas-socia.test.ts`:

| Helper | Cobre |
|---|---|
| `saldoEmprestimo(valor, devolucoes)` | zero devoluções, quitação exata, pagamento a mais (clamp) |
| `retiradasNoPeriodo(rows, devsPorRetirada, ini, fim)` | retiradas + empréstimos convertidos, fora do período |
| `saldoDevedorTotal(rows, devsPorRetirada)` | só empréstimos abertos, ignora convertidos e quitados |
| `statusParcela(valorParcela, primeiraParcelaEm, devolvido, hoje)` | meses pulados, nº=2, valor não divisível, atraso, tudo quitado |

Aritmética de dinheiro em centavos inteiros (não ponto flutuante) para a divisão
de parcelas — mesma lição de `dividirValorCompra`.

Migration: verificar que gestor enxerga 0 linhas e owner enxerga tudo.
`npx tsc --noEmit` zerado no web; mobile mantém os ~10 erros pré-existentes,
nenhum novo.

## Fora de escopo (YAGNI) no v1

Vale/adiantamento para profissionais · desconto automático em comissão/pró-labore
de terceiros · saldo em caixa acumulado · juros sobre o empréstimo · parcela
não-mensal · fluxo de aprovação multiusuário · notificação de parcela vencendo
(possível fast-follow).

## Arquivos

**Novos:**
- `supabase/migrations/063_retiradas_socia.sql`
- `shared/retiradas-socia.ts`
- `web/tests/unit/retiradas-socia.test.ts`
- `mobile/app/(empresa)/nova-retirada.tsx`

**Alterados:**
- `web/app/(app)/financeiro/page.tsx` — seção + modais + queries
- `web/app/(app)/relatorios/page.tsx` — query + KPI + detalhamento + export
- `web/app/(app)/dashboard/page.tsx` — query + sub-linha + card opcional
- `web/types/index.ts` — `RetiradaSocia`, `RetiradaSociaDevolucao`
- `mobile/app/(empresa)/financeiro.tsx` — seção + modais
- `mobile/hooks/useFinanceiro.ts` — agregados novos
- dashboard/relatórios mobile — paridade onde mostram lucro
- `web/lib/export.ts` — só se precisar de coluna nova (provavelmente não)
