# Importacao CNPJ no Financeiro - Design

## Objetivo

Importar dados do bloco CNPJ da planilha `Controle de Gastos - AC RS (1).xlsx` para o modulo Financeiro do App de Estetica, com preview antes de gravar.

## Escopo aprovado

- Destino: tabela `despesas`, exibida em `Financeiro`.
- Fonte: somente o bloco `CNPJ - ANA` das abas mensais.
- Meses importados: `01-Jan`, `02-Fev`, `03-Mar`, `04-Abr` e `05-Mai` de 2026.
- Meses fora do escopo: `06-Jun` e `07-Jul`, alem de `08-Ago` a `12-Dez`.
- Blocos fora do escopo: `Resumo Anual`, `Dashboard`, dados pessoais e bloco `CNPJ - RUAN`.
- Todas as linhas importadas entram como despesas pagas.
- Receitas/faturamento do CNPJ nao entram, porque o Financeiro do app ja calcula receita a partir de agenda e vendas.
- A linha `PRO-LABORE (45% do faturamento bruto)` entra como despesa de categoria `Comissao`.

## Mapeamento de dados

Para despesas operacionais do bloco `CNPJ - ANA`:

- `descricao`: descricao da linha da planilha. Se vier vazia, usar a categoria como descricao.
- `categoria`: categoria da planilha, preservada.
- `valor`: valor monetario da linha.
- `status`: `pago`.
- `recorrente`: `false`.
- `data_pagamento`: primeiro dia do mes da aba, em formato `YYYY-MM-01`.
- `data_vencimento`: mesmo valor de `data_pagamento`.

Para pro-labore:

- `descricao`: `Comissao - Janeiro/2026`, `Comissao - Fevereiro/2026`, `Comissao - Marco/2026`, `Comissao - Abril/2026` ou `Comissao - Maio/2026`, conforme a aba importada.
- `categoria`: `Comissao`.
- `valor`: valor calculado da linha `PRO-LABORE`.
- `status`: `pago`.
- `recorrente`: `false`.
- `data_pagamento` e `data_vencimento`: primeiro dia do mes da aba.

## Fluxo de usuario

1. O usuario abre um fluxo administrativo de importacao no app.
2. Seleciona a planilha `.xlsx`.
3. O app mostra um preview antes de gravar:
   - total por mes;
   - total por categoria;
   - quantidade de linhas;
   - linhas que serao importadas;
   - avisos de linhas ignoradas.
4. O usuario confirma.
5. O app grava as despesas no Supabase.
6. O Financeiro passa a exibir os valores nos meses correspondentes.

## Regras de seguranca e consistencia

- Nenhuma gravacao acontece durante o preview.
- O importador deve validar valor maior que zero.
- Linhas de totais, receitas e lucro liquido nao entram como despesas, exceto o pro-labore mapeado para `Comissao`.
- Antes de inserir, o app deve detectar possiveis duplicidades por `empresa_id`, `descricao`, `categoria`, `valor`, `data_pagamento` e `status`.
- Duplicidades detectadas devem aparecer no preview como avisos e nao devem ser reinseridas.
- A importacao respeita RLS existente: somente usuario com permissao de escrita em `despesas` consegue gravar.

## Componentes tecnicos

- Parser puro para ler o workbook e converter as abas Jan-Mai em um payload tipado.
- Componente client-side para selecionar arquivo, renderizar preview e confirmar importacao.
- Server action para validar o payload, checar duplicidades e inserir em `despesas`.
- Testes unitarios para parser, mapeamento do pro-labore e exclusao de junho/julho.

## Criterios de aceite

- Preview mostra apenas dados de Jan-Mai/2026 do bloco `CNPJ - ANA`.
- Junho e julho nao aparecem no preview nem no payload.
- `PRO-LABORE` aparece como `Comissao`.
- Confirmar importacao cria despesas pagas nos meses certos.
- Rodar `npx tsc --noEmit` sem erros.
- Testes do importador passam.
