# Historico Financeiro de Janeiro a Maio de 2026 - Design

## Objetivo

Registrar os fechamentos financeiros fornecidos pelo usuario para janeiro a maio de 2026 sem criar atendimentos, vendas ou pagamentos artificiais.

## Escopo aprovado

- Fonte unica: tabela de valores e imagens fornecidas pelo usuario nesta tarefa.
- Meses: janeiro, fevereiro, marco, abril e maio de 2026.
- Fora do escopo: dezembro de 2025, junho e julho de 2026.
- `Faturamento Bruto` recebe `Receita`.
- `Comissoes` recebe `Comissao`, paga para Ana Clara.
- `Gastos Operacionais` recebe a soma das despesas pagas descritas nas imagens.
- `Lucro Real` corresponde a `Receita - Comissao - Gastos`, sem taxas de pagamento.
- Nenhum atendimento, venda, pagamento ou comissao operacional artificial deve ser criado.

## Valores aprovados

| Mes | Receita | Comissao | Gastos | Lucro |
|---|---:|---:|---:|---:|
| Janeiro | R$ 6.491,08 | R$ 2.920,99 | R$ 2.448,19 | R$ 1.121,90 |
| Fevereiro | R$ 7.353,04 | R$ 3.308,87 | R$ 1.915,82 | R$ 2.128,35 |
| Marco | R$ 9.402,10 | R$ 4.230,95 | R$ 1.708,24 | R$ 3.462,91 |
| Abril | R$ 11.889,38 | R$ 5.350,22 | R$ 1.320,28 | R$ 5.218,88 |
| Maio | R$ 8.170,08 | R$ 3.676,54 | R$ 1.264,73 | R$ 3.228,81 |

## Persistencia

- `financeiro_ajustes_mensais`: cinco fechamentos com Receita e Comissao.
- `despesas`: 28 despesas pagas, preservando categoria, descricao e valor das imagens.
- `data_pagamento` e `data_vencimento`: primeiro dia do respectivo mes.
- `recorrente`: `false`.
- `periodicidade`: `null`.

## Regras de seguranca e consistencia

- A gravacao deve abortar se ja houver fechamentos ou despesas no intervalo aprovado.
- Os totais das despesas devem ser validados por mes antes e depois da gravacao.
- O lucro calculado deve coincidir centavo por centavo com a tabela aprovada.
- Taxas de pagamento devem permanecer zeradas nesses fechamentos.
- Scripts temporarios de gravacao devem ser removidos apos a verificacao.

## Componentes tecnicos

- Helper puro para selecionar o fechamento do mes e resolver os KPIs.
- Consulta da tela Financeiro a `financeiro_ajustes_mensais`.
- Migration idempotente para a tabela e suas politicas RLS.
- Testes unitarios para fechamento historico e preservacao do calculo normal.

## Criterios de aceite

- Os quatro KPIs de cada mes coincidem com a tabela aprovada.
- Janeiro contem 7 despesas, fevereiro 6 e marco, abril e maio 5 cada.
- Nao existem registros criados por esta operacao em dezembro de 2025, junho ou julho de 2026.
- Nenhum importador de CNPJ e exposto na interface.
- `npx tsc --noEmit` e a suite de testes passam.
