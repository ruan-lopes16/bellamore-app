# Despesas recorrentes: valor variavel por mes

## Contexto

Despesas recorrentes ja existem na tabela `despesas` por meio dos campos
`recorrente`, `periodicidade`, `valor` e `data_vencimento`. No web, a pagina
Financeiro identifica despesas mensais recorrentes de meses anteriores e cria o
lancamento do mes atual copiando os dados do registro mais recente.

## Decisao aprovada

Quando uma despesa recorrente tiver variacao em um mes, a alteracao de valor
deve valer apenas para o lancamento daquele mes. Ela nao deve alterar
automaticamente o valor padrao dos proximos meses.

## Experiencia

Ao clicar em uma despesa pendente para confirmar pagamento, o modal passa a
mostrar o campo editavel "Valor deste mes". O usuario pode manter o valor
original ou informar um valor diferente antes de confirmar.

O mesmo padrao deve existir no web e no mobile, preservando a acao principal de
confirmar pagamento.

## Dados e seguranca

A confirmacao de pagamento atualiza somente a linha selecionada em `despesas`,
incluindo `status`, `data_pagamento` e `valor`.

Nao ha nova tabela nem migration obrigatoria. As politicas RLS existentes para
`despesas` continuam valendo: gestores e owners podem atualizar despesas.

## Fora de escopo

- Editar descricao, categoria, vencimento ou periodicidade.
- Criar um cadastro separado de templates recorrentes.
- Propagar automaticamente a variacao para meses futuros.
- Implementar auto-lancamento de recorrentes no mobile.

## Verificacao

- Teste unitario para validar parse de valor monetario aceitando virgula e ponto.
- Teste unitario para garantir que o payload de pagamento inclui o valor editado
  e nao campos de recorrencia/template.
- `npx tsc --noEmit` no web.
- Auditoria de qualidade conforme `AGENTS.md`, sem nota humana/visual quando
  nao houver ambiente visual disponivel.
