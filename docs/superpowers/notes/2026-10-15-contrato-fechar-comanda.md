# Contrato das funções da migration 090 (comanda e venda "tudo ou nada")

Data: 2026-10-15 · Branch `feat/pendencias-registradas`.
Fonte de verdade: `supabase/migrations/090_comanda_tudo_ou_nada.sql`. Este documento é o que as Tasks 2–4
(`shared/comanda-gravacao.ts`, telas web/app, PDV/Vendas) consomem. Inventário de origem:
`docs/superpowers/notes/2026-10-15-inventario-gravacoes-comanda.md`.

| Função | Chamada PostgREST | Devolve |
|---|---|---|
| `public.fechar_comanda(p jsonb)` | `supabase.rpc('fechar_comanda', { p: payload })` | `uuid` da comanda (`= p.comanda_id`) |
| `public.editar_comanda(p jsonb)` | `supabase.rpc('editar_comanda', { p: payload })` | nada (`void`) |
| `public.registrar_venda_avulsa_v2(p_venda_id, p_empresa, p_cliente, p_desconto, p_itens, p_pagamentos)` | `supabase.rpc('registrar_venda_avulsa_v2', {...})` | `uuid` da venda (`= p_venda_id`) |

Todas: `security invoker` (valem as policies de quem chama), uma transação (qualquer erro desfaz tudo),
sem RETURNING, execução só para `authenticated`. Sem a 090 o PostgREST responde `PGRST202` → a tela usa o
caminho antigo em passos. **Nunca mudar estas assinaturas**: mudança futura = função nova.

## Regras gerais

- **Números**: JSON number (não string). Dinheiro com até 2 casas; o banco arredonda com `round(x, 2)`.
  Quantidade com até 3 casas (`round(x, 3)`).
- **uuid**: string uuid válida ou `null`. String vazia `""` é tratada como `null`. Texto que não é uuid → erro
  do Postgres `22P02` (`invalid input syntax for type uuid`), sem mensagem própria.
- **Campos desconhecidos são ignorados.** Campos que o banco calcula **não existem no contrato** e, se vierem,
  são ignorados: subtotal, total, `desconto_reserva`, `valor_liquido`, `created_at`, `fechada_at`,
  `profissional_id` da comanda, valor de atendimento multi-serviço (vem da soma das linhas).
- **Erros**: `raise exception` → PostgREST devolve `{ code, message }`. `code = '42501'` = falta de
  permissão (mensagem em português, pronta para a tela). Os demais erros de regra saem com `code = 'P0001'`
  e a mensagem exata da lista abaixo. Mensagens com `%` têm o trecho variável indicado.
- **Rateio do desconto manual** (feito só no banco, fonte única): em centavos, proporcional ao valor de cada
  parte — atendimento sem linhas (`valor`), cada linha de multi-serviço (`valor`), cada item extra
  (`round(valor_unit × quantidade, 2)`). Cota = piso(desconto × peso ÷ soma); o resto de centavos vai para a
  **maior parte** (maior peso; empate → a que veio primeiro: atendimentos, depois linhas, depois itens, na
  ordem do payload), nunca passando do peso dela (o que não cabe vai para a próxima maior). Parte de peso 0
  (sessão de pacote) recebe 0. O desconto da **reserva não é rateado**. A função espelho
  `ratear_desconto_centavos(bigint, bigint[]) returns bigint[]` também fica exposta (para testes/prévia).

---

## 1. `fechar_comanda(p jsonb) returns uuid`

