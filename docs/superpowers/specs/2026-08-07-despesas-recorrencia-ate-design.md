# Despesas recorrentes: data de término opcional

## Contexto

Despesas recorrentes existem na tabela `despesas` via `recorrente`, `periodicidade`
e `data_vencimento`. No web, a página Financeiro identifica o template mensal
mais recente de cada despesa recorrente (chave composta `descricao+categoria`)
e sugere lançar o mês atual via banner "lançar agora" (`lancarRecorrentes` em
`web/app/(app)/financeiro/page.tsx`). Essa recorrência hoje não tem fim: uma
vez marcada recorrente, é sugerida indefinidamente.

## Decisão aprovada

Adicionar um campo opcional de data de término da recorrência. Quando
preenchido, o auto-lançamento mensal continua sugerindo a despesa até o mês em
que a data cai (inclusive); a partir do mês seguinte, para de sugerir.
Sem data preenchida, o comportamento é o de hoje (recorrência sem fim).

Sem indicador visual extra de "recorrência encerrada" na listagem — fora de
escopo por decisão do usuário.

## Dados

Nova coluna em `despesas`, migration `056_despesas_recorrencia_ate.sql`:

```sql
alter table public.despesas
  add column recorrencia_ate date;
```

Nullable, sem CHECK constraint — mesma filosofia de `periodicidade`, que hoje
também não é reforçada a nível de banco como dependente de `recorrente`. Sem
mudança de RLS (política existente de `despesas` já cobre updates/inserts por
gestor/owner).

## Lógica compartilhada

Nova função pura em `shared/despesas.ts`:

```ts
export function recorrenciaAindaAtiva(
  recorrenciaAte: string | null | undefined,
  periodoInicioIso: string,
): boolean {
  if (!recorrenciaAte) return true;
  return recorrenciaAte >= periodoInicioIso;
}
```

Comparação lexicográfica de strings `YYYY-MM-DD`, mesmo padrão já usado nos
filtros de data do Financeiro (`periodo.startDate`). Testável isoladamente.

## Auto-lançamento (web)

Em `carregar()`, a query que busca o histórico de templates mensais
(`recMesAnt`) passa a selecionar também `recorrencia_ate` (sem mudança nos
filtros SQL existentes).

Ao montar `recorrentesParaLancar` — loop que agrupa por chave composta
(`descricao+categoria`), mantendo o template mais recente por chave — cada
registro passa primeiro por `recorrenciaAindaAtiva(r.recorrencia_ate,
periodo.startDate)`; se `false`, o registro é ignorado (não entra em
`porChave`) e portanto não é sugerido para lançamento naquele mês.

Em `lancarRecorrentes()`, o insert passa a copiar `recorrencia_ate` do
template para a nova despesa, para a checagem continuar válida nos meses
seguintes até a data limite.

## UI — Web

Em `NovaDespesaModal` e `EditarDespesaModal`
(`web/app/(app)/financeiro/page.tsx`), um novo campo de data "Repetir até
(opcional)" aparece logo abaixo dos botões de periodicidade, apenas quando
"Despesa recorrente" está marcado. Ao desmarcar recorrente, o campo some e o
valor salvo é `null` (mesmo padrão já usado para `periodicidade`).

Tipo `Despesa` e `RecorrenteTemplate` ganham `recorrencia_ate?: string`.

## UI — Mobile

Mesmo campo, mesma posição (abaixo da periodicidade, visível só quando
recorrente = true), em:
- `mobile/app/(empresa)/nova-despesa.tsx` (criação)
- `ModalEditarDespesa` em `mobile/app/(empresa)/financeiro.tsx` (edição)

Input de data usando o padrão já existente nesses arquivos para
`data_vencimento` (mesmo componente/estilo). Tipo `Despesa` em
`mobile/types/index.ts` ganha `recorrencia_ate?: string`.

O mobile não ganha auto-lançamento — isso continua exclusivo do web (decisão
já registrada na spec de 2026-07-08). O campo no mobile serve para
cadastrar/editar a data, que é lida pelo auto-lançamento do web.

## Fora de escopo

- Indicador visual de "recorrência encerrada" na listagem web ou mobile.
- Auto-lançamento de recorrentes no mobile.
- Validação cruzada entre `recorrencia_ate` e `data_vencimento` (ex.: impedir
  data de término anterior ao vencimento). Campo de data simples, sem regras
  adicionais.
- Notificar o usuário quando uma recorrência está prestes a terminar.

## Verificação

- Teste unitário para `recorrenciaAindaAtiva` (sem data → true; data futura ou
  igual ao início do período → true; data passada → false).
- `npx tsc --noEmit` no web e no mobile.
- Teste manual: criar despesa recorrente mensal com `recorrencia_ate` no mês
  atual, avançar o mês visualizado no Financeiro (web) e confirmar que o
  banner de auto-lançamento não sugere mais essa despesa.
- Auditoria de qualidade conforme `CLAUDE.md`.
