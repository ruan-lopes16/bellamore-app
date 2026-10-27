# Contrato — Pacotes (migration 096)

Consumido pelas Tasks 5 a 7 da Paridade Serviços e Pacotes. Wrappers em `shared/pacotes-venda.ts`, cargas em
`shared/pacotes-consultas.ts`. As telas nunca chamam as funções direto: usam os wrappers.

## Colunas novas em `pacote_clientes`

| Coluna | Tipo | Regra |
|---|---|---|
| `cobranca` | `text not null default 'paga'`, check `('paga','pendente')` | `pendente` = "A cobrar" (vendido com "Cobrar na comanda"). Todos os antigos ficaram `paga` |
| `venda_id` | `uuid references vendas on delete set null` | Venda que cobrou o pacote. Nulo nos antigos e nos pendentes |
| `comanda_id` | `uuid references comandas on delete set null` | Comanda que cobrou o pacote (novo pela comanda ou "a cobrar"). Nulo nos antigos, nos pendentes e nos vendidos com "Cobrar agora" |

### Guardas (revisão)

- **Escrita direta pela API** (papéis `authenticated`/`anon`) em `pacote_clientes`: INSERT recusado
  (`Pacote vendido só é gravado pela venda de pacote. Recarregue a tela e tente de novo.`), e UPDATE de
  `cobranca`, `venda_id`, `comanda_id`, `valor_pago` ou `empresa_id` recusado
  (`A cobrança do pacote vendido só muda pela venda ou pela comanda.`). Só `vender_pacote` e `fechar_comanda`
  gravam. `status` e as demais colunas continuam livres (Pacotes marca "concluído").
  **Deploy:** a tela antiga (insert direto) deixa de vender pacote assim que a 096 roda — rode a 096 junto
  com o deploy. O caminho antigo das telas novas só existe sem a 096, então não é afetado.
- **Venda de pacote não é apagada direto** (`Esta venda é de pacote e não pode ser apagada aqui. Para desfazer,
  exclua o pacote vendido em Pacotes.`).
- **Pagamento numa venda de pacote** pela permissão `pacotes.vender` só de dentro da `vender_pacote`, e só na
  venda "agora".

## `vender_pacote(p jsonb) returns void`

`security invoker`. Chave contra repetição: `venda_id` (a nova tentativa com a mesma chave não grava nada e
não dá erro).

```json
{
  "venda_id":   "uuid (chave gerada uma vez por modal)",
  "empresa_id": "uuid",
  "cliente_id": "uuid (obrigatório)",
  "pacote_id":  "uuid (do catálogo da empresa)",
  "quantidade": 2,
  "valor_unit": 300.00,
  "desconto":   10.00,
  "cobranca":   "agora | comanda",
  "pagamentos": [
    { "valor": 290.00, "metodo": "dinheiro|pix|credito|debito|cortesia",
      "bandeira": "visa|null", "parcelas": 1, "taxa_perc": 0.0499, "maquininha_id": "uuid|null" }
  ]
}
```

- `quantidade`: inteiro de 1 a 100. Um `pacote_clientes` por unidade.
- `desconto` em R$, de 0 ao subtotal (`valor_unit × quantidade`). O líquido (subtotal − desconto) é dividido em
  centavos entre as unidades (o resto, 1 centavo cada, vai nas primeiras) e vira o `valor_pago` de cada uma.
- **`agora`**: `pagamentos` obrigatório (o mesmo formato e a mesma regra da `registrar_venda_avulsa_v2`): total
  coberto, troco permitido, total zero com uma cortesia R$ 0 (a tela manda a linha de `montarPagamentos`). O banco
  calcula `valor_liquido = valor × (1 − taxa_perc)` só no cartão; fora do cartão bandeira/taxa/maquininha são
  ignoradas. Grava `vendas` (`id = venda_id`, `observacao 'Pacote'`, `valor_total` = subtotal, `desconto`),
  os `pacote_clientes` (`cobranca 'paga'`, `venda_id`) e os `pagamentos` (`venda_id`, `status 'pago'`).
- **`comanda`**: `pagamentos` tem de ir vazio. Grava só os `pacote_clientes` com `cobranca 'pendente'`,
  `valor_pago` = valor combinado (líquido rateado) e `venda_id` nulo. Nada entra no faturamento.
- Nos dois modos o 1º `pacote_clientes` recebe `id = venda_id` (é por ele que a repetição é reconhecida).
  A mesma chave noutro modo (`comanda` depois de `agora`, ou o contrário) é recusada com
  `Este código de venda já foi usado...`: a tela gera uma chave nova quando o modo, a cliente, o pacote, a
  quantidade, o valor ou o desconto mudam (assinatura de `argumentosVendaPacote`).
