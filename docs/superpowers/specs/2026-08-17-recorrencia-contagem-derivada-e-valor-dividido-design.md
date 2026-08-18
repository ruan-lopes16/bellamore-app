# Recorrências: contagem derivada por data e valor total dividido

## Contexto

Despesas recorrentes mensais já têm dois jeitos de definir quando a recorrência termina
(`docs/superpowers/specs/2026-08-13-despesas-quantidade-parcelas-design.md`): digitando a data
diretamente ("Por data") ou informando a quantidade total de parcelas ("Por quantidade de
parcelas"). Só o segundo modo grava `parcela_atual`/`total_parcelas` e mostra "· Parcela X de Y"
na listagem — despesas criadas "Por data" (a maioria das já existentes) não mostram nenhuma
contagem, mesmo tendo uma data de término definida.

Pedido do usuário: (A) mostrar a contagem de parcelas também para despesas "Por data", num
formato mais compacto — "(1/3)"; (B) para compras parceladas no cartão, poder informar o valor
total da compra e deixar o sistema dividir automaticamente pela quantidade de parcelas.

## Garantia de não regressão

**Nada aqui reescreve ou apaga dado existente.**

- A Parte A é **só de exibição** — nenhuma escrita nova no banco, nenhuma migration. O cálculo é
  refeito a cada carregamento da tela a partir de dados que já existem hoje. Uma despesa "Por
  data" continua salva exatamente como é salva hoje.
- A Parte B adiciona uma coluna nova, opcional (`nullable`, sem valor padrão) — despesas
  existentes e o fluxo atual de "Por quantidade de parcelas" sem o novo toggle continuam
  funcionando byte a byte como funcionam hoje. A coluna só é lida/escrita quando o novo toggle
  "Valor total da compra" está ativo.
- O auto-lançamento (`lancarRecorrentes`) muda numa única condição (`valor_total_compra != null`)
  — despesas recorrentes que não usam esse recurso continuam com o mesmo comportamento de copiar
  o valor do mês anterior, inalterado.
- Nenhuma tabela, política de RLS ou índice existente é alterado ou removido.

## Parte A — Contagem "(X/Y)" derivada por data

### Design técnico

Nova função pura em `shared/despesas.ts`:

```ts
export type OcorrenciaHistorico = {
  descricao: string;
  categoria?: string;
  data_vencimento?: string;
  recorrencia_ate?: string;
};

/**
 * Deriva a posicao (atual/total) de uma despesa recorrente mensal dentro da sua
 * serie, a partir da data de vencimento mais antiga entre as ocorrencias
 * anteriores com a mesma descricao+categoria+recorrencia_ate (a "ancora" da
 * serie). Se nao houver ocorrencia anterior, a propria despesa e a ancora
 * (mostra "1 de Y"). Retorna null se nao houver recorrenciaAte (recorrencia sem
 * termino nao tem contagem).
 */
export function calcularParcelaDerivada(
  descricao: string,
  categoria: string | undefined,
  dataVencimento: string,
  recorrenciaAte: string | null | undefined,
  historico: OcorrenciaHistorico[],
): { atual: number; total: number } | null
```

Regras:
- Retorna `null` se `recorrenciaAte` for vazio.
- Filtra `historico` por `descricao` + `categoria` + `recorrencia_ate` idênticos (mesma chave
  composta já usada em `templatesRecorrentesParaLancar`, mais o `recorrencia_ate` para não
  confundir duas séries diferentes que reusem a mesma descrição em épocas diferentes).
- Âncora = a menor `data_vencimento` entre os itens filtrados e a própria `dataVencimento`
  recebida.
- `total` = meses entre a âncora e `recorrenciaAte` (inclusive), mesma matemática de
  `proximaParcelaAtual`.
- `atual` = meses entre a âncora e `dataVencimento` (inclusive), clampado em `[1, total]` por
  segurança (mesmo espírito de `clampParcelaAtual`).

### Uso na listagem (web e mobile)

Onde a listagem hoje decide o texto do rótulo (web: `financeiro/page.tsx`, condicional
`d.total_parcelas ? ...`; mobile: `financeiro.tsx`, mesma condicional em `DespesaRow`):

1. Se `total_parcelas` já está gravado (modo "Por quantidade de parcelas") → usa
   `parcela_atual`/`total_parcelas` como hoje.
2. Senão, se `periodicidade === 'mensal'` e `recorrencia_ate` preenchido → chama
   `calcularParcelaDerivada` com o histórico já carregado pela tela.
3. Senão → sem rótulo de parcela (comportamento atual).

Em ambos os casos (1) e (2), o texto muda de `· Parcela {atual} de {total}` para `(​{atual}/{total})`.

### Histórico disponível por plataforma

- **Web**: a consulta `recMesAnt` em `financeiro/page.tsx` já traz `descricao, categoria,
  data_vencimento, recorrencia_ate` de todas as despesas recorrentes mensais de meses passados,
  sem limite de janela — reaproveitada como está, sem nova consulta.
- **Mobile**: hoje não existe consulta de histórico (o auto-lançamento é só web). Adiciona-se uma
  consulta leve equivalente (`select descricao, categoria, data_vencimento, recorrencia_ate` dos
  meses anteriores) só para alimentar esse cálculo na listagem.

## Parte B — Valor total da compra, dividido automaticamente

### Dado novo

```sql
alter table public.despesas
  add column valor_total_compra numeric(10,2);
```

Nullable, aditiva — só preenchida quando o novo modo de valor é usado.

### Cálculo

Nova função pura em `shared/despesas.ts`:

```ts
/**
 * Divide o valor total de uma compra parcelada pela quantidade de parcelas.
 * A parcela sendo cadastrada agora absorve toda a diferenca de arredondamento
 * (ex: R$100 / 3 = R$33,33 + R$33,33 + R$33,34), para a soma da serie bater
 * exatamente com o valor total informado. As demais parcelas (lancadas
 * automaticamente depois) recebem sempre o valor-base, sem a diferenca.
 */
export function dividirValorCompra(
  valorTotal: number,
  totalParcelas: number,
): { valorBase: number; valorParcelaAtual: number }
```

`valorBase = Math.floor((valorTotal / totalParcelas) * 100) / 100`;
`valorParcelaAtual = valorTotal - valorBase * (totalParcelas - 1)` (absorve o resto, não importa
se essa é a parcela 1 ou a parcela 5 de um contrato já em andamento).

### UI — Web e Mobile

Dentro da seção "Por quantidade de parcelas" dos 4 pontos já existentes (web: `NovaDespesaModal`/
`EditarDespesaModal`; mobile: `nova-despesa.tsx`/`ModalEditarDespesa`), um toggle novo: **"Valor
da parcela"** (atual — digita o campo Valor do topo do formulário normalmente) / **"Valor total da
compra"** (novo — mostra um campo "Valor total da compra"; o campo Valor do topo vira
somente-leitura, preenchido com `dividirValorCompra(valorTotal, totalParcelas).valorParcelaAtual`).

