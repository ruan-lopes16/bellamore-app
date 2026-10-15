# Inventário das gravações da comanda (fechamento e edição)

Data: 2026-10-15 · Branch `feat/pendencias-registradas` (igual à `main`, após o PR #151).
Objetivo: base para as funções de banco (plpgsql, `security invoker`, uma transação cada) que vão
gravar o **fechamento** e a **edição** da comanda de uma vez, no modelo da
`supabase/migrations/087_registrar_venda_avulsa.sql`.

Abreviações de arquivo:
- **W** = `web/app/(app)/comanda/page.tsx`
- **M** = `mobile/app/(empresa)/nova-comanda.tsx`
- **SC** = `shared/comanda.ts` · **SF** = `shared/comanda-fechamento.ts` · **SQ** = `shared/comanda-consultas.ts`
- **TR** = `shared/taxa-reserva.ts` · **PA** = `shared/pacotes.ts`
- **mig NNN** = `supabase/migrations/NNN_*.sql`

---

## 0. O que a tela já calculou antes de gravar

Os dois lados usam a mesma conta (W:949-966, M:773-797):

| Valor | Cálculo | Fonte |
|---|---|---|
| `subtotal` | Σ `valor × quantidade` de **todos** os itens: atendimentos, serviços extras, produtos e pacotes | W:950, M:774 |
| `descontoN` (manual, em R$) | `calcularDesconto(subtotal, entrada, modo)`; o modo pode ser % ou R$. Acima do subtotal: erro e valor limitado ao subtotal | SF:189-193; W:951-952, M:775-776 |
| `descontoReservaN` | soma de `taxas_reserva.valor` com `status='pago'` dos atendimentos presentes na comanda | TR:51 (`somarTaxasReservaPagas`); a leitura está em W:357-361 e M:319-322 |
| `descontoReservaAplicado` | `min(reserva, max(subtotal − manual, 0))` | TR:66-77 |
| `total`, `recebido`, `falta`, `troco`, `cortesiaAutomatica`, `podeFechar` | `resumoComanda`. O total precisa estar coberto, com tolerância de 0,005. Troco é permitido. Total abaixo de 0,01 vira cortesia | SF:223-238 |
| linhas de `pagamentos` | `montarPagamentos(splits, {empresaId, comandaId, config, total})`. Cartão grava maquininha, bandeira, parcelas, taxa e líquido. Sem nenhum split e total R$ 0, grava uma linha de cortesia R$ 0. Na edição, um split reaberto sem mudança mantém a taxa e o `created_at` | SF:292-330 (taxa em `taxaDoSplit` SF:271-282) |
| valor por atendimento | `agruparValoresPorAgendamento(itens, pacoteLinks)`: `novoValorTotal` = Σ das linhas do atendimento presentes na comanda, mais as `linhasServico` (`agendamento_servicos`) e o `pacoteClienteId`. Chave ausente = não mexe. `null` = desvincula | SC:54-93 |

**Pré-preenchimento ao abrir uma comanda nova** (W:510-573, M:510-555). Entram os atendimentos com
`status <> 'concluido' OR comanda_id IS NULL`. Atendimento multi-serviço vira uma linha por
`agendamento_servicos`, com `ag_servico_id`. Atendimento com `pacote_cliente_id` já gravado (vínculo
feito na Agenda) entra com valor 0, e `pacoteLinks` é semeado com esse vínculo.

> **Tudo vem da tela.** O banco não recalcula nenhum desses números: `comandas.valor_total` e
> `desconto`, `agendamentos.valor`, `vendas.valor_total` e `pagamentos.taxa_perc`/`valor_liquido`
> são gravados como chegam. A função nova deve recalcular no banco o que puder, como a 087 faz com
> `valor_total`.

---

## 1. Fechamento (comanda nova)

### 1.1 Guardas antes de gravar

| # | Guarda | W | M |
|---|---|---|---|
| G1 | `resumo.podeFechar` (total coberto, desconto até o subtotal) | 1018 | 980-983 |
| G2 | `bloqueioTaxaReserva`: a leitura das taxas pagas falhou e há atendimento na comanda | 1019 (regra em 964-966) | 984 (792-794) |
| G3 | configuração de cartões carregada | 1020 (`configPronta`) | a configuração carrega junto com o dia (M:284-289) |
| G4 | comanda existente → desvia para a edição | 1021 | 986 |
| G5 | `comanda.fechar` | só no botão (2027) | 987 |
| G6 | `comandasParciais[cliente]`: uma comanda só com extras desta cliente foi criada e não terminou de gravar | 1023 | 989 |
| G7 | item `pacote` sem `pacotes.vender` → barra antes de gravar | 1026-1029 | 992-995 |
| G8 | **contra fechamento em dobro:** `SELECT id FROM agendamentos WHERE id IN (...) AND comanda_id IS NOT NULL`. Achou linha → aborta | 1036-1045 | 1001-1010 |
| G9 | atendimento de outra profissional sem `agenda.gerenciar_outras` → o cartão nem abre | 493-495 | 506-508 |

G8 é uma leitura separada do UPDATE. Duas abas podem passar por ela ao mesmo tempo (corrida
residual); só a transação única com `UPDATE ... WHERE comanda_id IS NULL` fecha essa brecha.

### 1.2 Gravações, na ordem real

| Passo | Tabela · operação | Colunas e origem do valor | Filtro e conferência | W | M |
|---|---|---|---|---|---|
| F1 | `comandas` · INSERT, **sem RETURNING** | `id = novoUuid()` gerado no cliente; `profissional_id = meuUserId` (quem fechou, para a policy de SELECT); `empresa_id`; `clientes_id` (null se `__sem__`); `valor_total = subtotal`; `desconto = descontoN + descontoReservaAplicado`; `desconto_reserva = descontoReservaAplicado`; `status='fechada'`; `fechada_at = new Date()` do aparelho. `valor_final` é coluna gerada (`valor_total − desconto`, mig 001:100) | só `error` | 1052-1069 | 1016-1028 |
| F2 | `agendamentos` · UPDATE, **um por atendimento** | `valor = novoValorTotal`, `status='concluido'`, `comanda_id`, e `pacote_cliente_id` quando a chave está presente (string ou null). **Tudo no mesmo UPDATE**, porque os triggers só olham a transição para `concluido` | `.eq('id')`; M também filtra `.eq('empresa_id')`. `.select('id')` conta 0 linhas como erro (RLS silenciosa) | 720-741, chamada em 1091-1094 | 823-850, chamada em 1058-1062 |
| F3 | `agendamento_servicos` · UPDATE, um por linha, só multi-serviço | `valor = linha.valor`. Uma linha tirada da comanda **não** é regravada e mantém o valor antigo | `.eq('id')` (M também por `empresa_id`), com conferência de 0 linhas | 742-746 | 851-858 |
| F4 | `comanda_itens` · INSERT em lote, só extras | `comanda_id`, `empresa_id`, `tipo` (servico/produto/pacote), `descricao`, `servico_id`/`produto_id`/`pacote_id`, `profissional_id` (só serviço; vazio = null), `quantidade`, `valor_unit = valor` | só `error` → `falharAposCriar` | 1097-1114 | 1065-1076 |
| F5 (W) | `pacote_clientes` · INSERT | um registro por unidade (`round(quantidade)`): `pacote_id`, `cliente_id`, `data_inicio` = hoje no aparelho, `data_validade` = hoje + `validade_dias` (ou null), `valor_pago = valor` unitário, `status='ativo'`. **Não é feito com `__sem__`** | `error` | 1117-1139 | — (no app é o passo F8) |
| F6 (W) | `vendas` · INSERT, venda do pacote | `valor_total` = Σ `valor_pago`, `desconto=0`, `observacao='Pacote(s) via comanda'`. Sem `id` do cliente e sem RETURNING. **Não grava `venda_itens`** | `error`; só se total > 0 | 1141-1153 | — (no app é o passo F9) |
| F7 | `estoque_movimentos` · INSERT em lote | `produto_id`, `empresa_id`, `tipo='saida'`, `quantidade`, `motivo='Produto via comanda — X'`, `agendamento_id = agIds[0] ?? null` (o ramo de RLS da profissional) | **falha só avisa** (`alert`/`Alert`) e o fechamento segue | 1157-1174 | 1079-1090 |
| F8 | `vendas` · INSERT, venda dos produtos | `id = novoUuid()`, `cliente_id` (null se `__sem__`), `valor_total` = Σ `valor × qtd` dos produtos, `desconto=0`, `observacao='Via comanda'` | `error` → `falharAposCriar` | 1176-1190 | 1091-1101 |
| F9 | `venda_itens` · INSERT | `venda_id`, `produto_id`, `quantidade`, `preco_unitario = valor` | `error` | 1192-1201 | 1102-1109 |
| (M) F5/F6 | `pacote_clientes` + `vendas` do pacote | iguais a F5/F6 do web, mas **depois** de estoque e produtos | `error` | — | 1112-1150 |
| F10 | `pagamentos` · INSERT em lote | linhas de `montarPagamentos` com `comanda_id`, `valor`, `metodo`, `bandeira`, `parcelas`, `taxa_perc`, `valor_liquido`, `maquininha_id` (só com a 086), `status='pago'` e `created_at` default `now()` | `error` → `falharAposCriar` | 1204-1213 | 1152-1164 |

**Depois das gravações:** a lista local passa por `marcarAgendamentosFechados` (SC:106-113;
W:1219, M:1174-1182). O web recarrega o backlog; o app invalida o cache financeiro e o estoque e
recarrega o backlog (M:1166-1171).

**Falha no meio:** `falharAposCriar` (W:1079-1082, M:1037-1041) só marca a comanda como parcial
quando ela não tem atendimento. Nada é desfeito: a comanda fica órfã e a receita fica parcial.

### 1.3 Casos de uso

| Caso | O que muda nas gravações | Referência |
|---|---|---|
| **Atendimento simples** (legado, sem `agendamento_servicos`) | F2 com `valor` = valor do item. `linhasServico` vazio, então F3 não roda | SC:47-49 |
| **Multi-serviço** | F2 com `valor` = Σ das linhas; F3 uma por linha. Pela RLS, a comissão é **uma só**, para `agendamentos.profissional_id`, sobre o total | SC:76-79 |
| **Sessão de pacote vinculada** (na comanda ou na Agenda) | o item zera (W:900-903, M:745-748), F2 grava `pacote_cliente_id`, e o trigger 078 grava `pacote_uso`. O trigger 065 não gera comissão. A receita exclui o atendimento (pacote não nulo) | mig 078:67-75, mig 065:28-30 |
| **Desvincular** | `pacoteLinks[ag] = null`; o valor volta ao de tabela (W:914-925, M:750-771). F2 grava `pacote_cliente_id = null`. Com `comanda_id` preenchido, o trigger 078 **não** busca pacote sozinho | mig 078:76, 105-107 |
| **"Vender pacote novo"** | hoje é só o item `tipo='pacote'`: F4 (item com `pacote_id`), F5 e F6. O pacote vendido **não** é vinculado a nenhum atendimento da mesma comanda. Exige cliente cadastrado (W:1771, M:1796) e `pacotes.vender` (G7). O fluxo antigo de "vender e já vincular" não existe mais nas telas | W:1116-1155, M:1112-1150 |
| **Combo** (`controla_sessoes=false`) | a comanda não oferece vínculo (`calcularPacotesAtivosCliente` filtra combo, PA:53-54). Se a Agenda vinculou um combo: o item entra R$ 0 e travado (W:1616), mas sem badge e sem "Desvincular", porque o combo não está em `pacotesClienteAtivos`; a tela ainda oferece vincular outro pacote. O trigger 078 não grava `pacote_uso` (filtro da 037) e o 065 não gera comissão | mig 078:72-75 |
| **Serviço extra com profissional** | F4 com `tipo='servico'` e `profissional_id`. O trigger 085 cria a comissão | mig 085:40-56 |
| **Produto extra** | F4 (item), F7 (estoque, falha só avisa), F8 e F9 (venda) | acima |
| **Taxa de reserva paga** | só entra no cálculo (`desconto_reserva` e `desconto` em F1). Nenhuma escrita em `taxas_reserva`; no F2, o trigger 061 só passa `pendente` → `cancelada` | mig 061:57-62 |
| **Cortesia R$ 0** (pacote cobrindo tudo ou desconto de 100%) | F10 grava **uma** linha `metodo='cortesia'`, `valor=0` | SF:304-306 |
| **Comanda só com extras** (sem atendimento) | F2 e F3 não rodam; G8 não protege. Por isso existe `comandasParciais`. A comanda fica visível à profissional por `comandas.profissional_id` (mig 089:56-62). F7 sai com `agendamento_id = null` (ver RLS, §4) | W:1075-1082 |
| **Cliente avulso** (`__sem__`) | `comandas.clientes_id = null`, `vendas.cliente_id = null`. Vender pacote é bloqueado na tela (F5/F6 não rodam). Não há leitura de pacotes ativos (W:296, M:462) | — |

### 1.4 Diferenças web × app no fechamento

| Ponto | Web | App |
|---|---|---|
| Ordem pacote × produtos | F5/F6 (pacote) **antes** de F7-F9 (W:1116-1202) | F7-F9 **antes** de F5/F6 (M:1078-1150) |
| Filtro `empresa_id` nos UPDATEs | não | sim (M:848, 853) |
| `agIds` | com repetição (W:1072, inofensivo) | `Set`, sem repetição (M:1030) |
| `comanda.fechar` no código | só no botão | também na função (M:987) |
| Depois de uma falha | mostra o erro, sem recarregar | recarrega o dia (`falharFechamento`, M:804-813) |
| Aviso de estoque | `alert()` (W:1173) | `Alert.alert` (M:1090) |
| Tirar atendimento | remove **por linha** (W:896-898). Tirar só parte de um multi-serviço reduz o total e deixa o `agendamento_servicos` da linha tirada com o valor antigo | `tirarAtendimento` tira **todas** as linhas e limpa o vínculo (M:717-728) |
| Quantidade de extra | campo livre, decimal (W:934-937) | botões ±1 (M:737-739) |
| `data_inicio`/`data_validade` do pacote e `fechada_at` | relógio e fuso do aparelho, nos dois | igual |

---

## 2. Edição de comanda fechada

### 2.1 Abertura

| Leitura | W | M |
|---|---|---|
| atendimentos **desta** comanda (`ag.comanda_id === comandaId`) | 586 | 584 |
| `comandas(desconto, desconto_reserva)`. O desconto manual reabre em R$: `desconto − desconto_reserva` | 623, 642-643 | 610, 630 |
| `comanda_itens` (base do diff) | 624, 645-654 | 611-613, 632-642 |
| `pagamentos` (taxa, maquininha e `created_at` de cada um) | 626, 694-701 | 615, 686-693 |
| comissões pagas dos itens: trava profissional e remoção | `carregarComissoesPagasDosItens` (SQ:418-427), W:659-669 | M:647-659 |
| qualquer falha em `cargaFalhou` trava o Salvar | 631-636 | 620-626 |

### 2.2 O que fica só para leitura na edição

| Item | Regra | W | M |
|---|---|---|---|
| produto e pacote: valor, quantidade, remoção | travados | 1610-1611, 1637-1640 | 1612, 1661-1663 |
| quantidade de **qualquer** extra (inclusive serviço) | travada | 1637-1640 | 1661-1663 |
| atendimento: remover | proibido (continuaria `concluido` com esta `comanda_id`) | 1617 (`podeRemover`) | 711-712, 1617 |
| vincular ou desvincular pacote | escondido; o badge é só informativo | 1711-1735 | 1716-1735 |
| adicionar produto ou pacote | escondido | 1761-1779 | 1784, 1796 |
| serviço extra com comissão paga: profissional e remoção | travados | 1616-1617, 1695-1697 | 1616-1617 |
| **editável** | valor dos atendimentos (por linha), valor e profissional dos serviços extras, novo serviço extra, desconto e pagamentos | — | — |

### 2.3 Gravações, na ordem real

| Passo | Tabela · operação | Detalhe | W | M |
|---|---|---|---|---|
| E0 | diff | `diffItensComanda(itensOriginais, extras atuais)` → `inserir`, `atualizar` (valor, qtd, profissional), `apagar` | 809-813 (SF:345-361) | 892-896 |
| E1 | `comanda_itens` · DELETE por id | `.select('id')` com conferência de 0 linhas. O trigger 085 (`apagar_comissao_item`) **recusa** se a comissão já foi paga | 815-818 | 898-903 |
| E2 | `comanda_itens` · UPDATE por id | `valor_unit`, `quantidade`, `profissional_id`. O trigger 085 reconcilia a comissão e recusa troca de profissional com comissão paga | 819-824 | 904-910 |
| E3 | `comanda_itens` · INSERT | igual a F4. O trigger 085 cria a comissão com `created_at = now()` (**data da edição**) | 825-832 | 911-918 |
| E4 | `comandas` · UPDATE | `valor_total = subtotal`, `desconto = manual + reserva`, `desconto_reserva`. **`fechada_at` não muda** | 835-840 | 921-927 |
| E5 | `agendamentos` · UPDATE (só `valor`) e `agendamento_servicos` · UPDATE | `persistirValoresAgendamento()` sem status e sem vínculo. O trigger 075 acerta `comissoes.valor_servico` (pendente **e** paga) | 844-845 | 930-931 |
| E6 | `pagamentos` · DELETE `where comanda_id` | web **não confere o erro** do DELETE (849) e só conta o que sobrou (`conferirDeleteVazio`, 773-781). App confere erro e contagem | 849-851 | 935-944 |
| E7 | `pagamentos` · INSERT | `montarPagamentos`: reabertos sem mudança mantêm `taxa_perc`, `maquininha_id` e `created_at`; os novos ganham `created_at = now()`. Falha aqui deixa a comanda **sem pagamento** | 853-859 | 945-952 |

Qualquer falha liga `cargaFalhou` e obriga a reabrir a comanda (W:792-796, M:885-889). Nada é
desfeito.

**Diferenças web × app na edição:** o app filtra por `empresa_id` em todos os UPDATEs e DELETEs, e
o web não. O app confere o erro do DELETE de pagamentos. O app checa `comanda.editar_fechada` na
função (M:882); o web só no cartão (W:1367). O **banco não confere `comanda.editar_fechada` em
lugar nenhum**: as policies de UPDATE de `comandas` e `comanda_itens` e a de DELETE de
`pagamentos` (mig 089) não usam a chave.

---

## 3. Triggers e funções disparados

Os triggers AFTER da mesma tabela disparam em ordem alfabética do nome. Nenhum dos de
`agendamentos` lê o resultado de outro.

| Trigger (tabela · evento) | Função · definição vigente | `security definer` | O que grava | Depende da ordem? |
|---|---|---|---|---|
| `trg_check_agendamento_bloqueio` (agendamentos · BEFORE INSERT/UPDATE) | `check_agendamento_bloqueio`, mig 074:37-82 | sim | nada; recusa se cair num bloqueio | só age quando muda o horário ou a profissional (074:50-55). F2 e E5 não mudam: no-op |
| `trg_gerar_comissao` (agendamentos · AFTER UPDATE) | `gerar_comissao`, **mig 065:21-53** | sim | `comissoes` com `valor_servico = NEW.valor`, `percentual = empresa_membros.percentual_comissao` da profissional do atendimento e `created_at = now()`. Pula se `pacote_cliente_id` não é nulo ou se o percentual é nulo ou 0 | **sim:** só na transição `OLD.status <> 'concluido'` → `concluido`. `valor` e `pacote_cliente_id` têm que estar **no mesmo UPDATE** do status. Um UPDATE de `valor` depois disso cai no 075 |
| `trg_gerar_taxa_cancelamento` (agendamentos · AFTER UPDATE) | `gerar_taxa_cancelamento`, mig 052:22+ | sim | `taxas_cancelamento` (cancelado/faltou) ou anulação ao reverter | no-op para `concluido` |
| `trg_reter_taxa_reserva` (agendamentos · AFTER UPDATE) | `reter_taxa_reserva`, **mig 061:46-94** | sim | ao virar `concluido`: `taxas_reserva` pendente → `cancelada`. Desfazer a conclusão reativa | só na mudança de status. Não mexe nas `pago` (essas são as descontadas) |
| `trg_sincronizar_comissao_valor` (agendamentos · AFTER UPDATE OF valor) | `sincronizar_comissao_valor`, mig 075:156-175 | sim | `comissoes.valor_servico = NEW.valor` de **todas** as comissões do atendimento (inclusive pagas) | só quando já estava `concluido` (OLD e NEW). No fechamento não age; na edição (E5), age |
| `trg_uso_pacote` (agendamentos · AFTER UPDATE) | `fn_registrar_uso_pacote`, **mig 078:54-126** | sim, **sem `SET search_path`** | `pacote_uso` (`ON CONFLICT (agendamento_id) DO NOTHING`, uma sessão por atendimento, `servico_id = NEW.servico_id` = 1º serviço) | **sim:** só na transição para `concluido`. Lê `NEW.pacote_cliente_id` e `NEW.comanda_id` (com `comanda_id` preenchido e sem vínculo, não busca nada). **Não confere sessões restantes no vínculo explícito**: quem confere é só a tela |
| `trg_gerar_comissao_item` (comanda_itens · AFTER INSERT) | `gerar_comissao_item`, mig 085:40-56, 121-123 | sim | `comissoes` com `comanda_item_id`, `valor_servico = round(valor_unit × quantidade, 2)` e `created_at = now()`, se tipo serviço com profissional, valor > 0 e percentual > 0 | não |
| `trg_sincronizar_comissao_item` (comanda_itens · AFTER UPDATE) | `sincronizar_comissao_item`, mig 085:59-107 | sim | atualiza, cria ou apaga a comissão do item. **Recusa** troca de profissional ou de tipo se a comissão já foi paga | lê `comissoes.status` |
| `trg_apagar_comissao_item` (comanda_itens · BEFORE DELETE) | `apagar_comissao_item`, mig 085:109-133 | sim | apaga a comissão pendente; **recusa** se paga | — |
| `trg_atualizar_estoque` (estoque_movimentos · AFTER INSERT) | `atualizar_estoque`, **mig 083:595+** (definer desde a 083) | sim | `produtos.estoque_atual −= quantidade` (saída). **Pega lock de linha** em `produtos` | — |
| `trg_notif_estoque_baixo` (estoque_movimentos · AFTER INSERT) | `notificar_estoque_baixo`, mig 028:4-45 | sim, sem `search_path` | `notificacoes` para a dona quando o saldo fica no mínimo ou abaixo | depende de o 001/083 já ter baixado (`trg_atualizar_estoque` < `trg_notif_estoque_baixo` na ordem alfabética: ok) |

**Não há trigger** em `comandas`, `pagamentos`, `vendas`, `venda_itens`, `pacote_clientes` nem
`agendamento_servicos`. Notificações: só a de estoque baixo, que esta gravação dispara. As de
bloqueio (mig 069) e os lembretes (070/071/076, por `pg_cron`) não são afetados.
`check_conflito_horario` foi removido na mig 020:31-32. Insumos do serviço (`servico_produtos`)
**não** são baixados pela comanda.

---

## 4. RLS de cada tabela gravada (última definição até a 089)

Padrões da **profissional** (mig 083:75-78): ✔ `comanda.fechar`, `comanda.desconto`,
`comanda.editar_fechada`, `pacotes.vender`, `clientes.*`, `anamnese.*`. ✘ `vendas.acessar`,
`estoque.acessar`, `agenda.gerenciar_outras`, `agenda.ver_equipe`, `financeiro.ver`,
`comissoes.*`.

| Tabela · operação | Policy vigente | Profissional (padrões) |
|---|---|---|
| `agendamentos` SELECT (G8) | `profissional_id = auth.uid()` ou `agenda.ver_equipe` (mig 083:363-367) | ✔ nos próprios |
| `agendamentos` UPDATE (F2, E5) | membro **e** (`agenda.gerenciar_outras` ou o próprio atendimento), em USING e WITH CHECK (mig 083:374-382) | ✔ nos próprios; ✘ nos da colega |
| `agendamento_servicos` UPDATE (F3) | o próprio atendimento ou `gerenciar_outras` (mig 089:145-157) | ✔ nos próprios |
| `comandas` INSERT (F1) | membro **e** `comanda.fechar` (mig 083:432-434) | ✔ |
| `comandas` SELECT/UPDATE (E4) | gestora/dona, `profissional_id = auth.uid()`, `comanda_pertence_ao_profissional(id)` ou `gerenciar_outras` (mig 089:66-79) | ✔ (quem fechou ou dona do atendimento). **Não confere `comanda.editar_fechada`** |
| `comanda_itens` INSERT (F4, E3) | só membro (mig 075:105-107; não foi mudada depois) | ✔, **sem chave nenhuma** |
| `comanda_itens` SELECT/UPDATE/DELETE (E1, E2) | gestora/dona, `comanda_pertence_ao_profissional` ou `gerenciar_outras` (mig 089:81-98). A função passou a contar também quem fechou (089:49-63) | ✔ |
| `pacote_clientes` INSERT (F5) | membro **e** `pacotes.vender` (mig 083:470-471) | ✔ |
| `vendas` INSERT (F6, F8) | migrations: "vendas: membro insere" (mig 046:21). **Produção** (CSV de 02/10): "vendas: membro gerencia" FOR ALL; a 046 não foi aplicada | ✔ nos dois casos. SELECT: só pelo ramo amplo de produção ou com `vendas.acessar` (mig 086:158-160) → **não usar RETURNING** |
| `venda_itens` INSERT (F9) | 046 "membro insere" / produção "membro gerencia" | ✔ |
| `estoque_movimentos` INSERT (F7) | (a) `estoque.acessar`; (b) saída com `agendamento_id` do **próprio** atendimento; (c) saída com `vendas.acessar`; (d) saída com `agendamento_id` e `gerenciar_outras` (mig 089:108-122) | ✔ com atendimento próprio. **✘ na comanda só com extras** (`agendamento_id = null`): a baixa é recusada, a tela só avisa e a venda fica gravada sem baixa. ✘ também com produto extra na comanda de atendimento da colega sem `gerenciar_outras` (a tela já impede abrir) |
| `produtos` UPDATE (trigger) | `estoque.acessar` (mig 083:567-570), mas o trigger é definer | ✔ (via definer) |
| `pagamentos` INSERT (F10, E7) | só membro, "pagamentos: membro insere" (mig 075:80-82) | ✔ |
| `pagamentos` DELETE (E6) | gestora/dona, `comanda_pertence` ou `gerenciar_outras` (mig 089:100-105) | ✔ |
| `pagamentos` SELECT (conferência de E6) | `financeiro.ver`, `comanda_pertence`, `gerenciar_outras` ou `vendas.acessar` na venda (mig 086:176-181) | ✔ |
| `taxas_reserva` SELECT (desconto) | `financeiro.ver`, `gerenciar_outras` ou o próprio atendimento (mig 083:494-500) | ✔ nos próprios |
| `comissoes`, `pacote_uso`, `taxas_reserva` UPDATE, `notificacoes` | só pelos triggers definer | — |

> Produção ainda tem "comissoes: membro insere" (CSV 2026-10-02-pg-policies-producao.csv),
> ou seja, qualquer membro pode inserir em `comissoes` direto pela API. Fora do escopo, mas vale
> registrar.

---

## 5. Como a comissão é calculada hoje

| | Atendimento | Serviço extra |
|---|---|---|
| Base | `agendamentos.valor` no momento do UPDATE para `concluido`, ou seja, Σ das linhas da comanda **sem desconto** (mig 065:41) | `round(valor_unit × quantidade, 2)` **sem desconto** (mig 085:51) |
| Percentual | `empresa_membros.percentual_comissao` da `profissional_id` do **atendimento** (multi-serviço: uma profissional para tudo) | o da `comanda_itens.profissional_id` |
| Quando | no fechamento (F2) | no INSERT do item (F4 ou E3) |
| Edição depois | `sincronizar_comissao_valor` (075): só `valor_servico`, inclusive em comissão paga | `sincronizar_comissao_item` (085): idem; troca de profissional com comissão paga é recusada |
| Pacote | não gera (065:28-30) | — |
| `valor_comissao` | coluna gerada `round(valor_servico × percentual / 100, 2)` (mig 001:189-191) | idem |
| `created_at` | default `now()`: hora do fechamento (pode ser outro mês, no caso de backlog) | default `now()`: hora do INSERT do item. **No caso de E3, a data da edição** |
| Mudança de percentual depois | `recalcular_comissoes_pendentes` (mig 025) altera o `percentual` das pendentes | idem |

**Desconto da comanda.** Não entra em comissão nenhuma. Também **não entra na receita**:
`calcularKpisFinanceiros` soma `agendamentos.valor` (bruto), `valor_unit × qtd` dos extras e
`vendas.valor_final`, e a venda via comanda grava `desconto = 0`
(`shared/kpis-financeiros.ts:159-160, 195-199`; `shared/kpis-financeiros-consultas.ts:71-77, 105-107`).
Nenhum KPI lê `comandas.desconto` nem `desconto_reserva`; a busca por essas colunas em
shared/web/mobile só encontra a comanda e as telas de detalhe.

> **A conferir com o dono (possível contagem em dobro):** a taxa de reserva paga entra na receita
> por `taxas_reserva.paga_em` (`kpis-financeiros.ts:199`), e o atendimento entra com
> `agendamentos.valor` cheio. A comanda cobra `valor − taxa`, mas a receita registra
> `valor + taxa`. O desconto manual também não reduz a receita.

### Decisões novas: onde cada uma mexe

**(a) Desconto rateado entre atendimentos e extras, com cada comissão sobre o valor com desconto**

| Onde | Mudança |
|---|---|
| Cálculo | rateio proporcional em centavos (resto distribuído por maior resto) sobre o peso `valor × qtd` de cada atendimento, serviço extra, produto e pacote. Item de pacote (R$ 0) recebe 0. Fazer **na função do banco** a partir dos itens, não na tela (hoje `calcularDesconto` está em SF:189) |
| Coluna nova | `agendamentos.desconto_rateado` (ou `valor_cobrado`) e `comanda_itens.desconto_rateado`. **Não** gravar o valor líquido em `agendamentos.valor`: ele é reaberto como valor de tabela na edição (W:597-620, M:592-606) e o desconto seria aplicado duas vezes |
| Trigger 065 `gerar_comissao` | base `NEW.valor − coalesce(NEW.desconto_rateado, 0)` |
| Trigger 075 `sincronizar_comissao_valor` | reagir também a `desconto_rateado` (hoje é `AFTER UPDATE OF valor`, então precisa ampliar a lista de colunas) |
| Triggers 085 | base `valor_unit × qtd − desconto_rateado`; `v_mudou_valor` também com `desconto_rateado`. Atenção: alterar o desconto numa comanda com comissão de extra **paga** muda o `valor_servico` dela (regra da 075) |
| Receita (shared) | `receitaServicos` e `receitaServicosExtras` passam a descontar o rateio (`kpis-financeiros.ts:195-196`, `valorServicoExtra` 159-161), e as colunas entram nos SELECTs de `kpis-financeiros-consultas.ts`. Produtos e pacote: gravar a parte deles em `vendas.desconto` (já existe; `valor_final` é gerado) |
| Decidir | se o **desconto da reserva** também é rateado (é pagamento antecipado, não desconto; o natural é ratear só o manual). Ver também a possível contagem em dobro acima |
| Edição | a função de edição recalcula o rateio de todos os itens e atualiza as duas colunas, e os triggers acertam as comissões |

**(b) Item incluído ao editar uma comanda de outro mês: comissão e receita no mês do fechamento (`comandas.fechada_at`)**

| Onde | Mudança |
|---|---|
| Receita do extra | **já** é por `comandas.fechada_at` (`kpis-financeiros-consultas.ts:75`); nada muda |
| Comissão do extra | `gerar_comissao_item` (mig 085:50) e o ramo de INSERT de `sincronizar_comissao_item` (085:101) devem gravar `created_at = (select fechada_at from comandas where id = new.comanda_id)`, com `now()` como fallback. Hoje é `now()` (data da edição) |
| Pagamentos novos na edição | hoje `created_at = now()`, e a taxa de cartão cai no mês da edição. Para ficar coerente com (b), a função de edição pode usar `fechada_at` nas linhas novas |
| Produto ou pacote na edição | hoje é proibido. Se a função passar a permitir, `vendas.created_at` e `pacote_clientes.data_inicio` também devem seguir `fechada_at` |
| Atendimento (fora da decisão, registrar) | a comissão é datada por `now()` no fechamento e a receita por `data_hora_inicio`. Fechar no dia 1º um atendimento do dia 30 separa os dois em meses diferentes. Vale gravar `created_at = fechada_at` também, ou documentar |

---

## 6. Riscos para uma função única

| # | Risco | Detalhe e mitigação |
|---|---|---|
| R1 | **Triggers que dependem do estado do UPDATE** | 065 e 078 só disparam na transição para `concluido` e leem `valor`, `pacote_cliente_id` e `comanda_id` do **mesmo** UPDATE: fazer um UPDATE por atendimento com tudo junto (e com `desconto_rateado`, se (a) usar coluna). 075 dispara em qualquer UPDATE de `valor` já concluído. As policies de E1/E2 dependem de `comanda_pertence_ao_profissional`, que lê `agendamentos.comanda_id` e `comandas.profissional_id`. Dentro da transação cada comando vê os anteriores (READ COMMITTED + snapshot novo por comando), então gravar `comandas` (com `profissional_id = auth.uid()`) **antes** de `comanda_itens` mantém a regra. Exceções dos triggers 085 ("Comissão deste serviço já foi paga") passam a desfazer **tudo**, o que é bom, mas a mensagem precisa chegar à tela |
| R2 | **RETURNING e UPDATE sem visibilidade** | invoker + RLS: `INSERT ... RETURNING` exige a policy de SELECT (comandas recém-criadas e `vendas` em produção com a 046). Gerar ids com `gen_random_uuid()` e não usar RETURNING (padrão da 087:18). UPDATE e DELETE com WHERE também exigem a linha visível no SELECT e devolvem 0 linhas em silêncio: usar `GET DIAGNOSTICS ... ROW_COUNT` e lançar erro, substituindo os `.select('id')` de hoje |
| R3 | **`auth.uid()` e permissões** | `tem_permissao` (mig 083:136-166) e `comanda_pertence_ao_profissional` dependem de `auth.uid()`. Funcionam em invoker via PostgREST e nos triggers definer, que leem o JWT da requisição. `comandas.profissional_id` deve ser `auth.uid()` lido no banco, nunca do payload. Conferir no banco o que hoje só a tela confere: `comanda.fechar`, `comanda.editar_fechada` (o banco **nunca** conferiu), `comanda.desconto` (desconto > 0 ou cortesia > 0, como na 087:93-98) e `pacotes.vender` (antes de gravar, para a mensagem sair clara) |
| R4 | **Triggers `security definer` e semântica de falha** | 065, 078, 061, 075, 085, `atualizar_estoque` e 028 rodam como dono e passam por cima da RLS. Hoje a baixa de estoque **falha só avisando** (F7). Numa transação única, a recusa da RLS em `estoque_movimentos` (comanda só com extras fechada pela profissional sem `estoque.acessar`) **derrubaria o fechamento inteiro**. É preciso decidir: pular com aviso devolvido pela função, permitir pelo ramo (b) ligando a um atendimento, ou ampliar a policy. `fn_registrar_uso_pacote` e `notificar_estoque_baixo` estão sem `SET search_path` (vale corrigir junto) |
| R5 | **Locks e deadlock com a 087/088** | `atualizar_estoque` pega o lock de linha de `produtos`. 087/088 pegam `pg_advisory_xact_lock(hashtextextended('venda_estoque:'||produto, 0))` em ordem de id e **depois** o lock de linha. Uma comanda que insira movimentos **fora de ordem e sem a trava** pode travar com uma venda avulsa (comanda segura a linha B e espera A; a venda segura a trava e a linha A e espera B) ou com outra comanda. Mitigação: a função da comanda pega a **mesma** trava consultiva, por produto agrupado e em ordem de `produto_id`, antes do 1º INSERT em `estoque_movimentos`, e insere em ordem de id. Se o saldo vai ou não ser conferido (hoje a comanda deixa ficar negativo, decisão de 29/09) é decisão à parte |
| R6 | **Fechamento em dobro e corrida** | G8 é leitura separada. Na função: `UPDATE agendamentos ... WHERE id = $1 AND comanda_id IS NULL` com conferência de ROW_COUNT (atômico, sem `FOR UPDATE`, que exigiria a policy de UPDATE nas linhas da colega). Comanda só com extras não tem âncora: a trava `comandasParciais` some ao recarregar. Uma chave de idempotência (por exemplo `comandas.id` gerado na tela e conferido com `ON CONFLICT DO NOTHING`/`exists`) resolve isso e também a queda de rede depois do commit (pendência da 087) |
| R7 | **Valores vindos da tela** | hoje `valor_total`, `desconto`, `desconto_reserva`, `agendamentos.valor`, `vendas.valor_total` e as taxas são da tela. A função deve recalcular subtotal, desconto, reserva (lendo `taxas_reserva` pagas; a profissional lê as dos próprios atendimentos) e cobertura do total. Taxa e líquido do cartão continuam vindo da tela, como na 087 |
| R8 | **Datas no aparelho** | `fechada_at`, `data_inicio` e `data_validade` do pacote vêm do relógio e do fuso do aparelho. Na função, usar `now()` e a data de Brasília |
| R9 | **Tamanho do payload e tempo** | uma comanda tem dezenas de itens. jsonb pequeno, muito abaixo dos limites do PostgREST e do gateway; o `statement_timeout` de `authenticated` (Supabase, padrão de 8 s) folga. Cuidado com `tem_permissao` por linha nas policies (até 4 buscas indexadas) multiplicado pelos itens; continua pequeno |
| R10 | **Assinatura e caminho antigo** | igual à 087: mudar a assinatura depois faz clientes antigos receberem `PGRST202`. Manter o caminho em passos como fallback só para `PGRST202` e nunca mudar a assinatura (criar outra função) |

---

## 7. Referências rápidas

- Fechamento: W:1015-1232 · M:977-1200
- Edição: W:784-872 · M:877-975
- Persistência do valor: W:720-765 · M:823-861 · SC:54-93
- Pagamentos: SF:292-330 · diff: SF:345-361
- Triggers: mig 065:21-53 · 075:156-175 · 078:54-126 · 061:46-94 · 085:40-133 · 083:595+ (`atualizar_estoque`) · 028:4-45 · 074:37-82 · 052:22+
- RLS: mig 083:361-385, 431-434, 464-478, 494-504, 549-555, 576-589 · 086:158-181 · 089:49-164 · 075:80-128 · 046:19-51 · produção: `docs/superpowers/notes/2026-10-02-pg-policies-producao.csv`
- Modelo: mig 087:31-154 · trava: 087:107, 088:67