- `data_inicio` = hoje em Brasília; `data_validade` = hoje + `validade_dias`, ou nula sem validade; `status 'ativo'`.
- Permissões: `pacotes.vender`; desconto > 0 ou cortesia com valor exigem `comanda.desconto`;
  `valor_unit` diferente do preço do catálogo (`pacotes.preco`, para baixo ou para cima, nos dois modos) também exige `comanda.desconto`
  (`Você não tem permissão para mudar o valor do pacote.`, 42501) — sem isso o valor funcionaria como desconto sem permissão.
  As telas usam a mesma regra (`valorPacoteEditavel` e `motivoBloqueioVendaPacote` em `shared/pacotes-venda.ts`): o campo
  "Valor (cada)" só é editável com `comanda.desconto`.

Wrapper:

```ts
venderPacote(db, {
  vendaId, empresaId, clienteId, pacoteId, quantidade, valorUnit, desconto,
  cobranca: 'agora' | 'comanda',
  pagamentos: PagamentoPacote[],   // LinhaPagamento de montarPagamentos serve como está
}): Promise<void>
argumentosVendaPacote(entrada)     // o JSON acima (para a assinatura da tentativa)
```

## Item da comanda: pacote "a cobrar" (`fechar_comanda`, mesma assinatura)

Item de `itens[]` do JSON da `fechar_comanda` (formato de `itensACobrar`, `shared/pacotes.ts`):

```json
{ "tipo": "pacote", "pacote_id": "uuid", "pacote_cliente_id": "uuid do pendente",
  "descricao": "Pacote X — a cobrar", "quantidade": 1, "valor_unit": 300.00 }
```

- Com `pacote_cliente_id`: não cria outro pacote. O existente tem de ser da mesma empresa, da cliente da
  comanda, `cobranca 'pendente'` e não cancelado; `quantidade` = 1; não pode repetir na comanda; `valor_unit` =
  o `valor_pago` do pendente (o combinado na venda; `itensACobrar` já manda assim) — desconto só pelo desconto da
  comanda. Ao fechar, passa a `cobranca 'paga'`, `valor_pago` = `valor_unit − cota do desconto da comanda`,
  `venda_id` = a venda dos pacotes da comanda (`observacao 'Pacote(s) via comanda'`) e `comanda_id` = a comanda.
  O `pacote_id` vem do próprio pacote vendido.
- Cobrar um pacote "a cobrar" exige só `comanda.fechar` (não `pacotes.vender`). Pacote novo (sem
  `pacote_cliente_id`) continua exigindo `pacotes.vender`.
- Pacote novo pela comanda agora também grava `cobranca 'paga'`, `venda_id` e `comanda_id`. A venda dos pacotes da comanda é
  gravada sempre que há item de pacote (mesmo de R$ 0).
- Tirar o item da comanda = não mandar o item: o pacote continua `pendente`.
- `editar_comanda` não muda: itens de pacote seguem congelados; `pacote_cliente_id` mandado na edição é ignorado.

## `excluir_pacote_cliente(p_empresa uuid, p_id uuid) returns void`

`security definer`. Exige ser da empresa e `pacotes.vender` (ou gestora/dona). Recusa com sessão usada e com
pacote cobrado numa comanda (`comanda_id` preenchido: a comanda manteria item e pagamentos, e a edição da comanda
não tira pacotes). Exclui só o pendente ("a cobrar") e o vendido com "Cobrar agora". Na mesma
transação: desvincula os atendimentos (`pacote_cliente_id = null`), apaga o pacote e acerta a venda ligada: só esse
pacote → apaga a venda, os itens e os pagamentos dela; com outros pacotes → `valor_total` cai pelo `valor_pago`
dele (os pagamentos da venda ficam: devolução de uma unidade é manual). Pacote antigo (sem `venda_id` nem
`comanda_id`, anterior à 096) ou pendente: só o pacote sai.

O DELETE direto em `pacote_clientes` passou a valer só para gestora/dona.

Wrapper: `excluirPacoteCliente(db, empresaId, id): Promise<void>`.

## `excluir_servico(p_empresa uuid, p_id uuid) returns void`

`security definer`. Exige ser da empresa e `servicos.gerenciar`. Recusa se o serviço aparece em atendimento,
`agendamento_servicos`, item de comanda, pacote (`pacote_servicos`) ou `pacote_uso`. Os insumos saem por cascata.