### 1.1 Campos

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `comanda_id` | uuid | **sim** | Gerado na tela **uma vez por tentativa de fechar** e reaproveitado em toda nova tentativa (chave de idempotência). Já existe nesta empresa → devolve o id **sem gravar nada** (antes de qualquer outra conferência). Já existe em outra empresa → erro. |
| `empresa_id` | uuid | **sim** | Empresa ativa. Toda gravação usa este valor. |
| `cliente_id` | uuid \| null | não (default `null`) | `clientes.id`. `null` = cliente avulso (`__sem__`). Vai para `comandas.clientes_id`, `vendas.cliente_id` e `pacote_clientes.cliente_id`. Obrigatório quando há item `pacote`. Não é conferido contra a empresa (igual à 087). |
| `desconto` | number ≥ 0 | não (default 0) | Desconto **manual** em R$ (a tela converte o % antes). `≤ subtotal`. `> 0` exige `comanda.desconto`. |
| `atendimentos` | array | não (default `[]`) | Atendimentos da comanda. `atendimentos` e `itens` não podem ser ambos vazios. |
| `atendimentos[].agendamento_id` | uuid | **sim** | Sem repetição no array. Precisa estar com `comanda_id IS NULL` (senão "já teve a comanda fechada"). |
| `atendimentos[].valor` | number ≥ 0 | sim **quando não há `linhas`** | Valor cobrado do atendimento sem multi-serviço (o que a tela mostra, pode ter sido editado). Ignorado quando há `linhas`. |
| `atendimentos[].linhas` | array | não | Multi-serviço: uma entrada por linha de `agendamento_servicos` **presente** na comanda. Array vazio ou ausente = atendimento sem linhas. `agendamentos.valor` = soma das linhas. Linha tirada da comanda não vem e não é tocada. |
| `atendimentos[].linhas[].ag_servico_id` | uuid | **sim** | `agendamento_servicos.id` do próprio atendimento. Sem repetição em toda a comanda. |
| `atendimentos[].linhas[].valor` | number ≥ 0 | **sim** | Valor cobrado da linha. |
| `atendimentos[].pacote_cliente_id` | uuid \| null | não | **Presença da chave importa** (mesma regra de `agruparValoresPorAgendamento`): ausente = não mexe no vínculo gravado; `"uuid"` = vincula (precisa existir em `pacote_clientes` desta empresa); `null` = desvincula. Vínculo final (o enviado ou o já gravado) não nulo exige valor total do atendimento = 0. |
| `itens` | array | não (default `[]`) | Extras (`comanda_itens`). |
| `itens[].tipo` | `'servico' \| 'produto' \| 'pacote'` | **sim** | |
| `itens[].descricao` | string não vazia | **sim** | Gravada com `btrim`. Entra no motivo da baixa: `Produto via comanda — <descricao>`. |
| `itens[].quantidade` | number > 0 | **sim** | 3 casas. Pacote: número inteiro (uma venda `pacote_clientes` por unidade). |
| `itens[].valor_unit` | number ≥ 0 | **sim** | Valor unitário cobrado. |
| `itens[].servico_id` | uuid \| null | não | Só `servico` (nos outros tipos é ignorado). Se vier, precisa ser serviço desta empresa. |
| `itens[].profissional_id` | uuid \| null | não | Só `servico` (ignorado nos outros). Com percentual > 0 em `empresa_membros`, o trigger 085 cria a comissão. |
| `itens[].produto_id` | uuid | sim em `produto` | Produto desta empresa (`tipo`/`ativo`/saldo **não** são conferidos: a comanda não bloqueia sem estoque, decisão de 29/09). |
| `itens[].pacote_id` | uuid | sim em `pacote` | Pacote desta empresa. Exige `pacotes.vender` e `cliente_id`. |
| `pagamentos` | array | não (default `[]`) | Linhas com `valor = 0` são descartadas. Sem nenhuma linha com valor e total < R$ 0,01 → o banco grava **uma** Cortesia R$ 0. Total ≥ R$ 0,01 exige soma ≥ total (troco permitido). |
| `pagamentos[].valor` | number ≥ 0 | **sim** | |
| `pagamentos[].metodo` | `'dinheiro' \| 'pix' \| 'credito' \| 'debito' \| 'cortesia'` | **sim** | Cortesia com valor > 0 exige `comanda.desconto`. |
| `pagamentos[].parcelas` | integer ≥ 1 | não (default 1) | Gravado só em `credito`; nos outros métodos é sempre 1. |
| `pagamentos[].bandeira` | string \| null | não | Só cartão (`credito`/`debito`); fora do cartão vira `null`. |
| `pagamentos[].maquininha_id` | uuid \| null | não | Só cartão; fora do cartão vira `null`. |
| `pagamentos[].taxa_perc` | number \| null | não | Decimal (0,0499 = 4,99%), `0 ≤ taxa < 1`. Vem da tela (`taxaDoSplit`). Só cartão; `0`/`null` → gravado `null`. `valor_liquido` é calculado no banco: `round(valor × (1 − taxa), 2)` quando há taxa, senão `null`. |

