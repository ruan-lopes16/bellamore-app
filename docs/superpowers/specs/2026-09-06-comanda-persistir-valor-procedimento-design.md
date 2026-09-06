# Comanda — persistir o valor editado de um procedimento

**Data:** 2026-09-06
**Branch:** `claude/procedure-value-persistence-ae902e`
**Escopo:** web apenas (`web/app/(app)/comanda/page.tsx`) + 1 migration + helper puro + testes.

## Problema (reportado)

Na comanda, ao trocar o valor de um procedimento e salvar, o novo valor **não persiste**.
Print do usuário: tela **"Salvar edição"** (editar comanda já fechada).

Dois bugs distintos no mesmo fluxo (`editarComanda`):

### Bug 1 — valor não volta para o atendimento
`editarComanda` grava o valor editado só em `comandas.valor_total`. Nunca em
`agendamentos.valor` nem em `agendamento_servicos.valor`. Ao reabrir, os itens são
remontados a partir do agendamento → volta o preço original. A **comissão** também
já foi gerada sobre o `agendamentos.valor` antigo (o `trg_gerar_comissao` só usa
`NEW.valor` na transição para `concluido`).

### Bug 2 — pagamentos duplicando a cada save
`editarComanda` troca os pagamentos com `DELETE` + `INSERT`. A policy de `DELETE`
de `pagamentos` (migration `045`) provavelmente **nunca foi aplicada** neste banco —
a `073` foi escrita exatamente por causa disso e só consertou `comandas`. Sem policy
de `DELETE` + RLS ligado, o `DELETE` não afeta nenhuma linha (sucesso silencioso) e
o `INSERT` empilha os splits a cada save. 3× "PIX R$110" num total de R$100 →
"Recebido R$330", inflando o faturamento em Dashboard / Financeiro / Relatórios.

## Decisões (com o usuário)

| Pergunta | Resposta |
|---|---|
| Onde o valor editado passa a valer? | No **atendimento inteiro** — `agendamentos.valor` + `agendamento_servicos.valor`; agenda, histórico, comissão e comanda usam o valor cobrado. |
| Comissão de comanda já fechada, ao reeditar o valor? | **Recalcular** `comissoes.valor_servico`, **pendentes E pagas**. |
| Pagamentos que já duplicaram no banco? | **Só parar novos.** Sem limpeza automática — query de diagnóstico no cabeçalho da migration. |
| Mobile? | **Fora de escopo** — comanda fechada não é editável lá e o valor do item não tem campo. |

## Solução

### 1. Migration `075_comanda_edicao_valor_e_rls_pagamentos.sql` (idempotente, estilo `073`)

- **RLS de escrita** de `pagamentos` e `comanda_itens`: `DROP POLICY IF EXISTS` de
  todos os nomes históricos + recria o conjunto que a `045` pretendia
  (`INSERT` p/ membro; `SELECT`/`DELETE`/`UPDATE` p/ gestor/owner **ou** profissional
  dona do agendamento da comanda). Recria `comanda_pertence_ao_profissional` para
  rodar sozinha.
- **Trigger `sincronizar_comissao_valor`** — `AFTER UPDATE OF valor ON agendamentos`,
  `SECURITY DEFINER`, guard `OLD.status = 'concluido' AND NEW.status = 'concluido'
  AND NEW.valor IS DISTINCT FROM OLD.valor` → `UPDATE comissoes SET valor_servico =
  NEW.valor WHERE agendamento_id = NEW.id` (pendentes e pagas). `valor_comissao` é
  coluna gerada, recalcula sozinha. Não colide com `trg_gerar_comissao` (guardas
  opostas em `OLD.status`).
- Cabeçalho traz a query de diagnóstico + `DELETE` manual das duplicatas por comanda.

### 2. `shared/comanda.ts` — `agruparValoresPorAgendamento(itens)`

Função pura: agrupa os itens de agendamento da comanda por `agendamento_id`,
devolve `{ agendamentoId, novoValorTotal, linhasServico: [{ agServicoId, valor }] }[]`.
Ignora extras. Arredonda o total (evita `0.1 + 0.2`). Testada em
`web/tests/unit/comanda-valor-persistencia.test.ts`.

### 3. `web/app/(app)/comanda/page.tsx`

- Query do dia: `agendamento_servicos(id, ...)`; tipos `AgServicoDia` e `ComandaItem`
  ganham `id` / `ag_servico_id`. `abrirComanda` e `abrirComandaFechada` propagam
  `ag_servico_id`.
- Helper `persistirValoresAgendamento(extraUpdate?)`: `UPDATE agendamento_servicos
  SET valor` por linha + `UPDATE agendamentos SET valor = novoValorTotal,
  ...extraUpdate` por agendamento, cada um com `.select('id')` + verificação de
  linha afetada. Espelha o novo valor no `agDia` local (reabrir mostra o valor
  certo). No fechamento novo, `extraUpdate = { status: 'concluido', comanda_id }`
  entra no mesmo `UPDATE` → `trg_gerar_comissao` nasce com o valor certo.
- Helper `conferirDeleteVazio(tabela, comandaId)`: `count exact head` após o
  `DELETE`; se sobrou linha, aborta com mensagem "Aplique a migration 075".
- `editarComanda`: faz os dois `DELETE` (+ checagem) **antes** de qualquer
  `UPDATE`/`INSERT` → se a migration não foi aplicada, aborta sem escrever nada.
- `fecharComanda`: passo 2 usa `persistirValoresAgendamento({ status, comanda_id })`.

## Não coberto / limitações

- **Requer a migration `075` aplicada** para editar comanda fechada. Sem ela, o
  "Salvar edição" passa a **falhar com mensagem clara** em vez de duplicar em
  silêncio. Fechar comanda nova continua funcionando sem a `075`.
- Remover uma linha de serviço da comanda e salvar: o `agendamento_servicos` órfão
  mantém o valor antigo; o total do agendamento e a comissão refletem o que foi
  cobrado. (Remover "não cancela o agendamento" — comportamento pré-existente.)
- Duplicatas de `pagamentos` já gravadas: limpeza manual (query no cabeçalho da `075`).

## Verificação

- `cd web && npx tsc --noEmit` — limpo.
- `cd web && npx vitest run` — 476/476 (15 novos).
- Visual não executado — sem conta de teste para login local (como sessões anteriores).