Wrapper: `excluirServico(db, empresaId, id): Promise<void>`.

## Erros dos wrappers

- Sem a 096 (`PGRST202`): `SemMigration096` — a tela usa o caminho antigo.
- Rede caiu (erro sem código): `ErroPacote` com `semResposta = true` — conferir antes de repetir (a mesma
  `vendaId` não duplica).
- Demais: `ErroPacote` com a mensagem de `mensagemErroBanco` (texto da função em português, como veio).

## Mensagens das funções

Permissão (errcode `42501`):
- `Você não tem permissão para vender pacotes.`
- `Você não tem permissão para dar desconto ou cortesia.`
- `Você não tem permissão para mudar o valor do pacote.`
- `Você não tem permissão para excluir pacote vendido.`
- `Você não tem permissão para excluir serviços.`
- `Você não faz parte desta empresa.` (exclusões)

Regra (`P0001`):
- `vender_pacote`: `Dados da venda do pacote inválidos.` · `Venda sem identificador.` ·
  `Para vender pacote, escolha uma cliente cadastrada.` · `Esta venda pertence a outra empresa.` ·
  `Quantidade de pacotes inválida (de 1 a 100).` · `Valor do pacote inválido.` · `Desconto inválido.` ·
  `O desconto não pode ser maior que o subtotal.` · `Pacote não encontrado nesta empresa.` ·
  `Pacote desativado: <nome>. Ative no catálogo antes de vender.` · `Pagamento inválido.` ·
  `Pagamento não informado.` · `Taxa do cartão inválida.` · `O pagamento não cobre o total da venda.` ·
  `Na cobrança pela comanda, o pagamento é lançado ao fechar a comanda.` ·
  `Cliente não encontrada nesta empresa.` · `Maquininha não encontrada nesta empresa.` ·
  `Este código de venda já foi usado. Recarregue a tela e tente de novo.`
- `fechar_comanda` (novas): `Pacote a cobrar repetido na comanda.` ·
  `Pacote a cobrar entra na comanda com quantidade 1.` · `Pacote a cobrar não encontrado: <descrição>.` ·
  `Este pacote a cobrar é de outra cliente: <descrição>.` ·
  `Este pacote já foi cobrado: <descrição>. Tire o item da comanda.` ·
  `Este pacote foi cancelado: <descrição>. Tire o item da comanda.` · `Não foi possível cobrar o pacote: <descrição>.` ·
  `O valor do pacote a cobrar não pode ser alterado: <descrição>. Para dar desconto, use o desconto da comanda.`
- `excluir_pacote_cliente`: `Pacote vendido não encontrado.` ·
  `Este pacote já tem sessões usadas. Para cancelar, fale com a dona.` ·
  `Este pacote foi cobrado numa comanda e não pode ser excluído aqui. Para cancelar, fale com a dona.` ·
  `Não foi possível excluir o pacote vendido.`
- `excluir_servico`: `Serviço não encontrado.` · `Este serviço já foi usado. Desative em vez de excluir.` ·
  `Não foi possível excluir o serviço.`

## Cargas (`shared/pacotes-consultas.ts`)

Todas paginadas (desempate por `id`) e lançam o erro do banco.

- `carregarCatalogoPacotes(db, empresaId): PacoteCatalogo[]`
- `carregarPacotesVendidos(db, empresaId): PacoteVendido[]` — com `usos`, `cobranca`, `venda_id` (sem a 096:
  `cobranca 'paga'`).
- `carregarPendentesCliente(db, empresaId, clienteId): PacotePendente[]` — entrada de `itensACobrar` (sem a 096: `[]`).
- `carregarCandidatosVinculo(db, empresaId, clienteId): PacoteClienteRaw[]` — entrada de `calcularPacotesAtivosCliente`.
- `carregarRelatorioUtilizacao(db, empresaId)` / `calcularRelatorioUtilizacao(vendidos)` — receita só dos `paga`, por
  `coalesce(valor_pago, preço do catálogo)` (pacote antigo sem `valor_pago` conta o preço, como a tela antiga).

## Status exibido (`statusPacoteCliente`, shared/pacotes.ts)

`'ativo' | 'concluido' | 'expirado' | 'cancelado'`. `cancelado` gravado sai como `cancelado` (a tela mostra
"Cancelado"; não entra nos filtros Ativos/Concluídos/Expirados, só em Todos). Saldo pela mesma regra do trigger
`fn_registrar_uso_pacote`: total = soma das quantidades, usadas = todas as linhas de `pacote_uso`, serviço
ilimitado nunca esgota; o saldo por serviço é só exibição.