### 1.2 O que o banco calcula

- `subtotal` = Σ valor dos atendimentos (com linhas: Σ linhas) + Σ `round(valor_unit × quantidade, 2)` dos itens.
- `reserva` = Σ `taxas_reserva.valor` com `status = 'pago'` dos atendimentos do payload (leitura com a RLS de
  quem chama); `reserva aplicada = min(reserva, max(subtotal − desconto, 0))`.
- `total = max(subtotal − desconto − reserva aplicada, 0)`.
- `comandas`: `profissional_id = auth.uid()`, `status = 'fechada'`, `fechada_at = now()`, `valor_total = subtotal`,
  `desconto = desconto + reserva aplicada`, `desconto_reserva = reserva aplicada`.
- `desconto_rateado` em cada atendimento (com linhas: soma das cotas das linhas), linha e item.
- Venda dos produtos: `vendas` (`observacao = 'Via comanda'`, `valor_total` = Σ dos produtos, `desconto` = Σ das
  cotas dos produtos) + `venda_itens` (`preco_unitario = valor_unit`).
- Venda dos pacotes: `pacote_clientes` por unidade (`data_inicio` = hoje em Brasília, `data_validade` = início +
  `validade_dias` ou `null`, `valor_pago = valor_unit`, `status = 'ativo'`) + uma `vendas`
  (`observacao = 'Pacote(s) via comanda'`, `valor_total` = Σ, `desconto` = Σ das cotas dos pacotes) quando Σ > 0.
- Baixa: `estoque_movimentos` saída por item de produto, com `comanda_id`, `agendamento_id` = 1º atendimento
  do payload (ou `null`) e trava `venda_estoque:<produto>` em ordem de id antes do 1º INSERT.

### 1.3 Ordem das gravações

`comandas` → `agendamento_servicos` (valor + desconto) → `agendamentos` (um UPDATE por atendimento com `valor`,
`desconto_rateado`, `pacote_cliente_id`, `comanda_id` e `status = 'concluido'` juntos, `WHERE comanda_id IS NULL`,
contagem conferida) → `comanda_itens` → `pacote_clientes` + `vendas` (pacote) → trava + `estoque_movimentos` →
`vendas` + `venda_itens` (produtos) → `pagamentos`.

### 1.4 Exemplos (um por caso do inventário §1.3)

Ids encurtados para leitura; na tela são uuids reais. `E` = empresa, `C` = comanda (gerada na tela), `CL` = cliente.

**Atendimento simples (sem `agendamento_servicos`)**
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 120.00 } ],
  "itens": [],
  "pagamentos": [ { "valor": 120.00, "metodo": "pix" } ] }
```

**Multi-serviço** (o valor do atendimento é a soma; `valor` do atendimento não vai)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 10.00,
  "atendimentos": [ { "agendamento_id": "AG1", "linhas": [
      { "ag_servico_id": "AS1", "valor": 80.00 },
      { "ag_servico_id": "AS2", "valor": 40.00 } ] } ],
  "itens": [],
  "pagamentos": [ { "valor": 110.00, "metodo": "credito", "bandeira": "visa", "parcelas": 2,
                    "maquininha_id": "MAQ", "taxa_perc": 0.0559 } ] }
```

**Sessão de pacote vinculada na comanda** (item zerado; total R$ 0 → Cortesia R$ 0 automática)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 0, "pacote_cliente_id": "PC1" } ],
  "itens": [], "pagamentos": [] }
```

**Sessão de pacote vinculada na Agenda** (o vínculo já está gravado: a tela pode mandar a chave com o mesmo
valor, como faz hoje com `pacoteLinks` semeado, ou omiti-la — nos dois casos o vínculo fica)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 0, "pacote_cliente_id": "PC1" } ],
  "itens": [], "pagamentos": [] }
```

**Desvincular** (`null` explícito limpa a coluna; o valor volta ao de tabela)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 120.00, "pacote_cliente_id": null } ],
  "itens": [],
  "pagamentos": [ { "valor": 120.00, "metodo": "dinheiro" } ] }
