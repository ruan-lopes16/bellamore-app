# Despesas recorrentes: definir término por quantidade de parcelas

## Contexto

Despesas recorrentes já têm um campo "Repetir até" (`recorrencia_ate`, date
opcional) que o usuário preenche digitando uma data — feature entregue numa
sessão anterior (`docs/superpowers/specs/2026-08-07-despesas-recorrencia-ate-design.md`).
O auto-lançamento mensal (web) já usa esse campo para parar de sugerir a
despesa quando a recorrência termina.

Pedido do usuário: em vez de calcular manualmente até quando um
financiamento/parcelamento vai, poder informar a quantidade total de
parcelas (e, se o registro começar no meio de um contrato já em andamento,
em qual parcela está agora) — o sistema calcula a data de término sozinho.

## Decisão aprovada

No campo "Repetir até", visível apenas quando periodicidade = mensal (única
periodicidade com auto-lançamento hoje — sem isso, o contador de parcelas
nunca atualizaria sozinho), dois botões alternam o modo de preenchimento:

- **Por data** (comportamento atual, inalterado): digita a data diretamente.
- **Por quantidade de parcelas**: informa o total de parcelas do contrato e
  se o registro é de um contrato novo ou já em andamento; o sistema calcula
  `recorrencia_ate` a partir disso.

`Data de vencimento` continua sendo seu próprio campo, sempre pedido,
independente do modo escolhido no "Repetir até" — nenhuma mudança aí.

Diferente do toggle "Já foi cobrada?" da taxa de reserva (só na criação),
os campos de quantidade de parcelas ficam disponíveis tanto ao criar quanto
ao editar a despesa — dono/gestor pode ajustar depois (corrigir o total, a
parcela atual, etc.). Já protegido pela RLS existente de `despesas`
(`despesas: gestor pode atualizar`, migration 003) — sem migration nova de
permissão.

## 1. Modo "Por quantidade de parcelas"

Campos exibidos:
- **Quantidade de parcelas** (número inteiro, total do contrato — ex: 12).
- **Novo** / **Já em andamento** (toggle). Se "Já em andamento": campo
  adicional **Parcela atual** (ex: 5 — a parcela cujo vencimento está sendo
  cadastrado agora). Se "Novo", parcela atual = 1 implicitamente.

Cálculo de `recorrencia_ate` (data de vencimento da última parcela):

```
meses_restantes = quantidade_parcelas − parcela_atual
recorrencia_ate = data_vencimento + meses_restantes meses
                  (clamp de dia: dia 31 em fevereiro → último dia do mês,
                  mesmo padrão já usado no auto-lançamento em lancarRecorrentes())
```

Exemplo do pedido original: 12 parcelas, cadastro como "já em andamento" na
parcela 5, vencimento 13/08/2026 → faltam 7 meses → `recorrencia_ate` =
13/03/2027 (vencimento da 12ª parcela).

Função pura testável em `shared/despesas.ts`:

```ts
export function calcularRecorrenciaAtePorParcelas(
  dataVencimento: string,
  totalParcelas: number,
  parcelaAtual: number,
): string {
  const mesesRestantes = totalParcelas - parcelaAtual;
  const [ano, mes, dia] = dataVencimento.split('-').map(Number);
  const anoAlvo = ano + Math.floor((mes - 1 + mesesRestantes) / 12);
  const mesAlvo = (mes - 1 + mesesRestantes) % 12;
  const ultimoDia = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  const diaAlvo = Math.min(dia, ultimoDia);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${anoAlvo}-${pad(mesAlvo + 1)}-${pad(diaAlvo)}`;
}
```

## 2. Dados

Duas colunas novas em `despesas`, nullable — só preenchidas quando o modo
"por quantidade" é usado:

```sql
alter table public.despesas
  add column parcela_atual integer,
  add column total_parcelas integer;
```

Sem coluna nova para o "modo" escolhido (por data / por quantidade) — é só
um estado de UI no momento do preenchimento; o que fica salvo é sempre
`recorrencia_ate` (já existente) mais, opcionalmente, `parcela_atual` e
`total_parcelas` para exibição e para o contador mensal.

## 3. Exibição na listagem

Quando `total_parcelas` está preenchido, a linha da despesa (web e mobile)
ganha "· Parcela {parcela_atual} de {total_parcelas}", no mesmo padrão de
concatenação já usado para "· Recorrente".

## 4. Auto-lançamento (web)

`lancarRecorrentes()` já copia `recorrencia_ate` do template para a nova
despesa do mês (comportamento inalterado — continua sendo o que decide
quando parar, via `recorrenciaAindaAtiva`, já testado). Passa a também
copiar `total_parcelas` e incrementar `parcela_atual` em +1:

```
total_parcelas: template.total_parcelas ?? null,
parcela_atual:  template.total_parcelas != null && template.parcela_atual != null
                  ? template.parcela_atual + 1
                  : null,
```

Sem lógica extra de "parar ao chegar na última parcela" — isso já é
garantido pelo `recorrencia_ate` existente, calculado para bater
exatamente com o vencimento da última parcela.

A query que busca o histórico de templates mensais (`recMesAnt`) passa a
selecionar também `parcela_atual` e `total_parcelas`.

## 5. UI — Web e Mobile

Mesmos quatro pontos já tocados na feature de `recorrencia_ate`:
- Web: `NovaDespesaModal` e `EditarDespesaModal` em
  `web/app/(app)/financeiro/page.tsx`.
- Mobile: `nova-despesa.tsx` e `ModalEditarDespesa` em
  `mobile/app/(empresa)/financeiro.tsx`.

Em todos os quatro: o campo "Repetir até" (só quando periodicidade =
mensal) ganha os dois botões de modo; no modo "por quantidade", os campos
descritos na seção 1 substituem o input de data enquanto esse modo estiver
selecionado. Ao salvar, `recorrencia_ate` é calculado via
`calcularRecorrenciaAtePorParcelas` e gravado normalmente — o resto do
fluxo de salvar despesa não muda.

## Fora de escopo

- Modo "por quantidade de parcelas" para periodicidades diferentes de
  mensal (semanal, trimestral, semestral, anual) — o contador não
  atualizaria sozinho sem auto-lançamento nessas periodicidades.
- Migrar despesas recorrentes já existentes (criadas só com data) para
  ganhar `parcela_atual`/`total_parcelas` retroativamente — ficam sem esses
  dois campos até serem editadas manualmente, se o usuário quiser.
- Impedir editar `parcela_atual` para um valor maior que `total_parcelas` —
  campo de número simples, sem validação cruzada adicional (mesma filosofia
  já usada para `recorrencia_ate`/`data_vencimento` na feature anterior).
- Qualquer mudança de permissão — já coberto pela RLS existente de
  `despesas`.

## Verificação

- Teste unitário para `calcularRecorrenciaAtePorParcelas`: contrato novo
  (parcela 1 de 12); contrato em andamento (parcela 5 de 12, exemplo do
  pedido original: 13/08/2026 → 13/03/2027); clamp de dia (dia 31 caindo em
  fevereiro); última parcela (parcela atual = total, meses restantes = 0).
- `npx tsc --noEmit` no web e no mobile.
- Verificação visual não é possível nesta sessão (sem conta de teste) —
  como já registrado nas sessões anteriores.
