# Despesas recorrentes: data de término opcional + progresso de vencimento

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

## Progresso de vencimento ("quanto falta")

Pedido adicional do usuário, incorporado nesta mesma spec porque nada tinha
sido implementado ainda. Diferente da seção anterior: aplica-se a **qualquer**
despesa pendente com `data_vencimento` — recorrente ou avulsa — e não depende
de `recorrencia_ate`. Sem migration nova: usa colunas já existentes
(`created_at`, `data_vencimento`).

Cada despesa pendente com vencimento passa a mostrar quantos dias faltam (ou
o atraso) e uma barra fina que enche conforme o vencimento se aproxima. Acima
da lista, um resumo mostra o valor total pendente do mês e a quantidade de
despesas pendentes. Tudo é aditivo — nenhum texto, botão ou comportamento
existente é removido ou alterado.

### Cálculo (`shared/despesas.ts`)

Duas funções puras novas, ao lado de `recorrenciaAindaAtiva`:

```ts
export function diasParaVencimento(
  dataVencimento: string,
  hojeIso: string,
): number {
  const venc = new Date(dataVencimento + 'T00:00:00');
  const hoje = new Date(hojeIso + 'T00:00:00');
  return Math.round((venc.getTime() - hoje.getTime()) / 86_400_000);
}

export function progressoVencimento(
  criadaEmIso: string,
  dataVencimento: string,
  hojeIso: string,
): number {
  const inicio = new Date(criadaEmIso.slice(0, 10) + 'T00:00:00').getTime();
  const fim    = new Date(dataVencimento + 'T00:00:00').getTime();
  const hoje   = new Date(hojeIso + 'T00:00:00').getTime();
  if (fim <= inicio) return 1;
  const fracao = (hoje - inicio) / (fim - inicio);
  return Math.min(1, Math.max(0, fracao));
}
```

`diasParaVencimento` pode retornar negativo (atrasada, já passou do
vencimento). `progressoVencimento` sempre retorna um número entre 0 e 1 — a
barra usa isso como largura/`flex`. Se `data_vencimento <= created_at` (caso
de borda, despesa criada no próprio dia do vencimento ou com datas
inconsistentes), a barra nasce cheia (`1`) em vez de dividir por zero.

### UI — Web

Na listagem de despesas (`web/app/(app)/financeiro/page.tsx`, bloco que
renderiza `despesas.map(...)`), para cada despesa `pendente` com
`data_vencimento`:
- O texto que já existe ("Vence dd/MM") ganha um complemento, no mesmo padrão
  de concatenação já usado para `· Recorrente`: "· faltam N dias", "· vence
  hoje" ou "· atrasada há N dias".
- Uma barra fina (2px de altura) é renderizada logo abaixo da linha da
  despesa, com largura proporcional a `progressoVencimento(...)`. Cor âmbar
  (mesma paleta já usada para status pendente); vermelha quando
  `diasParaVencimento < 0` (atrasada).

Acima da lista, no cabeçalho da seção "Despesas" (ao lado do título), um novo
texto pequeno resume o mês: "R$ {total pendente} pendente · {N} despesa(s)",
calculado a partir de `despesas.filter(d => d.status === 'pendente')` —
dados já carregados, sem query nova.

### UI — Mobile

Mesmo comportamento em `mobile/app/(empresa)/financeiro.tsx` (componente
`DespesaRow` e o cabeçalho da seção de despesas na tela principal): texto
complementar concatenado à linha "Vence dd/MM" existente, barra fina abaixo
da linha, resumo no cabeçalho da seção.

## Fora de escopo

- Indicador visual de "recorrência encerrada" na listagem web ou mobile.
- Auto-lançamento de recorrentes no mobile.
- Validação cruzada entre `recorrencia_ate` e `data_vencimento` (ex.: impedir
  data de término anterior ao vencimento). Campo de data simples, sem regras
  adicionais.
- Notificar o usuário quando uma recorrência está prestes a terminar.
- Configurar a janela de "urgência" da barra (ex.: cor amarela x dias antes)
  — só duas cores: âmbar (dentro do prazo) e vermelho (atrasada).
- Parcelamentos (compras parceladas) e qualquer fluxo de "Renegociar/Quitar"
  — fora do escopo desta spec; as capturas de tela do usuário foram só
  referência visual, não pedido de implementação.

## Verificação

- Teste unitário para `recorrenciaAindaAtiva` (sem data → true; data futura ou
  igual ao início do período → true; data passada → false).
- Teste unitário para `diasParaVencimento` (futuro → positivo; hoje → zero;
  passado → negativo).
- Teste unitário para `progressoVencimento` (metade do caminho → ~0.5; antes
  da criação → clamp em 0; depois do vencimento → clamp em 1; vencimento no
  mesmo dia da criação → 1, sem divisão por zero).
- `npx tsc --noEmit` no web e no mobile.
- Teste manual (recorrência): criar despesa recorrente mensal com
  `recorrencia_ate` no mês atual, avançar o mês visualizado no Financeiro
  (web) e confirmar que o banner de auto-lançamento não sugere mais essa
  despesa.
- Teste manual (progresso): criar despesa avulsa com vencimento em alguns
  dias, confirmar que a barra e o texto "faltam N dias" aparecem; editar o
  vencimento para uma data passada e confirmar que vira "atrasada há N dias"
  com a barra vermelha.
- Auditoria de qualidade conforme `CLAUDE.md`.