```

**Vender pacote novo** (exige cliente cadastrada e `pacotes.vender`; o pacote **não** é vinculado ao atendimento)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 120.00 } ],
  "itens": [ { "tipo": "pacote", "descricao": "Pacote 5 sessões", "pacote_id": "PK1",
               "quantidade": 1, "valor_unit": 450.00 } ],
  "pagamentos": [ { "valor": 570.00, "metodo": "pix" } ] }
```

**Combo vinculado na Agenda** (`controla_sessoes = false`: item R$ 0; o 078 não grava `pacote_uso`, o 065 não
gera comissão — igual a hoje; a chave pode ser omitida)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 0 } ],
  "itens": [], "pagamentos": [] }
```

**Serviço extra com profissional** (085 cria a comissão sobre `valor_unit × quantidade − desconto_rateado`,
datada por `fechada_at`)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 100.00 } ],
  "itens": [ { "tipo": "servico", "descricao": "Escova", "servico_id": "SV2",
               "profissional_id": "PROF2", "quantidade": 1, "valor_unit": 40.00 } ],
  "pagamentos": [ { "valor": 140.00, "metodo": "pix" } ] }
```

**Produto extra** (baixa com `comanda_id`, nunca bloqueia por saldo; venda "Via comanda")
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 100.00 } ],
  "itens": [ { "tipo": "produto", "descricao": "Óleo capilar", "produto_id": "PR1",
               "quantidade": 2, "valor_unit": 35.00 } ],
  "pagamentos": [ { "valor": 170.00, "metodo": "debito", "bandeira": "elo",
                    "maquininha_id": "MAQ", "taxa_perc": 0.0239 } ] }
```

**Taxa de reserva paga** (nada a mandar: o banco lê `taxas_reserva` pagas do AG1; com reserva R$ 30 o total é 90)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 120.00 } ],
  "itens": [], "pagamentos": [ { "valor": 90.00, "metodo": "pix" } ] }
```

**Cortesia R$ 0 por desconto de 100%** (exige `comanda.desconto`)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 120.00,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 120.00 } ],
  "itens": [], "pagamentos": [] }
```

**Comanda só com extras** (sem atendimento: a idempotência pelo `comanda_id` substitui `comandasParciais`)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": "CL", "desconto": 0,
  "atendimentos": [],
  "itens": [ { "tipo": "produto", "descricao": "Creme", "produto_id": "PR2", "quantidade": 1, "valor_unit": 60.00 },
             { "tipo": "servico", "descricao": "Design de sobrancelha", "servico_id": "SV3",
               "profissional_id": "PROF1", "quantidade": 1, "valor_unit": 50.00 } ],
  "pagamentos": [ { "valor": 110.00, "metodo": "dinheiro" } ] }
```

**Cliente avulso** (`cliente_id: null`; item `pacote` seria recusado)
```json
{ "comanda_id": "C", "empresa_id": "E", "cliente_id": null, "desconto": 5.00,
  "atendimentos": [],
  "itens": [ { "tipo": "produto", "descricao": "Esmalte", "produto_id": "PR3", "quantidade": 1, "valor_unit": 25.00 } ],
  "pagamentos": [ { "valor": 20.00, "metodo": "pix" } ] }
```

### 1.5 Erros de `fechar_comanda`

