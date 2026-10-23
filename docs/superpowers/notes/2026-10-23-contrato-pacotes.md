# Contrato — Pacotes (migration 096)

Consumido pelas Tasks 5 a 7 da Paridade Serviços e Pacotes. Wrappers em `shared/pacotes-venda.ts`, cargas em
`shared/pacotes-consultas.ts`. As telas nunca chamam as funções direto: usam os wrappers.

## Colunas novas em `pacote_clientes`

| Coluna | Tipo | Regra |
|---|---|---|
| `cobranca` | `text not null default 'paga'`, check `('paga','pendente')` | `pendente` = "A cobrar" (vendido com "Cobrar na comanda"). Todos os antigos ficaram `paga` |
| `venda_id` | `uuid references vendas on delete set null` | Venda que cobrou o pacote. Nulo nos antigos e nos pendentes |

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
- `data_inicio` = hoje em Brasília; `data_validade` = hoje + `validade_dias`, ou nula sem validade; `status 'ativo'`.
- Permissões: `pacotes.vender`; desconto > 0 ou cortesia com valor exigem `comanda.desconto`.

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
  comanda, `cobranca 'pendente'` e não cancelado; `quantidade` = 1; não pode repetir na comanda. Ao fechar, passa a
  `cobranca 'paga'`, `valor_pago` = `valor_unit − cota do desconto da comanda` e `venda_id` = a venda dos pacotes
  da comanda (`observacao 'Pacote(s) via comanda'`). O `pacote_id` vem do próprio pacote vendido.
- Cobrar um pacote "a cobrar" exige só `comanda.fechar` (não `pacotes.vender`). Pacote novo (sem
  `pacote_cliente_id`) continua exigindo `pacotes.vender`.
- Pacote novo pela comanda agora também grava `cobranca 'paga'` e `venda_id`. A venda dos pacotes da comanda é
  gravada sempre que há item de pacote (mesmo de R$ 0).
- Tirar o item da comanda = não mandar o item: o pacote continua `pendente`.
- `editar_comanda` não muda: itens de pacote seguem congelados; `pacote_cliente_id` mandado na edição é ignorado.

## `excluir_pacote_cliente(p_empresa uuid, p_id uuid) returns void`

`security definer`. Exige ser da empresa e `pacotes.vender` (ou gestora/dona). Recusa com sessão usada. Na mesma
transação: desvincula os atendimentos (`pacote_cliente_id = null`), apaga o pacote e acerta a venda ligada: só esse
pacote → apaga a venda, os itens e os pagamentos dela; com outros pacotes → `valor_total` cai pelo `valor_pago`
dele. Pacote antigo (sem `venda_id`) ou pendente: só o pacote sai.

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
  `Este pacote foi cancelado: <descrição>. Tire o item da comanda.` · `Não foi possível cobrar o pacote: <descrição>.`
- `excluir_pacote_cliente`: `Pacote vendido não encontrado.` ·
  `Este pacote já tem sessões usadas. Para cancelar, fale com a dona.` · `Não foi possível excluir o pacote vendido.`
- `excluir_servico`: `Serviço não encontrado.` · `Este serviço já foi usado. Desative em vez de excluir.` ·
  `Não foi possível excluir o serviço.`

## Cargas (`shared/pacotes-consultas.ts`)

Todas paginadas (desempate por `id`) e lançam o erro do banco.

- `carregarCatalogoPacotes(db, empresaId): PacoteCatalogo[]`
- `carregarPacotesVendidos(db, empresaId): PacoteVendido[]` — com `usos`, `cobranca`, `venda_id` (sem a 096:
  `cobranca 'paga'`).
- `carregarPendentesCliente(db, empresaId, clienteId): PacotePendente[]` — entrada de `itensACobrar` (sem a 096: `[]`).
- `carregarCandidatosVinculo(db, empresaId, clienteId): PacoteClienteRaw[]` — entrada de `calcularPacotesAtivosCliente`.
- `carregarRelatorioUtilizacao(db, empresaId)` / `calcularRelatorioUtilizacao(vendidos)` — receita só dos `paga`.