Editável tanto ao criar quanto ao editar — mesmo padrão já usado para os campos de parcela.

Ao salvar: `valor` recebe `valorParcelaAtual`; `valor_total_compra` recebe `valorTotal` quando o
modo está ativo, `null` caso contrário (mesmo padrão de `usaParcelas` já existente).

### Auto-lançamento (`lancarRecorrentes`, web)

```
valor_total_compra: r.valor_total_compra ?? null,
valor: r.valor_total_compra != null && r.total_parcelas != null
  ? dividirValorCompra(r.valor_total_compra, r.total_parcelas).valorBase
  : r.valor,   // comportamento atual, inalterado
```

## Fora de escopo

- "Valor total dividido" no modo "Por data" — só disponível dentro de "Por quantidade de
  parcelas", onde a quantidade já é o dado primário digitado pelo usuário.
- Migrar despesas "Por data" já existentes para ganhar `valor_total_compra` retroativamente — esse
  campo só existe para compras cadastradas com o novo modo daqui pra frente.
- Qualquer mudança de RLS — `valor_total_compra` é uma coluna simples, coberta pela mesma política
  de `despesas` já existente (UPDATE restrito a gestor/owner desde a migration 003).

## Critérios de aceite

- Uma despesa recorrente mensal "Por data" já existente, sem `total_parcelas` gravado, passa a
  mostrar "(X/Y)" na listagem (web e mobile) assim que tiver uma ocorrência anterior ou é a
  própria primeira ocorrência — sem precisar ser editada.
- Uma despesa "Por quantidade de parcelas" continua mostrando a mesma contagem de antes, só no
  formato "(X/Y)" em vez de "· Parcela X de Y".
- Cadastrar uma despesa parcelada por "Valor total da compra" grava o valor correto (com a
  diferença de centavos) na parcela atual; os meses seguintes, auto-lançados, recebem sempre o
  valor-base, sem a diferença — a soma da série bate exatamente com o valor total informado.
- Nenhuma despesa existente muda de valor, contagem ou comportamento sem o usuário optar
  ativamente pelo novo toggle (Parte B) — Parte A é automática mas não grava nada.
- `npx tsc --noEmit` sem erros no web e no mobile.

## Validação

- Testes unitários para `calcularParcelaDerivada` (primeira ocorrência sem histórico; ocorrência
  no meio de uma série; sem `recorrencia_ate` retorna null; duas séries diferentes com a mesma
  descrição não se confundem) e `dividirValorCompra` (divisão exata, divisão com resto, resto vai
  para a parcela atual).
- `npx tsc --noEmit` no web e no mobile.
- Verificação visual não é possível nesta sessão (sem conta de teste), como já registrado nas
  sessões anteriores.