| Mensagem exata | code | Quando |
|---|---|---|
| `Dados da comanda inválidos.` | P0001 | `p` não é objeto; falta `comanda_id`/`empresa_id`; `atendimentos`/`itens`/`pagamentos` não são arrays |
| `Você não tem permissão para fechar a comanda.` | 42501 | sem `comanda.fechar` |
| `Esta comanda pertence a outra empresa.` | P0001 | `comanda_id` já existe em outra empresa (visível para quem chama) |
| `Comanda vazia.` | P0001 | sem atendimentos e sem itens |
| `Atendimento inválido.` | P0001 | entrada não é objeto ou sem `agendamento_id` |
| `Atendimento repetido na comanda.` | P0001 | `agendamento_id` repetido |
| `Serviço do atendimento inválido.` | P0001 | linha sem `ag_servico_id` ou `valor` ausente/negativo |
| `Serviço do atendimento repetido na comanda.` | P0001 | `ag_servico_id` repetido |
| `Valor do atendimento inválido.` | P0001 | atendimento sem linhas com `valor` ausente/negativo |
| `Pacote da cliente não encontrado.` | P0001 | `pacote_cliente_id` enviado não existe nesta empresa |
| `Atendimento coberto por pacote deve ficar com valor R$ 0,00.` | P0001 | vínculo final não nulo e valor > 0 |
| `Item da comanda inválido.` | P0001 | tipo fora da lista, descrição vazia, quantidade ≤ 0, `valor_unit` ausente/negativo, produto sem `produto_id`, pacote sem `pacote_id` |
| `Produto não encontrado: <descricao>.` | P0001 | produto não é desta empresa |
| `Quantidade de pacote deve ser um número inteiro.` | P0001 | pacote com quantidade fracionada |
| `Pacote não encontrado: <descricao>.` | P0001 | pacote não é desta empresa |
| `Serviço não encontrado: <descricao>.` | P0001 | `servico_id` do extra não é desta empresa |
| `Você não tem permissão para vender pacotes.` | 42501 | item pacote sem `pacotes.vender` |
| `Para vender pacote, escolha uma cliente cadastrada.` | P0001 | item pacote com `cliente_id` nulo |
| `Desconto inválido.` | P0001 | `desconto` < 0 |
| `O desconto não pode ser maior que o subtotal.` | P0001 | `desconto` > subtotal |
| `Pagamento inválido.` | P0001 | entrada não é objeto, `valor` ausente/negativo, método fora da lista, `parcelas` < 1 |
| `Taxa do cartão inválida.` | P0001 | `taxa_perc` < 0 ou ≥ 1 |
| `O pagamento não cobre o total da comanda.` | P0001 | total ≥ R$ 0,01 e soma dos pagamentos < total |
| `Você não tem permissão para dar desconto ou cortesia.` | 42501 | desconto > 0 ou cortesia com valor sem `comanda.desconto` |
| `Este código de comanda já foi usado. Recarregue a tela e tente de novo.` | P0001 | `comanda_id` em uso por comanda que quem chama não enxerga |
| `Não foi possível salvar o valor dos serviços do atendimento.` | P0001 | linha não pertence ao atendimento/empresa ou RLS recusou (0 linhas) |
| `Este atendimento já teve a comanda fechada.` | P0001 | **duplicidade**: o atendimento já tem `comanda_id` (outra aba/aparelho). Tudo é desfeito |
| `Você não tem permissão para fechar a comanda deste atendimento.` | 42501 | UPDATE do atendimento acertou 0 linhas sem ele estar fechado (colega sem `agenda.gerenciar_outras`, outra empresa ou inexistente) |
| `Comissão deste serviço já foi paga` | P0001 | (trigger 085; não ocorre no fechamento, só na edição) |
| `invalid input syntax for type uuid/numeric/integer…` | 22P02 | campo com tipo errado (mensagem do Postgres) |

Sem resposta do servidor (rede): a tela não sabe se gravou. Mostrar "Sem resposta do servidor: a comanda pode ter
sido fechada. Confira antes de repetir." e, na nova tentativa, **reenviar o mesmo `comanda_id`**: se gravou, a
função devolve o id sem duplicar.

---

## 2. `editar_comanda(p jsonb) returns void`

O payload é o **estado completo** da comanda depois da edição (não um diff): o banco compara com o gravado.

### 2.1 Campos

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `comanda_id` | uuid | **sim** | Comanda `fechada` desta empresa. |
| `empresa_id` | uuid | **sim** | |
| `desconto` | number ≥ 0 | não (default 0) | Desconto manual em R$ (reabre como `comandas.desconto − desconto_reserva`). Mudar o valor (ou aumentar a cortesia) exige `comanda.desconto`; manter o que estava, não. Limites próprios por causa da parte congelada (abaixo). |
| `atendimentos` | array | não | **Exatamente** os atendimentos visíveis com `comanda_id` = esta comanda (nem a mais, nem a menos: tirar atendimento é proibido). |
| `atendimentos[].agendamento_id` | uuid | **sim** | |
| `atendimentos[].valor` / `.linhas[]` | | | Iguais ao fechamento. Grava só `valor` e `desconto_rateado` (o 075 acerta as comissões, inclusive pagas). |
| `atendimentos[].pacote_cliente_id` | — | — | **Ignorado** (vínculo não muda na edição). O vínculo gravado não nulo exige valor 0. |
| `cliente_id` | — | — | Ignorado (cliente não muda na edição). |
| `itens` | array | não | Todos os extras da comanda. |
| `itens[].item_id` | uuid | **sim** | Item já gravado → altera; id novo (gerado na tela, reaproveitado em nova tentativa) → inclui; item gravado que não vem → remove. Sem repetição. |
| `itens[].tipo`, `descricao`, `quantidade`, `valor_unit`, `servico_id`, `profissional_id`, `produto_id`, `pacote_id` | | | Como no fechamento. `tipo` de item existente não muda. |
| — produto/pacote | | | **Só leitura**: precisam vir com o mesmo `item_id`, `valor_unit` e `quantidade` gravados; não podem ser incluídos nem removidos. A parte do desconto deles fica **congelada** (a venda via comanda não é corrigida). |
| — serviço | | | Altera `valor_unit`, `quantidade`, `profissional_id` e `desconto_rateado` (só quando algo mudou). O 085 recusa trocar a profissional ou remover serviço com comissão paga. |
| `pagamentos` | array | não | Estado completo. Os gravados são apagados e os do payload reinseridos na mesma transação. |
| `pagamentos[].pagamento_id` | uuid \| null | não | Id do pagamento reaberto. Se ele existe nesta comanda **e** método, parcelas, bandeira e maquininha não mudaram → mantém `id`, `taxa_perc`, `maquininha_id` e `created_at` gravados (o `taxa_perc` da tela é ignorado). Senão (ou sem id) → pagamento novo: taxa da tela e `created_at = comandas.fechada_at`. Sem repetição. |
| `pagamentos[].valor`, `metodo`, `parcelas`, `bandeira`, `maquininha_id`, `taxa_perc` | | | Como no fechamento. Sem nenhum com valor e total < R$ 0,01 → Cortesia R$ 0 com `created_at = fechada_at`. |

### 2.2 O que o banco calcula

- `subtotal`, `reserva`, `total` como no fechamento (a reserva é relida de `taxas_reserva`).
- `congelado` = Σ `desconto_rateado` gravado dos produtos e pacotes. O desconto novo precisa ficar entre
  `congelado` e `congelado + (subtotal − Σ valor dos produtos e pacotes)`. A diferença (`desconto − congelado`) é
  rateada entre atendimentos, linhas e serviços extras.
- `comandas`: `valor_total`, `desconto = desconto + reserva aplicada`, `desconto_reserva`. `fechada_at` não muda.
- Ordem: remove itens → altera itens → inclui itens → `comandas` → linhas e atendimentos → apaga pagamentos
  (contagem conferida) → reinsere pagamentos.

### 2.3 Exemplo (comanda com 1 atendimento, 1 serviço extra, 1 produto; muda o valor do atendimento, inclui um
serviço e um pagamento em dinheiro, mantém o cartão)
```json
{ "comanda_id": "C", "empresa_id": "E", "desconto": 15.00,
  "atendimentos": [ { "agendamento_id": "AG1", "valor": 130.00 } ],
  "itens": [
    { "item_id": "IT1", "tipo": "servico", "descricao": "Escova", "servico_id": "SV2",
      "profissional_id": "PROF2", "quantidade": 1, "valor_unit": 45.00 },
    { "item_id": "IT2", "tipo": "produto", "descricao": "Óleo capilar", "produto_id": "PR1",
      "quantidade": 2, "valor_unit": 35.00 },
    { "item_id": "IT3-novo-da-tela", "tipo": "servico", "descricao": "Hidratação", "servico_id": "SV4",
      "profissional_id": null, "quantidade": 1, "valor_unit": 60.00 } ],
  "pagamentos": [
    { "pagamento_id": "PG1", "valor": 170.00, "metodo": "debito", "bandeira": "elo",
      "maquininha_id": "MAQ", "taxa_perc": 0.0239 },
    { "valor": 120.00, "metodo": "dinheiro" } ] }
```

### 2.4 Erros de `editar_comanda`

| Mensagem exata | code | Quando |
|---|---|---|
| `Dados da comanda inválidos.` | P0001 | igual ao fechamento |
| `Você não tem permissão para editar comanda fechada.` | 42501 | sem `comanda.editar_fechada` |
| `Comanda não encontrada.` | P0001 | id inexistente ou invisível para quem chama |
| `Esta comanda pertence a outra empresa.` | P0001 | `empresa_id` diferente do da comanda |
| `A comanda não está fechada.` | P0001 | `status <> 'fechada'` |
| `Atendimento inválido.` / `Atendimento repetido na comanda.` | P0001 | igual ao fechamento |
| `Atendimento não pertence a esta comanda.` | P0001 | atendimento do payload sem `comanda_id` = esta comanda |
| `Serviço do atendimento inválido.` / `Serviço do atendimento repetido na comanda.` / `Valor do atendimento inválido.` | P0001 | igual ao fechamento |
| `Atendimento coberto por pacote deve ficar com valor R$ 0,00.` | P0001 | vínculo gravado e valor > 0 |
| `Não é possível tirar um atendimento de uma comanda fechada.` | P0001 | atendimento da comanda ausente do payload |
| `Item da comanda inválido.` | P0001 | campos inválidos, sem `item_id`, tipo diferente do gravado, ou `item_id` novo que já é de outra comanda |
| `Item repetido na comanda.` | P0001 | `item_id` repetido |
| `Produtos e pacotes não podem ser alterados na edição.` | P0001 | produto/pacote com valor ou quantidade diferente |
| `Produtos e pacotes não podem ser incluídos na edição.` | P0001 | produto/pacote com `item_id` novo |
| `Produtos e pacotes não podem ser removidos na edição.` | P0001 | produto/pacote gravado ausente do payload |
| `Serviço não encontrado: <descricao>.` | P0001 | `servico_id` de serviço novo não é desta empresa |
| `Comanda vazia.` | P0001 | sem atendimentos e sem itens |
| `Desconto inválido.` / `O desconto não pode ser maior que o subtotal.` | P0001 | igual ao fechamento |
| `O desconto não pode ficar abaixo de R$ <x>: essa parte já foi lançada nos produtos e pacotes desta comanda.` | P0001 | desconto < parte congelada (`<x>` = `1.234,56`) |
| `O desconto não pode passar de R$ <x>: produtos e pacotes não ganham mais desconto na edição.` | P0001 | desconto maior do que cabe nas partes editáveis |
| `Pagamento inválido.` / `Taxa do cartão inválida.` / `O pagamento não cobre o total da comanda.` | P0001 | igual ao fechamento |
| `Pagamento repetido na comanda.` | P0001 | `pagamento_id` repetido |
| `Você não tem permissão para dar desconto ou cortesia.` | 42501 | mudou o desconto ou aumentou a cortesia sem `comanda.desconto` |
| `Comissão deste serviço já foi paga` | P0001 | trigger 085: remover serviço ou trocar a profissional com comissão paga |
| `Não foi possível remover o item da comanda.` | 42501 | DELETE do item acertou 0 linhas (RLS) |
| `Não foi possível salvar o item da comanda.` | 42501 | UPDATE do item acertou 0 linhas (RLS) |
| `Você não tem permissão para editar esta comanda.` | 42501 | UPDATE de `comandas` acertou 0 linhas (RLS) |
| `Não foi possível salvar o valor dos serviços do atendimento.` | P0001 | linha não pertence ao atendimento ou RLS |
| `Você não tem permissão para editar o atendimento desta comanda.` | 42501 | UPDATE do atendimento acertou 0 linhas |
| `Não foi possível substituir os pagamentos desta comanda.` | 42501 | DELETE apagou menos pagamentos do que quem chama enxerga |
| `duplicate key value violates unique constraint "comanda_itens_pkey"` | 23505 | `item_id` novo que já pertence a um item invisível para quem chama (mensagem do Postgres) |

Nova tentativa depois de queda de rede: reenviar o **mesmo** payload (mesmos `item_id` novos). Itens incluídos
na 1ª tentativa já existem e não duplicam; pagamentos mantidos guardaram o id original e continuam reconhecidos.

---

## 3. `registrar_venda_avulsa_v2(p_venda_id uuid, p_empresa uuid, p_cliente uuid, p_desconto numeric, p_itens jsonb, p_pagamentos jsonb) returns uuid`

Igual à `registrar_venda_avulsa` (087) — mesmos parâmetros, regras, trava e conferência de saldo, mesmas
mensagens — mais a chave:

| Parâmetro | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `p_venda_id` | uuid | **sim** | Gerado na tela **uma vez por carrinho** e reaproveitado na nova tentativa. Venda já existente nesta empresa → devolve o id sem gravar (antes de conferir estoque). Em outra empresa → erro. |
| `p_empresa` | uuid | sim | |
| `p_cliente` | uuid \| null | não | |
| `p_desconto` | numeric | não (null = 0) | `0 ≤ desconto ≤ subtotal`; > 0 exige `comanda.desconto` |
| `p_itens` | `[{ produto_id, quantidade, preco_unitario }]` | sim | não vazio; produto `tipo = 'venda'` e ativo; saldo suficiente |
| `p_pagamentos` | `[{ valor, metodo, bandeira, parcelas, taxa_perc, valor_liquido, maquininha_id }]` | sim | não vazio; soma ≥ total; cortesia > 0 exige `comanda.desconto`. (Como na 087, `taxa_perc` e `valor_liquido` vêm da tela.) |

```json
{ "p_venda_id": "V1", "p_empresa": "E", "p_cliente": null, "p_desconto": 0,
  "p_itens": [ { "produto_id": "PR2", "quantidade": 1, "preco_unitario": 60.00 } ],
  "p_pagamentos": [ { "valor": 60.00, "metodo": "pix", "bandeira": null, "parcelas": 1,
                      "taxa_perc": null, "valor_liquido": null, "maquininha_id": null } ] }
```

| Mensagem exata | code |
|---|---|
| `Você não tem permissão para registrar vendas avulsas.` | 42501 |
| `Venda sem identificador.` | P0001 |
| `Esta venda pertence a outra empresa.` | P0001 |
| `Carrinho vazio.` | P0001 |
| `Item da venda inválido.` | P0001 |
| `Desconto inválido.` | P0001 |
| `O desconto não pode ser maior que o subtotal.` | P0001 |
| `Pagamento não informado.` | P0001 |
| `Pagamento inválido.` | P0001 |
| `O pagamento não cobre o total da venda.` | P0001 |
| `Você não tem permissão para dar desconto ou cortesia.` | 42501 |
| `Produto indisponível para venda.` | P0001 |
| `Produto indisponível para venda: <nome>.` | P0001 |
| `Estoque insuficiente: <nome> (restam <saldo>)` | P0001 |
| `Este código de venda já foi usado. Recarregue a tela e tente de novo.` | P0001 |

---

## 4. Limitações conhecidas (não tratadas na 090)

- Vínculo explícito de pacote não confere sessões restantes (igual a hoje: só a tela confere).
- `cliente_id`/`maquininha_id`/`profissional_id` não são conferidos contra a empresa (igual à 087).
- Edição por quem não enxerga todos os atendimentos da comanda (comanda com atendimento de colega, sem
  `agenda.ver_equipe`): o rateio só considera os visíveis. A tela já não abre esse cartão.
- Nova tentativa de `editar_comanda` depois do commit: pagamentos **novos** da 1ª tentativa não têm
  `pagamento_id` no payload repetido, então são regravados como novos (mesmos valores, mesma data `fechada_at`).
- Editar comanda antiga (antes da 090) que tinha desconto passa a ratear esse desconto e reduz as comissões dela
  (inclusive pagas, regra da 075) já na 1ª edição.
- Subtotal no banco usa `round(valor_unit × quantidade, 2)` por item; a tela soma sem arredondar por item.
  Com quantidade fracionada pode haver 1 centavo de diferença na prévia.
